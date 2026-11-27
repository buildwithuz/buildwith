-- +goose Up

create table media (
  id         bigint generated always as identity primary key,
  owner_id   bigint      references users (id) on delete set null,
  sha256     bytea       not null,
  kind       text        not null check (kind in ('avatar','banner','note','article','cover')),
  mime       text        not null check (mime in ('image/jpeg','image/png','image/webp')),
  width      integer     not null,
  height     integer     not null,
  bytes      integer     not null,
  created_at timestamptz not null default now()
);

create unique index media_sha256_kind_key on media (sha256, kind);
create index media_owner_id_idx on media (owner_id, created_at desc);

alter table users add constraint users_avatar_media_fkey
  foreign key (avatar_media) references media (id) on delete set null;
alter table users add constraint users_banner_media_fkey
  foreign key (banner_media) references media (id) on delete set null;

-- +goose Down
alter table users drop constraint users_banner_media_fkey;
alter table users drop constraint users_avatar_media_fkey;
drop table media;
