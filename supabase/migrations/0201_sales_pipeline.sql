-- THE SALES PIPELINE (docs/design/inbox-sales-2026-11/plan.md S1 to S4, round 5 DS1 to DS15). One pipeline for each
-- workspace (George, 2026-11-23): a company has one set of customers. A deal can name a project later, as a new
-- nullable column, and nothing here reads a project.
--
-- `sales_contacts` is a person the company sells to, one row per address in a workspace. `sales_deals` is one deal
-- in a stage (Lead, Talked, Trial, Proposal, Won, Lost) with its value a year and its next step. Both are written
-- only by the control-api (sales.upsert_contact, sales.upsert_deal, sales.move_deal, sales.add_contacts), which a
-- person with Sales access or an agent with the Sales grant sends. Both are synced, and the replica gives their
-- rows only to a person with Sales access (local-sync-scope.ts). An agent reads them through GET /v1/sales, which
-- checks its own grant, never its machine owner's.
--
-- Nothing from a person's mail is stored here but the contacts that the person picked in Bring in contacts. The
-- last email date in Contacts is read live from the viewer's own Gmail and never stored (George, 2026-11-23).
create table sales_contacts (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces (id) on delete cascade,
  name            text not null default '',
  email           text not null check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  company         text not null default '',
  -- where the person came from: Bring in contacts (gmail), a person (human), the site form (site), an agent
  source          text not null default 'human' check (source in ('gmail', 'human', 'site', 'agent')),
  created_by_kind text not null check (created_by_kind in ('agent', 'human')),
  created_by      text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, email)
);
comment on table sales_contacts is 'a person the company sells to, one row per address in a workspace (plan S1)';

create table sales_deals (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces (id) on delete cascade,
  contact_id      uuid references sales_contacts (id) on delete set null,
  title           text not null check (length(title) between 1 and 200),
  company         text not null default '',
  stage           text not null default 'lead' check (stage in ('lead', 'talked', 'trial', 'proposal', 'won', 'lost')),
  -- the value a year, in whole units of the currency
  value_year      integer not null default 0 check (value_year >= 0),
  currency        text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  next_step       text not null default '',
  next_date       date,
  -- the deal's session: the conversation where its outreach cards live (S3)
  thread_id       uuid references threads (id) on delete set null,
  -- who moved the stage last, so a card that pike moved says so (DS5)
  moved_by_kind   text check (moved_by_kind is null or moved_by_kind in ('agent', 'human')),
  moved_by        text,
  moved_at        timestamptz,
  -- when the deal became won or lost: the wins of a month read it
  closed_at       timestamptz,
  created_by_kind text not null check (created_by_kind in ('agent', 'human')),
  created_by      text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index sales_deals_workspace on sales_deals (workspace_id, stage);
create index sales_deals_contact on sales_deals (contact_id);
comment on table sales_deals is 'one deal of the workspace pipeline: a stage, the value a year and the next step (plan S1)';

-- RLS on, no policy = deny-all to PostgREST (0100's stance): reads ride the API replica, writes ride the control-api.
-- The runtime role gets its grant and its nm_control_api policy from scripts/db-runtime.mjs after the migration.
alter table sales_contacts enable row level security;
alter table sales_deals enable row level security;

-- OUTREACH IS AN EMAIL CARD (S3): an email draft can name its deal, and the person can drop a draft (Do not send).
-- A deal that is deleted leaves its emails in the session.
alter table email_drafts add column deal_id uuid references sales_deals (id) on delete set null;
create index email_drafts_deal on email_drafts (deal_id) where deal_id is not null;
alter table email_drafts drop constraint if exists email_drafts_status_check;
alter table email_drafts add constraint email_drafts_status_check check (status in ('draft', 'sent', 'replaced', 'dropped'));

-- the replica's feed: 0199's triggers on two more tables. The tables are new, so their locks come at once.
set local lock_timeout = '5s';
create or replace function public.install_sync_triggers(force_replace boolean default false) returns void language plpgsql as $$
declare t text; heavy text; present boolean;
begin
  foreach t in array array['channels','projects','messages','threads','tasks','machines','agents',
    'agent_channels','repos','project_repos','artifacts','beats','runs','decisions','policies',
    'memory_blocks','skills','skill_packs','schedules','content_items','connectors',
    'workspace_members','channel_members','whiteboards','code_sessions','reply_reminders',
    'project_agents','email_drafts','sales_contacts','sales_deals'] loop
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
