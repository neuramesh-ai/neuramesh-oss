# Agent Desk real UI evaluations

Run on Node 24 with Ego Browser and an existing isolated local stack with real provider access. The runner refuses non-loopback app, API and database addresses. It creates two fresh projects and three custom agents through the normal UI, preserves existing data, and consumes provider credits. No mock model responses or manufactured collaboration messages are used.

```sh
pnpm eval:agent-desk:test
pnpm eval:agent-desk --run \
  --url "$NM_EVAL_URL" --api-url "$NM_EVAL_API_URL" \
  --database-url "$NM_EVAL_DATABASE_URL" \
  --brain "$NM_EVAL_BRAIN" \
  --workspace "$NM_EVAL_WORKSPACE" --actor "$NM_EVAL_ACTOR" \
  --space 2 --page p1 --out .nm-evidence/team-desk-evals/review
```

Inspect the actual local configuration; those environment variables and space/page IDs are inputs, not defaults. Read the Ego Browser skill, create or resume one owned task space and use an existing managed page. The caller owns its lifecycle and must finish it after inspection. The local QA workspace must allow two more projects under its plan; use a dedicated eligible workspace rather than resetting existing projects. Fixtures use Developer, Architect and Designer roles so an orchestrator’s automatic project membership does not pre-create the isolation fixture. The app/API must support local actor-header authentication; never enable this on production. The database is read for independent evidence only; fixture projects are created through the API and agents/messages through the UI.

The run validates:

1. Normal custom-agent creation retains name, description and instructions, creates/focuses a writable card, and allows model choice. Model-menu Escape closes the menu while preserving focus view.
2. Three independently addressed briefs receive real responses. Persisted run intervals must prove at least two agents actually overlapped; three sequential replies are insufficient.
3. One identity has separate homes across projects, preserves its draft when switching, and cannot read the other project's history through collaboration tools.
4. The lead reads the specialists' briefs, sends work requests, receives two substantive signoffs, and delivers a combined article. The oracle checks server-authored source-thread metadata, correct authors, causal order, bounded handoffs, all required facts, completed runs and a real artifact card. Assistant prose claiming delegation is insufficient.
5. The article opens in the shared right pane. Reload retains home identities, history, owner and model.

`run.json` stores fixture IDs and exact prompts. `evidence.json` stores persisted messages, runs, article content and successful tool receipts from the local brain journal. The oracle requires recorded list/read calls as well as server-authored handoff rows. `result.json`, workflow/final screenshots and `report.html` retain the outcome. Inspect screenshots, write `visual-review.json` with `{ "status": "reviewed", "findings": [...] }`, then regenerate with `pnpm eval:agent-desk --report --out <directory>`. The independent oracle has negative tests for fabricated delegation, impersonation, reversed ordering, sequential runs, early delivery, missing constraints and cross-project leakage.

Every attempt uses a fresh output directory and projects. Preserve failed attempts; a successful retry does not erase an earlier failure. Do not weaken acceptance checks to make a model pass. A timeout remains a failure. `--cancel --out <directory>` stops the driver at its next polling boundary; wait for `active-run.json` to disappear and inspect the recorded home IDs and provider runs separately. Cancelling the browser driver does not stop agents. No automatic publish, repository edit, shell approval or external messaging is permitted by these prompts.

This complements the required simple/medium/complex coding suite in [the coding guide](../coding/README.md); it does not replace it. Connector authentication, native platform certification, long-duration soak and production load require their own release checks.
