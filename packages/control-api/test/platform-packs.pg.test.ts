// The platform's own pack refreshes at API boot (platform-packs.ts, George, 2026-11-24): a room that holds
// neuramesh-work from before publish-page gets the skill with no machine boot, and an agent in any room of the
// workspace finds it, because skill discovery reads the whole workspace (desktop host/workspace-skills.ts). A disabled
// pack stays off, a person's edit stays, and a room with no copy gets none.
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@neuramesh/shared';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';
import { refreshPlatformPacks } from '../src/platform-packs';
import { bundledPackVersion } from '../src/seed/packversion';
import { TASK_SKILL_SEED } from '../src/seed/task-skill-seed';

const DB = process.env['DATABASE_URL'];
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB, { onnotice: () => {} }) : null;
const WORK = TASK_SKILL_SEED[0]!;

let ws = '', build = '', general = '';
const pack = async (channel: string) => (await sql!`select id, version, enabled from skill_packs where channel_id = ${channel}::uuid and name = ${WORK.pack.name}`)[0];
// the discovery seam of the host, in Postgres words: active, enabled, and the pack enabled, in any room of the workspace
const discoverable = async (name: string) => (await sql!`select s.name from skills s left join skill_packs p on p.id = s.pack_id
  where s.workspace_id = ${ws}::uuid and s.status = 'active' and s.enabled and (s.pack_id is null or p.enabled) and s.name = ${name}`).length > 0;
// a room seeded before publish-page: an older version, and no publish-page row
const stale = async (packId: string) => {
  await sql!`update skill_packs set version = 'bundled@old' where id = ${packId}::uuid`;
  await sql!`delete from skills where pack_id = ${packId}::uuid and name = 'publish-page'`;
};

beforeAll(async () => {
  if (!DB) return;
  const res = await app!.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) },
    body: JSON.stringify({ type: 'workspace.create', name: 'Platform Packs', slug: 'platform-packs' }) });
  expect(res.status).toBe(200);
  ws = (await sql!`select id from workspaces where slug = 'platform-packs'`)[0]!['id'] as string;
  build = (await sql!`select id from channels where workspace_id = ${ws}::uuid and slug = 'build'`)[0]!['id'] as string;
  general = (await sql!`select id from channels where workspace_id = ${ws}::uuid and slug = 'general'`)[0]!['id'] as string;
});

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('the platform pack refreshes at API boot', () => {
  it('gives a room with an older neuramesh-work the publish-page skill, and an agent in #general finds it', async () => {
    const p = await pack(build);
    await stale(p!['id'] as string);
    expect(await discoverable('publish-page')).toBe(false);
    const r = await refreshPlatformPacks(sql!, { workspace: ws });
    expect(r.failed).toBe(0);
    expect(r.refreshed).toBeGreaterThanOrEqual(1);
    expect((await pack(build))!['version']).toBe(bundledPackVersion(WORK));
    // #general holds no copy of the pack, and its agents still find the skill
    expect(await pack(general)).toBeUndefined();
    expect(await discoverable('publish-page')).toBe(true);
    // a second boot finds nothing to do here
    await refreshPlatformPacks(sql!, { workspace: ws });
    expect((await pack(build))!['version']).toBe(bundledPackVersion(WORK));
  });

  it('keeps a disabled pack off and a skill that a person changed, and gives no copy to a room without one', async () => {
    const p = await pack(build);
    const id = p!['id'] as string;
    await stale(id);
    await sql!`update skill_packs set enabled = false where id = ${id}::uuid`;
    await sql!`update skills set body = 'our own handoff rules', version = 2 where pack_id = ${id}::uuid and name = 'task-handoff'`;
    await refreshPlatformPacks(sql!, { workspace: ws });
    expect((await pack(build))!['enabled']).toBe(false);
    expect((await sql!`select body from skills where pack_id = ${id}::uuid and name = 'task-handoff'`)[0]!['body']).toBe('our own handoff rules');
    expect((await sql!`select 1 from skills where pack_id = ${id}::uuid and name = 'publish-page' and status = 'active'`).length).toBe(1);
    expect(await pack(general)).toBeUndefined();
    await sql!`update skill_packs set enabled = true where id = ${id}::uuid`;
  });
});
