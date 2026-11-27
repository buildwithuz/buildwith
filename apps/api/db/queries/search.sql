-- Full-text search over everything, on the `simple` config so Uzbek, Russian and
-- English all behave the same. Queries arrive already normalized by translit.ForSearch.
-- name: SearchAll :many
select kind, id, created_at, rank from (
  select 'link'::text as kind, l.id, l.created_at,
         ts_rank(l.search, websearch_to_tsquery('simple', sqlc.arg(q)::text)) as rank
  from links l
  where l.search @@ websearch_to_tsquery('simple', sqlc.arg(q)::text)
    and l.deleted_at is null and l.killed_at is null
    and not bw_hidden(sqlc.narg(viewer_id)::bigint, l.author_id)

  union all
  select 'article', a.id, a.published_at,
         ts_rank(a.search, websearch_to_tsquery('simple', sqlc.arg(q)::text))
  from articles a
  where a.search @@ websearch_to_tsquery('simple', sqlc.arg(q)::text)
    and a.status = 'published' and a.deleted_at is null and a.killed_at is null
    and not bw_hidden(sqlc.narg(viewer_id)::bigint, a.author_id)

  union all
  select 'note', n.id, n.created_at,
         ts_rank(n.search, websearch_to_tsquery('simple', sqlc.arg(q)::text))
  from notes n
  where n.search @@ websearch_to_tsquery('simple', sqlc.arg(q)::text)
    and n.deleted_at is null and n.killed_at is null
    and not bw_hidden(sqlc.narg(viewer_id)::bigint, n.author_id)

  union all
  select 'comment', c.id, c.created_at,
         ts_rank(c.search, websearch_to_tsquery('simple', sqlc.arg(q)::text))
  from comments c
  where c.search @@ websearch_to_tsquery('simple', sqlc.arg(q)::text)
    and c.deleted_at is null and c.killed_at is null
    and not bw_hidden(sqlc.narg(viewer_id)::bigint, c.author_id)
) hits
where (sqlc.narg(kind)::text is null or kind = sqlc.narg(kind)::text)
order by rank desc, created_at desc
limit sqlc.arg(page_limit)::int offset sqlc.arg(page_offset)::int;

-- name: SearchUsers :many
select * from users
where deleted_at is null and banned_at is null
  and (username_lower like sqlc.arg(q)::text || '%'
       or lower(display_name) like '%' || sqlc.arg(q)::text || '%')
order by karma desc, username
limit sqlc.arg(page_limit)::int;
