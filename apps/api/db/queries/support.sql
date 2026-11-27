-- name: RecordSupportMessage :exec
insert into support_messages (group_message_id, user_chat_id, user_id) values ($1, $2, $3)
on conflict (group_message_id) do nothing;

-- name: SupportSender :one
select user_chat_id from support_messages where group_message_id = $1;

-- name: PruneSupportMessages :execrows
delete from support_messages where created_at < now() - interval '180 days';
