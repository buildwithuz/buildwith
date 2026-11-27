-- +goose Up

-- The Telegram bot is also the support inbox: a message to the bot is copied
-- into the maintainers' support group, and a reply there goes back to the
-- sender. This maps each copy in the group to the person who wrote it.
create table support_messages (
  group_message_id bigint      primary key,
  user_chat_id     bigint      not null,
  user_id          bigint      references users (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index support_messages_user_chat_idx on support_messages (user_chat_id, created_at desc);

-- +goose Down
drop table support_messages;
