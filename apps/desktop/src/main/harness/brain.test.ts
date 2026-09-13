// The brain (docs/harness/01). Run: pnpm exec tsx --test src/main/harness/brain.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Brain, Ledger, brainRoot, subjectSlug, subjectPath, tierOf, exportable, importCompatible, BRAIN_SCHEMA_VERSION , resolveInWorkspace } from './brain';
import type { AgentMessage } from '@neuramesh/shared';

const tmp = () => mkdtempSync(join(tmpdir(), 'nm-brain-'));

test('the root is ~/.neuramesh, overridable — so a headless CLI can find state Electron owns', () => {
  assert.equal(brainRoot({ HOME: '/home/x' } as NodeJS.ProcessEnv), '/home/x/.neuramesh');
  assert.equal(brainRoot({ HOME: '/home/x', NM_BRAIN: '/custom/brain' } as NodeJS.ProcessEnv), '/custom/brain');
});

// The v0.73.0 regression: a fixed root collapsed every NM_USERDATA profile onto ONE state/replica.db,
// so a dev build and the installed app shared PowerSync's checkpoint (ps_buckets) and its outbound
// queue (ps_crud) — each client re-syncing the other in a loop. The isolation has to be automatic:
// a launcher that must remember a second variable is a launcher that will forget one.
test('a PROFILE gets its own root — two apps must never share one replica', () => {
  const dev = brainRoot({ HOME: '/home/x', NM_USERDATA: '/home/x/.neuramesh-dev' } as NodeJS.ProcessEnv);
  const installed = brainRoot({ HOME: '/home/x' } as NodeJS.ProcessEnv);
  assert.notEqual(dev, installed, 'a dev build sharing the installed replica is the SYNCING… flicker');
  assert.equal(dev, '/home/x/.neuramesh-dev/brain', 'the brain lives under the profile that owns it');
  assert.equal(installed, '/home/x/.neuramesh', 'the installed app keeps the copyable default');
});

test('an explicit NM_BRAIN still wins over the profile — a restored export is a deliberate choice', () => {
  assert.equal(
    brainRoot({ HOME: '/home/x', NM_USERDATA: '/home/x/.neuramesh-dev', NM_BRAIN: '/restored' } as NodeJS.ProcessEnv),
    '/restored',
  );
});

test('a subject slug is stable and keyed on the thing that outlives the agents', () => {
  assert.equal(subjectSlug({ kind: 'task', number: 1046 }), 'task-1046');
  const t = subjectSlug({ kind: 'thread', id: 'ab-cd-ef-01-23' });
  assert.equal(t, subjectSlug({ kind: 'thread', id: 'ab-cd-ef-01-23' }), 'the same thread always resolves to the same brain');
  assert.ok(!t.includes('-', 7), 'dashes are stripped so the path stays flat');
  assert.ok(subjectPath({ kind: 'task', number: 7 }, '/r').startsWith('/r/subjects/'));
});

test('a new brain writes its manifest with a schema version', () => {
  const root = tmp();
  try {
    const b = new Brain(root);
    assert.equal(b.schemaVersion(), BRAIN_SCHEMA_VERSION);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an import from a NEWER build is refused, naming both versions', () => {
  const r = importCompatible(BRAIN_SCHEMA_VERSION + 1);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /newer NeuraMesh/);
  assert.match(r.reason!, /update the app/, 'the error names the action that fixes it (doctrine §3.1)');
  assert.equal(importCompatible(BRAIN_SCHEMA_VERSION).ok, true);
  assert.equal(importCompatible(0).ok, true, 'an older brain is readable');
});

// ── The reason the brain exists: a second agent inherits what the first learned ───────────────
test('a note written by one agent is readable by the NEXT one on the same subject', () => {
  const root = tmp();
  try {
    const brain = new Brain(root);
    const orch = brain.open({ kind: 'thread', id: 'abc-def' });
    orch.writeNote('brief', 'The human wants three directions. Accent stays oak.');

    // a different agent, later, opening the SAME subject — the handoff the transcript tail could not carry
    const designer = new Brain(root).open({ kind: 'thread', id: 'abc-def' });
    const notes = designer.notes();
    assert.equal(notes.length, 1);
    assert.match(notes[0]!.body, /three directions/);
    assert.equal(notes[0]!.name, 'brief.md');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a note name cannot escape its subject brain — the PROPERTY, not the spelling', () => {
  const root = tmp();
  try {
    const b = new Brain(root).open({ kind: 'task', number: 1 });
    // Assert containment rather than an exact filename: the sanitiser keeps `.` (so `../../escape`
    // becomes `..-..-escape`), and pinning the string would make a future tightening look like a
    // regression. What must hold is that every written note resolves INSIDE notes/.
    for (const crafted of ['../../escape', '..', '/etc/passwd', 'a/b/c', '....//x']) {
      b.writeNote(crafted, 'nope');
    }
    const notesDir = join(b.path, 'notes');
    for (const n of b.notes()) {
      const resolved = join(notesDir, n.name);
      assert.ok(resolved.startsWith(notesDir + '/'), `${n.name} escaped its brain`);
      assert.ok(!n.name.includes('/'), `${n.name} still carries a separator`);
    }
    assert.ok(b.notes().length > 0, 'the notes were actually written');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('secrets are redacted before anything is persisted', () => {
  const root = tmp();
  try {
    const b = new Brain(root).open({ kind: 'task', number: 2 });
    b.writeNote('leak', 'the key is sk-ant-abc123def456 and it should not persist');
    assert.match(b.notes()[0]!.body, /\[redacted\]/);
    assert.ok(!b.notes()[0]!.body.includes('sk-ant-abc123def456'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── The ledger ───────────────────────────────────────────────────────────────────────────────
test('a ledger replays what a turn committed, in order', () => {
  const root = tmp();
  try {
    const b = new Brain(root).open({ kind: 'task', number: 1046 });
    const led = b.ledger('turn-1');
    led.append({ t: 'turn.open', turnId: 'turn-1', kind: 'work', agent: 'patch', model: 'opus', at: '2026-07-31T00:00:00Z' });
    led.append({ t: 'tool.call', id: 'c1', name: 'Bash', input: { command: 'pnpm test' } });
    led.append({ t: 'gate', id: 'c1', capability: 'shell.exec', verdict: 'allow', reason: 'test command' });
    led.append({ t: 'tool.result', id: 'c1', ok: true, output: '479 passing' });
    led.append({ t: 'checkpoint', step: 1, note: 'tests green' });
    const { entries, truncatedAt } = led.replay();
    assert.equal(truncatedAt, null);
    assert.equal(entries.length, 5);
    assert.equal(entries[0]!.t, 'turn.open');
    assert.deepEqual(led.lastCheckpoint(), { step: 1, note: 'tests green' });
    assert.equal(led.settled(), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('RESUME — a crash mid-write leaves a partial line, and replay degrades instead of throwing', () => {
  const root = tmp();
  try {
    const b = new Brain(root).open({ kind: 'task', number: 9 });
    const led = b.ledger('turn-crash');
    led.append({ t: 'turn.open', turnId: 'turn-crash', kind: 'work', agent: 'patch', model: 'opus', at: 'now' });
    led.append({ t: 'checkpoint', step: 2, note: 'branch pushed' });
    appendFileSync(led.file, '{"t":"tool.call","id":"c9","na'); // killed mid-write

    const { entries, truncatedAt } = led.replay();
    assert.equal(entries.length, 2, 'everything committed before the crash survives');
    assert.equal(truncatedAt, 3);
    assert.deepEqual(led.lastCheckpoint(), { step: 2, note: 'branch pushed' }, 'the resume point is intact');

    const bad = led.quarantineTail();
    assert.ok(bad?.endsWith('.bad'), 'the corrupt tail is preserved for diagnosis, not discarded');
    assert.equal(led.replay().truncatedAt, null, 'and replay is clean afterwards');
    assert.equal(led.replay().entries.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a settled ledger is recognisable, so a finished turn is never resumed', () => {
  const root = tmp();
  try {
    const led = new Brain(root).open({ kind: 'task', number: 3 }).ledger('t');
    led.append({ t: 'turn.open', turnId: 't', kind: 'work', agent: 'a', model: 'm', at: 'now' });
    assert.equal(led.settled(), false);
    led.append({ t: 'turn.settle', state: 'done', summary: 'shipped', at: 'now' });
    assert.equal(led.settled(), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing ledger replays empty rather than throwing', () => {
  const led = new Ledger(join(tmpdir(), 'nm-nonexistent-ledger.jsonl'));
  assert.deepEqual(led.replay(), { entries: [], truncatedAt: null });
  assert.equal(led.lastCheckpoint(), null);
});

test('the ledger streams for large turns', async () => {
  const root = tmp();
  try {
    const led = new Brain(root).open({ kind: 'task', number: 4 }).ledger('big');
    for (let i = 0; i < 50; i += 1) led.append({ t: 'checkpoint', step: i, note: `step ${i}` });
    let count = 0;
    for await (const _e of led.stream()) count += 1;
    assert.equal(count, 50);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── Envelopes: how a parent collects a subtree ────────────────────────────────────────────────
const env = (over: Partial<AgentMessage> = {}): AgentMessage => ({
  id: `m${Math.random().toString(36).slice(2, 8)}`, v: 1,
  from: { kind: 'subagent', id: 'leg', turnId: 'child-1' },
  to: { kind: 'parent' },
  kind: 'result',
  subject: { workspaceId: 'w', channelId: 'c', taskId: 't' },
  body: { text: 'direction A drafted', data: { rounds: 1 } },
  at: '2026-07-31T00:00:00Z',
  ...over,
} as AgentMessage);

test('a parent collects its subtree results from the shared brain — no network hop', () => {
  const root = tmp();
  try {
    const b = new Brain(root).open({ kind: 'task', number: 1046 });
    b.appendMessage(env({ causedBy: 'parent-1', body: { text: 'A drafted' } }));
    b.appendMessage(env({ causedBy: 'parent-1', body: { text: 'B drafted' } }));
    b.appendMessage(env({ causedBy: 'other-parent', body: { text: 'unrelated' } }));
    const mine = b.collect('parent-1');
    assert.equal(mine.length, 2);
    assert.deepEqual(mine.map((m) => m.body.text), ['A drafted', 'B drafted']);
    assert.equal(b.messages().length, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a partial envelope line is skipped, not fatal', () => {
  const root = tmp();
  try {
    const b = new Brain(root).open({ kind: 'task', number: 5 });
    b.appendMessage(env());
    appendFileSync(join(b.path, 'messages.jsonl'), '{"id":"trunc');
    assert.equal(b.messages().length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('index reports what an arriving agent can inherit', () => {
  const root = tmp();
  try {
    const b = new Brain(root).open({ kind: 'thread', id: 'idx-1' });
    b.writeNote('brief', 'the brief');
    b.ledger('t1').append({ t: 'checkpoint', step: 1, note: 'x' });
    b.appendMessage(env());
    writeFileSync(join(b.workspaceDir(), 'report.md'), '# report');
    const i = b.index();
    assert.equal(i.notes.length, 1);
    assert.deepEqual(i.turns, ['t1']);
    assert.equal(i.messages, 1);
    assert.equal(i.workspaceFiles, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reclaim removes a subject brain with its task', () => {
  const root = tmp();
  try {
    const brain = new Brain(root);
    brain.open({ kind: 'task', number: 88 }).writeNote('n', 'x');
    assert.ok(brain.subjects().includes('task-88'));
    brain.reclaim({ kind: 'task', number: 88 });
    assert.ok(!brain.subjects().includes('task-88'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── Portability tiers ────────────────────────────────────────────────────────────────────────
test('TIERS — credentials and worktrees never travel; subject brains always do', () => {
  assert.equal(tierOf('subjects/task-1046/turns/t1.jsonl'), 'A');
  assert.equal(tierOf('subjects/thread-abc/notes/brief.md'), 'A');
  assert.equal(tierOf('attachments/img.png'), 'A');
  assert.equal(tierOf('state/replica.db'), 'B');
  assert.equal(tierOf('cache/worktrees/nm-1046/src/x.ts'), 'C', 'a worktree is absolute-path bound and BREAKS when moved');
  assert.equal(tierOf('identity/clerk-session.json'), 'C');
  assert.equal(tierOf('session.json'), 'C');
});

test('EXPORT — tier C is never exportable, at any flag combination', () => {
  for (const withCache of [true, false]) {
    assert.equal(exportable('cache/worktrees/nm-1/x', { withCache }), false);
    assert.equal(exportable('identity/clerk-session.json', { withCache }), false);
  }
  assert.equal(exportable('subjects/task-1/notes/a.md'), true);
  assert.equal(exportable('state/replica.db'), false, 'the rebuildable cache is excluded by default');
  assert.equal(exportable('state/replica.db', { withCache: true }), true, '…and included only on request');
});

// ── The write→read loop: a note is only worth writing if the next agent reads it ───────────────
test('an arriving agent reads what earlier legs wrote — newest first, bounded', () => {
  const root = tmp();
  try {
    const b = new Brain(root).open({ kind: 'task', number: 1013 });
    // three legs file their findings, as spawnLegFor does on settle
    b.writeNote('leg-angle A', '# angle A (marketer)\n\nHabit mechanics matter more than streaks.');
    b.writeNote('leg-angle B', '# angle B (reviewer)\n\nThe motivation literature is thinner than claimed.');
    b.writeNote('leg-angle C', '# angle C (architect)\n\nRetention hinges on the second session.');

    // a LATER agent on the same task — a rework bounce, a re-offer — opens the same subject
    const arriving = new Brain(root).open({ kind: 'task', number: 1013 });
    const notes = arriving.notes();
    assert.equal(notes.length, 3, 'everything earlier work established is available');
    assert.ok(notes.some((n) => n.body.includes('second session')));
    // and it is keyed on the TASK, so the agent identity is irrelevant — the point of a subject brain
    assert.ok(arriving.path.endsWith('task-1013'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a leg result is BOTH an envelope and a note — structure for the harness, prose for the human', () => {
  const root = tmp();
  try {
    const b = new Brain(root).open({ kind: 'task', number: 7 });
    b.appendMessage(env({
      from: { kind: 'subagent', id: 'marketer', turnId: 'leg-1' },
      causedBy: 'parent-1',
      body: { text: 'angle A drafted', data: { kind: 'generic', role: 'marketer', label: 'angle A' } },
    }));
    b.writeNote('leg-angle A', '# angle A (marketer)\n\nfull findings here');
    // the harness reads the typed result…
    const collected = b.collect('parent-1');
    assert.equal(collected.length, 1);
    assert.equal((collected[0]!.body.data as { role: string }).role, 'marketer');
    // …and the next agent reads the prose
    assert.match(b.notes()[0]!.body, /full findings here/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── The workspace jail (a model-supplied file name is DATA) ───────────────────────────────────
// `read_workspace_file` hands a name straight from a model to the filesystem. Without this it is a
// file-read primitive pointed at the user's disk, so the refusals matter more than the successes.

test('a name resolves inside the workspace, or is refused', () => {
  const ws = '/brain/subjects/thread-abc/workspace';
  assert.equal(resolveInWorkspace(ws, 'report.md'), '/brain/subjects/thread-abc/workspace/report.md');
  assert.equal(resolveInWorkspace(ws, 'out/chart.png'), '/brain/subjects/thread-abc/workspace/out/chart.png');
  assert.equal(resolveInWorkspace(ws, './notes.md'), '/brain/subjects/thread-abc/workspace/notes.md');
  assert.equal(resolveInWorkspace(ws, ''), ws, 'the workspace itself resolves — the caller rejects it as not-a-file');
});

test('traversal, absolute paths and sibling-prefix escapes are all refused', () => {
  const ws = '/brain/subjects/thread-abc/workspace';
  for (const evil of [
    '../../../../etc/passwd',
    '..',
    '../notes/secret.md',              // the sibling notes dir is still outside the workspace
    '/etc/passwd',
    '/brain/subjects/thread-abc/turns/t1.jsonl',
    'a/../../../../../../etc/hosts',
  ]) {
    assert.equal(resolveInWorkspace(ws, evil), null, `${evil} must be refused`);
  }
});

test('a sibling directory sharing the workspace name prefix is not inside it', () => {
  // the bug a plain startsWith(root) would have: `…/workspace-old` passes a prefix test but is a
  // different directory. The separator is what makes the check a containment check.
  assert.equal(resolveInWorkspace('/brain/w/workspace', '../workspace-old/leak.md'), null);
});
