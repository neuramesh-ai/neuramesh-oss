// Chat mode (docs/34) — the decisions a chat wake makes, tested without a model.
// Run from apps/desktop: pnpm exec tsx --test src/main/chatmode.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { subjectPath } from './harness/brain';
import {
  chatSystemPrompt,
  chatWorkspaceDir,
  legacyChatWorkspaceDir,
  fileDropBody,
  isDeliverableFile,
  isImageFile,
  pickDeliverables,
  pickResponder,
  type ChatAgent,
  type ChatFile,
} from './chatmode';
import { isChatThread, modeMarker, parseModeMarker, threadModeOf } from '@neuramesh/shared';

const agent = (over: Partial<ChatAgent> & { id: string; name: string }): ChatAgent => ({
  role: 'developer',
  runtime: 'claude-code',
  ...over,
});

const REX = agent({ id: 'a-rex', name: 'rex', role: 'orchestrator' });
const PATCH = agent({ id: 'a-patch', name: 'patch', role: 'developer' });
const IRIS = agent({ id: 'a-iris', name: 'iris', role: 'designer' });
const ROOM = [REX, PATCH, IRIS];

// ── the mode itself ─────────────────────────────────────────────────────────────────────────
test('an absent or unknown mode is tasks — a thread never becomes a chat by accident', () => {
  assert.equal(threadModeOf(undefined), 'tasks');
  assert.equal(threadModeOf(null), 'tasks');
  assert.equal(threadModeOf(''), 'tasks');
  assert.equal(threadModeOf('CHAT'), 'tasks', 'case matters — only the exact value skips the board');
  assert.equal(threadModeOf('anything-else'), 'tasks');
  assert.equal(threadModeOf('chat'), 'chat');
  assert.equal(isChatThread('chat'), true);
  assert.equal(isChatThread(undefined), false, 'every pre-0099 row reads as tasks');
});

// ── who answers ─────────────────────────────────────────────────────────────────────────────
test('the last agent who spoke keeps the conversation', () => {
  const rows = [
    { author_kind: 'human', author_id: 'u-1' },
    { author_kind: 'agent', author_id: 'a-rex' },
    { author_kind: 'human', author_id: 'u-1' },
    { author_kind: 'agent', author_id: 'a-patch' }, // newest agent
  ];
  assert.equal(pickResponder(rows, ROOM)?.name, 'patch');
});

test('order is declared, not guessed', () => {
  const newestFirst = [
    { author_kind: 'agent', author_id: 'a-patch' },
    { author_kind: 'agent', author_id: 'a-rex' },
  ];
  assert.equal(pickResponder(newestFirst, ROOM, { newestFirst: true })?.name, 'patch');
  assert.equal(pickResponder(newestFirst, ROOM)?.name, 'rex', 'read the other way, the other end is newest');
});

test('an opening message with no agent turns yet goes to the orchestrator', () => {
  assert.equal(pickResponder([{ author_kind: 'human', author_id: 'u-1' }], ROOM)?.name, 'rex');
  assert.equal(pickResponder([], ROOM)?.name, 'rex');
});

test('an agent that has LEFT the room does not keep answering', () => {
  const rows = [{ author_kind: 'agent', author_id: 'a-gone' }, { author_kind: 'human', author_id: 'u-1' }];
  // a-gone spoke here before it was removed/retired; it is not in the candidate set any more
  assert.equal(pickResponder(rows, ROOM)?.name, 'rex', 'falls through to the orchestrator, never to a stranger');
});

test('a room with no orchestrator and no prior agent has nobody to answer', () => {
  assert.equal(pickResponder([{ author_kind: 'human', author_id: 'u-1' }], [PATCH]), null);
});

// ── the workspace ───────────────────────────────────────────────────────────────────────────
test('one workspace per thread, stable across turns', () => {
  const t = '7d4f1a2b-9c3e-4a5b-8d6f-1e2c3b4a5d6e';
  const a = chatWorkspaceDir('/home/g', t);
  assert.equal(a, chatWorkspaceDir('/home/g', t), 'same thread, same directory — that is what makes "make it shorter" work');
  assert.notEqual(a, chatWorkspaceDir('/home/g', '00000000-0000-0000-0000-000000000000'));
  assert.match(a, /\.neuramesh\/subjects\/thread-[0-9a-f]{16}\/workspace$/, 'no dashes, no title — the id decides');
});

test('a conversation has ONE home: its workspace IS its brain workspace', () => {
  // The divergence this pins shut: files lived at chats/nm-<12>, while the same conversation's
  // ledgers, notes and result envelopes lived at subjects/thread-<16>/. An agent asked "what have
  // we got here" could reach half the answer at most, and docs/harness/01 §8 had specified the
  // merge that never happened.
  const t = '7d4f1a2b-9c3e-4a5b-8d6f-1e2c3b4a5d6e';
  const brainSubject = subjectPath({ kind: 'thread', id: t }, '/home/g/.neuramesh');
  assert.equal(chatWorkspaceDir('/home/g', t), join(brainSubject, 'workspace'));
  assert.notEqual(chatWorkspaceDir('/home/g', t), legacyChatWorkspaceDir('/home/g', t), 'and it is not where it used to be');
  assert.match(legacyChatWorkspaceDir('/home/g', t), /\.neuramesh\/chats\/nm-[0-9a-f]{12}$/, 'the legacy spelling stays exact — adoption reads it');
});

test('the legacy name cannot be reversed into a brain slug', () => {
  // WHY adoption is lazy and per-thread rather than a bulk migration step: 12 characters cannot
  // yield 16, so only a caller holding the real thread id can map one to the other.
  const t = '7d4f1a2b-9c3e-4a5b-8d6f-1e2c3b4a5d6e';
  const legacyId = legacyChatWorkspaceDir('/home/g', t).split('nm-')[1]!;
  const brainId = chatWorkspaceDir('/home/g', t).match(/thread-([0-9a-f]+)/)![1]!;
  assert.equal(legacyId.length, 12);
  assert.equal(brainId.length, 16);
  assert.ok(brainId.startsWith(legacyId), 'the short one is a prefix — which is exactly why it is lossy');
});

// ── which files are deliverables ────────────────────────────────────────────────────────────
test('dotfiles, evidence and dependency trees are never deliverables', () => {
  assert.equal(isDeliverableFile('report.md'), true);
  assert.equal(isDeliverableFile('out/chart.png'), true);
  assert.equal(isDeliverableFile('.env'), false);
  assert.equal(isDeliverableFile('.nm-evidence/shot.png'), false);
  assert.equal(isDeliverableFile('.nm-evidence/runs/deep/shot.png'), false, 'nested under a dot-dir too');
  assert.equal(isDeliverableFile('node_modules/left-pad/index.js'), false);
  assert.equal(isDeliverableFile('src/__pycache__/x.pyc'), false);
});

const f = (name: string, mtimeMs: number, sizeBytes = 1000): ChatFile => ({ name, mtimeMs, sizeBytes });

test('only what THIS turn touched is delivered', () => {
  const since = 1000;
  const { take } = pickDeliverables([f('old.md', 400), f('new.md', 1200)], since);
  assert.deepEqual(take.map((x) => x.name), ['new.md'], 'turn 5 must not re-deliver turn 2’s file');
});

test('a file rewritten this turn IS re-delivered — that is the revision', () => {
  const { take } = pickDeliverables([f('report.md', 5000)], 1000);
  assert.deepEqual(take.map((x) => x.name), ['report.md']);
});

test('newest first, capped, and every drop is NAMED', () => {
  const files = Array.from({ length: 9 }, (_, i) => f(`f${i}.md`, 2000 + i));
  const { take, dropped } = pickDeliverables(files, 1000);
  assert.equal(take.length, 6);
  assert.deepEqual(take.map((x) => x.name), ['f8.md', 'f7.md', 'f6.md', 'f5.md', 'f4.md', 'f3.md']);
  assert.deepEqual(dropped, ['f2.md', 'f1.md', 'f0.md'], 'silent truncation reads as "that was everything"');
});

test('an oversize file is named, not vanished', () => {
  const { take, dropped } = pickDeliverables([f('huge.csv', 2000, 900_000), f('ok.md', 2000)], 1000);
  assert.deepEqual(take.map((x) => x.name), ['ok.md']);
  assert.deepEqual(dropped, ['huge.csv (too large to attach)']);
});

test('images are recognised for the data-URI path', () => {
  assert.equal(isImageFile('chart.PNG'), true);
  assert.equal(isImageFile('a/b/shot.jpeg'), true);
  assert.equal(isImageFile('report.md'), false);
});

test('the drop body is exactly the shape the inline card parses', () => {
  const body = fileDropBody('Competitor teardown', 'competitor-teardown.md', '# Teardown\n\nbody');
  // docs/30 / docDropParts: 📄 **label** — saved to the library as `file`.\n\n<content>
  assert.match(body, /^📄 \*\*Competitor teardown\*\* — saved to the library as `competitor-teardown\.md`\.\n\n# Teardown/);
});

// ── the prompt ──────────────────────────────────────────────────────────────────────────────
// The board clause forks by seat (the prose-consent round, 2026-08-10 — docs/34 §14 amended):
// workers keep the flat prohibition; the ORCHESTRATOR may create on the human's explicit word,
// and must never re-send a declined proposal card — creating IS the answer to "yes create it".
test('the chat prompt forbids claiming board actions — workers flatly, rex with the explicit-word carve-out', () => {
  const worker = chatSystemPrompt(agent({ id: 'a-w', name: 'mira', role: 'developer' }), 'product', { canUseTools: true, workspaceDir: '/tmp/w' });
  assert.match(worker, /cannot create, offer, plan, design or route a task/i);
  assert.match(worker, /never say you have filed, created, queued or handed off anything/i);
  assert.ok(!/add_backlog_item/.test(worker), 'a worker conversation must not be told about board tools it lacks');
  assert.ok(!/turn \*\*Tasks\*\* on/i.test(worker), 'the Tasks toggle died with docs/34 §14 — the prompt must not resurrect it');
  assert.match(worker, /Do NOT emit nmq question cards/i, 'a chat must not file items in the needs-you queue');

  const rex = chatSystemPrompt(REX, 'product', { canUseTools: true, workspaceDir: '/tmp/w' });
  assert.match(rex, /Nothing here becomes board work uninvited/i);
  assert.match(rex, /explicit/i, "the carve-out hinges on the human's explicit word");
  assert.match(rex, /add_backlog_item/, 'rex is told the road that actually exists in its registry');
  assert.match(rex, /promote_backlog_item/);
  assert.match(rex, /never re-send a card they already declined/i, 'the born-checked re-ask loop is banned in words too');
  assert.match(rex, /Do NOT emit nmq question cards/i);
});

test('a tool-less runtime is told the truth instead of the tool list', () => {
  const p = chatSystemPrompt(agent({ id: 'a-g', name: 'gem', runtime: 'gemini' }), 'product', { canUseTools: false });
  assert.ok(!/Run \*\*commands\*\*/.test(p), 'never advertise tools this runtime does not have');
  assert.match(p, /no file or command tools on this runtime/i);
  assert.match(p, /start_deep_work/, 'the one capability it does keep');
});

test('the orchestrator is introduced as itself, not as the board', () => {
  const p = chatSystemPrompt(REX, 'product', { canUseTools: true });
  assert.match(p, /simply talking with the human/i);
  const dev = chatSystemPrompt(PATCH, 'product', { canUseTools: true });
  assert.match(dev, /the developer in #product/i);
});

test('a hired agent brings its brief', () => {
  const p = chatSystemPrompt(agent({ id: 'a-s', name: 'sol', role: 'developer', brief: 'Rust and systems performance' }), 'product', { canUseTools: true });
  assert.match(p, /Your specialty: Rust and systems performance/);
});

// ── the mode divider (docs/34) ──────────────────────────────────────────────────────────────
test('a mode marker round-trips and nothing else parses as one', () => {
  assert.equal(parseModeMarker(modeMarker('chat')), 'chat');
  assert.equal(parseModeMarker(modeMarker('tasks')), 'tasks');
  assert.equal(parseModeMarker('  ‹mode:chat›  '), 'chat', 'a stray newline from the composer still parses');
  assert.equal(parseModeMarker('turn ‹mode:chat› on'), null, 'it must be the WHOLE message, not a mention of one');
  assert.equal(parseModeMarker('mode:chat'), null);
  assert.equal(parseModeMarker('‹mode:board›'), null, 'only the two real modes');
  assert.equal(parseModeMarker('Who else is building this?'), null);
});
