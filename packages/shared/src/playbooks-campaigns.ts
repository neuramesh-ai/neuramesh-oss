// The campaigns group of the playbook catalog (docs/design/marketing-os-2026-08): launch, ads,
// release drafts and the app-store kit. Split from playbooks-registry.ts for the 250-line gate when
// the UGC playbook joined the content group (2026-09-18); the registry spreads it into PLAYBOOKS.
import type { Playbook } from './playbooks';
import { DOC_SHAPE_DOD } from './playbooks-dod';

export const CAMPAIGN_PLAYBOOKS: Playbook[] = [
  {
    id: 'launch',
    title: 'Launch plan',
    tagline: 'T-4 weeks to T+1 week, the asset stack as subtasks, Product Hunt included',
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
    tagline: 'concept fatigue against its five impostors, needs the ads connector',
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
    // Release drafts (docs/design/release-drafts-2026-09): the repository as a marketing source.
    // The daily routine opens a session with the digest, and this run turns it into the brief
    // and one draft per connected account. The one-shot "draft the latest release" is the same unit.
    id: 'release',
    title: 'Release drafts',
    tagline: 'A release becomes posts: the brief, one draft per connected account, a release card.',
    group: 'campaigns',
    skill: 'release-announcement',
    engine: 'unit',
    taskKind: 'content',
    inputs: [{ key: 'release', label: 'Release (a tag, or the digest in this thread)' }],
    scored: false,
    needs: [
      { kind: 'repo', why: 'the run reads the release and the pull requests that built it' },
      { kind: 'connector', min: 1, any: ['x', 'linkedin', 'instagram', 'tiktok'], why: 'one draft per connected account, in each network’s own shape' },
    ],
    legs: ['build'],
    approach:
      'Load the `release-announcement` skill. Read the release digest in this thread (the notes and the merged pull requests) for {release}. ' +
      'Decide whether a feature shipped and name the ONE headline feature, or say that nothing is worth announcing and stop. ' +
      'Ground the voice in the brand docs (.nm-evidence/brand/). Write the release brief, then one post per connected account. {coverage} ' +
      'Instagram and TikTok posts carry an image brief for the release card. Never invent a number, a quote or a customer.',
    dod:
      'Two deliverables: (1) `release-report-YYYY-MM-DD.md`, whose first line is `# Release brief · <tag>` and whose second line reads ' +
      '`Verdict: feature · Basis: <what was read>` (the verdict is one of feature, improvement, fix, none), carrying `## Why` (the reasons, the pull requests by number), ' +
      '`## Audience`, `## Assets` (what was drawn and why) and `## What I could not determine`; ' +
      '(2) `posts.json` with one post per connected account, each in that network’s own shape and length, with an `imageBrief` on Instagram and TikTok posts. ' +
      'Nothing invented: no fabricated numbers, quotes or names.',
  },
  {
    id: 'appstore',
    title: 'App store kit',
    tagline: 'ASO: which half is broken, and the metadata to the character',
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
