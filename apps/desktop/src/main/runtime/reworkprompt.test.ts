// Regression for the review→rework loop: a reviewer's change-request must reach the
// developer's prompt as a DIRECT-fix instruction (not a full redo). Run from apps/desktop:
//   pnpm exec tsx --test src/main/runtime/reworkprompt.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reworkBlock, buildCodingPrompt } from './adapter';
import type { ExecTask } from '../agents';

const task = { number: 1013, title: 'add /terms and /privacy pages', requirements: '[]' } as unknown as ExecTask;

test('no feedback → empty block (a fresh run carries no rework preamble)', () => {
  assert.equal(reworkBlock(undefined), '');
  assert.equal(reworkBlock(null), '');
  assert.equal(reworkBlock('   \n  '), '', 'whitespace-only is treated as no feedback');
});

test('feedback → a direct-fix instruction that carries the reviewer notes verbatim', () => {
  const notes = 'The /privacy screenshot is missing — re-capture it and attach.';
  const block = reworkBlock(notes);
  assert.match(block, /address each point directly/i);
  assert.match(block, /do not re-run the whole task|do not.*rewrite/i);
  assert.ok(block.includes(notes), 'the reviewer notes must appear in the block');
});

test('buildCodingPrompt folds the rework block in when notes are present, omits it otherwise', () => {
  const notes = 'CI is green; just re-attach the /terms screenshot artifact.';
  const withFb = buildCodingPrompt(task, null, true, undefined, notes);
  const without = buildCodingPrompt(task, null, true, undefined, '');
  assert.ok(withFb.includes(notes), 'rework notes reach the worker prompt');
  assert.match(withFb, /address each point directly/i);
  assert.ok(!/address each point directly/i.test(without), 'no rework preamble on a fresh run');
});

test('the record_lesson nudge rides the rework block ONLY where the tool exists', () => {
  const notes = 'The evidence HTML files were committed — remove them from the PR.';
  assert.match(reworkBlock(notes, true), /record_lesson/i, 'tools present → correction gets the record-the-lesson nudge');
  assert.ok(!/record_lesson/i.test(reworkBlock(notes)), 'no tools: no dangling tool reference');
  // Bus DOWN (the fail-open path, and the default): never name a tool the turn cannot call. A prompt
  // that advertises an absent tool is worse than silence — the model tries it and gets an error.
  assert.ok(!/record_lesson/i.test(buildCodingPrompt(task, null, true, undefined, notes)), 'bus down → the prompt names no nm tool');
});

test('the tool bus makes the CLI coding prompt name the nm tools it can now actually call', () => {
  // docs/harness/03: before the bus these tools were Claude-only, so the CLI prompt deliberately
  // named none of them. Now they reach every runtime over the loopback bridge — and an agent uses
  // the tools it is TOLD about, so the prompt has to change with the capability.
  const notes = 'The evidence HTML files were committed — remove them from the PR.';
  const withBus = buildCodingPrompt(task, null, true, undefined, notes, undefined, undefined, undefined, true);
  for (const tool of ['declare_beats', 'advance_beat', 'screenshot', 'record_lesson', 'propose_skill', 'add_backlog_item']) {
    assert.ok(withBus.includes(tool), `bus up → the prompt names ${tool}`);
  }
  const withoutBus = buildCodingPrompt(task, null, true, undefined, notes);
  for (const tool of ['declare_beats', 'screenshot', 'add_backlog_item']) {
    assert.ok(!withoutBus.includes(tool), `bus down → the prompt stays silent about ${tool}`);
  }
});

test('channel lessons reach the coding prompt when present', () => {
  const lessons = '\nLessons this team already learned from review corrections — do NOT repeat them:\n- mock evidence HTML is never committed — renders attach as artifacts (from #1004)\n';
  const withLessons = buildCodingPrompt(task, null, true, undefined, '', undefined, lessons);
  const without = buildCodingPrompt(task, null, true, undefined, '');
  assert.ok(withLessons.includes('do NOT repeat them'), 'lessons block reaches the prompt');
  assert.ok(withLessons.includes('(from #1004)'), 'lesson provenance survives');
  assert.ok(!without.includes('do NOT repeat them'), 'no lessons block when the channel has none');
});

test('repo prompts route working files to the git-excluded .nm-evidence/ staging dir', () => {
  assert.match(buildCodingPrompt(task, null, true), /\.nm-evidence\//, 'repo-backed: evidence dir named');
  assert.match(buildCodingPrompt(task, null, true), /never reaches the commit or PR/i, 'and its guarantee stated');
  assert.match(buildCodingPrompt(task, null, false), /\.nm-evidence\//, 'scratch: evidence dir named too');
});
