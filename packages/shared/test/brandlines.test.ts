// the marketing room's lines (2026-10-06): the brand bootstrap's words, the doc-drop shape, the log
// line the brand rail reads, and the film's first line, from one module the daemon and the preview
// story both call.
// run from packages/shared:
//   pnpm test brandlines
import { describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_ERROR, BOOTSTRAP_PLAYS, BOOTSTRAP_SCHED_FALLBACK, bootstrapClosing, bootstrapDocFailed, bootstrapDocStatus, bootstrapNudgeDone,
  bootstrapOpening, bootstrapPartial, bootstrapResume, bootstrapStart, docDropBody, docInFlight, docWriteLog, filmStartLine,
} from '../src/brandlines';
import { playbookById } from '../src/playbooks';
import { scrubEmdash } from '../src/commrules';

// the house rules: no em dash, no semicolon, no -ing word. the nouns here are words, not verbs
const ING_NOUNS = new Set(['nothing', 'thing', 'something', 'anything', 'everything', 'marketing', 'pricing']);
function breaks(line: string): string[] {
  const out: string[] = [];
  if (/[—–]/.test(line)) out.push('dash');
  if (line.includes(';')) out.push('semicolon');
  for (const w of line.toLowerCase().match(/\b[a-z]{2,}ing\b/g) ?? []) if (!ING_NOUNS.has(w)) out.push(w);
  return out;
}

const SITE = 'flowe.app';

describe('the opening line', () => {
  it('promises the site and the web only to a runtime that reads them', () => {
    expect(bootstrapOpening({ site: SITE, research: true, repo: false })).toBe(
      'First I read flowe.app and its key pages. I also search the web for the product\'s market. Then I write four brand docs here: the business profile, the brand guidelines, the market research and the social strategy. Each doc goes to the room\'s **Library** tab when it is done. Each doc takes a few minutes.',
    );
    expect(bootstrapOpening({ site: SITE, research: true, repo: true })).toMatch(/^First I read flowe\.app, its key pages and the project code\. /);
    expect(bootstrapOpening({ site: null, research: true, repo: false })).toMatch(/^First I search the web for the product and its market\. Then I write/);
    expect(bootstrapOpening({ site: null, research: true, repo: true })).toMatch(/^First I read the project code\. I also search the web for the product and its market\. /);
  });

  it('on the NeuraMesh brain says the docs come from the answers, and the site gives only its colors and fonts', () => {
    expect(bootstrapOpening({ site: SITE, research: false, repo: true })).toBe(
      'I write four brand docs here: the business profile, the brand guidelines, the market research and the social strategy. I write them from your answers. I also try to read the colors and fonts from flowe.app. Each doc goes to the room\'s **Library** tab when it is done.',
    );
    expect(bootstrapOpening({ site: null, research: false, repo: false })).not.toMatch(/colors/);
    for (const site of [SITE, null]) {
      for (const repo of [true, false]) {
        // the old line promised "the site page by page" on every runtime
        expect(bootstrapOpening({ site, research: false, repo })).not.toMatch(/\bpages?\b|\bsearch\b|\bweb\b|project code/);
      }
    }
  });
});

describe('the lines while the docs land', () => {
  it('streams the start and each doc, and names research only where it happens', () => {
    expect(bootstrapStart(SITE)).toBe('*I start the brand docs for flowe.app…*');
    expect(bootstrapDocStatus('brand-guidelines.md', 2, 4, true)).toBe('*I research and write `brand-guidelines.md` (2/4)…*');
    expect(bootstrapDocStatus('brand-guidelines.md', 2, 4, false)).toBe('*I write `brand-guidelines.md` (2/4)…*');
  });

  it('says what a reply does when a doc did not land', () => {
    expect(bootstrapDocFailed('Brand guidelines')).toBe('⚠️ I could not write **Brand guidelines** this time. Reply here, and I write it again.');
    expect(bootstrapPartial(1, 2)).toBe('This time I wrote 1 of 2 docs. Reply here, and I write the rest.');
    expect(BOOTSTRAP_ERROR).toBe('⚠️ An error stopped the brand docs. Reply here, and I continue.');
    expect(bootstrapResume(['social-strategy.md'])).toBe('I write `social-strategy.md` now.');
    expect(bootstrapResume(['market-research.md', 'social-strategy.md'])).toBe('I write the last 2 docs now.');
    expect(bootstrapNudgeDone(['social-strategy.md'])).toBe('`social-strategy.md` is in the room\'s **Library** tab. The brand docs are complete.');
    expect(bootstrapNudgeDone(['a.md', 'b.md', 'c.md'])).toBe('`a.md`, `b.md` and `c.md` are in the room\'s **Library** tab. The brand docs are complete.');
  });

  it('closes with the cadence card and the first playbooks, each under its own line', () => {
    const close = bootstrapClosing('```nmsched\n{}\n```', '```nmplays\n{}\n```');
    expect(close.split('\n\n')).toEqual([
      'The brand docs are done. They are in the room\'s **Library** tab, and later drafts use them. Here is a first cadence. Arm the rows that you want. Nothing posts until you approve it.',
      '```nmsched\n{}\n```',
      'The next step is a baseline. Run the audit once to get a score. Run it again later to see what changed.',
      '```nmplays\n{}\n```',
    ]);
  });

  it('recommends real playbooks, and the cadence rows parse as the card reads them', () => {
    for (const p of BOOTSTRAP_PLAYS) expect(playbookById(p.id), p.id).not.toBeNull();
    for (const r of BOOTSTRAP_SCHED_FALLBACK) {
      expect(r.atTime).toMatch(/^\d{2}:\d{2}$/);
      expect(r.cadence === 'weekly' ? r.weekday : 0).toBeTypeOf('number');
    }
  });
});

describe('the doc-drop shape and the rail', () => {
  it('keeps the dash every published desktop parses, and the server turns it into a comma', () => {
    const body = docDropBody('Business profile', 'business-profile.md', '# Flowe');
    expect(body).toBe('📄 **Business profile** — saved to the library as `business-profile.md`.\n\n# Flowe');
    expect(scrubEmdash(body)).toBe('📄 **Business profile**, saved to the library as `business-profile.md`.\n\n# Flowe');
    expect(docDropBody('Messaging', 'messaging.md', 'x', 'proposed for')).toMatch(/^📄 \*\*Messaging\*\* — proposed for the library as `messaging\.md`\./);
  });

  it('reads the doc in flight from the daemon\'s own log line, and from no other', () => {
    expect(docInFlight(docWriteLog('brand-guidelines.md'))).toBe('brand-guidelines.md');
    expect(docInFlight(`${docWriteLog('brand-guidelines.md')} again`)).toBe('brand-guidelines.md');
    expect(docInFlight('drafting brand-guidelines.md')).toBeNull();
    expect(docInFlight('Write docs/notes.md')).toBeNull();
    expect(docInFlight('writes the reply')).toBeNull();
    expect(docInFlight(null)).toBeNull();
  });
});

describe('the film line', () => {
  it('names the tier only, and says when the tier held a longer pick', () => {
    expect(filmStartLine({ seconds: 8, tier: 'NeuraMesh Video Starter', asked: 8, credits: 194 })).toBe(
      'The 8 s film starts on NeuraMesh Video Starter. It takes about 2 minutes and costs 194 credits. The film lands on the card.',
    );
    expect(filmStartLine({ seconds: 15, tier: 'NeuraMesh Video Starter', asked: 30, credits: 363 })).toBe(
      'The 15 s film starts on NeuraMesh Video Starter (NeuraMesh Video Starter films up to 15 s). It takes about 4 minutes and costs 363 credits. The film lands on the card.',
    );
  });
});

describe('the house rules', () => {
  it('holds for every line a person reads', () => {
    const lines: string[] = [
      ...[SITE, null].flatMap((site) => [true, false].flatMap((research) => [true, false].map((repo) => bootstrapOpening({ site, research, repo })))),
      bootstrapStart(SITE), bootstrapDocStatus('a.md', 1, 4, true), bootstrapDocStatus('a.md', 1, 4, false),
      bootstrapDocFailed('Brand guidelines'), bootstrapPartial(1, 4), BOOTSTRAP_ERROR,
      bootstrapResume(['a.md']), bootstrapResume(['a.md', 'b.md']), bootstrapNudgeDone(['a.md', 'b.md']),
      bootstrapClosing('', ''),
      ...BOOTSTRAP_SCHED_FALLBACK.flatMap((r) => [r.title, r.prompt]),
      ...BOOTSTRAP_PLAYS.map((p) => p.why),
      filmStartLine({ seconds: 15, tier: 'NeuraMesh Video Starter', asked: 30, credits: 363 }),
    ];
    for (const line of lines) expect(breaks(line), line).toEqual([]);
    // the doc-drop line is the card's wire shape, not words: a parsed card never shows it
    expect(breaks(docDropBody('Brand guidelines', 'b.md', 'x'))).toEqual(['dash']);
  });

  it('the guard catches what it guards', () => {
    expect(breaks('Picking it back up — writing a.md now; soon')).toEqual(['dash', 'semicolon', 'picking', 'writing']);
    expect(breaks('Nothing posts until you approve it.')).toEqual([]);
  });
});
