# 21 · Dock mini-browser

*Status: shipped (v0.29.0). Owner: desktop.*

## Why

The loop's validate step constantly needs a page on screen — a dev server an agent just
started, the PR a submit opened, the docs a plan cites. Flipping to an external browser
breaks the cockpit flow; the design-review iframes can't show arbitrary URLs (sites send
`X-Frame-Options`/CSP). So the bottom dock's tab model grows a third mode: **browser** —
one real Chromium guest per tab, next to the terminal and the folder editor.

## What

- **A dock tab has one of three modes** — `terminal | editor | browser` — flipped from the
  3-segment switcher in each view's toolbar. The blank tab's empty state offers all three
  (*Open a folder… · Start a terminal · Open a browser*).
- **BrowserPane**: back / forward / reload–stop / mono URL bar / open-in-default-browser
  (`nm:open-external` → `shell.openExternal`) + the mode segment. Page title becomes the
  tab title; the last URL persists in `nm:dockTabs` and restores on relaunch. Guest
  history survives address-bar commits (`loadURL`, never a `src` attribute rewrite — a
  rewrite is a fresh load).
- **Address bar contract** (`normalizeUrlInput`, `@neuramesh/shared`): schemeless domains
  get `https://`; localhost-ish hosts (`localhost`, `*.localhost`, `[::1]`, bare IPv4s)
  get `http://`; anything non-web-navigable — `javascript:`/`file:`/`data:`, bare words,
  multi-word text — becomes a DuckDuckGo search. The bar can never emit a script scheme.
- **DockBar is icon-only**: Editor · Browser · Terminal · Processes (+ the status pill).
  A kind button focuses the most recent tab of its kind (creating one if none — a fresh
  browser opens with the URL bar focused); clicking the kind already front-and-center
  hides the dock, preserving the old Terminal button's toggle muscle-memory.

## Enforced, not prompted (doctrine #4)

The renderer's URL normalization is UX. The boundary is main-side
([browser-guard.ts](../apps/desktop/src/main/browser-guard.ts), unit-tested; wired in
`web-contents-created`):

- `will-attach-webview`: preload deleted (the nm bridge can never reach a guest),
  node integration off, context isolation + sandbox on, non-http(s) srcs refused.
- Guest navigation: http(s) + `about:blank` only — no `file:`, `chrome:`, custom schemes.
- Popups / `target=_blank`: web URLs replace the pane's page (one page per tab),
  `mailto:` hands off to the mail app, everything else is dropped.
- Guests ride a dedicated persistent session (`persist:nm-browser`) — cookies isolated
  from the app's session, surviving restarts.
- Right-click inside a page gets the app's context menu + *Open Link in Default Browser*.

Outside Electron (the `:5199` preview harness, whose mock bridge reports
`electron:'preview'`) the pane degrades to a sandboxed `<iframe>` so the harness stays
screenshotable — detection keys off the bridge, not the user agent (the harness itself
runs inside an Electron-hosted pane). Iframes are framing, not browsing: sites that send
`X-Frame-Options`/CSP (google.com, github.com, …) show "refused to connect" **in the
harness only** — a labeled strip says so — while the real app's webview, being top-level,
renders them fine (`NM_SHOT_URL=https://google.com` captures the proof).

## Evidence

`NM_SHOT_ONLY=browser` (`--shot` harness, dev stack): a local demo server rendered inside
the real webview, both doctrine themes, plus the three-action empty state —
`browser-{dark,cream-oak}.png`, `browser-newtab-{dark,cream-oak}.png`; the run logs
`guest_url` / `allowpopups` / `tab_title` as the wiring proof. Unit: `browse.test.ts`
(shared, address-bar contract) + `browser-guard.test.ts` (desktop, guest policy).

## Deferred

Find-in-page, zoom controls, history/autocomplete, per-pane devtools, download UI
(downloads currently ride Electron's default flow), configurable search engine.

---

## Amended 2026-07-30 — the browser becomes a tab kind

The dock retires ([docs/36](36-workspace-tabs.md)). The browser does not: it moves **up**, out of
the bottom strip and into the workspace tab strip, where it becomes one of four peer kinds
(`conversation · file · terminal · browser`) in the main content area.

**What changes — the container only:**

- **A tab has ONE kind, fixed at open.** The `terminal | editor | browser` **3-segment switcher
  disappears with the dock**, and with it the ability to turn a browser into a terminal by
  mis-clicking. A browser tab stays a browser. What the segment did honestly — turning a *blank*
  tab into something — is the `＋` flyout's job now, and that is a creation door rather than a
  mutation (docs/36 §3.2). The cost is named there: you get two tabs where you used to reuse one.
- **The DockBar's Browser button becomes an opener** into the strip. Its "focus the most recent
  tab of this kind, creating one if none" behaviour survives as the flyout's default; the
  click-the-active-kind-to-hide-the-dock toggle retires with the dock it toggled.
- **A browser tab can finally sit beside something.** It could not before: the dock lives inside
  `.main` with no `z-index` while an open session is an absolute `z-index: 55` sibling, so a task
  or conversation painted straight over it (docs/36 §2.1, [docs/09 §13](09-system-architecture.md)).
- **Persistence is unchanged and is now the reason for a rule.** The last URL still rides the tab
  record and restores on relaunch — `nm:dockTabs` becomes `nm:workspaceTabs`, migrated once.
  Terminals, whose ptys cannot survive a restart, are **dropped** from the restore rather than
  revived empty (docs/36 §3.6). Browsers restore because a URL is a URL.

**What does not change — any of the enforcement.** Every line under *Enforced, not prompted* above
stands verbatim, because none of it is renderer code:
[browser-guard.ts](../apps/desktop/src/main/browser-guard.ts) is wired in `web-contents-created`
and gates `will-attach-webview` (preload deleted, node integration off, context isolation +
sandbox on, non-http(s) srcs refused), guest navigation (http(s) + `about:blank` only), popups,
and the isolated `persist:nm-browser` session. `normalizeUrlInput` still owns the address bar and
still cannot emit a script scheme. **The boundary is main-side; moving the pane between containers
in the renderer cannot reach it** — which is exactly why the guard was put there.

The preview-harness `<iframe>` degradation and its `X-Frame-Options` caveat are unchanged, and so
are `browse.test.ts` / `browser-guard.test.ts`.
