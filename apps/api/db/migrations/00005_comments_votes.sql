-- +goose Up

create table comments (
  id           bigint generated always as identity primary key,
  subject_type text        not null check (subject_type in ('link','article')),
  subject_id   bigint      not null,
  author_id    bigint      not null references users (id) on delete restrict,
  parent_id    bigint      references comments (id) on delete cascade,
  depth        smallint    not null default 0 check (depth between 0 and 12),
  path         text        not null default '',
  body_md      text        not null check (char_length(body_md) between 1 and 10000),
  body_html    text        not null default '',
  points       integer     not null default 1,
  flag_count   integer     not null default 0,
  created_at   timestamptz not null default now(),
  edited_at    timestamptz,
  deleted_at   timestamptz,
  killed_at    timestamptz,
  search       tsvector    generated always as (to_tsvector('simple', body_md)) stored
);

create index comments_subject_idx on comments (subject_type, subject_id, path, created_at);
create index comments_author_id_idx on comments (author_id, created_at desc);
create index comments_parent_id_idx on comments (parent_id);
create index comments_search_idx on comments using gin (search);

create table votes (
  subject_type text        not null check (subject_type in ('link','article','comment')),
  subject_id   bigint      not null,
  user_id      bigint      not null references users (id) on delete cascade,
  value        smallint    not null check (value in (-1, 1)),
  created_at   timestamptz not null default now(),
  primary key (subject_type, subject_id, user_id)
);

create index votes_user_id_idx on votes (user_id, created_at desc);

create table flags (
  subject_type text        not null check (subject_type in ('link','article','comment','note')),
  subject_id   bigint      not null,
  user_id      bigint      not null references users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (subject_type, subject_id, user_id)
);

-- +goose Down
drop table flags;
drop table votes;
drop table comments;
