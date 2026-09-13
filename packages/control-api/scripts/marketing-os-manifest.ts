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
  /** vendor/marketing-os/references/ files, concatenated in order */
  sources: string[];
  preamble: 'report' | 'doc' | 'prose' | 'reference';
}

/** Shared preamble text per deliverable kind. `{skill}` fills with the skill name. */
export const MARKETING_OS_PREAMBLES: Record<MarketingOsSkillSpec['preamble'], string> = {
  // scored playbooks (audit, geo) — the platform REFUSES the deliverable without the shape
  report: `## In NeuraMesh (read first — it overrides the module's delivery notes)

- **Brand context.** Where the module says \`brand-context.md\`, read the room's brand docs
  instead: \`business-profile.md\`, \`brand-guidelines.md\`, \`market-research.md\`,
  \`social-strategy.md\` — via \`read_library_doc\` when you have library tools, or as files
  under \`./.nm-evidence/brand/\` in a task worktree — plus the [MARKETING CONTEXT] note in
  your prompt. If none exist, proceed and say the output is un-contextualised.
- **Delivery.** The deliverable is this unit's artifact: write it as a markdown file named
  \`<playbookId>-report-YYYY-MM-DD.md\` (e.g. \`audit-report-2026-08-20.md\`) in the worktree —
  the name IS the report's identity; the score trend matches on it. Never paste the whole
  report into chat.
- **The shape is enforced.** Line 1: \`# <Playbook title> — <subject>\`. Line 2:
  \`<date> · Score: NN/100 · Basis: <what you actually accessed>\`. Include \`## Scorecard\`
  (a table: dimension | score | weight | verdict), \`## Fix these first\` (the fixes WRITTEN
  OUT), \`## What's already working\`, and end with \`## What I couldn't determine\`. A report
  missing the score head or the gaps section is refused by the platform's shape guard.
- **Fan-out.** Where the module says "spawn subagents", use your run's legs (\`spawn\`) as your
  approved plan declares; synthesize the total yourself — never delegate the synthesis.
- **Custody.** You draft and diagnose. Publishing, campaigns and credentials stay human.

---

`,
  // unscored unit playbooks (teardown, positioning, launch, ads, appstore)
  doc: `## In NeuraMesh (read first — it overrides the module's delivery notes)

- **Brand context.** Where the module says \`brand-context.md\`, read the room's brand docs
  instead (\`read_library_doc\`, or \`./.nm-evidence/brand/\` in a task worktree) plus the
  [MARKETING CONTEXT] note. If none exist, proceed and say the output is un-contextualised.
- **Delivery.** The deliverable is this unit's artifact: write it as a markdown file named
  \`<playbookId>-report-YYYY-MM-DD.md\` (e.g. \`teardown-report-2026-08-20.md\`) in the
  worktree — the name IS the run's identity, and the date versions it: a later run lands as
  a sibling file, never an overwrite. Inside, follow the module's own output skeleton,
  always ending with \`## What I couldn't determine\`. Never paste the whole document into chat.
- **Fan-out.** Where the module says "spawn subagents", use your run's legs (\`spawn\`) as your
  approved plan declares; synthesize the cross-leg pattern yourself.
- **Custody.** You draft and diagnose. Publishing, campaigns and credentials stay human.

---

`,
  // chat playbooks (copy lab, hooks, email, social craft) — deliverables are hand-overs
  prose: `## In NeuraMesh (read first — it overrides the module's delivery notes)

- **Brand context.** Where the module says \`brand-context.md\`, read the room's brand docs
  (\`read_library_doc\` scope room) plus the [MARKETING CONTEXT] note in your prompt.
- **Delivery.** You are answering IN the conversation. Social drafts hand over with
  \`draft_posts\` / \`revise_posts\` — never pasted JSON, never a wall of markdown. A document
  worth keeping (a sequence, a matrix, a variant set) goes through \`propose_library_doc\`,
  named \`<topic>-YYYY-MM-DD.md\` (the date versions re-runs), so a human's approval shelves
  it. Show your recommended option first, runners-up scored.
- **De-slop.** Run the \`slop-patterns\` skill's checks on every survivor before hand-over.
- **Custody.** You draft. Approving, scheduling and publishing stay human — the platform
  enforces it; don't promise otherwise.

---

`,
  // cross-cutting references (analytics, slop-patterns) — method only
  reference: `## In NeuraMesh (read first)

This is a cross-cutting reference the other marketing skills lean on — apply it inside
whatever you are already producing. Brand context = the room's brand docs + the
[MARKETING CONTEXT] note, not \`brand-context.md\`.

---

`,
};

export const MARKETING_OS_PACK = {
  name: 'marketing-os',
  version: '1.1',
  source: 'github.com/Yuzzyuk/marketing-os (MIT, vendored)',
  description:
    'The marketing-os craft pack — scored audits, GEO, the copy lab, hooks, paid-ads diagnosis, ' +
    'email, launches, positioning, teardowns, ASO, honest analytics, and the de-slop pass.',
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
