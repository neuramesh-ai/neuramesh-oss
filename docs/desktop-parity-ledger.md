# Desktop parity ledger

What is live on the hosted surfaces (the browser client at hq.neuramesh.app, the phone) and not in
a published desktop build. [docs/45 §6](45-feature-placement.md#6-the-desktop-parity-ledger) says
when a row opens and when it closes. Newest first.

- **A row opens** in the PR that ships the feature, when its placement says the desktop gets it on
  the next tag, or not at all.
- **A row closes** in the version-bump PR of the desktop release that carries it: write the version
  in the last column. Keep the closed rows of the last two releases, then trim.
- **`not this app`** rows move to the second table with the gate that keeps them out, once.

**Newest published desktop:** v0.146.0 (published 2026-09-20, cut at `0ae80ade`). v0.147.0 is cut
at this PR's merge. Update this line in every version-bump PR.

The raw list since the newest published desktop, from git (the ledger names features, git names
commits, and the two must agree):

```bash
git log v0.146.0..origin/main --oneline -- apps/desktop/src/renderer apps/desktop/src/main packages/shared packages/client-core defaults
```

## Open

| Opened | Feature | PR | Plan | Live on | Desktop needs | Closed in |
|---|---|---|---|---|---|---|
| 2026-09-20 | The GitHub connector's pick round: the grant is the first move on every door, GitHub's install page is the repository picker, one granted repository attaches itself to the project and several show a pick in the step (the popover, setup step 5, the dependency card), and a local folder as the primary never blocks a read | #585 | [plan §7](design/github-connector-2026-09/plan.md#7-the-pick-round-2026-09-20-the-grant-first-the-repository-comes-back-with-it) | web · api | the same renderer (the step's faces, the pick rows): an older desktop keeps the demand for a GitHub-addressed repository and its "Attach a repository first" note | v0.147.0 |
| 2026-09-20 | Marketing OS desk: the tile's ⋯ opens the full Connections list (Connect in place), the marks' labels flip above the sticky bar and connected marks get theirs back, the credit ring's arc goes green · amber · red by level, the workspace tile's live pulse is gone | #580 | polish | web | the same renderer | v0.146.0 |
| 2026-09-19 | UGC films: the angle card asks the film's length (5 to 15 s on Seedance 2.0, to 30 s on 2.5) and prices it, the film is the script's first N seconds on a clean plate at the high bitrate, and Request changes on a card reads the draft before it rewrites it | #578 | [video rung §8](design/video-rung-2026-09/plan.md#8-lettering-length-and-the-refine-loop-2026-09-19-georges-three-points-on-the-ugc-films) | web · cloud (the runner films and reads drafts, next release tag) | the same renderer (the length row, the labelled control, the facts line) and the daemon's read_drafts + the shared prompt: an older desktop films eight seconds of the hook with the old prompt | v0.146.0 |
| 2026-09-20 | The plan overlay's Approve fires `task.approve_plan` (it posted a retired question card's answer line, which woke rex and approved nothing) and wears the human-only badge | #576 | fix | web | the same renderer: a fix installed apps need | v0.145.0 |
| 2026-09-19 | The GitHub connector: the project's repository readable by its agents through the App (the Connections row, the connect step, the dependency card's Connect GitHub, setup step 5, the three repo tools, the release lane on a cloud machine) | #575 | [plan](design/github-connector-2026-09/plan.md) | web · api · cloud (the daemon's tools and the tick's connector door, by hand pin or the next release tag) | the same renderer rows, the daemon's tools and its gh door: an older desktop shows no GitHub row and its agents keep reading with the machine's gh alone | v0.145.0 |

## Not this app

| Placed | Feature | PR | Live on | The gate |
|---|---|---|---|---|
| | *None yet.* | | | |
