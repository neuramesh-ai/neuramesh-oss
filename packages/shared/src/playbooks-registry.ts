// The playbook REGISTRY (docs/design/marketing-os-2026-08) — the data half, split from
// playbooks.ts for the 250-line file cap: this file is the catalog (entries + the two
// shape-contract DoD constants); the types + derivations live in playbooks.ts. Adding a
// playbook is an entry HERE (the campaigns group lives in playbooks-campaigns.ts, split for the
// 250-line gate when the UGC playbook landed, 2026-09-18) plus its skill in the marketing-os pack.
import type { Playbook } from './playbooks';
import { CAMPAIGN_PLAYBOOKS } from './playbooks-campaigns';
import { DOC_SHAPE_DOD, REPORT_SHAPE_DOD } from './playbooks-dod';
export { DOC_SHAPE_DOD, REPORT_SHAPE_DOD } from './playbooks-dod';


export const PLAYBOOKS: Playbook[] = [
  {
    id: 'audit',
    title: 'Site & funnel audit',
    tagline: 'six dimensions, weighted 0 to 100, with a fix-first list',
    group: 'foundations',
    skill: 'site-audit',
    engine: 'unit',
    taskKind: 'research',
    inputs: [{ key: 'url', label: 'Site URL', fromProfile: 'website', required: true }],
    scored: true,
    legs: ['build'],
    fanout: ['messaging', 'conversion', 'search', 'competitive', 'trust', 'growth'],
    approach:
      'Load the `site-audit` skill and audit {url} against its rubric. Fan out one research leg per dimension ' +
      '(messaging · conversion · search · competitive · trust · growth), each reading the live site plus the pricing page, ' +
      'a product page and the top post where they exist. Synthesize the weighted total and the pattern yourself — never delegate the synthesis. ' +
      'Ground brand claims in the room’s brand docs (.nm-evidence/brand/). Write replacement copy, not instructions to write copy.',
    dod: REPORT_SHAPE_DOD,
    remeasure: { days: 30, label: 're-score in 30d' },
  },
  {
    id: 'geo',
    title: 'AI search (GEO)',
    tagline: 'who gets cited, page rewrites, then a re-measure',
    group: 'foundations',
    skill: 'geo-citability',
    engine: 'unit',
    taskKind: 'research',
    inputs: [{ key: 'url', label: 'Site URL', fromProfile: 'website', required: true }],
    scored: true,
    legs: ['build'],
    fanout: ['target questions × engines (≥3 samples each)', 'on-page extractability'],
    approach:
      'Load the `geo-citability` skill. Derive 8–15 target questions from the brand docs, baseline who gets cited today ' +
      '(sample each question at least 3× — citation is non-deterministic), audit the five levers on {url}, name the binding ' +
      'constraint, and produce actual rewrites + schema JSON-LD. End with the exact queries to re-run in 30 days.',
    dod: REPORT_SHAPE_DOD,
    remeasure: { days: 30, label: 're-measure in 30d' },
  },
  {
    id: 'teardown',
    title: 'Competitor teardown',
    tagline: 'ads, pricing, jobs, and reviews, then the exposure map',
    group: 'foundations',
    skill: 'competitor-teardown',
    engine: 'unit',
    taskKind: 'research',
    inputs: [{ key: 'competitor', label: 'Competitor(s)', required: true }],
    scored: false,
    legs: ['build'],
    fanout: ['one leg per competitor'],
    approach:
      'Load the `competitor-teardown` skill and run the protocol on {competitor}: positioning read, money read (public ad ' +
      'libraries — longevity is the strongest signal), customer read (reviews), trajectory read (jobs/changelog), then the ' +
      'exposure read. One leg per competitor; synthesize the cross-competitor pattern yourself. Public sources only; label inference as inference.',
    dod: DOC_SHAPE_DOD,
    remeasure: { cadence: 'weekly', label: 'weekly scan' },
  },
  {
    id: 'positioning',
    title: 'Positioning & offer',
    tagline: 'the six-clause statement, tested for pasteability',
    group: 'foundations',
    skill: 'positioning-offer-pricing',
    engine: 'unit',
    taskKind: 'research',
    inputs: [{ key: 'url', label: 'Product URL', fromProfile: 'website', required: true }],
    scored: false,
    legs: ['build'],
    approach:
      'Load the `positioning-offer-pricing` skill. Work the five inputs in order (alternatives → attributes → value → segment → ' +
      'category frame) from the brand docs + {url}, produce the six-clause statement with the unpasteable clauses marked, score the ' +
      'offer on its four axes, and state the strongest rejected frame beside the recommended one. Positioning is a hypothesis — say what would settle it.',
    dod: DOC_SHAPE_DOD,
  },
  {
    // Reply radar (docs/design/reply-radar-2026-08) — George's hand-built engagement routine,
    // made catalog data so every workspace gets it. Run once from the desk, then its remeasure
    // proposes the weekday routine: run-first is the consent for the RUN, the +Arm for the
    // schedule. Covers EVERY ready connector (2026-08-22) — the READ differs per network, the
    // card does not, and a row says which it was.
    id: 'engage',
    title: 'Reply radar',
    tagline: 'high-reach conversations worth a reply, ranked, with the replies drafted',
    group: 'content',
    skill: 'social-craft',
    engine: 'unit',
    taskKind: 'research',
    inputs: [{ key: 'subject', label: 'Brand or account to hunt for', fromProfile: 'website' }],
    scored: false,
    deliversReplies: true,
    // At least one connected account, and the run covers EVERY one that is live (George,
    // 2026-08-26: "linkedin should be optional if x is connected; if more than one connector
    // exists, it can run for both"). Zero ⇒ the dependency card, and nothing is created:
    // the task HAS to use a connector to search, so staffing it first is staffing a dead end.
    needs: [{ kind: 'connector', min: 1, any: ['x', 'linkedin', 'instagram', 'tiktok'], why: 'the radar reads real conversations through the room\'s own accounts' }],
    legs: ['build'],
    fanout: ['conversation hunt (per connected network)', 'rank by reach × fit', 'draft the replies'],
    approach:
      'Load the `social-craft` skill and find the conversations worth joining for {subject}, then draft the reply for each. ' +
      '{coverage} Use `search_x` for the readable networks — real posts, real impressions, never invented; a read that fails is ' +
      'reported, never filled in with plausible numbers. ' +
      'Mine the search terms from the brand docs (.nm-evidence/brand/ — positioning, audience, the objections you answer well). ' +
      'Rank candidates by reach × fit with the brand\'s wedge, keep the best 6–8, and for each write the reply exactly as it would post: ' +
      'platform-native, adds something the thread does not already have, never a pitch. Read the room\'s own recent posts for the honest ' +
      'baseline. Hand the whole set over with `draft_replies` — NEVER draft_posts (these are replies, not standalone posts) and never ' +
      'paste them into your reply. Then write the report.',
    dod:
      'Two deliverables: (1) the `draft_replies` card in the thread carrying every target + its drafted reply; ' +
      '(2) a markdown artifact named `engage-report-YYYY-MM-DD.md` whose first line is `# Reply radar — <subject>`, ' +
      'naming per network what was scanned and HOW (connector read vs public web), the terms searched, how many candidates were ' +
      'considered vs kept, EACH kept target (permalink, the post\'s own text, measured numbers where a connector read them) with ' +
      'its drafted reply verbatim, the brand\'s own reach baseline, and a `## What I couldn\'t determine` section. ' +
      'Nothing invented: no fabricated posts, handles or engagement numbers — a row with no measured reach says so.',
    remeasure: { cadence: 'weekdays', label: 'run the radar each weekday' },
  },
  {
    id: 'copylab',
    title: 'Copy lab',
    tagline: '15 to 20 variants, panel-scored, then de-slopped, in the thread',
    group: 'content',
    skill: 'copy-lab',
    engine: 'chat',
    inputs: [{ key: 'subject', label: 'What to write' }],
    scored: false,
    legs: [],
    approach: '',
    dod: '',
  },
  {
    id: 'hooks',
    title: 'Hook batch',
    tagline: 'the 18-tactic matrix: visual, spoken, and text, in the thread',
    group: 'content',
    skill: 'hook-engine',
    engine: 'chat',
    inputs: [{ key: 'segment', label: 'Audience segment' }],
    scored: false,
    legs: [],
    approach: '',
    dod: '',
  },
  {
    id: 'ugc',
    title: 'UGC scripts',
    tagline: 'creator-style scripts for a release or a feature, and the creator brief, in the thread',
    group: 'content',
    skill: 'ugc-strategy',
    engine: 'chat',
    inputs: [
      { key: 'subject', label: 'What the creators show (a release, a feature, the product)' },
      { key: 'platform', label: 'Where it posts (a connected account, else the ask decides)' },
    ],
    scored: false,
    legs: [],
    approach: '',
    dod: '',
  },
  {
    id: 'email',
    title: 'Email sequence',
    tagline: 'welcome, nurture, and launch, written in full, drafts only',
    group: 'content',
    skill: 'email-sequences',
    engine: 'chat',
    inputs: [{ key: 'sequence', label: 'Sequence type (welcome/nurture/launch/re-engagement)' }],
    scored: false,
    legs: [],
    approach: '',
    dod: '',
  },
  ...CAMPAIGN_PLAYBOOKS,
];
