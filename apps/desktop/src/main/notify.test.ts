// Desktop-notification engine (Feature A). Drives startNotifications with a fake db + a spy notifier
// (no electron) to prove: needs-human cards fire, only when unfocused + enabled, deduped; and a task
// reaching 'done' pings only on a NEW transition. Run from apps/desktop:
//   pnpm exec tsx --test src/main/notify.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startNotifications, setNotificationsEnabled, needsHumanMessage, preview, type WatchableDb } from './notify';

// a fake db that captures each watch's onResult so the test can drive ticks. cbs[0] = the message
// watch, cbs[1] = the done-task watch (in registration order).
function fakeDb() {
  const cbs: Array<(rows: unknown[]) => void> = [];
  const db: WatchableDb = { watch: (_sql, _params, cb) => { cbs.push((rows) => cb.onResult({ rows: { _array: rows } })); } };
  return { db, fireMsg: (rows: unknown[]) => cbs[0]!(rows), fireDone: (rows: unknown[]) => cbs[1]!(rows) };
}

test('needsHumanMessage: only agent-authored nmq / nmauth cards qualify', () => {
  assert.ok(needsHumanMessage({ author_kind: 'agent', body: 'go?\n```nmq\n{}\n```', slug: 'dev', number: null }));
  assert.ok(needsHumanMessage({ author_kind: 'agent', body: '```nmauth\n{}\n```', slug: 'dev', number: 7 }));
  assert.equal(needsHumanMessage({ author_kind: 'agent', body: 'just chatting', slug: 'dev', number: null }), null);
  // a human's own message must never ping the human
  assert.equal(needsHumanMessage({ author_kind: 'human', body: '```nmq\n{}\n```', slug: 'dev', number: null }), null);
});

test('preview strips fenced blocks + markdown to a readable line', () => {
  assert.equal(preview('**Approve** the plan?\n```nmq\n{"x":1}\n```'), 'Approve the plan?');
});

test('fires for a question card when unfocused; not focused; deduped; respects the toggle', () => {
  setNotificationsEnabled(true);
  let focused = false;
  const fired: Array<{ title: string; body: string }> = [];
  const { db, fireMsg } = fakeDb();
  startNotifications(db, { isFocused: () => focused, notifier: (n) => fired.push(n) });

  const card = (id: string) => [{ id, channel_id: 'c1', task_id: 't9', author_kind: 'agent', body: '```nmq\n{"question":"go?"}\n```', slug: 'dev', number: 42 }];
  fireMsg(card('m1'));
  assert.equal(fired.length, 1, 'fires when the app is unfocused');
  assert.match(fired[0]!.title, /#42/);

  fireMsg(card('m1')); // same message id re-delivered by a later watch tick
  assert.equal(fired.length, 1, 'deduped by message id');

  focused = true;
  fireMsg(card('m2'));
  assert.equal(fired.length, 1, 'no ping while the app is focused (theyre already looking)');

  focused = false;
  setNotificationsEnabled(false);
  fireMsg(card('m3'));
  assert.equal(fired.length, 1, 'no ping when the toggle is off');
  setNotificationsEnabled(true);
});

test('task → done pings only on a NEW transition (baseline the first tick)', () => {
  setNotificationsEnabled(true);
  const fired: Array<{ title: string }> = [];
  const { db, fireDone } = fakeDb();
  startNotifications(db, { isFocused: () => false, notifier: (n) => fired.push(n) });

  fireDone([{ id: 't1', number: 1, title: 'A', channel_id: 'c1' }]); // baseline of already-done tasks
  assert.equal(fired.length, 0, 'tasks already done at app start dont ping');
  fireDone([{ id: 't1', number: 1, title: 'A', channel_id: 'c1' }, { id: 't2', number: 2, title: 'B', channel_id: 'c1' }]);
  assert.equal(fired.length, 1, 'a newly-done task pings');
  assert.match(fired[0]!.title, /#2 is ready to accept/);
});

test('does nothing when OS notifications arent supported', () => {
  const fired: unknown[] = [];
  const { db, fireMsg } = fakeDb();
  startNotifications(db, { isFocused: () => false, notifier: () => fired.push(1), supported: () => false });
  // no watches were registered, so there's nothing to fire
  assert.throws(() => fireMsg([]), /cbs\[0\]|undefined|is not a function|Cannot read/);
  assert.equal(fired.length, 0);
});
