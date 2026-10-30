# Desktop backlog (the desktop parity ledger until 2026-09-26)

Web and phone features that the desktop may take later. Since the hq split (2026-09-26,
the decoupling plan), hq and the desktop are separate
apps, so a row is optional. It records a port that desktop users would want.
[docs/45 §6](45-feature-placement.md#6-the-desktop-backlog-the-parity-ledger-until-2026-09-26) says
when a row opens and when it closes. Newest first. The rows opened before the split still close
with the next desktop tag, because the desktop's renderer copy already carries them.

- **A row opens** in the PR that ships a feature, when desktop users would want it. It is optional.
- **A row closes** in the version-bump PR of the desktop release that carries the port: write the
  version in the last column. Keep the closed rows of the last two releases, then trim.
- **`not this app`** rows move to the second table with the gate that keeps them out, once.

**Newest published desktop:** [v0.156.2](https://github.com/alonge-dev/neuramesh-desktop-releases/releases/tag/v0.156.2)
(published 2026-10-25 at 00:08 UTC, built from `a7eb17bb`, merged in PR #767 as `a592cd33`).
It adds project library and repository access across thread types and streams Gemini activity.
Both signed, notarized architectures passed CLI and SQLite write/reopen checks. Native Intel
validation passed with a 1,521 ms cold start; dark and cream-oak screenshots were inspected.
See the [release validation](design/powersync-retirement-2026-10/desktop-0.156.2-validation.md).

The previous supported published desktop is v0.156.1. Both supported releases use the API
replica. v0.155.1 is outside the supported pair. v0.156.0 was withdrawn after its native SQLite
constructor failure and remains a draft; v0.154.1 is also an unpublished, superseded draft.
Hosted PowerSync remains available for legacy installed clients until the public iOS upgrade
and final consumer checks pass.

The raw list since the newest published desktop, from git (the ledger names features, git names
commits, and the two must agree):

```bash
git log a592cd33..origin/main --oneline -- apps/desktop/src/renderer apps/desktop/src/main packages/shared packages/client-core defaults
```

## Open

v0.156.2 is the second published desktop with the API replica. The supported pair is now
v0.156.2/v0.156.1; earlier desktops receive the existing update notice. The hosted PowerSync
shutdown remains separate from this support-version change.

| Opened | Feature | PR | Plan | Live on | Desktop needs | Closed in |
|---|---|---|---|---|---|---|
| 2026-10-30 | Optional cloud trial activation, the free-local desktop action, and an editable first message on New session after onboarding. Existing free workspaces retain their data and credits. | #777 | [Activation validation](design/trial-activation-2026-10/validation.md) | HQ, API; desktop candidate | Includes the native activation screen, existing Local startup IPC, activation resume, and New session draft. Enforcement stays off until compatible clients and cancellation validation are ready. | v0.157.0 |
| 2026-10-28 | **Agent Desk.** Durable project/agent homes, parallel compact conversations, inline automations/connectors, draggable/resizable cards and custom-agent creation. | this PR | [Implementation and validation](design/project-team-2026-10/validation.md) | HQ web + API + cloud after deployment | HQ has a separate renderer. A future desktop UI port needs the Agent Desk view and bridge; shared routing, compaction and collaboration tools reach the desktop runtime with its next tag. No native UI certification is claimed here. | |
| 2026-10-24 | Shared project library and all attached repositories in normal, marketing and coding threads; live Gemini reasoning summaries and tool steps. | #767 | Project context parity | web, phone update, cloud, desktop | Shared context resolution, bounded repository reads, Gemini conversation streaming. | v0.156.2 |
| 2026-10-23 | Shared SQLite replica replaces PowerSync; preserves queued edits and cached reads across upgrades. File previews, expandable coding activity, and connection/history recovery. | #762 | [Retirement](design/powersync-retirement-2026-10/plan.md) | web, phone, cloud, desktop after rollout | Shared replica, normal API credentials, legacy cache import, native SQLite packaging. | v0.156.1 |
| 2026-10-15 | **Elevated default themes.** Fresh profiles follow the OS with Light or Soft Dark. Saved fixed palettes remain unchanged. | this PR | [Validation](design/hq-subscription-2026-10/validation.md) | web, desktop | Theme resolution, first-paint boot and Appearance copy. | v0.155.1 |
| 2026-10-13 | Saved-model refusals retain an open thread so a new model can be selected. A reload waits for the host recording revision before it restores history. | #722, #723 | [Coding rollout](design/mobile-brain-coding-2026-10/rollout.md) | web, cloud, desktop | Includes the host recovery and renderer restore fixes. The v0.154.1 draft remains unpublished. The replacement also defers the coding runtime probe until Code is requested and includes both native CLI packages. | v0.154.2 |
| 2026-10-13 | **Paper appearance.** Paper Light, Paper Dark, Paper Cream Oak and Paper system beside the elevated themes | #726 design, #727 web, #732 desktop | [paper look](design/paper-look-2026-10/implementation.md) | web, desktop | Includes Paper defaults, all three palettes, Geist Mono, distinct outlined agent marks, muted state colors, Home destination controls, repository footer and thread overview alignment. Native phone themes stay unchanged. | v0.155.0 |
| 2026-10-05 | **The words of a run and a thread.** The typist chip says "rex writes" only while text arrives, "rex is thinking" before it and "patch is at work". The seat chip names the house brain the NeuraMesh brain and wears the house mark, and its hover keeps a person's own model id | (this PR) | [docs/26](26-live-status.md) | web, cloud (the daemon's step words, the claim line and the done-unit wake, the next fleet tag) | the renderer: hq's `thread/typist-words.ts` and its call sites (`thread/parts.tsx` TypistChip, `thread/task/Presence.tsx`, `App.tsx`), `runs/runs.ts` parseSeat, `thread/RunCard.tsx` and the house mark in `ui/icons.tsx` ProviderMark. The shared step words reach the next desktop on their own, and this PR ports what they would break there: the orb's words (`views/SessionList.tsx`) and the ghost's label (`thread/AgentGhost.tsx`). The desktop's own daemon takes the step words and the wake rule with its next tag | |
| 2026-10-02 | **A person's model for each agent.** The brain chip retires for two composer knobs: the model of the agent the composer talks to, and who answers. A pick is the person's own and holds on every interface. Settings › Models, the agent page and onboarding's Team step set the same pick. Automations run on the NeuraMesh brain | (this PR) | [models and replies §4](design/models-and-replies-2026-10/plan.md#4-one-main-agent-a-model-selector-the-crew-boards-d1-to-d12) | web, phone, api (0148, `member.set_agent_model`), cloud (the seat, the next fleet tag) | the renderer: hq's `models/` (the two chips, Settings › Models, the agent field), the Team step, and the retired brain chip in `brain/`. The desktop's own daemon takes the seat with its next tag. Until the port, a pick made on the web still holds for that person on a desktop, because the daemon reads it | |
| 2026-10-02 | **The reply queue, and a routine's replies as the card.** The reply card queues its rows a gap apart, a reminder comes at each time, and Reply on X opens X's reply box with the text in it. A routine that drafts replies says how they go out, and its run's card lands even when the model writes a list | (this PR) | [models and replies §1, §2](design/models-and-replies-2026-10/plan.md#1-the-routine-posted-a-list-boards-a1-to-a3) | web, phone, api (0146, 0147, the `reply.*` commands, the minute pass), cloud (the card guarantee, the next fleet tag) | the renderer: hq's `cards/ReplyOpsCard.tsx` (the queue), `replies/ReminderToasts.tsx` and the routine writer's Replies part. The desktop's own daemon takes the card guarantee with its next tag | |
| 2026-10-01 | **The routine writer.** New routine and New automation open the New session composer with "Make a routine: ". rex asks for what it needs and posts a draft card, and Schedule it arms the routine in that session, behind a divider that folds the setup | (this PR) | [routine writer](design/routine-writer-2026-10/plan.md) | web, phone, api, cloud (the next fleet tag) | the renderer: the doors (the launcher's routine mode, `views/HomeCards.tsx`), the draft card (hq's `thread/RoutineDraftCard.tsx` and `useRoutineWriter.ts`), and the setup fold in `thread/SessionRuns.tsx`. Until the port, the desktop shows the card's block as code and the divider as a plain line. The desktop's own daemon takes rex's two tools with its next tag | |
| 2026-09-30 | **A draft's picture opens whole.** A press on the picture in a draft card opens it in the lightbox, with the hosted full-size copy and Save | #672 | [thread posts §8](design/thread-posts-2026-08/plan.md#8-the-picture-opens-whole-2026-09-30) | web | the same in the renderer's copy of the card: `marketing/SocialPostCard.tsx` and hq's `marketing/DraftImageLightbox.tsx` | |
| 2026-09-30 | **A calmer new session screen, and times in the rail.** The thread list under the composer retires for six cards that start work, the watermark returns, and Porch glances over the greeting. Each rail row says its last activity, and a settled row wears no word | #673, #732 desktop | [home-cards](design/home-cards-2026-09/plan.md) | web, phone, desktop | Includes Home cards, Porch, the watermark and rail times. The routine card opens the native routine form until the routine writer port. | v0.155.0 |
| 2026-09-30 | **The routine prompt stays in sight.** Once the routine card leaves the top of a routine's session, a one-line pin sticks there with the prompt, Run now and Edit. A press on the prompt shows all of it | #670, #671 | [routine sessions, the pin](design/routine-sessions-2026-09/plan.md#the-pin-2026-09-30) | web, phone | the pin in the renderer's copy of the card: hq's `thread/RoutineCard.tsx` and the `.srunpin` styles. The desktop took the card itself in #667 | |
| 2026-09-27 | The plan card's record reads **auto-approved · routine** only when a routine approved the plan. A plan that a person approves in a scheduled draft's session, or on repo work, reads **approved** | #662 | [docs/41](41-plan-first-units.md) §6 | web | the same test in the desktop's copy: `thread/TaskThread.tsx` derives `routineBorn` from the bare `schedule_id`, so it needs `approvedByRoutine` and the schedule facts on its history rows (`sync/ipc/watch-rooms.ts`) | |
| 2026-09-27 | The Skills destination reads packs workspace-wide, like its skills, and names each pack's room when the list spans rooms. Before, it read packs from the room the shell stood in, so every other room's pack skills showed as "not synced yet" | (this PR) | [left-nav](design/left-nav-2026-09/plan.md) §7 | web | the same fix in the desktop's copy: `sync/ipc/skills.ts` takes a null channel, `lib/skillscope.ts`, `SkillsView`'s room chip | |
| 2026-09-26 | The left nav: the shortcuts kicker retired, `New session` in both modes, `Automations` (label), Customizations (Skills · Connections tabs on one page, connectors grouped by purpose), More holds Whiteboards · Files · Code behind the row menu | (this PR) | [left-nav](design/left-nav-2026-09/plan.md) | web | the same rail in the desktop renderer: `shell/navdest.ts`, `shell/NavDestBand.tsx`, `surfaces/CustomizationsSurface.tsx`, the `.navdest` and `.cxsec` styles | |

## Not this app

| Placed | Feature | PR | Live on | The gate |
|---|---|---|---|---|
| 2026-09-25 | R4: a team member's plain shell opens their own machine (promoted to a disk first), and a task's terminal stays on the runner without a promotion | #619 | web · api | the desktop's terminal is local: `machineEnsure` is browser-only, and the desktop only carries the inert `lane` argument |
| 2026-09-20 | The connectors' door reaches the API from the browser client: `/connect/*` is rewritten to the API beside `/v1` and `/auth` (the deployed bundle's API base is empty), so Grant access on GitHub and the social authorizations open the provider, not the app itself, in the new tab | (this PR) | web | the desktop opens the door over IPC with the API's absolute URL: no bundle, no rewrite |
