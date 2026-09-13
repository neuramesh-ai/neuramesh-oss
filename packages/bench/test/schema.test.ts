import { describe, it, expect } from 'vitest';
import { rubricSchema } from '../src/judge';
import { PLAN_SCHEMA } from '../src/run/orchestrator';
import { VERDICT_SCHEMA } from '../src/run/reviewer';
import { RESEARCH_RUBRIC, ARCHITECT_RUBRIC, ORCHESTRATION_RUBRIC } from '../src/rubrics';
import { pickWinner, seatEligible } from '../src/report';
import { STARTER_MODEL } from '@neuramesh/shared';

// Every schema the harness sends must survive all THREE providers' structured-output validators,
// because one rejected keyword does not fail loudly in a useful place: it 400s for whichever
// provider is strict, and that provider is a JUDGE for the other two families. The 2026-09
// pre-flight found `minimum`/`maximum` on an integer doing exactly this — the Anthropic judge
// 400'd, so every OpenAI and Gemini candidate lost its research and planning rows.
//
// The banned list is the intersection failure set, not a style rule. Widen it when a provider
// rejects something new, and express the constraint in the prompt or a description instead.
const BANNED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'format', '$ref', 'anyOf', 'oneOf', 'allOf', 'not'];

function offendingKeys(node: unknown, path = '$'): string[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((v, i) => offendingKeys(v, `${path}[${i}]`));
  const out: string[] = [];
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (BANNED.includes(k)) out.push(`${path}.${k}`);
    // don't descend into `properties` KEY NAMES — a field legitimately named "pattern" is fine
    if (k === 'properties' && v && typeof v === 'object') {
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) out.push(...offendingKeys(pv, `${path}.properties.${pk}`));
    } else if (k !== 'enum' && k !== 'required') {
      out.push(...offendingKeys(v, `${path}.${k}`));
    }
  }
  return out;
}

describe('schemas are portable across all three providers', () => {
  const schemas: [string, unknown][] = [
    ['VERDICT_SCHEMA', VERDICT_SCHEMA],
    ['PLAN_SCHEMA', PLAN_SCHEMA],
    ['rubricSchema(research)', rubricSchema(RESEARCH_RUBRIC)],
    ['rubricSchema(architect)', rubricSchema(ARCHITECT_RUBRIC)],
    ['rubricSchema(orchestration)', rubricSchema(ORCHESTRATION_RUBRIC)],
  ];

  for (const [name, schema] of schemas) {
    it(`${name} uses no keyword a provider rejects`, () => {
      expect(offendingKeys(schema)).toEqual([]);
    });
  }

  it('the detector actually catches the keyword that broke the 2026-09 pre-flight', () => {
    const bad = { type: 'object', properties: { score: { type: 'integer', minimum: 0, maximum: 3 } }, required: ['score'], additionalProperties: false };
    expect(offendingKeys(bad)).toEqual(['$.properties.score.minimum', '$.properties.score.maximum']);
  });

  it('a rubric schema still names every dimension and states the range', () => {
    const s = rubricSchema(RESEARCH_RUBRIC) as { properties: Record<string, { description?: string }>; required: string[] };
    expect(s.required.sort()).toEqual(RESEARCH_RUBRIC.map((d) => d.key).sort());
    for (const d of RESEARCH_RUBRIC) expect(s.properties[d.key]?.description).toMatch(/0 to 3/);
  });
});

describe('the winner is a model that could actually take the seat', () => {
  const row = (model: string, quality: number, costUsd: number) => ({ model, runs: 5, quality, ci: [quality - 5, Math.min(100, quality + 3)] as [number, number], primary: quality / 100, costUsd, latencyMs: 1000 });

  it('never names a mini or lite tier model, however well it scores', () => {
    // the 2026-09 run put gemini-3.5-flash-lite at a tie on review (F1 1.00) and gpt-5.4-mini at
    // the top of three roles. The value tiebreak handed them seats the founder rule forbids, so
    // the page declared "X takes the code review seat" while every pack seated somebody else.
    for (const cheap of ['gpt-5.4-mini', 'gemini-3.1-flash-lite', STARTER_MODEL]) {
      const w = pickWinner([row(cheap, 100, 0.0001), row('gpt-6-astra', 100, 0.01)]);
      expect(w.model, `${cheap} must never win a role`).toBe('gpt-6-astra');
    }
  });

  it('still ranks them on the board — they are measured, just not seatable', () => {
    expect(seatEligible('gpt-5.4-mini')).toBe(false);
    expect(seatEligible(STARTER_MODEL)).toBe(false);
    expect(seatEligible('claude-sonnet-5')).toBe(true);
    expect(seatEligible('gpt-6-astra')).toBe(true);
  });

  it('falls through to the next eligible model rather than returning nothing', () => {
    const w = pickWinner([row('gpt-5.4-mini', 100, 0.0001), row(STARTER_MODEL, 99, 0.0001), row('claude-sonnet-5', 90, 0.02)]);
    expect(w.model).toBe('claude-sonnet-5');
    expect(w.note).toBeTruthy();
  });

  it('returns an empty winner when NOTHING in the role is seatable', () => {
    const w = pickWinner([row('gpt-5.4-mini', 100, 0.0001)]);
    expect(w.model).toBe('');
  });
});
