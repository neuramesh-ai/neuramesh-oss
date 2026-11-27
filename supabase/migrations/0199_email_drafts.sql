-- EMAIL DRAFTS IN A SESSION (docs/design/inbox-sales-2026-11/plan.md I8 to I11). An agent drafts emails in a
-- conversation, the person changes them by talk or on the card, and only the person sends, from their own Gmail.
--
-- ONE TABLE, ONE ROW PER EMAIL. A card is the emails one draft call wrote together: they share `card_id` and get a
-- letter each (a, b, c ...), up to 50. A card has no state of its own: its author, thread and time are the same on
-- every email, and "waits for you" is "an email of it is still a draft". So a second table would only be a second
-- synced table, a second trigger and a join on every read, with a card row that could disagree with its emails.
--
-- A revision changes the row in place: the version goes up, and `edited_by_kind` says who wrote the newest text.
-- The agent's next revision must name the version it read (the server refuses an older one), so a person's edit is
-- never lost under an agent's rewrite. `replaced` is an email that a newer card in the same session wrote again for
-- the same address, so one person never gets two drafts that both wait for Send.
--
-- Not `content_items`: that table sits behind the Marketing read boundary (0183, nm_marketing_row returns true for
-- it), so a member without Marketing access would not see their own email drafts. These rows follow their ROOM: a
-- draft in a marketing room is hidden exactly as that room's messages are, and a draft in any other room is not.
--
-- Synced (the card renders from the replica), written only by the control-api (email.draft, email.revise,
-- email.edit, and POST /v1/email/send). The Gmail message id stays on the server: no client reads it.
create table email_drafts (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces (id) on delete cascade,
  channel_id     uuid not null references channels (id) on delete cascade,
  thread_id      uuid not null references threads (id) on delete cascade,
  card_id        uuid not null,
  letter         text not null check (letter ~ '^[a-z]{1,2}$'),
  version        integer not null default 1 check (version >= 1),
  to_name        text not null default '',
  to_email       text not null,
  subject        text not null,
  body           text not null,
  reason         text not null default '',
  status         text not null default 'draft' check (status in ('draft', 'sent', 'replaced')),
  author_kind    text not null check (author_kind in ('agent', 'human')),
  author_id      text not null,
  edited_by_kind text not null check (edited_by_kind in ('agent', 'human')),
  edited_by      text not null,
  -- a send in flight holds the row: sent_by and sent_at are set while status is still 'draft'
  sent_by        uuid,
  sent_from      text,
  sent_at        timestamptz,
  gmail_id       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (card_id, letter)
);
-- the session's card, and the drafts that wait for a person (Inbox's Drafts group, the session's Needs you)
create index email_drafts_thread on email_drafts (thread_id, created_at);
create index email_drafts_waiting on email_drafts (workspace_id, updated_at desc) where status = 'draft';
comment on table email_drafts is
  'one email of a draft card in a session: agents draft, only the person sends it from their own Gmail (plan I8 to I11)';
-- RLS on, no policy = deny-all to PostgREST (0100's stance): reads ride the API replica, writes ride the control-api.
-- The runtime role gets its grant and its nm_control_api policy from scripts/db-runtime.mjs after the migration.
alter table email_drafts enable row level security;

-- the replica's feed: the triggers of 0159 on one more table (0173's shape). The table is new, so its lock comes
-- at once, and the rows that exist reach a client through its next snapshot (the new client schema resets cursors).
set local lock_timeout = '5s';
create or replace function public.install_sync_triggers(force_replace boolean default false) returns void language plpgsql as $$
declare t text; heavy text; present boolean;
begin
  foreach t in array array['channels','projects','messages','threads','tasks','machines','agents',
    'agent_channels','repos','project_repos','artifacts','beats','runs','decisions','policies',
    'memory_blocks','skills','skill_packs','schedules','content_items','connectors',
    'workspace_members','channel_members','whiteboards','code_sessions','reply_reminders',
    'project_agents','email_drafts'] loop
    select coalesce(string_agg(quote_literal(a.attname), ',' order by a.attnum), '') into heavy
      from pg_attribute a
     where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped
       and (a.atttypid = 'tsvector'::regtype or format_type(a.atttypid, a.atttypmod) like 'vector%');
    select exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = 'sync_change') into present;
    if present and not force_replace then continue; end if;
    if present then
      execute format('drop trigger if exists sync_note on public.%I', t);
      execute format('drop trigger if exists sync_change on public.%I', t);
    end if;
    execute format('create trigger sync_note after insert or update or delete on public.%I for each row execute function public.note_sync_workspace()', t);
    execute format('create constraint trigger sync_change after insert or update or delete on public.%I deferrable initially deferred for each row execute function public.record_sync_change(%s)', t, heavy);
  end loop;
end $$;
select public.install_sync_triggers();
