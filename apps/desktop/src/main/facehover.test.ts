// The workspace face's hover contract (2026-08-16; click-only 2026-08-20).
// Run from apps/desktop: pnpm exec tsx --test src/main/facehover.test.ts
//
// This suite exists for two shipped bugs. First the flip: the workspace foot rendered INSIDE the
// rooms face, so opening the projects face hid the foot, fired its `mouseleave`, scheduled a
// close, brought the foot back under the cursor, and opened it again — forever (George, live).
// Then the accident: even with the intent delay, a cursor passing the foot on its way elsewhere
// swapped the whole nav column (George, live, 2026-08-20). The CONTRACT now: hover opens
// NOTHING — only a click (bar · avatar · ⌘⇧P) shows the face, every open face is pinned, and
// nothing that can fire from inside the column may schedule a dismissal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOVER_OUT, INSIDE_EVENTS, faceCannotSelfDismiss, faceHover, initialFace,
  type FaceHoverEvent, type FaceState,
} from '../renderer/src/shell/facehover';

/** drive a sequence; `settle` stands in for the timer firing */
const run = (events: FaceHoverEvent['type'][], from: FaceState = initialFace()) =>
  events.reduce((s, type) => faceHover(s, { type } as FaceHoverEvent), from);

test('hovering the foot opens NOTHING — the column must never swap under a passing cursor', () => {
  // 2026-08-20: the intent delay was not enough; an accidental sweep still traded the whole
  // nav for the workspace face. Hover arms nothing now — however long it settles.
  const hovered = faceHover(initialFace(), { type: 'foot-enter' });
  assert.equal(hovered.pending, null, 'a hover must not arm an open');
  assert.equal(run(['foot-enter', 'settle', 'foot-enter', 'settle']).face, 'rooms');
});

test('THE FLIP: once the face is open, foot-leave must NOT schedule a close', () => {
  // this is the exact event the bug rode in on — the face hides the bar, the browser fires
  // mouseleave, and the old handler answered it by closing the thing that had just opened
  const open = run(['click']);
  const after = faceHover(open, { type: 'foot-leave' });
  assert.equal(after.face, 'projects');
  assert.equal(after.pending, null, 'a close here is the loop');
});

test('THE FLIP: no event reachable from inside the column can dismiss the face', () => {
  for (const pinned of [false, true]) {
    const open: FaceState = { face: 'projects', pinned, pending: null };
    assert.ok(faceCannotSelfDismiss(open), `self-dismissable while pinned=${pinned}`);
    for (const type of INSIDE_EVENTS) {
      const next = faceHover(open, { type } as FaceHoverEvent);
      assert.equal(next.face, 'projects', `${type} closed the face`);
      assert.notEqual(next.pending?.to, 'rooms', `${type} armed a close`);
    }
  }
});

test('THE FLIP: the pathological sequence converges instead of oscillating', () => {
  // click-open → (face hides the bar) leave → enter again → …: fifty rounds, still open, no
  // pending transition left behind
  let s = run(['click']);
  for (let i = 0; i < 50; i++) s = run(['foot-leave', 'foot-enter', 'settle'], s);
  assert.equal(s.face, 'projects');
  assert.equal(s.pending, null);
});

test('a click-opened face survives the pointer leaving — it closes on click, esc, or ⌘⇧P only', () => {
  const open = run(['click']);
  assert.deepEqual(open, { face: 'projects', pinned: true, pending: null }, 'a click opens AND pins in one gesture');
  assert.equal(faceHover(open, { type: 'panel-leave' }).pending, null, 'leaving must not schedule a close');
  // clicking again closes it outright
  assert.deepEqual(faceHover(open, { type: 'click' }), { face: 'rooms', pinned: false, pending: null });
});

test('the unpinned-open guard rails hold, even though no click path reaches them anymore', () => {
  // hover cannot mint this state — but the reducer still covers it, so a future wiring
  // change inherits sane behavior instead of undefined branches
  const ghost: FaceState = { face: 'projects', pinned: false, pending: null };
  const leaving = faceHover(ghost, { type: 'panel-leave' });
  assert.deepEqual(leaving.pending, { to: 'rooms', delay: HOVER_OUT });
  assert.equal(faceHover(leaving, { type: 'panel-enter' }).pending, null, 'coming back cancels the close');
  assert.deepEqual(faceHover(ghost, { type: 'click' }), { face: 'projects', pinned: true, pending: null }, 'a click pins, never closes under the cursor');
});

test('pinned beats hover in both directions', () => {
  const pinned: FaceState = { face: 'projects', pinned: true, pending: null };
  assert.equal(faceHover(pinned, { type: 'panel-leave' }).pending, null, 'a pin survives the pointer leaving');
  assert.equal(faceHover(pinned, { type: 'foot-enter' }).pending, null);
  // and only an explicit dismissal ends it
  assert.deepEqual(faceHover(pinned, { type: 'dismiss' }), initialFace());
});

test('every reachable state is one of the four legal shapes — no half-open limbo', () => {
  const seen = new Set<string>();
  const ALL: FaceHoverEvent['type'][] = ['foot-enter', 'foot-leave', 'panel-enter', 'panel-leave', 'settle', 'click', 'dismiss'];
  const walk = (s: FaceState, depth: number) => {
    const key = `${s.face}|${s.pinned}|${s.pending?.to ?? '-'}`;
    if (seen.has(key) || depth > 6) return;
    seen.add(key);
    // a pinned face may never carry a pending transition: that is a pin about to be undone
    assert.ok(!(s.pinned && s.pending), `pinned state carries pending: ${key}`);
    for (const type of ALL) walk(faceHover(s, { type } as FaceHoverEvent), depth + 1);
  };
  walk(initialFace(), 0);
  // hover arms nothing now, so the LIVE machine is two rest states: rooms closed, projects
  // pinned. Anything more reachable would mean hover-open grew back.
  assert.equal(seen.size, 2, `reached ${seen.size} states — the click-only machine has exactly two`);
});
