// The marketing-os pack manifest — the DATA half of gen-marketing-os-seed.ts.
//
// Thirteen bundled skills, each composed as: a NeuraMesh PREAMBLE (how this method lands
// inside the platform — brand docs instead of brand-context.md, artifacts instead of loose
// files, run legs instead of ad-hoc subagents, the enforced report shape) + the VERBATIM
// upstream module text(s) from vendor/marketing-os/. The preamble is part of the same
// load_skill body the model reads, so the adaptation can never lose to the module text the
// way a separate adapter skill would (the prompt-vs-inventory lesson, docs/design/
// marketing-os-2026-08 §7.6). Vendored sources are never edited — see vendor/marketing-os/
// README.md for the re-vendor contract.

export interface MarketingOsSkillSpec {
  name: string;
  /** one line for the skills index (injected capped at ~90 chars — write inside it) */
  description: string;
  /** vendor/marketing-os/references/ files, concatenated in order — or, with `root: 'community-skills'`,
   *  vendor/community-skills/<skill>/SKILL.md files (their YAML frontmatter dropped at generation) */
  sources: string[];
  root?: 'marketing-os' | 'community-skills';
  preamble: 'report' | 'doc' | 'prose' | 'ugc' | 'reference';
}

export { MARKETING_OS_PREAMBLES } from './marketing-os-preambles';

export const MARKETING_OS_PACK = {
  name: 'marketing-os',
  version: '1.2',
  source: 'github.com/Yuzzyuk/marketing-os (MIT, vendored) + vendor/community-skills (content-creator, ugc-strategy)',
  description:
    'The marketing-os craft pack — scored audits, GEO, the copy lab, hooks, paid-ads diagnosis, ' +
    'email, launches, positioning, teardowns, ASO, UGC, the content frame, honest analytics, and the de-slop pass.',
};

export const MARKETING_OS_SKILLS: MarketingOsSkillSpec[] = [
  {
    name: 'site-audit',
    description: 'Scored site/funnel audit — six weighted dimensions, 0-100, fixes written out',
    sources: ['audit.md', 'audit-rubric.md'],
    preamble: 'report',
  },
  {
    name: 'geo-citability',
    description: 'AI-search citability — baseline who gets cited, five levers, rewrites, re-measure',
    sources: ['geo.md', 'geo-engines.md'],
    preamble: 'report',
  },
  {
    name: 'competitor-teardown',
    description: 'Competitor teardown — ads, pricing, jobs, reviews into an exposure map',
    sources: ['competitive.md'],
    preamble: 'doc',
  },
  {
    name: 'positioning-offer-pricing',
    description: 'Positioning statement (pasteability-tested), offer design, pricing strategy',
    sources: ['positioning.md'],
    preamble: 'doc',
  },
  {
    name: 'launch-playbook',
    description: 'Launch plan T-4wk to T+1wk incl. Product Hunt — story, assets, day-one voices',
    sources: ['launch.md'],
    preamble: 'doc',
  },
  {
    name: 'paid-ads-audit',
    description: 'Paid-ads creative audit — concept fatigue vs its impostors, ranked briefs',
    sources: ['paid-ads.md', 'ads-diagnostics.md'],
    preamble: 'doc',
  },
  {
    name: 'app-store-kit',
    description: 'ASO kit — which half is broken, metadata to the char, screenshot sequence',
    sources: ['app-store.md', 'store-specs.md'],
    preamble: 'doc',
  },
  {
    name: 'copy-lab',
    description: 'Copy lab — 15-20 variants, five-perspective panel scoring, de-slop pass',
    sources: ['copy.md', 'copy-frameworks.md'],
    preamble: 'prose',
  },
  {
    name: 'hook-engine',
    description: 'Hook engine — 18 tactics, three-component spec, matrix + diagnostic funnel',
    sources: ['hooks.md'],
    preamble: 'prose',
  },
  {
    name: 'email-sequences',
    description: 'Email sequences written in full — welcome, nurture, launch, re-engagement',
    sources: ['email.md'],
    preamble: 'prose',
  },
  {
    name: 'social-craft',
    description: 'LinkedIn/X craft — hook families, feed mechanics, the repurposing tree',
    sources: ['social.md'],
    preamble: 'prose',
  },
  {
    name: 'content-creator',
    description: 'Content creator — audience, hook, value, scannable, action; blog/X/LinkedIn templates',
    sources: ['content-creator/SKILL.md'],
    root: 'community-skills',
    preamble: 'prose',
  },
  {
    name: 'ugc-strategy',
    description: 'UGC — creator-style scripts and briefs, rights, disclosure; campaigns and curation',
    sources: ['ugc-strategy/SKILL.md'],
    root: 'community-skills',
    preamble: 'ugc',
  },
  {
    name: 'honest-analytics',
    description: 'Honest analytics — evidence levels, test design, the trap catalogue',
    sources: ['analytics.md'],
    preamble: 'reference',
  },
  {
    name: 'slop-patterns',
    description: 'The AI-tell catalogue — run on all prose before delivery, no exceptions',
    sources: ['slop-patterns.md'],
    preamble: 'reference',
  },
];
