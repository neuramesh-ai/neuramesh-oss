// Every public table has row level security enabled (migration 0100).
//
// This is the enforcement, not the migration. RLS is not load-bearing in this architecture —
// clients read through PowerSync and control-api writes as the table owner, which bypasses RLS —
// so a table created without it breaks nothing and signals nothing. That is exactly how 14 tables
// drifted open between 0068 and 0099 until Supabase's advisor caught them on prod.
//
// A new table that forgets `enable row level security` now fails CI instead of an email months
// later. The fix is one line in the migration that creates the table; deny-all (RLS on, no policy)
// is the correct default, and a table that genuinely needs client reads adds its own policy.
//
// Runs against the CI bootstrap database (scripts/ci-db-bootstrap.sh). Skipped without DATABASE_URL.
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const DB = process.env['DATABASE_URL'];
const sql = DB ? postgres(DB, { max: 1, prepare: false }) : null;

afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!DB)('row level security (migration 0100)', () => {
  it('is enabled on every public table', async () => {
    const open = await sql!<{ table: string }[]>`
      select c.relname as table
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and not c.relrowsecurity
      order by c.relname
    `;
    // The message carries the remedy, because the failure will land on whoever added the table
    // and the one-line fix is not obvious from a bare array diff.
    expect(
      open.map((r) => r.table),
      'public tables without RLS — add `alter table <t> enable row level security;` to the ' +
        'migration that creates it (no policy = deny-all, the right default; see 0100)',
    ).toEqual([]);
  });

  it('leaves owner access intact — no table forces RLS', async () => {
    // FORCE would apply RLS to the table owner too, and control-api connects as the owner.
    // Enabling it anywhere would break every write, so it must stay off everywhere.
    const forced = await sql!<{ table: string }[]>`
      select c.relname as table
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity
      order by c.relname
    `;
    expect(forced.map((r) => r.table)).toEqual([]);
  });
});
