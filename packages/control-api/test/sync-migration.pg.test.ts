// MIGRATION 0159 UNDER LIVE WRITERS. The first sandbox deploy of 0159 deadlocked twice: old-feed
// writers hold a synced table and then wait for the local_sync_state row, and the migration took that
// row first and the tables after. This runs the migration file again (it is idempotent) while writers
// commit multi-table transactions in different table orders, with gaps between them as real traffic has, with the 0152 statement guard put back
// so they behave exactly like the writers that deadlocked it. The migration must commit, and no
// writer may fail. Run by the pg lane (DATABASE_URL).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const DB = process.env['DATABASE_URL'];
const sql = DB ? postgres(DB, { max: 8, onnotice: () => {} }) : null;
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../supabase/migrations/0159_sync_workspace_revisions.sql', import.meta.url)), 'utf8');
// the fixture workspace's rows (supabase/validate/test-fixtures.sql)
const CHANNEL_A = 'c0000000-0000-0000-0000-00000000000a';
const CHANNEL_B = 'c0000000-0000-0000-0000-00000000000b';
const REPO_1 = 'b0000000-0000-0000-0000-000000000001';
const REPO_2 = 'b0000000-0000-0000-0000-000000000002';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterAll(async () => { await sql?.end(); });

describe.skipIf(!DB)('migration 0159 under live writers', { timeout: 150_000 }, () => {
  it('commits while writers hold the synced tables in different orders, and no writer fails', async () => {
    const wasEnabled = (await sql!<{ enabled: boolean }[]>`select enabled from local_sync_state where singleton`)[0]?.enabled ?? false;
    // the 0152 guard, as the writers of the previous release run it: the table, then the singleton row
    await sql!.unsafe(`create or replace function public.lock_local_sync_revision() returns trigger language plpgsql as $$
      begin
        if (select enabled from public.local_sync_state where singleton) then
          perform revision from public.local_sync_state where singleton for update;
        end if;
        return null;
      end $$`);
    await sql!`update local_sync_state set enabled = true where singleton`;
    let stop = false;
    const errors: string[] = [];
    let commits = 0;
    const writer = async (steps: Array<(tx: postgres.TransactionSql) => Promise<unknown>>) => {
      while (!stop) {
        try {
          await sql!.begin(async (tx) => {
            for (const step of steps) { await step(tx); await sleep(15); }
          });
          commits++;
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
        // traffic, not a tight loop: a writer that starts its next transaction 5 ms after the last one
        // holds its first table nearly all the time, and no migration (nor any DDL) can ever take it
        await sleep(20 + Math.random() * 80);
      }
    };
    const topic = (id: string) => (tx: postgres.TransactionSql) => tx`update channels set topic = ${`w ${Date.now()}`} where id = ${id}::uuid`;
    const repo = (id: string) => (tx: postgres.TransactionSql) => tx`update repos set clone_url = clone_url || '' where id = ${id}::uuid`;
    const writers = [
      writer([topic(CHANNEL_A), repo(REPO_1)]),
      writer([repo(REPO_2), topic(CHANNEL_B)]),
      writer([topic(CHANNEL_B), repo(REPO_1)]),
    ];
    try {
      await sleep(300);
      expect(commits).toBeGreaterThan(0);
      const t0 = Date.now();
      await sql!.begin(async (tx) => { await tx.unsafe(MIGRATION); });
      const took = Date.now() - t0;
      const after = commits;
      await sleep(300);
      stop = true;
      await Promise.all(writers);
      expect(errors).toEqual([]);
      expect(took).toBeLessThan(120_000);
      expect(commits).toBeGreaterThan(after); // the writers go on after it
      // the old guard is a no-op again, and the new triggers are in place
      const [guard] = await sql!<{ src: string }[]>`select prosrc as src from pg_proc where proname = 'lock_local_sync_revision'`;
      expect(guard!.src).not.toContain('for update');
      const triggers = await sql!<{ n: number }[]>`select count(*)::int as n from pg_trigger where tgname = 'sync_change'`;
      // 26 tables from 0159, and project_agents from 0173 (a re-run of 0159 leaves its triggers in place)
      expect(triggers[0]!.n).toBe(27);
    } finally {
      stop = true;
      await Promise.allSettled(writers);
      if (!wasEnabled) await sql!`update local_sync_state set enabled = false where singleton`;
    }
  });
});
