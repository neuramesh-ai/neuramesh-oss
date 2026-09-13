// Migration 0111 — the role-default backfill, and the two guards that stop it overwriting a human.
//
// 0110 derived `description` from `brief`, which reached fewer agents than it looked like: seeded
// agents never had a brief (that field was introduced for HIRED specialists), and the daemon's
// seed text only applies at agent.register for a MISSING agent — so a live workspace opened with
// rex and iris blank (founder report).
//
// 0111 falls back to the role's default for anyone still undescribed. It must fill a NULL, must
// upgrade a value that byte-matches 0110's own derivation (provably machine-written), and must
// never touch anything else. This runs the migration's UPDATE against rows set up here, because
// the migration itself already ran at bootstrap and cannot see rows created afterwards.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const DB = process.env['DATABASE_URL'];
const sql = DB ? postgres(DB) : null;

// the migration's statement, minus its comments — the ONE thing under test
const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0111_agent_description_defaults.sql', import.meta.url), 'utf8');

afterAll(async () => { await sql?.end(); });

describe.skipIf(!DB)('0111 — role-default descriptions, fill only if untouched', () => {
  it('fills a NULL, upgrades 0110-derived text, and never overwrites a human', async () => {
    // reuse the fixture workspace/machine — this test is about the UPDATE's guards, not setup,
    // and `workspaces.created_by` is NOT NULL (a workspace belongs to whoever made it)
    // the fixtures ship a workspace and no agents, so bring our own machine. (`workspaces` is
    // not ours to create here — created_by is NOT NULL and a workspace belongs to a user.)
    const [ws] = await sql!`select id from workspaces order by created_at limit 1`;
    const WS = ws!['id'] as string;
    const [owner] = await sql!`select created_by from workspaces where id = ${WS}::uuid`;
    const [m] = await sql!`insert into machines (workspace_id, owner_user_id, name, platform, daemon_version)
      values (${WS}::uuid, ${owner!['created_by'] as string}::uuid, ${'desc-rig-' + Date.now()}, 'darwin', '0.1.0') returning id`;
    const MID = m!['id'] as string;
    const tag = `p${Date.now().toString(36)}`; // unique names — agents are (workspace, name) unique

    const mk = async (name: string, role: string, description: string | null, brief: string | null) => {
      const [r] = await sql!`insert into agents (workspace_id, machine_id, name, role, model, runtime, description, brief, status)
        values (${WS}::uuid, ${MID}::uuid, ${name}, ${role}::agent_role, 'claude-opus-4-8', 'claude-code', ${description}, ${brief}, 'online') returning id`;
      return r!['id'] as string;
    };

    // 1. never had a brief — the rex/iris case
    const bare = await mk(`rex-${tag}`, 'orchestrator', null, null);
    // 2. 0110's own derivation from a brief ("Brand and growth" ← the clause before the colon)
    const derived = await mk(`plume-${tag}`, 'marketer', 'Brand and growth', 'Brand and growth: study the product and its market for real, write the brand docs.');
    // 3. a human's words — sacred
    const HUMAN = 'Only touches the billing service. Ask me before routing anything else here.';
    const human = await mk(`patch-${tag}`, 'developer', HUMAN, 'Careful in payments.');
    // 4. a brief-derived description a human then EDITED — must also survive
    const edited = await mk(`scout-${tag}`, 'reviewer', 'Reviews only the mobile app', 'Reviews: gate every PR against the DoD.');

    await sql!.unsafe(MIGRATION);

    const desc = async (id: string) => (await sql!`select description from agents where id = ${id}::uuid`)[0]!['description'];

    expect(await desc(bare)).toMatch(/^Runs this room/);            // filled from the role default
    expect(await desc(derived)).toMatch(/^Brand and growth — brand docs/); // terse → full routing line
    expect(await desc(human)).toBe(HUMAN);                          // untouched
    expect(await desc(edited)).toBe('Reviews only the mobile app');  // untouched

    // and it is IDEMPOTENT — a second run changes nothing
    const before = await desc(bare);
    await sql!.unsafe(MIGRATION);
    expect(await desc(bare)).toBe(before);
  });
});
