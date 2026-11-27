-- name: CastVote :exec
insert into votes (subject_type, subject_id, user_id, value) values ($1, $2, $3, $4)
on conflict (subject_type, subject_id, user_id) do update set value = excluded.value;

-- name: ClearVote :execrows
delete from votes where subject_type = $1 and subject_id = $2 and user_id = $3;

-- name: GetVote :one
select value from votes where subject_type = $1 and subject_id = $2 and user_id = $3;

-- name: ListVotesForSubjects :many
select subject_id, value from votes
where subject_type = sqlc.arg(subject_type)::text and subject_id = any(sqlc.arg(ids)::bigint[])
  and user_id = sqlc.arg(user_id)::bigint;

-- name: AddFlag :execrows
insert into flags (subject_type, subject_id, user_id) values ($1, $2, $3) on conflict do nothing;

-- name: RemoveFlag :execrows
delete from flags where subject_type = $1 and subject_id = $2 and user_id = $3;

-- A flag counts as trusted when the flagger has enough karma to be believed.
-- name: CountTrustedFlags :one
select count(*)::int as count from flags f
join users u on u.id = f.user_id
where f.subject_type = $1 and f.subject_id = $2 and u.karma >= sqlc.arg(min_karma)::int;

-- Karma is recomputed from scratch so it can never drift.
-- name: RecomputeKarma :one
update users set karma = greatest(0, (
    coalesce((select sum(v.value) from votes v
              join links l on l.id = v.subject_id
              where v.subject_type = 'link' and l.author_id = users.id and l.deleted_at is null), 0)
  + coalesce((select sum(v.value) from votes v
              join articles a on a.id = v.subject_id
              where v.subject_type = 'article' and a.author_id = users.id and a.deleted_at is null), 0)
  + coalesce((select sum(v.value) from votes v
              join comments c on c.id = v.subject_id
              where v.subject_type = 'comment' and c.author_id = users.id and c.deleted_at is null), 0)
  + coalesce((select count(*) / 5 from note_likes nl
              join notes n on n.id = nl.note_id
              where n.author_id = users.id and n.deleted_at is null), 0)
)::int)
where users.id = sqlc.arg(user_id)::bigint
returning karma;

-- Everything a vote or flag needs to know about its target, in one round trip.
-- name: GetVoteTarget :one
select
  coalesce(case sqlc.arg(subject_type)::text
    when 'link'    then (select author_id from links    where id = sqlc.arg(subject_id)::bigint and deleted_at is null)
    when 'article' then (select author_id from articles where id = sqlc.arg(subject_id)::bigint and deleted_at is null
                                                          and status = 'published')
    when 'comment' then (select author_id from comments where id = sqlc.arg(subject_id)::bigint and deleted_at is null)
    when 'note'    then (select author_id from notes    where id = sqlc.arg(subject_id)::bigint and deleted_at is null)
  end, 0)::bigint as author_id,
  coalesce(case sqlc.arg(subject_type)::text
    when 'link'    then (select points from links    where id = sqlc.arg(subject_id)::bigint)
    when 'article' then (select points from articles where id = sqlc.arg(subject_id)::bigint)
    when 'comment' then (select points from comments where id = sqlc.arg(subject_id)::bigint)
  end, 0)::int as points;
