-- Thread-level overrides (including explicit Default) and other workspace modes are preserved.
alter table workspaces alter column permission_mode set default 'auto-review';
update workspaces set permission_mode = 'auto-review' where permission_mode = 'default';
