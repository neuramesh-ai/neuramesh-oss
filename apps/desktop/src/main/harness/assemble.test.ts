// The context assembler (docs/harness/05 §3.7). Run: pnpm exec tsx --test src/main/harness/assemble.test.ts
//
// The behaviour that matters is the TRIM ORDER: under pressure the transcript must yield before the
// Definition of Done, because losing the oldest chat line costs continuity while losing the acceptance
// contract costs the task. These tests pin that ordering so a future edit cannot quietly invert it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TURN_BUDGETS } from '@neuramesh/shared';
import { assemble, estimateTokens, contextBudget, transcriptBlock, assemblyLine, FILL_ORDER, type Block } from './assemble';

const block = (source: Block['source'], chars: number, parts?: string[]): Block =>
  ({ source, text: 'x'.repeat(chars), ...(parts ? { parts } : {}) });

test('everything that fits is included, in fill order', () => {
  const a = assemble([block('transcript', 40), block('contract', 40), block('dod', 40)], 1_000);
  assert.deepEqual(a.included.map((i) => i.source), ['contract', 'dod', 'transcript'], 'order is FILL_ORDER, not argument order');
  assert.deepEqual(a.dropped, []);
  assert.ok(a.tokens > 0);
});

test('empty blocks are skipped without being reported as dropped', () => {
  const a = assemble([{ source: 'notes', text: '   ' }, block('contract', 20)], 1_000);
  assert.deepEqual(a.included.map((i) => i.source), ['contract']);
  assert.deepEqual(a.dropped, [], 'nothing to drop — there was nothing there');
});

test('TRIM ORDER — the transcript yields before the Definition of Done', () => {
  // A budget that fits the contract + DoD but not the whole transcript.
  const parts = Array.from({ length: 20 }, (_, i) => `human: message number ${i} with some words in it`);
  const a = assemble([
    block('contract', 200),
    block('dod', 400),
    { source: 'transcript', text: parts.join('\n'), parts },
  ], 200);
  const kept = a.included.map((i) => i.source);
  assert.ok(kept.includes('contract') && kept.includes('dod'), 'the contract and the acceptance contract survive');
  assert.ok(a.dropped.some((d) => d.source === 'transcript'), 'the transcript is what gives way');
});

test('a trimmed transcript keeps the NEWEST lines and SAYS it trimmed', () => {
  const parts = ['human: oldest thing', 'agent: middle thing', 'human: newest thing'];
  const a = assemble([{ source: 'transcript', text: parts.join('\n'), parts }], estimateTokens('human: newest thing') + 2);
  assert.match(a.text, /newest thing/, 'recency is what a transcript is for');
  assert.ok(!a.text.includes('oldest thing'));
  assert.match(a.text, /earlier 2 message\(s\) trimmed to fit/, 'a silent truncation reads as "it saw everything"');
  assert.ok(a.dropped.some((d) => d.source === 'transcript' && d.reason === 'budget'));
});

test('a non-trimmable block is dropped WHOLE — half a contract is worse than none', () => {
  // dod has no `parts`, so it cannot be cut down; it either fits or it goes.
  const a = assemble([block('contract', 40), block('dod', 4_000)], 40);
  assert.deepEqual(a.included.map((i) => i.source), ['contract']);
  assert.ok(a.dropped.some((d) => d.source === 'dod' && d.reason === 'budget'));
  assert.ok(!a.text.includes('x'.repeat(200)), 'no partial contract in the prompt');
});

test('the contract is first in fill order, so it survives the tightest budget', () => {
  assert.equal(FILL_ORDER[0], 'contract');
  const a = assemble([block('transcript', 4_000), block('contract', 40)], 20);
  assert.deepEqual(a.included.map((i) => i.source), ['contract'], 'a turn that forgets what it is produces confident nonsense');
});

test('the total never exceeds the budget', () => {
  const parts = Array.from({ length: 200 }, (_, i) => `human: line ${i} ${'y'.repeat(60)}`);
  for (const budget of [10, 100, 1_000, 5_000]) {
    const a = assemble([
      block('contract', 300), block('facts', 300), block('dod', 300), block('notes', 2_000),
      { source: 'transcript', text: parts.join('\n'), parts },
    ], budget);
    assert.ok(a.tokens <= budget, `spent ${a.tokens} of ${budget}`);
  }
});

test('nothing vanishes: every non-empty block is either included or reported dropped', () => {
  const sources: Array<Block['source']> = ['contract', 'facts', 'dod', 'notes', 'results', 'lessons', 'recall', 'skills'];
  const blocks = sources.map((s) => block(s, 800));
  const a = assemble(blocks, 300);
  const accounted = new Set([...a.included.map((i) => i.source), ...a.dropped.map((d) => d.source)]);
  for (const s of sources) assert.ok(accounted.has(s), `${s} was neither used nor reported`);
});

test('contextBudget reserves room for the model to answer', () => {
  const work = contextBudget('work');
  assert.ok(work < TURN_BUDGETS.work.contextTokens, 'the whole window is not handed to the prompt');
  assert.ok(work > TURN_BUDGETS.work.contextTokens * 0.7);
  assert.ok(contextBudget('triage') < contextBudget('work'), 'a triage turn gets less, as its budget says');
});

// ── the transcript block: what replaces `limit 8` / `limit 14` / `limit 24` ────────────────────
test('transcriptBlock labels authorship, and distinguishes SELF from another agent', () => {
  const b = transcriptBlock([
    { author_kind: 'human', author_id: 'u1', body: 'can you look at this' },
    { author_kind: 'agent', author_id: 'me', body: 'on it' },
    { author_kind: 'agent', author_id: 'other', body: 'I already did' },
  ], { selfId: 'me' });
  assert.match(b.text, /human: can you look at this/);
  assert.match(b.text, /you: on it/);
  assert.match(b.text, /another agent: I already did/, 'an agent must not read its own words as a peer\'s');
  assert.equal(b.parts?.length, 3, 'parts let the tail be trimmed rather than the whole block dropped');
});

test('how many messages survive is the BUDGET\'s call, not a row cap', () => {
  // the same 24 rows fit differently depending on how verbose they are — which is what "fits" means
  const terse = Array.from({ length: 24 }, (_, i) => ({ author_kind: 'human', body: `line ${i}` }));
  const verbose = Array.from({ length: 24 }, (_, i) => ({ author_kind: 'human', body: `line ${i} ${'w'.repeat(400)}` }));
  const budget = 300;
  const a = assemble([transcriptBlock(terse)], budget);
  const b = assemble([transcriptBlock(verbose)], budget);
  const linesA = a.text.split('\n').filter((l) => l.startsWith('human:')).length;
  const linesB = b.text.split('\n').filter((l) => l.startsWith('human:')).length;
  assert.ok(linesA > linesB, `terse conversation keeps more turns (${linesA} vs ${linesB})`);
});

test('assemblyLine reports spend and trims for the ledger', () => {
  const parts = ['human: a', 'human: b'];
  const a = assemble([block('contract', 40), { source: 'transcript', text: parts.join('\n'), parts }], 12);
  const line = assemblyLine(a);
  assert.match(line, /context \d+ tok/);
  assert.match(line, /contract/);
});

test('estimateTokens is monotonic and cheap', () => {
  assert.ok(estimateTokens('x'.repeat(400)) > estimateTokens('x'.repeat(100)));
  assert.equal(estimateTokens(''), 0);
});
