# Code on your machine — the desktop as a host, and where a session runs

**Ask (George, 2026-09-04, two messages).** (1) "Users who download the desktop app, while having a
cloud machine, can't code but can run chat threads on their machine. Isn't desktop just another
machine surface available to the workspace where agents run?" (2) "Build it and let's test end to
end. Routines and sessions started on the web/cloud should always prefer running on the cloud
machine if one is available; users can default LOCAL sessions to their local machine (a desktop-only
feature), so sessions started on their desktop app run on their machine. This config is available
for the workspace, and as a machine selector from the composer in New chat and Code: users pick a
machine to run the session, available machines are listed."

## Review: what already exists, and what the ask actually adds

- **A placement ladder exists and is the right home for the rule.** `packages/shared/src/compute.ts`
  (0114 shared compute · 0118 member compute · 0119 consent) decides on every wake whether THIS
  machine claims the work: incapable → skip; a **designated** machine (the thread's prior machine
  for continuity → the origin member's per-agent choice → their default machine) → that machine
  claims, others wait a grace window then step in; an **origin** member's own machine → claim; a
  member with no live machine → failover to a granted peer. The claim itself is the `runs` lease
  (one run per trigger), so two daemons never generate the same answer. `ComputePrefs` live on
  `workspace_members.compute` (`machine` · `agents` · `shares`) and are edited in the Compute panel
  ("runs on", per agent). The pill and the panel already derive placement with `placementFor`.
- **What is missing is the SESSION as a placement subject.** Today a thread has no machine of its
  own until a run gives it one (`priorMachineFor` reads the last run). A choice made in the composer
  has nowhere to land, and "started on the desktop" is not a fact the ladder can read.
- **Code sessions are placed by the client, not by the ladder.** The engineering channel is opened
  to one `machineId` (the relay bridge resolves the usage read's first machine). The same selector
  should drive both: for chat it designates the thread; for Code it names the host to dial.
- **The desktop is a machine but not a Code host** (slice A, #426, made it a Code *client*). Only
  `machined` builds an engineering host. The three endpoints that host needs — `/v1/model-packs`,
  `/v1/credentials/resolve`, `/v1/starter/generate` — accept a workspace MEMBER's bearer as well as a
  machine token (`actorMayReadCredentials`, `actorInWorkspace`), so the app can host Code as the
  human it is signed in as. No machine token is needed for a session the app runs for its own user.
- **The dev stack's "Cloud machine" pill names the laptop.** The dev workspace holds only local
  machines; `machines[0]` from the usage read is the app's own row. Fixed as a side effect below:
  the pill and the selector will say what kind of machine they are looking at.

## The rule (D9)

A session runs on **the machine it was designated to**, else on **the machine of its origin**:

| session started from | designated by | default (nothing picked) |
|---|---|---|
| the **desktop app** | the composer's machine chip | the member's *desktop sessions* setting: **This Mac** (opt-in, desktop-only) or **Auto** (today's ladder: cloud when awake, else this Mac) |
| the **browser** (and the phone, web-born by construction) | the composer's machine chip | **the cloud machine, whatever brain it holds** (the member's own when awake, else the runner). A brain the cloud machine lacks is re-seated on the NeuraMesh brain, on credits, and the thread says so. Only when no cloud machine is awake: the member's own machine, else failover |
| a **routine** | — | **the cloud machine, the same way** (the routine wake already raises the runner, #412); else whichever capable machine is awake |

Continuity still outranks everything for a desktop-born thread: a thread that already ran somewhere
keeps running there (George, 2026-08-12). A designation names a machine that is asleep → the wake
raises it (cloud) or waits the grace window (a laptop) and then falls back, exactly as the ladder
does today. Nothing here is a prompt: the designation is a column, the rule is shared pure code
with tests, the claim is a lease.

**Amended 2026-09-19 (rung 0, `shouldClaim`).** George's ground truths, after a web session in the
Flowe AI marketing room ran on his laptop while the cloud machine logged `wake_skip … cannot
serve claude-code` twice: *all queries and routines started on the web or mobile always run on
the cloud machine. If their configured brain is not available there, they run on the NeuraMesh
brain, with credits. Brain availability across a member's devices never decides where a thread
runs.* The ladder used to ask capability first, so a runner with no Claude login stood down from
a web session seated on Claude, and the member's laptop, asking the same question about the
runner, never saw it as a candidate. Now a **cloud-born** session (`threads.origin` web or
routine) resolves its cloud machine before any other rung, capability unasked: continuity among
cloud machines keeps a thread where its files are, then the chip's pick of a cloud machine, then
the member's own live member machine, else the live runner. The wake's own door
(`host/starterfallback.ts`, already the default on a cloud machine since #547) re-seats a brain
the machine lacks on the NeuraMesh brain and posts the switched card in the thread. A laptop
waits the grace window and steps in only when no cloud machine is awake or the cloud machine
never claimed inside the window. The chip's explicit pick of a laptop stays a designation. A
desktop-born session keeps the table above, capability included: the member's Mac has their
login right there, and moving it to the cloud would spend credits unasked. Continuity to a laptop
no longer pins a cloud-born thread: the next message moves it to the cloud. Units (task claims)
keep the claim ladder, which has no origin: the rung covers conversations.

## The surfaces (mockup.html, sections 1–3)

1. **The machine chip** in the composer's control row — beside `# room` in New chat, beside the
   project and model chips in Code. Reads the machine it would run on and why (`⌂ This Mac` ·
   `☁ Cloud · asleep, wakes on send` · `⌂ mate-mac · shared with you`). Its popover lists the
   machines the member may use (the Compute panel's rows, one line each: glyph · name · owner ·
   state), the default marked, `Auto` first, and a foot line naming the default's source
   ("Sessions you start on this Mac run here · change in Compute"). The `ProjectChip` idiom exactly.
2. **The desktop-only default** — one row in the Compute panel, drawn only by the desktop client:
   "Sessions you start on this Mac run on: **This Mac** / **Auto**". Stored in the member's
   `compute` prefs (`desktopSessions: 'here' | 'auto'`), synced like the rest of it. The browser
   never shows the row and never reads it; a web-started session is never "here".
3. **The Compute panel's rows say the kind**: `this Mac` · `cloud` · `member machine` · `shared
   with you`, so "Cloud machine: awake" cannot name a laptop.

## Slices

Status (2026-09-05, PR #426): **A, B1 and B2 built**; B3 (a) proven for the transport on the dev
stack (a Code thread on This Mac opens through the local lane and reaches the model call — which
the dev workspace's placeholder Anthropic key refuses, so the run pauses there); B3 (c) proven in
the shared ladder tests (`packages/shared/test/compute.test.ts`, "the origin rung") rather than a
pg test — the ladder is pure and the pg inputs (`threads.machine_id`, `threads.origin`) are read
by `wakeGate` exactly as `priorMachineId` is. B3 (b) needs a production build.

**B1 — the desktop app is a Code host (in-process).** Main builds `createClineEngineeringHost`
the way `machined.ts` does, with the app's own credential (the member bearer through
`apiAuthHeaders`), `resolveCwd` preferring the repo's local checkout on this Mac (a worktree per
thread beside it; the cache clone when there is none), the workspace's policy rules, and the
brain resolution the machine daemon uses. Two IPC lanes — `nm:engineering-local-info`,
`nm:engineering-local-open` with events streamed per session — and the desktop bridge gains a
**local lane** beside the relay lane: `engineeringInfo` reports both, `openEngineering(meta)`
routes on `meta.machineId` (this Mac → IPC, anything else → the relay). The coding runtime is a
dynamic import, external to the main bundle, as it is for `machined`.

**B2 — the session as a placement subject.** `threads.machine_id` (designated, nullable) +
`threads.origin` (`desktop` · `web` · `routine`), written at creation from the chip and the origin
client; `thread.set_machine` (HUMAN_ONLY) for a change before the first run. The ladder's
designated rung reads the thread's `machine_id` before the prior run; a new **origin rung** applies
D9's defaults (`desktopSessions` for desktop-born threads; cloud-first for web- and routine-born
ones). `placementFor` grows an `origin` argument so the chip's label and the panel's "runs on"
column are one derivation. Sync rule + client-core schema mirror for the two columns.

**B3 — end to end.** (a) Local, on the dev stack: the desktop instance opens a Code thread on
This Mac against a repo checked out here, sends a prompt, and the Cline run's events reach the
composer — no relay involved. (b) Cloud, on production: the packaged build with the chip on
`☁ Cloud` reaches the member machine through the relay (slice A's lane). (c) Placement: a
desktop-born chat thread with the default on This Mac is claimed by this Mac while the runner is
awake; a web-born thread is claimed by the runner; a routine's thread is claimed by the runner —
each proven by the `runs.machine_id` row, in a pg test of the ladder's inputs and in the harness.

## Assumptions, stated

- "Available machines" = the ones the member may use today (`availableMachines`: their own, and
  those shared with them), online or asleep-but-wakeable. A machine that cannot run the runtime
  is listed with why and cannot be picked.
- The chip designates the SESSION, never the agent: per-agent choices stay in the Compute panel.
- The desktop-only default is per member, not per workspace: "the workspace" in the ask reads as
  "available for the workspace's members", since a laptop is one member's.
- B1 needs a brain on the laptop: the workspace's API key or CLI login, or the metered starter
  brain — the same resolution the machine daemon uses. Nothing new to configure.
- No new machine token: the app hosts Code as the signed-in member. Letting OTHER clients reach
  this Mac (the relay edge with a machine credential) stays out; it is a picker entry that would
  read "not reachable from a browser yet" until it lands.

## Rulings this touches

docs/33 §8 gains the machine chip (a composer chip, the ProjectChip idiom); docs/35 §4.2 the
composer's control row gains its third knob; the shared-compute doc (the ladder) gains D9 and the
origin rung; docs/42 already names the desktop as a relay client. Schema: 0134 (`threads.machine_id`,
`threads.origin`), one sync-rule line, the client-core mirror.
