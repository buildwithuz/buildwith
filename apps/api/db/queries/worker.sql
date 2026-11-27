-- name: MarkTelegramPosted :execrows
insert into telegram_posts (subject_type, subject_id) values ($1, $2) on conflict do nothing;

-- Link posts that crossed the autopost threshold and have not been sent yet.
-- name: ListAutopostCandidates :many
select l.id, l.title, l.slug, l.points, l.url, l.domain, u.username
from links l join users u on u.id = l.author_id
where l.points >= sqlc.arg(min_points)::int
  and l.created_at > now() - interval '3 days'
  and l.deleted_at is null and l.killed_at is null
  and not exists (select 1 from spam_holds h where h.subject_type = 'link' and h.subject_id = l.id and h.released_at is null)
  and not exists (select 1 from telegram_posts t where t.subject_type = 'link' and t.subject_id = l.id)
order by l.points desc
limit 5;

-- name: ListTopLinksSince :many
select l.id, l.title, l.slug, l.points, l.comment_count
from links l
where l.created_at > sqlc.arg(since)::timestamptz and l.deleted_at is null and l.killed_at is null
  and not exists (select 1 from spam_holds h where h.subject_type = 'link' and h.subject_id = l.id and h.released_at is null)
order by l.points desc, l.id desc
limit sqlc.arg(page_limit)::int;

-- The account that opens monthly threads: the oldest admin, else the oldest moderator.
-- name: GetSystemAuthor :one
select * from users
where (is_admin or is_moderator) and deleted_at is null and banned_at is null
order by is_admin desc, id
limit 1;

-- name: PublishDueArticle :execrows
update articles set status = 'published', published_at = scheduled_at, scheduled_at = null, updated_at = now()
where id = $1 and status = 'scheduled';

-- name: ListArticleScoreCandidates :many
select a.id, a.points, a.comment_count, a.flag_count, a.published_at, u.created_at as author_created
from articles a join users u on u.id = a.author_id
where a.status = 'published' and a.published_at > now() - interval '7 days'
  and a.deleted_at is null and a.killed_at is null;
