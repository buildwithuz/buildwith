-- name: UpdateProfile :one
update users set
  display_name = $2, pronouns = $3, bio = $4, role_title = $5, company = $6,
  location = $7, open_to_work = $8, accent = $9
where id = $1 and deleted_at is null
returning *;

-- name: UpdateReadme :exec
update users set readme_md = $2, readme_html = $3 where id = $1 and deleted_at is null;

-- name: UpdatePreferences :one
update users set lang = $2, script = $3, theme = $4 where id = $1 and deleted_at is null returning *;

-- name: UpdateAvatar :exec
update users set avatar_media = $2 where id = $1;

-- name: UpdateBanner :exec
update users set banner_media = $2 where id = $1;

-- name: SetUserEmail :exec
update users set email = $2, email_domain = $3 where id = $1;

-- name: AddKarma :exec
update users set karma = greatest(karma + $2, 0) where id = $1;

-- name: SetUsername :one
update users set username = $2 where id = $1 and deleted_at is null returning *;

-- name: BanUser :exec
update users set banned_at = now(), ban_reason = $2 where id = $1;

-- name: UnbanUser :exec
update users set banned_at = null, ban_reason = '' where id = $1;

-- name: SetModerator :exec
update users set is_moderator = $2 where id = $1;

-- Account deletion anonymizes the row so threads keep their shape, and removes
-- every piece of personal data.
-- name: AnonymizeUser :exec
update users set
  username = 'deleted_' || id::text,
  display_name = '', pronouns = '', bio = '', readme_md = '', readme_html = '',
  role_title = '', company = '', location = '', open_to_work = false,
  avatar_media = null, banner_media = null, email = null, email_domain = null,
  deleted_at = now()
where id = $1;

-- name: ReplaceUserLinks :exec
delete from user_links where user_id = $1;

-- name: AddUserLink :exec
insert into user_links (user_id, kind, url, sort) values ($1, $2, $3, $4);

-- name: ListUserLinks :many
select * from user_links where user_id = $1 order by sort, id;

-- name: ReplaceUserStack :exec
delete from user_stack where user_id = $1;

-- name: AddUserStack :exec
insert into user_stack (user_id, name, sort) values ($1, $2, $3)
on conflict (user_id, lower(name)) do nothing;

-- name: ListUserStack :many
select * from user_stack where user_id = $1 order by sort, id;

-- name: ReplaceUserRepos :exec
delete from user_repos where user_id = $1;

-- name: AddUserRepo :exec
insert into user_repos (user_id, full_name, description, language, stars, url, sort)
values ($1, $2, $3, $4, $5, $6, $7)
on conflict (user_id, lower(full_name)) do nothing;

-- name: ListUserRepos :many
select * from user_repos where user_id = $1 order by sort, stars desc limit 6;

-- name: GrantBadge :exec
insert into user_badges (user_id, kind, detail) values ($1, $2, $3)
on conflict (user_id, kind) do update set detail = excluded.detail;

-- name: RevokeBadge :exec
delete from user_badges where user_id = $1 and kind = $2;

-- name: ListBadges :many
select * from user_badges where user_id = $1 order by granted_at;

-- name: ListBadgesForUsers :many
select * from user_badges where user_id = any($1::bigint[]) order by user_id, granted_at;

-- name: ListUsersByID :many
select * from users where id = any($1::bigint[]) and deleted_at is null;

-- Twelve-month activity heatmap: one row per day the user posted anything.
-- name: ActivityHeatmap :many
select day::date as day, sum(n)::int as count from (
  select date_trunc('day', created_at) as day, count(*) as n from links
    where author_id = @user_id::bigint and created_at > now() - interval '12 months'
      and deleted_at is null
    group by 1
  union all
  select date_trunc('day', created_at), count(*) from notes
    where author_id = @user_id::bigint and created_at > now() - interval '12 months'
      and deleted_at is null
    group by 1
  union all
  select date_trunc('day', published_at), count(*) from articles
    where author_id = @user_id::bigint and status = 'published'
      and published_at > now() - interval '12 months' and deleted_at is null
    group by 1
  union all
  select date_trunc('day', created_at), count(*) from comments
    where author_id = @user_id::bigint and created_at > now() - interval '12 months'
      and deleted_at is null
    group by 1
) days
group by day order by day;

-- name: CountUserContent :one
select
  (select count(*) from links
     where author_id = @user_id::bigint and deleted_at is null)::int as links,
  (select count(*) from notes
     where author_id = @user_id::bigint and deleted_at is null)::int as notes,
  (select count(*) from articles
     where author_id = @user_id::bigint and deleted_at is null and status = 'published')::int as articles,
  (select count(*) from comments
     where author_id = @user_id::bigint and deleted_at is null)::int as comments,
  (select count(*) from follows where followee_id = @user_id::bigint)::int as followers,
  (select count(*) from follows where follower_id = @user_id::bigint)::int as following;

-- name: ListOpenToWork :many
select * from users
where open_to_work and deleted_at is null and banned_at is null
order by karma desc, id desc
limit $1;

-- name: LinkTelegram :one
insert into telegram_accounts (user_id, chat_id, handle) values ($1, $2, $3)
on conflict (user_id) do update set chat_id = excluded.chat_id, handle = excluded.handle,
  linked_at = now()
returning *;

-- name: UnlinkTelegram :execrows
delete from telegram_accounts where user_id = $1;

-- name: GetTelegramByUser :one
select * from telegram_accounts where user_id = $1;

-- name: GetTelegramByChat :one
select * from telegram_accounts where chat_id = $1;

-- name: SetTelegramNotify :exec
update telegram_accounts set notify = $2 where user_id = $1;
