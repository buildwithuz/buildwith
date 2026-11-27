-- name: CreateMedia :one
insert into media (owner_id, sha256, kind, mime, width, height, bytes)
values ($1, $2, $3, $4, $5, $6, $7)
on conflict (sha256, kind) do update set owner_id = coalesce(media.owner_id, excluded.owner_id)
returning *;

-- name: GetMedia :one
select * from media where id = $1;

-- name: ListMediaByIDs :many
select * from media where id = any(sqlc.arg(ids)::bigint[]);

-- name: CountUserUploadsToday :one
select count(*)::int as count from media
where owner_id = $1 and created_at > now() - interval '24 hours';
