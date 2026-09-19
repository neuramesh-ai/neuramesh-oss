// The release brief's shape contract, read back out; and the ‹brief:id› marker.
import { describe, expect, it } from 'vitest';
import { briefMarker, parseBriefRef, releaseBriefFrom, whyBelowTitle } from '../src/releasebrief';

const BRIEF = `# Release brief · v0.134.0
Verdict: feature · Basis: release notes, 5 merged pull requests, README

## Why
The browser terminal: a shell on your cloud machine from any browser.
The release notes lead with it. Three of the five merged pull requests build it (#385, #387, #390). #391 is a fix and #392 is a chore.

## Audience
Engineers who run agents on a cloud machine and sign in to vendors from it.

## Assets
A release card on the brand palette for Instagram and TikTok. No screenshot: the profile has no site to capture.

## What I could not determine
The date #390 merged. The notes name it, the log does not.
`;

describe('releaseBriefFrom', () => {
  it('reads the head, the verdict, the basis, the sections and the pull requests', () => {
    const b = releaseBriefFrom('release-report-2026-09-17.md', BRIEF)!;
    expect(b).not.toBeNull();
    expect(b.tag).toBe('v0.134.0');
    expect(b.verdict).toBe('feature');
    expect(b.basis).toBe('release notes, 5 merged pull requests, README');
    expect(b.title).toBe('The browser terminal: a shell on your cloud machine from any browser.');
    expect(b.prs).toEqual([385, 387, 390, 391, 392]);
    expect(b.audience).toMatch(/^Engineers/);
    expect(b.assets).toMatch(/^A release card/);
    expect(b.gaps).toMatch(/^The date #390 merged/);
  });
  it('a why written as one paragraph: the headline is its first sentence, the version number whole', () => {
    const md = BRIEF.replace('The browser terminal: a shell on your cloud machine from any browser.\nThe release notes lead with it.', 'v0.134.0 makes local work on your Mac hold up through an interruption, instead of starting over. NeuraMesh already runs a small stack in containers on your own Mac.');
    expect(releaseBriefFrom('x.md', md)!.title).toBe('v0.134.0 makes local work on your Mac hold up through an interruption, instead of starting over.');
  });
  it('the why below the title: the headline line goes, and so does a headline that opens the paragraph', () => {
    expect(whyBelowTitle(releaseBriefFrom('x.md', BRIEF)!)).toBe('The release notes lead with it. Three of the five merged pull requests build it (#385, #387, #390). #391 is a fix and #392 is a chore.');
    const md = BRIEF.replace('The browser terminal: a shell on your cloud machine from any browser.\nThe release notes lead with it.', 'v0.134.0 holds up through an interruption, instead of starting over. NeuraMesh already keeps your workspace on your Mac.');
    expect(whyBelowTitle(releaseBriefFrom('x.md', md)!)).toBe('NeuraMesh already keeps your workspace on your Mac. Three of the five merged pull requests build it (#385, #387, #390). #391 is a fix and #392 is a chore.');
  });
  it('refuses a doc with no verdict, a late verdict, an unknown verdict, or no gaps section', () => {
    expect(releaseBriefFrom('x.md', BRIEF.replace('Verdict: feature · ', ''))).toBeNull();
    expect(releaseBriefFrom('x.md', BRIEF.replace('Verdict: feature · Basis: release notes, 5 merged pull requests, README', '\n\n\n\n\nVerdict: feature'))).toBeNull();
    expect(releaseBriefFrom('x.md', BRIEF.replace('Verdict: feature', 'Verdict: banger'))).toBeNull();
    expect(releaseBriefFrom('x.md', BRIEF.replace('## What I could not determine', '## Notes'))).toBeNull();
    expect(releaseBriefFrom('x.json', BRIEF)).toBeNull();
  });
  it('accepts the contracted spelling and the older one', () => {
    expect(releaseBriefFrom('x.md', BRIEF.replace('What I could not determine', "What I couldn’t determine"))).not.toBeNull();
    expect(releaseBriefFrom('x.md', BRIEF.replace('# Release brief · v0.134.0', '# Release announcement · v0.134.0'))?.tag).toBe('v0.134.0');
  });
});

describe('the brief marker', () => {
  it('round-trips and keeps the prose', () => {
    const id = '4f0b7d1e-2c3a-4b5c-8d6e-9f0a1b2c3d4e';
    const r = parseBriefRef(`The brief is in. ${briefMarker(id)}`);
    expect(r).toEqual({ id, prose: 'The brief is in.' });
    expect(parseBriefRef('nothing')).toBeNull();
  });
});

describe('parseBriefRef by index (CodeQL js/polynomial-redos, 2026-09-19)', () => {
  it('reads the id, strips every marker, and a flood of openers costs the input once', () => {
    const id = '0d1e2f30-4a5b-6c7d-8e9f-a0b1c2d3e4f5';
    const r = parseBriefRef(`Brief ready.  \n\n\n\n‹brief:${id}›\n‹brief:short›`);
    expect(r).toEqual({ id, prose: 'Brief ready.' });
    expect(parseBriefRef('‹brief:short›')).toBeNull();
    const t0 = performance.now();
    expect(parseBriefRef('‹brief:'.repeat(20_000))).toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

