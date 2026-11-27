-- name: CreateLink :one
insert into links (author_id, kind, title, slug, url, url_canonical, url_hash, domain, body_md, body_html)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
returning *;

-- name: GetLink :one
select sqlc.embed(l), sqlc.embed(u)
from links l join users u on u.id = l.author_id
where l.id = $1 and l.deleted_at is null;

-- name: UpdateLinkBody :one
update links set body_md = $2, body_html = $3, edited_at = now(), updated_at = now()
where id = $1 and deleted_at is null
returning *;

-- name: UpdateLinkTitle :exec
update links set title = $2, slug = $3, updated_at = now() where id = $1;

-- name: SoftDeleteLink :execrows
update links set deleted_at = now() where id = $1 and deleted_at is null;

-- name: KillLink :exec
update links set killed_at = case when $2::boolean then now() else null end where id = $1;

-- name: SetLinkScore :exec
update links set score = $2 where id = $1;

-- Duplicate detection: the same canonical URL posted within the dedupe window.
-- name: FindRecentDuplicate :one
select id, title, created_at from links
where url_hash = $1 and created_at > now() - make_interval(days => sqlc.arg(within_days)::int)
  and deleted_at is null
order by created_at desc limit 1;

-- name: CountAuthorDomainPosts :one
select count(*)::int as count from links
where author_id = $1 and domain = $2 and created_at > now() - interval '14 days' and deleted_at is null;

-- name: AddLinkTag :exec
insert into link_tags (link_id, tag_id) values ($1, $2) on conflict do nothing;

-- name: ClearLinkTags :exec
delete from link_tags where link_id = $1;

-- Top: ranked by the score the ranking job writes. Keyset cursor is (score, id).
-- name: ListLinksByScore :many
select sqlc.embed(l), sqlc.embed(u)
from links l
join users u on u.id = l.author_id
where l.deleted_at is null and l.killed_at is null
  and not exists (select 1 from spam_holds h
                  where h.subject_type = 'link' and h.subject_id = l.id and h.released_at is null)
  and (sqlc.narg(kind)::text is null or l.kind = sqlc.narg(kind)::text)
  and (sqlc.narg(domain)::text is null or l.domain = sqlc.narg(domain)::text)
  and (sqlc.narg(author_id)::bigint is null or l.author_id = sqlc.narg(author_id)::bigint)
  and (sqlc.narg(tag_id)::bigint is null
       or exists (select 1 from link_tags lt
                  where lt.link_id = l.id and lt.tag_id = sqlc.narg(tag_id)::bigint))
  and not bw_hidden(sqlc.narg(viewer_id)::bigint, l.author_id)
  and not bw_word_muted(sqlc.narg(viewer_id)::bigint, l.title || ' ' || l.body_md)
  and (sqlc.narg(cursor_score)::float8 is null
       or (l.score, l.id) < (sqlc.narg(cursor_score)::float8, sqlc.narg(cursor_id)::bigint))
order by l.score desc, l.id desc
limit sqlc.arg(page_limit)::int;

-- New: newest first. Keyset cursor is (created_at, id).
-- name: ListLinksByCreated :many
select sqlc.embed(l), sqlc.embed(u)
from links l
join users u on u.id = l.author_id
where l.deleted_at is null and l.killed_at is null
  and not exists (select 1 from spam_holds h
                  where h.subject_type = 'link' and h.subject_id = l.id and h.released_at is null)
  and (sqlc.narg(kind)::text is null or l.kind = sqlc.narg(kind)::text)
  and (sqlc.narg(domain)::text is null or l.domain = sqlc.narg(domain)::text)
  and (sqlc.narg(author_id)::bigint is null or l.author_id = sqlc.narg(author_id)::bigint)
  and (sqlc.narg(tag_id)::bigint is null
       or exists (select 1 from link_tags lt
                  where lt.link_id = l.id and lt.tag_id = sqlc.narg(tag_id)::bigint))
  and not bw_hidden(sqlc.narg(viewer_id)::bigint, l.author_id)
  and not bw_word_muted(sqlc.narg(viewer_id)::bigint, l.title || ' ' || l.body_md)
  and (sqlc.narg(cursor_created)::timestamptz is null
       or (l.created_at, l.id) < (sqlc.narg(cursor_created)::timestamptz, sqlc.narg(cursor_id)::bigint))
order by l.created_at desc, l.id desc
limit sqlc.arg(page_limit)::int;

-- Best: most upvoted first. Keyset cursor is (points, id).
-- name: ListLinksByPoints :many
select sqlc.embed(l), sqlc.embed(u)
from links l
join users u on u.id = l.author_id
where l.deleted_at is null and l.killed_at is null
  and not exists (select 1 from spam_holds h
                  where h.subject_type = 'link' and h.subject_id = l.id and h.released_at is null)
  and (sqlc.narg(kind)::text is null or l.kind = sqlc.narg(kind)::text)
  and (sqlc.narg(domain)::text is null or l.domain = sqlc.narg(domain)::text)
  and (sqlc.narg(author_id)::bigint is null or l.author_id = sqlc.narg(author_id)::bigint)
  and (sqlc.narg(tag_id)::bigint is null
       or exists (select 1 from link_tags lt
                  where lt.link_id = l.id and lt.tag_id = sqlc.narg(tag_id)::bigint))
  and not bw_hidden(sqlc.narg(viewer_id)::bigint, l.author_id)
  and not bw_word_muted(sqlc.narg(viewer_id)::bigint, l.title || ' ' || l.body_md)
  and (sqlc.narg(cursor_points)::int is null
       or (l.points, l.id) < (sqlc.narg(cursor_points)::int, sqlc.narg(cursor_id)::bigint))
order by l.points desc, l.id desc
limit sqlc.arg(page_limit)::int;

-- name: ListLinksByIDs :many
select sqlc.embed(l), sqlc.embed(u)
from links l join users u on u.id = l.author_id
where l.id = any(sqlc.arg(ids)::bigint[]) and l.deleted_at is null;

-- Candidates for the ranking job: everything posted in the last seven days.
-- name: ListRankCandidates :many
select l.id, l.points, l.comment_count, l.flag_count, l.created_at, l.domain, l.author_id,
       coalesce(d.multiplier, 1)::float8 as domain_multiplier,
       (select count(*) from links s
        where s.author_id = l.author_id and s.domain = l.domain
          and s.created_at > l.created_at - interval '14 days' and s.deleted_at is null)::int as author_domain_count,
       (u.created_at > now() - interval '7 days') as author_is_new
from links l
join users u on u.id = l.author_id
left join domain_rules d on d.domain = l.domain
where l.created_at > now() - interval '7 days' and l.deleted_at is null and l.killed_at is null;

-- name: GetDomainRule :one
select * from domain_rules where domain = $1;

-- name: UpsertDomainRule :one
insert into domain_rules (domain, multiplier, banned, note) values ($1, $2, $3, $4)
on conflict (domain) do update set multiplier = excluded.multiplier, banned = excluded.banned,
  note = excluded.note
returning *;

-- name: ListDomainRules :many
select * from domain_rules order by domain;

-- name: CountAuthorLinksSince :one
select count(*)::int as count from links
where author_id = $1 and created_at > $2 and deleted_at is null;
