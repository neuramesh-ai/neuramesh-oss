// The Shortcuts band and the Scheduled fold (the shell-simplification round, 2026-08-16).
// Run from apps/desktop: pnpm exec tsx --test src/main/navdest.test.ts
//
// Four rules were turned on by the submenu rebuild, and each one is here because the shipped
// nesting broke it: the children were route-gated, the parent was half-selected, the disclosure
// moved on its own, and the parent was a second door to its own default child.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEDULED_SEC, navDestRows } from '../renderer/src/shell/navdest';

const base = { nav: 'home', view: 'dashboard', scheduledFolded: false, routines: 3, calendar: 7 };
const keys = (i: Partial<typeof base> = {}) => navDestRows({ ...base, ...i }).map((r) => r.key);
const row = (k: string, i: Partial<typeof base> = {}) => navDestRows({ ...base, ...i }).find((r) => r.key === k)!;

test('the band includes the two owned OS destinations — Home and Tasks are gone', () => {
  const k = keys();
  assert.ok(!k.includes('home'), 'Home left for the bell');
  assert.ok(!k.includes('board'), 'Tasks left for nothing — the board is deprecating');
  // …and Code closes the band: a door onto the mode for the launch (George, 2026-09-05)
  assert.deepEqual(k, ['whiteboards', 'scheduled', 'automations', 'calendar', 'library', 'marketing', 'code']);
});

test('① the children are present wherever you stand — never route-gated', () => {
  // the shipped bug: Routines/Calendar existed only while `view` was already one of them, so
  // Calendar was two clicks from everywhere else and the second door did not exist until the first
  for (const view of ['dashboard', 'whiteboards', 'board', 'skills', 'memory']) {
    const k = keys({ view });
    assert.ok(k.includes('automations') && k.includes('calendar'), `children missing on view=${view}`);
  }
});

test('② exactly one fill in the band, and the parent never carries it', () => {
  for (const [nav, view] of [['home', 'dashboard'], ['home', 'whiteboards'], ['home', 'automations'], ['home', 'calendar'], ['home', 'marketing'], ['artifacts', 'dashboard']] as const) {
    const rows = navDestRows({ ...base, nav, view });
    const on = rows.filter((r) => r.on);
    assert.ok(on.length <= 1, `nav=${nav} view=${view} lit ${on.length} rows`);
    assert.equal(rows.find((r) => r.tier === 'parent')!.on, false, 'the parent must never wear the fill');
  }
  assert.equal(row('calendar', { view: 'calendar' }).on, true);
  assert.equal(row('automations', { view: 'automations' }).on, true);
  assert.equal(row('library', { nav: 'artifacts' }).on, true);
  assert.equal(row('whiteboards', { view: 'whiteboards' }).on, true);
  assert.equal(row('marketing', { view: 'marketing' }).on, true);
});

test('② …and standing inside the group tints the parent instead — a different signal in kind', () => {
  assert.equal(row('scheduled', { view: 'automations' }).inGroup, true);
  assert.equal(row('scheduled', { view: 'calendar' }).inGroup, true);
  assert.equal(row('scheduled', { view: 'whiteboards' }).inGroup, false);
  // and `inGroup` is the parent's alone — a child never claims to be the group
  assert.equal(row('calendar', { view: 'calendar' }).inGroup, false);
});

test('③ the fold is the human’s: only `scheduledFolded` hides the children, never the route', () => {
  assert.deepEqual(keys({ scheduledFolded: true }), ['whiteboards', 'scheduled', 'library', 'marketing', 'code']);
  // …even while you are standing inside the section, which is when the route used to force it open
  assert.deepEqual(keys({ scheduledFolded: true, view: 'calendar' }), ['whiteboards', 'scheduled', 'library', 'marketing', 'code']);
  assert.equal(row('scheduled', { scheduledFolded: true, view: 'calendar' }).inGroup, true, 'folded still says you are in here');
});

test('④ a fold must not cost information — folded, the parent carries the summed count', () => {
  assert.equal(row('scheduled', { scheduledFolded: true }).count, 10);
  assert.equal(row('scheduled', { scheduledFolded: false }).count, 0, 'expanded, the children carry their own');
  assert.equal(row('automations').count, 3);
  assert.equal(row('calendar').count, 7);
  // nothing armed and nothing scheduled: no badge at all rather than a "0"
  assert.equal(row('scheduled', { scheduledFolded: true, routines: 0, calendar: 0 }).count, 0);
});

test('inventory and owned OS destinations never carry a count — inventory is not attention', () => {
  assert.equal(row('whiteboards').count, 0);
  assert.equal(row('library').count, 0);
  assert.equal(row('marketing').count, 0);
});

test('the fold key is shared, so the band and the shell toggle the same store entry', () => {
  assert.equal(SCHEDULED_SEC, 'scheduled');
});

test('Code is a MODE with a DOOR in the Chat band: the row never wears the fill and Code mode never lists it (George, 2026-09-05)', () => {
  // no `engineering` view row in either mode (rail-ink round) — the floor is what the mode opens
  assert.equal(navDestRows({ nav: 'home', view: 'engineering', scheduledFolded: false, routines: 0, calendar: 0 }).some((r) => r.key === 'engineering'), false);
  assert.equal(navDestRows({ nav: 'home', view: 'engineering', scheduledFolded: false, routines: 0, calendar: 0, mode: 'code' }).some((r) => r.key === 'engineering'), false);
  // …but the Chat band ends with a Code row for the launch, a door and not a destination
  const chat = navDestRows({ nav: 'home', view: 'engineering', scheduledFolded: false, routines: 0, calendar: 0, mode: 'chat' });
  assert.equal(chat[chat.length - 1]?.key, 'code', 'last row, under Marketing OS');
  assert.deepEqual(chat.filter((r) => r.key === 'code').map((r) => [r.on, r.inGroup, r.count, r.tier]), [[false, false, 0, 'item']], 'never lit, never counted');
  assert.equal(navDestRows({ nav: 'home', view: 'engineering', scheduledFolded: false, routines: 0, calendar: 0, mode: 'code' }).some((r) => r.key === 'code'), false, 'Code mode has its own band');
});

test('code mode: the band lists the board and the worktrees, and nothing else (rail-ink round)', () => {
  const rows = navDestRows({ nav: 'home', view: 'footprint', scheduledFolded: false, routines: 2, calendar: 12, mode: 'code' });
  assert.deepEqual(rows.map((r) => r.key), ['tasks', 'footprint']);
  assert.deepEqual(rows.map((r) => r.on), [false, true]);
  assert.ok(rows.every((r) => r.count === 0), 'no badges: counts are inventory, and pull requests are the board\'s own rows');
  assert.equal(navDestRows({ nav: 'home', view: 'board', scheduledFolded: false, routines: 0, calendar: 0, mode: 'chat' }).some((r) => r.key === 'tasks'), false, 'Chat mode is unchanged');
});
