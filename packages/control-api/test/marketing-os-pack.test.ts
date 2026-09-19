// Every playbook's skill ships in a bundled pack, and the two community skills George picked
// (2026-09-18) ride the marketing-os pack with their NeuraMesh preamble in front of the verbatim
// text: a playbook whose skill nobody seeded is a tile that cannot run.
import { PLAYBOOKS } from '@neuramesh/shared';
import { describe, expect, it } from 'vitest';
import { MARKETING_SKILL_SEED } from '../src/seed/marketing-skill-seed';
import { MARKETING_OS_SKILL_SEED } from '../src/seed/marketing-os-skill-seed';

const names = new Set([...MARKETING_SKILL_SEED, ...MARKETING_OS_SKILL_SEED].flatMap((p) => p.skills.map((s) => s.name)));
const os = MARKETING_OS_SKILL_SEED[0]!;

describe('the marketing packs and the playbook catalog', () => {
  it('every playbook names a skill a marketing room receives', () => {
    for (const pb of PLAYBOOKS) expect(names.has(pb.skill), `${pb.id} → ${pb.skill}`).toBe(true);
  });
  it('the community skills ride the marketing-os pack, preamble first, frontmatter dropped, pins in the version', () => {
    const cc = os.skills.find((s) => s.name === 'content-creator')!;
    const ugc = os.skills.find((s) => s.name === 'ugc-strategy')!;
    expect(cc.body.startsWith('## In NeuraMesh')).toBe(true);
    expect(cc.body).toContain('# Content Creator');
    expect(cc.body).not.toContain('license: MIT'); // the upstream frontmatter is dropped
    expect(ugc.body).not.toContain('origin: ECM');
    expect(ugc.body.startsWith('## In NeuraMesh')).toBe(true);
    expect(ugc.body).toContain('# UGC Strategy');
    expect(ugc.body).toContain('`draft_posts`'); // the UGC preamble: scripts hand over as cards
    expect(ugc.body).toContain('ugc-brief-YYYY-MM-DD.md');
    expect(os.pack.version).toContain('ca3a3d37+453d32d4');
  });
});
