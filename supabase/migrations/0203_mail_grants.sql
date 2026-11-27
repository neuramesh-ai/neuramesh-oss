-- AN AGENT READS MAIL OR CALENDAR ONLY WITH THE PERSON'S APPROVAL (docs/design/inbox-sales-2026-11/plan.md I12,
-- CLAUDE.md rule 5). An agent asks in a session for ONE search (a Gmail search, a calendar range, or both) and says
-- why. The person selects Allow once, and the grant lets that agent, in that session, run that search one time in
-- the next hour. The API reads with the person's token and gives the agent the text. The token never leaves the API.
--
-- ONE ROW IS THE ASK, THE GRANT AND THE LOG. status moves asked → allowed → used (or asked → declined). Each move is
-- one update with the state it starts from in its WHERE, so two clicks or two reads can never both win:
--   * Allow once sets allowed_by (the person whose mail the agent reads), allowed_at and expires_at (an hour later).
--   * A read claims the row (allowed → used) for its agent, its session and a live hour, reads, and writes what it
--     read (read_threads, read_days, used_at). A read that fails at Google gives the row back (used → allowed).
--   * A second read needs a new ask: a used row never reads again.
-- So the row says who read whose mail, when, and with which search: that is the log.
--
-- Synced (the card renders from the replica, and it says "Allowed once · pike read 6 threads"), written only by the
-- control-api: mail.ask_read (an agent), POST /v1/mail/allow and /v1/mail/decline (the person, HUMAN_ONLY) and
-- POST /v1/mail/read (a machine bearer, the agent of the grant). No mail and no token is ever in this table: the
-- search is what the card shows, and the room sees the card.
create table mail_grants (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  channel_id   uuid not null references channels (id) on delete cascade,
  thread_id    uuid not null references threads (id) on delete cascade,
  agent_id     uuid not null references agents (id) on delete cascade,
  -- the one search: {"mail": {"people": [...], "words": "...", "days": 90, "max": 20}, "calendar": {"from": "2026-11-30", "to": "2026-12-04"}}
  search       jsonb not null,
  reason       text not null,
  status       text not null default 'asked' check (status in ('asked', 'allowed', 'declined', 'used')),
  allowed_by   uuid references nm_users (id) on delete cascade,
  -- the person's time zone at Allow once: the calendar range is their days, not UTC days
  time_zone    text,
  allowed_at   timestamptz,
  expires_at   timestamptz,
  used_at      timestamptz,
  read_threads integer,
  read_days    integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (status = 'asked' or status = 'declined' or (allowed_by is not null and expires_at is not null))
);
create index mail_grants_thread on mail_grants (thread_id, created_at);
create index mail_grants_waiting on mail_grants (workspace_id, created_at desc) where status = 'asked';
comment on table mail_grants is
  'one read of a person''s mail or calendar that an agent asked for: the ask, the person''s Allow once and the read log (plan I12)';
-- RLS on, no policy = deny-all to PostgREST (0100's stance). The runtime role gets its grant from scripts/db-runtime.mjs.
alter table mail_grants enable row level security;

-- the replica's feed: the triggers of 0159 on one more table (0199's shape)
set local lock_timeout = '5s';
create or replace function public.install_sync_triggers(force_replace boolean default false) returns void language plpgsql as $$
declare t text; heavy text; present boolean;
begin
  foreach t in array array['channels','projects','messages','threads','tasks','machines','agents',
    'agent_channels','repos','project_repos','artifacts','beats','runs','decisions','policies',
    'memory_blocks','skills','skill_packs','schedules','content_items','connectors',
    'workspace_members','channel_members','whiteboards','code_sessions','reply_reminders',
    'project_agents','email_drafts','mail_grants'] loop
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
