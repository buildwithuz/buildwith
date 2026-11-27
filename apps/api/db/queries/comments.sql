-- name: CreateComment :one
insert into comments (subject_type, subject_id, author_id, parent_id, body_md, body_html)
values ($1, $2, $3, $4, $5, $6)
returning *;

-- name: GetComment :one
select sqlc.embed(c), sqlc.embed(u)
from comments c join users u on u.id = c.author_id
where c.id = $1 and c.deleted_at is null;

-- The whole thread for one link or article, ordered so a single pass renders the nesting.
-- name: ListCommentsForSubject :many
select sqlc.embed(c), sqlc.embed(u),
       coalesce(v.value, 0)::int as viewer_vote,
       bw_hidden(sqlc.narg(viewer_id)::bigint, c.author_id) as collapsed_hidden,
       bw_word_muted(sqlc.narg(viewer_id)::bigint, c.body_md) as collapsed_muted
from comments c
join users u on u.id = c.author_id
left join votes v on v.subject_type = 'comment' and v.subject_id = c.id
     and v.user_id = sqlc.narg(viewer_id)::bigint
where c.subject_type = sqlc.arg(subject_type)::text
  and c.subject_id = sqlc.arg(subject_id)::bigint
order by c.path
limit sqlc.arg(page_limit)::int;

-- name: ListCommentsByAuthor :many
select sqlc.embed(c), sqlc.embed(u)
from comments c join users u on u.id = c.author_id
where c.author_id = sqlc.arg(author_id)::bigint
  and c.deleted_at is null and c.killed_at is null
  and not bw_hidden(sqlc.narg(viewer_id)::bigint, c.author_id)
  and (sqlc.narg(cursor_created)::timestamptz is null
       or (c.created_at, c.id) < (sqlc.narg(cursor_created)::timestamptz, sqlc.narg(cursor_id)::bigint))
order by c.created_at desc, c.id desc
limit sqlc.arg(page_limit)::int;

-- name: UpdateComment :one
update comments set body_md = $2, body_html = $3, edited_at = now()
where id = $1 and deleted_at is null
returning *;

-- name: SoftDeleteComment :execrows
update comments set deleted_at = now() where id = $1 and deleted_at is null;

-- name: KillComment :exec
update comments set killed_at = case when sqlc.arg(enabled)::boolean then now() else null end
where id = sqlc.arg(id)::bigint;

-- A reply may come at most once every cooldown window, which grows with depth.
-- name: LastCommentAt :one
select coalesce(max(created_at), 'epoch')::timestamptz as last_at from comments where author_id = $1;

-- name: CountAuthorCommentsSince :one
select count(*)::int as count from comments
where author_id = $1 and created_at > $2 and deleted_at is null;

-- name: SubjectAuthor :one
select case sqlc.arg(subject_type)::text
         when 'link'    then (select author_id from links    where id = sqlc.arg(subject_id)::bigint)
         when 'article' then (select author_id from articles where id = sqlc.arg(subject_id)::bigint)
         when 'comment' then (select author_id from comments where id = sqlc.arg(subject_id)::bigint)
         when 'note'    then (select author_id from notes    where id = sqlc.arg(subject_id)::bigint)
       end::bigint as author_id;

-- What a new comment needs to check about the thing it is attached to.
-- name: GetCommentTarget :one
select
  coalesce(case sqlc.arg(subject_type)::text
    when 'link'    then (select author_id from links where id = sqlc.arg(subject_id)::bigint
                         and deleted_at is null and killed_at is null)
    when 'article' then (select author_id from articles where id = sqlc.arg(subject_id)::bigint
                         and deleted_at is null and killed_at is null and status = 'published')
  end, 0)::bigint as author_id;
