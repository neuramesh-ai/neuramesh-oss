# Wow-Factor UX Mockups (review-only)

Standalone HTML prototypes exploring launch "wow factors" across the whole NeuraMesh
journey — website → download → first run → daily use. They are **not wired into
`apps/web` or the desktop app**; they exist to review the ideas before deciding what
(if anything) to implement. We may not ship all of them.

Built on the real **Ember Weave** design tokens (values mirror
`apps/desktop/src/renderer/src/tokens.css`), self-contained in `nm.css`, with a
dark/cream theme toggle (◐, top-right) and verified in both themes. No build step,
no dependencies (Geist loads from Google Fonts; degrades to system fonts offline).

## View

Open `index.html` directly in a browser, or serve the folder:

```sh
python3 -m http.server -d mockups/wow-factor 8849
# then open http://127.0.0.1:8849/index.html
```

`index.html` is the **hub** — the strategy write-up plus a clickable gallery of
everything below.

## Contents

| File | What it shows |
|------|---------------|
| `index.html` | Hub: wow-factor strategy + clickable gallery of all 15 ideas |
| `landing-review.html` | **Proposed new landing** — the current marketing page fused with the simulator + breathing board, text trimmed, mobile-first |
| `01-landing.html` | Hero **Live Loop Simulator** (type a request → watch it ship) + breathing board |
| `02-download.html` | Set up *while* it downloads · live install handoff · outbound-only trust diagram |
| `03-onboarding.html` | "Meet your crew" cinematic onboarding (hire a team, not fill a form) |
| `04-first-fanout.html` | Guided 2-minute first fan-out on a sandbox repo (in the app shell) |
| `05-mission-control.html` | Daily command center · Needs-you queue · ⌘K palette · RSI glance |
| `06-review-cockpit.html` | Evidence-first, keyboard-driven PR review (Accept on ⏎) |
| `07-living-board.html` | The FSM board with cards moving themselves in real time |
| `08-decision-inbox.html` | Crisp question cards — unblock agents in seconds |
| `09-rsi-retro.html` | Weekly retro — agents leveling up + the compounding curve |
| `nm.css` | Shared Ember Weave design system (tokens, components, app shell, motion) |

## Status

Exploration / review only. Nothing here is production code. The most "port-ready"
piece is `landing-review.html` (a drop-in rethink of `apps/web` landing).
