-- +goose Up

-- Posts already sent to the Telegram channel, so each goes out once.
create table telegram_posts (
  subject_type text        not null check (subject_type in ('link', 'article', 'digest')),
  subject_id   bigint      not null,
  posted_at    timestamptz not null default now(),
  primary key (subject_type, subject_id)
);

-- +goose Down
drop table telegram_posts;
