#!/usr/bin/env node
// Idempotent migration runner. Applies every supabase/migrations/*.sql that isn't yet
// recorded in the schema_migrations table, each in its own transaction, serialized by a
// TRANSACTION-level advisory lock taken inside that same transaction. Re-running is a no-op.
//
// WHY TRANSACTION-LEVEL, LEARNED IN PRODUCTION (2026-09-21). The runner used to take a
// SESSION-level pg_advisory_lock across the whole run, over the transaction pooler (the only
// url Vercel's IPv4 build network can reach). In transaction pooling every statement may land on
// a different backend: the lock landed on one, the unlock on another, and the first backend kept
// the lock for as long as the pooler kept it alive. From then on every deploy's migrate blocked
// on that lock until the statement timeout killed it — three production deploys in a row failed
// with "canceling statement due to statement timeout", none of them on a migration. A
// transaction-level lock (pg_advisory_xact_lock) lives and dies with ONE transaction, which the
// pooler pins to one backend, so a crash, a cancelled build or a dropped connection releases it
// by construction. Two deploys racing the same migration: the second waits, then the guard
// inside the transaction sees the tracking row the first one committed and skips. The key is a
// NEW one on purpose: the leaked session lock on the old key may still be held by a pooled
// backend, and this runner must never queue behind it again.
//
// Where it runs: the control-api's Vercel **production** deploy (vercel.json buildCommand) —
// so the schema is migrated *before* the new code serves traffic. Preview deploys are gated
// off (VERCEL_ENV !== 'production') and never touch the prod DB. Also runnable by hand:
//   SUPABASE_DB_URL=... node scripts/migrate.mjs --force
//
// Adopting tracking on an already-migrated DB: when schema_migrations is empty but the DB is
// established (the `tasks` table exists), every migration through ADOPTION_BASELINE is marked
// applied *without* re-running it — only migrations after the baseline actually execute. Prod
// was at 0046 when this runner landed, so 0047 is the first migration it applies.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

// Overridable so the dev stack can adopt at its own latest (scripts/dev-migrate.sh); prod keeps 0046.
const ADOPTION_BASELINE = process.env.MIGRATE_ADOPTION_BASELINE || '0046_desktop_auth_sessions.sql';
// v2: a fresh key, so the session-level lock the old runner leaked on 'neuramesh_schema_migrations'
// can never block this one (see the header). Any stable string; hashed to a bigint below.
const LOCK_KEY = 'neuramesh_schema_migrations_v2';
/** what the in-transaction guard raises when another deploy applied the file first */
const ALREADY_APPLIED = 'NM_MIGRATION_ALREADY_APPLIED';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../../..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase/migrations');
// A plain Postgres (the local stack, docs/local-mode.md) has no Supabase `auth` schema, and the
// migrations reference auth.users + auth.uid() — the validation shim supplies both. Applied only
// when the schema is absent, so Supabase (which has it) never sees this step.
const AUTH_SHIM = join(REPO_ROOT, 'supabase/validate/auth-shim.sql');
// Self-hosted PowerSync (the local stack) needs its storage role + database and the publication,
// exactly what dev/stack/init/00-bootstrap.sh gives the dev stack. Gated on NM_LOCAL=1: the
// cloud's PowerSync is hosted, its publication was born in 0002, and the Vercel path must not
// grow a role on prod.
const STORAGE_SQL = join(REPO_ROOT, 'dev/stack/init/98-storage.sql');
const PUBLICATION_SQL = join(REPO_ROOT, 'dev/stack/init/99-publication.sql');
const selfHostedPowerSync = process.env.NM_LOCAL === '1';

const env = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
const onVercel = process.env.VERCEL === '1';
const force = process.argv.includes('--force');
// Reachability first. Supabase's DIRECT url (SUPABASE_DB_URL, :5432) is IPv6-only, and Vercel's
// build network is IPv4 — connecting there fails `ENETUNREACH`. So prefer the same pooler the
// control-api Function uses (DATABASE_URL → SUPABASE_DB_POOLER_URL), which is IPv4-reachable; the
// direct url is only a last resort (for an IPv6-capable host). The pooler is fine for DDL: each
// migration is one begin;…;commit; simple-protocol batch with prepare:false. Set
// MIGRATE_DATABASE_URL to a SESSION pooler (:5432 on the pooler host) if you want the advisory
// lock to truly hold — it's IPv4 too.
const url =
  process.env.MIGRATE_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_POOLER_URL ||
  process.env.SUPABASE_DB_URL ||
  '';

function skip(msg) {
  console.log(`[migrate] ${msg}`);
  process.exit(0);
}

// On Vercel, only the production deploy migrates. Preview/dev builds must never touch prod data.
if (onVercel && env !== 'production' && !force) {
  skip(`VERCEL_ENV=${env} (not production) — skipping migrations.`);
}
if (!url) {
  // No creds wired (local build, fork preview, etc.) — skip rather than fail the deploy.
  skip('no MIGRATE_DATABASE_URL / SUPABASE_DB_URL / DATABASE_URL set — skipping.');
}

const sql = postgres(url, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 30,
  prepare: false, // transaction-pooler safe (no prepared statements); each migration is one simple-protocol batch
  onnotice: (n) => {
    // Routine notices (e.g. "relation already exists, skipping") are just noise here; surface only warnings+.
    if (n.severity_local === 'NOTICE' || n.severity === 'NOTICE') return;
    console.warn(`[migrate] db ${n.severity}: ${n.message}`);
  },
});

try {
  // two runners racing a FRESH database can both pass IF NOT EXISTS and collide in the catalog
  // (a duplicate pg_type row); the loser re-reads and the table is simply there
  try {
    await sql`create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
  } catch (e) {
    if (!/duplicate key|already exists/i.test(String(e.message))) throw e;
  }

  const hasAuthSchema = (await sql`select 1 from pg_namespace where nspname = 'auth'`).length > 0;
  if (!hasAuthSchema) {
    // the same fresh-database race as the table above: a second runner may have created the
    // schema between the check and the shim, and then the shim's own objects are already there
    try {
      await sql.unsafe(await readFile(AUTH_SHIM, 'utf8'));
      console.log('[migrate] applied the auth schema shim (plain Postgres, no Supabase auth)');
    } catch (e) {
      if (!/duplicate key|already exists/i.test(String(e.message))) throw e;
      await sql.unsafe('rollback;').catch(() => {});
    }
  }

  const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  const established = (await sql`select to_regclass('public.tasks') as t`)[0].t !== null;
  const adopting = established && applied.size === 0;

  let files;
  try {
    files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  } catch (e) {
    throw new Error(`cannot read migrations dir ${MIGRATIONS_DIR}: ${e.message}`);
  }
  if (files.length === 0) throw new Error(`no .sql migrations found in ${MIGRATIONS_DIR}`);

  if (adopting) {
    console.log(`[migrate] established DB, empty schema_migrations — adopting tracking at baseline ${ADOPTION_BASELINE}`);
  }

  let ran = 0;
  let baselined = 0;
  for (const f of files) {
    if (applied.has(f)) continue;

    // Adoption: mark everything through the baseline as applied without re-running it.
    if (adopting && f <= ADOPTION_BASELINE) {
      await sql`insert into schema_migrations (name) values (${f}) on conflict do nothing`;
      baselined++;
      continue;
    }

    const ddl = (await readFile(join(MIGRATIONS_DIR, f), 'utf8')).trim().replace(/;?\s*$/, ';');
    const safeName = f.replace(/'/g, "''");
    // One simple-protocol batch = one transaction = one pooled backend: the lock, the guard, the
    // DDL and its tracking row commit together, so a crash can never leave a migration
    // applied-but-untracked (or vice versa), and the lock never outlives the transaction. The
    // guard is what makes two racing deploys safe: the loser waits on the lock, then sees the
    // winner's tracking row and raises a signal this runner treats as "skip", not as failure.
    const batch = [
      'begin;',
      `select pg_advisory_xact_lock(hashtext('${LOCK_KEY}')::bigint);`,
      `do $nm_guard$ begin if exists (select 1 from schema_migrations where name = '${safeName}') then raise exception '${ALREADY_APPLIED}'; end if; end $nm_guard$;`,
      ddl,
      `insert into schema_migrations (name) values ('${safeName}');`,
      'commit;',
    ].join('\n');
    try {
      await sql.unsafe(batch);
    } catch (e) {
      await sql.unsafe('rollback;').catch(() => {});
      if (String(e.message).includes(ALREADY_APPLIED)) {
        console.log(`[migrate] ${f} was applied by a concurrent deploy — skipped`);
        continue;
      }
      throw new Error(`migration ${f} failed — rolled back: ${e.message}`);
    }
    console.log(`[migrate] applied ${f}`);
    ran++;
  }

  if (selfHostedPowerSync) await ensureSelfHostedPowerSync();

  console.log(
    `[migrate] done — ${ran} applied, ${baselined} baselined, ${files.length} total (env=${env}).`,
  );
} catch (e) {
  console.error(`[migrate] FAILED: ${e.message}`);
  if (/ENETUNREACH|ETIMEDOUT|EHOSTUNREACH/.test(e.message)) {
    console.error(
      '[migrate] hint: looks like a DB reachability issue — Supabase\'s direct url is IPv6-only and most build networks are IPv4. Point MIGRATE_DATABASE_URL at the Supabase pooler.',
    );
  }
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}

/** the storage role + database (98) statement by statement, and the publication (99) — each only when missing */
async function ensureSelfHostedPowerSync() {
  // CREATE DATABASE cannot run inside a transaction block, so 98 is never one batch: each
  // statement runs alone, guarded by the catalog rather than by "if not exists" (which CREATE
  // DATABASE also lacks).
  for (const stmt of splitSql(await readFile(STORAGE_SQL, 'utf8'))) {
    const m = /^create\s+(user|role|database)\s+(\w+)/i.exec(stmt);
    if (!m) throw new Error(`98-storage.sql: unexpected statement: ${stmt.slice(0, 80)}`);
    const [, kind, name] = m;
    const exists = kind.toLowerCase() === 'database'
      ? await sql`select 1 from pg_database where datname = ${name}`
      : await sql`select 1 from pg_roles where rolname = ${name}`;
    if (exists.length) continue;
    await sql.unsafe(stmt);
    console.log(`[migrate] created powersync ${kind.toLowerCase()} ${name}`);
  }
  // a run from empty already has the publication (0002 creates it, the publish migrations grow
  // it); this covers a database bootstrapped some other way
  const pub = await sql`select 1 from pg_publication where pubname = 'powersync'`;
  if (pub.length === 0) {
    await sql.unsafe(await readFile(PUBLICATION_SQL, 'utf8'));
    console.log('[migrate] created the powersync publication (99-publication.sql)');
  }
}

function splitSql(text) {
  return text
    .split(/;\s*\n|;\s*$/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}
