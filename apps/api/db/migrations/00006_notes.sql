-- +goose Up

create table notes (
  id            bigint generated always as identity primary key,
  author_id     bigint      not null references users (id) on delete restrict,
  body_md       text        not null default '' check (char_length(body_md) <= 2000),
  body_html     text        not null default '',
  code_lang     text        not null default '' check (char_length(code_lang) <= 20),
  code_body     text        not null default '' check (char_length(code_body) <= 4000),
  code_html     text        not null default '',
  reply_to_id   bigint      references notes (id) on delete cascade,
  root_id       bigint      references notes (id) on delete cascade,
  quote_of_id   bigint      references notes (id) on delete set null,
  repost_of_id  bigint      references notes (id) on delete cascade,
  reply_policy  text        not null default 'everyone' check (reply_policy in ('everyone','following','mentioned')),
  like_count    integer     not null default 0,
  repost_count  integer     not null default 0,
  quote_count   integer     not null default 0,
  reply_count   integer     not null default 0,
  flag_count    integer     not null default 0,
  promoted_link_id bigint   references links (id) on delete set null,
  preview_url   text        check (char_length(preview_url) <= 2000),
  preview_title text        not null default '' check (char_length(preview_title) <= 200),
  preview_desc  text        not null default '' check (char_length(preview_desc) <= 400),
  preview_media bigint      references media (id) on delete set null,
  preview_domain text       not null default '',
  created_at    timestamptz not null default now(),
  edited_at     timestamptz,
  deleted_at    timestamptz,
  killed_at     timestamptz,
  constraint notes_repost_is_empty check (repost_of_id is null or (body_md = '' and code_body = '')),
  constraint notes_not_empty check (
    repost_of_id is not null or quote_of_id is not null
    or char_length(body_md) > 0 or char_length(code_body) > 0
  )
);

create index notes_created_at_idx on notes (created_at desc, id desc)
  where deleted_at is null and killed_at is null;
create index notes_author_created_at_idx on notes (author_id, created_at desc, id desc);
create index notes_root_id_idx on notes (root_id, created_at) where root_id is not null;
create index notes_reply_to_id_idx on notes (reply_to_id, created_at) where reply_to_id is not null;
create index notes_repost_of_id_idx on notes (repost_of_id) where repost_of_id is not null;
create index notes_quote_of_id_idx on notes (quote_of_id) where quote_of_id is not null;
create index notes_popular_idx on notes ((like_count + repost_count) desc, id desc)
  where deleted_at is null and killed_at is null and reply_to_id is null and repost_of_id is null;

create table note_media (
  id       bigint generated always as identity primary key,
  note_id  bigint   not null references notes (id) on delete cascade,
  media_id bigint   not null references media (id) on delete restrict,
  alt      text     not null check (char_length(alt) between 1 and 300),
  sort     smallint not null default 0
);

create index note_media_note_id_idx on note_media (note_id, sort);

create table note_likes (
  note_id    bigint      not null references notes (id) on delete cascade,
  user_id    bigint      not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, user_id)
);

create index note_likes_user_id_idx on note_likes (user_id, created_at desc);

create table note_bookmarks (
  note_id    bigint      not null references notes (id) on delete cascade,
  user_id    bigint      not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, note_id)
);

create table note_edits (
  id         bigint generated always as identity primary key,
  note_id    bigint      not null references notes (id) on delete cascade,
  body_md    text        not null,
  created_at timestamptz not null default now()
);

create index note_edits_note_id_idx on note_edits (note_id, created_at desc);

-- +goose Down
drop table note_edits;
drop table note_bookmarks;
drop table note_likes;
drop table note_media;
drop table notes;
