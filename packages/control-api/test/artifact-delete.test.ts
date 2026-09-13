// `artifact.delete` (2026-08-18) — who may remove a file, and which files can never be removed.
//
// The rule George chose: a human may delete uploads and ordinary deliverables, but a file a GATE
// resolves against stays. These lock the refusal server-side, because "don't delete the evidence"
// has to be impossible rather than discouraged — the client hides the control from the same
// predicate (@neuramesh/shared isGateArtifact), and a UI-only rule is not a rule.
import { describe, expect, it } from 'vitest';
import { gateArtifactReason, isGateArtifact } from '@neuramesh/shared';

describe('isGateArtifact — the predicate both ends read', () => {
  it('refuses the kinds that ARE evidence, whatever they are named', () => {
    for (const kind of ['design', 'ship', 'diff', 'test_report']) {
      expect(isGateArtifact({ kind, name: 'anything.md' })).toBe(true);
    }
  });

  it('refuses a plan by NAME, because `doc` cannot tell a plan from a brand guideline', () => {
    // both are `doc` — the naming convention is the only thing that separates them, and it is
    // the same convention the review gates already bind through (desktop review-names.ts)
    expect(isGateArtifact({ kind: 'doc', name: 'implementation-plan-v2.md' })).toBe(true);
    expect(isGateArtifact({ kind: 'doc', name: 'implementation-plan.md' })).toBe(true); // legacy v1
    expect(isGateArtifact({ kind: 'doc', name: 'ship-plan-v3.md' })).toBe(true);
    expect(isGateArtifact({ kind: 'doc', name: 'design-mockup-v1-ember.html' })).toBe(true);
    expect(isGateArtifact({ kind: 'doc', name: 'brand-guidelines.md' })).toBe(false);
    expect(isGateArtifact({ kind: 'doc', name: 'business-profile.md' })).toBe(false);
  });

  it('allows the files this feature exists for — uploads and ordinary deliverables', () => {
    expect(isGateArtifact({ kind: 'file', name: 'logo.png' })).toBe(false);
    expect(isGateArtifact({ kind: 'doc', name: 'posts.json' })).toBe(false);
    expect(isGateArtifact({ kind: 'screenshot', name: 'before.png' })).toBe(false);
  });

  it('a near-miss name is NOT a plan — the anchors matter', () => {
    // `.startsWith`-style matching would swallow these and refuse deletes that should succeed
    expect(isGateArtifact({ kind: 'doc', name: 'my-implementation-plan-v2.md' })).toBe(false);
    expect(isGateArtifact({ kind: 'doc', name: 'implementation-plan-v2.md.bak' })).toBe(false);
    expect(isGateArtifact({ kind: 'doc', name: 'ship-planning.md' })).toBe(false);
  });

  it('the refusal says WHICH gate, so the message is actionable rather than a rule number', () => {
    expect(gateArtifactReason({ kind: 'doc', name: 'implementation-plan-v2.md' })).toMatch(/plan gate/);
    expect(gateArtifactReason({ kind: 'design', name: 'x.html' })).toMatch(/visual contract/);
    expect(gateArtifactReason({ kind: 'ship', name: 'r.md' })).toMatch(/ship gate/);
    expect(gateArtifactReason({ kind: 'diff', name: 'd.diff' })).toMatch(/reviewer/);
  });
});
