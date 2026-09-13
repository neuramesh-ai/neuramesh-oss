// The playbook REGISTRY (docs/design/marketing-os-2026-08) — the data half, split from
// playbooks.ts for the 250-line file cap: this file is the catalog (entries + the two
// shape-contract DoD constants); the types + derivations live in playbooks.ts. Adding a
// playbook is an entry HERE plus its skill in the marketing-os pack — nothing else.
import type { Playbook } from './playbooks';

export const REPORT_SHAPE_DOD =
  'The report is a markdown artifact named `<playbookId>-report-YYYY-MM-DD.md` (e.g. `audit-report-2026-08-20.md`) ' +
  'whose second line reads `<date> · Score: NN/100 · Basis: <what was actually accessed>`, ' +
  'carrying a `## Scorecard` table, a `## Fix these first` list with the fixes WRITTEN OUT (replacement copy, not descriptions), ' +
  'a `## What’s already working` section, and a `## What I couldn’t determine` section that names every gap honestly. ' +
  'Scores are heuristics and the report says so. Nothing invented: no fabricated statistics, testimonials or names — `[NEED: x]` and the gaps section instead.';

export const DOC_SHAPE_DOD =
  'The deliverable is a markdown artifact ending with a `## What I couldn’t determine` section that names every gap honestly. ' +
  'Nothing invented: no fabricated statistics, testimonials or names — `[NEED: x]` and the gaps section instead.';

export const PLAYBOOKS: Playbook[] = [
  {
    id: 'audit',
    title: 'Site & funnel audit',
    tagline: 'six dimensions, weighted 0–100, fix-first list',
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
    tagline: 'citability: who gets cited, rewrites, re-measure',
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
    tagline: 'ads · pricing · jobs · reviews → the exposure map',
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
    tagline: 'the six-clause statement, pasteability-tested',
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
    tagline: 'high-reach conversations worth joining — targets ranked, replies drafted',
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
    tagline: '15–20 variants → panel-scored → de-slopped · in-thread',
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
    tagline: '18-tactic matrix: visual · spoken · text · in-thread',
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
    id: 'email',
    title: 'Email sequence',
    tagline: 'welcome / nurture / launch — written in full, drafts only',
    group: 'content',
    skill: 'email-sequences',
    engine: 'chat',
    inputs: [{ key: 'sequence', label: 'Sequence type (welcome/nurture/launch/re-engagement)' }],
    scored: false,
    legs: [],
    approach: '',
    dod: '',
  },
  {
    id: 'launch',
    title: 'Launch plan',
    tagline: 'T-4wk → T+1wk, asset stack as subtasks, PH included',
    group: 'campaigns',
    skill: 'launch-playbook',
    engine: 'unit',
    taskKind: 'content',
    inputs: [{ key: 'what', label: 'What ships', required: true }],
    scored: false,
    legs: ['build'],
    subtasks: [
      'One-sentence story + 3 proof points',
      'Launch email sequence (drafts)',
      'Founder posts, day 0–7 (drafts)',
      'Landing/listing copy',
      'FAQ / the 10 predictable replies',
    ],
    approach:
      'Load the `launch-playbook` skill and plan the launch of {what}: the one metric, the honest reachable-audience number, the ' +
      'launch equation’s weakest factor, the dated T-4wk → T+1wk timeline (hour-by-hour for day 0), day-one voices, and the risks ' +
      'with pre-written responses. The asset stack rides this unit’s subtasks — finish each onto the parent. Never project launch numbers.',
    dod: DOC_SHAPE_DOD,
  },
  {
    id: 'ads',
    title: 'Ads creative audit',
    tagline: 'concept fatigue vs its five impostors · needs ads MCP',
    group: 'campaigns',
    skill: 'paid-ads-audit',
    engine: 'unit',
    taskKind: 'research',
    inputs: [],
    scored: false,
    legs: ['build'],
    fanout: ['one leg per concept cluster'],
    approach:
      'Load the `paid-ads-audit` skill. Classify every ad by the ARGUMENT it makes (concepts, not assets) from the connected ads ' +
      'MCP — or from the public ad library, saying which basis you had. Diagnose fatigue against its five impostors, map coverage ' +
      'gaps (angle × awareness × format × hook × persona), and land a ranked production brief with the hooks WRITTEN OUT. Never touch live campaigns.',
    dod: DOC_SHAPE_DOD,
    remeasure: { days: 30, label: 're-read in 30d' },
  },
  {
    id: 'appstore',
    title: 'App store kit',
    tagline: 'ASO: which half is broken, metadata to the char',
    group: 'campaigns',
    skill: 'app-store-kit',
    engine: 'unit',
    taskKind: 'research',
    inputs: [{ key: 'app', label: 'App name / store link', required: true }],
    scored: false,
    legs: ['build'],
    approach:
      'Load the `app-store-kit` skill for {app}: diagnose which half is broken (discoverability vs conversion) before touching ' +
      'anything, build the keyword set from autocomplete/competitors/review language, write metadata to exact character counts, ' +
      'design the screenshot SEQUENCE frame by frame, assess the icon, and end with a one-variable test plan.',
    dod: DOC_SHAPE_DOD,
  },
];
