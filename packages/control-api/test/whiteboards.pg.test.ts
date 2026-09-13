// Whiteboards (docs/38) against REAL postgres — the jsonb-scalar regression.
//
// postgres.js JSON-serializes a STRING parameter aimed at a jsonb column into a jsonb string
// SCALAR (the brain_override lesson). Caught LIVE (2026-08-05): both write lanes stored
// scene/source as jsonb strings — unreadable double-encoded text on every OTHER device, while
// the writing machine read its own local row and looked fine. MemoryStore cannot see this
// class at all; only the real driver can, which is why this file exists.
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';

const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const sol: Actor = { kind: 'agent', id: '30000000-0000-0000-0000-000000000003', role: 'developer' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

const hdr = (actor: Actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
const cmd = (actor: Actor, body: unknown) =>
  app!.request('/v1/commands', { method: 'POST', headers: hdr(actor), body: JSON.stringify(body) });

// boards file by channel ID — make a real room rather than borrowing the fixtures' slug
async function makeRoom(): Promise<string> {
  const proj = await j(await cmd(george, { type: 'project.create', workspace: WS, name: `wb-probe-${crypto.randomUUID().slice(0, 8)}` }));
  const chan = await j(await cmd(george, { type: 'channel.create', workspace: WS, project: proj.projectId, slug: `wb-${crypto.randomUUID().slice(0, 8)}` }));
  return chan.channelId as string;
}

const SCENE = JSON.stringify({ elements: [{ type: 'rectangle', x: 0, y: 0 }], appState: { viewBackgroundColor: '#ffffff' } });
const SCENE2 = JSON.stringify({ elements: [{ type: 'ellipse', x: 40, y: 40 }] });

afterAll(async () => {
  await store?.close();
  await sql?.end();
});

describe.skipIf(!DB)('whiteboards on postgres — jsonb columns hold OBJECTS, never string scalars', () => {
  it('create (source), materialize (scene), and the LWW patch all land as jsonb objects', async () => {
    const ch = await makeRoom();
    const res = await cmd(sol, { type: 'whiteboard.create', channel: ch, title: 'pg jsonb probe', mermaid: 'flowchart LR; a-->b' });
    expect(res.status).toBe(200);
    const { whiteboardId } = await j(res);

    const [afterCreate] = await sql!`select jsonb_typeof(source) as src from whiteboards where id = ${whiteboardId}::uuid`;
    expect(afterCreate!['src']).toBe('object');

    // materialize: the strict lane writes the realized scene
    expect((await cmd(george, { type: 'whiteboard.update', whiteboardId, baseRev: 1, scene: SCENE, snapshotSvg: '<svg/>', clearSource: true })).status).toBe(200);
    const [afterMat] = await sql!`select jsonb_typeof(scene) as sc, source from whiteboards where id = ${whiteboardId}::uuid`;
    expect(afterMat!['sc']).toBe('object');
    expect(afterMat!['source']).toBeNull();

    // the LWW autosave lane (uploadData's PATCH)
    const patch = await app!.request(`/v1/whiteboards/${whiteboardId}`, { method: 'PATCH', headers: hdr(george), body: JSON.stringify({ rev: 3, scene: SCENE2 }) });
    expect(await j(patch)).toEqual({ applied: true });
    const [afterPatch] = await sql!`select jsonb_typeof(scene) as sc from whiteboards where id = ${whiteboardId}::uuid`;
    expect(afterPatch!['sc']).toBe('object');

    // and the API read round-trips to a PARSEABLE OBJECT — the exact thing the renderer does;
    // under the scalar bug this parse yields a STRING and every remote replica shows an empty board
    const detail = await j(await app!.request(`/v1/whiteboards/${whiteboardId}`, { headers: hdr(sol) }));
    const scene = JSON.parse(detail.whiteboard.scene) as { elements?: unknown[] };
    expect(Array.isArray(scene.elements)).toBe(true);
  });
});
