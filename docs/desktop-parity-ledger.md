# Desktop parity ledger

What is live on the hosted surfaces (the browser client at hq.neuramesh.app, the phone) and not in
a published desktop build. [docs/45 §6](45-feature-placement.md#6-the-desktop-parity-ledger) says
when a row opens and when it closes. Newest first.

- **A row opens** in the PR that ships the feature, when its placement says the desktop gets it on
  the next tag, or not at all.
- **A row closes** in the version-bump PR of the desktop release that carries it: write the version
  in the last column. Keep the closed rows of the last two releases, then trim.
- **`not this app`** rows move to the second table with the gate that keeps them out, once.

**Newest published desktop:** v0.139.0 (published 2026-09-19). The tag v0.140.0 is cut at
`0b9de7a8` and its draft is not published yet. Update this line in every version-bump PR.

The raw list since the newest published desktop, from git (the ledger names features, git names
commits, and the two must agree):

```bash
git log v0.139.0..origin/main --oneline -- apps/desktop/src/renderer apps/desktop/src/main packages/shared packages/client-core defaults
```

## Open

| Opened | Feature | PR | Plan | Live on | Desktop needs | Closed in |
|---|---|---|---|---|---|---|
| | *No open rows. The ledger starts empty on 2026-09-19. Everything merged before the ruling was placed on every surface at once and rides v0.140.0, the tag in flight, cut at main's tip.* | | | | | |

## Not this app

| Placed | Feature | PR | Live on | The gate |
|---|---|---|---|---|
| | *None yet.* | | | |
