-- +goose Up

-- Background job queue, drained by cmd/worker with FOR UPDATE SKIP LOCKED.
create table jobs (
  id         bigint generated always as identity primary key,
  kind       text        not null,
  payload    jsonb       not null default '{}',
  run_at     timestamptz not null default now(),
  attempts   smallint    not null default 0,
  last_error text        not null default '',
  locked_at  timestamptz,
  locked_by  text        not null default '',
  created_at timestamptz not null default now()
);

create index jobs_runnable_idx on jobs (run_at) where locked_at is null;
create unique index jobs_unique_kind_payload on jobs (kind, payload) where locked_at is null;

-- Fixed-window rate limiting. Keys are "<bucket>:<user id or ip>".
create table rate_counters (
  key          text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (key, window_start)
);

create index rate_counters_window_start_idx on rate_counters (window_start);

-- Items held for moderator review before they appear (new account + unseen domain).
create table spam_holds (
  subject_type text        not null check (subject_type in ('link','article','note','comment')),
  subject_id   bigint      not null,
  reason       text        not null default '',
  created_at   timestamptz not null default now(),
  released_at  timestamptz,
  primary key (subject_type, subject_id)
);

create index spam_holds_open_idx on spam_holds (created_at) where released_at is null;

-- +goose Down
drop table spam_holds;
drop table rate_counters;
drop table jobs;
