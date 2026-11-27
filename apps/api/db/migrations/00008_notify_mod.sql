-- +goose Up

create table notifications (
  id           bigint generated always as identity primary key,
  user_id      bigint      not null references users (id) on delete cascade,
  kind         text        not null check (kind in (
                 'reply','mention','like','repost','quote','follow','comment',
                 'article_published','mod_action','badge','featured')),
  actor_id     bigint      references users (id) on delete cascade,
  subject_type text        not null default '' check (subject_type in ('','link','article','comment','note','user')),
  subject_id   bigint,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create index notifications_user_id_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

create table reports (
  id           bigint generated always as identity primary key,
  reporter_id  bigint      not null references users (id) on delete cascade,
  subject_type text        not null check (subject_type in ('link','article','comment','note','user')),
  subject_id   bigint      not null,
  reason       text        not null check (reason in ('spam','abuse','off_topic','illegal','duplicate','other')),
  note         text        not null default '' check (char_length(note) <= 1000),
  status       text        not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at   timestamptz not null default now(),
  handled_by   bigint      references users (id) on delete set null,
  handled_at   timestamptz
);

create index reports_status_idx on reports (status, created_at desc);
create unique index reports_reporter_subject_key on reports (reporter_id, subject_type, subject_id);

-- Public moderation log: every moderator action is visible at /modlog.
create table mod_actions (
  id           bigint generated always as identity primary key,
  actor_id     bigint      not null references users (id) on delete restrict,
  action       text        not null check (action in (
                 'kill','unkill','ban','unban','rename','untag','retag','feature','unfeature',
                 'domain_rule','grant_moderator','revoke_moderator','dismiss_report')),
  subject_type text        not null check (subject_type in ('link','article','comment','note','user','domain')),
  subject_id   bigint,
  subject_text text        not null default '',
  reason       text        not null default '' check (char_length(reason) <= 500),
  created_at   timestamptz not null default now()
);

create index mod_actions_created_at_idx on mod_actions (created_at desc);
create index mod_actions_subject_idx on mod_actions (subject_type, subject_id);

create table monthly_threads (
  kind    text     not null check (kind in ('hiring','looking','freelance','building')),
  year    smallint not null,
  month   smallint not null check (month between 1 and 12),
  link_id bigint   not null references links (id) on delete cascade,
  primary key (kind, year, month)
);

-- +goose Down
drop table monthly_threads;
drop table mod_actions;
drop table reports;
drop table notifications;
