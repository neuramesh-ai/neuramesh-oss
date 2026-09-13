// The browser asks its cloud machine for a draft's picture through the thread the draft lives in —
// the same marker the card's button posts — instead of refusing (George, 2026-09-05).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { contentOverrides } from './webnm-content';

const cfg = { apiUrl: '', powersyncUrl: '', clerkSessionId: async () => null, clerkBearer: async () => null, relayBearer: async () => null, actorId: () => 'u1', workspaceId: () => 'w1' };

function fakeDb(item: Record<string, unknown> | null, taskThread: string | null = null) {
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    getAll: async (sql: string) => {
      if (sql.includes('from content_items where id = ?')) return item ? [item] : [];
      if (sql.includes('from threads where task_id = ?')) return taskThread ? [{ id: taskThread }] : [];
      return [];
    },
    execute: async (sql: string, params: unknown[]) => { inserts.push({ sql, params }); },
  };
  return { db, inserts };
}
const draft = { status: 'draft', platform: 'x', body: 'Breathing exercises calm you for five minutes, then the loop comes back.', channel_id: 'c1', thread_id: 't1', task_id: null };

describe('draftImage from a tab', () => {
  test('Generate posts the gen-image marker into the draft’s own thread and reports pending', async () => {
    const { db, inserts } = fakeDb(draft);
    const r = await contentOverrides(cfg, db as never).draftImage!('ci-1');
    assert.deepEqual(r, { ok: true, pending: true });
    assert.equal(inserts.length, 1);
    assert.ok(inserts[0]!.sql.includes('insert into messages'));
    const p = inserts[0]!.params;
    assert.equal(p[2], 'c1', 'the draft’s room'); assert.equal(p[3], 't1', 'the draft’s thread');
    assert.ok(String(p[10]).includes('‹gen-image:ci-1›'), 'the marker the host answers without a model turn');
  });
  test('a rewrite asks in words — the marketer’s revise turn redraws — and names the draft and the angle', async () => {
    const { db, inserts } = fakeDb(draft);
    const r = await contentOverrides(cfg, db as never).draftImage!('ci-1', { rewrite: true, angle: 'lead with the founder' });
    assert.deepEqual(r, { ok: true, pending: true });
    const body = String(inserts[0]!.params[10]);
    assert.ok(!body.includes('gen-image'), 'no marker: the marker path draws the EXISTING brief');
    assert.ok(body.includes('Rewrite the x draft that begins “Breathing exercises') && body.includes('lead with the founder'));
  });
  test('a task-anchored draft asks in the task’s thread', async () => {
    const { db, inserts } = fakeDb({ ...draft, thread_id: null, task_id: 'task-9' }, 'thread-of-task-9');
    await contentOverrides(cfg, db as never).draftImage!('ci-1');
    assert.equal(inserts[0]!.params[3], 'thread-of-task-9');
  });
  test('honest refusals: not a draft, or no conversation to ask in', async () => {
    const scheduled = await contentOverrides(cfg, fakeDb({ ...draft, status: 'scheduled' }).db as never).draftImage!('ci-1');
    assert.equal(scheduled.ok, false); assert.match(scheduled.error!, /only a draft/);
    const orphan = await contentOverrides(cfg, fakeDb({ ...draft, thread_id: null, task_id: null }).db as never).draftImage!('ci-1');
    assert.equal(orphan.ok, false); assert.match(orphan.error!, /no conversation/);
    const gone = await contentOverrides(cfg, fakeDb(null).db as never).draftImage!('ci-1');
    assert.equal(gone.ok, false); assert.match(gone.error!, /isn’t available/);
  });
});
