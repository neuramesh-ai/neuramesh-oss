// Whiteboards (docs/38): the two write lanes and the one guard between them.
//
// The COMMAND lane (agents + the desktop materializer) is strict — baseRev must equal the
// board's rev or the write is WHITEBOARD_STALE, so nothing clobbers silently. The ROW lane
// (the desktop's local-first autosave, forwarded by PowerSync uploadData) is LWW — highest
// rev wins and a stale patch is ACKed as applied:false, because a throwing autosave wedges
// the whole upload queue behind one lost race (the v0.29.2 phone-wedge class).
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const sol: Actor = { kind: 'agent', id: 'a-sol', role: 'developer' };

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

const hdr = (actor: Actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
const cmd = (actor: Actor, body: unknown) =>
  app.request('/v1/commands', { method: 'POST', headers: hdr(actor), body: JSON.stringify(body) });
const put = (actor: Actor, body: unknown) =>
  app.request('/v1/whiteboards', { method: 'POST', headers: hdr(actor), body: JSON.stringify(body) });
const patch = (actor: Actor, id: string, body: unknown) =>
  app.request(`/v1/whiteboards/${id}`, { method: 'PATCH', headers: hdr(actor), body: JSON.stringify(body) });

async function makeRoom(): Promise<string> {
  const proj = await j(await cmd(george, { type: 'project.create', workspace: 'ws_acme', name: 'Mesh' }));
  const chan = await j(await cmd(george, { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'dev' }));
  return chan.channelId as string;
}

const SCENE = JSON.stringify({ elements: [{ type: 'rectangle', x: 0, y: 0 }], appState: { viewBackgroundColor: '#ffffff' } });

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('whiteboard.create — the agent door', () => {
  it('an agent births a board from mermaid; the source waits for a desktop to materialize', async () => {
    const ch = await makeRoom();
    const res = await cmd(sol, { type: 'whiteboard.create', channel: ch, title: 'wake pipeline', mermaid: 'flowchart LR; a-->b' });
    expect(res.status).toBe(200);
    const { whiteboardId } = await j(res);
    const row = await store.getWhiteboard(whiteboardId);
    expect(row?.scene).toBeNull();
    expect(JSON.parse(row!.source!)).toEqual({ kind: 'mermaid', value: 'flowchart LR; a-->b' });
    expect(row?.rev).toBe(1);
    expect(row?.createdByKind).toBe('agent');
  });

  it('exactly one generation source — none or both is refused', async () => {
    const ch = await makeRoom();
    const none = await cmd(sol, { type: 'whiteboard.create', channel: ch, title: 'x' });
    expect(none.status).toBe(422);
    const both = await cmd(sol, { type: 'whiteboard.create', channel: ch, title: 'x', mermaid: 'flowchart', elements: '[{"type":"rectangle"}]' });
    expect(both.status).toBe(422);
  });

  it('elements must parse as a non-empty JSON array', async () => {
    const ch = await makeRoom();
    expect((await cmd(sol, { type: 'whiteboard.create', channel: ch, title: 'x', elements: 'not json' })).status).toBe(422);
    expect((await cmd(sol, { type: 'whiteboard.create', channel: ch, title: 'x', elements: '{}' })).status).toBe(422);
    expect((await cmd(sol, { type: 'whiteboard.create', channel: ch, title: 'x', elements: '[]' })).status).toBe(422);
    expect((await cmd(sol, { type: 'whiteboard.create', channel: ch, title: 'x', elements: '[{"type":"rectangle","x":0,"y":0}]' })).status).toBe(200);
  });
});

describe('the row lane — local-first create + LWW autosave', () => {
  it('PUT is idempotent on the client-minted id (a replay neither duplicates nor errors)', async () => {
    const ch = await makeRoom();
    const id = crypto.randomUUID();
    const body = { id, workspace: 'ws_acme', channel: ch, title: 'sync map', scene: SCENE, rev: 1 };
    expect((await put(george, body)).status).toBe(200);
    expect((await put(george, body)).status).toBe(200);
    const list = await store.listWhiteboards({ channel: ch });
    expect(list.length).toBe(1);
    expect(list[0]!.createdByKind).toBe('human');
  });

  it('PATCH applies only a higher rev, and ACKs (never throws) when stale or unknown', async () => {
    const ch = await makeRoom();
    const id = crypto.randomUUID();
    await put(george, { id, workspace: 'ws_acme', channel: ch, title: 'sync map', scene: SCENE, rev: 1 });
    const up = await patch(george, id, { rev: 2, title: 'offline sync map' });
    expect(await j(up)).toEqual({ applied: true });
    // the same rev replayed — the race's loser — is acknowledged, not an error
    const replay = await patch(george, id, { rev: 2, title: 'a different loser' });
    expect(await j(replay)).toEqual({ applied: false });
    expect((await store.getWhiteboard(id))?.title).toBe('offline sync map');
    // a patch for a row whose create is still in flight elsewhere: ACKed too
    const ghost = await patch(george, crypto.randomUUID(), { rev: 3, title: 'ghost' });
    expect(await j(ghost)).toEqual({ applied: false });
  });

  it('archive rides the same lane as a tri-state (set, then clear)', async () => {
    const ch = await makeRoom();
    const id = crypto.randomUUID();
    await put(george, { id, workspace: 'ws_acme', channel: ch, title: 'old sketch', rev: 1 });
    await patch(george, id, { rev: 2, archivedAt: new Date().toISOString() });
    expect((await store.listWhiteboards({ channel: ch })).length).toBe(0);
    expect((await store.listWhiteboards({ channel: ch, includeArchived: true })).length).toBe(1);
    await patch(george, id, { rev: 3, archivedAt: null });
    expect((await store.listWhiteboards({ channel: ch })).length).toBe(1);
  });
});

describe('whiteboard.update — the strict lane', () => {
  async function agentBoard(ch: string): Promise<string> {
    const { whiteboardId } = await j(await cmd(sol, { type: 'whiteboard.create', channel: ch, title: 'wake pipeline', mermaid: 'flowchart LR; a-->b' }));
    return whiteboardId;
  }

  it('materialize realizes the source into a scene + snapshot and clears it, one winner', async () => {
    const ch = await makeRoom();
    const id = await agentBoard(ch);
    const res = await cmd(george, { type: 'whiteboard.update', whiteboardId: id, baseRev: 1, scene: SCENE, snapshotSvg: '<svg/>', clearSource: true });
    expect(res.status).toBe(200);
    expect((await j(res)).rev).toBe(2);
    const row = await store.getWhiteboard(id);
    expect(row?.source).toBeNull();
    expect(row?.scene).toBe(SCENE);
    expect(row?.snapshotRev).toBe(2);
    // the second desktop racing the same materialize built on rev 1 — refused, no clobber
    const loser = await cmd(george, { type: 'whiteboard.update', whiteboardId: id, baseRev: 1, scene: SCENE, snapshotSvg: '<svg/>', clearSource: true });
    expect(loser.status).toBe(409);
    expect((await j(loser)).code).toBe('WHITEBOARD_STALE');
  });

  it('an agent edit lands a NEW source on the current rev; a stale baseRev is refused', async () => {
    const ch = await makeRoom();
    const id = await agentBoard(ch);
    await cmd(george, { type: 'whiteboard.update', whiteboardId: id, baseRev: 1, scene: SCENE, snapshotSvg: '<svg/>', clearSource: true });
    const edit = await cmd(sol, { type: 'whiteboard.update', whiteboardId: id, baseRev: 2, mermaid: 'flowchart LR; a-->b-->c' });
    expect(edit.status).toBe(200);
    const row = await store.getWhiteboard(id);
    expect(JSON.parse(row!.source!).value).toContain('c');
    expect(row?.scene).toBe(SCENE); // the old scene stays until the next materialize
    const stale = await cmd(sol, { type: 'whiteboard.update', whiteboardId: id, baseRev: 2, mermaid: 'flowchart TD; x' });
    expect(stale.status).toBe(409);
  });

  it('materialize with nothing pending, or without its scene, is invalid input', async () => {
    const ch = await makeRoom();
    const id = await agentBoard(ch);
    expect((await cmd(george, { type: 'whiteboard.update', whiteboardId: id, baseRev: 1, clearSource: true })).status).toBe(422);
    await cmd(george, { type: 'whiteboard.update', whiteboardId: id, baseRev: 1, scene: SCENE, snapshotSvg: '<svg/>', clearSource: true });
    const again = await cmd(george, { type: 'whiteboard.update', whiteboardId: id, baseRev: 2, scene: SCENE, clearSource: true });
    expect(again.status).toBe(422);
  });

  it('an archived board refuses the command lane', async () => {
    const ch = await makeRoom();
    const id = await agentBoard(ch);
    await patch(george, id, { rev: 2, archivedAt: new Date().toISOString() });
    const res = await cmd(sol, { type: 'whiteboard.update', whiteboardId: id, baseRev: 2, mermaid: 'flowchart TD; x' });
    expect(res.status).toBe(409);
    expect((await j(res)).code).toBe('CONFLICT');
  });

  it('a title-only rename is a legal update; an empty update is not', async () => {
    const ch = await makeRoom();
    const id = await agentBoard(ch);
    expect((await cmd(sol, { type: 'whiteboard.update', whiteboardId: id, baseRev: 1, title: 'triage flow' })).status).toBe(200);
    expect((await store.getWhiteboard(id))?.title).toBe('triage flow');
    expect((await cmd(sol, { type: 'whiteboard.update', whiteboardId: id, baseRev: 2 })).status).toBe(422);
  });
});

describe('the reads', () => {
  it('list scopes by channel or workspace, hides archived by default, and stays meta-only', async () => {
    const ch = await makeRoom();
    await cmd(sol, { type: 'whiteboard.create', channel: ch, title: 'one', mermaid: 'flowchart LR; a' });
    await cmd(sol, { type: 'whiteboard.create', channel: ch, title: 'two', mermaid: 'flowchart LR; b' });
    const byChannel = await j(await app.request(`/v1/whiteboards?channel=${ch}`, { headers: hdr(sol) }));
    expect(byChannel.whiteboards.length).toBe(2);
    expect(byChannel.whiteboards[0]).not.toHaveProperty('scene');
    expect(byChannel.whiteboards[0].hasSource).toBe(true);
    const byWorkspace = await j(await app.request(`/v1/whiteboards?workspace=ws_acme`, { headers: hdr(sol) }));
    expect(byWorkspace.whiteboards.length).toBe(2);
    const neither = await app.request('/v1/whiteboards', { headers: hdr(sol) });
    expect(neither.status).toBe(400);
  });

  it('detail carries scene + source but never the snapshot bytes', async () => {
    const ch = await makeRoom();
    const { whiteboardId } = await j(await cmd(sol, { type: 'whiteboard.create', channel: ch, title: 'wake', mermaid: 'flowchart LR; a' }));
    await cmd(george, { type: 'whiteboard.update', whiteboardId, baseRev: 1, scene: SCENE, snapshotSvg: '<svg/>', clearSource: true });
    const detail = await j(await app.request(`/v1/whiteboards/${whiteboardId}`, { headers: hdr(sol) }));
    expect(detail.whiteboard.scene).toBe(SCENE);
    expect(detail.whiteboard).not.toHaveProperty('snapshotSvg');
    expect(detail.whiteboard.hasSnapshot).toBe(true);
    expect((await app.request(`/v1/whiteboards/${crypto.randomUUID()}`, { headers: hdr(sol) })).status).toBe(404);
  });
});
