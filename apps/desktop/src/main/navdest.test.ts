import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navDestRows, navMoreRows } from '../renderer/src/shell/navdest';
const base = { nav: 'home', view: 'dashboard' };
test('one unified band in the requested order', () => {
  assert.deepEqual(navDestRows(base).map(r => r.label), ['Marketing', 'Finance', 'Agent Desk', 'Automations', 'Customizations', 'More']);
});
test('every destination selects exactly its own door, including nested lenses', () => {
  for (const [nav, view, key] of [
    ['home','marketing','marketing'], ['home','finance','finance'], ['home','automations','scheduled'],
    ['home','calendar','scheduled'], ['home','skills','customizations'], ['home','connections','customizations'],
    ['home','whiteboards','more'], ['artifacts','dashboard','more'], ['home','engineering','more'], ['home','board','more'],
    ['agents','dashboard','team'], ['home','worktrees','more']
  ] as const) assert.deepEqual(navDestRows({nav,view}).filter(r=>r.on).map(r=>r.key), [key]);
  assert.deepEqual(navDestRows(base).filter(r=>r.on), []);
});
test('More preserves access to files, whiteboards and older coding work', () => {
  const rows = navMoreRows({ nav: 'home', view: 'engineering' });
  assert.equal(rows.find(r=>r.key==='legacy')?.on, true);
  assert.equal(navDestRows({ nav: 'home', view: 'engineering' }).find(r=>r.key==='more')?.inside, 'Legacy coding sessions');
  assert.ok(rows.some(r=>r.key==='library'));
  assert.ok(rows.some(r=>r.key==='tasks'));
  assert.ok(!rows.some(r=>r.key==='code'));
});
