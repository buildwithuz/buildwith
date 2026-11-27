-- name: CreateUser :one
insert into users (username, display_name, lang, email, email_domain, avatar_media)
values ($1, $2, $3, $4, $5, $6)
returning *;

-- name: GetUser :one
select * from users where id = $1 and deleted_at is null;

-- name: GetUserByUsername :one
select * from users where username_lower = lower($1) and deleted_at is null;

-- name: UsernameTaken :one
select exists (select 1 from users where username_lower = lower($1)) as taken;

-- name: CreateIdentity :one
insert into user_identities (user_id, provider, subject, handle)
values ($1, $2, $3, $4)
returning *;

-- name: GetUserByIdentity :one
select u.* from users u
join user_identities i on i.user_id = u.id
where i.provider = $1 and i.subject = $2 and u.deleted_at is null;

-- name: ListIdentities :many
select * from user_identities where user_id = $1 order by created_at;

-- name: DeleteIdentity :execrows
delete from user_identities where user_id = $1 and provider = $2;

-- name: CreateSession :one
insert into sessions (token_hash, user_id, csrf_token, user_agent, expires_at)
values ($1, $2, $3, $4, $5)
returning *;

-- name: GetSession :one
select s.token_hash, s.user_id, s.csrf_token, s.expires_at, sqlc.embed(u)
from sessions s
join users u on u.id = s.user_id
where s.token_hash = $1 and s.expires_at > now() and u.deleted_at is null;

-- name: TouchSession :exec
update sessions set last_seen_at = now() where token_hash = $1;

-- name: DeleteSession :exec
delete from sessions where token_hash = $1;

-- name: DeleteUserSessions :exec
delete from sessions where user_id = $1;

-- name: DeleteExpiredSessions :execrows
delete from sessions where expires_at < now();

-- name: CreateOAuthState :exec
insert into oauth_states (state, provider, code_verifier, redirect_to) values ($1, $2, $3, $4);

-- name: TakeOAuthState :one
delete from oauth_states
where state = $1 and created_at > now() - interval '15 minutes'
returning *;

-- name: DeleteExpiredOAuthStates :execrows
delete from oauth_states where created_at < now() - interval '15 minutes';
