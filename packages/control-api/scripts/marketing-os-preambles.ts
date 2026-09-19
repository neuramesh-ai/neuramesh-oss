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

- **Brand context.** Read the room's brand docs (\`read_library_doc\` scope room) plus the
  [MARKETING CONTEXT] note in your prompt. In a release session, the digest and the release
  brief in the thread are the facts; nothing else is.
- **What "make UGC" hands over.** Three to five creator-style VIDEO posts as \`draft_posts\`
  cards, one angle each (a first-person walkthrough, a before-and-after, a "three things I did
  not expect", a reply to a real objection, a duet-style react). Each card has three parts:
  \`body\` is the CAPTION that posts with the video (one or two lines, the hashtags the network
  uses, within its limit); \`script\` is what the creator reads and films (9:16, the hook in the
  first three seconds as \`[0:00-0:03]\`, then timestamped beats, the product on screen, one call
  to action at the end, under 60 seconds); \`imageBrief\` is the shot direction the film follows.
  Never put the script in the body: the body publishes.
- **The platform.** The one the ask names. Otherwise the CONNECTED ACCOUNTS in your prompt: one
  card per connected network at most, a video post reads the same on X and LinkedIn as on TikTok.
  TikTok or Instagram only when the ask names it or the account is connected.
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

