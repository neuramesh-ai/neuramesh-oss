// The plan document + its thread marker (2026-08-19).
import { describe, expect, it } from 'vitest';
import { isPlanDoc, parsePlanRef, planArtifactName, planRefMarker, renderPlanMarkdown } from '../src/planmd';

describe('the ‹plan:vN› marker', () => {
  it('round-trips through a message body, prose preserved', () => {
    const body = `Implementation plan **v2** (revised) — implementation-plan-v2.md\n${planRefMarker(2)}`;
    const ref = parsePlanRef(body);
    expect(ref?.version).toBe(2);
    expect(ref?.prose).toContain('implementation-plan-v2.md');
    expect(ref?.prose).not.toContain('‹plan:');
  });
  it('a body without the marker is not a plan card', () => {
    expect(parsePlanRef('The approach matches implementation-plan-v1.md, approved.')).toBeNull();
    expect(parsePlanRef(null)).toBeNull();
  });
});

describe('the rendered plan document', () => {
  it('isPlanDoc matches exactly the names planArtifactName mints', () => {
    expect(isPlanDoc(planArtifactName(1))).toBe(true);
    expect(isPlanDoc(planArtifactName(12))).toBe(true);
    expect(isPlanDoc('implementation-plan.md')).toBe(false);
    expect(isPlanDoc('ship-plan-v1.md')).toBe(false);
    expect(isPlanDoc('notes-implementation-plan-v1.md')).toBe(false);
  });

  it('names the execution leg by kind and carries the version everywhere', () => {
    const doc = renderPlanMarkdown({ number: 7, title: 'X audit', kind: 'research', legs: ['build'], subtasks: ['a'], approach: 'Sweep and rank.', version: 1 });
    expect(doc).toContain('# Implementation plan · v1 — #7 X audit');
    expect(doc).toContain('plan → research → accept');
    expect(planArtifactName(1)).toBe('implementation-plan-v1.md');
  });
});
