-- The reply queue (docs/design/models-and-replies-2026-10/plan.md §2). Since February 2026 X lets an
-- app reply only to a post whose author mentions it, so NeuraMesh posts no reply: it paces them. A row
-- is one reply a person queued off a reply card (a ```nmreply message): its time, the link its reminder
-- opens (X's reply box with the text in it, or the post), and what the person did. The minute cron
-- (/internal/publish-due) sends the reminder once and marks the row due; the person's own commands
-- (reply.queue · reply.mark · reply.clear) write the rest. A routine whose Replies part names a gap
-- gets its run's card queued by the server, for the routine's owner. New synced table: it also joins
-- the powersync publication (0147_publish_reply_reminders.sql, prod; 99-publication.sql, dev + CI).
create table reply_reminders (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  thread_id    uuid references threads (id) on delete cascade,
  message_id   uuid not null references messages (id) on delete cascade,  -- the reply card
  member_id    uuid not null,                                              -- who is reminded (nm_users)
  letter       text not null,                                              -- the card's row
  platform     text not null default 'x',
  handle       text not null default '',
  draft        text not null,
  open_url     text not null,                                              -- what the reminder opens
  due_at       timestamptz not null,
  state        text not null default 'queued' check (state in ('queued', 'due', 'opened', 'posted', 'skipped')),
  notified_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (message_id, member_id, letter)
);
-- the cron's read: queued rows whose time has come
create index reply_reminders_due on reply_reminders (due_at) where state = 'queued' and notified_at is null;
create index reply_reminders_ws on reply_reminders (workspace_id, created_at desc);
comment on table reply_reminders is
  'one queued reply per row (the reply queue): the person posts it in X, NeuraMesh only reminds them at its time';
-- RLS on, no policy = deny-all to PostgREST (0100's stance): reads ride the publication, writes ride control-api
alter table reply_reminders enable row level security;
