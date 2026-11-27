-- name: Follow :execrows
insert into follows (follower_id, followee_id) values ($1, $2)
on conflict do nothing;

-- name: Unfollow :execrows
delete from follows where follower_id = $1 and followee_id = $2;

-- name: IsFollowing :one
select exists (select 1 from follows where follower_id = $1 and followee_id = $2) as following;

-- name: FollowingForUsers :many
select followee_id from follows
where follower_id = sqlc.arg(user_id)::bigint and followee_id = any(sqlc.arg(ids)::bigint[]);

-- name: ListFollowers :many
select sqlc.embed(u), f.created_at from follows f
join users u on u.id = f.follower_id
where f.followee_id = @user_id::bigint and u.deleted_at is null
  and not bw_hidden(sqlc.narg(viewer_id)::bigint, u.id)
  and (sqlc.narg(cursor)::timestamptz is null or f.created_at < sqlc.narg(cursor)::timestamptz)
order by f.created_at desc
limit sqlc.arg(page_limit)::int;

-- name: ListFollowing :many
select sqlc.embed(u), f.created_at from follows f
join users u on u.id = f.followee_id
where f.follower_id = @user_id::bigint and u.deleted_at is null
  and not bw_hidden(sqlc.narg(viewer_id)::bigint, u.id)
  and (sqlc.narg(cursor)::timestamptz is null or f.created_at < sqlc.narg(cursor)::timestamptz)
order by f.created_at desc
limit sqlc.arg(page_limit)::int;

-- Suggestions: people followed by the people you follow, that you do not follow yet.
-- name: WhoToFollow :many
select sqlc.embed(u), count(*)::int as mutuals
from follows mine
join follows theirs on theirs.follower_id = mine.followee_id
join users u on u.id = theirs.followee_id
where mine.follower_id = @viewer_id::bigint
  and u.id <> @viewer_id::bigint
  and u.deleted_at is null and u.banned_at is null
  and not exists (select 1 from follows f where f.follower_id = @viewer_id::bigint and f.followee_id = u.id)
  and not bw_hidden(@viewer_id::bigint, u.id)
group by u.id
order by mutuals desc, u.karma desc
limit sqlc.arg(page_limit)::int;

-- name: FollowTag :execrows
insert into tag_follows (user_id, tag_id) values ($1, $2) on conflict do nothing;

-- name: UnfollowTag :execrows
delete from tag_follows where user_id = $1 and tag_id = $2;

-- name: ListFollowedTags :many
select sqlc.embed(t) from tag_follows tf join tags t on t.id = tf.tag_id
where tf.user_id = $1 order by t.slug;

-- name: IsFollowingTag :one
select exists (select 1 from tag_follows where user_id = $1 and tag_id = $2) as following;

-- name: Block :execrows
insert into blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing;

-- name: Unblock :execrows
delete from blocks where blocker_id = $1 and blocked_id = $2;

-- name: ListBlocked :many
select sqlc.embed(u) from blocks b join users u on u.id = b.blocked_id
where b.blocker_id = $1 order by b.created_at desc;

-- name: Mute :execrows
insert into mutes (muter_id, muted_id) values ($1, $2) on conflict do nothing;

-- name: Unmute :execrows
delete from mutes where muter_id = $1 and muted_id = $2;

-- name: ListMuted :many
select sqlc.embed(u) from mutes m join users u on u.id = m.muted_id
where m.muter_id = $1 order by m.created_at desc;

-- name: AddMutedWord :exec
insert into muted_words (user_id, word) values ($1, $2) on conflict do nothing;

-- name: RemoveMutedWord :execrows
delete from muted_words where user_id = $1 and id = $2;

-- name: ListMutedWords :many
select * from muted_words where user_id = $1 order by word;

-- name: IsBlocked :one
select bw_blocked(sqlc.arg(a)::bigint, sqlc.arg(b)::bigint) as blocked;

-- name: RelationTo :one
select
  exists (select 1 from follows where follower_id = @viewer_id::bigint and followee_id = @other_id::bigint) as following,
  exists (select 1 from follows where follower_id = @other_id::bigint and followee_id = @viewer_id::bigint) as followed_by,
  exists (select 1 from blocks  where blocker_id  = @viewer_id::bigint and blocked_id  = @other_id::bigint) as blocking,
  exists (select 1 from mutes   where muter_id    = @viewer_id::bigint and muted_id    = @other_id::bigint) as muting;

-- A block also ends any follow in either direction.
-- name: RemoveFollowsBetween :exec
delete from follows
where (follower_id = sqlc.arg(a)::bigint and followee_id = sqlc.arg(b)::bigint)
   or (follower_id = sqlc.arg(b)::bigint and followee_id = sqlc.arg(a)::bigint);
