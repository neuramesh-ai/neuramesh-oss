// Runs (docs/29): the durable row behind a stretch of agent work. Opened by the agent, stepped
// live, settled into a terminal state — descriptive, never gating. These tests pin the rules the
// dead-air bug needed: a human can't fake one, only the owner may update it, a settled run never
// reopens, and a parent never leaves its legs pulsing.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const scout: Actor = { kind: 'agent', id: 'scout', role: 'reviewer' };

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
function send(actor: Actor, body: unknown) {
  return app.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}
const openWork = (extra: Record<string, unknown> = {}) =>
  send(rex, { type: 'run.open', workspace: 'ws_acme', channel: 'ch_general', kind: 'work', title: 'Research: how to improve Flowe', total: 3, ...extra });

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('runs: open (docs/29)', () => {
  it('an agent opens a run and gets its id back', async () => {
    const res = await openWork();
    expect(res.status).toBe(200);
    const { runId } = await j(res);
    const run = await store.getRun(runId);
    expect(run).toMatchObject({ kind: 'work', title: 'Research: how to improve Flowe', state: 'running', done: 0, total: 3, agentId: 'rex' });
  });

  it('a HUMAN cannot open a run — a run is evidence of agent work, not a claim anyone can make', async () => {
    const res = await send(george, { type: 'run.open', workspace: 'ws_acme', channel: 'ch_general', kind: 'work', title: 'fake work' });
    expect(res.status).toBe(403);
  });

  it('opening with the same id twice is idempotent — a retried post must not fork the row', async () => {
    const id = crypto.randomUUID();
    await openWork({ id });
    await openWork({ id, title: 'a different title' });
    const run = await store.getRun(id);
    expect(run?.title).toBe('Research: how to improve Flowe'); // first write wins
    expect((await store.listOpenRuns('ws_acme')).length).toBe(1);
  });

  it('a leg carries its parent — the fan-out is a foreign key', async () => {
    const { runId: parent } = await j(await openWork());
    const { runId: leg } = await j(await send(rex, { type: 'run.open', workspace: 'ws_acme', channel: 'ch_general', parentRunId: parent, kind: 'leg', title: 'user reviews' }));
    expect((await store.getRun(leg))?.parentRunId).toBe(parent);
  });
});

describe('runs: step + settle (docs/29)', () => {
  it('the owner steps the live line and progress', async () => {
    const { runId } = await j(await openWork());
    expect((await send(rex, { type: 'run.step', runId, step: 'searching “ultradian rhythm”', done: 1 })).status).toBe(200);
    expect(await store.getRun(runId)).toMatchObject({ step: 'searching “ultradian rhythm”', done: 1, total: 3 });
  });

  it('an omitted field is left alone — a leg bumping `done` cannot blank another writer\'s step', async () => {
    const { runId } = await j(await openWork());
    await send(rex, { type: 'run.step', runId, step: 'reading g2.com' });
    await send(rex, { type: 'run.step', runId, done: 2 });
    expect(await store.getRun(runId)).toMatchObject({ step: 'reading g2.com', done: 2 });
  });

  it('a DIFFERENT agent cannot touch someone else\'s run', async () => {
    const { runId } = await j(await openWork());
    expect((await send(scout, { type: 'run.step', runId, step: 'hijacked' })).status).toBe(403);
    expect((await send(scout, { type: 'run.settle', runId, state: 'done' })).status).toBe(403);
  });

  it('a human cannot settle a run either — the agent that owns the work closes it', async () => {
    const { runId } = await j(await openWork());
    expect((await send(george, { type: 'run.settle', runId, state: 'done' })).status).toBe(403);
  });

  it('settling closes the run with its summary and stamps ended_at', async () => {
    const { runId } = await j(await openWork());
    await send(rex, { type: 'run.settle', runId, state: 'done', summary: '3 angles · report posted' });
    const run = await store.getRun(runId);
    expect(run).toMatchObject({ state: 'done', summary: '3 angles · report posted' });
    expect(run?.endedAt).toBeTruthy();
    expect(await store.listOpenRuns('ws_acme')).toEqual([]);
  });

  it('a settled run never reopens — a late step is ignored, not an error', async () => {
    const { runId } = await j(await openWork());
    await send(rex, { type: 'run.settle', runId, state: 'done' });
    expect((await send(rex, { type: 'run.step', runId, step: 'still going!' })).status).toBe(200);
    expect(await store.getRun(runId)).toMatchObject({ state: 'done', step: null });
  });

  it('the FIRST settle wins — the finally-block backstop cannot overwrite a real failure', async () => {
    const { runId } = await j(await openWork());
    await send(rex, { type: 'run.settle', runId, state: 'failed', summary: 'the leg timed out' });
    await send(rex, { type: 'run.settle', runId, state: 'done', summary: 'all good' }); // the `finally`
    expect(await store.getRun(runId)).toMatchObject({ state: 'failed', summary: 'the leg timed out' });
  });

  it('settling a parent settles its live legs — a closed card must never keep pulsing rows', async () => {
    const { runId: parent } = await j(await openWork());
    const { runId: legA } = await j(await send(rex, { type: 'run.open', workspace: 'ws_acme', channel: 'ch_general', parentRunId: parent, kind: 'leg', title: 'reviews' }));
    const { runId: legB } = await j(await send(rex, { type: 'run.open', workspace: 'ws_acme', channel: 'ch_general', parentRunId: parent, kind: 'leg', title: 'competitors' }));
    await send(rex, { type: 'run.settle', runId: legA, state: 'done', summary: '12 sources' });
    await send(rex, { type: 'run.settle', runId: parent, state: 'failed', summary: 'host went offline' });
    expect(await store.getRun(legA)).toMatchObject({ state: 'done', summary: '12 sources' }); // already closed, untouched
    expect(await store.getRun(legB)).toMatchObject({ state: 'stopped' });                     // stranded → stopped
    expect(await store.listOpenRuns('ws_acme')).toEqual([]);
  });

  it('an unknown run is a 404, not a silent success', async () => {
    expect((await send(rex, { type: 'run.settle', runId: crypto.randomUUID(), state: 'done' })).status).toBe(404);
  });
});
