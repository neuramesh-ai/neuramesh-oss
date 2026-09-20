// The Shortcuts band (the shell-simplification round, 2026-08-16; the Scheduled fold retired
// 2026-09-20). Run from apps/desktop: pnpm exec tsx --test src/main/navdest.test.ts
//
// Scheduled used to be a fold with two child rows and four rules that kept the fold honest. The
// pair moved onto the page as the room tab strip (George: one item in the rail, the tabs in the
// main area), so the band is plain rows again and two things are left to hold: exactly one row
// wears the fill, and Scheduled wears it on EITHER of its surfaces — one door, two lenses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEDULED_VIEWS, isScheduledView, navDestRows } from '../renderer/src/shell/navdest';

const base = { nav: 'home', view: 'dashboard' };
const keys = (i: Partial<typeof base> & { mode?: 'chat' | 'code' } = {}) => navDestRows({ ...base, ...i }).map((r) => r.key);
const row = (k: string, i: Partial<typeof base> = {}) => navDestRows({ ...base, ...i }).find((r) => r.key === k)!;

test('the band is five plain rows — Home and Tasks are gone, and the Scheduled children with them', () => {
  const k = keys();
  assert.ok(!k.includes('home'), 'Home left for the bell');
  assert.ok(!k.includes('board'), 'Tasks left for nothing — the board is deprecating');
  assert.ok(!k.includes('automations') && !k.includes('calendar'), 'Routines and Calendar are tabs on the page, not rows');
  // …and Code closes the band: a door onto the mode for the launch (George, 2026-09-05)
  assert.deepEqual(k, ['whiteboards', 'scheduled', 'library', 'marketing', 'code']);
});

test('exactly one fill in the band, wherever you stand', () => {
  for (const [nav, view] of [['home', 'dashboard'], ['home', 'whiteboards'], ['home', 'automations'], ['home', 'calendar'], ['home', 'marketing'], ['artifacts', 'dashboard'], ['home', 'engineering']] as const) {
    const on = navDestRows({ nav, view }).filter((r) => r.on);
    assert.ok(on.length <= 1, `nav=${nav} view=${view} lit ${on.length} rows`);
  }
  assert.equal(row('library', { nav: 'artifacts' }).on, true);
  assert.equal(row('whiteboards', { view: 'whiteboards' }).on, true);
  assert.equal(row('marketing', { view: 'marketing' }).on, true);
  assert.equal(row('scheduled').on, false, 'Home does not light Scheduled');
});

test('Scheduled is lit on either of its surfaces — one door, two lenses', () => {
  assert.equal(row('scheduled', { view: 'automations' }).on, true);
  assert.equal(row('scheduled', { view: 'calendar' }).on, true);
  assert.equal(row('scheduled', { view: 'whiteboards' }).on, false);
  assert.equal(row('scheduled', { nav: 'artifacts', view: 'calendar' }).on, false, 'the view keys mean nothing outside nav=home');
  // the predicate the band's door and the page's head share, so the two cannot disagree
  assert.deepEqual([...SCHEDULED_VIEWS], ['automations', 'calendar']);
  assert.equal(isScheduledView('home', 'automations'), true);
  assert.equal(isScheduledView('home', 'calendar'), true);
  assert.equal(isScheduledView('home', 'dashboard'), false);
  assert.equal(isScheduledView('artifacts', 'automations'), false);
});

test('no row carries a count — inventory is not attention, and attention lives on the bell', () => {
  for (const r of navDestRows(base)) assert.ok(!('count' in r), `${r.key} carries a count`);
});

test('Code is a MODE with a DOOR in the Chat band: the row never wears the fill and Code mode never lists it (George, 2026-09-05)', () => {
  // no `engineering` view row in either mode (rail-ink round) — the floor is what the mode opens
  assert.equal(navDestRows({ nav: 'home', view: 'engineering' }).some((r) => r.key === 'engineering'), false);
  assert.equal(navDestRows({ nav: 'home', view: 'engineering', mode: 'code' }).some((r) => r.key === 'engineering'), false);
  // …but the Chat band ends with a Code row for the launch, a door and not a destination
  const chat = navDestRows({ nav: 'home', view: 'engineering', mode: 'chat' });
  assert.equal(chat[chat.length - 1]?.key, 'code', 'last row, under Marketing OS');
  assert.deepEqual(chat.filter((r) => r.key === 'code').map((r) => r.on), [false], 'never lit');
  assert.equal(navDestRows({ nav: 'home', view: 'engineering', mode: 'code' }).some((r) => r.key === 'code'), false, 'Code mode has its own band');
});

test('code mode: the band lists the board and the worktrees, and nothing else (rail-ink round)', () => {
  const rows = navDestRows({ nav: 'home', view: 'footprint', mode: 'code' });
  assert.deepEqual(rows.map((r) => r.key), ['tasks', 'footprint']);
  assert.deepEqual(rows.map((r) => r.on), [false, true]);
  assert.equal(navDestRows({ nav: 'home', view: 'board', mode: 'chat' }).some((r) => r.key === 'tasks'), false, 'Chat mode is unchanged');
});
