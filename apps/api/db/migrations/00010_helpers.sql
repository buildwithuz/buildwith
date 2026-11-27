-- +goose Up

-- ---------------------------------------------------------------------------
-- Visibility. Every query that lists user content calls bw_hidden so the rule
-- lives in exactly one place: a block in either direction hides the content,
-- and a mute hides it one way.
-- ---------------------------------------------------------------------------

-- +goose StatementBegin
create function bw_hidden(viewer bigint, author bigint) returns boolean
language sql stable parallel safe as $$
  select viewer is not null and viewer <> author and (
    exists (
      select 1 from blocks
      where (blocker_id = viewer and blocked_id = author)
         or (blocker_id = author and blocked_id = viewer)
    )
    or exists (select 1 from mutes where muter_id = viewer and muted_id = author)
  );
$$;
-- +goose StatementEnd

-- +goose StatementBegin
create function bw_word_muted(viewer bigint, body text) returns boolean
language sql stable parallel safe as $$
  select viewer is not null and exists (
    select 1 from muted_words
    where user_id = viewer and position(lower(word) in lower(body)) > 0
  );
$$;
-- +goose StatementEnd

-- A block in either direction also forbids interaction (reply, follow, like).
-- +goose StatementBegin
create function bw_blocked(a bigint, b bigint) returns boolean
language sql stable parallel safe as $$
  select exists (
    select 1 from blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;
-- +goose StatementEnd

-- ---------------------------------------------------------------------------
-- Comment threading: path is "<padded root id>.<padded child id>..." so a
-- single ORDER BY path renders a correctly nested thread.
-- ---------------------------------------------------------------------------

-- +goose StatementBegin
create function bw_comments_set_path() returns trigger
language plpgsql as $$
declare parent_path text;
begin
  if new.parent_id is null then
    new.path := lpad(new.id::text, 12, '0');
    new.depth := 0;
  else
    select path, depth + 1 into parent_path, new.depth from comments where id = new.parent_id;
    new.path := parent_path || '.' || lpad(new.id::text, 12, '0');
  end if;
  return new;
end;
$$;
-- +goose StatementEnd

create trigger comments_set_path before insert on comments
  for each row execute function bw_comments_set_path();

-- ---------------------------------------------------------------------------
-- Counter bookkeeping. Kept in the database so no handler can forget it.
-- ---------------------------------------------------------------------------

-- +goose StatementBegin
create function bw_comments_count() returns trigger
language plpgsql as $$
declare d integer;
begin
  -- A comment counts while it is neither deleted nor killed.
  if tg_op = 'INSERT' then
    d := case when new.deleted_at is null and new.killed_at is null then 1 else 0 end;
  elsif tg_op = 'DELETE' then
    d := case when old.deleted_at is null and old.killed_at is null then -1 else 0 end;
  else
    d := (case when new.deleted_at is null and new.killed_at is null then 1 else 0 end)
       - (case when old.deleted_at is null and old.killed_at is null then 1 else 0 end);
  end if;
  if d = 0 then return null; end if;

  if coalesce(new.subject_type, old.subject_type) = 'link' then
    update links set comment_count = comment_count + d where id = coalesce(new.subject_id, old.subject_id);
  else
    update articles set comment_count = comment_count + d where id = coalesce(new.subject_id, old.subject_id);
  end if;
  return null;
end;
$$;
-- +goose StatementEnd

create trigger comments_count after insert or delete or update of deleted_at, killed_at on comments
  for each row execute function bw_comments_count();

-- +goose StatementBegin
create function bw_votes_points() returns trigger
language plpgsql as $$
declare d integer; st text; sid bigint;
begin
  if tg_op = 'INSERT' then d := new.value; st := new.subject_type; sid := new.subject_id;
  elsif tg_op = 'DELETE' then d := -old.value; st := old.subject_type; sid := old.subject_id;
  else d := new.value - old.value; st := new.subject_type; sid := new.subject_id;
  end if;
  if d = 0 then return null; end if;

  case st
    when 'link'    then update links    set points = points + d where id = sid;
    when 'article' then update articles set points = points + d where id = sid;
    when 'comment' then update comments set points = points + d where id = sid;
  end case;
  return null;
end;
$$;
-- +goose StatementEnd

create trigger votes_points after insert or delete or update of value on votes
  for each row execute function bw_votes_points();

-- +goose StatementBegin
create function bw_flags_count() returns trigger
language plpgsql as $$
declare d integer; st text; sid bigint;
begin
  if tg_op = 'INSERT' then d := 1; st := new.subject_type; sid := new.subject_id;
  else d := -1; st := old.subject_type; sid := old.subject_id;
  end if;

  case st
    when 'link'    then update links    set flag_count = flag_count + d where id = sid;
    when 'article' then update articles set flag_count = flag_count + d where id = sid;
    when 'comment' then update comments set flag_count = flag_count + d where id = sid;
    when 'note'    then update notes    set flag_count = flag_count + d where id = sid;
  end case;
  return null;
end;
$$;
-- +goose StatementEnd

create trigger flags_count after insert or delete on flags
  for each row execute function bw_flags_count();

-- +goose StatementBegin
create function bw_note_likes_count() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update notes set like_count = like_count + 1 where id = new.note_id;
  else
    update notes set like_count = greatest(like_count - 1, 0) where id = old.note_id;
  end if;
  return null;
end;
$$;
-- +goose StatementEnd

create trigger note_likes_count after insert or delete on note_likes
  for each row execute function bw_note_likes_count();

-- +goose StatementBegin
create function bw_notes_relations() returns trigger
language plpgsql as $$
declare d integer;
begin
  if tg_op = 'INSERT' then
    d := case when new.deleted_at is null then 1 else 0 end;
  elsif tg_op = 'DELETE' then
    d := case when old.deleted_at is null then -1 else 0 end;
  else
    d := (case when new.deleted_at is null then 1 else 0 end)
       - (case when old.deleted_at is null then 1 else 0 end);
  end if;
  if d = 0 then return null; end if;

  if coalesce(new.reply_to_id, old.reply_to_id) is not null then
    update notes set reply_count = reply_count + d where id = coalesce(new.reply_to_id, old.reply_to_id);
  end if;
  if coalesce(new.repost_of_id, old.repost_of_id) is not null then
    update notes set repost_count = repost_count + d where id = coalesce(new.repost_of_id, old.repost_of_id);
  end if;
  if coalesce(new.quote_of_id, old.quote_of_id) is not null then
    update notes set quote_count = quote_count + d where id = coalesce(new.quote_of_id, old.quote_of_id);
  end if;
  return null;
end;
$$;
-- +goose StatementEnd

create trigger notes_relations after insert or delete or update of deleted_at on notes
  for each row execute function bw_notes_relations();

-- +goose StatementBegin
create function bw_tag_post_count() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update tags set post_count = post_count + 1 where id = new.tag_id;
  else
    update tags set post_count = greatest(post_count - 1, 0) where id = old.tag_id;
  end if;
  return null;
end;
$$;
-- +goose StatementEnd

create trigger link_tags_count after insert or delete on link_tags
  for each row execute function bw_tag_post_count();
create trigger article_tags_count after insert or delete on article_tags
  for each row execute function bw_tag_post_count();

-- +goose StatementBegin
create function bw_touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
-- +goose StatementEnd

create trigger users_touch before update on users for each row execute function bw_touch_updated_at();

-- +goose Down
drop trigger users_touch on users;
drop trigger article_tags_count on article_tags;
drop trigger link_tags_count on link_tags;
drop trigger notes_relations on notes;
drop trigger note_likes_count on note_likes;
drop trigger flags_count on flags;
drop trigger votes_points on votes;
drop trigger comments_count on comments;
drop trigger comments_set_path on comments;
drop function bw_touch_updated_at;
drop function bw_tag_post_count;
drop function bw_notes_relations;
drop function bw_note_likes_count;
drop function bw_flags_count;
drop function bw_votes_points;
drop function bw_comments_count;
drop function bw_comments_set_path;
drop function bw_blocked;
drop function bw_word_muted;
drop function bw_hidden;
