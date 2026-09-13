// Artifact NAMES carry their version and kind — plan-v3, ship-plan-v2, design-mockup-v4.
// These parsers are what bind a gate to the artifact it is about. Split out of review.ts.
//
// The PATTERNS themselves moved to @neuramesh/shared (2026-08-18) because the SERVER needs them
// too: `artifact.delete` refuses anything a gate stands on, and a naming convention copied on both
// sides of a boundary is a convention that drifts. The parsers stay here; the shapes are shared.
export { PLAN_RE, SHIP_PLAN_RE, DESIGN_RE } from '@neuramesh/shared';
import { PLAN_RE, SHIP_PLAN_RE, DESIGN_RE } from '@neuramesh/shared';

/** implementation-plan-v{N}.md; a bare name is v1 (legacy). 0 = not a plan */
export function planVer(name: string): number {
  const m = PLAN_RE.exec(name);
  return m ? (m[1] ? Number(m[1]) : 1) : 0;
}

/** ship-plan-v{R}.md — release plans version by ROUND, same family treatment */
export function shipPlanVer(name: string): number {
  const m = SHIP_PLAN_RE.exec(name);
  return m ? (m[1] ? Number(m[1]) : 1) : 0;
}

/** design-mockup-v{R}-… — a round can hold several mockups, so the version is the round */
export function designVer(name: string): number {
  const m = DESIGN_RE.exec(name);
  return m ? Number(m[1]) : 0;
}

/**
 * Which review family this artifact belongs to, if any.
 *
 * A deliverable is NOT a review: it has no gate, so `notes.md` stays an ordinary read-only file
 * tab rather than growing a verdict bar it cannot honour.
 */
import type { ReviewKind } from './review-types';

export function reviewKind(name: string, artifactKind?: string | null): ReviewKind | null {
  if (planVer(name)) return 'plan';
  if (shipPlanVer(name)) return 'ship';
  if (designVer(name) || artifactKind === 'design') return 'design';
  return null;
}

export const versionOf = (kind: ReviewKind, name: string): number =>
  kind === 'plan' ? planVer(name) : kind === 'ship' ? shipPlanVer(name) : designVer(name);

// ── the gate ───────────────────────────────────────────────────────────────────────────────────
