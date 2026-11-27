-- +goose Up

create table users (
  id            bigint generated always as identity primary key,
  username      text        not null,
  username_lower text       not null generated always as (lower(username)) stored,
  display_name  text        not null default '' check (char_length(display_name) <= 60),
  pronouns      text        not null default '' check (char_length(pronouns) <= 24),
  bio           text        not null default '' check (char_length(bio) <= 160),
  readme_md     text        not null default '' check (char_length(readme_md) <= 20000),
  readme_html   text        not null default '',
  role_title    text        not null default '' check (char_length(role_title) <= 60),
  company       text        not null default '' check (char_length(company) <= 60),
  location      text        not null default '' check (char_length(location) <= 60),
  open_to_work  boolean     not null default false,
  accent        text        not null default 'lapis' check (accent in ('lapis','turquoise','saffron','plum','moss')),
  avatar_media  bigint,
  banner_media  bigint,
  lang          text        not null default 'uz' check (lang in ('uz','ru','en')),
  script        text        not null default 'latn' check (script in ('latn','cyrl')),
  theme         text        not null default 'system' check (theme in ('system','light','dark')),
  karma         integer     not null default 0,
  is_moderator  boolean     not null default false,
  is_admin      boolean     not null default false,
  email         text        check (char_length(email) <= 254),
  email_domain  text        check (char_length(email_domain) <= 253),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  banned_at     timestamptz,
  ban_reason    text        not null default '',
  deleted_at    timestamptz,
  constraint users_username_format check (username ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$')
);

create unique index users_username_lower_key on users (username_lower);
create index users_karma_idx on users (karma desc) where deleted_at is null;
create index users_open_to_work_idx on users (open_to_work) where open_to_work and deleted_at is null;

create table user_identities (
  id          bigint generated always as identity primary key,
  user_id     bigint      not null references users (id) on delete cascade,
  provider    text        not null check (provider in ('github','google','telegram','dev')),
  subject     text        not null,
  handle      text        not null default '',
  created_at  timestamptz not null default now()
);

create unique index user_identities_provider_subject_key on user_identities (provider, subject);
create index user_identities_user_id_idx on user_identities (user_id);

create table sessions (
  token_hash  bytea       primary key,
  user_id     bigint      not null references users (id) on delete cascade,
  csrf_token  text        not null,
  user_agent  text        not null default '',
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);

create table oauth_states (
  state         text        primary key,
  provider      text        not null check (provider in ('github','google')),
  code_verifier text        not null default '',
  redirect_to   text        not null default '/',
  created_at    timestamptz not null default now()
);

create table user_links (
  id        bigint generated always as identity primary key,
  user_id   bigint not null references users (id) on delete cascade,
  kind      text   not null check (kind in ('website','github','gitlab','telegram','x','linkedin','email','other')),
  url       text   not null check (char_length(url) <= 300),
  sort      smallint not null default 0
);

create index user_links_user_id_idx on user_links (user_id, sort);

create table user_stack (
  id      bigint generated always as identity primary key,
  user_id bigint not null references users (id) on delete cascade,
  name    text   not null check (char_length(name) between 1 and 30),
  sort    smallint not null default 0
);

create unique index user_stack_user_name_key on user_stack (user_id, lower(name));

create table user_repos (
  id          bigint generated always as identity primary key,
  user_id     bigint not null references users (id) on delete cascade,
  full_name   text   not null check (char_length(full_name) <= 140),
  description text   not null default '' check (char_length(description) <= 300),
  language    text   not null default '',
  stars       integer not null default 0,
  url         text   not null,
  sort        smallint not null default 0,
  synced_at   timestamptz not null default now()
);

create unique index user_repos_user_full_name_key on user_repos (user_id, lower(full_name));

create table user_badges (
  user_id    bigint not null references users (id) on delete cascade,
  kind       text   not null check (kind in ('github','company_email','moderator','early','author','founder')),
  detail     text   not null default '',
  granted_at timestamptz not null default now(),
  primary key (user_id, kind)
);

create table telegram_accounts (
  user_id     bigint      primary key references users (id) on delete cascade,
  chat_id     bigint      not null,
  handle      text        not null default '',
  notify      boolean     not null default true,
  linked_at   timestamptz not null default now()
);

create unique index telegram_accounts_chat_id_key on telegram_accounts (chat_id);

-- +goose Down
drop table telegram_accounts;
drop table user_badges;
drop table user_repos;
drop table user_stack;
drop table user_links;
drop table oauth_states;
drop table sessions;
drop table user_identities;
drop table users;
