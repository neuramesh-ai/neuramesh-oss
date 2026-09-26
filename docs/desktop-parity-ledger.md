# Desktop parity ledger

What is live on the hosted surfaces (the browser client at hq.neuramesh.app, the phone) and not in
a published desktop build. [docs/45 §6](45-feature-placement.md#6-the-desktop-parity-ledger) says
when a row opens and when it closes. Newest first.

- **A row opens** in the PR that ships the feature, when its placement says the desktop gets it on
  the next tag, or not at all.
- **A row closes** in the version-bump PR of the desktop release that carries it: write the version
  in the last column. Keep the closed rows of the last two releases, then trim.
- **`not this app`** rows move to the second table with the gate that keeps them out, once.

**Newest published desktop:** v0.149.0 (published 2026-09-25, cut at `a104128e`). No tag is in
flight. Update this line in every version-bump PR.

The raw list since the newest published desktop, from git (the ledger names features, git names
commits, and the two must agree):

```bash
git log v0.149.0..origin/main --oneline -- apps/desktop/src/renderer apps/desktop/src/main packages/shared packages/client-core defaults
```

## Open

| Opened | Feature | PR | Plan | Live on | Desktop needs | Closed in |
|---|---|---|---|---|---|---|
| 2026-09-25 | Out of credits says so: the attention bar and the bell show "Out of credits" with Add credits (it opens Credits), and an agent that the NeuraMesh brain refuses for credits replies in the thread with the reason | #616 | fix | web · cloud (the thread notice, next release tag) | the same renderer and the daemon's notice: a fix installed apps need | |
| 2026-09-25 | A resumed wizard shows the workspace's real name, not a random suggestion ("Crimson Collective has its cloud machine" for "Acme Robotics") | #615 | fix | web | the same renderer: a fix installed apps need | |
| 2026-09-20 | Scheduled is one nav row (the fold and its child rows retired) and Routines · Calendar are the room tab strip on its page, each tab wearing its count | #593 | [docs/33 §8](33-design-system.md) | web | the same renderer: an older desktop keeps the fold in the rail | v0.148.0 |
| 2026-09-20 | The product shots: a video beat that shows the product names a real image (`SHOW:`), the film cuts to it once it lands, make_product_image shelves one when none fits | #591 | [video rung §9](design/video-rung-2026-09/plan.md#9-the-product-shots-the-real-image-cut-in-2026-09-20) | web · cloud (the runner's gate and tool, next release tag) · api (the cron composes) | the daemon's gate + make_product_image, the shared SHOW parser, the card's facts | v0.148.0 |
| 2026-09-20 | Top dock: the account menu hangs below the row (it opened cut at the panel's edge with the dock segment under the sheet, so a person who docked to the top could not dock back), and the dock is two rows with its context strip again | #587 | fix | web | the same renderer: a fix installed apps need | v0.148.0 |

## Not this app

| Placed | Feature | PR | Live on | The gate |
|---|---|---|---|---|
| 2026-09-25 | R4: a team member's plain shell opens their own machine (promoted to a disk first), and a task's terminal stays on the runner without a promotion | (this PR) | web · api | the desktop's terminal is local: `machineEnsure` is browser-only, and the desktop only carries the inert `lane` argument |
| 2026-09-20 | The connectors' door reaches the API from the browser client: `/connect/*` is rewritten to the API beside `/v1` and `/auth` (the deployed bundle's API base is empty), so Grant access on GitHub and the social authorizations open the provider, not the app itself, in the new tab | (this PR) | web | the desktop opens the door over IPC with the API's absolute URL: no bundle, no rewrite |
