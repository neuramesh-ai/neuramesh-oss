// THE SANDBOX MIGRATION ORDER (round 7). Our Cloud SQL ran OUR 0155 to 0160 (0159 = the per-workspace
// sync feed with DEFERRED constraint triggers) before upstream's 0155 to 0172 existed. The migrate job
// will now apply upstream's files on top, in name order, with our triggers live, then 0173. A fresh
// database (CI, the local stack) interleaves the two sets by name instead. This builds a throwaway
// database in the sandbox order with the runner's own batch (scripts/migrate.mjs, including its retry
// with immediate constraints when a file meets pending trigger events), and checks that:
//   · every file applies,
//   · the feed recorded the upstream files' writes while they ran,
//   · the result has the same tables, columns and triggers as the CI database (name order).
// Run by the pg lane (DATABASE_URL). It creates and drops its own database.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const DB = process.env['DATABASE_URL'];
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, 'utf8');
// psql meta-commands (\set ON_ERROR_STOP) are not SQL
const sqlOnly = (text: string) => text.split('\n').filter((l) => !l.startsWith('\\')).join('\n');
const OURS = ['0155_cloudrun_machines.sql', '0156_machine_parks_facts.sql', '0157_fleet_lease.sql', '0158_machine_boot_breaker.sql', '0159_sync_workspace_revisions.sql', '0160_machine_vault.sql'];
const LATER = ['0173_sync_project_agents.sql'];
const name = `nm_order_${Date.now().toString(36)}`;
const admin = DB ? postgres(DB, { max: 1, onnotice: () => {} }) : null;
let scratch: postgres.Sql | null = null;

/** the runner's batch (migrate.mjs): one transaction per file, and one retry with immediate constraints
 *  when the file met pending trigger events. Returns whether the retry was needed. */
async function apply(sql: postgres.Sql, file: string): Promise<boolean> {
  const ddl = read(`supabase/migrations/${file}`).trim().replace(/;?\s*$/, ';');
  const batch = (immediate: boolean) => ['begin;', ...(immediate ? ['set constraints all immediate;'] : []), ddl,
    `insert into schema_migrations (name) values ('${file}');`, 'commit;'].join('\n');
  try {
    await sql.unsafe(batch(false));
    return false;
  } catch (e) {
    await sql.unsafe('rollback;').catch(() => {});
    if (!/pending trigger events/i.test(String((e as Error).message))) throw new Error(`${file}: ${(e as Error).message}`);
    await sql.unsafe(batch(true));
    return true;
  }
}

const shape = async (sql: postgres.Sql) => ({
  columns: (await sql<{ c: string }[]>`
    select table_name || '.' || column_name || ':' || data_type as c from information_schema.columns
     where table_schema = 'public' and table_name not like 'pg_%' and table_name <> 'schema_migrations' order by 1`).map((r) => r.c),
  triggers: (await sql<{ t: string }[]>`
    select c.relname || '.' || t.tgname as t from pg_trigger t join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal order by 1`).map((r) => r.t),
});

afterAll(async () => {
  await scratch?.end().catch(() => {});
  if (admin) await admin.unsafe(`drop database if exists ${name} with (force)`).catch(() => {});
  await admin?.end();
});

describe.skipIf(!DB)('migrations in the sandbox order (ours first, then upstream, then 0173)', { timeout: 240_000 }, () => {
  it('applies every file, the feed records upstream writes, and the schema matches the name order', async () => {
    await admin!.unsafe(`create database ${name}`);
    const url = new URL(DB!);
    url.pathname = `/${name}`;
    scratch = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });
    const sql = scratch;
    await sql.unsafe(read('supabase/validate/auth-shim.sql'));
    await sql.unsafe(read('supabase/migrations/0001_core.sql'));
    await sql.unsafe(sqlOnly(read('supabase/validate/test-fixtures.sql')));
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;

    const files = readdirSync(`${ROOT}supabase/migrations`).filter((f) => f.endsWith('.sql') && !f.startsWith('0001_') && !/publication|publish/.test(f)).sort();
    const base = files.filter((f) => f < '0155');
    const upstream = files.filter((f) => f >= '0155' && !OURS.includes(f) && !LATER.includes(f));
    expect(OURS.every((f) => files.includes(f))).toBe(true);
    expect(upstream).toContain('0172_thread_followups.sql');

    const retried: string[] = [];
    for (const f of base) if (await apply(sql, f)) retried.push(f);
    for (const f of OURS) if (await apply(sql, f)) retried.push(f);
    // the sandbox runs with the feed on
    await sql`update local_sync_state set enabled = true where singleton`;
    const before = (await sql<{ n: number }[]>`select count(*)::int as n from sync_changes`)[0]!.n;
    for (const f of [...upstream, ...LATER]) if (await apply(sql, f)) retried.push(f);
    console.log(`sandbox order: ${base.length + OURS.length + upstream.length + LATER.length} files, retried with immediate constraints: ${retried.join(', ') || 'none'}`);

    const applied = (await sql<{ n: number }[]>`select count(*)::int as n from schema_migrations`)[0]!.n;
    expect(applied).toBe(base.length + OURS.length + upstream.length + LATER.length);
    // upstream 0156 wrote projects (context_channel_id, settings) with our triggers live: the feed has it
    const after = (await sql<{ n: number }[]>`select count(*)::int as n from sync_changes`)[0]!.n;
    expect(after).toBeGreaterThan(before);
    expect((await sql`select 1 from sync_changes where table_name = 'projects' limit 1`).length).toBe(1);
    // 0173 put project_agents on the feed
    expect((await sql`select 1 from pg_trigger where tgrelid = 'public.project_agents'::regclass and tgname = 'sync_change'`).length).toBe(1);

    // the same schema as the CI database, which ran every file in name order
    const mine = await shape(sql);
    const ci = await shape(admin!);
    expect(mine.columns.filter((c) => !ci.columns.includes(c))).toEqual([]);
    expect(ci.columns.filter((c) => !mine.columns.includes(c))).toEqual([]);
    expect(mine.triggers.filter((t) => !ci.triggers.includes(t))).toEqual([]);
    expect(ci.triggers.filter((t) => !mine.triggers.includes(t))).toEqual([]);
  });

  it('a file that writes a synced table and then ALTERs it is retried with immediate constraints and applies', async () => {
    const sql = scratch!;
    const probe = 'zz_probe_pending_events.sql';
    const ddl = `update channels set topic = topic || '' where workspace_id = 'a0000000-0000-0000-0000-00000000000a';
alter table channels alter column topic set default '';`;
    const batch = (immediate: boolean) => ['begin;', ...(immediate ? ['set constraints all immediate;'] : []), ddl,
      `insert into schema_migrations (name) values ('${probe}');`, 'commit;'].join('\n');
    // deferred (the default): the ALTER meets the pending sync_change events
    await expect(sql.unsafe(batch(false))).rejects.toThrow(/pending trigger events/);
    await sql.unsafe('rollback;').catch(() => {});
    // the runner's retry
    await sql.unsafe(batch(true));
    expect((await sql`select 1 from schema_migrations where name = ${probe}`).length).toBe(1);
  });
});
