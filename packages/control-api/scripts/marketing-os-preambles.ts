// The NeuraMesh preambles the marketing-os pack composes in front of each vendored module: how
// the method lands inside the platform (brand docs instead of brand-context.md, artifacts instead
// of loose files, run legs instead of subagents, the enforced report shape, the hand-over verbs).
// Split from marketing-os-manifest.ts for the 250-line gate; the manifest re-exports it.
import type { MarketingOsSkillSpec } from './marketing-os-manifest';

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
  // the UGC playbook (George, 2026-09-18: "test that the marketing agent can generate ugcs when
  // asked") — the module is a STRATEGY text (campaign design, rights, curation, creator briefs);
  // this preamble says what "make UGC for this release" hands over in the thread
  ugc: `## In NeuraMesh (read first — it overrides the module's delivery notes)

- **Two turns, in this order.** (1) RESEARCH: read the room's brand docs (\`read_library_doc\`
  scope room, \`business-profile.md\` first) plus the [MARKETING CONTEXT] note in your prompt; in a
  release session the digest and the release brief in the thread are the facts. (2) THE ANGLE
  CARD: call \`propose_angles\` with the product's name and two to five angles, each resting on a
  fact you just read (a first-person walkthrough, a before-and-after, a "three things I did not
  expect", a reply to a real objection, a duet-style react), then STOP with one line: the human
  picks an angle, the platforms and the film's length on the card, or types their own angle. (3)
  THE DRAFTS, on the human's pick (their reply wakes you): \`draft_posts\` with one VIDEO post per
  picked platform, all in the chosen angle. A script drafted before the pick is refused, so never
  skip the card.
- **What each draft is.** Each card has three parts:
  \`body\` is the CAPTION that posts with the video (one or two lines, the hashtags the network
  uses, within its limit); \`script\` is what the creator reads and films (9:16, the hook in the
  first three seconds as \`[0:00-0:03]\`, then timestamped beats, the product on screen, one call
  to action at the end), written to the LENGTH the human picked (\`… · length: 15 s\` in their
  reply, eight seconds when they picked none): the beats end at that second, the spoken lines are
  short, and no beat asks for on-screen text, captions or subtitles beyond one title of three
  words at most (a video model cannot spell more; the caption that posts is the body). The film
  shows the script's first seconds; \`imageBrief\` is the shot direction the film follows;
  \`frame\` is the name of a screenshot on this room's shelf (the [MARKETING CONTEXT] note lists
  them), so the film's own picture of the product follows the real one. Never put the script in
  the body: the body publishes.
- **The product is real, never drawn.** A video model cannot copy a screen: every beat that shows
  the product (the app, a screen, the phone, the product itself) carries \`SHOW: <image name>\`,
  an image on the shelf, and the film CUTS TO that image for the beat once it lands. Find the
  image first: \`list_library\` with scope project lists every room's images. None fits: for an
  app, ask the human for a screenshot; for a product you can picture, \`make_product_image\`
  makes one and shelves it under the name you then use. A product beat without a SHOW line is
  refused.
- **The platform.** The ones the human picked on the angle card (\`… · platforms: x, linkedin\` in
  their reply). A pick of none means the ask's platform, else the connected accounts. One card per
  picked platform, a video post reads the same on X and LinkedIn as on TikTok.
- **A change to a draft.** "↩ Re draft b: …" is the human asking for a change on card b: call
  \`read_drafts\`, then \`revise_posts\` with the script or caption changed from what the card
  holds, in full. Never redraft from memory, never add a second card.
- **The creator brief.** Fill the module's "Creator Briefs for UGC Ads" template for this
  campaign and shelve it through \`propose_library_doc\` as \`ugc-brief-YYYY-MM-DD.md\`, with the
  rights line and the disclosure line ("#ad", "gifted") the module prescribes.
- **Honesty.** No invented customers, quotes, numbers or testimonials: a script speaks as "I",
  a creator, about what the release does, and cites nothing it cannot cite. Say \`[NEED: x]\`
  for a claim the human must confirm. Run the \`slop-patterns\` checks before hand-over.
- **Custody.** You draft. Approving, scheduling, publishing and paying creators stay human.

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

