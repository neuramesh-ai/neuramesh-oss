# Desktop parity ledger

What is live on the hosted surfaces (the browser client at hq.neuramesh.app, the phone) and not in
a published desktop build. [docs/45 §6](45-feature-placement.md#6-the-desktop-parity-ledger) says
when a row opens and when it closes. Newest first.

- **A row opens** in the PR that ships the feature, when its placement says the desktop gets it on
  the next tag, or not at all.
- **A row closes** in the version-bump PR of the desktop release that carries it: write the version
  in the last column. Keep the closed rows of the last two releases, then trim.
- **`not this app`** rows move to the second table with the gate that keeps them out, once.

**Newest published desktop:** v0.141.0 (published 2026-09-19). The tag v0.142.0 is cut at
`9077045b` and its draft is not published yet; v0.143.0 is cut at this PR's merge. Update this
line in every version-bump PR.

The raw list since the newest published desktop, from git (the ledger names features, git names
commits, and the two must agree):

```bash
git log v0.141.0..origin/main --oneline -- apps/desktop/src/renderer apps/desktop/src/main packages/shared packages/client-core defaults
```

## Open

| Opened | Feature | PR | Plan | Live on | Desktop needs | Closed in |
|---|---|---|---|---|---|---|
| 2026-09-19 | Cloud-born sessions run on the cloud machine (rung 0): a web, phone or routine session goes to the cloud machine whatever brain it holds, and the door re-seats it on the NeuraMesh brain | #568 | [rule D9, amended](design/desktop-code-bridge-2026-09/plan.md#the-rule-d9) | cloud (the runner, next release tag) · web · phone (the chip already forecast "cloud") | the laptop half of the ladder: until it updates, an older desktop still claims a web session as the origin and races the runner for the lease | v0.143.0 |

## Not this app

| Placed | Feature | PR | Live on | The gate |
|---|---|---|---|---|
| | *None yet.* | | | |
