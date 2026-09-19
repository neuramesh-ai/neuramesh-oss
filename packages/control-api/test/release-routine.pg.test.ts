// The release routine on postgres (release-drafts plan §4.2 and §4.8): the nested jsonb merge behind
// schedule.set_cursor, the routines marketing.setup plants, and the announcements store's rows.
// Runs only against a real database (scripts/test-pg.sh); rls.pg.test.ts covers the new tables' RLS.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const WS = 'a0000000-0000-0000-0000-00000000000a';
const REPO = 'b0000000-0000-0000-0000-000000000001'; // acme/marketing-site, from the fixtures
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const plume: Actor = { kind: 'agent', id: 'plume', role: 'marketer' };
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
}

afterAll(async () => { await sql?.end(); await store?.close?.(); });

describe.skipIf(!DB)('the release routine on postgres', () => {
  it('marketing.setup plants the one-shot and the daily watch, and set_cursor merges into payload.release', async () => {
    const proj = await j(await send(george, { type: 'project.create', workspace: WS, name: `Release pg ${Date.now()}` }));
    const chan = await j(await send(george, { type: 'channel.create', workspace: WS, project: proj.projectId, slug: `mk-${Date.now().toString(36)}` }));
    await send(george, { type: 'channel.set_kind', channel: chan.channelId, kind: 'marketing' });
    await sql!`update workspaces set plan = 'cloud' where id = ${WS}::uuid`;
    const r = await j(await send(george, { type: 'marketing.setup', channel: chan.channelId, website: 'https://acme.dev', releases: { repoId: REPO, slug: 'acme/marketing-site', now: true, watch: true, at: '09:00', tz: 'UTC' } }));
    expect(r.releases).toEqual({ now: true, watch: 'armed' });
    const rows = await sql!`select id, cadence, payload from schedules where channel_id = ${chan.channelId}::uuid and title like 'Release drafts%' order by cadence`;
    expect(rows.map((x) => x['cadence'])).toEqual(['daily', 'once']);
    const daily = rows.find((x) => x['cadence'] === 'daily')!;
    const payload = daily['payload'] as { routine: boolean; prompt: string; release: { repo: string; slug: string; cursor: { tag: null } } };
    expect(payload.routine).toBe(true);
    expect(payload.prompt).toBe('Run the release drafts playbook.');
    expect(payload.release.repo).toBe(REPO);
    expect(payload.release.cursor.tag).toBeNull();
    // the finish line, from the daemon lane
    const at = '2026-09-17T09:00:00.000Z';
    expect((await send(plume, { type: 'schedule.set_cursor', schedule: daily['id'], cursor: { at, tag: 'v0.134.0' }, log: { at, key: 'v0.134.0', note: 'v0.134.0 · 1 release · 3 merged' } })).status).toBe(200);
    expect((await send(plume, { type: 'schedule.set_cursor', schedule: daily['id'], cursor: { at, tag: 'v0.134.0' }, log: { at, key: null, note: 'nothing new since v0.134.0' } })).status).toBe(200);
    const [after] = await sql!`select payload from schedules where id = ${daily['id'] as string}::uuid`;
    const rel = (after!['payload'] as { release: { repo: string; slug: string; cursor: unknown; log: unknown[] } }).release;
    expect(rel.cursor).toEqual({ at, tag: 'v0.134.0' });
    expect(rel.log).toHaveLength(2);
    expect(rel.repo).toBe(REPO); // the rest of the release payload survives the merge
    // a plain routine has no cursor to move
    const once = rows.find((x) => x['cadence'] === 'once')!;
    expect((await send(plume, { type: 'schedule.set_cursor', schedule: once['id'], cursor: { at, tag: null } })).status).toBe(200); // the one-shot carries `release` too
    const plain = await j(await send(george, { type: 'schedule.create', channel: chan.channelId, title: 'Plain', prompt: 'say hi', cadence: 'daily', routine: true }));
    expect((await send(plume, { type: 'schedule.set_cursor', schedule: plain.scheduleId, cursor: { at, tag: null } })).status).toBe(422);
  });

  it('the announcements store: create, claim the queue, update, the image bytes, the caps, the claim, the installations', async () => {
    const ann = store!.announcements;
    const email = `pg-${Date.now()}@example.dev`;
    const made = await ann.create({ repo: 'Neuramesh-AI/Neuramesh-OSS', tag: 'v0.134.0', website: 'neuramesh.app', email, private: false, installationId: null, ipHash: 'abc' });
    expect(made).not.toBeNull();
    expect(await ann.create({ repo: 'neuramesh-ai/neuramesh-oss', tag: 'v0.134.0', website: 'neuramesh.app', email, private: false, installationId: null, ipHash: 'abc' })).toBeNull();
    const found = await ann.find({ repo: 'neuramesh-ai/neuramesh-oss', tag: 'v0.134.0', email });
    expect(found?.id).toBe(made!.id);
    expect(found?.status).toBe('queued');
    const claimed = await ann.claimQueued(50);
    expect(claimed.some((r) => r.id === made!.id)).toBe(true);
    expect((await ann.get(made!.id))?.status).toBe('reading');
    await ann.update(made!.id, { status: 'ready', brief: '# Release brief · v0.134.0', posts: [{ platform: 'x', body: 'hi' }], readyAt: new Date().toISOString(), digest: { candidate: { key: 'v0.134.0' } } });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 8, 9]);
    await ann.setImage(made!.id, bytes, 'image/png');
    const img = await ann.image(made!.id);
    expect(img?.mime).toBe('image/png');
    expect([...img!.bytes]).toEqual([...bytes]);
    const row = (await ann.get(made!.id))!;
    expect(row.status).toBe('ready');
    expect(row.posts).toEqual([{ platform: 'x', body: 'hi' }]);
    expect(row.imageMime).toBe('image/png');
    expect((row.digest as { candidate: { key: string } }).candidate.key).toBe('v0.134.0');
    expect(await ann.countSince({ email, sinceIso: new Date(Date.now() - 60_000).toISOString() })).toBe(1);
    expect(await ann.countSince({ ipHash: 'abc', sinceIso: new Date(Date.now() - 60_000).toISOString() })).toBeGreaterThanOrEqual(1);
    expect(await ann.countSince({ email, sinceIso: new Date(Date.now() + 60_000).toISOString() })).toBe(0);
    await ann.claim(made!.id, { userId: george.id, workspaceId: WS, threadId: '11111111-1111-4111-8111-111111111111' });
    expect((await ann.get(made!.id))?.claimedThreadId).toBe('11111111-1111-4111-8111-111111111111');
    await ann.upsertInstallation({ installationId: 424242, account: 'neuramesh-ai', repos: ['Neuramesh-AI/Release-Drafts-Test'] });
    await ann.upsertInstallation({ installationId: 424242, account: 'neuramesh-ai', repos: ['neuramesh-ai/release-drafts-test', 'neuramesh-ai/other'] });
    expect(await ann.installationForRepo('NEURAMESH-AI/other')).toEqual({ installationId: 424242 });
    expect(await ann.installationForRepo('neuramesh-ai/nope')).toBeNull();
  });

  it('the claim on postgres: a ready row becomes a project, its marketing room, the session, the brief and the post cards', async () => {
    // the live harness answered 500 here: the claim ran its commands past the schema, so the
    // defaults the handlers rely on never applied and postgres saw an undefined description
    const ann = store!.announcements;
    const email = `pg-claim-${Date.now()}@example.dev`;
    const made = (await ann.create({ repo: `neuramesh-ai/claim-${Date.now().toString(36)}`, tag: 'v0.1.0', website: 'neuramesh.app', email, private: false, installationId: null, ipHash: 'claim' }))!;
    await ann.claimQueued(50);
    await ann.update(made.id, {
      status: 'ready', readyAt: new Date().toISOString(),
      brief: '# Release brief · v0.1.0\nVerdict: feature · Basis: release notes\n\n## Why\nThe shared inbox brings support replies into one place.\n\n## Audience\nSupport teams.\n\n## Assets\nThe card.\n\n## What I could not determine\nNothing.',
      posts: [{ platform: 'x', body: 'The shared inbox is here.' }, { platform: 'instagram', body: 'One inbox.', imageBrief: 'the release card' }],
      digest: { candidate: { key: 'v0.1.0', tag: 'v0.1.0', name: 'v0.1.0', notes: 'A shared inbox.', publishedAt: '2026-09-18T02:40:17Z', url: null, source: 'release', prs: [] }, skipped: 0 },
    });
    await ann.setImage(made.id, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), 'image/png');
    const res = await app!.request(`/v1/announce/${made.id}/claim`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) }, body: JSON.stringify({ workspace: WS }) });
    const out = await j(res);
    expect(res.status, JSON.stringify(out)).toBe(200);
    expect(out.threadId).toBeTruthy();
    const [project] = await sql!`select id, website from projects where id = ${out.projectId as string}::uuid`;
    expect(project!['website']).toBe('https://neuramesh.app');
    const [channel] = await sql!`select kind, project_id from channels where id = ${out.channelId as string}::uuid`;
    expect(channel!['kind']).toBe('marketing');
    const posts = await sql!`select platform from content_items where thread_id = ${out.threadId as string}::uuid order by platform`;
    expect(posts.map((r) => r['platform'])).toEqual(['instagram', 'x']);
    const briefs = await sql!`select name from artifacts where channel_id = ${out.channelId as string}::uuid and name like 'release-report-%'`;
    expect(briefs).toHaveLength(1);
    expect((await ann.get(made.id))?.claimedThreadId).toBe(out.threadId);
    // a second claim of the same row answers the same session
    const again = await j(await app!.request(`/v1/announce/${made.id}/claim`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) }, body: JSON.stringify({ workspace: WS }) }));
    expect(again).toMatchObject({ threadId: out.threadId, already: true });
  });
});
