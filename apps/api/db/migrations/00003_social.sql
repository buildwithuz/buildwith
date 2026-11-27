-- +goose Up

create table tags (
  id          bigint generated always as identity primary key,
  slug        text        not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,29}$'),
  name        text        not null check (char_length(name) between 1 and 40),
  description text        not null default '' check (char_length(description) <= 200),
  post_count  integer     not null default 0,
  created_at  timestamptz not null default now()
);

create unique index tags_slug_key on tags (slug);
create index tags_post_count_idx on tags (post_count desc);

create table follows (
  follower_id bigint      not null references users (id) on delete cascade,
  followee_id bigint      not null references users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);

create index follows_followee_id_idx on follows (followee_id, created_at desc);

create table tag_follows (
  user_id    bigint      not null references users (id) on delete cascade,
  tag_id     bigint      not null references tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, tag_id)
);

create index tag_follows_tag_id_idx on tag_follows (tag_id);

create table blocks (
  blocker_id bigint      not null references users (id) on delete cascade,
  blocked_id bigint      not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create index blocks_blocked_id_idx on blocks (blocked_id);

create table mutes (
  muter_id   bigint      not null references users (id) on delete cascade,
  muted_id   bigint      not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint mutes_not_self check (muter_id <> muted_id)
);

create table muted_words (
  id         bigint generated always as identity primary key,
  user_id    bigint      not null references users (id) on delete cascade,
  word       text        not null check (char_length(word) between 2 and 40),
  created_at timestamptz not null default now()
);

create unique index muted_words_user_word_key on muted_words (user_id, lower(word));

-- +goose Down
drop table muted_words;
drop table mutes;
drop table blocks;
drop table tag_follows;
drop table follows;
drop table tags;
