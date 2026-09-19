# 05 — Engineering Philosophy: The NeuraMesh Way

**For every human and every agent who writes a line of this codebase.**

This is doctrine, not decoration. It is loaded into every agent session via [CLAUDE.md](../CLAUDE.md), cited in reviews, and enforced by gates wherever a value can be made mechanical. When a PR and this document disagree, one of them changes — explicitly, never silently.

---

## 0. The mission

We are building the world's best collaboration platform for engineering teams made of humans and AI agents.

The bar: **a 3-person team with 5 agents should outship a 10-person team without — and have more fun doing it.**

Every decision passes one litmus: *does this make the loop — plan → fan out → execute → validate → review → accept — faster, safer, or more delightful?* If it does none of those, we don't build it, no matter how interesting it is.

---

## 1. What we stand for

### 1.1 Speed you can feel
Latency is product, not ops. A user should never wait on us — not on send, not on channel switch, not on launch, not on a plane. Perceived speed is engineered: local-replica reads, optimistic writes, skeletons over spinners, motion under 150ms.

Our cautionary tale is canon: T3 Code wrapped agent CLIs and added **3x wall-clock** to real tasks. That failure mode has a name here ("wrapping tax") and a budget (§6). We pass streams through; we never sit in the agent's hot path.

### 1.2 Evidence over claims
Work is not done because someone — human or agent — *says* it's done. Work is done when it's **shown**: tests passing, screenshots attached, diffs reviewable, budgets measured. This is the product's core mechanic (submit requires artifacts; review gates done; humans accept), and we hold ourselves to the same standard we sell. "It works on my machine" is not evidence. Artifacts or it didn't happen.

### 1.3 Enforced, not prompted
Invariants live in the server, the schema, and the type system — never in prompt etiquette. Slock got this right with task claiming ("enforced by the system, not AI manners") and we generalize it: illegal state transitions are *rejected*, double-claims are *impossible*, self-review is *blocked*, artifact-less submission *does not compile*. If a rule matters, an agent must be physically unable to break it. Prompts are for judgment; code is for law.

### 1.4 Your compute, cloud truth
*(Amended 2026-08-30 — until then this read "local compute"; [docs/09 §14](09-system-architecture.md#14-amended-2026-08-30--the-cloud-plane) records the change.)*

The user's code, keys, and machines are theirs — and a machine is theirs whether it is a laptop or a **cloud machine NeuraMesh provisions for that member**: a gVisor sandbox with its own volume, their vendor logins on that volume and nowhere else, outbound-only, no platform SSH, no platform snapshots of the volume. Daemons connect outbound-only; inference is BYOK/BYOS; nothing leaves a machine unless explicitly attached. The platform holds no repo tokens and no model keys, with one narrow, named exception: the metered starter brain, whose key stays server-side behind a proxy so it can be capped and never reaches a machine. Meanwhile the team's *state* — channels, board, events, memory — is always consistent in the cloud and replicated locally for offline. We never blur this line in either direction: no code in our cloud, no team state trapped on one machine.

### 1.5 Craft that compounds
Boring technology where we don't differentiate; obsessive excellence where we do. Postgres, Electron, TypeScript — boring, proven, chosen by measurement. The orchestration loop, the feel of the board, the thread model, recall speed — these are the product, and they get the polish budget. Taste is a feature: empty states, microcopy, dark/light parity, keyboard paths. Every detail either compounds trust or erodes it.

---

## 2. First principles, not cargo cult

"Best practice" is a hypothesis, not an answer. The method:

1. **State the physics.** Latency floors, sync costs, token costs, context limits, human attention. These don't negotiate.
2. **Derive the design** from the constraints and the mission.
3. **Then check convention.** If our derivation matches the herd, fine — cheap confidence. If it diverges, one of us is wrong: find out which *before* building.
4. **Write down every deviation** and why (a paragraph in the PR or a decision doc, depending on blast radius).

Worked examples already in canon:

- We ship Electron **not** because everyone does, but because we measured the reference class (Linear, Cursor, Claude Desktop all feel fast on it), the Agent SDK is Node-native, and the shell was never the bottleneck — the sync architecture is. First principles *agreed* with convention; we documented why.
- Slack clones assume humans type slowly, one message at a time. **Agents emit event bursts.** So: pull-based inboxes, held drafts, thread-per-task, digests — derived from what agents actually do, not from what Slack looks like.
- Agent output variance is physics, not a bug to wish away. So the review loop and the requirements gate are *architecture*, not process garnish.
- We steal mechanics (Slock's claims, T3's worktrees, Letta's memory blocks) only after we can explain *why they work*. Stealing without understanding is cargo cult with extra steps.

---

## 3. Optimizing for developer happiness

Two audiences. Both matter, because an unhappy codebase ships unhappy software.

### 3.1 The engineers who use NeuraMesh
- **Time-to-wow ≤ 2 minutes.** Sign in → workspace → machine connected → orchestrator previewed → first fan-out. Every onboarding step we add must pay rent.
- **Zero config before value.** Defaults that work; settings for the 5%, discoverable later.
- **Keyboard-first.** Everything reachable from ⌘K. Mice are optional; flow is not.
- **Never block on the cloud.** Offline reads everything, writes queue. The plane test is a release gate.
- **Channels stay readable.** Detail lives in threads; channels get digests. Noise is a bug — at fan-out scale, it's *the* bug.
- **Errors say what to do next.** Every error message names the action that fixes it. "Something went wrong" is banned.

### 3.2 The humans and agents who build NeuraMesh
- **Fast loops:** typecheck + unit tests fast enough that nobody batches work to avoid them. CI under 10 minutes or it gets fixed before features do.
- **One command up:** fresh clone → running app + seeded data with a single command. If setup needs a wiki page, setup is broken.
- **Types are the documentation.** Shared types client ↔ API ↔ agent layer; if a contract matters, it's typed. Comments exist only for constraints code cannot express.
- **No flaky tests.** A flaky test is a sev-2: quarantine same day, fix or delete within the week. Trust in the suite is the asset.
- **Small diffs, reviewed fast.** PRs sized to be understood in one sitting. Review latency is everyone's responsibility — including reviewer agents.

---

## 4. Wow factor

We are not building a tool that's merely *correct*. We're building the thing engineers show their friends.

- **Demo-driven development.** Every feature must have a 30-second demo story before we build it. If we can't describe the demo, we don't understand the feature. If we can't *run* the demo when it's "done," it isn't.
- **One "wait, it can do that?" per release.** Watching the board update live as three agents claim, execute, and pass review — that's the bar for *baseline*, not wow. Find the next one every release.
- **First-run is sacred.** The first fan-out a user ever triggers must work flawlessly and feel like magic. We curate that path obsessively (seeded examples, guaranteed-fast first task, orchestrator that narrates just enough).
- **Perceived performance is a discipline:** optimistic everything; skeletons, never spinners; latency numbers shown proudly in the UI (synced · 14ms) because we can.
- **The taste checklist** for any surface that ships: empty state designed, microcopy read aloud once, both themes verified, keyboard path exists, motion under 150ms, screenshot-worthy.

---

## 5. Engineering thoroughness

### 5.1 Definition of Done — six artifacts, no exceptions
1. **Code** that matches the codebase's idiom.
2. **Tests** that fail without the change (unit at minimum; loop-level for anything touching the FSM, sync, or agent layer).
3. **Evidence** — screenshots for UI, perf numbers for hot paths, repro-then-green for bugs — one block per surface the change reaches, each with that surface's automated check and its screenshots in both themes ([docs/45 §5](45-feature-placement.md#5-proof-per-surface)).
4. **Docs** updated in the same PR if behavior changed (README, docs/, llms.txt).
5. **Budgets** respected (§6) — measured, not vibes.
6. **Review** passed — and for risky changes, *adversarial* review: the reviewer's job is to break it, not bless it.

### 5.2 We are user zero
This repo runs on NeuraMesh's own loop, from before NeuraMesh exists: tasks get claimed (never grabbed), requirements get confirmed before execution, work happens in worktrees, submissions carry artifacts, reviews bounce with structured feedback, humans accept. If the loop annoys us, that's product signal — fix the product, don't bypass the loop.

### 5.3 Bugs
Reproduce → root-cause → fix → regression test → guard. In that order, always. No fix ships without a reproduction; no root cause means no fix (a patch that hides a symptom is a second bug). Every bug fixed leaves behind the test that would have caught it.

### 5.4 Security invariants (violating any of these is a stop-ship)
- Daemons outbound-only; no listening ports on user machines.
- Inference keys live in the machine keychain; the platform never holds them.
- Agent access = explicit machine-owner grants (repos × channels × permission mode).
- ACLs enforced server-side; channel registration is the boundary; self-review blocked.
- Every privileged action lands in the append-only events log.

---

## 6. Performance budgets

A budget miss is a **bug**, not a backlog item. Measured in PR evidence now; CI-gated as soon as the harness exists.

| Surface | Budget |
|---|---|
| Message send → rendered locally | < 50ms |
| Channel / view switch | < 100ms |
| Cold start to interactive | < 2s |
| Memory recall (hybrid query) | < 200ms |
| Agent wall-clock overhead vs raw Claude Code | < 10% — *the wrapping tax gate* |
| List scrolling (any length) | 60fps (virtualized) |
| Offline | full read + queued writes; reconnect replays cleanly |
| Interaction motion | ≤ 150ms, with reduced-motion respect |

When a budget and a feature conflict, the budget wins until a human explicitly re-trades it in writing.

---

## 7. How we decide

- **Two-way doors** (reversible): whoever is closest — human or agent — decides within a day, notes it in the PR/task, moves. Speed of iteration beats perfection of choice.
- **One-way doors** (schema, protocol, vendor, pricing, security): a short written decision — options, trade-offs, recommendation — and founder acceptance. [docs/02](02-architecture-options.md) is the template and the precedent.
- **Assumptions are surfaced before building**, in the open: *"Assuming X, Y, Z — correct me or I proceed."* The most expensive failure mode in agent-built software is a wrong assumption executed flawlessly.
- **Disagree with evidence, then commit.** Benchmarks, repros, and user quotes beat adjectives. Once decided, everyone — especially agents — executes the decision as if it were their own.
- **When spec and reality conflict: stop and say so.** Silently picking an interpretation is the one unforgivable sin in this codebase. Naming a confusion is always free; guessing wrong never is.

---

## 8. What we refuse to do

- **Ship latency to buy features.** No feature is worth breaking §6.
- **Enforce invariants in prompts.** If it must be true, make it impossible to violate (§1.3).
- **Add vendors to the hot path.** Every external dependency in the send/recall/execute path needs a written justification and an exit plan.
- **Be clever where boring works.** Cleverness is a loan against every future reader — human and agent.
- **Creep scope silently.** Drive-by refactors, "while I was here" changes, and unrequested features die in review.
- **Fake the demo.** Mockups are labeled mockups. Seeded data is labeled seeded. The moment we lie to ourselves about what works, the evidence culture (§1.2) is dead.
- **Tolerate flakes, warnings-as-noise, or skipped tests.** Broken windows multiply at agent speed.
- **Build for hypothetical scale.** We design seams (option B swap, event log) and build for the next order of magnitude only.
- **Build a general-purpose IDE.** The boundary after the Engineering OS ruling (2026-08-29): NeuraMesh directs, constrains, reviews, and accepts **agentic** code changes. Its code surface may show complete proposed/applied diffs, source, Work Plans, checkpoints, comments, and narrowly scoped edits driven by the coding harness. It does not grow an extension marketplace, debugger, LSP, or a second worktree/merge system without a new written decision. Deep human authoring keeps an explicit escape hatch to the user's local editor. The review loop is the product; cloning VS Code is still refused.

---

## 9. Operating rules for every agent in this repo

1. **Read [CLAUDE.md](../CLAUDE.md) and this document first.** They outrank your habits and your training priors.
2. **Confirm requirements before executing.** Post the checklist; if anything is unmet or ambiguous, ask — `blocked` is a respectable state, a wrong guess is not.
3. **Work in your worktree.** Never on main, never in another task's tree.
4. **Smallest slice that proves the loop.** Build thin and vertical; verify before expanding; commit at working checkpoints.
5. **Attach evidence to everything you claim.** Tests, screenshots, perf numbers, repro steps. Your submission is rejected without them — by design.
6. **Match the codebase.** Its idiom, its naming, its comment density. Leave no scars: no orphaned TODOs, no commented-out code, no "improved" lines you weren't asked to touch.
7. **Update docs and types in the same change.** If behavior moved and the docs didn't, the work isn't done.
8. **Respect every budget** — performance (§6), scope (the task's requirements), and tokens (don't spend a dollar of compute to avoid a dime of thinking).
9. **Report faithfully.** If tests fail, say so with output. If you skipped something, say that. Optimistic status reports are evidence-culture violations.
10. **Make it feel fast and look beautiful**, in both themes, or it isn't NeuraMesh.
11. **Place the feature before you build it** ([docs/45](45-feature-placement.md)): the tier (Pro, the hosted side, is the default, Free is the local app) and the plan (`cloud` only, or every hosted plan), the surfaces in order (the browser client, the phone, then the API and the cloud machines as needed), the gate, the proof per surface. The desktop app is open source and ships as needed: a Free feature, a fix installed apps need, or a parity catch-up. A feature ahead of the desktop gets its ledger row in the same PR.

---

## 10. The creed

We build the place where humans and agents do their best work together —
so building it must feel that way too.

Speed is respect. Evidence is trust. Enforcement is kindness.
Boring where it doesn't matter, breathtaking where it does.

Ship the loop. Show the work. Accept nothing less.
