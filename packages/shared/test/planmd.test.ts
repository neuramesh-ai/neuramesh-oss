// The plan document + its thread marker (2026-08-19).
import { describe, expect, it } from 'vitest';
import { isPlanDoc, parsePlanRef, planArtifactName, planMessage, planPostLine, planRefMarker, renderPlanMarkdown, type PlanPostKind } from '../src/planmd';

describe('the ‹plan:vN› marker', () => {
  it('round-trips through a message body, prose preserved', () => {
    const body = planMessage(2, 'revised');
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
    expect(doc).toContain('# Implementation plan · v1 · #7 X audit');
    expect(doc).toContain('plan → research → accept');
    expect(planArtifactName(1)).toBe('implementation-plan-v1.md');
  });

  // the journey read "plan → review → build → accept" (2026-10-05, the homepage trial): build
  // came after its own review. it is the causal order now, as journeyFor draws it
  it('walks the legs in causal order: design, the execution leg, review', () => {
    const doc = (legs: string[], repo?: boolean) => renderPlanMarkdown({ number: 1064, title: 'Annual toggle', kind: 'feature', legs, subtasks: [], approach: 'Add it.', version: 1, ...(repo === undefined ? {} : { repo }) });
    expect(doc(['build', 'review'])).toContain('**Journey:** plan → build → review → accept');
    expect(doc(['design', 'build', 'review'])).toContain('**Journey:** plan → design → build → review → accept');
    expect(doc(['review', 'build', 'design'])).toContain('**Journey:** plan → design → build → review → accept');
    // a repository unit ends in the person's merge word; without one the input cannot know, so accept stays
    expect(doc(['build', 'review'], true)).toContain('**Journey:** plan → build → review → merge');
    expect(doc(['build', 'review'], false)).toContain('→ accept');
  });

  it('the heading and the journey follow the house rules', () => {
    const doc = renderPlanMarkdown({ number: 3, title: 'Plan the launch week', kind: 'docs', legs: ['design', 'build', 'review'], subtasks: [], approach: 'Write it.', version: 2, repo: false });
    expect(doc.split('\n').slice(0, 3).join('\n')).not.toMatch(/[—;]/);
  });
});

describe('the plan message lines', () => {
  const KINDS: PlanPostKind[] = ['birth', 'revised', 'routine', 'playbook'];

  it('say the plan in the house words and name the plan file', () => {
    expect(planPostLine(1)).toBe('Implementation plan **v1**: implementation-plan-v1.md');
    expect(planPostLine(2, 'revised')).toBe('Implementation plan **v2** (revised): implementation-plan-v2.md');
    for (const k of KINDS) {
      const line = planPostLine(3, k);
      expect(line, k).not.toMatch(/[—;]/);
      expect(line, k).not.toMatch(/\b\w{2,}ing\b|you'll|hands-off/);
      expect(line, k).toContain('implementation-plan-v3.md');
    }
  });

  it('the message is the line, then the marker on its own line', () => {
    expect(planMessage(1)).toBe(`${planPostLine(1)}\n${planRefMarker(1)}`);
  });
});

// CONTRACT (docs/46): published desktops parse these bodies with their own copy of the parsers.
// the regexes below are COPIED from the tags, so a change to the new lines that a published client
// can no longer read fails here, not on a person's screen.
describe('the published clients still read the new plan messages', () => {
  // packages/shared/src/planmd.ts at v0.153.0 and at v0.152.0 (the same line in both tags)
  const PLAN_REF_RE_V0_153_0 = /‹plan:v(\d+)›/;
  // the old parsePlanRef body, at v0.153.0 and v0.152.0: the body without the marker, its line ends
  // trimmed (trimLineEnds in linear.ts is `body.replace(/[ \t]+$/gm, '')` by its own docblock),
  // blank runs folded, then trimmed
  const oldProse = (body: string) => body.replace(PLAN_REF_RE_V0_153_0, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  // apps/desktop/src/renderer/src/md/Md.tsx:205 at v0.153.0 and at v0.152.0: the plan name becomes a link
  const MD_PLAN_LINK_V0_153_0 = /(?:implementation-plan|ship-plan)(?:-v\d+)?\.md/g;
  // apps/mobile/src/thread-prose.tsx:45 on main at f5c6c2ac (the phone's thread prose splits on it)
  const PHONE_SPLIT_F5C6C2AC = /(#\d+\b|implementation-plan(?:-v\d+)?\.md|design-mockup-v\d+-[\w-]+)/g;

  it.each(['birth', 'revised', 'routine', 'playbook'] as PlanPostKind[])('a %s message', (kind) => {
    const body = planMessage(4, kind);
    const m = PLAN_REF_RE_V0_153_0.exec(body);
    expect(m?.[1]).toBe('4');
    const prose = oldProse(body);
    expect(prose).toBe(planPostLine(4, kind));
    expect(prose.match(MD_PLAN_LINK_V0_153_0)).toEqual(['implementation-plan-v4.md']);
    expect(prose.split(PHONE_SPLIT_F5C6C2AC)).toContain('implementation-plan-v4.md');
  });
});
