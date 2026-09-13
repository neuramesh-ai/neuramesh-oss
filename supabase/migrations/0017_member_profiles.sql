-- People are addressable teammates, not anonymous "member" rows: a display
-- name on membership, defaulted from the auth email local-part.
alter table workspace_members add column display_name text;
update workspace_members m set display_name = split_part(u.email, '@', 1)
  from auth.users u where u.id = m.user_id and m.display_name is null and u.email is not null;
