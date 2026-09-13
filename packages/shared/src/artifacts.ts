// Which artifacts a human may DELETE — and which ones a gate is standing on (2026-08-18).
//
// Artifacts are two different things wearing one table. Most are ordinary files: a human's upload,
// a deliverable a worker wrote, a brand doc. Some are **evidence a gate resolves against** — the
// design round `approve_design` binds to, the implementation plan the architect proposed, the
// release plan `approve_ship_plan` ticks through, the diff the reviewer read. Deleting one of
// those does not tidy a list; it removes the record that a gate was ever satisfied, on a task that
// may already be accepted.
//
// So delete is scoped by CONSTRUCTION rather than by etiquette (doctrine §4): the server refuses a
// gate artifact, and the client hides the control for the same reason from the same predicate.
// One rule, one place — a second copy on the client is how the two ends drift.
//
// The naming convention is load-bearing here, because `doc` cannot separate an implementation plan
// from a brand guideline: both are docs. The NAME is what distinguishes them, and it already had
// to be parsed for the review gates to bind at all (the desktop's review-names.ts imports these).

/** implementation-plan-v{N}.md — a bare name is v1 (legacy) */
export const PLAN_RE = /^implementation-plan(?:-v(\d+))?\.md$/;

/** ship-plan-v{R}.md — release plans version by ROUND */
export const SHIP_PLAN_RE = /^ship-plan(?:-v(\d+))?\.md$/;

/** design-mockup-v{R}-… — a round can hold several mockups, so the version is the round */
export const DESIGN_RE = /^design-mockup-v(\d+)-/;

/**
 * Kinds that are evidence by their very kind, whatever they are called:
 *  · `design` — the approved round IS the visual contract (docs/14)
 *  · `ship`   — the release plan report `approve_ship_plan` gates on (docs/23)
 *  · `diff`   — what the reviewer actually read
 *  · `test_report` — the "failing-test-now-green" half of Done (doctrine §3)
 */
export const GATE_ARTIFACT_KINDS: readonly string[] = ['design', 'ship', 'diff', 'test_report'];

/**
 * Is a gate standing on this artifact? `doc` is the ambiguous kind — a plan and a brand guideline
 * are both docs — so a doc is judged by the naming convention the gates already bind through.
 */
export function isGateArtifact(a: { kind: string; name: string }): boolean {
  if (GATE_ARTIFACT_KINDS.includes(a.kind)) return true;
  const name = (a.name ?? '').trim();
  return PLAN_RE.test(name) || SHIP_PLAN_RE.test(name) || DESIGN_RE.test(name);
}

/** Why the delete was refused — the server's message and the client's tooltip, from one string. */
export function gateArtifactReason(a: { kind: string; name: string }): string {
  if (a.kind === 'design' || DESIGN_RE.test(a.name)) return 'a design round is the visual contract its task was built to — it stays with the task';
  if (a.kind === 'ship' || SHIP_PLAN_RE.test(a.name)) return 'a release plan is what the ship gate was approved against';
  if (PLAN_RE.test(a.name)) return 'an implementation plan is what the plan gate was approved against';
  if (a.kind === 'diff') return 'this diff is what the reviewer read';
  if (a.kind === 'test_report') return 'a test report is the evidence its task was accepted on';
  return 'a gate on this task resolves against this artifact';
}
