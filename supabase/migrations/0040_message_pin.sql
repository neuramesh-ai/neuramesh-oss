-- Pinned messages: a human can pin a channel message so it stands out and can be
-- found later. Synced to clients via the messages sync rule (pinned column added there).
alter table messages add column pinned boolean not null default false;
