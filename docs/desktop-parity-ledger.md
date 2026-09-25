# Desktop parity ledger

What is live on the hosted surfaces (the browser client at hq.neuramesh.app, the phone) and not in
a published desktop build. [docs/45 §6](45-feature-placement.md#6-the-desktop-parity-ledger) says
when a row opens and when it closes. Newest first.

- **A row opens** in the PR that ships the feature, when its placement says the desktop gets it on
  the next tag, or not at all.
- **A row closes** in the version-bump PR of the desktop release that carries it: write the version
  in the last column. Keep the closed rows of the last two releases, then trim.
- **`not this app`** rows move to the second table with the gate that keeps them out, once.

**Newest published desktop:** v0.148.0 (published 2026-09-20, cut at `37926c77`). v0.149.0 is cut
at this PR's merge. Update this line in every version-bump PR.

The raw list since the newest published desktop, from git (the ledger names features, git names
commits, and the two must agree):

```bash
git log v0.148.0..origin/main --oneline -- apps/desktop/src/renderer apps/desktop/src/main packages/shared packages/client-core defaults
```

## Open

| Opened | Feature | PR | Plan | Live on | Desktop needs | Closed in |
|---|---|---|---|---|---|---|
| 2026-09-20 | Scheduled is one nav row (the fold and its child rows retired) and Routines · Calendar are the room tab strip on its page, each tab wearing its count | #593 | [docs/33 §8](33-design-system.md) | web | the same renderer: an older desktop keeps the fold in the rail | v0.148.0 |
| 2026-09-20 | The product shots: a video beat that shows the product names a real image (`SHOW:`), the film cuts to it once it lands, make_product_image shelves one when none fits | #591 | [video rung §9](design/video-rung-2026-09/plan.md#9-the-product-shots-the-real-image-cut-in-2026-09-20) | web · cloud (the runner's gate and tool, next release tag) · api (the cron composes) | the daemon's gate + make_product_image, the shared SHOW parser, the card's facts | v0.148.0 |
| 2026-09-20 | Top dock: the account menu hangs below the row (it opened cut at the panel's edge with the dock segment under the sheet, so a person who docked to the top could not dock back), and the dock is two rows with its context strip again | #587 | fix | web | the same renderer: a fix installed apps need | v0.148.0 |
| 2026-09-20 | The GitHub connector's pick round: the grant is the first move on every door, GitHub's install page is the repository picker, one granted repository attaches itself to the project and several show a pick in the step (the popover, setup step 5, the dependency card), and a local folder as the primary never blocks a read | #585 | [plan §7](design/github-connector-2026-09/plan.md#7-the-pick-round-2026-09-20-the-grant-first-the-repository-comes-back-with-it) | web · api | the same renderer (the step's faces, the pick rows): an older desktop keeps the demand for a GitHub-addressed repository and its "Attach a repository first" note | v0.147.0 |

## Not this app

| Placed | Feature | PR | Live on | The gate |
|---|---|---|---|---|
| 2026-09-20 | The connectors' door reaches the API from the browser client: `/connect/*` is rewritten to the API beside `/v1` and `/auth` (the deployed bundle's API base is empty), so Grant access on GitHub and the social authorizations open the provider, not the app itself, in the new tab | (this PR) | web | the desktop opens the door over IPC with the API's absolute URL: no bundle, no rewrite |
