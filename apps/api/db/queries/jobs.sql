-- name: EnqueueJob :exec
insert into jobs (kind, payload, run_at) values ($1, $2, $3)
on conflict do nothing;

-- Claim a batch of due jobs. SKIP LOCKED lets several workers run side by side.
-- name: ClaimJobs :many
update jobs set locked_at = now(), locked_by = sqlc.arg(worker)::text, attempts = attempts + 1
where id in (
  select id from jobs
  where locked_at is null and run_at <= now()
  order by run_at
  limit sqlc.arg(batch)::int
  for update skip locked
)
returning *;

-- name: FinishJob :exec
delete from jobs where id = $1;

-- name: FailJob :exec
update jobs set locked_at = null, locked_by = '', last_error = $2,
  run_at = now() + make_interval(secs => least(600, power(3, attempts)::int))
where id = $1;

-- name: ReleaseStaleJobs :execrows
update jobs set locked_at = null, locked_by = ''
where locked_at < now() - interval '10 minutes';

-- name: DropExhaustedJobs :execrows
delete from jobs where attempts >= sqlc.arg(max_attempts)::int and locked_at is null;

-- Fixed-window rate limiting: one row per key and window.
-- name: BumpRateCounter :one
insert into rate_counters (key, window_start, count)
values (sqlc.arg(key)::text, sqlc.arg(window_start)::timestamptz, 1)
on conflict (key, window_start) do update set count = rate_counters.count + 1
returning count;

-- name: PeekRateCounter :one
select coalesce(
  (select count from rate_counters where key = $1 and window_start = $2), 0
)::int as count;

-- name: PruneRateCounters :execrows
delete from rate_counters where window_start < now() - interval '2 days';
