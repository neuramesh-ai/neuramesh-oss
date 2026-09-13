import { describe, it, expect } from 'vitest';
import { JUDGES, judgeRubric, type JudgeComplete } from '../src/judge';
import { structuralScore, coercePlanTasks } from '../src/run/orchestrator';
import { RESEARCH_RUBRIC } from '../src/rubrics';
import { meanCI } from '../src/stats';

const fakeJudge = (scores: Record<string, number>): JudgeComplete => async () => ({ text: JSON.stringify(scores), tokensIn: 5, tokensOut: 5 });

describe('meanCI', () => {
  it('mean with a zero-variance sample has a zero-width interval', () => {
    const r = meanCI([80, 80, 80]);
    expect(r.mean).toBe(80);
    expect(r.lo).toBe(80);
    expect(r.hi).toBe(80);
  });
  it('empty → 0', () => {
    expect(meanCI([]).mean).toBe(0);
  });
});

describe('structuralScore (orchestration)', () => {
  const good = [
    { title: 'plan', kind: 'feature', role: 'architect', definitionOfDone: 'a written plan with a DoD', dependsOn: [] },
    { title: 'build', kind: 'feature', role: 'developer', definitionOfDone: 'implemented and tests pass', dependsOn: [0] },
    { title: 'review', kind: 'feature', role: 'reviewer', definitionOfDone: 'approved against the DoD', dependsOn: [1] },
  ];
  it('a clean DAG with valid roles + kinds + DoDs → 100', () => {
    expect(structuralScore(good)).toBe(100);
  });
  it('an invalid role costs one fifth', () => {
    expect(structuralScore([{ ...good[0]!, role: 'wizard' }, good[1]!, good[2]!])).toBe(80);
  });
  it('an invalid kind costs one fifth', () => {
    expect(structuralScore([{ ...good[0]!, kind: 'nonsense' }, good[1]!, good[2]!])).toBe(80);
  });
  it('a dependency cycle costs one fifth', () => {
    const cyc = [
      { title: 'a', kind: 'bug', role: 'developer', definitionOfDone: 'done properly here', dependsOn: [1] },
      { title: 'b', kind: 'bug', role: 'developer', definitionOfDone: 'done properly here', dependsOn: [0] },
    ];
    expect(structuralScore(cyc)).toBe(80);
  });
  it('empty plan → 0', () => {
    expect(structuralScore([])).toBe(0);
  });
});

describe('coercePlanTasks — tolerate double-encoded structured output', () => {
  const plan = [{ title: 't', role: 'developer', definitionOfDone: 'done and verified', dependsOn: [] }];
  it('passes a real array through', () => {
    expect(coercePlanTasks(plan)).toHaveLength(1);
  });
  it('recovers a JSON-string-encoded array', () => {
    expect(coercePlanTasks(JSON.stringify(plan))).toHaveLength(1);
  });
  it('recovers a JSON-string-encoded {tasks:[…]} object (the Sonnet 5 shape)', () => {
    expect(coercePlanTasks(JSON.stringify({ tasks: plan }))[0]!.role).toBe('developer');
  });
  it('garbage → empty', () => {
    expect(coercePlanTasks('not json')).toHaveLength(0);
    expect(coercePlanTasks(42)).toHaveLength(0);
    expect(coercePlanTasks(undefined)).toHaveLength(0);
  });
});

describe('judgeRubric — cross-family ensemble', () => {
  it('averages the judges and normalizes to 0..100', async () => {
    const r = await judgeRubric('claude-opus-4-8', 'task', 'answer', RESEARCH_RUBRIC, fakeJudge({ grounding: 3, completeness: 3, citations: 3, reasoning: 3, clarity: 3 }));
    expect(r.overall).toBe(100);
    expect(r.judges).toHaveLength(2);
  });
  it('all-zeros → 0', async () => {
    const r = await judgeRubric('gpt-5.5', 'task', 'answer', RESEARCH_RUBRIC, fakeJudge({ grounding: 0, completeness: 0, citations: 0, reasoning: 0, clarity: 0 }));
    expect(r.overall).toBe(0);
  });
  it('never uses a judge from the candidate\'s own family', async () => {
    const fake = fakeJudge({ grounding: 2, completeness: 2, citations: 2, reasoning: 2, clarity: 2 });
    // The roster is read from JUDGES, so refreshing it moves one place, not two. The CROSS-FAMILY
    // rule is asserted structurally instead, because THAT must never move.
    const anthropic = await judgeRubric('claude-opus-5', 't', 'a', RESEARCH_RUBRIC, fake);
    expect(anthropic.judges).toEqual([JUDGES.openai, JUDGES.gemini]);
    const gemini = await judgeRubric('gemini-3.8-flash', 't', 'a', RESEARCH_RUBRIC, fake);
    expect(gemini.judges).toEqual([JUDGES.anthropic, JUDGES.openai]);
    const cases = [['anthropic', 'claude-sonnet-5'], ['openai', 'gpt-6-astra'], ['gemini', 'gemini-3.1-flash-lite']] as const;
    for (const [family, candidate] of cases) {
      const r = await judgeRubric(candidate, 't', 'a', RESEARCH_RUBRIC, fake);
      expect(r.judges).toHaveLength(2);
      expect(r.judges).not.toContain(JUDGES[family]);
    }
  });
});
