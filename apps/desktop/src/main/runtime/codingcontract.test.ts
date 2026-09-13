// THE WORKER TURN'S STRUCTURAL CONTRACT.
//
// This file was the byte-identity net for the YAML extraction — `legacy` froze the pre-contract
// literal and every combination had to match it character for character. Its own header named
// the exit: "when the contract is deliberately reworded, this file is deleted or its expectation
// updated in the same commit." That commit is 2026-08-18 (the diet): the Claude runtime's inline
// literal — which had drifted AHEAD of the contract — was folded INTO worker.yaml and deleted,
// so there is no legacy text left to be identical to. What must now hold is STRUCTURE: every
// optional block toggles with its input, nothing composes to a leaked `${placeholder}`, and the
// clauses the loop depends on survive rewording only deliberately.
//
//   pnpm exec tsx --test src/main/runtime/codingcontract.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCodingPrompt, reworkBlock, nmToolsBlock, codingSystemPrompt } from './adapter';
import type { ExecTask, SkillRef } from '../agents';

const task = (over: Partial<ExecTask> = {}): ExecTask => ({
  number: 1042,
  title: 'Rate-limit the login endpoint',
  requirements: JSON.stringify(['429 past the limit', 'tests cover the boundary + reset window']),
  ...over,
} as ExecTask);

const SKILLS: SkillRef[] = [
  { name: 'investigate', description: 'root-cause before editing' } as SkillRef,
  { name: 'evidence', description: 'prove it with a screenshot' } as SkillRef,
];

test('every block toggles with its input, and nothing leaks a placeholder', () => {
  for (const repoBacked of [true, false]) {
    for (const hasNmTools of [true, false]) {
      for (const withSkills of [true, false]) {
        for (const withRework of [true, false]) {
          for (const withExtras of [true, false]) {
            const p = buildCodingPrompt(
              withExtras ? task() : task({ requirements: null }),
              withExtras ? 'the room settled on IP-based limiting' : null,
              repoBacked,
              withSkills ? SKILLS : undefined,
              withRework ? 'the 429 body is empty — return a Retry-After' : undefined,
              withExtras ? '\nAn image is attached: mock.png\n' : undefined,
              withExtras ? '\nLessons from this channel:\n- never widen a limit to make a test pass\n' : undefined,
              withExtras ? 'backend security work' : null,
              hasNmTools,
            );
            const label = `repo=${repoBacked} tools=${hasNmTools} skills=${withSkills} rework=${withRework} extras=${withExtras}`;
            assert.ok(!/\$\{/.test(p), `unsubstituted placeholder leaked — ${label}: ${/\$\{[^}]+\}/.exec(p)?.[0]}`);
            assert.match(p, /^Implement board task #1042: Rate-limit the login endpoint/, label);
            assert.match(p, /YOUR TURN IS THE EXECUTION/, label);
            assert.match(p, /Name every file you produced/, label);
            // the two worlds are mutually exclusive and always present
            assert.equal(/repository checkout/.test(p), repoBacked, `where-block wrong world — ${label}`);
            assert.equal(/scratch workspace/.test(p), !repoBacked, `where-block wrong world — ${label}`);
            assert.match(p, /\.nm-evidence\//, label);
            // tool guidance rides ONLY where the nm tools exist (its one home)
            assert.equal(/declare_beats/.test(p), hasNmTools, `beats guidance vs bus — ${label}`);
            assert.equal(/create_whiteboard/.test(p), hasNmTools, `wb guidance vs bus — ${label}`);
            assert.equal(/add_backlog_item/.test(p), hasNmTools, `backlog guidance vs bus — ${label}`);
            // optional blocks appear exactly when their input does
            assert.equal(/Resolved requirements/.test(p), withExtras, label);
            assert.equal(/Channel context/.test(p), withExtras, label);
            assert.equal(/Your specialty: backend security work/.test(p), withExtras, label);
            assert.equal(/Team conventions you may reuse/.test(p), withSkills, label);
            assert.equal(/reviewer requested changes/.test(p), withRework, label);
            // load_skill is only worth naming where the tool exists
            assert.equal(/Call load_skill/.test(p), withSkills && hasNmTools, label);
          }
        }
      }
    }
  }
});

test('skills lines are index entries, not pitches — capped count and description', () => {
  const many: SkillRef[] = Array.from({ length: 40 }, (_, i) => ({
    name: `skill-${i}`, description: 'x'.repeat(300),
  } as SkillRef));
  const p = buildCodingPrompt(task(), null, true, many, undefined, undefined, undefined, null, true);
  assert.ok(!p.includes('skill-24'), 'the skills list must cap at 24 entries');
  assert.ok(p.includes('skill-23'), 'the cap trimmed too far');
  assert.ok(!/x{91}/.test(p), 'a skill description escaped the 90-char cap');
});

test('the rework block folds its nudges only where the nm tools exist', () => {
  assert.equal(reworkBlock('', true), '', 'blank notes must compose nothing');
  assert.equal(reworkBlock('  ', false), '', 'whitespace notes must compose nothing');
  const withTools = reworkBlock('fix the empty 429 body', true);
  assert.match(withTools, /Address each point DIRECTLY and minimally/);
  assert.match(withTools, /declare_beats/);
  assert.match(withTools, /record_lesson/);
  const busDown = reworkBlock('fix the empty 429 body', false);
  assert.match(busDown, /Address each point DIRECTLY and minimally/);
  assert.ok(!/declare_beats|record_lesson/.test(busDown), 'bus down → the rework block names no nm tool');
});

test('nmToolsBlock is all-or-nothing', () => {
  assert.equal(nmToolsBlock(false), '');
  const b = nmToolsBlock(true);
  for (const t of ['declare_beats', 'advance_beat', 'screenshot', 'record_lesson', 'propose_skill', 'add_backlog_item', 'create_whiteboard']) {
    assert.ok(b.includes(t), `nm_tools block lost its ${t} guidance`);
  }
});

test('the execution system prompt carries identity, workspace and standing instructions', () => {
  const withRules = codingSystemPrompt('patch', true, 'always add a regression guard');
  assert.match(withRules, /^You are patch, a NeuraMesh worker agent implementing a board task in a dedicated git worktree\./);
  assert.match(withRules, /Your standing instructions: always add a regression guard —/);
  // no instructions → no dangling sentence, and the scratch wording swaps in
  const bare = codingSystemPrompt('scout', false, null);
  assert.match(bare, /in a dedicated scratch workspace\. Be surgical and concrete/);
  assert.ok(!/standing instructions/.test(bare));
});
