// A card's click is no word, on the REAL schema (the review of round 2, 2026-10-05). The verdict card's
// Approve applies task.approve as the person, the 0051 trigger stamps approved_at as the task enters
// done, and then the card posts "**…** → Approve #N" as the person. That answer is newer than the
// verdict, so the floor read it as the word an agent accept needs, and every reply on a done unit now
// wakes the orchestrator. The memory twin is pinned in accept-on-word.test.ts; this file holds the pg
// store to the same rule. Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';

const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: '30000000-0000-0000-0000-000000000003', role: 'worker' };
const gem: Actor = { kind: 'agent', id: '40000000-0000-0000-0000-000000000004', role: 'reviewer' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const tick = () => new Promise((r) => setTimeout(r, 20));
const as = (actor: Actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
const send = (actor: Actor, body: unknown) => app!.request('/v1/commands', { method: 'POST', headers: as(actor), body: JSON.stringify(body) });
async function say(actor: Actor, taskId: string, body: string): Promise<void> {
  await tick();
  const res = await app!.request('/v1/messages', { method: 'POST', headers: as(actor), body: JSON.stringify({ workspace: WS, channel: 'dev', taskId, body }) });
  expect(res.status).toBeLessThan(300);
}

afterAll(async () => {
  await store?.close();
});

describe.skipIf(!DB)('the accept floor on postgres', () => {
  it('the verdict card\'s answer is no word, and the person\'s typed "merge it" after it is', async () => {
    const { task } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: `card click is no word ${Date.now()}`, kind: 'docs' }));
    expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200);
    expect((await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['scope agreed'] })).status).toBe(200);
    expect((await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'doc', name: 'notes.md' }] })).status).toBe(200);
    await tick();
    expect((await j(await send(gem, { type: 'task.approve', taskId: task.id }))).task.state).toBe('done');
    // what hq's VerdictCard posts after its Approve applied the verdict
    await say(george, task.id, `**Approve #${task.number} — card click is no word?** → Approve #${task.number}`);
    const refused = await send(rex, { type: 'task.accept', taskId: task.id });
    expect(refused.status).toBe(403);
    expect((await j(refused)).code).toBe('HUMAN_ONLY');
    await say(george, task.id, 'merge it');
    const ok = await send(rex, { type: 'task.accept', taskId: task.id });
    expect(ok.status).toBe(200);
    expect((await j(ok)).task.state).toBe('accepted');
  });
});
