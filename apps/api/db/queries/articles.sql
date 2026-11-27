-- name: CreateArticle :one
insert into articles (author_id, slug, title) values ($1, $2, $3) returning *;

-- name: GetArticle :one
select sqlc.embed(a), sqlc.embed(u)
from articles a join users u on u.id = a.author_id
where a.id = $1 and a.deleted_at is null;

-- name: GetArticleBySlug :one
select sqlc.embed(a), sqlc.embed(u)
from articles a join users u on u.id = a.author_id
where u.username_lower = lower(sqlc.arg(username)::text)
  and a.slug = sqlc.arg(slug)::text and a.deleted_at is null;

-- name: SaveArticleDraft :one
update articles set
  title = $2, subtitle = $3, body_md = $4, body_html = $5, toc = $6, lang = $7,
  canonical_url = $8, cover_media = $9, series_id = $10, series_sort = $11,
  reading_minutes = $12, slug = $13, updated_at = now()
where id = $1 and deleted_at is null
returning *;

-- name: PublishArticle :one
update articles set status = 'published', published_at = coalesce(published_at, now()),
  scheduled_at = null, updated_at = now()
where id = $1 and deleted_at is null
returning *;

-- name: ScheduleArticle :one
update articles set status = 'scheduled', scheduled_at = $2, updated_at = now()
where id = $1 and deleted_at is null
returning *;

-- name: UnpublishArticle :one
update articles set status = 'draft', scheduled_at = null, updated_at = now()
where id = $1 and deleted_at is null
returning *;

-- name: SoftDeleteArticle :execrows
update articles set deleted_at = now() where id = $1 and deleted_at is null;

-- name: KillArticle :exec
update articles set killed_at = case when sqlc.arg(enabled)::boolean then now() else null end
where id = sqlc.arg(id)::bigint;

-- name: FeatureArticle :exec
update articles set featured_at = case when sqlc.arg(enabled)::boolean then now() else null end
where id = sqlc.arg(id)::bigint;

-- name: SetArticleScore :exec
update articles set score = $2 where id = $1;

-- name: SlugTakenByAuthor :one
select exists (
  select 1 from articles where author_id = $1 and slug = $2 and id <> sqlc.arg(except_id)::bigint
) as taken;

-- name: AddArticleTag :exec
insert into article_tags (article_id, tag_id) values ($1, $2) on conflict do nothing;

-- name: ClearArticleTags :exec
delete from article_tags where article_id = $1;

-- name: SaveArticleVersion :exec
insert into article_versions (article_id, n, title, body_md)
values ($1, coalesce((select max(n) from article_versions where article_id = $1), 0) + 1, $2, $3);

-- name: ListArticleVersions :many
select id, article_id, n, title, created_at from article_versions
where article_id = $1 order by n desc limit 20;

-- name: GetArticleVersion :one
select * from article_versions where article_id = $1 and n = $2;

-- name: TrimArticleVersions :execrows
delete from article_versions v where v.article_id = sqlc.arg(article_id)::bigint
  and v.n <= (select max(v2.n) - sqlc.arg(keep)::int from article_versions v2
              where v2.article_id = sqlc.arg(article_id)::bigint);

-- Published articles, newest first. Keyset cursor is (published_at, id).
-- name: ListArticlesByPublished :many
select sqlc.embed(a), sqlc.embed(u)
from articles a
join users u on u.id = a.author_id
where a.status = 'published' and a.deleted_at is null and a.killed_at is null
  and (sqlc.narg(author_id)::bigint is null or a.author_id = sqlc.narg(author_id)::bigint)
  and (sqlc.narg(series_id)::bigint is null or a.series_id = sqlc.narg(series_id)::bigint)
  and (sqlc.narg(featured)::boolean is not true or a.featured_at is not null)
  and (sqlc.narg(tag_id)::bigint is null
       or exists (select 1 from article_tags at
                  where at.article_id = a.id and at.tag_id = sqlc.narg(tag_id)::bigint))
  and not bw_hidden(sqlc.narg(viewer_id)::bigint, a.author_id)
  and not bw_word_muted(sqlc.narg(viewer_id)::bigint, a.title || ' ' || a.subtitle)
  and (sqlc.narg(cursor_published)::timestamptz is null
       or (a.published_at, a.id) < (sqlc.narg(cursor_published)::timestamptz, sqlc.narg(cursor_id)::bigint))
order by a.published_at desc, a.id desc
limit sqlc.arg(page_limit)::int;

-- Popular articles. Keyset cursor is (score, id).
-- name: ListArticlesByScore :many
select sqlc.embed(a), sqlc.embed(u)
from articles a
join users u on u.id = a.author_id
where a.status = 'published' and a.deleted_at is null and a.killed_at is null
  and (sqlc.narg(tag_id)::bigint is null
       or exists (select 1 from article_tags at
                  where at.article_id = a.id and at.tag_id = sqlc.narg(tag_id)::bigint))
  and (sqlc.narg(since)::timestamptz is null or a.published_at > sqlc.narg(since)::timestamptz)
  and not bw_hidden(sqlc.narg(viewer_id)::bigint, a.author_id)
  and not bw_word_muted(sqlc.narg(viewer_id)::bigint, a.title || ' ' || a.subtitle)
  and (sqlc.narg(cursor_score)::float8 is null
       or (a.score, a.id) < (sqlc.narg(cursor_score)::float8, sqlc.narg(cursor_id)::bigint))
order by a.score desc, a.id desc
limit sqlc.arg(page_limit)::int;

-- The author's own list, drafts included.
-- name: ListArticlesByAuthorAll :many
select sqlc.embed(a), sqlc.embed(u)
from articles a join users u on u.id = a.author_id
where a.author_id = sqlc.arg(author_id)::bigint and a.deleted_at is null
  and (sqlc.narg(status)::text is null or a.status = sqlc.narg(status)::text)
order by a.updated_at desc
limit sqlc.arg(page_limit)::int;

-- name: ListArticlesByIDs :many
select sqlc.embed(a), sqlc.embed(u)
from articles a join users u on u.id = a.author_id
where a.id = any(sqlc.arg(ids)::bigint[]) and a.deleted_at is null
  and a.status = 'published'
  and not bw_hidden(sqlc.narg(viewer_id)::bigint, a.author_id);

-- name: ListDueScheduledArticles :many
select id, author_id from articles
where status = 'scheduled' and scheduled_at <= now() and deleted_at is null
limit 100;

-- name: ListArticleRankCandidates :many
select a.id, a.points, a.comment_count, a.flag_count, a.published_at,
       (u.created_at > a.published_at - interval '7 days') as author_is_new
from articles a
join users u on u.id = a.author_id
where a.status = 'published' and a.published_at > now() - interval '7 days'
  and a.deleted_at is null and a.killed_at is null;

-- name: CountAuthorArticlesSince :one
select count(*)::int as count from articles
where author_id = $1 and created_at > $2 and deleted_at is null;

-- name: CreateSeries :one
insert into series (author_id, slug, title, description) values ($1, $2, $3, $4) returning *;

-- name: GetSeries :one
select * from series where id = $1;

-- name: GetSeriesBySlug :one
select s.* from series s join users u on u.id = s.author_id
where u.username_lower = lower(sqlc.arg(username)::text) and s.slug = sqlc.arg(slug)::text;

-- name: ListSeriesByAuthor :many
select * from series where author_id = $1 order by created_at desc;

-- name: UpdateSeries :one
update series set title = $2, description = $3 where id = $1 returning *;

-- name: DeleteSeries :execrows
delete from series where id = $1 and author_id = $2;
