-- Chronological Following timeline: everything from the people and tags you follow.
-- Fan-out on read, keyset paginated on (created_at, id) across all three kinds.
-- name: ListTimeline :many
with followed as (
  select followee_id as id from follows where follower_id = sqlc.arg(viewer_id)::bigint
  union all
  select sqlc.arg(viewer_id)::bigint
),
followed_tags as (
  select tag_id from tag_follows where user_id = sqlc.arg(viewer_id)::bigint
),
items as (
  select 'note'::text as kind, n.id, n.author_id, n.created_at
  from notes n
  where n.deleted_at is null and n.killed_at is null and n.reply_to_id is null
    and n.author_id in (select id from followed)
    and not bw_word_muted(sqlc.arg(viewer_id)::bigint, n.body_md)

  union all
  select 'link', l.id, l.author_id, l.created_at
  from links l
  where l.deleted_at is null and l.killed_at is null
    and (l.author_id in (select id from followed)
         or exists (select 1 from link_tags lt
                    where lt.link_id = l.id and lt.tag_id in (select tag_id from followed_tags)))
    and not bw_word_muted(sqlc.arg(viewer_id)::bigint, l.title || ' ' || l.body_md)

  union all
  select 'article', a.id, a.author_id, a.published_at
  from articles a
  where a.status = 'published' and a.deleted_at is null and a.killed_at is null
    and (a.author_id in (select id from followed)
         or exists (select 1 from article_tags at
                    where at.article_id = a.id and at.tag_id in (select tag_id from followed_tags)))
    and not bw_word_muted(sqlc.arg(viewer_id)::bigint, a.title || ' ' || a.subtitle)
)
select kind, id, created_at from items
where not bw_hidden(sqlc.arg(viewer_id)::bigint, author_id)
  and (sqlc.narg(cursor_created)::timestamptz is null
       or (created_at, id) < (sqlc.narg(cursor_created)::timestamptz, sqlc.narg(cursor_id)::bigint))
order by created_at desc, id desc
limit sqlc.arg(page_limit)::int;

-- How many timeline items are newer than what the reader has seen, for the "N new" pill.
-- name: CountTimelineSince :one
with followed as (
  select followee_id as id from follows where follower_id = sqlc.arg(viewer_id)::bigint
),
followed_tags as (
  select tag_id from tag_follows where user_id = sqlc.arg(viewer_id)::bigint
)
select (
    (select count(*) from notes n
     where n.created_at > sqlc.arg(since)::timestamptz and n.deleted_at is null and n.killed_at is null
       and n.reply_to_id is null and n.author_id in (select id from followed)
       and not bw_hidden(sqlc.arg(viewer_id)::bigint, n.author_id))
  + (select count(*) from links l
     where l.created_at > sqlc.arg(since)::timestamptz and l.deleted_at is null and l.killed_at is null
       and (l.author_id in (select id from followed)
            or exists (select 1 from link_tags lt
                       where lt.link_id = l.id and lt.tag_id in (select tag_id from followed_tags)))
       and not bw_hidden(sqlc.arg(viewer_id)::bigint, l.author_id))
  + (select count(*) from articles a
     where a.published_at > sqlc.arg(since)::timestamptz and a.status = 'published'
       and a.deleted_at is null and a.killed_at is null
       and (a.author_id in (select id from followed)
            or exists (select 1 from article_tags at
                       where at.article_id = a.id and at.tag_id in (select tag_id from followed_tags)))
       and not bw_hidden(sqlc.arg(viewer_id)::bigint, a.author_id))
)::int as count;
