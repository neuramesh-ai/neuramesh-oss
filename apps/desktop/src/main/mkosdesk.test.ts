// The Marketing OS bar's rules (the desk round, 2026-09-17; docs/design/marketing-os-desk-2026-09).
// Run from apps/desktop: pnpm exec tsx --test src/main/mkosdesk.test.ts
//
// One page, one bar: the lit word follows the section under the bar, a click lands the section's
// head under the bar, the chips' counts agree with the catalog, a row rests on the newest state
// across the rooms in scope, and the scripted scroll rides the signature ease.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYBOOKS } from '@neuramesh/shared';
import { groupCounts, newestState, scrollTargetFor, sectionAt, signatureEase, type DeskState } from '../renderer/src/views/mkosdesk';

test('the group chips count the whole catalog, and the groups sum to All', () => {
  const c = groupCounts();
  assert.equal(c.all, PLAYBOOKS.length);
  assert.equal(c.foundations + c.content + c.campaigns, c.all);
  assert.ok(c.foundations > 0 && c.content > 0 && c.campaigns > 0);
});

test('the section under the bar: playbooks until the threads head reaches the bar, then threads', () => {
  const g = { threadsTop: 800, barHeight: 42, maxScroll: 1200 };
  assert.equal(sectionAt({ ...g, scrollTop: 0 }), 'playbooks');
  assert.equal(sectionAt({ ...g, scrollTop: 700 }), 'playbooks');
  assert.equal(sectionAt({ ...g, scrollTop: 758 }), 'threads');   // 758 + 42 = 800: the head is under the bar
  assert.equal(sectionAt({ ...g, scrollTop: 1100 }), 'threads');
});

test('a short page still gives the threads their word at the bottom, and a page that cannot scroll never does', () => {
  // the threads head can never reach the bar (the list is short), but the scroller is at its end
  assert.equal(sectionAt({ scrollTop: 300, threadsTop: 900, barHeight: 42, maxScroll: 300 }), 'threads');
  assert.equal(sectionAt({ scrollTop: 0, threadsTop: 900, barHeight: 42, maxScroll: 0 }), 'playbooks');
});

test('a click lands the section head under the bar, clamped to the scroller, and playbooks means the top', () => {
  assert.equal(scrollTargetFor('playbooks', { threadsTop: 800, barHeight: 42, maxScroll: 1200 }), 0);
  assert.equal(scrollTargetFor('threads', { threadsTop: 800, barHeight: 42, maxScroll: 1200 }), 758);
  assert.equal(scrollTargetFor('threads', { threadsTop: 800, barHeight: 42, maxScroll: 500 }), 500);
  assert.equal(scrollTargetFor('threads', { threadsTop: 20, barHeight: 42, maxScroll: 500 }), 0);
});

test('the signature ease starts at 0, ends at 1, never goes backwards, and eases out', () => {
  assert.equal(signatureEase(0), 0);
  assert.equal(signatureEase(1), 1);
  let last = 0;
  for (let i = 1; i <= 100; i++) {
    const y = signatureEase(i / 100);
    assert.ok(y >= last - 1e-9, `not monotonic at ${i / 100}: ${y} < ${last}`);
    assert.ok(y <= 1 + 1e-9);
    last = y;
  }
  assert.ok(signatureEase(0.5) > 0.8, 'an ease-out is past 80% at the half-way mark');
  assert.ok(signatureEase(0.1) > 0.1, 'it leaves fast');
});

test('a catalog row rests on the newest state across the rooms in scope, never on an empty one', () => {
  const none: DeskState = { lastAt: null, lastScore: null, armed: null };
  const old: DeskState = { lastAt: '2026-09-01T00:00:00.000Z', lastScore: 54, armed: null };
  const fresh: DeskState = { lastAt: '2026-09-14T00:00:00.000Z', lastScore: 72, armed: null };
  const armed: DeskState = { lastAt: null, lastScore: null, armed: 'weekly' };
  assert.equal(newestState([{ roomId: 'a', state: undefined }, { roomId: 'b', state: none }]), null);
  assert.deepEqual(newestState([{ roomId: 'a', state: old }, { roomId: 'b', state: fresh }, { roomId: 'c', state: none }]), { roomId: 'b', state: fresh });
  assert.deepEqual(newestState([{ roomId: 'a', state: armed }, { roomId: 'b', state: none }]), { roomId: 'a', state: armed });
  // a run beats an armed-but-never-run cadence: the run has a date, the cadence has none
  assert.deepEqual(newestState([{ roomId: 'a', state: armed }, { roomId: 'b', state: old }]), { roomId: 'b', state: old });
});
