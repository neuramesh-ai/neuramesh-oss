-- Close the RLS gap the Supabase security advisor flagged on prod (2026-07-28).
--
-- WHAT WAS OPEN. 14 tables were created without `enable row level security`, plus the runner's
-- own schema_migrations. No migration has ever issued a REVOKE, so Supabase's default
-- `grant all on tables to anon, authenticated` stood on every one of them — and PostgREST is
-- live on the project. RLS off + those grants + a live REST endpoint means anyone holding the
-- anon key (public by design) could SELECT, UPDATE and DELETE these tables directly. The write
-- side was the sharper edge: six of them are in the powersync publication, so an unqualified
-- DELETE would have replicated to every client.
--
-- WHY IT DRIFTED. RLS was never load-bearing here. Clients read through PowerSync and write
-- through control-api, which connects as the table owner and bypasses RLS — so nothing broke
-- when it lapsed, and nothing signalled. The last table to get RLS was `policies` (0068);
-- every table from 0074 onward missed it. 26 migrations of silent drift.
--
-- THE SHAPE OF THE FIX. RLS enabled with NO policy = deny-all to anon/authenticated. That is
-- already the posture of provider_credentials, task_counters and workspace_invites (0006/0001/
-- 0092), which is why the advisor never flagged those three. Nothing here grants or revokes,
-- so this migration references no roles and runs identically on the CI postgres, the dev stack
-- and cloud Supabase.
--
-- WHAT IS DELIBERATELY ABSENT:
--   * No `force row level security`. Table owners bypass RLS unless FORCE is set, and that
--     bypass is exactly what keeps control-api working. FORCE here would break every write.
--   * No read policies. These tables are reached over PowerSync or the control-api, never over
--     PostgREST, so a `members_read` would widen the surface for no caller. The five synced
--     tables replicate from the WAL, which RLS does not touch.
--   * No backfill, no data change. This is a permissions-only migration.

-- ── operator data: control-api only, never client-reachable ────────────────────────────────
alter table desktop_auth_sessions enable row level security;  -- holds a verified session mid-handoff
alter table connector_secrets     enable row level security;  -- sealed social tokens (AES-256-GCM)
alter table emails                enable row level security;  -- the outbox: recipient addresses + payloads
alter table nm_users              enable row level security;  -- clerk_user_id → uuid identity map
alter table device_tokens         enable row level security;  -- APNs tokens
alter table push_log              enable row level security;
alter table content_media         enable row level security;
alter table custom_model_packs    enable row level security;

-- ── in the powersync publication: clients read these via sync rules, not PostgREST ─────────
-- Logical replication reads the WAL and is unaffected by RLS, so sync is untouched.
alter table threads               enable row level security;
alter table runs                  enable row level security;
alter table beats                 enable row level security;
alter table schedules             enable row level security;
alter table content_items         enable row level security;
alter table connectors            enable row level security;

-- ── the migration ledger ───────────────────────────────────────────────────────────────────
-- schema_migrations is created by the runner (packages/control-api/scripts/migrate.mjs), not by
-- a migration — so it is absent wherever the .sql files are applied directly by psql rather than
-- through the runner (scripts/ci-db-bootstrap.sh, scripts/validate-db.sh). Guarded, or those
-- paths abort under ON_ERROR_STOP. The runner writes as the table's owner, so RLS is a no-op
-- for it; leaving it open let anyone mark a migration applied and wedge the next deploy.
do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    execute 'alter table schema_migrations enable row level security';
  end if;
end $$;
