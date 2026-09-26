# Desktop parity ledger

What is live on the hosted surfaces (the browser client at hq.neuramesh.app, the phone) and not in
a published desktop build. [docs/45 §6](45-feature-placement.md#6-the-desktop-parity-ledger) says
when a row opens and when it closes. Newest first.

- **A row opens** in the PR that ships the feature, when its placement says the desktop gets it on
  the next tag, or not at all.
- **A row closes** in the version-bump PR of the desktop release that carries it: write the version
  in the last column. Keep the closed rows of the last two releases, then trim.
- **`not this app`** rows move to the second table with the gate that keeps them out, once.

**Newest published desktop:** v0.150.0 (published 2026-09-26, cut at `a59f1544`). No tag is in
flight. Update this line in every version-bump PR.

The raw list since the newest published desktop, from git (the ledger names features, git names
commits, and the two must agree):

```bash
git log v0.150.0..origin/main --oneline -- apps/desktop/src/renderer apps/desktop/src/main packages/shared packages/client-core defaults
```

## Open

| Opened | Feature | PR | Plan | Live on | Desktop needs | Closed in |
|---|---|---|---|---|---|---|
| 2026-09-26 | The Pro trial: a hosted workspace on the free plan reads "Pro trial", and its Credits view measures the trial's own grant (it printed "480 of 0" with an empty ring) | #620 | [pro-trial](design/pro-trial-2026-09/plan.md) | web · mobile · api (the refusals and the Day-7 email) | the same renderer: the Credits view and the first-run text || v0.150.0 |
| 2026-09-25 | Out of credits says so: the attention bar and the bell show "Out of credits" with Add credits (it opens Credits), and an agent that the NeuraMesh brain refuses for credits replies in the thread with the reason | #616 | fix | web · cloud (the thread notice, next release tag) | the same renderer and the daemon's notice: a fix installed apps need || v0.150.0 |
| 2026-09-25 | A resumed wizard shows the workspace's real name, not a random suggestion ("Crimson Collective has its cloud machine" for "Acme Robotics") | #615 | fix | web | the same renderer: a fix installed apps need || v0.150.0 |
| 2026-09-25 | A reply streams into the thread on the web while the agent writes it: the relay's `stream` lane carries the machine's live bubble to the browser, as deltas, and the tab opens the lane only where the relay names it | #617 | [docs/42, the stream lane](42-browser-terminal-and-relay.md#the-stream-lane-live-replies-reach-the-browser-2026-09-25) | web · cloud (the machine edge serves the lane: next release tag or `pnpm fleet:pin`) · the relay (rolls on merge) | the lane in `bridge/desktop-relay.ts`, so the desktop's Cloud connection streams a reply that a cloud machine writes. A local agent already streams over IPC | |
| 2026-09-25 | A streamed reply renders block by block, reveals at the pace it arrives, and lands in the bubble's slot with no gap. Threads scroll and take keystrokes without jank | #617 | [docs/18 §8](18-performance.md#8-the-thread-render-streaming-landing-and-scroll-measured-2026-09-24) | web | the same renderer: next tag | |
| 2026-09-25 | The web client paints its frame and a working composer before the app loads, boots from its local replica, and opens rooms and threads from indexed queries | #617 | [docs/18 §7](18-performance.md#7-the-browser-replica-measured-2026-09-24), [§9](18-performance.md#9-the-web-boot-measured-2026-09-25) | web | the replica indexes and the needs-you query reach the desktop's replica with the same renderer, next tag. The static shell and the boot order are web only | |
| 2026-09-25 | A reply on the Starter brain and on Claude types itself out while the model writes it: the metered proxy streams, and a watched Claude turn asks for partial messages | #617 | [docs/10 §15.9](10-model-packs.md#159-the-starter-brain-streams-2026-09-25) | api (the stream route) · cloud (the daemon, next release tag or `pnpm fleet:pin`). The web shows it through the relay stream lane | the daemon's streamed doors (`host/starterproxy.ts`) and partial messages (`host/turnkit.ts`), nothing else | |

## Not this app

| Placed | Feature | PR | Live on | The gate |
|---|---|---|---|---|
| 2026-09-25 | R4: a team member's plain shell opens their own machine (promoted to a disk first), and a task's terminal stays on the runner without a promotion | #619 | web · api | the desktop's terminal is local: `machineEnsure` is browser-only, and the desktop only carries the inert `lane` argument |
| 2026-09-20 | The connectors' door reaches the API from the browser client: `/connect/*` is rewritten to the API beside `/v1` and `/auth` (the deployed bundle's API base is empty), so Grant access on GitHub and the social authorizations open the provider, not the app itself, in the new tab | (this PR) | web | the desktop opens the door over IPC with the API's absolute URL: no bundle, no rewrite |
