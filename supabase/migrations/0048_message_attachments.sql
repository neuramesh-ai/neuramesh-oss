-- Chat attachments: images/files a human attaches to a chat or thread-reply message
-- for additional context. Modeled as artifacts (so they surface in the channel artifact
-- screen + sync via the existing artifacts publication) linked to their message.
--
-- Bytes: the THUMBNAIL travels inline (inline_content, small) so it is cloud-consistent and
-- visible cross-machine; the FULL file is kept on the local host (userData/attachments/<id>)
-- and served to the UI + local agents via the nm-attachment:// protocol. Full cross-device
-- byte sync (Supabase Storage) is the documented follow-up — same inline-now/Storage-later
-- split the codebase already uses for agent artifacts.
alter table artifacts
  add column message_id uuid references messages (id) on delete cascade,
  add column mime text,
  add column width int,
  add column height int;

-- the per-message + per-channel/thread attachment lookups the desktop watchers run
create index artifacts_message on artifacts (message_id) where message_id is not null;
