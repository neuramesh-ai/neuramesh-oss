// the claim line (2026-10-05): the words a worker posts when it claims a unit, from one function the
// daemon and the preview story both call.
// run from packages/shared:
//   pnpm test claimline
import { describe, expect, it } from 'vitest';
import { claimLine, claimWorkspace, PLAN_CHECKLIST, STATIC_CHECKLIST, type ChecklistSource } from '../src/claimline';

const unit = { number: 1064, title: 'Add an annual price toggle to the pricing page', estimate: '~10–20 min' };
const repo = claimWorkspace({ repo: true, branch: 'nm/1064-annual-price-toggle' });
// the house rules for the line's own words: no em dash, no semicolon, no -ing word
const STE_BREAK = /[—;]|\b\w{2,}ing\b/;

describe('the claim line', () => {
  it('names the unit, the checklist, the estimate and the workspace, in four lines', () => {
    const line = claimLine({ ...unit, checklist: ['a toggle above the plans', 'the annual price shows'], source: 'intake', workspace: repo });
    expect(line.split('\n')).toEqual([
      'I claimed #1064 “Add an annual price toggle to the pricing page”. I start now, and the live run on this task shows what I do.',
      '- **Checklist from the intake:** a toggle above the plans · the annual price shows',
      '- **Estimate:** ~10–20 min',
      '- **Workspace:** a worktree on branch `nm/1064-annual-price-toggle`. I push the branch before the review.',
    ]);
  });

  // the review of round 2 (2026-10-05): a plan-first unit reaches the claim with its requirements
  // confirmed by approve_plan and none written, and the line called the daemon's default "from the intake"
  it('says where the checklist came from, and only the intake says intake', () => {
    const label = (source: ChecklistSource, checklist: readonly string[]) =>
      claimLine({ ...unit, checklist, source, workspace: repo }).split('\n')[1];
    expect(label('intake', ['x'])).toBe('- **Checklist from the intake:** x');
    expect(label('worker', ['x'])).toBe('- **My checklist:** x');
    expect(label('plan', PLAN_CHECKLIST)).toBe('- **Checklist:** The approved plan gives the scope · I am a member of this room · No open question stops the work');
    expect(label('default', STATIC_CHECKLIST)).toBe('- **Checklist:** The title and the room give the scope · I am a member of this room · No open question stops the work');
  });

  it('names no folder: the worktree path differs on each machine', () => {
    expect(repo).not.toMatch(/~|\.neuramesh|worktrees\//);
    expect(claimWorkspace({ repo: true })).toBe('a worktree of the repository. I push my branch before the review.');
    expect(claimWorkspace({ repo: false })).toBe('a scratch workspace. The files I make attach to this thread.');
  });

  it('follows the house rules: no em dash, no semicolon, no -ing word in its own words', () => {
    for (const items of [STATIC_CHECKLIST, PLAN_CHECKLIST]) {
      for (const item of items) expect(item, item).not.toMatch(STE_BREAK);
    }
    for (const source of ['intake', 'plan', 'worker', 'default'] as const) {
      // "pricing" is a word the person wrote in the title, so the guard reads a title without one
      const line = claimLine({ number: 7, title: 'Draft the release notes', checklist: STATIC_CHECKLIST, source, estimate: '~5 to 15 min', workspace: claimWorkspace({ repo: false }) });
      expect(line, source).not.toMatch(STE_BREAK);
    }
  });
});
