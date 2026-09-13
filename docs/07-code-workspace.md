# Code Workspace, Repo Connect & Modal Scroll — build plan

Status doc for the multi-slice feature requested 2026-06-21. Updated as each slice lands.

## ⚠️ Direction note (doctrine expansion — surfaced, proceeding per founder request)

The original mockup's "code" screen is a **read-only review cockpit** (diff-rendered, _"editing
lives in your editor"_, terminal tagged _"phase 2"_), and [CLAUDE.md](../CLAUDE.md) /
[docs/05](05-engineering-philosophy.md) say NeuraMesh **"reads, reviews, and runs — never edits."**

The 2026-06-21 request deliberately expands this into a **real code workspace**: browse attached
repos *or any local folder*, **edit files with autosave**, **switch git branches**, and **run a
terminal**. This is a founder-level product-direction change. We're building it as asked; the
read-only per-task *review cockpit* (diff review on a thread) stays as-is — the new **Code** view
is a separate general-purpose workspace. **TODO:** update docs/05 + the CLAUDE.md "code-surface
boundary" bullet once this lands so the doctrine matches reality (don't leave them contradicting).

Local-only & safe by construction: all fs/git/PTY runs on the user's own machine (fits "local
compute, cloud truth"); fs IPC is **root-scoped** (no traversal above the chosen repo/folder);
repo listing uses the machine's own `gh`/`glab` creds (no tokens stored — fits BYO-creds doctrine).

## Slices (vertical, each committed + screenshot-validated, both themes)

- [x] **A — Modal scroll.** ✅ Shared `Modal` → flex column: fixed header (+subtitle) ·
  **scrollable body** · optional fixed `footer`. Project settings + New project use the footer;
  every modal now gets the scrollable body + fixed header (Workspace settings has section-scoped
  inline actions, so no single footer — it just inherits the scrollable body). Verified both
  themes: footer stays pinned while the body scrolls. *(item 3)*
- [~] **B — Connect-repo overhaul + stacking fix + Local.** *(items 1 + new-project)*
  - [x] **B1** (`4292d9c`): schema (`0041` local_path + nullable clone_url), GitLab parse, local in
    repo.link/linkRepo, `nm:pick-folder` IPC, modal-stacking fix (`.overlay.stacked`).
  - [x] **B2a** shared `RepoConnect` (GitHub/GitLab/Local toggle + URL paste + folder-picker card)
    + AddRepoModal redesigned to "Connect a repository" w/ fixed footer. Verified both themes.
  - [x] **B2b** (`85d57bf`) `project` direct-link in repo.link (commands+handler+store+pgstore,
    threaded through nm:repo-add/preload/nm.repoAdd); `RepoConnect` embedded in New project, links
    the repo after projectCreate. Verified in preview.
  - [x] **B deployed + e2e tested**: migration 0041 applied to stack-pg, powersync + control-api
    restarted, desktop rebuilt+relaunched. `repo.link` tested against real Postgres — a **Local**
    folder (clone_url NULL, local_path set) and a **GitLab** URL (gitlab clone) both persist with
    correct project_repos primary flagging. (Native folder dialog is Electron-only → preview +
    standard SDK; the backend path is the e2e-validated part.)
  - ⚠️ Unrelated pre-existing bug surfaced on relaunch: `memory_block refresh` errors because the
    subscription-mode Anthropic cred's Claude token is expired (no refresh) and the memory path
    doesn't fall back to the env API key. Fix = re-login to Claude, or add an env-key fallback in
    the memory client. NOT a Slice-B regression.
- [ ] **C — Repo access & listing.** Searchable list of repos the user can access via their own
  `gh repo list` / `glab` (BYO-creds, no token storage); a "grant access / sign in" CTA when the
  CLI isn't authed; freeform URL paste retained. *(item 2)*
- [x] **D — Code viewer: file tree + fs backend.** ✅ Replaced the stub with `CodeWorkspace`
  (top bar: local-repo selector + "Open folder…" + breadcrumb · left lazy-loading file tree
  `FsNode` · right line-numbered read pane). Root-scoped fs IPC `nm:fs-list`/`nm:fs-read`
  (path resolved + must stay inside root; `.git` hidden, 512KB cap, binary guard). Verified both
  themes in preview; path-scoping security node-tested (../, nested .., absolute all neutralized).
  Reads local repos (`local_path`) or any opened folder. *(remote-repo clone browse: later)*
- [x] **F — Git branch tracking + switcher.** ✅ `nm:git-branches`/`nm:git-checkout` (run the
  machine's git in the root; returns no branches for non-git dirs; surfaces a dirty-tree error on
  checkout). CodeWorkspace shows the current branch as a themed `<Select>` (git-icon) in the top
  bar; switching checks out + remounts the tree + clears the open file; inline error if it fails.
  Verified both themes in preview. (Real git exercised in the upcoming D+F+E deploy.)
- [x] **E — Editor + autosave.** ✅ The read pane becomes a themed monospace `<textarea>`;
  edits debounce ~600ms then `nm:fs-write` (root-scoped, same guard) with a `saving… / saved ✓ /
  save failed` indicator in the file header. Binary + truncated files stay read-only (line-numbered
  pre). Verified both themes in preview incl. the autosave round-trip. *(line-numbered editing /
  CodeMirror = later refinement.)*
- [x] **G — Terminal.** ✅ Reused the existing jailed-task pty stack: added `nm:pty-open` (a pty
  at an arbitrary cwd = the code root, the user's own `$SHELL`, not jailed) sharing the task
  terminal's input/resize/close + data/exit channel; generalized `TerminalView` with a `cwdRoot`
  prop so it's reusable (Phase 2 Terminal tab). CodeWorkspace gets a slide-up `.cwterm` drawer
  toggled by a Terminal button + `Ctrl+\``. Verified both themes in preview (drawer slide + xterm
  mount); real PTY proven by the existing task terminal using the same node-pty spawn.

**User decision (2026-06-21):** complete **all** code-workspace slices B–G — editor + terminal
included (the doctrine expansion is explicitly authorized, no pause) — self-validating each, then
build the **thread panel** (Phase 2 below). **Reuse components across both** (the Diff renderer
and the xterm Terminal are shared by the code-viewer *and* the task panel's Diff/Terminal tabs).

## Phase 2 — Unified task/thread right panel (after B–G)

Collapse the old separate task-details screen into the single resizable right panel with tabs
**Thread** (default) · **Review** · **Diff** · **Terminal**. Review auto-defaults when the task is
`in_review`, showing delivered items / validation artifacts / acceptance criteria / the review
loop (per the attached screenshots). Restyle the in-chat thread digest card to match. Diff +
Terminal tabs reuse the code-workspace components. No more separate full task-details component.

### Research map (App.tsx)
- **TaskThread** (~3067): the resizable right panel (Thread). Props incl. `onExpand` → opens TaskFull.
- **TaskFull** (~1467): the SEPARATE full-screen task-details view to FOLD IN + delete. Sections:
  `.tfbar` · title/desc · Requirements · **Definition of Done** (editable) · **Artifacts /
  Validation artifacts** · **Review audit** (rounds) · **Updates** (thread) · `.tfaccept` footer
  (Accept & merge / Request changes) · PlanReview overlay.
- Reuse: **DiffView** (~1407), **TerminalView** (cwdRoot/openTerminal). Wiring: `fullTaskOpen` /
  `setFullTaskOpen` (~4175), rendered ~5263; `.shell.fullview` (~4604); digest card `.tcard`
  (~4868/4979).

### Slices
- [x] **P1** — ✅ tab bar in TaskThread (`.ttabs`: Thread·Review·Diff·Terminal). Thread = the
  existing thread (safe-additive wrap, unchanged). Diff = `DiffView` of the task's diff artifact;
  Terminal = `TerminalView`(task); Review (basic) = `ValidationCard` + artifacts list + DoD. Resets
  to Thread on task switch (P2 sets the `in_review`→Review default). Verified both themes in preview
  (tabs switch + correct content). TaskFull + expand button kept for now.
- [x] **P2** — ✅ Review tab is now the full surface: meta line (agent · branch · PR · N rounds),
  ValidationCard, **Acceptance criteria** (requirements), **editable Definition of Done**
  (`taskSetDod`), **Validation artifacts**, **Review loop** audit (task events via `taskDetail`),
  + the **Accept & merge / Approve / Request changes** footer (reuses `act()`). Review auto-defaults
  for `in_review`/`done`. Verified both themes — matches the screenshot-2 design.
- [x] **P3** — ✅ deleted `TaskFull` (the whole ~320-line full-screen view) + `fullTaskOpen` state +
  the expand ⤢ button/prop + the `.shell.fullview` rule; task cards now open ONLY the resizable
  panel (no separate full view). Typecheck clean; validated in preview (panel opens beside the
  board, defaults to Review, all tabs work). _(Light follow-up deferred: a cosmetic restyle of the
  in-chat digest card — already functional + themed.)_

**Phase 2 complete** — the unified Thread/Review/Diff/Terminal task panel replaces the old separate
task-details screen, reusing the Phase-1 Diff + Terminal components.

> **Superseded 2026-07-28 (v0.64, [docs/25](25-task-panel.md) §"One view").** The tab strip is
> gone. Two years of surface growth (header toks, inline deliverables per docs/30) made Review and
> Diff re-listings of what the panel already showed, and each one hid the thread to do it. Thread
> is the panel's only view; the Review tab's contents live in the `reqs` and `rounds` drawers; a
> diff opens from the `artifacts` drawer; Terminal is a header pin next to activity. The
> DiffView/TerminalView components built here are untouched — only their entry points moved.

## Key facts (from research)
- Code view stub: `App.tsx` ~4792 (`view==='code'`); rail at ~4410. Project-scoped via `current`.
- Modal: `App.tsx:954`; `.modal`/`.overlay` `tokens.css:573`. AddRepo `App.tsx:1976`, renders
  behind Project settings (both overlays `z-index:100`, AddRepo earlier in tree).
- Repos: `repos` + `project_repos` (`0001_core.sql:66`); `repo.link` cmd
  (`handler.ts:471`); `nm:repo-add` (`sync.ts:523`); `channelMeta.repos` (workspace-scoped).
- Infra ready: `node-pty`, `@xterm/xterm`, `@xterm/addon-fit` installed; `git()` helper
  `agents.ts:79`; worktree clone at `~/.neuramesh/repos/<id>`. No fs-walk / dialog / PTY yet.
- Modals not in old mockup (it's pre-Ember teal) → follow the attached screenshots + Ember tokens.
- **Visibility (Private/Internal)** appears in a screenshot but was explicitly deferred earlier —
  leaving it OUT unless asked again.
