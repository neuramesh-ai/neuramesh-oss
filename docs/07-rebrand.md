# NeuraMesh Rebrand — Ember Weave

Implementation plan for the 2026-06 brand + screen redesign. Source: `design-handoff/neuramesh.zip`
(`design_handoff_neuramesh_branding/`). The handoff `.dc.html` files are **living specs**, not code to copy —
we rebuild in the existing React 19 + Vite renderer (`apps/desktop/src/renderer`).

## Status — COMPLETE ✅ (2026-06-19)

Rebrand + all net-new product/marketing screens shipped, each validated in both themes with screenshot
evidence in [docs/evidence/rebrand/](evidence/rebrand/). Both apps build green (renderer + `apps/web`).

| | Phase | Commit |
|---|---|---|
| ✅ | R1 brand foundation (tokens · Geist · Ember Weave logo · favicon) | `abadd10` |
| ✅ | R2 three-pane shell (icon rail · channel list · Live rail) | `9cd8c5f` |
| ✅ | R3 agent emoji personas + view polish (DiceBear removed) | `bdd7983` |
| ✅ | R4 auxiliary surfaces (login · onboarding · modals · appearance) | `692cbe0` |
| ✅ | F6 upgrade modal + `isCloud` plan-gating (single source) | `d6f24b8` |
| ✅ | F4 A2A marketplace (gated Add) | `2f46976` |
| ✅ | F3 new 5-step onboarding + fan-out reveal | `5b8b6a4` |
| ✅ | F1/F2 marketing site + auth split — **React + Vite SPA in `apps/web`** (founder's choice) | `8295f3e` |
| ✅ | F8 landing loop-orbital motion (reduced-motion safe) | `f8 commit` |

Enabling fixes: Vite pinned to 7 (electron-vite compat) + a reusable mock-`nm` preview harness for evidence.
**Deferred (optional):** F5 full code-viewer file-tree (needs live daemon worktree data; scaffold + diff
cockpit cover reading diffs) · F7 brand/logos reference pages (internal docs; covered by R1 evidence).

## Identity (the new brand)

- **Mark:** *Ember Weave* — two strands crossing into one center node (independent agents → one orchestrator;
  reads as "mesh"). 48-unit grid, stroke `2.7`, round caps, ember node `r=2.9` at the crossing. Favicon cut
  drops the node and thickens stroke to `3.3` (≤32px). One mark only; never rotate/recolor/distort.
- **Wordmark:** one word, camel-cased — **NeuraMesh** ("Mesh" carries the ember accent). Tagline: *Many agents, one mesh.*
- **Type:** **Geist** (display + body) / **Geist Mono** (eyebrows, code, metadata). Self-hosted (local-first, no CDN).
- **Color:** ember-on-cream. Ember `#ec5a32`, ink `#2c2018`, paper `#fbf3e8` (light) / ember `#ff7a52` on `#161210` (dark).
  Full token sets in README §6 → ported to `tokens.css`.

## Sequencing (per founder directive: "rebrand first, build net-new in full after")

**Rebrand phase (R1–R4):** re-skin + redesign the *existing* Electron product to the Ember design language.
**Follow-on phase (F1–F8):** build the design screens that don't exist yet, in full, after the rebrand lands.

Each slice ships with screenshot evidence in `docs/evidence/rebrand/` compared against the handoff screenshots.

### R1 · Brand foundation  *(decision-independent — everything inherits from it)*
- `tokens.css`: re-point themes to ember-on-cream; add new semantic tokens (`--accent-soft`, `--accent-ink`,
  `--warm/--blue/--violet` families, `--shadow`, `--code`). Keep existing token **names** so the 4k-line `App.tsx`
  and 800-line CSS inherit the new palette without a mass rename (lowest-risk, highest-leverage move).
- Self-host Geist + Geist Mono; wire `--fdisp/--fbody/--fmono` (alias existing `--font`).
- `EmberMark` logo component (full + favicon cut + reversals) + `favicon.svg` + app-icon sizes.
- `index.html` title/description/theme-color/og/favicon per README §7.

### R2 · App shell redesign
Adopt the design's three-pane shell: left **64px icon rail** (workspace avatar · 8 view icons · theme + user) ·
channel/people list · main · right **Live rail** (agents · stream · connected machine). Map existing wiring in.

### R3 · Redesign existing views
Threads (primary), Board, Skills, Agents, Library, Memory, Activity — each to its `0X-app.png` screenshot.

### R4 · Rebrand auxiliary surfaces
Login, existing onboarding, modals, appearance/theme picker. Purge any off-brand green/teal remnant.

## Theme strategy (decision)

The brand defines **two** themes (light cream/ember, dark ember). The app currently ships **four**
(`dark`, `light`, `soft-dark`, `cream-oak`) behind a theme picker. We **keep the 4-slot picker** (no feature
removed) but re-point every slot to an on-brand ember value:
- `cream-oak` (light default) & `light` → README §6 **light** tokens (cream + ember).
- `dark` (default) & `soft-dark` → **calm neutral charcoal** (see below).

`'system'` default preserved. `data-theme` on `<html>` unchanged. (If the founder later wants exactly two themes,
collapsing is a one-file change.)

### Calm dark redesign (2026-07-01)

The original dark themes were warm-brown with a saturated ember (`#ff7a52`) used *structurally* — card
hover/open borders, every input focus ring, hover/selected backgrounds, glows. Too loud for a platform
developers live in daily. Both dark slots were re-tuned to **neutral charcoal with faint warmth**, and ember
is now **reserved** for intentional brand moments only (primary buttons, project/account avatars, unread & live
dots, links, active-tab underlines, a 2px active-nav mark, brand tags/badges). The light themes are unchanged.

The reserve is enforced by a small set of **semantic interaction tokens** (defined per-theme): `--ring` (focus /
active border), `--focus-glow` (focus halo), `--hover-border`, `--hover-bg`, `--sel-bg` (selected row), `--sel-mark`
(the reserved ember cue). In the dark themes these resolve to neutral greys; in the light themes they resolve to
the prior accent-tinted values, so light keeps its look. Every structural `color-mix(--accent …)` border/ring/bg
was repointed to these tokens — changing the accent no longer repaints the whole UI.

**v0.7.1 muting pass (2026-07-01).** Follow-up on the shipped v0.7.0: the reserved ember was softened
(`#f0764e → #e27c62`) and the dark role/status palette desaturated (amber `#f0b35a → #d4ac74`, violet
`#a899f5 → #a297cb`, blue `#7aa6e2 → #8aa1c2`, green `#54c08c → #66a583`, plus teal/red/plan) for a flatter,
less-distracting feel — role badges, status chips, and dots read quieter. The amber `.unreadcard` border was
also dropped: the `●` dot alone now signals new activity, so accepted/done cards no longer glow. Soft Dark
mirrors the same muted palette, a touch lighter.

## Token name → brand mapping (values change, names stay)

| Existing | Brand role (README §6) | Light | Dark (calm, 2026-07-01) |
|---|---|---|---|
| `--bg` | paper (app bg) | `#fbf3e8` | `#171614` |
| `--panel` | surface (cards) | `#fffaf2` | `#1e1d1b` |
| `--panel2` | surface2 (insets/hover) | `#f4e7d6` | `#262523` |
| `--border` | line | `#ecdfcd` | `#2a2926` |
| `--border2` | line2 | `#dbc6ad` | `#383630` |
| `--text` | ink | `#2c2018` | `#ececea` |
| `--muted` | muted | `#8a7969` | `#9a968e` |
| `--dim` | faint | `#a8967f` | `#757169` |
| `--accent`/`--teal` | **ember** (reserved) | `#ec5a32` | `#e27c62` |
| `--done`/`--green` | green (synced/success) | `#2f9e6b` | `#66a583` |
| `--orch`/`--warm` | warm (data/warning) | `#e89126` | `#d4ac74` |
| `--prog`/`--blue` | blue (info/testing) | `#4f80c4` | `#8aa1c2` |
| `--review`/`--violet` | violet (fan-out/design) | `#7d6cf0` | `#a297cb` |

New tokens added: `--accent-soft`, `--accent-ink`, `--green-soft`, `--warm-soft`, `--blue-soft`, `--violet-soft`,
`--shadow`, `--code`, `--codeink`, `--fdisp`, `--fbody`, `--fmono`. Calm-dark pass (2026-07-01) added the
interaction tokens `--ring`, `--focus-glow`, `--hover-border`, `--hover-bg`, `--sel-bg`, `--sel-mark`.

## Follow-on backlog (net-new — build in full after R4)

F1 Marketing site (Landing light+dark · Features · The Loop · Marketplace teaser · Pricing) — **OPEN: in-Electron
route vs separate `apps/web`**. F2 Auth split-layout. F3 New 5-step onboarding + fan-out. F4 Marketplace.
F5 Code viewer. F6 Upgrade modal + `isCloud` single-source gating. F7 Brand/Logos internal pages. F8 Motion pass.

## Guardrails
Match colors/spacing/type exactly (hi-fi). Keep identity emoji (agent personas, publisher emoji); decorative UI
affordances are stroke icons. Don't ship the dev screen-switcher or font switcher. Verify **both** themes for every
slice. Evidence (before/after, vs handoff) per slice in `docs/evidence/rebrand/`.
