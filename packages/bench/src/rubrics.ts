import type { RubricDim } from './judge';

export const RESEARCH_RUBRIC: RubricDim[] = [
  { key: 'grounding', label: 'Grounding', guide: 'Every substantive claim is supported by the provided sources; nothing fabricated.' },
  { key: 'completeness', label: 'Completeness', guide: 'Covers the key aspects the question asks for; no major omissions.' },
  { key: 'citations', label: 'Citations', guide: 'Cites the specific source ids it used, correctly, and cites only real provided sources.' },
  { key: 'reasoning', label: 'Reasoning', guide: 'Synthesises across sources with sound logic rather than listing or contradicting them.' },
  { key: 'clarity', label: 'Clarity', guide: 'Well-organised, precise, and easy to follow.' },
];

export const ARCHITECT_RUBRIC: RubricDim[] = [
  { key: 'requirements', label: 'Requirements', guide: 'The plan actually satisfies every stated requirement of the request.' },
  { key: 'dod', label: 'Definition of Done', guide: 'Includes a concrete, testable Definition of Done / acceptance criteria.' },
  { key: 'feasibility', label: 'Feasibility', guide: 'Technically sound and grounded — real steps, no hand-waving or invented APIs.' },
  { key: 'risk', label: 'Risk handling', guide: 'Identifies real failure modes, edge cases, and a validation/rollback approach.' },
  { key: 'clarity', label: 'Clarity', guide: 'Ordered, scannable steps a developer could actually follow.' },
];

export const ORCHESTRATION_RUBRIC: RubricDim[] = [
  { key: 'granularity', label: 'Granularity', guide: 'Tasks are the right size — neither one giant task nor over-split trivia.' },
  { key: 'routing', label: 'Routing', guide: 'Each task is assigned to the right role for that work.' },
  // the lightest-safe-path principle (docs/16): the architect is a justified exception, never the default.
  { key: 'rightsizing', label: 'Right-sizing', guide: 'Uses the lightest safe path: NO architect/planning task for a bug fix or a small, well-understood change — those go straight to a developer. An architect appears only when NET-NEW / feature work genuinely needs a designed approach first (novel approach, cross-cutting, schema/security, irreversible) — an unknown APPROACH, never an unknown CAUSE. Heavily penalise an architect inserted for ANY bug — including a hard or recurring one where prior fixes failed: that is deeper investigation for a developer (the investigate skill), not a planning task, since an architect cannot find a cause. A bug reaches the architect only after investigation reveals a structural change. User-facing visual work gets a designer; research/analysis goes to a worker.' },
  { key: 'ordering', label: 'Ordering', guide: 'Dependencies and sequence are sensible; prerequisites come first.' },
  { key: 'dod', label: 'DoD quality', guide: 'Each task carries a specific, checkable Definition of Done.' },
];
