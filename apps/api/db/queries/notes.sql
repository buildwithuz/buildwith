-- name: CreateNote :one
insert into notes (author_id, body_md, body_html, code_lang, code_body, code_html,
                   reply_to_id, root_id, quote_of_id, repost_of_id, reply_policy)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
returning *;

-- name: GetNote :one
select sqlc.embed(n), sqlc.embed(u)
from notes n join users u on u.id = n.author_id
where n.id = $1 and n.deleted_at is null;

-- name: UpdateNote :one
update notes set body_md = $2, body_html = $3, edited_at = now()
where id = $1 and deleted_at is null
returning *;

-- name: SoftDeleteNote :execrows
update notes set deleted_at = now() where id = $1 and deleted_at is null;

-- name: KillNote :exec
update notes set killed_at = case when $2::boolean then now() else null end where id = $1;

-- name: SetNotePreview :exec
update notes set preview_url = $2, preview_title = $3, preview_desc = $4,
  preview_domain = $5, preview_media = $6
where id = $1;

-- name: PromoteNoteToLink :exec
update notes set promoted_link_id = $2 where id = $1;

-- name: AddNoteMedia :exec
insert into note_media (note_id, media_id, alt, sort) values ($1, $2, $3, $4);

-- name: ListNoteMedia :many
select nm.note_id, nm.alt, nm.sort, sqlc.embed(m)
from note_media nm join media m on m.id = nm.media_id
where nm.note_id = any($1::bigint[])
order by nm.note_id, nm.sort;

-- name: RecordNoteEdit :exec
insert into note_edits (note_id, body_md) values ($1, $2);

-- name: ListNoteEdits :many
select * from note_edits where note_id = $1 order by created_at desc limit 20;

-- name: LikeNote :execrows
insert into note_likes (note_id, user_id) values ($1, $2) on conflict do nothing;

-- name: UnlikeNote :execrows
delete from note_likes where note_id = $1 and user_id = $2;

-- name: ListLikesForNotes :many
select note_id from note_likes where note_id = any($1::bigint[]) and user_id = $2;

-- name: BookmarkNote :execrows
insert into note_bookmarks (note_id, user_id) values ($1, $2) on conflict do nothing;

-- name: UnbookmarkNote :execrows
delete from note_bookmarks where note_id = $1 and user_id = $2;

-- name: ListBookmarksForNotes :many
select note_id from note_bookmarks where note_id = any($1::bigint[]) and user_id = $2;

-- name: FindRepost :one
select id from notes
where author_id = $1 and repost_of_id = $2 and deleted_at is null limit 1;

-- name: ListRepostsForNotes :many
select repost_of_id from notes
where author_id = $1 and repost_of_id = any($2::bigint[]) and deleted_at is null;

-- Latest notes, excluding replies. Keyset cursor is (created_at, id).
-- name: ListNotes :many
select sqlc.embed(n), sqlc.embed(u)
from notes n
join users u on u.id = n.author_id
where n.deleted_at is null and n.killed_at is null and n.reply_to_id is null
  and not exists (select 1 from spam_holds h
                  where h.subject_type = 'note' and h.subject_id = n.id and h.released_at is null)
  and (sqlc.narg(author_id)::bigint is null or n.author_id = sqlc.narg(author_id)::bigint)
  and not bw_hidden(sqlc.narg(viewer_id)::bigint, n.author_id)
  and not bw_word_muted(sqlc.narg(viewer_id)::bigint, n.body_md)
  and (sqlc.narg(cursor_created)::timestamptz is null
       or (n.created_at, n.id) < (sqlc.narg(cursor_created)::timestamptz, sqlc.narg(cursor_id)::bigint))
order by n.created_at desc, n.id desc
limit sqlc.arg(page_limit)::int;

-- Notes with enough traction in the last day for the "Popular notes" box.
-- name: ListPopularNotes :many
select sqlc.embed(n), sqlc.embed(u)
from notes n
join users u on u.id = n.author_id
where n.deleted_at is null and n.killed_at is null
  and n.reply_to_id is null and n.repost_of_id is null
  and n.created_at > now() - interval '24 hours'
  and (n.like_count + n.repost_count) >= sqlc.arg(min_traction)::int
  and not bw_hidden(sqlc.narg(viewer_id)::bigint, n.author_id)
  and not bw_word_muted(sqlc.narg(viewer_id)::bigint, n.body_md)
order by (n.like_count + n.repost_count) desc, n.id desc
limit sqlc.arg(page_limit)::int;

-- One thread: the note, its ancestors and its replies.
-- name: ListNoteReplies :many
select sqlc.embed(n), sqlc.embed(u)
from notes n
join users u on u.id = n.author_id
where n.reply_to_id = sqlc.arg(note_id)::bigint
  and n.deleted_at is null and n.killed_at is null
  and not bw_hidden(sqlc.narg(viewer_id)::bigint, n.author_id)
  and not bw_word_muted(sqlc.narg(viewer_id)::bigint, n.body_md)
order by n.like_count desc, n.created_at
limit sqlc.arg(page_limit)::int;

-- name: ListNoteAncestors :many
with recursive up as (
  select n.* from notes n where n.id = sqlc.arg(note_id)::bigint
  union all
  select parent.* from notes parent join up on up.reply_to_id = parent.id
)
select sqlc.embed(n), sqlc.embed(u)
from up n join users u on u.id = n.author_id
where n.id <> sqlc.arg(note_id)::bigint
order by n.created_at;

-- name: ListBookmarkedNotes :many
select sqlc.embed(n), sqlc.embed(u), b.created_at as bookmarked_at
from note_bookmarks b
join notes n on n.id = b.note_id
join users u on u.id = n.author_id
where b.user_id = sqlc.arg(user_id)::bigint
  and n.deleted_at is null and n.killed_at is null
  and (sqlc.narg(cursor_created)::timestamptz is null
       or (b.created_at, n.id) < (sqlc.narg(cursor_created)::timestamptz, sqlc.narg(cursor_id)::bigint))
order by b.created_at desc, n.id desc
limit sqlc.arg(page_limit)::int;

-- name: ListNotesByIDs :many
select sqlc.embed(n), sqlc.embed(u)
from notes n join users u on u.id = n.author_id
where n.id = any($1::bigint[]) and n.deleted_at is null;

-- name: CountAuthorNotesSince :one
select count(*)::int as count from notes
where author_id = $1 and created_at > $2 and deleted_at is null;

-- name: CanReplyToNote :one
select case n.reply_policy
         when 'everyone'  then true
         when 'following' then exists (select 1 from follows f
                                       where f.follower_id = n.author_id
                                         and f.followee_id = sqlc.arg(viewer_id)::bigint)
         when 'mentioned' then position('@' || lower(v.username) in lower(n.body_md)) > 0
                               or n.author_id = sqlc.arg(viewer_id)::bigint
       end as allowed
from notes n, users v
where n.id = sqlc.arg(note_id)::bigint and v.id = sqlc.arg(viewer_id)::bigint;
