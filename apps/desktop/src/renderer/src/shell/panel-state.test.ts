// The side panel's rules (shell/panel-state.ts) and the tab model's session scope (wtabs.ts), the
// side-panel round (2026-10-03). Run from apps/hq: pnpm test
//
// Four things hold: a tab belongs to the session that opened it and shows in that session's panel
// only · a session's own tabs derive from its kind · the front falls back in a fixed order · the fold
// moves by itself only inside one session, and only the way the round says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openWithSession, panelFoldAfter, panelFront, panelGuests, panelKeyTarget, panelSessionOf, sessionTabId, sessionTabKeyOf, sessionTabsOf } from './panel-state';
import { closeTab, openTab, rekeyOwner, reviveTabs, serializeTabs, type WTab } from '../wtabs';

test('a task named in a session is one tab in that session, and it never persists', () => {
  const t1: WTab = { id: 'k1', kind: 'task', title: '#1050', taskId: 't-1050', owner: 'thread:a' };
  const again: WTab = { ...t1, id: 'k2' };
  const st = openTab([t1], again);
  assert.equal(st.tabs.length, 1, 'the second #N click shows the tab you have');
  assert.equal(st.activeId, 'k1');
  const elsewhere = openTab([t1], { ...t1, id: 'k3', owner: 'thread:b' });
  assert.equal(elsewhere.tabs.length, 2, 'another session gets its own');
  assert.deepEqual(serializeTabs([t1]), [], 'a task tab is a view of synced state: nothing to persist');
});

const conv: WTab = { id: 'c', kind: 'conversation', title: '#build' };
const tab = (id: string, owner: string | null, extra: Partial<WTab> = {}): WTab => ({ id, kind: 'file', title: id, path: `/r/${id}`, root: '/r', owner, ...extra });

test('the session in front: a task outranks its thread, a thread its room, and nothing is the workspace set', () => {
  assert.deepEqual(panelSessionOf({ taskId: 'T', threadId: 'H', roomId: 'R' }), { key: 'task:T', kind: 'task', files: false, drafts: false });
  assert.deepEqual(panelSessionOf({ threadId: 'H', roomId: 'R' }), { key: 'thread:H', kind: 'thread', drafts: false });
  assert.deepEqual(panelSessionOf({ threadId: 'H', coding: true }), { key: 'thread:H', kind: 'coding' });
  assert.deepEqual(panelSessionOf({ roomId: 'R', roomSections: true }), { key: 'room:R', kind: 'room', roomSections: true });
  assert.deepEqual(panelSessionOf({}), { key: null, kind: null });
});

test('a session owns tabs by its kind: Overview, Files with a worktree, the code face on a coding thread', () => {
  assert.deepEqual(sessionTabsOf({ key: 'task:T', kind: 'task' }), ['overview']);
  assert.deepEqual(sessionTabsOf({ key: 'task:T', kind: 'task', files: true }), ['overview', 'files']);
  assert.deepEqual(sessionTabsOf({ key: 'thread:H', kind: 'thread' }), ['overview']);
  // drafted posts read in a Drafts tab of their own, after Overview and Files
  assert.deepEqual(sessionTabsOf({ key: 'thread:H', kind: 'thread', drafts: true }), ['overview', 'drafts']);
  assert.deepEqual(sessionTabsOf({ key: 'task:T', kind: 'task', files: true, drafts: true }), ['overview', 'files', 'drafts']);
  assert.deepEqual(sessionTabsOf({ key: 'thread:H', kind: 'coding', drafts: true }), ['changes', 'files', 'plan', 'checkpoints', 'terminal'], 'a coding thread drafts no posts');
  assert.deepEqual(sessionTabsOf({ key: 'thread:H', kind: 'coding' }), ['changes', 'files', 'plan', 'checkpoints', 'terminal']);
  assert.deepEqual(sessionTabsOf({ key: 'room:R', kind: 'room', roomSections: true }), ['overview']);
  assert.deepEqual(sessionTabsOf({ key: 'room:R', kind: 'room' }), [], 'a room home with nothing of its own owns no tab');
  assert.deepEqual(sessionTabsOf({ key: null, kind: null }), []);
  // a session tab's id can never be a record's id, and it reads back
  assert.equal(sessionTabKeyOf(sessionTabId('overview')), 'overview');
  assert.equal(sessionTabKeyOf('3f9c-uuid'), null);
});

test('the panel shows the tabs of the session in front only, never the conversation record', () => {
  const tabs = [conv, tab('a', 'task:T'), tab('b', 'thread:H'), tab('w', null), tab('d', 'task:T')];
  assert.deepEqual(panelGuests(tabs, 'task:T').map((t) => t.id), ['a', 'd']);
  assert.deepEqual(panelGuests(tabs, 'thread:H').map((t) => t.id), ['b']);
  assert.deepEqual(panelGuests(tabs, null).map((t) => t.id), ['w'], 'the workspace set shows on Home and the destinations');
});

test('the same file in two sessions is two tabs, and within one session it is still one', () => {
  let s = openTab([conv], tab('x1', 'task:T', { path: '/r/plan.md' }));
  s = openTab(s.tabs, tab('x2', 'thread:H', { path: '/r/plan.md' }));
  assert.equal(s.tabs.length, 3, 'the owner is part of the identity');
  assert.equal(s.activeId, 'x2');
  // positive control: the same session asking again lands on the tab it has
  const again = openTab(s.tabs, tab('x3', 'task:T', { path: '/r/plan.md' }));
  assert.equal(again.tabs.length, 3);
  assert.equal(again.activeId, 'x1');
  // a review keys on its artifact the same way: one per session
  const r1: WTab = { id: 'r1', kind: 'review', title: 'plan', artifactId: 'A', owner: 'task:T' };
  const r2: WTab = { id: 'r2', kind: 'review', title: 'plan', artifactId: 'A', owner: 'thread:H' };
  assert.equal(openTab([r1], r2).tabs.length, 2);
  assert.equal(openTab([r1], { ...r2, id: 'r3', owner: 'task:T' }).activeId, 'r1');
});

test('closing the front tab hands the front to a tab of the SAME session, never to a neighbour of another', () => {
  // b sits between a and c in the array, but belongs to another session
  const tabs = [conv, tab('a', 'task:T'), tab('b', 'thread:H'), tab('d', 'task:T')];
  assert.equal(closeTab(tabs, 'a', 'a').activeId, 'd', 'the right neighbour in the session, skipping another session');
  assert.equal(closeTab(tabs, 'd', 'd').activeId, 'a', 'else the left one in the session');
  assert.equal(closeTab(tabs, 'b', 'b').activeId, null, 'a session with no tab left has no heir');
  assert.equal(closeTab(tabs, 'a', 'd').activeId, 'a', 'closing a tab behind the front keeps the front');
  assert.equal(closeTab(tabs, 'd', 'd').tabs.length, 3);
  assert.equal(closeTab(tabs, 'c', 'c').tabs, tabs, 'the conversation record never closes');
});

test('a conversation that becomes a task keeps what you opened beside it', () => {
  const tabs = [conv, tab('a', 'thread:H'), tab('b', 'task:X')];
  const moved = rekeyOwner(tabs, 'thread:H', 'task:T');
  assert.deepEqual(moved.map((t) => t.owner ?? null), [null, 'task:T', 'task:X']);
  assert.equal(rekeyOwner(tabs, 'thread:nope', 'task:T'), tabs, 'nothing to move returns the same array');
});

test('a relaunch keeps each tab in its session, drops the dot, and drops the old editor pane', () => {
  const stored = serializeTabs([
    conv,
    tab('a', 'task:T', { fresh: true, dirty: true }),
    { id: 'w', kind: 'whiteboard', title: 'board', whiteboardId: 'B', owner: 'thread:H' },
    { id: 't', kind: 'terminal', title: '~', owner: 'task:T' },
  ]);
  assert.deepEqual(stored.map((t) => t.id), ['a', 'w'], 'a terminal and the conversation never persist');
  assert.equal('fresh' in stored[0]!, false);
  const back = reviveTabs(JSON.stringify([
    ...stored,
    { id: 'old', kind: 'file', title: 'repo', root: '/r' }, // the retired editor pane: no path, no bytes
    { id: 'dup', kind: 'file', title: 'a', path: '/r/a', owner: 'task:T' }, // the same file again in the same session
    { id: 'other', kind: 'file', title: 'a', path: '/r/a', owner: 'thread:H' }, // the same file in another session
  ]));
  assert.deepEqual(back.map((t) => [t.id, t.owner ?? null]), [['a', 'task:T'], ['w', 'thread:H'], ['other', 'thread:H']]);
});

test('the front: the stored pick while it exists, else the first own tab, else the last tab opened', () => {
  const guests = [tab('a', 'task:T'), tab('b', 'task:T')];
  assert.equal(panelFront('b', ['overview'], guests), 'b');
  assert.equal(panelFront('s:overview', ['overview'], guests), 's:overview');
  assert.equal(panelFront('gone', ['overview'], guests), 's:overview', 'a closed tab falls back to Overview');
  assert.equal(panelFront('s:files', ['overview'], guests), 's:overview', 'Files that went away falls back');
  assert.equal(panelFront(null, ['changes', 'files'], []), 's:changes', 'a coding thread opens on Changes');
  assert.equal(panelFront(null, [], guests), 'b', 'with no own tab, the last tab opened');
  assert.equal(panelFront(null, [], []), null);
});

test('⌘1 is the composer; ⌘2 onwards walk the strip: own tabs first, then what was opened', () => {
  const guests = [tab('a', 'task:T')];
  assert.deepEqual(panelKeyTarget(['overview', 'files'], guests, 1), { kind: 'composer' });
  assert.deepEqual(panelKeyTarget(['overview', 'files'], guests, 2), { kind: 'tab', id: 's:overview' });
  assert.deepEqual(panelKeyTarget(['overview', 'files'], guests, 4), { kind: 'tab', id: 'a' });
  assert.equal(panelKeyTarget(['overview', 'files'], guests, 5), null);
});

test('the fold moves by itself only inside one session', () => {
  const at = (owner: string | null, front: string | null, guests: number, sessionTabs = 1) => ({ owner, front, guests, sessionTabs });
  // a tab that comes to the front unfolds
  assert.equal(panelFoldAfter(at('task:T', 's:overview', 0), at('task:T', 'a', 1)), 'open');
  // a click between own tabs does not move it (a click means the panel is open)
  assert.equal(panelFoldAfter(at('task:T', 'a', 1), at('task:T', 's:overview', 1)), null);
  // the last tab leaving folds only a session with nothing of its own to show
  assert.equal(panelFoldAfter(at(null, 'a', 1), at(null, null, 0, 0)), 'close');
  assert.equal(panelFoldAfter(at('task:T', 'a', 1), at('task:T', 's:overview', 0, 1)), null, 'Overview is still there');
  // positive control: a move to another session never moves the fold, even onto a new front tab
  assert.equal(panelFoldAfter(at('task:T', 's:overview', 0), at('thread:H', 'b', 1)), null);
});

test('opening a task or a coding thread brings the panel out; a conversation only when a verdict waits', () => {
  assert.equal(openWithSession('task', false), true);
  assert.equal(openWithSession('coding', false), true);
  assert.equal(openWithSession('thread', false), false, 'the 2026-08-26 ruling: no pop-open for every conversation');
  assert.equal(openWithSession('thread', true), true);
  assert.equal(openWithSession('room', false), false);
  assert.equal(openWithSession(null, false), false);
});
