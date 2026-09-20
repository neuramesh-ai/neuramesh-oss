# Desktop parity ledger

What is live on the hosted surfaces (the browser client at hq.neuramesh.app, the phone) and not in
a published desktop build. [docs/45 §6](45-feature-placement.md#6-the-desktop-parity-ledger) says
when a row opens and when it closes. Newest first.

- **A row opens** in the PR that ships the feature, when its placement says the desktop gets it on
  the next tag, or not at all.
- **A row closes** in the version-bump PR of the desktop release that carries it: write the version
  in the last column. Keep the closed rows of the last two releases, then trim.
- **`not this app`** rows move to the second table with the gate that keeps them out, once.

**Newest published desktop:** v0.144.0 (published 2026-09-20, cut at `4b0f76db`). v0.145.0 is cut
at this PR's merge. Update this line in every version-bump PR.

The raw list since the newest published desktop, from git (the ledger names features, git names
commits, and the two must agree):

```bash
git log v0.144.0..origin/main --oneline -- apps/desktop/src/renderer apps/desktop/src/main packages/shared packages/client-core defaults
```

## Open

| Opened | Feature | PR | Plan | Live on | Desktop needs | Closed in |
|---|---|---|---|---|---|---|
| 2026-09-20 | The plan overlay's Approve fires `task.approve_plan` (it posted a retired question card's answer line, which woke rex and approved nothing) and wears the human-only badge | #576 | fix | web | the same renderer: a fix installed apps need | v0.145.0 |
| 2026-09-20 | The peek of a conversation-born unit shows the unit's own rows again: the plan card with Approve, the claim line, the deliverables (lost in #526, v0.135.0) | #572 | fix | web | the same renderer: a fix installed apps need | v0.144.0 |
| 2026-09-19 | Units follow their conversation: a unit born of a web, phone or routine session claims on the cloud machine (rung 0), and a resume stands down while another awake machine runs the unit | #571 | [rule D9, amended](design/desktop-code-bridge-2026-09/plan.md#the-rule-d9) | cloud (the runner, next release tag) | the laptop half: deferring the claim to the cloud machine, and the resume guard | v0.144.0 |
| 2026-09-19 | Cloud-born sessions run on the cloud machine (rung 0): a web, phone or routine session goes to the cloud machine whatever brain it holds, and the door re-seats it on the NeuraMesh brain | #568 | [rule D9, amended](design/desktop-code-bridge-2026-09/plan.md#the-rule-d9) | cloud (the runner, next release tag) · web · phone (the chip already forecast "cloud") | the laptop half of the ladder: until it updates, an older desktop still claims a web session as the origin and races the runner for the lease | v0.143.0 |
| 2026-09-19 | The GitHub connector: the project's repository readable by its agents through the App (the Connections row, the connect step, the dependency card's Connect GitHub, setup step 5, the three repo tools, the release lane on a cloud machine) | #575 | [plan](design/github-connector-2026-09/plan.md) | web · api · cloud (the daemon's tools and the tick's connector door, by hand pin or the next release tag) | the same renderer rows, the daemon's tools and its gh door: an older desktop shows no GitHub row and its agents keep reading with the machine's gh alone | v0.145.0 |

## Not this app

| Placed | Feature | PR | Live on | The gate |
|---|---|---|---|---|
| | *None yet.* | | | |
