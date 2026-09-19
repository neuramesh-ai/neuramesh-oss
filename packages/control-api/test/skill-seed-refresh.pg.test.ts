// Version-aware refresh of the BUNDLED skill packs, against the REAL schema (0021 + 0025).
// Run via scripts/test-pg.sh / ci-db-bootstrap.sh — skipped without DATABASE_URL.
//
// The bug this locks down: seedBundledPacksSql gated on pack-name existence, so a bundled pack's
// CONTENT change (the marketing-os round-3 preamble fix, and on 2026-09-18 the UGC preamble's
// caption-and-script shape) never reached a room that already held the pack: the boot backfill saw
// the name, added missing skill NAMES, and a changed body sat in the deploy forever. Written on
// 2026-08-21 (34183cd8, never landed), ported with the release drafts.
//
// A room "holding an older bundle" is simulated by writing an older version string onto the pack row
// and staling its content. That is not a contrivance: it is byte-for-byte what every pre-change room
// holds today (a bare `bundled@<sha>` pin, no content digest), so these cases ARE the migration case.
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';
import { bundledPackVersion } from '../src/seed/packversion';
import { MARKETING_OS_SKILL_SEED } from '../src/seed/marketing-os-skill-seed';
import { MARKETING_SKILL_SEED } from '../src/seed/marketing-skill-seed';
import { SKILL_SEED } from '../src/seed/skill-seed';
import type { Actor } from '@neuramesh/shared';

const DB = process.env['DATABASE_URL'];
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

const GSTACK = SKILL_SEED.find((e) => e.pack.name === 'gstack')!;
const seedSkill = (i: number) => GSTACK.skills[i]!;

let ws = '';
let buildId = '';
let packId = '';

const packRow = async () => (await sql!`select version, origin, enabled, description from skill_packs where id = ${packId}::uuid`)[0]!;
const skillRow = async (name: string) =>
  (await sql!`select id, body, description, status, version, enabled from skills where pack_id = ${packId}::uuid and name = ${name}
     order by (status = 'active') desc limit 1`)[0];
const seedDefaults = () => send(george, { type: 'skillpack.seed_defaults', workspace: ws, channel: buildId });

beforeAll(async () => {
  if (!DB) return;
  // an ISOLATED workspace — the shared DB is live for every other pg suite
  expect((await send(george, { type: 'workspace.create', name: 'Seed Refresh', slug: 'seed-refresh' })).status).toBe(200);
  ws = (await sql!`select id from workspaces where slug = 'seed-refresh'`)[0]!['id'] as string;
  buildId = (await sql!`select id from channels where workspace_id = ${ws}::uuid and slug = 'build'`)[0]!['id'] as string;
  packId = (await sql!`select id from skill_packs where channel_id = ${buildId}::uuid and name = 'gstack'`)[0]!['id'] as string;
});

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('bundled skill packs: version-aware refresh', () => {
  it('a fresh room stores the CONTENT-derived version, not the bare pin', async () => {
    // the pin alone is the vendored upstream sha, which a preamble-only edit leaves untouched —
    // the seam's whole premise (seed/packversion.ts)
    const want = bundledPackVersion(GSTACK);
    expect(want.startsWith(`${GSTACK.pack.version}+`)).toBe(true);
    expect(want).not.toBe(GSTACK.pack.version);
    expect((await packRow())['version']).toBe(want);
  });

  it('re-seeding an up-to-date room is a NO-OP — no add, no refresh, no churn', async () => {
    const r = await j(await seedDefaults());
    expect(r).toMatchObject({ added: 0, refreshed: 0 });
  });

  it('a bumped seed refreshes the pack row and its skill bodies IN PLACE', async () => {
    const [a, b] = [seedSkill(0), seedSkill(1)];
    // rewind the room to a pre-bump state: the bare pin + stale content, exactly what a room
    // seeded by an older deploy holds
    await sql!`update skill_packs set version = ${GSTACK.pack.version}, description = 'stale pack blurb' where id = ${packId}::uuid`;
    await sql!`update skills set body = 'STALE BODY', description = 'stale' where pack_id = ${packId}::uuid and name in (${a.name}, ${b.name})`;
    const beforeId = (await skillRow(a.name))!['id'];

    const r = await j(await seedDefaults());
    expect(r).toMatchObject({ added: 0, refreshed: 1 });

    const pack = await packRow();
    expect(pack['version']).toBe(bundledPackVersion(GSTACK));
    expect(pack['description']).toBe(GSTACK.pack.description);
    const fresh = (await skillRow(a.name))!;
    expect(fresh['body']).toBe(a.body); // the deploy's body reached a room that already had the pack
    expect(fresh['description']).toBe(a.description);
    expect(fresh['id']).toBe(beforeId); // IN PLACE — same row, so pack membership and ids survive
    expect((await skillRow(b.name))!['body']).toBe(b.body);
  });

  it('the refresh is idempotent — the version it wrote makes the next pass a no-op', async () => {
    expect(await j(await seedDefaults())).toMatchObject({ added: 0, refreshed: 0 });
  });

  it('per-room `enabled` survives a refresh — pack switch and per-skill switch alike', async () => {
    const off = seedSkill(2);
    const offId = (await skillRow(off.name))!['id'] as string;
    expect((await send(george, { type: 'skillpack.set_enabled', packId, enabled: false })).status).toBe(200);
    expect((await send(george, { type: 'skill.set_enabled', skillId: offId, enabled: false })).status).toBe(200);
    await sql!`update skill_packs set version = 'bundled@older' where id = ${packId}::uuid`;
    await sql!`update skills set body = 'STALE BODY' where id = ${offId}::uuid`;

    expect(await j(await seedDefaults())).toMatchObject({ refreshed: 1 });

    expect((await packRow())['enabled']).toBe(false); // a disabled pack refreshes and stays OFF
    const row = (await skillRow(off.name))!;
    expect(row['enabled']).toBe(false); // …and so does a skill someone switched off
    expect(row['body']).toBe(off.body); // content still moved
    expect((await send(george, { type: 'skillpack.set_enabled', packId, enabled: true })).status).toBe(200);
  });

  it('a CURATED skill is never clobbered — version > 1 is the marker, and the seed never bumps it', async () => {
    const curated = seedSkill(3);
    const id = (await skillRow(curated.name))!['id'] as string;
    expect((await skillRow(curated.name))!['version']).toBe(1); // the seed inserts at 1 and leaves it there
    expect((await send(george, { type: 'skill.update', skillId: id, body: 'MY OWN WORDS', description: 'mine' })).status).toBe(200);
    expect((await skillRow(curated.name))!['version']).toBe(2); // skill.update — the only in-place edit path

    await sql!`update skill_packs set version = 'bundled@older' where id = ${packId}::uuid`;
    expect(await j(await seedDefaults())).toMatchObject({ refreshed: 1 });

    const row = (await skillRow(curated.name))!;
    expect(row['body']).toBe('MY OWN WORDS'); // the edit stands
    expect(row['description']).toBe('mine');
    expect(row['version']).toBe(2); // a seed write would have bumped it and destroyed the marker
    // and its neighbours still refreshed — one curated skill does not freeze the pack
    await sql!`update skills set body = 'STALE BODY' where pack_id = ${packId}::uuid and name = ${seedSkill(4).name}`;
    await sql!`update skill_packs set version = 'bundled@older' where id = ${packId}::uuid`;
    await seedDefaults();
    expect((await skillRow(seedSkill(4).name))!['body']).toBe(seedSkill(4).body);
  });

  it('a skill the bundle GAINED lands; one a human RETIRED stays retired', async () => {
    const gained = seedSkill(5);
    const retired = seedSkill(6);
    const retiredId = (await skillRow(retired.name))!['id'] as string;
    expect((await send(george, { type: 'skill.deprecate', skillId: retiredId })).status).toBe(200);
    // "gained" = the room simply has no row for it, which is what an older seed's room looks like
    await sql!`delete from skills where pack_id = ${packId}::uuid and name = ${gained.name}`;
    await sql!`update skill_packs set version = 'bundled@older' where id = ${packId}::uuid`;

    expect(await j(await seedDefaults())).toMatchObject({ refreshed: 1 });

    const back = (await skillRow(gained.name))!;
    expect(back['status']).toBe('active');
    expect(back['body']).toBe(gained.body);
    expect(back['enabled']).toBe(true);
    // resurrecting a deliberately retired skill from a background boot backfill would silently
    // undo a curation decision
    expect((await skillRow(retired.name))!['status']).toBe('deprecated');
  });

  it('a skill the bundle DROPPED is retired, unless someone curated it', async () => {
    const mk = (name: string, version: number) => sql!`insert into skills
      (workspace_id, channel_id, name, description, scope, body, status, author_kind, author_id, pack_id, enabled, version)
      values (${ws}::uuid, ${buildId}::uuid, ${name}, 'gone upstream', 'channel', 'old body', 'active',
              'agent'::actor_kind, '00000000-0000-0000-0000-000000000000'::uuid, ${packId}::uuid, true, ${version})`;
    await mk('dropped-upstream', 1); // still exactly as seeded → the bundle's to retire
    await mk('dropped-but-mine', 2); // curated → theirs, and it stays
    await sql!`update skill_packs set version = 'bundled@older' where id = ${packId}::uuid`;

    expect(await j(await seedDefaults())).toMatchObject({ refreshed: 1 });

    expect((await skillRow('dropped-upstream'))!['status']).toBe('deprecated');
    expect((await skillRow('dropped-but-mine'))!['status']).toBe('active');
    // every skill the seed DOES carry is still active — the sweep is name-scoped, not a purge
    for (const s of GSTACK.skills) {
      if (s.name === seedSkill(6).name) continue; // deliberately retired in the case above
      const row = await skillRow(s.name);
      if (row && row['version'] === 1) expect(row['status']).toBe('active');
    }
  });

  it("a skill a PERSON filed under the pack is not the bundle's to rewrite or sweep", async () => {
    // skill.create takes a packId, so a row inside a bundled pack need not have come from the seed.
    // Ownership is the author: the seed writes as the nil uuid, a person writes as themselves.
    expect((await send(george, {
      type: 'skill.create', workspace: ws, channel: buildId, name: 'my-house-rule',
      description: 'mine', body: 'MY BODY', scope: 'channel', packId,
    })).status).toBe(200);
    // …even one that collides with a name the bundle carries
    const collides = seedSkill(7);
    await sql!`update skills set author_id = ${george.id}::uuid where pack_id = ${packId}::uuid and name = ${collides.name}`;
    await sql!`update skills set body = 'MINE, NOT THE BUNDLE''S' where pack_id = ${packId}::uuid and name = ${collides.name}`;
    await sql!`update skill_packs set version = 'bundled@older' where id = ${packId}::uuid`;

    expect(await j(await seedDefaults())).toMatchObject({ refreshed: 1 });

    const own = (await skillRow('my-house-rule'))!;
    expect(own['status']).toBe('active'); // not swept, though the bundle never heard of it
    expect(own['body']).toBe('MY BODY');
    expect((await skillRow(collides.name))!['body']).toBe("MINE, NOT THE BUNDLE'S"); // not overwritten
  });

  it('an IMPORTED pack wearing a bundled name is never touched', async () => {
    // channel names are unique per room, so if a human's import owns the name, the bundled seed
    // stands down entirely rather than overwriting somebody's repo with ours
    const projectId = (await sql!`select id from projects where workspace_id = ${ws}::uuid and is_default`)[0]!['id'] as string;
    expect((await send(george, { type: 'channel.create', workspace: ws, project: projectId, slug: 'imports', topic: 'x' })).status).toBe(200);
    const chId = (await sql!`select id from channels where workspace_id = ${ws}::uuid and slug = 'imports'`)[0]!['id'] as string;
    expect((await send(george, {
      type: 'skillpack.create', workspace: ws, channel: chId, name: 'gstack',
      description: 'my fork', sourceUrl: 'https://example.com/fork', sourceRef: 'main', origin: 'imported',
    })).status).toBe(200);
    await sql!`update skill_packs set version = 'sha-of-my-fork', status = 'ready' where channel_id = ${chId}::uuid and name = 'gstack'`;

    const r = await j(await send(george, { type: 'skillpack.seed_defaults', workspace: ws, channel: chId }));
    expect(r).toMatchObject({ added: SKILL_SEED.length - 1, refreshed: 0 }); // the others still land

    const mine = (await sql!`select version, origin, description from skill_packs where channel_id = ${chId}::uuid and name = 'gstack'`)[0]!;
    expect(mine['version']).toBe('sha-of-my-fork');
    expect(mine['origin']).toBe('imported');
    expect(mine['description']).toBe('my fork');
  });
});

// The case that started this: marketing-os's NeuraMesh preambles live on our side of the vendored
// pin, so round 3 rewrote every body and left `bundled@bb67dff5f04b` byte-identical. A marketing
// room seeded before that round kept serving its agents the old preambles, forever.
describe.skipIf(!DB)('the marketing-os case (kind = marketing, two seed lists)', () => {
  const OS = MARKETING_OS_SKILL_SEED[0]!;
  let mktId = '';
  let osPackId = '';
  const seedMarketing = () => send(george, { type: 'skillpack.seed_defaults', workspace: ws, channel: mktId, kind: 'marketing' });

  it('a marketing room takes BOTH lists, each at its content-derived version', async () => {
    mktId = (await sql!`select id from channels where workspace_id = ${ws}::uuid and slug = 'marketing'`)[0]!['id'] as string;
    const r = await j(await seedMarketing());
    expect(r).toMatchObject({ added: MARKETING_SKILL_SEED.length + MARKETING_OS_SKILL_SEED.length, refreshed: 0 });
    const row = (await sql!`select id, version from skill_packs where channel_id = ${mktId}::uuid and name = ${OS.pack.name}`)[0]!;
    osPackId = row['id'] as string;
    expect(row['version']).toBe(bundledPackVersion(OS));
  });

  it('a room holding the bare pin takes the new preambles; the build room is untouched', async () => {
    const skill = OS.skills[0]!;
    await sql!`update skill_packs set version = ${OS.pack.version} where id = ${osPackId}::uuid`; // the pre-fix state
    await sql!`update skills set body = 'PREAMBLE FROM ROUND 2' where pack_id = ${osPackId}::uuid and name = ${skill.name}`;

    expect(await j(await seedMarketing())).toMatchObject({ added: 0, refreshed: 1 });

    const fresh = (await sql!`select body from skills where pack_id = ${osPackId}::uuid and name = ${skill.name}`)[0]!;
    expect(fresh['body']).toBe(skill.body);
    expect(fresh['body']).toContain('## In NeuraMesh'); // the preamble the round-3 fix rewrote
    // the build room's packs share no names with these, so a marketing re-seed never reaches them
    expect((await packRow())['version']).toBe(bundledPackVersion(GSTACK));
  });
});
