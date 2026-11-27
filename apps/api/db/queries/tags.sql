-- name: UpsertTag :one
insert into tags (slug, name) values ($1, $2)
on conflict (slug) do update set name = tags.name
returning *;

-- name: GetTagBySlug :one
select * from tags where slug = $1;

-- name: ListTagsByIDs :many
select * from tags where id = any(sqlc.arg(ids)::bigint[]);

-- name: ListPopularTags :many
select * from tags order by post_count desc, slug limit $1;

-- name: SearchTags :many
select * from tags
where slug like sqlc.arg(q)::text || '%' or lower(name) like '%' || sqlc.arg(q)::text || '%'
order by post_count desc limit sqlc.arg(page_limit)::int;

-- name: UpdateTagDescription :exec
update tags set description = $2 where id = $1;

-- name: ListTagsForLinks :many
select lt.link_id, t.id, t.slug, t.name
from link_tags lt join tags t on t.id = lt.tag_id
where lt.link_id = any(sqlc.arg(ids)::bigint[])
order by lt.link_id, t.slug;

-- name: ListTagsForArticles :many
select at.article_id, t.id, t.slug, t.name
from article_tags at join tags t on t.id = at.tag_id
where at.article_id = any(sqlc.arg(ids)::bigint[])
order by at.article_id, t.slug;
