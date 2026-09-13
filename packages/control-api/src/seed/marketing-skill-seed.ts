// Hand-authored (NOT generated): the marketing-core bundled pack, seeded into
// kind='marketing' rooms the same way the build packs reach #dev/#build
// (skillpack.seed_defaults + the host reconciler backfill). Original content —
// distilled from the marketing-channel plan, the samples/ shape contract, and
// the live bootstrap lessons (integrations-and-skills-plan.md §3 P1).
import type { ParsedSkill } from '@neuramesh/shared';
import type { SeedPack } from './skill-seed';

const SKILLS: ParsedSkill[] = [
  {
    name: 'brand-research',
    description: 'How to actually research a product before writing brand docs — site, styles, pricing, market. Never vibes.',
    body: `# Brand research — grounded, never vibes

When researching a product for brand docs, follow this order and cite what you actually saw:

1. **Fetch the site page by page.** Home, pricing, docs, about, blog. Quote the site's own
   words for positioning — the tagline verbatim is the voice anchor.
2. **Client-side apps hide their content.** If a page returns a near-empty HTML shell, fetch
   the linked assets: the CSS bundle(s) for real design tokens (hex colors, font families,
   radii) and the JS bundle for embedded copy. A \`<link rel="stylesheet">\` or a
   \`/assets/*.css\` URL in the shell is your palette source of truth.
3. **Pricing is only what the pricing page says.** If it isn't readable, write "unknown" and
   say why — never infer tiers or numbers.
4. **Market context comes from search.** Name real competitors and communities; check how
   each positions itself on its OWN site before characterizing it.
5. **Unknown beats invented.** Every fact you can't trace to something you fetched is marked
   \`unknown\`. A doc with honest gaps is trustworthy; a confident guess poisons every doc
   downstream.
6. **Cite as you go.** End each doc with the pages you actually read.`,
  },
  {
    name: 'doc-shapes',
    description: 'The four brand-foundation documents and their exact section shapes.',
    body: `# Brand-foundation doc shapes

Four documents, each titled \`# <Product>. <Doc name>\`, tight and scannable. Tables where
data is tabular; numbered bold-label lists for pillars and segments; one honest line for
maturity. Sections in order:

**business-profile.md** — What It Is (2-3 sentences) · Core Value Prop (one quotable line) ·
How It Works (arrow chain) · Key Differentiators (4-6 bullets) · Pricing (| Tier | Price |
Key Limits | from the live pricing page) · Target Audience · Tone · Stage (one honest line).

**brand-guidelines.md** — Color Palette (| Role | Hex | from the site's real styles, then a
**Mood:** line) · Typography · Spacing & Shape · Buttons (real CTA labels) · Brand Voice ·
Visual Style · What to Avoid.

**market-research.md** — Competitive Landscape (framing line + | Competitor | Category |
Key Weakness vs <Product> | of REAL competitors) · Strategic Wedge (one paragraph) · Market
Signals · Target Audience Segments (numbered, **bold name:** one line) · Opportunity Gaps.

**social-strategy.md** — Platform Priority · Core Narrative Pillars (numbered, bold, one
relatable line each) · Content Formats That Work · Posting Cadence (Starter) · Tone Rules ·
Key Hashtags / Communities · Quick-Win Content Ideas (5 concrete drafts in the brand voice).`,
  },
  {
    name: 'post-quality',
    description: 'Platform-native drafting rules for social content — and the publish rule.',
    body: `# Post quality

- **Lead with the pain, not the product.** The reader's problem earns the first line.
- **Platform-native:** X wants short, declarative, quotable; threads open with the hook;
  no hashtag stuffing (0-2, only when they carry reach).
- **The brand voice comes from brand-guidelines.md** — vocabulary, motifs, sentence length.
  Read it before drafting; reuse its do/don't pairs.
- **Every claim in a post must exist in a brand doc.** If the doc says "unknown", the post
  doesn't say it at all.
- **Character discipline:** X posts ≤ 280 including links; say the length in your draft note.
- **You never publish.** Hand drafts over with the draft_posts tool — each renders as a review
  card the human approves right in the thread. Never paste drafts as plain markdown, and never
  append a "(draft only)" footer: the card itself carries the approval state, and the system
  strips such footers from the wire text.
- **De-slop before hand-over.** Run every surviving draft through the \`slop-patterns\` skill's
  checks (marketing-os pack) — a reader who clocks copy as AI-written discounts the claim.`,
  },
  {
    name: 'competitor-scan',
    description: 'How to run a competitive sweep that names real players and real weaknesses.',
    body: `# Competitor scan

1. Search the category the product claims, plus the pains it solves (two different lists).
2. For each candidate competitor, open its OWN site: capture its category, its one-line
   positioning, and its pricing model — from its pages, not from roundups.
3. A "weakness vs us" must be structural (architecture, pricing model, data path), not
   cosmetic. If you can't name one honestly, say "comparable" — a fake weakness in a doc
   becomes a false claim in a post later.
4. Note the communities where the category argues (subreddits, HN, X circles) with sizes
   when visible — those feed the social strategy.
5. Date the scan. Competitive facts rot; the doc should say when it was true.
6. This is the LIGHT sweep. The full protocol — ads/pricing/jobs/reviews into an exposure
   map — is the \`competitor-teardown\` skill (marketing-os pack), run as the teardown playbook.`,
  },
  {
    name: 'content-calendar',
    description: 'Cadence planning: what to schedule, how often, and what each slot needs.',
    body: `# Content calendar

- **Start smaller than you think:** one main post per weekday beats seven half-drafts. A
  weekly thread on the strongest pillar. Reply slots are opportunistic, not scheduled.
- **Every scheduled slot maps to a narrative pillar** from social-strategy.md — rotate
  pillars so one theme doesn't monopolize a week.
- **A slot's draft needs:** the pillar, the format, the hook, and the source doc line it's
  grounded in. If a slot has no grounding line, it's filler — cut it.
- **Cadence changes are human decisions.** Propose them in the room; the human arms or
  edits schedules. Never assume an approved post implies an approved cadence.
- **Weekly review:** what shipped, what got engagement, which pillar earned the next week's
  extra slot. Write it as a short room note.`,
  },
];

export const MARKETING_SKILL_SEED: SeedPack[] = [
  {
    pack: {
      name: 'marketing-core',
      description: 'Marketing HQ essentials — grounded research, the brand-doc shapes, post quality, competitor scans, calendar discipline.',
      source_url: 'https://neuramesh.app',
      source_ref: 'bundled',
      version: 'bundled@v1',
    },
    skills: SKILLS,
  },
];
