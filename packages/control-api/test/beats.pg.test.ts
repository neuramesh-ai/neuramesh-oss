// Beats (docs/17) against the REAL schema (migration 0058) — validates the pgstore SQL:
// the beat_status cast, the case-based started/done stamping, and the latest-run subquery.
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';

const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const patch: Actor = { kind: 'agent', id: '30000000-0000-0000-0000-000000000003', role: 'worker' };

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

describe.skipIf(!DB)('beats on postgres (real schema, migration 0058)', () => {
  it('declares, stamps, and advances against real pg; gates humans; re-declare opens a new run', async () => {
    const { task } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'beats pg task', kind: 'bug' }));
    expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200); // → in_progress, patch (worker)

    const decl = await send(patch, { type: 'beats.declare', taskId: task.id, phase: 'in_progress', items: ['reproduce', 'fix', 'test'] });
    expect(decl.status).toBe(200);
    expect((await j(decl)).runId).toBeTruthy();

    const beats = await store!.listBeats(task.id);
    expect(beats.map((b) => [b.seq, b.status])).toEqual([[0, 'pending'], [1, 'pending'], [2, 'pending']]);
    expect(beats.every((b) => b.role === 'worker' && b.phase === 'in_progress')).toBe(true);

    // advance: 0 → active → done; 1 → active — the case expressions stamp started_at/done_at
    await send(patch, { type: 'beats.advance', taskId: task.id, seq: 0, status: 'active' });
    await send(patch, { type: 'beats.advance', taskId: task.id, seq: 0, status: 'done' });
    await send(patch, { type: 'beats.advance', taskId: task.id, seq: 1, status: 'active' });
    const b2 = await store!.listBeats(task.id);
    expect(b2[0]!.status).toBe('done');
    expect(b2[0]!.startedAt).toBeTruthy();
    expect(b2[0]!.doneAt).toBeTruthy();
    expect(b2[1]!.status).toBe('active');
    expect(b2[1]!.startedAt).toBeTruthy();
    expect(b2[1]!.doneAt).toBeNull();
    expect(b2[2]!.status).toBe('pending');

    // a human is refused
    expect((await send(george, { type: 'beats.declare', taskId: task.id, phase: 'in_progress', items: ['x'] })).status).toBe(403);

    // a re-declare opens a NEW run; advance targets the latest one (the subquery), leaving the first intact
    await send(patch, { type: 'beats.declare', taskId: task.id, phase: 'in_progress', items: ['redo'] });
    await send(patch, { type: 'beats.advance', taskId: task.id, seq: 0, status: 'done' });
    const all = await store!.listBeats(task.id);
    const runs = [...new Set(all.map((b) => b.runId))];
    expect(runs.length).toBe(2);
    const latest = all.filter((b) => b.runId === runs[runs.length - 1]!);
    expect(latest[0]!.status).toBe('done');
  });

  it('acceptance settles a still-active beat on real pg (the settleBeats SQL + backstop)', async () => {
    const gem: Actor = { kind: 'agent', id: '40000000-0000-0000-0000-000000000004', role: 'reviewer' };
    const { task } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'beats settle pg', kind: 'bug' }));
    expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200);
    await send(patch, { type: 'beats.declare', taskId: task.id, phase: 'in_progress', items: ['fix', 'verify', 'never ran'] });
    await send(patch, { type: 'beats.advance', taskId: task.id, seq: 0, status: 'done' });
    await send(patch, { type: 'beats.advance', taskId: task.id, seq: 1, status: 'active' });
    expect((await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['repro'] })).status).toBe(200);
    expect((await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'doc', name: 'settle.md' }] })).status).toBe(200);
    expect((await send(gem, { type: 'task.approve', taskId: task.id })).status).toBe(200);
    expect((await send(george, { type: 'task.accept', taskId: task.id })).status).toBe(200);
    const beats = await store!.listBeats(task.id);
    expect(beats.map((b) => b.status)).toEqual(['done', 'done', 'pending']); // active settled, pending honest
    expect(beats[1]!.doneAt).toBeTruthy();
  });
});
