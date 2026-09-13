// The workspace tab strip's model (mockups/workspace-tabs.html, slice 1): the reuse rule that
// makes one file one tab, the conversation's pinned slot 0, the read-only invariant, and the
// persistence that refuses to revive a dead pty. Run from apps/desktop:
//   pnpm exec tsx --test src/main/wtabs.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activateTab,
  closeTab,
  migrateDockTabs,
  moveTab,
  openTab,
  reviveTabs,
  serializeTabs,
  setConversation,
  setMode,
  tabCapabilities,
  type WTab,
} from '../renderer/src/wtabs';

const conv = (over: Partial<WTab> = {}): WTab => ({ id: 'conv', kind: 'conversation', title: '#1046 · iOS Safari focus-trap', ...over });
const file = (over: Partial<WTab> & { id: string }): WTab => ({ kind: 'file', title: 'drawer.tsx', ...over });
const term = (over: Partial<WTab> & { id: string }): WTab => ({ kind: 'terminal', title: 'nm-1046', ...over });
const web = (over: Partial<WTab> & { id: string }): WTab => ({ kind: 'browser', title: 'localhost:5173', ...over });
const rev = (over: Partial<WTab> & { id: string }): WTab => ({ kind: 'review', title: 'implementation-plan-v3.md', readOnly: true, ...over });
const board = (over: Partial<WTab> & { id: string }): WTab => ({ kind: 'whiteboard', title: 'offline sync map', whiteboardId: 'wb-1', ...over });

const ids = (tabs: WTab[]) => tabs.map((t) => t.id);

// ── the reuse rule: what counts as "already open" ──

test('a file already open by absolute path is activated, never duplicated', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/nm-1046/src/drawer.tsx' })];
  const r = openTab(open, file({ id: 'f2', path: '/w/nm-1046/src/drawer.tsx', title: 'drawer.tsx (again)' }));
  assert.deepEqual(ids(r.tabs), ['conv', 'f1']);
  assert.equal(r.activeId, 'f1');
  assert.equal(r.tabs[1]?.title, 'drawer.tsx'); // the open tab wins — reuse, not overwrite
});

test('a different path is a different tab', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/nm-1046/src/drawer.tsx' })];
  const r = openTab(open, file({ id: 'f2', path: '/w/nm-1046/src/nav.tsx', title: 'nav.tsx' }));
  assert.deepEqual(ids(r.tabs), ['conv', 'f1', 'f2']);
  assert.equal(r.activeId, 'f2');
});

test('a path-less file tab is a pane on a root, and reuses on that root', () => {
  // what a dock EDITOR tab was: bound to a folder, its file tree inside the tab
  const open = [conv(), file({ id: 'p1', path: null, root: '/w/nm-1046', title: 'nm-1046' })];
  assert.equal(openTab(open, file({ id: 'p2', path: null, root: '/w/nm-1046' })).activeId, 'p1');
  assert.deepEqual(ids(openTab(open, file({ id: 'p2', path: null, root: '/w/nm-1046' })).tabs), ['conv', 'p1']);
  // a file INSIDE that root is still its own tab — the pane is not the file
  const r = openTab(open, file({ id: 'f1', path: '/w/nm-1046/src/drawer.tsx' }));
  assert.deepEqual(ids(r.tabs), ['conv', 'p1', 'f1']);
});

test('a terminal for the same task reuses, whatever it is called', () => {
  const open = [conv(), term({ id: 't1', taskNumber: 1046, root: '/w/nm-1046' })];
  const r = openTab(open, term({ id: 't2', taskNumber: 1046, root: '/w/nm-1046', title: 'tests' }));
  assert.deepEqual(ids(r.tabs), ['conv', 't1']);
  assert.equal(r.activeId, 't1');
  // another task is another shell
  assert.deepEqual(ids(openTab(open, term({ id: 't3', taskNumber: 1047 })).tabs), ['conv', 't1', 't3']);
});

test('a task-less terminal reuses on its root, and a rootless one always opens fresh', () => {
  const open = [conv(), term({ id: 't1', root: '/w/repo', title: 'repo' })];
  assert.equal(openTab(open, term({ id: 't2', root: '/w/repo' })).activeId, 't1');
  // ~ terminals have nothing to collide on
  const first = openTab([conv()], term({ id: 't1', title: '~' }));
  const second = openTab(first.tabs, term({ id: 't2', title: '~' }));
  assert.deepEqual(ids(second.tabs), ['conv', 't1', 't2']);
});

test('a browser never dedupes — the same URL twice is two tabs', () => {
  const open = [conv(), web({ id: 'b1', url: 'http://localhost:5173' })];
  const r = openTab(open, web({ id: 'b2', url: 'http://localhost:5173' }));
  assert.deepEqual(ids(r.tabs), ['conv', 'b1', 'b2']);
  assert.equal(r.activeId, 'b2');
});

test('RULING 2 — many review tabs may be open, but one artifact is one tab', () => {
  const open = [conv(), rev({ id: 'r1', artifactId: 'art-plan-v3' })];
  // a second review, on a different artifact, is an ordinary second tab
  const two = openTab(open, rev({ id: 'r2', artifactId: 'art-ship-v2', title: 'ship-plan-v2.md' }));
  assert.deepEqual(ids(two.tabs), ['conv', 'r1', 'r2']);
  // ...but the SAME artifact lands on the tab you already have, so a half-written comment batch
  // can never be stranded on a duplicate (docs/36 §13, ruling 4)
  const again = openTab(two.tabs, rev({ id: 'r3', artifactId: 'art-plan-v3' }));
  assert.deepEqual(ids(again.tabs), ['conv', 'r1', 'r2']);
  assert.equal(again.activeId, 'r1');
  // a review with no artifact has nothing to collide on and opens fresh rather than hijacking one
  assert.equal(openTab(two.tabs, rev({ id: 'r4', artifactId: null })).tabs.length, 4);
});

test('a review is never editable and never survives a restart', () => {
  const r = rev({ id: 'r1', artifactId: 'art-plan-v3' });
  assert.deepEqual(tabCapabilities(r), { canEdit: false, canClose: true, canSplit: true });
  // its bytes came from the thread and its GATE moves: a tab restored tomorrow would offer a
  // verdict on a round approved overnight
  assert.deepEqual(serializeTabs([conv(), r, file({ id: 'f1', path: '/w/a.ts' })]).map((t) => t.id), ['f1']);
  assert.deepEqual(reviveTabs([{ id: 'r1', kind: 'review', title: 'implementation-plan-v3.md', artifactId: 'art-plan-v3' }]), []);
});

// ── whiteboards (docs/38): the sixth kind ──

test('a whiteboard reuses on its board id — one canvas cannot fork in two', () => {
  const open = [conv(), board({ id: 'w1', whiteboardId: 'wb-sync-map' })];
  const again = openTab(open, board({ id: 'w2', whiteboardId: 'wb-sync-map', title: 'renamed elsewhere' }));
  assert.deepEqual(ids(again.tabs), ['conv', 'w1']);
  assert.equal(again.activeId, 'w1');
  const other = openTab(open, board({ id: 'w2', whiteboardId: 'wb-composer-sketch' }));
  assert.deepEqual(ids(other.tabs), ['conv', 'w1', 'w2']);
});

test('a whiteboard survives a restart — its scene is a synced row, not process state', () => {
  const back = reviveTabs(JSON.stringify(serializeTabs([conv(), board({ id: 'w1', whiteboardId: 'wb-sync-map' })])));
  assert.deepEqual(ids(back), ['w1']);
  assert.equal(back[0]?.kind, 'whiteboard');
  assert.equal(back[0]?.whiteboardId, 'wb-sync-map');
});

test('revive dedupes boards and drops a board-less whiteboard tab', () => {
  const back = reviveTabs([
    { id: 'w1', kind: 'whiteboard', title: 'sync map', whiteboardId: 'wb-1' },
    { id: 'w2', kind: 'whiteboard', title: 'sync map (twin)', whiteboardId: 'wb-1' },
    { id: 'w3', kind: 'whiteboard', title: 'blank pane' },
  ]);
  assert.deepEqual(ids(back), ['w1']);
});

test('a conversation never opens through this door — it lands on the one already there', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts' })];
  const r = openTab(open, conv({ id: 'conv2', title: '#general' }));
  assert.deepEqual(ids(r.tabs), ['conv', 'f1']);
  assert.equal(r.activeId, 'conv');
});

test('openTab never mutates the tab set it was handed', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts' })];
  const before = ids(open);
  openTab(open, file({ id: 'f2', path: '/w/b.ts' }));
  openTab(open, file({ id: 'f3', path: '/w/a.ts' }));
  assert.deepEqual(ids(open), before);
});

// ── closing: who inherits the surface ──

test('closing the active tab activates its RIGHT neighbour', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts' }), term({ id: 't1' }), web({ id: 'b1' })];
  const r = closeTab(open, 't1', 't1');
  assert.deepEqual(ids(r.tabs), ['conv', 'f1', 'b1']);
  assert.equal(r.activeId, 'b1');
});

test('with nothing to the right, the LEFT neighbour inherits', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts' }), term({ id: 't1' })];
  const r = closeTab(open, 't1', 't1');
  assert.deepEqual(ids(r.tabs), ['conv', 'f1']);
  assert.equal(r.activeId, 'f1');
});

test('with no neighbour at all, the conversation inherits', () => {
  const open = [conv(), term({ id: 't1' })];
  const r = closeTab(open, 't1', 't1');
  assert.deepEqual(ids(r.tabs), ['conv']);
  assert.equal(r.activeId, 'conv');
});

test('closing a background tab leaves the active one alone', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts' }), term({ id: 't1' })];
  const r = closeTab(open, 'conv', 't1');
  assert.deepEqual(ids(r.tabs), ['conv', 'f1']);
  assert.equal(r.activeId, 'conv');
});

test('the conversation cannot be closed', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts' })];
  const r = closeTab(open, 'conv', 'conv');
  assert.deepEqual(ids(r.tabs), ['conv', 'f1']);
  assert.equal(r.activeId, 'conv');
  assert.equal(tabCapabilities(open[0] as WTab).canClose, false); // and it says so, so no ✕ is drawn
});

test('closing an id that is not there changes nothing', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts' })];
  const r = closeTab(open, 'f1', 'gone');
  assert.deepEqual(ids(r.tabs), ['conv', 'f1']);
  assert.equal(r.activeId, 'f1');
  assert.deepEqual(ids(open), ['conv', 'f1']);
});

// ── activation ──

test('activate moves the surface, and a stale id leaves it where it is', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts' })];
  assert.equal(activateTab(open, 'conv', 'f1').activeId, 'f1');
  assert.equal(activateTab(open, 'f1', 'closed-already').activeId, 'f1');
});

// ── ordering: slot 0 is the conversation's ──

test('siblings reorder freely', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts' }), term({ id: 't1' }), web({ id: 'b1' })];
  assert.deepEqual(ids(moveTab(open, 'b1', 1)), ['conv', 'b1', 'f1', 't1']);
  assert.deepEqual(ids(moveTab(open, 'f1', 3)), ['conv', 't1', 'b1', 'f1']);
  assert.deepEqual(ids(open), ['conv', 'f1', 't1', 'b1']); // input untouched
});

test('the conversation cannot be dragged out of slot 0', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts' }), term({ id: 't1' })];
  assert.deepEqual(ids(moveTab(open, 'conv', 2)), ['conv', 'f1', 't1']);
  assert.deepEqual(ids(moveTab(open, 'conv', 1)), ['conv', 'f1', 't1']);
});

test('a drag aimed at slot 0 lands at 1 — as far left as legal', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts' }), term({ id: 't1' })];
  assert.deepEqual(ids(moveTab(open, 't1', 0)), ['conv', 't1', 'f1']);
  assert.deepEqual(ids(moveTab(open, 't1', -5)), ['conv', 't1', 'f1']);
  assert.equal(moveTab(open, 't1', 0)[0]?.kind, 'conversation');
});

test('a move past the end clamps, and an unknown id or a nonsense index is a no-op', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts' }), term({ id: 't1' })];
  assert.deepEqual(ids(moveTab(open, 'f1', 99)), ['conv', 't1', 'f1']);
  assert.deepEqual(ids(moveTab(open, 'gone', 1)), ['conv', 'f1', 't1']);
  assert.deepEqual(ids(moveTab(open, 'f1', Number.NaN)), ['conv', 'f1', 't1']);
});

test('with no conversation yet, the first tab is not pinned', () => {
  const revived = [file({ id: 'f1', path: '/w/a.ts' }), web({ id: 'b1' })];
  assert.deepEqual(ids(moveTab(revived, 'b1', 0)), ['b1', 'f1']);
});

// ── the conversation follows the room ──

test('switching rooms replaces tab one in place and keeps every sibling', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts' }), term({ id: 't1' })];
  const r = setConversation(open, { id: 'conv-general', title: '#general' }, 'f1');
  assert.deepEqual(ids(r.tabs), ['conv-general', 'f1', 't1']);
  assert.equal(r.tabs[0]?.kind, 'conversation'); // stamped by the model, not by the caller
  assert.equal(r.tabs[0]?.title, '#general');
  assert.equal(r.activeId, 'f1'); // you were reading a file; the room switch does not move you
  assert.equal(r.tabs.filter((t) => t.kind === 'conversation').length, 1);
});

test('if you were ON the conversation you stay on it, in the new room', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts' })];
  const r = setConversation(open, { id: 'conv-general', title: '#general' }, 'conv');
  assert.equal(r.activeId, 'conv-general');
  assert.deepEqual(ids(r.tabs), ['conv-general', 'f1']);
});

test('a revived set with no conversation gets one inserted, losing nothing', () => {
  const revived = [file({ id: 'f1', path: '/w/a.ts' }), web({ id: 'b1' })];
  const r = setConversation(revived, { id: 'conv', title: '#build' }, 'b1');
  assert.deepEqual(ids(r.tabs), ['conv', 'f1', 'b1']);
  assert.equal(r.activeId, 'b1');
  assert.deepEqual(ids(revived), ['f1', 'b1']);
});

// ── read-only can never reach edit ──

test('a read-only artifact reports canEdit false whatever mode it carries', () => {
  const artifact = file({ id: 'a1', path: '/w/.nm-evidence/plan.md', readOnly: true, mode: 'edit' });
  assert.equal(tabCapabilities(artifact).canEdit, false);
  assert.equal(tabCapabilities(file({ id: 'f1', path: '/w/a.ts', mode: 'edit' })).canEdit, true);
  assert.equal(tabCapabilities(file({ id: 'f1', path: '/w/a.ts', mode: 'preview' })).canEdit, true);
});

test('only a file is editable, and only the conversation is unclosable and unsplittable', () => {
  assert.deepEqual(tabCapabilities(conv()), { canEdit: false, canClose: false, canSplit: false });
  assert.deepEqual(tabCapabilities(file({ id: 'f1', path: '/w/a.ts' })), { canEdit: true, canClose: true, canSplit: true });
  assert.deepEqual(tabCapabilities(term({ id: 't1' })), { canEdit: false, canClose: true, canSplit: true });
  assert.deepEqual(tabCapabilities(web({ id: 'b1' })), { canEdit: false, canClose: true, canSplit: true });
});

test('setMode refuses edit on a read-only tab, and still allows it to be read', () => {
  const open = [conv(), file({ id: 'a1', path: '/w/plan.md', readOnly: true, mode: 'preview' })];
  assert.equal(setMode(open, 'a1', 'edit')[1]?.mode, 'preview'); // unchanged — write refused
  // …but a read-only tab may always READ its own bytes: `source` is not a write capability,
  // and the approved mockup gives every artifact a Source · Preview toggle
  assert.equal(setMode(open, 'a1', 'source')[1]?.mode, 'source');
  assert.equal(setMode(open, 'a1', 'diff')[1]?.mode, 'diff');
  assert.equal(setMode(open, 'a1', 'preview')[1]?.mode, 'preview');
});

test('setMode allows edit on a writable file and refuses it everywhere it makes no sense', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts', mode: 'preview' }), term({ id: 't1' })];
  assert.equal(setMode(open, 'f1', 'edit')[1]?.mode, 'edit');
  assert.equal(setMode(open, 't1', 'edit')[2]?.mode, undefined); // a terminal has nothing to edit
  assert.deepEqual(setMode(open, 'gone', 'edit'), open);
  assert.equal(open[1]?.mode, 'preview'); // input untouched
});

// ── persistence: what may come back ──

test('serialize keeps files, browsers and whiteboards, and drops the conversation and every terminal', () => {
  const open = [
    conv(),
    file({ id: 'f1', path: '/w/a.ts', dirty: true }),
    term({ id: 't1', taskNumber: 1046, root: '/w/nm-1046' }),
    web({ id: 'b1', url: 'http://localhost:5173' }),
    board({ id: 'w1', whiteboardId: 'wb-sync-map', dirty: true }),
  ];
  const saved = serializeTabs(open);
  assert.deepEqual(ids(saved), ['f1', 'b1', 'w1']);
  assert.equal('dirty' in (saved[0] as WTab), false); // no unsaved buffer survives a restart either
  assert.equal('dirty' in (saved[2] as WTab), false); // a board's dot is derived live, never stored
});

test('serialize → JSON → revive round-trips the tabs that may come back', () => {
  const open = [conv(), file({ id: 'f1', path: '/w/a.ts', root: '/w', taskNumber: 1046 }), term({ id: 't1' }), web({ id: 'b1', url: 'http://localhost:5173' })];
  const back = reviveTabs(JSON.stringify(serializeTabs(open)));
  assert.deepEqual(ids(back), ['f1', 'b1']);
  assert.equal(back[0]?.path, '/w/a.ts');
  assert.equal(back[0]?.taskNumber, 1046);
  assert.equal(back[1]?.url, 'http://localhost:5173');
});

test('revive survives null, garbage and legacy shapes without throwing', () => {
  assert.deepEqual(reviveTabs(null), []);
  assert.deepEqual(reviveTabs(undefined), []);
  assert.deepEqual(reviveTabs('not json at all'), []);
  assert.deepEqual(reviveTabs('{"nope":1}'), []);
  assert.deepEqual(reviveTabs({}), []);
  assert.deepEqual(reviveTabs([1, 'x', null, true]), []);
  assert.deepEqual(reviveTabs([{}, { id: 7, kind: 'file' }, { id: 'f1' }, { id: 'f2', kind: 'wat' }]), []);
  const legacy = reviveTabs([{ id: 'f1', kind: 'file', path: '/w/src/drawer.tsx' }]);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0]?.title, 'drawer.tsx'); // a titleless record still opens as something nameable
});

test('a persisted terminal or conversation is not revivable — a dead pty stays dead', () => {
  const back = reviveTabs([
    { id: 'conv', kind: 'conversation', title: '#build' },
    { id: 't1', kind: 'terminal', title: 'nm-1046', root: '/w/nm-1046' },
    { id: 'f1', kind: 'file', title: 'a.ts', path: '/w/a.ts' },
  ]);
  assert.deepEqual(ids(back), ['f1']);
});

test('a stored read-only tab cannot come back in edit mode', () => {
  const back = reviveTabs([{ id: 'a1', kind: 'file', title: 'plan.md', path: '/w/plan.md', readOnly: true, mode: 'edit' }]);
  assert.equal(back[0]?.mode, 'source'); // clamped to the nearest legal READ, not a different view
  assert.equal(tabCapabilities(back[0] as WTab).canEdit, false);
  assert.equal(reviveTabs([{ id: 'f1', kind: 'file', title: 'a.ts', path: '/w/a.ts', mode: 'nonsense' }])[0]?.mode, undefined);
});

test('revive dedupes by id and by path, so one file is one tab at boot too', () => {
  const back = reviveTabs([
    { id: 'f1', kind: 'file', title: 'a.ts', path: '/w/a.ts' },
    { id: 'f2', kind: 'file', title: 'a.ts again', path: '/w/a.ts' },
    { id: 'f1', kind: 'file', title: 'b.ts', path: '/w/b.ts' },
    { id: 'b1', kind: 'browser', title: 'local', url: 'http://localhost:5173' },
    { id: 'b2', kind: 'browser', title: 'local', url: 'http://localhost:5173' },
  ]);
  assert.deepEqual(ids(back), ['f1', 'b1', 'b2']); // browsers still never dedupe
});

// ── the dock's tabs, promoted upward ──

test('every dock mode migrates, keeping its taskNumber, cwdRoot and url', () => {
  const dock = [
    { id: 'd1', title: 'nm-1046', mode: 'terminal', taskNumber: 1046, hasRepo: true, cwdRoot: '/w/nm-1046', rootLabel: 'nm-1046', startupCommand: 'claude' },
    { id: 'd2', title: 'neuramesh', mode: 'editor', cwdRoot: '/w/repo', rootLabel: 'neuramesh' },
    { id: 'd3', title: 'Browser', mode: 'browser', url: 'http://localhost:5173' },
  ];
  const back = migrateDockTabs(dock);
  assert.deepEqual(back.map((t) => t.kind), ['terminal', 'file', 'browser']);
  assert.deepEqual(ids(back), ['d1', 'd2', 'd3']);
  assert.deepEqual(back[0], { id: 'd1', kind: 'terminal', title: 'nm-1046', subtitle: 'nm-1046', root: '/w/nm-1046', taskNumber: 1046 });
  // a dock editor was bound to a FOLDER, so it becomes a pane on that root, not a file
  assert.deepEqual(back[1], { id: 'd2', kind: 'file', title: 'neuramesh', subtitle: 'neuramesh', path: null, root: '/w/repo', taskNumber: null });
  assert.deepEqual(back[2], { id: 'd3', kind: 'browser', title: 'Browser', subtitle: null, url: 'http://localhost:5173' });
});

test('the legacy dock shape migrates too: kind→mode and rootPath→cwdRoot', () => {
  const back = migrateDockTabs([
    { id: 'd1', title: 'repo', kind: 'editor', rootPath: '/w/repo' },
    { id: 'd2', title: 'nm-1046', kind: 'terminal', rootPath: '/w/nm-1046', taskNumber: 1046 },
    { id: 'd3', title: 'older still' },
  ]);
  assert.deepEqual(back.map((t) => t.kind), ['file', 'terminal', 'terminal']);
  assert.equal(back[0]?.root, '/w/repo');
  assert.equal(back[1]?.taskNumber, 1046);
  assert.equal(back[2]?.root, null); // an unrecognized record is a terminal, as the dock's own reader decided
});

test('migration reads the raw store and tolerates whatever is in it', () => {
  assert.deepEqual(migrateDockTabs('[]'), []);
  assert.deepEqual(migrateDockTabs('nope'), []);
  assert.deepEqual(migrateDockTabs(null), []);
  assert.deepEqual(migrateDockTabs([{ title: 'no id' }, 42]), []);
  const one = migrateDockTabs('[{"id":"d1","title":"nm-1046","mode":"terminal","taskNumber":1046,"startupCommand":"claude --resume"}]');
  assert.equal(one.length, 1);
  assert.equal('startupCommand' in (one[0] as WTab), false); // it would re-run on upgrade a command run once
});

test('migrated tabs land in the strip under the same reuse rule', () => {
  const migrated = migrateDockTabs([{ id: 'd1', title: 'nm-1046', mode: 'terminal', taskNumber: 1046, cwdRoot: '/w/nm-1046' }]);
  const boot = setConversation(migrated, { id: 'conv', title: '#build' }, null);
  assert.deepEqual(ids(boot.tabs), ['conv', 'd1']);
  // the task's terminal is already open, so the task header's Terminal button focuses it
  assert.equal(openTab(boot.tabs, term({ id: 'new', taskNumber: 1046 })).activeId, 'd1');
});
