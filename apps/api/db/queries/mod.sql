-- name: CreateReport :one
insert into reports (reporter_id, subject_type, subject_id, reason, note)
values ($1, $2, $3, $4, $5)
on conflict (reporter_id, subject_type, subject_id) do update set reason = excluded.reason,
  note = excluded.note, status = 'open'
returning *;

-- name: ListOpenReports :many
select sqlc.embed(r), sqlc.embed(u)
from reports r join users u on u.id = r.reporter_id
where r.status = 'open'
order by r.created_at
limit $1;

-- name: ResolveReport :exec
update reports set status = $2, handled_by = $3, handled_at = now() where id = $1;

-- name: CountOpenReports :one
select count(*)::int as count from reports where status = 'open';

-- name: LogModAction :one
insert into mod_actions (actor_id, action, subject_type, subject_id, subject_text, reason)
values ($1, $2, $3, $4, $5, $6)
returning *;

-- The public moderation log. Everything a moderator does shows up here.
-- name: ListModActions :many
select sqlc.embed(m), sqlc.embed(u)
from mod_actions m join users u on u.id = m.actor_id
where (sqlc.narg(cursor_created)::timestamptz is null
       or (m.created_at, m.id) < (sqlc.narg(cursor_created)::timestamptz, sqlc.narg(cursor_id)::bigint))
order by m.created_at desc, m.id desc
limit sqlc.arg(page_limit)::int;

-- name: ListModerators :many
select * from users where is_moderator and deleted_at is null order by username;

-- name: HoldForReview :exec
insert into spam_holds (subject_type, subject_id, reason) values ($1, $2, $3)
on conflict (subject_type, subject_id) do nothing;

-- name: ReleaseHold :execrows
update spam_holds set released_at = now()
where subject_type = $1 and subject_id = $2 and released_at is null;

-- name: ListHolds :many
select * from spam_holds where released_at is null order by created_at limit $1;

-- name: IsHeld :one
select exists (
  select 1 from spam_holds where subject_type = $1 and subject_id = $2 and released_at is null
) as held;

-- Has this domain been seen on the site before, outside this author's own posts?
-- name: DomainSeenBefore :one
select exists (
  select 1 from links
  where domain = sqlc.arg(domain)::text and author_id <> sqlc.arg(author_id)::bigint
    and deleted_at is null
) as seen;

-- name: RegisterMonthlyThread :exec
insert into monthly_threads (kind, year, month, link_id) values ($1, $2, $3, $4)
on conflict (kind, year, month) do nothing;

-- name: GetMonthlyThread :one
select mt.link_id, l.title, l.slug from monthly_threads mt
join links l on l.id = mt.link_id
where mt.kind = $1 and mt.year = $2 and mt.month = $3;

-- name: ListLatestMonthlyThreads :many
select mt.kind, mt.year, mt.month, mt.link_id, l.title, l.slug, l.comment_count
from monthly_threads mt
join links l on l.id = mt.link_id
where l.deleted_at is null
order by mt.year desc, mt.month desc, mt.kind
limit $1;
