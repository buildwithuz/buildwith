-- A notification is never created for yourself, for someone who blocked you, or
-- for someone who muted you.
-- name: CreateNotification :execrows
insert into notifications (user_id, kind, actor_id, subject_type, subject_id)
select sqlc.arg(user_id)::bigint, sqlc.arg(kind)::text, sqlc.narg(actor_id)::bigint,
       sqlc.arg(subject_type)::text, sqlc.narg(subject_id)::bigint
where sqlc.arg(user_id)::bigint is distinct from sqlc.narg(actor_id)::bigint
  and not bw_hidden(sqlc.arg(user_id)::bigint, coalesce(sqlc.narg(actor_id)::bigint, 0))
  and not bw_blocked(sqlc.arg(user_id)::bigint, coalesce(sqlc.narg(actor_id)::bigint, 0));

-- name: ListNotifications :many
select sqlc.embed(n), a.id as actor_id_out, a.username as actor_username,
       a.display_name as actor_display_name, a.avatar_media as actor_avatar
from notifications n
left join users a on a.id = n.actor_id
where n.user_id = sqlc.arg(user_id)::bigint
  and (sqlc.narg(cursor_created)::timestamptz is null
       or (n.created_at, n.id) < (sqlc.narg(cursor_created)::timestamptz, sqlc.narg(cursor_id)::bigint))
order by n.created_at desc, n.id desc
limit sqlc.arg(page_limit)::int;

-- name: CountUnreadNotifications :one
select count(*)::int as count from notifications where user_id = $1 and read_at is null;

-- name: MarkNotificationsRead :execrows
update notifications set read_at = now() where user_id = $1 and read_at is null;

-- name: MarkNotificationRead :execrows
update notifications set read_at = now() where id = $1 and user_id = $2 and read_at is null;

-- name: ListTelegramRecipients :many
select t.chat_id, u.lang, u.script from telegram_accounts t
join users u on u.id = t.user_id
where t.user_id = any($1::bigint[]) and t.notify;

-- name: ListAllTelegramRecipients :many
select t.chat_id, u.lang, u.script from telegram_accounts t
join users u on u.id = t.user_id
where t.notify and u.deleted_at is null;
