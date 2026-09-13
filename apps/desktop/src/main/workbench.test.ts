// The Workbench's subject (the shell-simplification round, 2026-08-16; Details finished
// 2026-08-17; ONE FACE in the rail-ink round 3, 2026-09-04).
// Run from apps/desktop: pnpm exec tsx --test src/main/workbench.test.ts
//
// The panel is contextual, and "contextual" is exactly the kind of claim that rots into a
// setting. These lock the decision: the SUBJECT comes from what you are standing in, a session
// outranks the room behind it, the Files drawer belongs to a session and never to a room, and
// nothing open means no panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORKBENCH_VIEWS, scopeLabelOf, workbenchApplies, workbenchState } from '../renderer/src/shell/workbench-state';

const WT = '/home/g/.neuramesh/worktrees/nm-1057';

test('① a task with a worktree: the task is the subject and its worktree backs the Files drawer', () => {
  const s = workbenchState({ root: WT, taskId: 't1', taskNumber: 1057, label: 'nm-1057', sessionScoped: true });
  assert.equal(s.subject, 'task');
  assert.equal(s.files, WT);
  assert.equal(s.scopeLabel, '⎇ nm-1057');
});

test('② a task with no worktree: the task alone, and no drawer', () => {
  const s = workbenchState({ root: null, taskId: 't2', taskNumber: 1058, label: '#1058', sessionScoped: true });
  assert.equal(s.subject, 'task');
  assert.equal(s.files, null);
  assert.equal(s.scopeLabel, '#1058 · no repo');
});

test('③ a file tab with a repo and no session has no details of its own: the room behind it is the subject, or nothing', () => {
  assert.equal(workbenchState({ root: WT, taskId: null, taskNumber: null, label: 'site', sessionScoped: true }).subject, null);
  const room = workbenchState({ root: WT, taskId: null, taskNumber: null, channelId: 'c1', label: 'site', sessionScoped: true });
  assert.equal(room.subject, 'room');
  assert.equal(room.files, null, 'a room does not browse a repo — the drawer is a session\'s');
});

test('a chat thread is a subject — scoped to the SESSION, not to tasks (2026-08-17)', () => {
  const s = workbenchState({ root: null, taskId: null, taskNumber: null, threadId: 'th1', label: 'x', sessionScoped: true });
  assert.equal(s.subject, 'thread');
  assert.equal(workbenchState({ root: WT, taskId: null, taskNumber: null, threadId: 'th1', label: 'x', sessionScoped: true }).files, WT, 'a thread with a worktree gets the drawer');
});

test('a room you are standing in is the subject when no session is — BrandDocsRail\'s job', () => {
  assert.equal(workbenchState({ root: null, taskId: null, taskNumber: null, channelId: 'c1', label: 'x', sessionScoped: false }).subject, 'room');
});

test('…but an open SESSION always outranks the room behind it', () => {
  const s = workbenchState({ root: WT, taskId: 't1', taskNumber: 1057, channelId: 'c1', label: 'nm-1057', sessionScoped: true });
  assert.equal(s.subject, 'task'); // one Details, from the task — never two
});

test('④ nothing open: no subject, so the card does not render — never a stale tree, never a blank', () => {
  const s = workbenchState({ root: null, taskId: null, taskNumber: null, label: 'this machine', sessionScoped: false });
  assert.equal(s.subject, null);
  assert.equal(s.files, null);
  assert.equal(s.scopeLabel, 'nothing open');
});

test('the Engineering floor never shows the panel — it carries its own split (rail-ink round)', () => {
  assert.equal(workbenchApplies('engineering', true), false);
  assert.equal(workbenchApplies('engineering', false), false);
  assert.equal(workbenchApplies('chat', false), true, 'the session surfaces still do');
});

test('④ …and a root that is not session-scoped does not fake one', () => {
  // the shell resolves a fallback root for the ＋ menu's terminal; the panel must not read that
  // as "a session is open" and show a tree for work nobody is looking at
  const s = workbenchState({ root: '/repos/site', taskId: null, taskNumber: null, label: 'site', sessionScoped: false });
  assert.equal(s.subject, null, 'no session, no room: no panel — a resolved root alone earns nothing');
});

test('the subject and the drawer are consistent for every shape of context', () => {
  for (const root of [null, WT]) {
    for (const taskId of [null, 't']) {
      for (const threadId of [null, 'th']) {
        for (const channelId of [null, 'c']) {
          for (const sessionScoped of [true, false]) {
            const s = workbenchState({ root, taskId, taskNumber: taskId ? 9 : null, threadId, channelId, label: 'l', sessionScoped });
            if (s.subject === null) {
              // the ONE shape with no panel: no room, and no session in front of you
              assert.ok(!channelId && (!sessionScoped || (!taskId && !threadId)), 'a panel disappears only over nothing you are standing in');
              assert.equal(s.files, null);
              continue;
            }
            // the drawer follows a SESSION's worktree and never a room's fallback root
            assert.equal(s.files, s.subject === 'room' ? null : root);
            if (sessionScoped && taskId) assert.equal(s.subject, 'task', 'a task outranks a thread id and the room');
          }
        }
      }
    }
  }
});

test('the scope chip names the most specific truth it has', () => {
  assert.equal(scopeLabelOf({ root: WT, taskNumber: 1057, label: 'x', sessionScoped: true }), '⎇ nm-1057');
  assert.equal(scopeLabelOf({ root: WT, taskNumber: null, label: 'site', sessionScoped: true }), 'site');
  assert.equal(scopeLabelOf({ root: null, taskNumber: 1058, label: 'x', sessionScoped: true }), '#1058 · no repo');
  assert.equal(scopeLabelOf({ root: null, taskNumber: null, label: 'this machine', sessionScoped: true }), 'this machine');
  assert.equal(scopeLabelOf({ root: WT, taskNumber: 1057, label: 'x', sessionScoped: false }), 'nothing open');
});

// ── WHERE IT APPLIES AT ALL (2026-08-19, George) ─────────────────────────────────────────────
// The panel sat beside Calendar / Routines / Files / Whiteboards showing `nothing open` and an
// empty state — ~214px of window spent saying "not here", on the screens whose content most wants
// the room. These pin the list so a new destination cannot quietly inherit a panel it has no use
// for: adding a MainView means deciding, here, whether the Workbench belongs on it.
test('the Workbench applies to SESSIONS and file tabs, and to nothing else', () => {
  for (const v of ['chat', 'code']) assert.equal(workbenchApplies(v, false), true, `${v} should host it`);
  // every destination George named, plus the rest of the MainView union
  for (const v of ['calendar', 'automations', 'library', 'whiteboards', 'board', 'skills', 'memory', 'dashboard', 'footprint', 'compute']) {
    assert.equal(workbenchApplies(v, false), false, `${v} is a full-width destination`);
  }
});

test('A SESSION OVERLAYS the destination, so an open session earns the panel anywhere', () => {
  // this is the half that hid the panel everywhere for one build. `openConversation` does NOT set
  // `view` — a session takes the main surface with a back crumb and leaves the destination where
  // it was — so a thread opened from Files still reads `view === 'library'`.
  for (const v of ['library', 'calendar', 'automations', 'whiteboards', 'board', 'dashboard']) {
    assert.equal(workbenchApplies(v, true), true, `a session open over ${v} still earns the panel`);
    assert.equal(workbenchApplies(v, false), false, `${v} with nothing open does not`);
  }
});

test('the applies-list is exactly the two session surfaces — a longer one is a decision, not a typo', () => {
  assert.deepEqual([...WORKBENCH_VIEWS].sort(), ['chat', 'code']);
});

test('an unknown view never inherits the panel by default', () => {
  // a MainView added later must OPT IN; silence should mean "no panel", not "panel everywhere"
  assert.equal(workbenchApplies('some-new-destination', false), false);
  assert.equal(workbenchApplies('', false), false);
});
