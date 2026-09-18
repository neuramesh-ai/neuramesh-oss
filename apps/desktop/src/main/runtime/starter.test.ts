// The Starter worker lane's pure parts (runtime/starter.ts): the seat rule, the workspace jail the
// file tools stand behind, the toolset a turn gets, and the loud failure when no lane was set.
// Run from apps/desktop: pnpm exec tsx --test src/main/runtime/starter.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_MODEL } from '@neuramesh/shared';
import { busToolsForStarter, insideDir, isStarterSeat, setStarterLane, starterComplete } from './starter';

test('the seat rule: the house model with no token of the user\'s own is the Starter lane', () => {
  assert.equal(isStarterSeat(STARTER_MODEL, ''), true);
  assert.equal(isStarterSeat(STARTER_MODEL, null), true);
  assert.equal(isStarterSeat(STARTER_MODEL, 'AIza-user-key'), false); // their key, their bill
  assert.equal(isStarterSeat('gemini-3.5-flash', ''), false);
  assert.equal(isStarterSeat('claude-sonnet-5', ''), false);
});

test('the file tools never leave the workspace', () => {
  const dir = '/tmp/nm-ws/nm-1094';
  assert.equal(insideDir(dir, 'posts.json'), '/tmp/nm-ws/nm-1094/posts.json');
  assert.equal(insideDir(dir, '.nm-evidence/design/a.html'), '/tmp/nm-ws/nm-1094/.nm-evidence/design/a.html');
  assert.equal(insideDir(dir, '../secrets.txt'), null);
  assert.equal(insideDir(dir, '/etc/passwd'), null);
  assert.equal(insideDir(dir, 'a/../../b'), null);
  assert.equal(insideDir(dir, ''), null);
});

test('a work turn gets the bus tools the host can service, in the loop\'s shape', () => {
  const tools = busToolsForStarter('work', {
    dir: '/tmp/x',
    recordLesson: async () => ({ ok: true }),
    addBacklogItem: async () => ({ ok: true, number: 1 }),
    beats: { declare: () => 'ok', complete: () => 'ok' },
  });
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['add_backlog_item', 'add_subtask', 'advance_beat', 'declare_beats', 'record_lesson']);
  for (const t of tools) { assert.equal(typeof t.run, 'function'); assert.equal(typeof t.description, 'string'); assert.equal(typeof t.schema, 'object'); }
});

test('a leg turn never sees add_subtask, and no closure means no tool (the bus rules, unchanged)', () => {
  const names = busToolsForStarter('leg', { dir: '/tmp/x', addBacklogItem: async () => ({ ok: true }), recordLesson: async () => ({ ok: true }) }).map((t) => t.name).sort();
  assert.deepEqual(names, ['record_lesson']);
  assert.deepEqual(busToolsForStarter('work', { dir: '/tmp/x' }), []);
});

test('with no lane set, the proxy is never reached — it fails loudly', async () => {
  setStarterLane(null);
  await assert.rejects(() => starterComplete('sys', 'hi'), /Starter lane is not configured/);
});
