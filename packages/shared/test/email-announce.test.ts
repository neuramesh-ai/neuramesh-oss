// The announce-ready email (docs/design/release-drafts-2026-09/plan.md §4.8 "The email"): the
// subject and preheader the board names, the count as a word, the networks joined the way a
// person says them, the two variants (no site, a verdict of none), escaping, and the STE bans.
import { describe, expect, it } from 'vitest';
import { stripMarkers } from '../src/linear';
// templates.ts owns TEMPLATE_META and imports every split file. It loads first here so the
// registry never reads the announce module mid-cycle.
import { TEMPLATE_META } from '../src/email/templates';
import { announceReadyMeta, renderAnnounceReady } from '../src/email/templates-announce';

type Props = Parameters<typeof renderAnnounceReady>[0];
const base: Props = {
  repo: 'neuramesh-ai/neuramesh-oss', tag: 'v0.134.0', title: 'The browser terminal',
  networks: ['x', 'linkedin', 'instagram'], site: 'https://neuramesh.app',
  link: 'https://neuramesh.app/announce/a1', verdict: 'feature',
};
const render = (over: Partial<Props> = {}) => renderAnnounceReady({ ...base, ...over });

describe('the announce-ready email pays the subject it promises', () => {
  const r = render();

  it('subject names the repository short name and the tag, the preheader is the feature', () => {
    expect(r.subject).toBe('Your release drafts are ready: neuramesh-oss v0.134.0');
    expect(r.preheader).toBe('The browser terminal');
  });

  it('opens on the scene with the count as a word, then the board sentence', () => {
    expect(r.text).toContain('Three drafts for v0.134.0 are ready');
    expect(r.text).toContain('The browser terminal is announced for X, LinkedIn and Instagram, with a release card drawn on neuramesh.app’s palette.');
  });

  it('one button to the drafts, the sign-in line, and the honest closer', () => {
    expect(r.html).toContain('href="https://neuramesh.app/announce/a1"');
    expect(r.html.match(/class="nm-btn"/g)).toHaveLength(1);
    // the html lane carries the href. The text lane loses every URL today: layout.ts toText
    // rewrites anchors to `label <href>` and then its tag-stripper eats the `<href>`.
    expect(r.text).toContain('Open the drafts');
    expect(r.text).toContain('Sign in to save them, schedule them, and let your marketing room watch the next release.');
    expect(r.text).toContain('You asked for this at neuramesh.app/announce. If you did not, ignore this email and nothing happens.');
  });

  it('is transactional: no unsubscribe link, and a text alternative', () => {
    expect(r.html).not.toMatch(/Unsubscribe/);
    expect(r.text.length).toBeGreaterThan(80);
  });
});

describe('the count and the networks read the way a person says them', () => {
  it('one network: singular, no comma, no and', () => {
    const one = render({ networks: ['x'] });
    expect(one.text).toContain('One draft for v0.134.0 is ready');
    expect(one.text).toContain('is announced for X, with');
  });

  it('two networks: and, no comma', () => {
    const two = render({ networks: ['x', 'linkedin'] });
    expect(two.text).toContain('Two drafts for v0.134.0 are ready');
    expect(two.text).toContain('is announced for X and LinkedIn, with');
  });

  it('four networks: commas, then and, with display names', () => {
    const four = render({ networks: ['x', 'linkedin', 'instagram', 'tiktok'] });
    expect(four.text).toContain('Four drafts for v0.134.0 are ready');
    expect(four.text).toContain('is announced for X, LinkedIn, Instagram and TikTok, with');
  });

  it('past nine the count stays digits, and an unknown key keeps its name', () => {
    const many = render({ networks: Array.from({ length: 10 }, (_, i) => `net${i}`) });
    expect(many.text).toContain('10 drafts for v0.134.0 are ready');
    expect(many.text).toContain('net0, net1');
  });
});

describe('the two variants', () => {
  it('no site: the palette clause goes and the sentence still closes', () => {
    const r = render({ site: null });
    expect(r.text).toContain('The browser terminal is announced for X, LinkedIn and Instagram.');
    expect(r.text).not.toMatch(/palette/);
  });

  it('a verdict of none: nothing to announce, the brief says why, no networks sentence', () => {
    const r = render({ verdict: 'none' });
    expect(r.text).toContain('Nothing in v0.134.0 is worth an announcement');
    expect(r.text).toContain('The brief says why.');
    expect(r.text).not.toMatch(/is announced for/);
    expect(r.text).not.toMatch(/palette/);
    expect(r.html).toContain('href="https://neuramesh.app/announce/a1"');
    expect(r.text).toContain('Sign in to save the brief');
    expect(r.subject).toBe('Your release drafts are ready: neuramesh-oss v0.134.0');
  });
});

describe('the rendered email holds the line on docs/28 and CLAUDE.md #11', () => {
  it('escapes every prop instead of trusting it', () => {
    const evil = render({ title: '<script>alert(1)</script>', repo: 'a&b/c<d>', site: 'https://e<v>il.example/', tag: '<b>v1</b>' });
    expect(evil.html.toLowerCase()).not.toContain('<script');
    expect(evil.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(evil.html).not.toMatch(/<b>v1<\/b>/);
    expect(evil.html).toContain('e&lt;v&gt;il.example’s palette');
    expect(evil.html).toContain('a&amp;b/c&lt;d&gt;');
  });

  it('no em dash and no semicolon anywhere a person reads', () => {
    for (const r of [render(), render({ networks: ['x'] }), render({ site: null }), render({ verdict: 'none' })]) {
      expect(r.subject + r.preheader).not.toMatch(/[—;]/);
      expect(r.text).not.toMatch(/[—;]/);
      expect(stripMarkers(r.html, '<!--', '-->')).not.toMatch(/—/); // the html comments hold the mso conditionals
    }
  });

  it('is registered with its meta, a shape, and a citation on every claim', () => {
    expect(TEMPLATE_META['announceReady']).toBe(announceReadyMeta);
    expect(announceReadyMeta.kind).toBe('transactional');
    expect(announceReadyMeta.shape).toMatch(/beat/i);
    for (const [claim, cite] of announceReadyMeta.claims) {
      expect(claim.length).toBeGreaterThan(8);
      expect(cite).toMatch(/\.(ts|tsx|md|sql)/);
    }
  });
});
