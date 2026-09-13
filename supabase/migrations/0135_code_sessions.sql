-- Code sessions as SYNCED ROWS (docs/design/mobile-cloud-2026-09/plan.md, D8 · S0.1). Until now an
-- engineering session lived in the desktop renderer's localStorage with the machine's Cline
-- transcript and worktree as the authority — so no OTHER client could list a Code thread at all,
-- and the phone (the third client) had nothing to draw its Code tab from.
--
-- One row per session, keyed by the engineering THREAD id the client mints (EngineeringOpenMeta
-- .threadId), so the row and the machine's history discovery (actor + repo + thread) agree on the
-- identity. The row is DESCRIPTIVE, never gating: the machine-side transcript stays authoritative
-- for execution; this is what a list needs — the repo, the branch, the mode, the state, the last
-- line — and nothing a client could replay a turn from.
--
-- Two writers, by design (handler/codesession.ts): the client that opens a session creates its row
-- as itself; the machine hosting it (acting as its owner) creates or updates it, naming the member
-- it works for as created_by. New synced table → also joins the powersync publication
-- (0136_publish_code_sessions.sql, prod; 99-publication.sql, dev + CI) and the sync rules.
create table code_sessions (
  id                 uuid primary key,                                        -- the engineering thread id (client-minted)
  workspace_id       uuid not null references workspaces (id) on delete cascade,
  project_id         uuid references projects (id) on delete set null,
  repo_id            uuid references repos (id) on delete set null,
  repo_name          text not null default '',
  branch             text not null default '',
  title              text not null default '',                                -- the first prompt's first line, until renamed
  mode               text not null default 'plan' check (mode in ('plan', 'act')),
  state              text not null default 'idle'
                     check (state in ('idle', 'streaming', 'awaiting_approval', 'resumable', 'completed', 'error')),
  machine_id         uuid references machines (id) on delete set null,       -- the machine hosting it (rule D9: designated at open)
  created_by         uuid not null,                                           -- the member the session belongs to (nm_users)
  last_line          text not null default '',                                -- the newest non-tool line, for the row's snippet
  changes_count      integer not null default 0,
  checkpoints_count  integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  ended_at           timestamptz
);
-- the one read: a workspace's Code list, newest first (the rail's Code mode, the phone's Code tab)
create index code_sessions_ws on code_sessions (workspace_id, updated_at desc);
comment on table code_sessions is
  'one synced row per engineering (Code) session — the list every client draws; the machine''s transcript stays the execution authority';
-- RLS on, no policy = deny-all to PostgREST (0100's stance): every read and write goes through
-- control-api and the PowerSync publication, never a client-side postgres role.
alter table code_sessions enable row level security;
