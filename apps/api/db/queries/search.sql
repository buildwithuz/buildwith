-- Full-text search over everything, on the `simple` config so Uzbek, Russian and
-- English all behave the same. The query comes in both scripts (q and q_cyrl) so
-- it matches posts written in either.
-- name: SearchAll :many
select kind, id, created_at, rank from (
  select 'link'::text as kind, l.id, l.created_at,
         ts_rank(bw_tsv(l.title || ' ' || l.domain || ' ' || l.body_md), bw_tsq(sqlc.arg(q)::text, sqlc.arg(q_cyrl)::text)) as rank
  from links l
  where bw_tsv(l.title || ' ' || l.domain || ' ' || l.body_md) @@ bw_tsq(sqlc.arg(q)::text, sqlc.arg(q_cyrl)::text)
    and l.deleted_at is null and l.killed_at is null
    and not bw_hidden(sqlc.narg(viewer_id)::bigint, l.author_id)

  union all
  select 'article', a.id, a.published_at,
         ts_rank(bw_tsv(a.title || ' ' || a.subtitle || ' ' || a.body_md), bw_tsq(sqlc.arg(q)::text, sqlc.arg(q_cyrl)::text))
  from articles a
  where bw_tsv(a.title || ' ' || a.subtitle || ' ' || a.body_md) @@ bw_tsq(sqlc.arg(q)::text, sqlc.arg(q_cyrl)::text)
    and a.status = 'published' and a.deleted_at is null and a.killed_at is null
    and not bw_hidden(sqlc.narg(viewer_id)::bigint, a.author_id)

  union all
  select 'note', n.id, n.created_at,
         ts_rank(bw_tsv(n.body_md), bw_tsq(sqlc.arg(q)::text, sqlc.arg(q_cyrl)::text))
  from notes n
  where bw_tsv(n.body_md) @@ bw_tsq(sqlc.arg(q)::text, sqlc.arg(q_cyrl)::text)
    and n.deleted_at is null and n.killed_at is null
    and not bw_hidden(sqlc.narg(viewer_id)::bigint, n.author_id)

  union all
  select 'comment', c.id, c.created_at,
         ts_rank(bw_tsv(c.body_md), bw_tsq(sqlc.arg(q)::text, sqlc.arg(q_cyrl)::text))
  from comments c
  where bw_tsv(c.body_md) @@ bw_tsq(sqlc.arg(q)::text, sqlc.arg(q_cyrl)::text)
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
