// Runs (docs/29) against the REAL schema (migration 0096) — validates the pgstore SQL the memory
// store can't: the run_state cast, the idempotent on-conflict open, the coalesce-based partial
// step patch, and the parent→legs settle. Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const CH = 'c0000000-0000-0000-0000-00000000000b'; // #dev

const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
// `runs.agent_id` is a REAL foreign key to agents — which the first CI run proved by rejecting
// hand-made uuids. Both actors are registered agents, exactly as they are in production.
let rex: Actor;
let patch: Actor;

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

afterAll(async () => {
  await store?.close();
});

describe.skipIf(!DB)('runs on postgres (real schema, migration 0096)', () => {
  beforeAll(async () => {
    if (!DB) return;
    const mach = await j(await send(george, { type: 'machine.register', workspace: WS, name: 'runs-rig', platform: 'darwin', daemonVersion: '0.1.0' }));
    const r = await j(await send(george, { type: 'agent.register', workspace: WS, machineId: mach.machineId, name: 'runs-rex', role: 'orchestrator', channels: ['dev'] }));
    const p = await j(await send(george, { type: 'agent.register', workspace: WS, machineId: mach.machineId, name: 'runs-patch', role: 'worker', channels: ['dev'] }));
    rex = { kind: 'agent', id: r.agentId, role: 'orchestrator' };
    patch = { kind: 'agent', id: p.agentId, role: 'worker' };
  });

  it('opens idempotently, steps partially, and settles the whole tree', async () => {
    const id = crypto.randomUUID();
    const open = await send(rex, { type: 'run.open', id, workspace: WS, channel: CH, kind: 'work', title: 'Research: how to improve Flowe', total: 3, step: 'starting the legs' });
    expect(open.status).toBe(200);
    expect((await j(open)).runId).toBe(id);

    // the same id twice must not fork a second row (on conflict do nothing)
    await send(rex, { type: 'run.open', id, workspace: WS, channel: CH, kind: 'work', title: 'a different title' });
    const open1 = await store!.listOpenRuns(WS);
    expect(open1.filter((r) => r.id === id).length).toBe(1);
    expect(open1.find((r) => r.id === id)?.title).toBe('Research: how to improve Flowe');

    // a partial patch: `done` alone must not blank the step the other writer set
    await send(rex, { type: 'run.step', runId: id, step: 'searching “ultradian rhythm focus”' });
    await send(rex, { type: 'run.step', runId: id, done: 2 });
    expect(await store!.getRun(id)).toMatchObject({ step: 'searching “ultradian rhythm focus”', done: 2, total: 3 });

    // legs hang off the parent by foreign key
    const { runId: legA } = await j(await send(rex, { type: 'run.open', workspace: WS, channel: CH, parentRunId: id, kind: 'leg', title: 'user reviews' }));
    const { runId: legB } = await j(await send(rex, { type: 'run.open', workspace: WS, channel: CH, parentRunId: id, kind: 'leg', title: 'competitor landscape' }));
    await send(rex, { type: 'run.settle', runId: legA, state: 'done', summary: '12 sources' });

    // gates hold against the real store too
    expect((await send(george, { type: 'run.open', workspace: WS, channel: CH, kind: 'work', title: 'human work' })).status).toBe(403);
    expect((await send(patch, { type: 'run.settle', runId: id, state: 'done' })).status).toBe(403);

    // settling the parent settles the stranded leg, and never re-closes the settled one
    await send(rex, { type: 'run.settle', runId: id, state: 'failed', summary: 'host went offline' });
    expect(await store!.getRun(id)).toMatchObject({ state: 'failed', summary: 'host went offline' });
    expect((await store!.getRun(id))?.endedAt).toBeTruthy();
    expect(await store!.getRun(legA)).toMatchObject({ state: 'done', summary: '12 sources' });
    expect(await store!.getRun(legB)).toMatchObject({ state: 'stopped' });
    expect((await store!.listOpenRuns(WS)).some((r) => [id, legA, legB].includes(r.id))).toBe(false);

    // a settled run never reopens
    await send(rex, { type: 'run.step', runId: id, step: 'still going!' });
    expect((await store!.getRun(id))?.step).toBe('searching “ultradian rhythm focus”');
  });
});
