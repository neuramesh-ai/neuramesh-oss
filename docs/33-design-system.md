# 33 — The NeuraMesh Design System: tokens, philosophy, and how we design

> **Status:** v1, shipped with the Cabinet-grade revamp (PR #205, 2026-07-27). This is the
> **authoritative visual contract** for every user-facing surface — desktop first, mobile mirrors.
> The living implementations: [tokens.css](../apps/desktop/src/renderer/src/tokens.css) (the styling
> backbone), [client-core tokens.ts](../packages/client-core/src/tokens.ts) (the mirrored THEMES a
> CI parity test enforces), and [mockups/cabinet-revamp.html](../mockups/cabinet-revamp.html) (the
> reference prototype every idiom was settled in). Process rule at the bottom is **non-negotiable**:
> user-facing work beyond a trivial text change gets a design review before implementation.

## 1. Philosophy — calm surfaces, warm chrome, motion that means something

NeuraMesh is a place people *live* during a workday, alongside a team of agents. The design system
optimizes for **calm legibility with warmth** — a workshop, not a dashboard:

- **The work reads like a page.** Content sits on a near-white sheet in comfortable measure;
  display moments (titles, greetings, gates, empty states) speak in serif. Chrome stays out of the
  content's way, on the frame.
- **Warmth lives in the frame and the accents, not in the content ground.** The cream gutter, the
  oak accent, the warm identity tiles — those carry the personality. The surfaces you read and
  type on stay quiet.
- **Elevation over outline.** State changes read as light (shadow, lift, wash), not as louder
  borders. Hairlines define shape; shadow defines importance.
- **Motion is a heartbeat, not a show.** Entrances rise softly and never block; the few constant
  animations (typing dots, the onboarding step ring's halo) signal *something is alive here* and
  are stilled under `prefers-reduced-motion`.
- **One system, four themes.** Cream Oak is the signature; graphite dark, soft dark, and light
  mirror the same model token-for-token. A surface that only looks right in one theme is a bug.

## 2. The frame model (the Cabinet lesson)

The window is a **colored frame** that owns all chrome; content floats on an **elevated sheet**:

- **Frame** (`--win`): the top bar (wordmark, **sidebar-fold pin**, crumb, search pill — and,
  since the shell round, the **ambient utilities**: editor · browser · terminal openers, the
  processes count and the Synced pill, at the right end after ⌘K) and the naked left nav (no
  panel behind it — items sit directly on the frame). Controls live here. The frame is ONE
  surface (the `--band` token was retired 2026-07-28 for exactly this reason).
  ▸ **The bottom dock strip retired** (the shell round, 2026-08-10, George): its whole cluster
  moved to the frame top — the one chrome row that shows on every page — and its ⌘K tile folded
  into the search pill (one palette door). The frame's 38px bottom band went back to the sheet.
  Top-dock mode keeps its own bottom strip, because that mode hides the frame top.
- **The nav folds** (v0.64, amended v0.76): a side dock collapses — the panel stays mounted
  (`[data-folded="1"]` hides its children) so the width animates and the rail's scroll position
  survives. `⌘\` and the frame-top pin fold it from anywhere, and a folded rail is a
  **machine-local preference**, persisted like the theme, never synced. The top dock cannot fold:
  it is a row, not a rail.
  ▸ **Amended (v0.76):** it used to collapse to its own 26px strip (`--navfold-w`, the same
  measure and idiom as marketing's brand rail) because the app gets **one** fold, not one per
  rail. The spine became that strip, so the panel collapsed to **zero**. `--navfold-w` retired.
  ▸ **Amended again (2026-08-16, the shell-simplification round): the spine retired too.** With no
  strip left at that edge there is nothing to unfold *from*, which is the state this clause always
  described as correct: the fold control is the frame-top pin (`.ftfold`) plus `⌘\`, and the frame
  top is the one row that is chrome in every view. The panel still collapses to zero. A fold must
  not cost information, so while folded the pin wears the unread dot (`.ftfolddot`) the spine's
  tile used to carry.
- **The frame has a RIGHT edge tenant: the SIDE DOCK** (rail-ink round 3, 2026-09-04, George —
  Codex as the reference; it was the Workbench from 2026-08-16 to this date). The dock is the
  workspace tab strip's own column (§8, [docs/36](36-workspace-tabs.md)): files, terminals,
  browsers, whiteboards and reviews open BESIDE the conversation, never over it. A second sheet,
  the main sheet's recipe exactly, resizable by the same grip. It is toggled from the frame top's
  side-panel glyph (`⌘J`), because a panel that lives on the frame is toggled from the frame; it
  **unfolds itself when a tab comes to the front and folds when the last one closes**
  (`shell/sidedock-state.ts`, tested), and it stays MOUNTED while it has tabs — the fold is CSS,
  so a terminal's pty and a browser's history survive it. Under 1100px it overlays the sheet.
  ▸ **The Workbench is a CARD inside the sheet** — the open thread's own object, floating at the
  sheet's right edge on the thread's ground (`--card`, the card radius and shadow, the way a
  question card is), with the conversation recentring in what is left. It is toggled from the
  **thread's head** with a glyph of its own (`IconWorkbench`: a sheet with a card inside it; the
  dock-right glyph it used to wear means the side panel now) and by `⌘P`; a room home, which has
  details but no thread head, keeps the toggle on the sheet's head row beside the views menu.
  **When the sheet itself is narrow** — the dock open on a laptop, any window under ~1000px — the
  card floats OVER the thread instead of beside it: a `@container (max-width: 760px)` rule on
  `.main` (a size container), keyed to the sheet's width rather than the window's, because the
  dock is what usually takes the room.
  ▸ **The Workbench still follows the session** (2026-08-17, George): it opens BY DEFAULT when a
  thread is created or opened and slides CLOSED when a task peek docks beside the thread; the
  user's own toggle wins from there until the session or peek changes.
  ▸ **One panel per edge, still** (2026-08-17's amendment, restated): the frame's right edge holds
  the dock and nothing else; the sheet's right edge holds the card and nothing else. What stands
  in for the card while it is shut is a row of toks under the thread head, not a second panel.
- **Sheet** (`--bg`/`--panel`): the content surface — rounded (18px family), shadowed
  (`--shadow-sheet`), holding *content only*. No tab ears protruding above it; lenses and
  segmented controls live inside it.
- Overlays float above everything on the **frosted veil** (`--overlay` recipe:
  `color-mix(in srgb, var(--win) 62%, transparent)` + `backdrop-filter: blur(14px)`), so a modal
  reads as *the room dimming*, not a context switch.
  ▸ **The veil is for a surface you must ANSWER** (2026-08-17, George — amended). It shipped on
  everything, including the overlays that are really just **bigger menus**: search-every-thread
  (⌘Y), add-an-agent, add-a-person, New task / New routine. Dimming the room to show a *list*
  charges a context switch for a glance, and it hides the very thing you were looking at when you
  decided you wanted the list. Those become **popovers** (`ui/Popover.tsx` + `.popsurf`, or
  `Modal anchored` for the compose-shaped ones): they grow out of the control that opened them,
  over a click-catching scrim with **no tint and no blur**, and fold back into it. The bell
  popover was already this shape; it is now *the* shape. The veil stays on a destructive confirm,
  the wizard, the lightbox — where stopping the room is the point.
  ▸ **The anchor is recorded, not threaded** (`ui/anchor.ts`): one capture-phase `pointerdown`
  listener holds the last press, so a popover grows from whatever you actually clicked without an
  `origin` prop on every trigger in the product. A keyboard-opened surface (⌘Y) has no press, so
  callers pass a fallback selector — the control that surface belongs to.
  ▸ **The origin is a BIRTH property, frozen at mount.** `anchorPoint()` reads the last press and
  callers evaluate it during render, so an un-frozen origin makes every click *inside* the surface
  the new anchor — the roster walked down-left one filter click at a time (George, live). Freezing
  it in `Popover`/`Modal` fixes it for every caller at once, and it is the honest semantics: a
  popover grows from where it was OPENED.
  ▸ **Measure with `offsetHeight`, and only after the width is set.** Positioning maths runs in a
  layout effect on the entry animation's FIRST frame, where `nm-grow-in` is at `scale(.94)` —
  `getBoundingClientRect()` returns the transformed box, so the height came back 6% short and the
  bottom clamp let ⌘Y hang below the fold. And a box measured before its width is applied is at
  its intrinsic size; narrower is taller, which is the direction that matters.
  ▸ **A list anchors; a compose surface centres.** Both lose the veil. ⌘Y and the rosters position
  themselves beside their trigger (a 460–720px list reads fine hanging over the sheet); the
  launcher stays centred and merely pivots out of the row you picked, because it is a composer and
  a composer belongs on the measure.

## 3. The three strata (the settled surface rulings)

Every surface belongs to exactly one stratum. Getting this wrong is the single most recurring
defect class (see §9).

1. **Ground** — the sheet: `--bg` (#fbf8f4 in cream — a *whisper* off white, deliberately close).
   Feeds, threads, page bodies. Nothing interactive is ground-colored.
2. **Elevated** — `--card` (#fff) + `--card-border` hairline + `--shadow-card` resting shadow:
   every card, the composer, inputs, modals, popovers. This is the stratum for anything you click
   or type into. Hover on elevated cards = `translateY(-1px)` + `--shadow-lift` — **shadow, never
   a louder border**.
3. **Warm wells** — `--panel2`/`--panel3`: *passive* containers only — identity tiles (avatar
   mounts), empty-state wells, the chint caps above composers, code/quote insets. Never a button
   fill, never a card that hosts controls.

**A transcript is ground, and only what you act on is elevated** (rail-ink round, 2026-09-04,
George — decision D5 = B). Agent prose runs on the thread ground with no box, the way Claude and
Codex set it; the HUMAN keeps the hairline bubble (alignment and the cap still say mine); a card
in an agent message — question, verdict, schedule, plan — is the ONE elevated object there. The
2026-08-06 "every said thing is a quiet hairline card" is retired for agents: a hairline on
`--panel` around prose, with a second hairline on `--card` inside it, was two edges and no
material (trap 12).

Plus one deliberate exception: **selected state** may wear the accent wash (`--accent-soft`) — a
chosen pack card, an active filter. Warm-as-selection is idiom; warm-as-default is the bug.

## 4. Color tokens

Per-theme, defined in `tokens.css` and mirrored in `client-core` THEMES (CI-enforced, §10):

| Token | Role | Paper (reference, the Foundry light since 2026-09-09; Cream Oak keeps its own warm values) |
|---|---|---|
| `--win` | frame / gutter (literal, never an alias) | `#ebe9e6` |
| `--bg` / `--panel` | sheet ground | `#f5f4f2` |
| `--panel2` / `--panel3` | wells (passive) | `#efedea` / `#e6e3df` |
| `--card` / `--card-border` | elevated stratum | `#ffffff` / `#dedbd6` |
| `--border` / `--border2` | hairline / firmer hairline | `#dedbd6` / `#b9b4ae` |
| `--text` / `--body` / `--muted` / `--dim` | ink ramp — **retreated 2026-09-04** (rail-ink round): graphite `#cbcbcb · #a6a6a6 · #848484 · #6a6a6a`, cream oak `#3a2c22 · #5b4c3d · #8b7861 · #a99680`; chrome rests in `--body`, `--text` is for titles and the selected row, `--dim` is decorative (never body copy) | `#3a2c22` / `#5b4c3d` / … |
| `--accent` / `--accent-ink` | oak + text-on-oak | `#834a2b` / `#fff7ee` |
| `--link` | every hyperlinked resource — task refs, file refs, PRs, markdown links | `#9c5730` |
| `--brand` / `--brand-ink` | the Porch mark plus decisive primary actions — **constant `#834a2b` / `#fff7ee` in every theme** | identity, not theme |
| `--accent-soft` | selection wash | oak at low alpha |
| `--hover-bg` / `--sel-bg` | interaction washes — **alpha, never opaque panel steps** | |
| `--ring` | quiet focus ring (≈42% accent) | |
| `--overlay` | modal surface + frosted veil base | `#ffffff` |
| `--shadow-sheet/card/lift/pop` | elevation ramp | |
| `--viz-berths` / `--viz-donors` / `--viz-clones` | **chart-series identity** (worktree-berths round, 2026-08-11) — categorical, fixed order, one hue per entity across every mark (bars, bands, dots, meters) | dark `#5b93d8/#3aa183/#8a7bd9` · light `#2f6fc2/#1b8f68/#5c4ab8` |
| `--viz-score` | **the report score's one hue** (marketing-os round, 2026-08-20) — the ReportCard's dial, dimension bars and trend marks, plus every score chip. Same calibrated blue as `--viz-berths` (pre-validated on the card surface); its own token so score surfaces can diverge without re-skinning a chart series. Never a status hue, never `--accent` | dark `#5b93d8` · light `#2f6fc2` |
| `--term-black` … `--term-bright-white` | **the terminal's ANSI-16 ramp** (terminal-colors round, 2026-08-26) — resolved into xterm's theme per ground: chromatics from the status family, neutrals from the theme's own ink ladder (darks stay soft-status; papers go ink-weight). Desktop-only, so *not* mirrored into client-core THEMES. The terminal also enforces a **4.5:1 contrast floor** (xterm `minimumContrastRatio`): a guest CLI styles for the theme *it* believes in — dark-assuming dim/24-bit output must stay readable on paper, and no palette entry can reach truecolor | ink hues on cream · soft-status hues on graphite |

Rules of use:
- **Ink is grey, not white** (rail-ink round, 2026-09-04 — George: "the Claude grey"). The darks'
  `--text` sits one step under white (`#cbcbcb`, 10.8:1 on the panel) and the papers' `--dim` was
  lifted into AA-large. The larger rule is usage: rail rows, message bodies and meta rest in
  `--body` / `--muted` / `--dim`; `--text` is reserved for titles and the selected row. Reaching for
  `--text` on chrome is the new cream creep.
- **Dark stays achromatic graphite** — no warm tint migrates into dark surfaces (founder ruling,
  v0.47.1). Cream's warmth is cream's alone. **Identity and decisive action are the exception:**
  Porch and true primary buttons ride `--brand`/`--brand-ink` (never `--accent`, which remains
  achromatic for selection/status in the darks) and stay oak everywhere. The small, deliberate
  action islands keep Graphite calm while making the product's primary move unmistakably ours
  (primary-action ruling, 2026-08-30).
- **Status/FSM hues are theme-independent** — board-state colors never restyle per theme.
- **Links wear the theme's own oak, never an imported blue** (ruling 2026-07-28). `--link` is the
  single token behind every task ref, file ref, PR link and markdown link, so it is retuned per
  theme and never overridden per component: `#9c5730` cream · `#8f4f2a` Paper · `#d19a72`
  Graphite · `#d3a07a` soft dark. The dark values are the *deliberate* second warm object,
  alongside the Porch mark — chosen because task refs are scanned, not read, and an achromatic
  link costs that scan in the themes where most work happens.
- Never hardcode a hex in a component; if a needed value doesn't exist, add a token.
- **Chart series wear `--viz-*`, validated, never eyeballed** (2026-08-11): the soft chip hues
  FAILED the colorblind checks as adjacent fills (blue↔violet ΔE 2.3 under protanopia), so charts
  take their own categorical tokens — run the dataviz six-checks validator against the card
  surface per theme before any new series hue lands. Status hues (`--warn` etc.) are never a
  series; text in charts wears text tokens, never the series color.

- **Thread status wears three hues, never a fourth** (the thread-status round, 2026-09-08): a
  thread is `needs you` · `in progress` · `settled` (`shared/threadstatus.ts`, one derivation for
  every surface). `needs you` = `--warn`, the attention hue the bell's count already wears;
  `in progress` = `--prog`, the build leg's hue; `settled` = the quiet chip (`--panel3` on
  `--border2`, `--muted` ink). The chip says whose turn it is; the dial keeps the phase. Desktop:
  `.chip.st-*`; phone: `status-chip.tsx`. **Every needs-you mark wears the same amber**: the rail's
  and the scope row's ask dots and the overlay row's ask pulse left `--accent` for `--warn` in the
  same round, so one hue means one thing on every surface. The overlay row leads with the phase
  dial in the state's hue (`shared/dial.ts`, the phone's ring). **Settle reveals on hover or keyboard
  focus** on the desktop (the bell row and the overlay row, quiet mono text at the trailing edge),
  and its seat stays reserved so the row never jumps when it appears (George, 2026-09-08). In the
  rail (amended by the settle round, 2026-09-09) the row **wears the status word itself**, in the
  one trailing slot — `.navhiststat`, the same `st-*` palette at rail scale, lowercase because the
  rail's other mono ink is. The bell's
  rows carry no extra mark; the badge already says every row there needs you. The needs-you rows carry NO buttons — approvals live on
  the artifact in the thread, a merge happens on the human's word, and the row's one act is Settle
  (a swipe or a long-press on the phone, a hover control on the desktop).

- **A control exists only where it can act, and a rare reverse is an undo, not a control** (the
  settle round, 2026-09-09, George: "not sure what bring back means" → "not sure we need the back
  to needs you button"). Two halves, both load-bearing. *Exists only where it can act:* the settle
  control comes from `canSettle`, which asks whether the stamp would move anything, so it is ABSENT
  on a row it could not change — reading a control's label off a DERIVED WORD instead of off the
  act is the defect this rule prevents, the same class as the Files `promoted = 1` filter and the
  Calendar's `kind = 'marketing'` gate: a surface stating something the data does not support.
  *A rare reverse is an undo:* `Bring back` had a seat on four surfaces for an act taken almost
  never, and every seat had to explain a state the row was not showing. It became **one Undo on the
  settle toast** (`.nmtoastundo`, 5.2s, spent when taken) — the phone's model. The test for any
  reverse act: if the forward act is common and the reverse is not, the reverse belongs in the
  seconds after the forward one, not in the furniture.

## 5. Type

- **The Foundry type system (2026-09-09, George: "the complete thing")** — the app wears the
  site's faces. `--fdisp` and `--fbody` are both **NeuraMesh Sans** (the house face, 2026-09-11:
  `packages/fonts`, a renamed build of Geist 1.800 under the OFL with the outlines untouched, so
  the rename moved no pixel): display moments (page titles,
  greetings, gate-card headlines, wizard steps, modal titles) at **weight 500**, tight leading,
  `-0.02em` (`-0.03em` at 32px and above). **The two display moments a visitor meets first sit one
  step bigger and one step tighter** (the font round, 2026-09-11: the site hero
  `clamp(37px, 3.7vw, 53px)` at `-0.05em`, the Home greeting `.stagehead` 29px at `-0.03em`, its
  question wrapped as one unit). Measured against
  Anthropic Sans's Display cut on the same hero, the reference title was 6% WIDER than ours at equal
  tracking, not tighter: its Display optical size draws bigger capitals with less air between them.
  Tightening tracking alone walks away from that. Size up first, then tighten, and the ink width lands
  within a pixel (419 vs 420 css px). UI text at base **14px** (the body wore 13.5 until
  2026-09-12, when George read the rail beside Codex's and asked for a step: body, the rail's rows and
  items, the ledger and ⌘Y rows, the session rows, the composer and thread prose all sit at 14 now, the
  snippets at 12 to 12.5, the mono kickers at 10, the status chips at 9.5 to 10.5), controls 11–13px, weights
  500 for labels and 600 for emphasis (the 700/800 cuts retired). `--fital` survives only as an
  alias of NeuraMesh Sans so no selector breaks; the serif display and the Instrument Serif italic
  are gone from the bundle.
- **Mono** — **Geist Mono**, the one mono for buttons, kickers, tags, code blocks and the terminal
  pane. Labels are ALL-CAPS at 10–12px, weight 500, **tracked tight (`-0.02em`), never
  letterspaced** — the site's label voice. Section eyebrows (`STEP 2 OF 5`, `CHANNELS`) and every
  button label wear it.
- `--fbrand` — **Bricolage Grotesque**: the `neuramesh` wordmark ONLY (600, −0.015em, ink
  `--text`, always lowercase — "NeuraMesh" is retired from chrome copy). Never body text.
- Fonts are **bundled**, never fetched: the sans from `@neuramesh/fonts` (five unicode-range
  woff2 faces and their CSS, generated by `scripts/build.py`, every file checksummed in a manifest
  its test holds the repo to), the mono and Bricolage from fontsource. **The phone bundles the same
  two faces** (the mobile Foundry round, 2026-09-09: the package's static cuts
  `NeuraMeshSans-{Regular,Medium,SemiBold}.ttf` · `@expo-google-fonts/geist-mono`, three cuts each
  at 400 · 500 · 600, registered through `expo-font` before the splash hides, so the first paint is
  never a system-font reflow). `client-core` `TYPOGRAPHY` names them (`NeuraMeshSans` · `GeistMono`)
  and the phone's `src/type.ts` picks a face + weight from it — expo-font registers each weight as
  its own family, so `F.body(600)` is the family name, never a `fontWeight`. `F.display()` is
  NeuraMesh Sans 500 and
  `F.tight(size)` is the -0.02em tracking as px; `R` is the radius ramp below, read from the desktop's
  `--r-*` tokens by `test/type-ramp.test.ts`, which also refuses a `fontWeight`, a system
  `'monospace'`, an italic and any positive `letterSpacing` in a screen. Serif and JetBrains Mono
  left the phone with the desktop. Bricolage stays desktop-only: the phone's wordmark is the Porch
  mark, never text.
- **The house face has rungs** (the font round, 2026-09-11). Rung 1 is the rename: the name, the
  license lineage (Geist is OFL 1.1 with no Reserved Font Name, NeuraMesh Sans reserves its own)
  and the pipeline are ours, and the credit stays inside the font (name IDs 0, 9, 10 name Geist on
  purpose, nothing else does). Rung 2 redraws from Geist's published sources: the figures, the
  operator and punctuation set, and a few letters (g J W Q @ &), plus a Text/Display optical-size
  axis. That is exactly how Anthropic Sans was made from the same base (its name table credits
  "BSPK x Geist x Anthropic"), measured in [the round's plan](design/neuramesh-sans-2026-09/plan.md).
  Geist Mono stays until a mono rung is scoped. Nothing downstream moves between rungs: same file names, same CSS, same manifest.
  **The reading step (same day, George: "same size and height" as the Claude app, in NeuraMesh Sans):** the
  transcript and the composer tried **16** for an evening. The transcript sits at **14 / 1.55** and the composer at
  **14 / 1.5** since that night
  (George: the user bubble must read at the same size as the agent text, and 16 read too large). An old rule had pinned
  agent paragraphs at 13.5 through every type step while the human bubble moved, so the two authors drifted apart.
  One rule sizes both now, and it can never happen again. Measured from the claude.ai stylesheet on
  2026-09-12, not remembered: the message body class is 1rem at 1.5, the transcript text setting runs
  13 · 14 · 16 with 14 as the default (so 16/1.5 is its large step), and the Claude design system's UI ramp
  is caption 11 · footnote 12 · code 12 · body 13 · heading 14 · title 20, which is why the rail and the
  lists stay at 14 and only the reading surfaces move. The rule is scoped to the message body itself
  (`.msg > .body > .md`, code 13, h1 20/1.4, h2 18/1.35, h3 16/1.35, tables 14), so the cards a message
  carries and every other `.md` keep the 14px UI step, and `.cbox textarea` + its `.chl` mirror it.
  **The rail reads at the list size, 14** (George, the same night, after an evening at 16: "the left nav text is too
  large, make it the same size as the main home threads"): thread titles 14/450 in 30px rows, shortcuts and New chat
  14/500 in 32px rows, folder names 13/400 in 28px rows, the Chat · Code segment 13, the workspace foot 12.5, the
  kickers 10px mono. The 320 default width stays. The reading step is for the text you read, the transcript and the
  composer, and a list is not that: the rail, the Home threads, the ⌘Y overlay and the task panel all sit at 14.

## 6. Shape

Radius scale (the Foundry ramp, 2026-09-09): **3 · 4 · 6 · 8** (`--r-xs`…`--r-xl`, with `--r-xl` and
the sheet both at 8 since George's read of the first pass: a 12px tier still read as the old rounded
corners next to 3px buttons). Controls at 3, inputs and menus (the composer included) at 6, cards,
panels, modals and the sheet at 8. Nothing user-facing exceeds 8px except what must be round. **Buttons are 3px blocks in mono uppercase**
(`--r-pill: 3px`, the shape of every single-line control that used to be a pill): primary = brand
fill + brand-ink with the static diagonal hatch that slides on hover; secondary = elevated card +
`--border2` hairline; ghost = transparent + hairline. `--r-full` (999px) stays for what must be
round: dots, count badges, rings, grip bars and the round send button. Inputs are 3px with a
`--border2` hairline that turns `--text` on focus.

**A pill is for a SINGLE-LINE control.** A button that carries a second, explanatory line — a
decision button on a card, where the sub-line says what the choice costs — is a **block**:
`btn block` (`--r-lg` + `11px 16px`). At two lines a `--r-full` corner resolves to a ~20px
lozenge that stops reading as a button, and `.sm` padding leaves it cramped rather than spacious;
the block shape keeps it large and lets the corner match the card it sits in. The capacity
failover card (docs/22) is the first of these. Reach for a block only when the sub-line is doing
real work — if it is decoration, drop it and keep the pill.

## 7. Motion

- **Signature ease:** `cubic-bezier(.22, 1, .36, 1)` (`--ease`) — everything uses it.
- **Durations:** enter `.22s` (non-blocking — content is interactive during entrance), exit
  `.13s`, micro-interactions `--dur-fast`. **Blocking transitions respect the ≤150ms budget**
  (doctrine §2 — budgets are bugs when missed).
- **The entrance idiom:** `nm-rise` (fade + 7px rise). Lists and card grids stagger children a
  beat apart (≈50–60ms). Each wizard/page step rises title → subtitle → cards.
- **On the phone the same idiom is `Animated`**, not CSS: fade + 7px, `.22s`, `Easing.out(cubic)`,
  `useNativeDriver`. The rule that carries across is the one people notice, so
  `AccessibilityInfo.isReduceMotionEnabled()` stills it and the card simply appears. First used by
  the Code composer's attach-a-repo card (the mobile fix round, 2026-09-06).
- **Column hand-offs are one gesture, and they are slower** — `--dur-studio: .42s`, a deliberate
  deviation from the `.22s` entrance, recorded here per §11.5. When a whole column of the sheet
  changes hands (the Design Studio opening, expanding, closing), .22s reads as a jump-cut rather
  than a movement. It is non-blocking — the thread stays interactive throughout — so the ≤150ms
  budget, which governs *blocking* transitions, does not apply. Two rules make it feel like one
  object rather than two coincidental animations: **animate a single number** (the studio's
  `flex-basis`; the neighbour is `flex: 1` and absorbs the difference, so their widths sum
  constant frame to frame), and **lay the incoming panel out at its final width from frame one**,
  clipped by the growing column — animating the column alone re-wraps every line inside it sixty
  times a second. Never transition `display`; that is an instant cut with extra steps.
- **Exits are guarded:** `animationend` handlers must check `e.target === el` (bubbled child
  animation events kill exits otherwise), and exit paths need a ~220ms timeout fallback so
  reduced-motion never strands an overlay.
- **Constant motion is rationed:** typing dots (`nm-dot`), the step ring's orbiting halo — one
  heartbeat per surface, always stilled by `prefers-reduced-motion`.
- **Agent liveness is a thinking orb — the standing ruling (2026-08-06).** Any surface that
  shows an agent *thinking or working* uses a [`thinking-orbs`](https://github.com/Jakubantalik/thinking-orbs)
  dotted orb, never a generic spinner: the state IS the animation, so "what is it doing" reads
  before a single word does. Wrap it in the app's `<Orb state size label>` (App.tsx) — the
  wrapper pins the library's theme from our `data-theme` via `useOrbTheme`, because our
  attribute carries theme NAMES (`cream-oak`), not the `dark|light` the library detects.
  The state map is settled; extend it here before inventing a new pairing:

  | moment | orb state |
  | --- | --- |
  | writing the reply ("composing…") | `composing` |
  | tool burst (checks / files / commands) | `working` |
  | search tools · deep-work research legs | `searching` |
  | fanning out subagents | `weaving` |
  | review verdict · plan judging | `solving` |
  | waiting on a human card | `listening` |
  | designer at work | `shaping` |
  | idle presence (the "is thinking" footer, rosters) | `breathing` |
  | connector / A2A call | `connecting` |

  Rules: **inline scale (`size={20}`) only** for now — 64 is reserved until a surface earns it
  (§11.5 records the deviation when one does). ▸ **First earned 64** (George, 2026-08-11): the
  footprint view's measuring state — a full destination waiting on a real seconds-long disk scan,
  where a 20px inline orb would read as an afterthought. `searching` state, muted one-line caption
  below, still one orb per surface. Strictly monochrome — an orb never takes an
  accent. It rides *beside* identity, never replaces the avatar (the agent's face is who; the
  orb is what). The library stills to a representative frame under `prefers-reduced-motion` and
  pauses offscreen — do not re-implement either. One orb per surface, same as every heartbeat.
- **Streamed prose types in; everything else lands whole.** Agent reply text reveals by
  word-burst (~4 words/frame, `useTypewriter`) with the shared block caret (`.tcaret`) — the
  same caret the ghost's plan line uses; one cursor idiom everywhere. Three hard rules: the
  reveal follows the live stream and a **done message mounts instantly** (scroll-back and
  reload never animate); **cards, files and run trees never type** — only prose; reduced
  motion gets instant text.
- **The launch moment (Porch):** full Peek (~3s) once on first open, the short wake (~0.9s)
  every launch after (`LaunchPeek`, replayable from Appearance). It plays over the frame on
  `--win`, `pointer-events: none` — the animation may never gate input — and reduced motion
  skips it entirely. The chrome's one heartbeat is the top-bar mark's one-shot blink: window
  refocus (30s throttle) · once per ≥4-min idle stretch (suppressed while a gate card is
  docked) · lockup hover. Home's caught-up peek fires only when the needs-you queue *drains*.

## 8. Component idioms

- **Cards** — elevated stratum, hover lift (§3). Board cards, Home attention cards, provider
  cards, crew cards: one recipe.
- **The setup tracker** (2026-08-28 — the cloud-first round; visual contract
  `mockups/starter-brain-and-credits.html:310-328`, placement A) — a workspace's remaining
  first-run steps are a **floating card, fixed bottom-right**, mounted once on the FRAME beside
  the Workbench and portalled to `<body>`: `.setupdock` (fixed, 16px in from both edges, z-55) →
  `.setupcard` (290px, `--r-lg`, `--shadow-sheet`) → a progress ring + title + `done/total` mono
  count + fold and dismiss controls, then one `.setupti` per step (15px check box · label ·
  a `--link` verb). It **collapses to `.setuppill`**, ring + title + count.
  ▸ **This is the ONE floating frame tenant, and it was granted deliberately** (George,
  2026-08-28). The shell has no universal bottom-right slot — `.dockbarproc` mounts only in
  top-dock nav mode and the bottom dock strip retired with the shell round (§3) — so this idiom is
  minted here rather than inherited. It was granted for one reason: an in-room card scrolls away,
  and a user who ignores a checklist once may never see it again, which is precisely the failure a
  tracker exists to prevent. A floating layer that survives every screen is a claim on the whole
  shell; **a second one needs its own ruling**, not this precedent.
  ▸ **Order is the argument, so it never sorts by state.** It leads with what is already DONE (the
  cloud machine — "a gift received, not a chore"), then the asks in the order they matter, and the
  optional one last. Floating done rows to the bottom would destroy the reading; `data-done` only
  changes how a row looks (a `--green` box + ✓, `--muted` and struck through), never where it sits.
- **The first-run stack card** (2026-09-12 — the source-release round, U3a; visual contract
  `docs/design/oss-release-2026-09/A1-NoEngine … A6-Update`) — Local mode's stack states before the
  shell exists: the runtime picker, the install, the engine starting, the download, the stack
  starting, the update. A **card on the FRAME**: `.lsgate` is `--win` edge to edge with only the
  wordmark in its top row, and `.lsgcard` (460px, `--card`, `--r-lg`, hairline, `--shadow-card`)
  centres on it — the elevated stratum with nothing between it and the frame, because no sheet
  exists yet to float on. One recipe for six states: mono kicker (`.lsgkick`, 10px uppercase) →
  20px/500 title → one 14px sentence → the body rows → `.lsgacts` (mono uppercase 3px buttons) →
  `.lsgfoot` (one hairline, one mono fact). Body rows are three shapes and no more: a **download row**
  (`.lsgprow`: name · pinned size · a 4px bar that is bytes over total), a **status row**
  (`.lsgsrow`: name · `READY` in `--green` or a warm `.lsgwait` dot + `PLEASE WAIT…`, the install and
  engine cards) and the **chain row** (`.lsgcrow`, below, the stack card). The picker's
  rows (`.lsgrow`) are the settled radio idiom: hairline, hover lifts, the chosen one wears `--sel-bg`
  (§3's one exception).
  ▸ **The stack card is the CHAIN, and the card wears the mark** (the first-run round, 2026-09-18,
  George: B, `--term-red`, no foot line, the mark back, "NeuraMesh is starting up…" — visual
  contract `docs/design/first-run-stack-2026-09/`, evidence beside it). The picker's radio column
  becomes the status column: one 18px node per container in BOOT order (Postgres, then the API,
  then PowerSync — the order `depends_on` runs, which the old list did not follow, so a person
  watched the middle row wait for a container that was never asked to start), name · one fact on
  ONE line (`.lsgcname`), and a 1px segment that lights `--green` once the node above it is ready.
  Four node states and no words but one: ready = `--green` filled with a check · starting = an
  `--accent` dot under the wizard's dashed halo (`ob-ringspin`, the one constant motion that means
  alive, stilled under reduced motion) · queued = a `--border2` ring, the name in `--body` ·
  stopped = `--term-red` filled with a cross plus the mono word `stopped` at the right, the one
  word a failure earns. The chain shows the order, so the sentence about order died and the "ports
  open on 127.0.0.1 only" foot went with it: the card says what it is (three containers) and how
  long (under a minute). The title keeps George's splash wording, "NeuraMesh is starting up…", a
  recorded exception to STE's no-`-ing` rule for this one display moment. The Porch mark sits at
  the card's top (`.lsgmark`, 40px) on EVERY gate state: it plays the launch grammar once at mount
  (the `.launchpeek.full` timings, so the two never drift into different characters) and then
  glances left and right every 9 s while the person waits (`lsg-glance`, no fill so it stays
  silent until the first look has played).
  ▸ **The failure card has three parts, or one.** The cause in plain words (`.lsgcause`, 14px
  `--text`: "PowerSync stopped 3 times.", "Port 58081 is in use by another program."), the
  container's own last line in a warm well (`.lsgwell`, `--panel2`, mono 11, three lines then a
  clip, selectable), and the remedy (`.lsgremedy`, 13px `--muted`: what Try again will do). `COPY
  DETAILS` puts the three lines on the clipboard, as a quiet button at the right of Try again ·
  Quit. An error with no diagnosis (Colima did not start.) keeps the two-line card: the well and
  the remedy draw only when main sent them. Main decides here too: the driver reads each
  container's status, exit code and restart count every poll, so a crash loop ends the wait in
  seconds with the container's own words instead of a 90-second "not healthy", and Try again
  recreates the container that failed (a wedged container with its config intact survived every
  retry before this, `main/localStack/index.ts`).
  ▸ **The first-run DOORS come before the stack** (2026-09-19, George, a blocker: a fresh install had
  walked an existing customer into the local wizard; visual contract
  `docs/design/first-run-doors-2026-09/`, evidence beside it). On a fresh profile (no stored
  session, no chosen connection, no local `.env`, no server added) the first screen after the splash
  is the same card: kicker FIRST RUN, "Where should your workspace live?", "Pick one now. You can
  upgrade to the cloud at any time.", two picker rows in the runtime picker's radio idiom with a
  glyph between the radio and the name (`.lsgglyph`: IconMachine, IconCloud; `.lsgrow.place` narrows
  the name to 84px so the fact keeps two lines): **This Mac** · "No account. Three containers on
  this Mac. Your keys stay here." (preselected) and **The cloud** · "500 free credits to start. Sync
  across desktop, web and mobile.". Both free, so no tags. `CONTINUE →` primary, `SIGN IN` a
  secondary at the row's right, foot "Have an account? Sign in opens neuramesh.app". Nothing
  downloads and no container starts until a row is chosen. The wait while the browser finishes
  ("Finish in your browser" · one status row `neuramesh.app · please wait…` · OPEN THE PAGE AGAIN ·
  CANCEL), the expired card ("The browser did not finish." · TRY AGAIN) and the error card reuse the
  failure card's three parts. Main decides (`main/firstrun.ts`): which page opens, when the wait
  expires, where the shell lands.
  ▸ **Bars, never a clock.** A download that has not announced its total draws an idle track, not a
  guess; "About 900 MB" appears only once every total is known, as a number the card was handed.
  ▸ **The card draws, main decides.** Every string, which state blocks the screen, and the MB figure
  arrive in the IPC payload (`nm:local-stack`), so the renderer holds no rule that can drift from the
  driver. On a warm boot the two waits (engine starting, stack starting) do not take the screen: the
  shell renders from the replica and the sync mark says so (review F9).
  ▸ **The sync mark on a local connection reads its word**: `.livepill.loc` grows from the 26px
  square to glyph + `LOCAL`, one mono kicker (A5). The foot wears the connection's glyph
  (`.navwsconn`: the laptop on local, the cloud on cloud), and the credit ring draws nothing there —
  a meter that cannot read renders nothing (review F13).
  ▸ **An item you cannot finish here asks for a code, not a click.** The phone is the one step you
  cannot complete on the device you are reading the tracker on, so its row reveals a **QR to the
  App Store** rather than a link that opens on the wrong machine (the link and a copy-link stay
  for someone already holding the phone). The code is drawn on a **white plate in both themes** —
  a scanner wants dark modules on a light ground, and a code that inverts with the theme is a code
  half the audience cannot scan. Store links carry **no country segment**, so Apple sends each
  visitor to their own storefront.
  ▸ **The corner sets the copy.** 290px holds a label and a verb, not a sentence — the cards'
  detail prose survives as the row's `title`, not as visible text. A floating surface earns its
  place by being glanceable; prose in a corner is neither read nor dismissed.
  ▸ **Four ways out, and only two are clicks.** Every step done · nothing knowable · dismissed ·
  folded to the pill (dismiss and fold are separate machine-local watermarks, the attention bar's
  idiom — there is no row to dismiss, because the items are DERIVED). A setup tracker that
  outlives setup is clutter, so completion is the intended exit.
  ▸ **A tick is a claim; make it only from a lane you can read.** Item state is
  `true | false | null`, and `null` (this client could not READ the signal — not "nothing is
  connected") renders **exactly like an open step**. Reading a
  missing lane as an empty one would tell a cloud-first user "no cloud machine" about the machine
  the wizard provisioned for them one screen ago; and a false tick is the one error a checklist
  never recovers from, because the human never sees the ask again. When NOTHING is knowable the
  tracker does not render at all. Both clients serve every lane — the desktop over IPC, the
  browser from `webnm-rows.ts` — because the browser is the client this surface was designed for.
  ▸ **It is not needs-you.** It needs the human but is not work, so it never joins the bell's
  count (§8, "a notification is not a destination").
- **The Upgrade to Pro sheet** (2026-09-12 — the source-release round, U3a; visual contract
  `docs/design/oss-release-2026-09/C1-UpgradeToPro`, `C2-UpgradeWaiting`) — ONE surface with three
  doors (the server's `PLAN_LIMIT`, Settings › Connections, the rail's foot), opened through one
  module-level opener (`lib/toast.ts openUpgrade`). The `.upmodal` recipe re-cut: 620px on the overlay
  stratum (`--overlay`, `--card-border`, `--shadow-pop`, `--r-lg`), a mono `--dim` eyebrow, a 20px/500
  display title, one 14px sentence, then **two elevated plan cards** (`.upcard`: `--card` + hairline +
  `--shadow-card`, a 30px `--panel2` glyph mount, 22px price with its unit in `small`, dot bullets) and a
  **foot** (`.upfoot`: hairline above, the two block buttons, one `.upmono` fact). The waiting card
  (`.upmodal.wait`) is 460px and centred: a still dotted ring (`.upwaitorb`), the title, the sentence,
  `Open the page again` and a quiet `Cancel`.
  ▸ **Free is your Mac, Pro is the cloud.** The Free card says what stays, the Pro card says what the
  cloud adds. No trial, no card in the app, no per-reply price anywhere (the credit ring's rule, held).
  ▸ **A wait is a state, not a spinner.** The dotted ring does not turn: a clock would promise a
  duration nobody knows. The sentence names the budget (fifteen minutes) and the browser it waits on.
  ▸ **The sheet never shows on a Pro cloud connection.** There is nothing left to buy there; a door
  that opens onto nothing is the disabled control docs/33 forbids, wearing a sheet's clothes.
- **Settings › Connections** (2026-09-12 — the source-release round, U3a; visual contract
  `D-Connections`) — one **elevated card per connection** (`.cxcard`: `--card` + hairline +
  `--shadow-card`, `--r-lg`), stacked in a 14px column. A card is a **head** (`.cxhead`: a 28px
  `--panel2` glyph mount · the name at 15/500 · a 10px mono status with a `--green` live dot · the
  actions as 28px `.btn.sm`) over **hairline rows** (`.cxrow`: a 96px `--muted` key column, a value
  that may carry `code`, a `--green` mono tag, a `--link` mono link, or a `--muted` sub-line). The
  keep-after-quit toggle is the settled `.shsw` switch, never a native checkbox. The **Manual setup**
  card carries the one form in Settings that takes an address: 34px inputs at `--r-xs` with a
  `--border2` hairline that turns `--text` on focus, and one `Connect` block button.
  ▸ **A plan is a fact about a connection's workspace.** Billing's rows (plan · seats · status ·
  renews · the portal) live in the neuramesh.app card, and the Billing tab retired. Without a cloud
  connection that card is a **door**: one line and `Get Pro`.
  ▸ **An absent control beats a disabled one.** `Migrate to Cloud` sits on the This Mac card only when
  it can act (`shell/move-copy.ts moveDoorFor`, tested): the move when a Pro cloud workspace exists,
  the Upgrade sheet otherwise, and no button once the workspace moved (the card then carries one row,
  `Migrated to <target> · <date>` with `Open`). The UI never says compose: the person sees an engine, a
  stack version, a folder, two ports and one toggle.
- **The Migrate to Cloud sheet** (2026-09-12 — the source-release round, U7; visual contract
  `H1-MoveToCloud`, `H1-MoveToCloud-cream`, `H2-Moved`) — a local workspace into a Pro workspace,
  through one module-level opener (`lib/toast.ts openMoveToCloud`) with two doors, the This Mac card
  and the rail's foot. The `.upmodal` recipe at 560px (`.mvsheet`): the mono eyebrow, `Migrate <name> to
  Cloud`, no sentence under it (the facts are the sentence), then the **target as a hairline chip** (`.mvchip`, a picker `.mvpick` of radio
  rows only when the person owns two Pro workspaces) and the **facts as `.cxrow` lines** (Projects ·
  Threads with the task count · Files against the plan's allocation as a `--green` tag · Agents with
  `merge by name` in mono · Stays here). The foot is the Upgrade sheet's: two block buttons and one
  `.upmono` fact. H2 (`.mvdone`) is the 460px cut: `Migrated`, the one sentence with the counts and the
  target, `Open in <target>` and `Done`.
  ▸ **Main decides, the sheet draws** (the first-run card's rule). Every number arrives from the
  opening batch the server answered (`nm:move-plan`), every phase is pushed (`nm:move`), and the sheet
  holds no rule that can drift from the driver. Closed mid-move, it re-opens on the phase main holds.
  ▸ **A progress line, never a spinner alone.** While the batches stream the foot shows
  `PLEASE WAIT… · BATCH n OF N · k ROWS WRITTEN` with the warm wait dot and a 4px bar (`.mvbar`, the
  download row's recipe) that is batches over total, and the one control is a quiet `Cancel`, which
  stops after the batch in flight. A refusal is one sentence (`.upnote`): the storage numbers on
  `PLAN_LIMIT`, the table on `IMPORT_ORDER`, and the primary reads `Migrate to Cloud` again because the
  retry resumes.
  ▸ **The local copy is never deleted**, and H2 says so in the artboard's words. The door opens the
  Upgrade sheet when there is no Pro workspace to move into: a move into Free is refused before a row
  is written, so the honest door there is the buy.
- **The hosted gate card** (2026-09-12 — the source-release round, review F6; visual contract
  `E-HostedShell`) — a cloud workspace on the Free plan keeps every read and loses every write, and
  the way it says so is that **the composer does not render**: `.hgate` docks in its seat (`--card` +
  hairline + `--shadow-card`, `--r-lg`, `nm-rise`), on the thread at 17px and on Home's stage at 20px
  with the sheet shadow (`.hgate.stage`, the cap card's precedent). A mono `--dim` eyebrow, the title,
  one sentence, `Get Pro` and `Export workspace`, then one hairline foot with the one honest mono line
  about the cloud machine's files. The rule that decides it is a function (`shell/hostedrule.ts`), so the
  three composers cannot drift: a hosted connection whose row reads `free`, never a local one, and never
  while the plan is still unread.
  ▸ **A typed message that vanishes is the failure this exists to prevent.** The upload lane refuses
  writes on a free hosted workspace, so a box that accepts text there is a trap. Replace it, never
  grey it.
- **The release brief card** (release drafts, 2026-09-17, docs/44; visual contract
  `docs/design/release-drafts-2026-09/Thread.dc.html`) — the `‹brief:<artifact id>›` marker worn as
  a card, the ArticleCard/ReportCard idiom exactly: `.relcard` on the elevated stratum (`--card`,
  hairline, `--r-lg`, the resting shadow, 620px), a head row (the mono `Release brief` kicker, the
  tag chip, the date, the verdict chip at the right: `.chip.rv-feature` in the done hue,
  `.rv-improvement` in the prog hue, `.rv-fix` in the warn hue, `.rv-none` the quiet chip), the
  feature title at 15.5/500, the why in body ink with pull requests as plain numbers (a `#N` in a
  thread is a TASK ref, so the digest and the brief say `PR 385`), then the `Audience · Assets ·
  Not known` rows with an 82px muted key column (the gaps row italic, never hidden), and a foot of
  `Open brief ↗` (the same doc tab door ReportCard uses) and `Save to Files` (`★ in Files` once
  promoted). One card per brief, rendered by both thread renderers from one parse
  (`shared/releasebrief.ts`).
  ▸ **A session shows the cards of the units it owns.** A conversation renders the post cards of a
  content unit anchored to it (`tasks.origin_thread_id`) after the unit's completion note, through
  the one `postCardsFrom` derivation, wearing the unit's number (`#1142·c`). A lens on the rows,
  never a copy: the peek and the session can never disagree. Unanswered drafts on an owned unit
  make the session `needs you` (`threadstatus.ts`, `draftsWaiting`), so the queue lifts it.
  ▸ **The wizard's switch rows** (`Setup.dc.html`): a setup step that arms something wears the
  `.togrow` rows, a label with a muted sub-line and the control at the trailing edge (a checkbox for
  a one-time act, the settled `.shsw` switch for a standing one). The repository is a mono chip
  (`.repochip`: owner/name, the branch dimmed, `Change` beside it), never a text field the person
  retypes. A machine marker (`‹release:…›` and its siblings in `thread/markers.ts`) never renders.
- **Answerable cards** (rail-ink round, 2026-09-04) — the question card is `--card` + one hairline +
  the resting shadow at `--r-lg`-ish 12px, and inside it: options are **ghost pills** (a single-line
  control, §6) and become **blocks** only when they carry a second, explanatory line
  (`.qopt:has(span)`); the free-text answer is the **composer's recipe** — one pill, the input inside
  it, the round `↑` as its verb on the last step. Only the thing you type into is a box.
- **The details panel** — the sections a subject carries beside its thread. Sections
  (`.mkrailhead` + rows) come from the subject's own state *and* from its room, and each renders
  **only when it has rows**, so nothing is ever an empty heading. New auxiliary surfaces become a
  **section**, never a second rail or a drawer.
  ▸ **It lives in ONE place: the Workbench's Details face** (2026-08-17, George — the flat round).
  The in-sheet `<aside class="mkrail">`, its 26px `.mkrailtab`, its hover-peek and its
  `nm:mkrail-collapsed` are **retired**; `.mkrail` survives only as the Workbench slot's class, so
  every section rule is shared by construction rather than by copy. 2026-08-16 moved a *task's*
  sections there and left the other two mountings behind — `ConvoThread` rendered its aside
  unconditionally, and the room home rendered a third as `BrandDocsRail` — which meant opening the
  Workbench in a content conversation put two panels at one edge, the exact duplication that move
  existed to remove. The face is **scoped to what you are standing in** (`shell/workbench-state.ts`,
  tested): a task → its description · requirements · DoD · artifacts · subtasks; a conversation →
  its artifacts; a room home → its brand docs, queue and connections; and the room's sections ride
  *under* a session's when both apply.
  ▸ **A closed panel must still say what it holds.** `.thfacts` — a row of toks under the thread
  head (`description · requirements · subtasks 1/2 · pull request #1046 · review loop 2`), each one
  a door that opens the panel to Details. A tok holding a gate stays warm. Without it this round's
  one real cost lands unmitigated: the Definition of Done simply off-screen with nothing on the
  thread to suggest it exists. The toks hide while the panel is open — a strip pointing at a panel
  you are looking at is noise.
  ▸ **Empty is a state, not a blank.** The Details face shows one line when its slot has no
  sections, gated structurally (`.wbslot:not(:empty) + .wbslotempty`) because only the portalling
  surface knows whether it has anything to say.
- **Composer** — an elevated card with a warm **chint cap** (avatar + one-line guidance), the
  textarea, then a chips row: `#channel` chip · pickers as chips · attach · contextual chips ·
  round accent send. Every composer in the product (rooms, Home, thread, launcher) is this one
  idiom — new features **inherit the composer**, never rebuild it.
  ▸ **The foot** (the composer-foot round, 2026-09-11, George — visual contract
  [docs/design/composer-foot-2026-09](design/composer-foot-2026-09/plan.md)): Home's composer wears a
  third zone under the chips row, the **chint cap's material mirrored at the bottom of the same card**
  (`.cfoot`: full-bleed like `.chint`, one hairline, the well wash, the bottom corners inherited) — one
  object, three zones, one border, one focus ring. Left, the **ghost recipe**: the stage's suggestion
  pills moved IN from under the box (`.cfootpill`, 26px, `--border2` hairline, `--body` ink; a pill is a
  pre-drafted message, never a command). Right, the **connector marks** (`.cfootapp`): the four
  publishing connectors as 16px SVGs on 24px targets — `--dim` until connected, then `--body` ink with a
  5px `--green` dot, `--warn` when the grant died and the honest verb is Reconnect — then `⋯` for the
  rest. **Four marks, not eight**: at the stage's 640px measure the three pills and eight targets do not
  share one line, so PostHog · Meta Ads · TikTok Ads · image generation live behind the door, in a
  FIXED order never sorted by state. A mark is a **door**: not connected opens the connect step in the
  composer's own popover recipe (the machine chip's `.cprojpop.cmachpop`, hung from the cluster's
  right edge); connected shows the account and Disconnect (the list's two-step "Sure?"); `⋯` lists
  every connector as icon · name · state, the machine-chip row idiom. The marks are **simplified
  monochrome geometry** (`IconX` … `IconTikTokAds`, the provider-marks precedent), never a colour logo
  and never a text glyph, and the Connections rows wear the same marks. **With a draft in the box the
  pills leave and the marks stay, and the foot keeps its height** (`.cfoot.drafting`) — the reserved
  seat, so the box never jumps under the first keystroke. State is ONE derivation
  (`settings/connectors.ts`, tested) shared with the room's Connections list, read for the room the
  composer targets; the connect step is ONE component (`settings/ConnectPanel.tsx`) rendered by both.
  Only Home wears the foot. The thread composer, the launcher and the phone do not.
- **Chips & pickers** — pill chips (`.cchip`) open upward `chippop` menus; time inputs are styled
  chips (`::-webkit-datetime-edit` styled, width-pinned). No raw `<select>` in user-facing rows.
- **The machine chip** (desktop Code bridge, 2026-09-04 — rule D9; visual contract
  `docs/design/desktop-code-bridge-2026-09/mockup.html` §1–2) — the composer's **third knob**,
  beside the room chip and the brain pill in New chat and in the Code composer's context row:
  `.cchip.cmach` = the kind's icon from the icon set (`IconMachine` a laptop · `IconCloud` a cloud
  machine — a plain cloud is right in a LIST OF PLACES · `IconAuto`, a fork that splits toward two
  places, for Auto — **never a sparkle, and not a letter**, George, 2026-09-05 — SVGs of one weight; the text glyphs `⌂`/`☁` drew a hairline house
  beside a bold cloud, George, 2026-09-05) + the machine's short name + caret,
  its tooltip the reason (*Runs on Cloud · the cloud machine is awake*). The popover is the
  project-chip recipe (`.cprojpop.cmachpop`, 292px, opens upward; in the Code column it hangs from
  the chip's **right** edge like the model popover, because `.engconversation` clips): a `Run this
  session on` hint → **Auto first**, one short subline saying what Auto resolves to (*cloud when
  awake · else this Mac*) → one `.cprojitem` per choosable machine, **icon · name, and nothing
  else in words** (George, 2026-09-05: the rows were all text) — a teammate's machine adds its
  owner's name as the `.cmachsub`; the STATE is an icon at the row's right (`.cmachst`: `●` green
  online/awake · `●` amber pulsing waking · `☾` asleep, wakes on send · `○` offline), its word in
  the tooltip. The row Auto resolves to wears a `.cprojtag` (`default` when the desktop default
  says so, `auto` otherwise); an offline laptop is drawn dim (`.cprojitem.off`) and cannot be
  picked; a cloud machine can (a pick wakes it). The `.cmachfoot` is one line: *Default: Auto ·
  change in Compute*. The menu measures the room above the chip inside its clipping ancestor at
  open and caps its height to it, so a member with many dead laptops scrolls the list. It renders in every client and says *This Mac* only where there is one. It
  designates the **session** (`threads.machine_id`), never the agent — per-agent choices stay in
  the Compute panel — and the chip is a **forecast**: only an explicit pick, or the desktop
  default's Mac, is written; a forecast of *Cloud* never pins a session to a machine that fell
  asleep between the reading and the send. **In the Code composer** (George, 2026-09-05) the
  three chips — project · model · machine — are **icons only while the column is under 500px**
  (a container query on `.engconversation`, named `engcol`; the default column is 420) and grow
  their names back as the splitter widens the column; their menus hang from the chip **group's**
  right edge, not from their own chip, so a menu no wider than the column always fits whichever
  chip opened it (hung from the project chip's edge, the project menu ran under the left nav).
  Above 500px the machine chip keeps its intrinsic width and the other two do the shrinking.
- **The two cloud marks in the status cluster** (2026-09-05, George: "a machine icon to indicate
  the cloud machine and a cloud icon next to it is confusing") — the compute pill (`.cpill`) draws
  the **cloud machine**: the chassis on its stand with a small cloud badged at its top-right, one
  mark that says "cloud machine" by itself (`IconCloudMachine` is the same drawing in the icon set;
  the machine chip's rows keep the plain cloud — there it sits in a list of places, not beside a
  sync mark — and a laptop stays `IconMachine`). The **sync** mark
  (`.livepill`) is two arrows chasing round — writes leaving, state arriving — struck through when
  offline, with the `.livedot` beside it while agents work. Never draw a bare cloud for either: a
  cloud is a place, and the bar has two facts about two different things.
- **Compute rows say their kind** (same round) — a `.cmpkind` mono tag after the machine name:
  `this Mac` · `desktop` · `cloud` (the runner) · `your cloud machine` · `member machine`; the grant
  badge (`.cmpshared` / `.machnoshare`) stays its own word beside it. The pill used to call a
  laptop "Cloud machine". **The desktop-only default** — `.cmpsetting` (a `--card` box under the
  machine list): a `.k` kicker with a `desktop only` tag, the `.q` question *Run them on*, then
  `.cmpradios` → two `.cmpradio` (**This Mac** · **Auto**, the radio drawn by `::before`, a
  `<small>` consequence under each). Drawn by every desktop-hosted client and never by the browser
  (`NM_PLATFORM !== 'web'`): a web-born session is never "here".
- **The agent face is a door** (2026-08-04) — an agent avatar in a message row is a control:
  **hover** → `.agentpop`, **click** → its record. The popover is `.taskrefpop`'s mechanics with a
  different payload (portal to `<body>` — a masked scroller clips fixed descendants; measure, then
  flip above/below with a clamped left edge, §9.6), and every mount resolves through ONE
  `AgentDirectory` context so the card can't fork into three. Interactive is **opt-in** per call
  site: roster tiles and crew clusters are already buttons, and a control inside a control is
  invalid markup plus two handlers on one click. The peek carries identity only — name, role,
  seat, presence, and the one-line **description**; instructions live behind the click. Rooms
  are NOT on it (2026-08-05): an orchestrator auto-joins every channel, so rex rendered fifteen
  pills and the card stopped being a glance at *who*. Nor is a "click for details" caption —
  the lift and the pointer cursor are the affordance. It opens on **120ms of hover intent** (a
  message list is a column of faces; opening on contact strobed one card per avatar while
  sweeping past) and closes through a guarded exit — `.leaving` plus an unmount timeout (§7),
  growing from whichever edge it is anchored to.
  An agent's two strings are labelled by *audience*, never by a paragraph of help text: a
  `.readby` chip (routing — the orchestrator reads it) and `.humanonly` (instructions — only a
  human may rewrite them). Resting text sits in a warm well (`.agbox`, §3 stratum 3); editing
  flips to an elevated ringed `.agtxt` — the composer idiom, so a text field always looks like
  one place. Note `.modal .btn.primary` is full-width by design, so a footer holding Save +
  Cancel + a counter must re-assert `width: auto`. The record is `Modal full`
  (`min(1120px, 94vw)`) split in two: **remit** left (description, instructions — what you came
  to read or change), **wiring** right (brain, rooms, credential, A2A, retirement). Splitting by
  what the reader is *doing* is what removes the scrollbar — it halves the height, where a wider
  single column would only have lengthened the lines past the `--col` measure.
- **Session rows** (sessions shell, 2026-07-29 — docs/35) — ONE row anatomy for everything a
  room contains: leading glyph (**state dial** for a task — the docs/25 ring at 18px, conic
  `--frac` in the state's hue; **chat glyph** for a conversation; a hollow square for a legacy
  room message), then title + one-line snippet, then a right meta column (state chip · relative
  time · `#room` tag when the list spans rooms). Chats and tasks are never two list designs —
  a task is a session wearing a state. Rows sit on `--hover-bg`/`--card` lift, never borders.
- **Day-group heads** (sessions shell) — `TODAY / YESTERDAY / THIS WEEK / EARLIER` in the mono
  section voice (9.5px, tracked, `--dim`). Monotonic buckets only: docs/32 §12's ban on grouped
  headings under a recency sort is about NON-monotonic groups (rooms repeat); day buckets cannot
  repeat, which is why the session list may use them.
- **The room brief** (sessions shell) — the orchestrator's digest as a pinned one-line summary
  card at the top of a room's session list: mono `ROOM BRIEF` label · first line of the newest
  brief · `n earlier` expander (stacking up to 5) · `history ⌘Y ›`. It is a **card, not a feed**:
  clicking a brief opens a reply-thread rooted at it (docs/31 machinery). `nmq`/`nmauth` bodies
  never appear here — cards are needs-you material.
- **Recents rail rows** (2026-07-30, the recents-rows round — A+C combined by founder ruling) —
  a task row carries its `⎇ branch` in mono dim ALWAYS (plain end-truncation — a branch starting
  with … reads as a glitch), and rail titles are always `plainTitle`-stripped: raw markdown in a
  row is a defect.
  ▸ **The nav's scope row and the flat list** (2026-08-17, George — `mockups/nav-and-details-round.html`).
  The rail is ONE recency list under a **`.navscoperow`**: fold · project chip · room chip ·
  search. **The first chip names the LIST, not the filter** (George, same day): it read "All
  projects", which describes the control's own menu — but the rail is a list of *threads* and the
  project is one way to narrow it. Unscoped it says **All threads**; scoped it says the project
  narrowing it. (The room chip stays "All rooms": it only exists inside a project, where it is
  unambiguously a filter.) It is the **ScopeBar idiom** every workspace destination has worn since 2026-08-07,
  at rail width — narrowing is a visible, reversible choice, never an invisible default. It
  replaced a collapsible header, a channel strip and an `n more ›` **per project**, which spent
  eight rows of chrome and three cap decisions on four projects before the rail said anything.
  Where each prior ruling's job went is written in `navtree.ts`'s header; the two that move house:
  a quiet project is now a row in the **picker** (with its logo, live pulse and ask dot — more
  than the header carried), and the room strip is the **inside of a project**, drawn once for the
  one you picked. Across projects the slugs repeat, so there is no strip to draw.
  ▸ **The list's name is TEXT** (rail-ink round, 2026-09-04, George): unset, the scope chip draws no
  border and no fill — `All threads ▾` is a label with a menu, the same voice as the section
  kickers — and only a filter you SET keeps the chip wash (selected-as-warm is the idiom, §3).
  The same round retired the frame top's `project › surface` crumb: the head is the mark, the
  wordmark and the fold, because the project already lives in this row and the surface in its tab.
  ▸ **A row says what the SCOPE doesn't.** Unscoped: project + room. Inside a project: room + the
  full branch. Inside a room: the branch alone. The width narrowing gives back is spent on more
  truth, not on blank rail — and the branch is never dropped, it changes form (`⎇ nm-1057`
  unscoped, `⎇ nm/1057-fix-x-token-auth` once there is room). This generalizes `SessionRow`'s own
  `showRoom` rule to two axes.
  ▸ **Narrowing must never silence an ask.** An ask the scope or the cap is hiding puts a dot on
  the project chip itself (`askOutside`) — the collapsed-group dot, moved onto the control that
  does the hiding.
  ▸ **Yield order under width pressure** — the nav resizes 224–356px, and two set chips plus the
  magnifier do not fit 224 at natural width. Chips shrink, never wrap. An **unset** chip is a menu
  opener reading its own default, so it sheds first; between two set chips the **project** yields,
  because its logo tile still identifies it. The rules ride the wrapper, not the chip: the wrapper
  is the row's flex item, so shrink factors set on the chip inside it are invisible to the layout.
- **One line per rail row, and the glyph says the kind** (rail-ink round, 2026-09-04, George —
  supersedes the recents-rows "branch always" (2026-07-30) and the flat round's two-line "a row
  says what the scope doesn't" for the RAIL; Home's session list keeps its dial). A rail row is
  a kind glyph · the title · ONE trailing fact, decided by `lib/rowglyph.ts` (pure, total over the
  FSM, tested): chat = speech outline · routine run = clock · task waiting (backlog/todo) = hollow
  circle · task active = the 6px dot in its state hue (unchanged) · task settled
  (done/accepted/closed) = a check in a circle · an open run = the orb. Colour survives only for
  an active state; animation is spent on exactly two things, the orb and the **needs-you pulse,
  which moved to the trailing edge** — a signal beside the row's identity, never the identity.
  The trailing fact: ask › run progress `n/m` › the room the scope does not say › age.
  ▸ **The marquee.** A title that overflows scrolls the exact overflow on hover (measured on
  enter, ~40px/s after a half-second pause) and holds at the end — Codex's gesture; the ellipsis
  gives way while it moves, and reduced motion leaves it to the hover card.
  ▸ **Hover gives the facts back.** A card beside the row (`.navhistcard`, elevated stratum,
  fixed-positioned because the list clips, pointer-transparent, 350ms patience) carries the full
  title, the snippet, project · room · branch · state · age, and the live verb while a run is
  open — never a native `title` (trap 10). On hover the trailing fact yields to **rename · ⋯**;
  the menu carries only what the server offers (thread.update / task.update_details, thread.archive),
  and a task renames only before work starts, where the FSM freezes its title. The row's and the
  folder's ⋯ menus, and New chat's caret menu, all wear ONE recipe (`.navrowmenu`: text with icons,
  no sub-lines, no card); the caret's opens on hover as well as click. Tips on the row's trailing
  controls anchor RIGHT and open ABOVE (the `.dockbar` recipe) — centred, they ran across the next row.
- **A live row wears the ORB** (2026-08-17) — a row whose task/thread owns an open run swaps its
  6px state dot for the thinking orb (`.nhorb`, docs/26's `orbStateFor`) and adds the live verb
  line (`patch · returning focus to the trigger · 2/5`, italic). It is a SWAP, not an addition:
  the rail used to draw the pre-orb indicator *and* a pulsing halo, two animations that between
  them could not say whether the agent was writing, searching or fanning out. The orb is
  monochrome by design, so the **state hue survives as its ring** (`.nhorb.ringed`) — `c-<state>`
  supplies `color` on the mount exactly as it did on the dot. **The ring exists only where a state
  does**: a chat has no FSM state, and ringing its orb anyway drew an unexplained `--prog` circle
  — the "in progress" hue — around a thing that is not a task (George, on sight, the day it
  landed). A signal with nothing to signal is noise; a *coloured* one is worse, because it reads
  as a state you cannot find anywhere else on the row. One canvas per LIVE row only; a rail at
  rest draws none. Liveness still costs **no ground at all** (2026-08-01): the neutral card means *selected*.
  Now-truth displaces where-truth for as long as the run is open — the verb takes the meta line's
  seat rather than adding a third, so a working row and a quiet one are the same height.
- **The session crumb** — an open session leads with `‹ #room · conversations` (or `‹ Home`,
  `‹ #room · board` — it names the lens it replaced), in the mono voice. A session takes the
  MAIN surface; nothing floats over a feed anymore (`.taskovl`/veil retired with the feed).
- **Tab strips** — a row of surfaces sits on its **own line under the heading it belongs to**,
  never inline with it: `.roomtabbar` (a room's Conversations · Board, plus Calendar · Library on a set-up marketing HQ and Routines when the room has one armed) is the idiom, and since
  v0.64 the only tab strip in the product — the task panel dropped its own (Thread · Review ·
  Diff) because those were views of one thing, not separate surfaces; a panel with a single
  subject earns **toks + drawers**, not tabs. A tab may carry a count (`.roomtabn`) — a warm
  well while the tab is idle, `--sel-bg` when it is the active tab, mono, never accent-filled: a
  tab count is information, not a notification. A surface reachable by a tab gets **no second
  entry point** in the same view.
- **Chat mode's rail is FOLDERS, one per project** (rail-ink round, 2026-09-04, George — the Codex
  shape, chosen on sight over the one list).
  ▸ **RECENTS · PROJECTS, the human's choice** (the nav-recents round, 2026-09-12, George — visual
  contract [docs/design/nav-recents-2026-09](design/nav-recents-2026-09/)): the band head reads two
  words. The lit word is the view and carries the count (threads, or folders); the dim word is the
  door, one click, remembered per machine beside the mode (`nm:navView`). **Recents** is the mode's
  rows flat, newest first, the same one-line row, in steps of 30 behind `Show n more`; **Projects** is
  the folders exactly as ruled below. No new chrome: the fold-all chevron and the ⌘Y magnifier stay
  where they were. The scope row does not return with the flat list (George picked the bare list).
  **The folder row is a quiet label** (same day): 13px, regular weight, `--muted` ink and a `--dim` glyph,
  a step under the threads it holds, so a project name never competes with the rows for the eye. `navtree.navGrouped` (pure, tested): a folder per
  project that HOLDS a session (an empty project is the picker's business, not a row of chrome),
  newest folder first, rows inside by recency with asks pinned into a five-row cap and `Show n
  more` lifting it; a folder opens and closes by its state (`IconFolderOpen` / `IconFolder`, click
  folds — persisted), and a folded folder keeps its count and its ask dot, so folding never
  silences an ask (the `PROJECTS` head wears the dot too). On hover a folder shows the Codex pair —
  **new chat here** and **⋯** (new chat here · make it the active project · edit projects) — and a
  card with its count, whether it needs you, and its rooms. The scope row's picker retires in Chat
  mode (the folders ARE the projects; the `PROJECTS` head keeps the fold-all chevron and the ⌘Y
  magnifier). **Both modes fold** (George, on the built rail: Code's flat list read as "just all
  threads") — Code's folders hold repo-backed work, and an engineering session, which has no room,
  lists flat after them. This is NOT `navTree` returning:
  no channel strips, no per-group `n more ›` chrome, and rows say nothing their folder already says.
  ▸ **LOCAL · CLOUD, the connection bands** (the source-release round, 2026-09-12 — visual contract
  [docs/design/oss-release-2026-09](design/oss-release-2026-09/) B0 to B4): when the desktop holds two
  connections (the local stack on this Mac and the hosted cloud, `main/connections.ts`), the rail lists
  both under two kickers in the `.navsect` voice (`.navconn`: 10px mono, the count as a whisper, a fold
  chevron in the glyph column), and the foot's menu lists workspaces under the same two words. **Only
  when two**: one connection draws no band and the rail is today's rail to the pixel. The RECENTS ·
  PROJECTS head stays ONE control above both bands and applies inside each. **A fold never silences an
  ask**: a folded band keeps its count, its ask dot and its live pulse on the kicker (`navtree.navBands`,
  pure, tested). Opening a row on the other connection swaps the foreground in place (`setForeground`,
  under 100ms, printed as `rail_swap`) and the `.on` row is the one row in the foreground band; a row on
  another connection carries no hover controls, because a rename there would reach the wrong server.
  The kicker is `.navconn`, not the artboard's `.navband`: that name has been the shortcuts band's
  wrapper since round 17, and a shared class would have restyled it (the `.navsect`/`.navparent` trap).
- **Code is a MODE, and the rail's one mode switch sits under the head** (rail-ink round, 2026-09-04,
  George — Gemini's Chat | Spark shape; built on #391's Engineering OS). A segmented control, `Chat |
  Code`, is the shell's single mode switch: it changes what the rail LISTS and where you stand, never
  the rail's anatomy. Chat lists every conversation (a repo-backed task is still a thread) and never
  an engineering session; Code lists code work — engineering sessions and repo-backed tasks — with
  the **branch** as each row's one fact (the repo, for a session, when unscoped), its verb is `New
  session` (the Engineering floor's home), and its band is `Tasks · Worktrees`. Switching modes takes
  you there: Code opens the Engineering floor, Chat brings you home from it. The `Code` band row
  retired with it: a mode wearing a row's clothes was two doors onto one surface. Predicates in
  `navtree.ts` (`isChatRow` / `isCodeRow`), applied BEFORE the cap so the picker's counts and
  `askOutside` speak about the mode's rows. Not a destination tab strip (the ruling below stands).
- **The nav's verb is a text row** (rail-ink round, 2026-09-04 — supersedes the shell round's
  accent pill): `New chat` is a compose glyph, the label at 560 and `⌘N` in dim mono, hover wash
  only; the caret beside it still carries the launcher's task and routine modes. "Menus are text
  with icons, not embossed buttons" (George) — a pill made the verb the one raised object in a
  column of rows. **Shortcut rows step in** 22px from their kicker and children a second step
  (36px) with no guide hairline (trap 9b); the kicker itself is `--dim`, rows rest in `--body`,
  icons in `--muted`, the selected row in `--text` at 560.
- **A destination with more than one surface nests in the NAV, it does not grow tabs**
  (2026-08-13, George — Scheduled › Routines · Calendar). The disclosure already IS the
  navigation, so a tab strip inside the main area beside it would be a second door to the same
  two surfaces. `.navsect` is the pre-existing uppercase section LABEL; the parent-row class is
  `.navparent` (the collision shipped once, in review, and rendered the parent as a heading).
  ▸ **Rebuilt 2026-08-16 — the parent folds, the children navigate.** The first cut did four
  things that read as chrome moving on its own, and each is now a rule with a test behind it
  (`shell/navdest.ts`, `src/main/navdest.test.ts`):
  **①** the children render **always**, not only while you are already inside the section — the
  old gating put Calendar two clicks from everywhere else and hid the second click's door behind
  the first. **②** Exactly **one fill** in the band, ever, and the parent never carries it: the
  "section marker" is replaced by a **tint** (`.navparent.ingroup` — label and glyph to `--text`),
  which is a different signal *in kind* rather than a second, weaker selection. **③** The fold is
  the **human's**, persisted in `nm:navSec` beside Shortcuts / Projects / Recents; the route never
  opens or closes it. **④** The parent **toggles and never navigates** — a parent that opens its
  own default child is two doors onto one surface.
  Children carry **no glyphs** (the parent's icon repeated under itself was noise) and indent to
  **30 + 1 + 13px**, landing a child's *label* at 44px — exactly where the parent's label starts
  (8 margin + 9 padding + 16 glyph + 11 gap) — off a `--border2` hairline that brightens to
  `--ring` for the span of the active child. **Scope sub-row geometry to `.navdest`** (0,3,0):
  `.navdest .navitem { margin: 0 8px }` is (0,2,0) and sits later in the file, so an unscoped
  `.navitem.navsub { margin-left }` loses the cascade and the children render flush with their
  parent — shipped once, caught on sight.
  And because a fold must not cost information, a **folded parent carries its children's summed
  count** — the same rule the thread rail's collapsed tab obeys.
  ▸ **Superseded 2026-09-20 (George) — the pair are TABS on the page, and the row is plain.**
  "Instead of the drop down scheduled design, can we make scheduled just a single item and instead
  make routines and calendar text style tabs within the main area view on the scheduled page;
  helps declutter left menu and aligns more to our design." The fold, its child rows, the four rules above and their CSS
  (`.navparent`, `.navsub`, `.navpchev`, the `nm:navSec.scheduled` key) retired with it. What
  replaced them: `Scheduled` is a row like Whiteboards and Files, **lit on either surface** (one
  door, two lenses — `isScheduledView`, tested), and the page head is the name with the **room tab
  strip** under it (`shell/ScheduledHead.tsx`: `.roomtabbar.desttabs`, inset to the head's 20px),
  `Routines · Calendar`, each tab wearing the count it names in `.roomtabn`. The row carries **no
  count**: armed routines and drafted posts are inventory, the Whiteboards ruling, and each number
  now sits on the tab that says what it counts. The two "every schedule in the workspace…"
  sub-lines went with the heads (say less). The general rule is therefore inverted for this case
  and stands nowhere else yet: **a destination with two lenses wears the room tab strip on its
  page**; a second such destination reuses `.desttabs` rather than minting a strip of its own.
- **A notification is not a destination** (2026-08-16). A count that means *someone is waiting on
  you* lives on **chrome** and opens a **popover** (the bell, `.bellbtn` → `.bellpop`, leading the
  workspace strip's right rail); a count that means *how much is in there* lives on the thing it
  counts, as the informational `.navitembadge`. The bell wears `--link`; informational counts wear
  `--panel3`. The bell is **never gated** — the crew clusters beside it stand down whenever a task
  or thread opens, which is most of the time, and a queue you can only see from one surface is a
  queue you forget. Inside it, **a row is a door, not a form**: the full answering card renders in
  the thread. One derivation feeds the badge, the rows and the tree's dots — never a second.
- **The workspace foot** (2026-08-16) — the nav's bottom bar: workspace tile (live pulse · unread
  dot) · name · caret · account avatar, elevated on hover (`--card` + hairline + `--shadow-card`).
  It replaces the 30px spine: the *workspace is a scope above the project* contract it protected
  survives by **position** — the bar sits under everything it contains — and costs no column.
  Hovering it arms the second face on **140ms of intent** (a foot you sweep past on the way to a
  session row must not flip the column), the whole nav keeps it open, a click **pins** it, `⌘⇧P`
  toggles it, Esc closes. The two-face machinery is unchanged: both faces mounted in one grid
  cell, no scrim, no shadow, **0px layout shift**.
  ▸ **The credit ring** (2026-08-28 — `mockups/starter-brain-and-credits.html` station 3,
  [starter-brain-and-credits](design/cloud-first-2026-08/starter-brain-and-credits.md) §5.7/§8) —
  a third element in the bar, **left of the account avatar**: a 22px SVG ring (`.credring`,
  `--green` arc on a `--panel3` track, round caps) whose arc shortens as the workspace's credits
  go and turns `--warn` **below a fifth**. **A meter in the rail is a RING, not a number** — a
  number asks to be read, a ring asks only to be glanced at, and depletion is a shape before it
  is a figure, so the resting state carries **no digits at all**. The breakdown lives one click
  in, in a portalled `.credpop`: **three named lines, never one blended number** (Brain ·
  Machine · Storage — each acted on differently), closing on the line that turns the meter into
  a reason rather than a threat ("connect your own brain and agents stop drawing credits").
  **No per-reply pricing anywhere** (George, twice): a per-message rate makes a free product
  feel like a taxi meter and is a number nobody can act on in the moment; the *balance* is the
  honest unit. Two rules the shape must keep: a meter that **cannot read renders NOTHING**
  (absence over a full ring built on a failed fetch), and the ring is the **workspace's** balance
  beside the person spending it — if credits ever become per-user it moves to the avatar, because
  standing in the workspace bar would then say the wrong thing.
- **The Workbench is ONE face** (rail-ink round 3, 2026-09-04 evening, George on the built card:
  "I don't think we need the Details/Code tabs any more, just one tab"). The card holds the open
  session's **details** — description · requirements · Definition of Done · artifacts · subtasks ·
  the review loop — portalled in by the thread that owns them, and nothing else. **Requirements
  and the Definition of Done are not among them** (same day, George): the plan is where the DoD is
  authored and revised (docs/41), so the card shows what a session is *making*. Its history of
  faces is closed: Artifacts folded into Details (2026-08-17, the same list twice); the **repos**
  face retired when Code became a mode (nothing open ⇒ no panel; Code's New session is where you
  pick a repo); **Code retired the same evening** — Code mode owns code and the Engineering floor
  never shows this panel, so a Code face had nowhere left to be. What survives of it is a **Files
  drawer** under the details: shut by default, drawn only when the *session* has a worktree
  (never for a room home), carrying the branch switcher, the finder and the tree; `⌘P` and the
  dock's `Open a file…` open it. No faces means **no segment and no "wanted" face** — the subject
  is decided by context alone (`shell/workbench-state.ts`, tested): a task, a chat thread, or the
  room you stand in. It stays a **doorway, never a viewer** — a click opens a file *tab* in the
  side dock. Naming rule this settles: the left-nav destination is **Files** (workspace documents,
  ACL'd by room); the panel is the **Workbench** (this session's details and its disk). One word
  per noun, and the word that named a single tool inside the container ("Editor") is retired.
- **The split stage** — a review surface that must be *looked at and talked about at once* docks
  as a **resizable peer column** beside the thread, never as a `position: fixed` overlay: a hairline
  grip (pointer **and** arrow-key resizable, width persisted per machine — the idiom now serves
  **three seams**: the nav edge, the task peek, and the Workbench, 2026-08-16), the thread keeping its
  `--col` measure, and the studio spending the panel's slack. ⤢ expands it to the whole sheet by
  *rotating* the same parts (stage left, conversation right) — the feed yields, the conversation
  never does. Under 1100px it takes the sheet outright. First use: the Design Studio (docs/14).
  A superseded stage rests under a **veil** (`color-mix` over it), never `opacity` — opacity blends
  the content with whatever it stands on and muddies it.
  ▸ **Second tenant: the task peek** (2026-08-10, George — `mockups/task-peek-column.html`). A
  `#N` clicked **inside a thread** docks that task beside the conversation instead of replacing
  it: you were mid-something, and the thread is the context the task needs. Same machinery, same
  rules — one animated number (the peek's width, `--nm-peekw`, machine-local `nm:peekw`, clamped
  300–620), the session column at `flex: 1` absorbing the difference, the grip invisible at rest,
  and the solo takeover under 1100px. **No ⤢ here** — the studio's expand was tried and retired
  the day it shipped (George, live): the grip already makes the width whatever you want, so
  expand was a second answer to the question the seam answers, and its end state was a dead end
  you had to undo. A peek has exactly two ways out: **close**, or **Open full ›**. Two rulings it
  adds:
  **① Provenance decides the shape.** A ref inside a conversation peeks; Home, Recents, ⌘K, the
  ⌘Y overlay and the Tasks destination take the whole surface, because there picking work *is*
  the switch. Enforced at the call site (`onOpenTask`), and a surface that forgets gets the full
  view — the failure mode is today's behaviour, never a mystery column.
  **② The peek is the panel, narrowed — never a second design.** It renders the same
  `TaskThread` the full surface renders (docs/25 zoning intact: identity · facts toks · spectrum ·
  thread · at most ONE gate card); what changes is only its way out — the back crumb's seat
  carries **close · expand · open full**, because there is nothing to go *back* to while the
  thread it came from is on screen beside it. Peek scale drops the thread rail (§8 — at 380px the
  rail would BE the column) and the header's *working* actions (terminal, activity, block,
  promote), but **keeps the delete**: deciding a task should not exist is exactly the call you
  make while reading it beside the conversation that spawned it, and its type-to-confirm modal
  means a glance can never delete by accident. **Esc unwinds one layer** — the peek first, the
  session under it after. A peek exists only beside a session, which is what stops it becoming a
  second way to browse the board.
  **③ A peek is an ELEVATED CARD beside the thread** — `--card`, the component radius
  (`--r-lg`), its own hairline, inset from the sheet's edges. It shipped for an hour on the
  frame's `--win` (the nav's ground) and was corrected the same day: `--win` is *deeper* than the
  sheet in the darks, so the column read as a hole punched in the page. The rule that survives is
  the one George stated — **same as the nav or lighter, never deeper** — and `--card` satisfies it
  in every theme while being the §3 stratum that legitimately hosts controls, which a peek is full
  of. Rounding it also removes the seam problem by construction: an inset card's own border is the
  only edge in the gutter, so there is no second hairline to pile up (trap 9b).
- **Suggestion pills** — ghost recipe; when generated live (the launcher's "Give me ideas"), the
  sequence is *ghost ask → typing dots → pills rising in stagger*.
- **Accumulate, then spend** — feedback on a reviewable artifact collects as editable/deletable
  pills and is spent by **one** counted action (`.cbadge`), never one round-trip per remark:
  `PlanReview`'s block comments → `revise_plan`, the Design Studio's notes → `revise_design`. The
  composer stays plain — a mode chip that makes the human classify their own sentence before typing
  it is the anti-pattern this replaced (design round 2026-07-28).
- **The link choice** (2026-09-17, George; visual contract
  [mockups/external-links.html](../mockups/external-links.html), [docs/21](21-mini-browser.md)) —
  a click on a web link asks where the page opens: **Open in neuramesh** (the browser tab beside
  the sheet) or **Open in `<browser>`**, the OS's own name and icon for its `https:` handler. It is a
  `Popover` (`.popsurf.linkpop`, 264 wide): it grows out of the press, no veil, and folds back on
  Esc or a click away. The head is the fact you decide on, host in mono then the path, dim, one
  hairline under it. The rows wear the row-menu recipe (`.navrowmenu`: an icon, the words, no
  sub-line) plus a kbd hint (`↵` · `⌘↵`), and **the highlight is the focus**: the first row at
  open, the arrows move both, so the quiet ring would be a second mark and is not drawn. Row one
  wears **the neuramesh mark** (`PorchMark`, 16px, solid: the app is the place, so its mark names
  the row, George); row two the browser's icon at 16px/4px, or the external glyph when the OS
  reports no handler. A pick unmounts
  at once (the eye follows the page). ⌘-click and middle-click skip the surface, the new-tab gesture
  every browser already taught. Every web link in the app goes through the one seam
  (`lib/links.ts`); the web client, already a browser, never asks.
- **Tooltips** — `data-tip` (never native `title`): inverted-ink bubble (96% text over `--bg`),
  8px radius, 180ms hover intent, pop shadow. Families that flip (dockbar, composer rows) mirror
  the entrance offset so the tip emerges *from its anchor*.
- **Focus** — the quiet ring: `--ring` + 9% accent glow via global `:focus-visible`; text controls
  (`input`, `textarea`, `select`, contenteditable) are exempt (their container carries the ring) —
  the double-ring and the amber Chromium UA outline are both defects.
- **Avatars** — **DiceBear Thumbs is the one avatar system** (emoji tiles retired, founder call
  2026-07-24). The face derives from the name — renaming re-faces. Humans get letter tiles with
  presence dots. Warm tile mounts (`--panel2`) are the identity-well idiom.
- **The mark** — **Porch** (`brand.tsx`: `PorchMark`/`Wordmark`/`BrandLockup`), the ONE
  implementation of the arch — solid · reversed (only on oak) · outline (currentColor) — with
  the small cut auto-selected ≤24px (the standard cut never renders below 24). Porch is
  neuramesh's own avatar; agents keep DiceBear. Geometry lives in the brand handoff + the
  approved round ([mockups/brand-porch.html](../mockups/brand-porch.html)); icons/DMG art
  regenerate from `apps/desktop/build/icon.svg` + the handoff SVGs.
- **Scrollbars** — overlay style everywhere; no layout-shifting gutters; modals guard
  `overflow-x: hidden` so content can never summon a horizontal bar.
- **Empty states** — serif line + one action, on ground or a warm well. Never a bare "No items".
- **Live surfaces are TEXT, not components** (2026-08-01, founder round — [docs/29 §4b](29-runs.md))
  — the ghost pill (`.liveact`) and its synced twin the run card (`.runcard`) both shipped as
  bounded wells (fill · hairline · radius; the card carried a second hairline above its foot) and
  both lost them on the same ruling: *the box goes and the animation stays — the sheen IS the
  affordance that something is alive*. A live surface sits in a transcript made of plain messages,
  so it gets **no container of its own**; structure comes from spacing and, for a tree, its indent.
  Two consequences worth stating because both shipped as defects: a fill that read as a *highlight*
  inside a card reads as a *floating grey bar* without one, so `.leg`'s fill now marks only a row
  the human has **opened** — and the sheen has to be on the element that is actually alive, which
  for a run is its `.legname` (the step), not the `.legverb` beside it. New live surfaces inherit
  this: sheen + spacing, never a well.
- **The peek row** (2026-08-01 — run legs) — a list row that hides a second layer earns its
  affordance on **hover only** (`opacity: 0` → `1`), so the resting list is unchanged; the row
  itself becomes the button, and what it opens unfolds **in place** beneath it rather than in a
  modal. The escalation out of an in-place unfold names its scope (`view subagent activity ›`, not
  `more ›`) and its sibling that shows everything says so too (`view full activity`) — when one
  surface gains a filtered twin, **both** labels change or neither is legible.
- **The workspace tab strip** (2026-07-30 — [docs/36](36-workspace-tabs.md); **moved to the side
  dock** in the rail-ink round 3, 2026-09-04) — the SIDE DOCK's own strip, at the top of the dock
  column at the frame's right edge, above whatever the active tab renders. Tabs are 9px
  top-rounded, quiet at rest (`--muted`, transparent border) and take the dock's own `--panel`
  fill + hairline when active, so the active tab reads as *part of the surface below it* rather
  than a button on top of it. **One anatomy across the kinds:** icon · label (ellipsised, max
  ~190px) · ✕. **The conversation is not a tab** — it is the sheet, always on screen — so there is
  no tab 0, no pulse and no unread count on it any more; `file`, `terminal`, `browser`, `review`
  and `whiteboard` (docs/38) are peers and are closable. **A dirty tab shows a dot where the ✕
  lives** — the universal editor contract, and the only place in the product a glyph is replaced
  rather than added. The `＋` wears the rail's **row-menu recipe** (one line per row, an icon, no
  sublabels — `Open here` · `Create`); *New chat* left it, because a chat is the sheet's subject
  and not something that opens in this column. The right end carries exactly one control: the
  fold. Nothing else earns permanent chrome there. What the strip left behind in the sheet is the
  **sheet's head row** (`SheetHead`, same classes): a destination's own controls on the left
  (Code mode's workspace header), the room's rail on the right (bell · crew · views).
- **The review tab and its verdict bar** (2026-07-31 — [docs/36 §13](36-workspace-tabs.md),
  `mockups/review-in-tab.html`) — a tab that carries a **decision**, and the fifth tab kind. Its
  header keeps the file header's rhythm (38px, mono, a right-hand mode segment) so it reads as a
  sibling of a file tab, and adds one thing on the left: a **kind chip** in the phase's own colour
  — `--plan` for a plan review, `--ship` for a release plan, `--planrev` for a design review.
  **The chip, the mode segment, the button wording and the badge are all data**, bound from one
  record (`{ artifact, gate, verdict[] }`); there is no second review component and there must
  never be one.
- **The whiteboard tab and its snapshot grounds** (2026-08-05 — [docs/38](38-whiteboards.md),
  `mockups/whiteboards.html`) — the sixth tab kind, and the second **"the canvas is the canvas"**
  ruling after xterm: Excalidraw keeps its own island chrome inside the pane, follows the app's
  light/dark via its theme prop, and is never restyled into the token system. Above it, ours: a
  38px header in the file-header rhythm — mono `whiteboard /` path · title (double-click renames) ·
  `#room` chip naming the filing · saved state · the Share pill. Snapshot stills are exported
  **light, once**, and dark themes view them through Excalidraw's own inversion filter
  (`.wbsnapimg`) — one still serves every theme. Tiles and thread cards render stills only; a live
  canvas in a list is how a 60fps budget dies. The nav item beside it renamed **Board → Tasks** the
  same day (label only — ids, FSM and docs keep `board`): two unrelated surfaces one row apart must
  not read as siblings.

  The **verdict bar** floats bottom-**centre**, `absolute` **inside the tab pane** — this is the
  exception the peek's rule anticipated, and it is legal precisely because it is scoped to a pane
  rather than fixed to the window, so it cannot collide with the capacity fly-up. A `--card` pill
  on a pop shadow: an optional **human-only** badge (`--violet` on `--violet-soft`, set from the
  FSM's own actor list, never from prose), the subject in plain words (*Your call on **the
  plan***), the pending-batch count as a `--link`-filled mono pip, then the buttons — affirmative
  in `.btn.accept`, the counter-verdict in `.btn.primary`. **A settled or superseded round shows
  the same bar with the buttons gone** and a sentence where they were (*Settled — revised into
  v5* · `Open v5 →`): the geometry does not move when the decision is no longer yours to make, so
  the absence of buttons is legible as an absence rather than as a different screen.

  Comments are **inline under the block they are about**, not in a right gutter — the overlay
  could afford 250px of margin because it took the whole window, and a tab cannot. A commented
  block keeps a `--link` rail so a scrolled-past batch stays visible in the margin.
- **The brain pill and its Roles popup** (2026-07-31 — [docs/10 §15](10-model-packs.md),
  `mockups/brain-config.html`) — **one pill everywhere**: a message sent from Home or a room becomes
  a conversation too, so the switcher must not change shape with the surface it sits on. It carries
  the seated crew's avatars (14px, 5px radius, overlapped −5px with a `--card` hairline) and states
  an override **in words** (`2 changed here`, a quiet `.brainscope` tok). **The control is never
  recoloured to indicate state** — a founder ruling, and it generalises: a chip that changes hue to
  mean something makes every other hue a question.

  "One pill" is a **skin** claim as well as a content one. Composer-row controls are flat at rest
  and take their border on hover or open — the family at `.cbox .row .cchip, .hrow .cchip,
  .hrow .hchip, .trow .cchip`, which is the ONE place they are described. `.trow` (the thread
  composer's row) was missing from it, so the pill arrived there wearing the bare `.cchip` ring,
  the only visible difference left between the thread pill and the Home one. **Adding a control to
  a composer row means adding its row to that selector**, not restyling the control.

  **A scrolling container cannot host a dropdown** — third time this has bitten, so it is a rule
  now, not an anecdote. `overflow-y: auto` clips absolutely-positioned descendants, so a menu
  anchored inside a scroller loses whatever falls outside it: the file pane's branch switcher
  (docs/36 §4.2), and here the model picker, whose top slid under the popup header. **The answer is
  always the same: take over the body.** Swapping the list for the menu keeps one surface, one
  scroller and one Escape — and it holds a fixed height, which a popover cannot. A back row
  (`‹ ROLE name`) is the way out, and Escape unwinds exactly one layer.

  The popup is **two tabs over one fixed height** (`.brtabbar` + a `372px` `.brbody`): switching
  tabs may not resize a surface the cursor is already on, so each pane scrolls inside the box
  rather than setting its own. Tabs reuse the `.roomtab` recipe (pill-grouped, `--card` when
  active) because they are the same act. Rows stagger in a beat apart (§7's entrance idiom) and the
  popup enters on `--dur-enter`, not `--dur-fast`: it is a surface, not a micro-interaction.
- **The floating file pane** (docs/36) — a dismissable `--card` pane **floating over** the right
  edge of the content area (inset 8px, ~200px, pop shadow), never a third column: it lists a
  worktree or a task's artifacts and a click **opens a tab**. It never renders a file inside
  itself — a doorway, not a viewer. Starts dismissed; its state is a **machine-local preference**,
  like the theme and the nav fold (§2), never synced. This is the docs/04 review-cockpit file
  tree, finally scoped to a task rather than to a folder you had to go find.
- **The peek** (docs/36) — when an agent posts while you are on a non-conversation tab, a
  dismissible `--card` slides in **bottom-RIGHT** of the content area: avatar · name · age · ✕,
  the actual sentence, and a click-through with its shortcut (`Reply in #1046 ⌘1`). Auto-dismisses;
  **never queues** — a stack of peeks is a notification centre, which is a different product.
  **Bottom-centre is not available and this is a rule, not a preference:** the capacity fly-up
  (`.foflyup`, `position: fixed; z-index: 120; justify-content: center` — [docs/22](22-capacity-failover.md))
  docks precisely there and follows the human onto every surface. The next floating card picks a
  third position; it does not pick a fight. A peek may only exist while the conversation tab is
  **inactive**, which is what keeps it from becoming a fourth thing narrating one piece of work
  (docs/29 §10).
- **Three tab strips, and which is which** (2026-07-30) — the "since v0.64 the only tab strip in
  the product" clause above is **superseded**; it was true of *sheet* tab strips and was never true
  of the dock's. Naming all three, because the ambiguity is a future defect:

  | strip | what it switches | when to use it |
  |---|---|---|
  | **`.roomtabbar`** — a room's surfaces (`Conversations · Board`, plus `Calendar · Library · Routines`), and since 2026-09-20 a destination's two lenses (`Scheduled › Routines · Calendar`, `.desttabs`) | **alternate views of one subject**, on its own line under the heading it belongs to, pill-grouped in a warm well | a container that genuinely has more than one lens. A count rides `.roomtabn`: a warm well when idle, `--sel-bg` when active, mono, **never accent-filled** — a tab count is information, not a notification |
  | **the workspace tab strip** — the side dock's open things | **different subjects held open at once**, each with its own kind and lifetime | the side dock only (rail-ink round 3). One per window. This is the only strip whose tabs are **closable** and whose contents the user created |
  | **the dock's `.docktabs`** | — | **RETIRED with the dock** (docs/36 §6). Do not revive it; its records became the workspace strip's |

  The distinction to hold onto: **`.roomtabbar` switches lenses on one thing you did not open;
  the workspace strip switches between things you did.** A panel about a *single* subject still
  earns **toks + drawers**, not tabs (docs/25) — that ruling is untouched, and it is why the task
  panel gains no strip of its own from this change.

- **The spine is the WORKSPACE strip** (amended 2026-08-07, v0.88.0) — the clause below is
  superseded in its *subject*, not its shape. **Projects moved into the nav column** as
  collapsible groups (the nav round): every project is visible, expandable, and creatable-in
  there, each header carrying its own `#` (channels) and `＋` (new chat here), with the section's
  `＋` making a project. So the strip stopped naming the active project and the face stopped
  listing them — a switcher for a list already on screen is the exact duplication the projects
  round spent itself removing, and the 8-dot cap meant the strip could never be the whole list
  anyway. **The strip now names the WORKSPACE**, carries workspace-scale liveness (an agent
  working *anywhere*) and its unread dot, and opens the **workspace menu**: All projects, the
  plan strip, Agents & machines, Retro, Settings, account. **Picking a project is the tree's job**
  — clicking a group's *name* makes it active (the destinations follow), the chevron beside it
  only folds. The v0.76 rule that wrote the strip still holds and is what forced this: *two
  strips at one edge, or two switchers for one list, is one too many.* Per-project settings stay
  on the Projects page — the rail switches, the page manages — which is now literally true.
- **The spine** (v0.76, `mockups/projects-rail-spec.html`) — a **30px transparent strip at the
  dock's outer edge** (`--projrail-w`, `.prail`) carrying the **work axis**: Home with what needs
  you, a hairline rule, the active project's slug in **vertical mono** (`writing-mode: vertical-rl`,
  `--body`), one quiet dot per other project, and the account tile in its foot.

  **The rule is the contract, and the contract is spatial.** Above it is the *workspace*; below it —
  and the whole nav panel beside it — is the *named project*. This exists because the project name
  used to sit at the top of the nav as its largest object, promising that everything under it
  belonged to that project, while one row did not: Home's count is workspace-wide by design
  ([docs/12](12-mission-control.md) §6, the one written deviation in [docs/06](06-taxonomy.md)).
  Two scopes under one heading. **Prefer re-homing an object over labelling the exception** — a tag
  reading *"across all projects"* was the alternative, and it explains a contradiction instead of
  ending it.

  It is deliberately the **fold tab's vocabulary** (vertical mono, no ground of its own, a hover
  lift) because it **replaces** it: `--navfold-w` is retired, `.navpanel[data-folded]` collapses to
  **zero**, and the fold's chevron and its unread dot moved in here. Standing a projects strip
  beside a fold strip would have put two strips at one edge, which is what §2's *"one fold idiom,
  not two"* forbids. The side effect is the good kind — a folded rail could never name its project;
  **30px now does**. Net frame cost is **−26px**: the strip takes 30, the deleted head gave back 56.

  Marks, and where they go: a **pulse** (`--prog`) above the name = an agent working in *this*
  project; a **solid dot** (`--text`) beside it = a room here has moved unseen; a **dot below** =
  work in *another* project. They coexist rather than taking turns, live dots sort first so the
  8-dot cap can never drop a busy project, and all of them read the **same `openRuns` watch** the
  Recents pulse does — one liveness signal, never a second query that can disagree.

  **A verb in a rail of places is still a row** — New chat lost its lifted card the same day. The
  card earned its ink while it sat above a Home row and a project head; once those left for the
  spine it became a button bolted onto a nav rather than part of one. The `＋` glyph and the `⌘N`
  hint carry the "this makes something" job; the caret lights on the row's hover, the way a channel
  row's gear does — and it is a **14px chevron at `--muted`**, not a 9px `▾` at .6 opacity, because
  that caret is the only sign the launcher holds a task and a routine mode as well.

- **The second face** (v0.76) — the spine swaps what the nav column *draws*: `rooms` (channels +
  Recents) or `projects` (the switcher). **Same column, same 266px, same transparent ground, no
  shadow and no scrim** — a popover floats on the window, a face is part of it, and that is the
  whole distinction. The first draft was a 216px panel *beside* the nav, which put two nav-shaped
  things on screen doing one job with the real nav dimmed behind looking abandoned. **Layout shift
  is 0px by construction, not by care:** both faces are literally the same box.

  **Hover is a shortcut, never the only door.** The strip lies along the window edge, where a mouse
  crosses it on the way to somewhere else constantly, so opening waits out a **140ms intent** delay
  and closing keeps a **240ms grace** (a diagonal reach onto a project row must not dismiss the
  thing under the cursor); the hover region is the spine **and** the column it opens into. A click
  on a hover-opened face **pins** it rather than closing it under the cursor; `⌘⇧P` opens it from
  the keyboard, `Esc` closes it, and folding the rail takes it with it. **Anything that only reveals
  on hover needs a visible affordance** — the `.prexpand` arrow, pointing out of the rail and
  turning back in when open, is that, and it was missing for exactly one build before the rail was
  found inert.

  The face is a **complete menu, not a fragment**: the workspace header, Home in full, the projects,
  then the two doors out. `All projects` still goes to the Projects page: **the rail switches, the
  page manages** (rename · archive · move channels), and neither grows into the other.

  **Both faces stay mounted**, stacked in one grid cell and crossed by `data-on`. Swapping by
  unmounting gave the incoming face an entrance and the outgoing one *nothing* — an instant cut,
  which §7 names as the thing never to ship — and it discarded the rooms face's Recents scroll
  position on every open, the exact cost `[data-folded]` keeps the panel mounted to avoid. Mounting
  both also makes the swap **interruptible**: flick the spine and the two faces cross without either
  restarting. The motion is **one gesture, not two coincidental animations** (§7): the projects face
  comes *out of the spine* (−14px) and returns to it while the rooms face steps aside the other way
  (+10px), enter on `--dur-enter`, exit on `--dur-exit`, mirrored for the right dock. Rows arrive on
  the house `nm-rise` stagger, a beat apart and capped. Never `display`.

  A project row is a **text row — name, live dot, gear** — the `.chan` anatomy exactly. It spent an
  afternoon as a card (logo tile, both rosters, a facts line, slim borders to keep two-line cards
  from running together) and was reversed the same day: three of them stacked read as a second
  Projects page crammed into a 266px rail, *a thing to parse rather than a list to pick from*. The
  lesson generalises — **"a project and a channel are both a place you pick from a list" is a claim
  about the ROW, not just about the hover state.** A rail row earns detail only when the detail is
  what you are choosing on; "who is on this project" is a page question, and the page is one click
  away. The live dot sits where a channel's unread dot sits, and the active row is the selection
  surface, not a checkmark.

- **Liveness is not a surface; the selection surface means selection** (2026-08-01) — the app's
  word for *selected* is the neutral card: `--card` fill + `--card-border` + `--shadow-card`,
  shared by `.srow.on`, `.chan.on` and every other "this is the one you picked". `.navhistrow`
  spent it on the wrong state twice, and the second correction is the rule:
  1. It lifted a **working** row onto that card, so in paper a thread an agent is inside was a
     white raised row three inches from the white raised row that is the thread you have *open* —
     and agents work across conversations while you are somewhere else entirely, which is exactly
     when that lands.
  2. Tinting it `--prog` instead separated the two and was **still one signal too many**: the row
     already carries a pulsing dot, the agent's name and a verb that animates.

  So a live row now paints **no ground at all**, and the neutral surface went to the state that had
  never had one — the rail had no `selected` at all, which is why the row you were standing in was
  the one row it could not point at. **Count the signals before adding a ground, and never spend
  the selection surface on anything but selection.**

- **A mixed-scope page labels the exception, not the rule** — Home is workspace-wide (docs/12 §6)
  with exactly one project-scoped list on it, *In flight*. The heading carries the **workspace**
  name, and *In flight* wears a `.hscope` tok naming the active project; *Needs you* wears nothing,
  because workspace-wide is what the whole page already says. Naming the active project in Home's
  own subtitle was the nav head's contradiction wearing a different hat — a page showing a blocked
  agent in `flowe-ai` under a subtitle reading `Acme Yoga`. **Tag the minority scope.**
  ▸ **Superseded for Home by the shell round** (2026-08-10): Home stopped having a mixed scope at
  all. Every section — queue, In flight, Recent — reads ONE visible filter (the header's
  project · channel pills, default All · All, persisted `nm:homescope`), so the `.hscope` tok
  retired with the silent active-project follow it labelled. The general rule stands for any
  OTHER page that mixes scopes; Home just stopped being one.

- **The shell round** (2026-08-10, George — visual contract:
  [mockups/home-nav-round.html](../mockups/home-nav-round.html), approved R3). One story in
  five idioms — Home reads, the stage writes, and the chrome tidies around them:
  1. **The nav grip.** The split stage's hairline grip at the nav↔sheet gutter: invisible at
     rest, a 3px pill on hover, `--ring` + a live px readout while dragging. Clamp **224–356**,
     default 320 (266 until 2026-09-12, then 290 that morning: George, "a bit too tight", then 320 that afternoon when the rail took the 16px reading step), double-click resets, ←/→ nudge ±12 on the focused `role="separator"`.
     Machine-local (`nm:navw`), never synced; drag sets `transition: none` (direct
     manipulation); the fold is untouched and still collapses to zero.
  2. **New chat is the primary pill** — 40px, `--brand` + `--brand-ink` + hover lift, ＋ · label ·
     mono `⌘N`, the launcher caret a quiet round glyph beside it. Its placement still earns a
     distinct stratum above Shortcuts; the 2026-08-30 action ruling replaces the near-white
     Graphite fill with the same NeuraMesh oak used by every decisive action.
  3. **The Shortcuts band** — mono kicker, then **Home · Tasks · Whiteboards · Automations ·
     Files**. Home is a destination again (the dashboard un-merged from New chat), and its badge
     is the band's ONE notification-treated count (`--link` fill — things waiting on *you*,
     read from the same askIds the tree dots read); every other badge stays informational.
  4. **Home is the briefing.** Greeting (two quiet lines — the report sentence is deleted, not
     conditional: the queue cards ARE the report), then **Needs you → In flight → Recent** in one
     scroller. The scope pills live on the **workspace strip's sticky rail** (R5, same day, live:
     a filter that scrolled away with the greeting was a filter you could forget you set), leading
     the crew clusters in the cluster family's own skin — 30px `--border2` pills with a leading
     glyph each (the grid for projects, `#` for channels), the accent-soft wash + × when set, and
     the shell owns the state (`nm:homescope`) because the shell renders the control. Home's own
     header carries nothing but the greeting — R4's card-pill row and its crew clusters both
     lasted one build each.
  4b. **Nav icon controls carry `data-tip`** (R4, live) — the section toggles, the launcher
     caret, the tree's ＋/⚙/🔍 and chevrons, the grip: native `title` in these rows was trap 10
     live. Controls hugging the nav's right edge open their label **leftward** (the `.wtico`
     geometry) — a centred bubble there is clipped by the scroller's `overflow-x: hidden`.
     The Shortcuts band collapses like every section (`secHd`, the same `nm:navSec` store).
     **A Code row closes the Chat band** (George, 2026-09-05 — the Code mode is new, and "users
     may not be used to switching at the top yet"): a DOOR onto the rail's Code mode, drawn under
     Marketing OS with the code glyph, never lit and never counted, and absent from Code mode's
     own band. Rule ② holds — it is a door, not a destination.
     And one etched rename: the archive toast's floating variant was `.archundo.shell` — it wore
     the APP SHELL's class name and inherited `height: 100vh`; it is `.afloat` now. **A variant
     class never borrows a layout container's name.**
     Recent is the docs/35 session list verbatim (`SessionList` over `historyRows` — the same
     derivation the rail and ⌘Y read), its heading carrying a search icon that opens the **⌘Y
     overlay, which stays the everything-lens**. No composer and no search field on Home: ⌘K is
     global chrome, and composing is the stage's whole job.
  5. **The New chat stage.** ⌘N, the nav pill and a project head's ＋ land on a centered column:
     the serif greeting whose **project name is the switcher** — the one `--fital` italic moment
     (docs/33 §5), `--link`-colored with a dotted underline; picking retargets the room chip and
     moves the active project. Below it THE composer (moved, never rebuilt) minus its project
     chip — the headline carries that fact — with, since 2026-09-11, **the foot inside the box**:
     the ghost suggestion pills (pre-drafted messages, never commands) on its left and the connector
     marks on its right (§8 Composer ▸ the foot). Send births the session and the thread mounts over Home.
     ▸ **Amended 2026-09-11 (the Home-threads round, George — visual contract
     [docs/design/home-threads-2026-09](design/home-threads-2026-09/plan.md)): the stage grows the
     ledger.** With threads to list, the stage is a page you read down: top-aligned, on `--col`, scrolling
     (`.stagewrap.ledgered`), the watermark gone. Under the composer: the ⌘Y overlay's filter chips
     (`.histovlfilter.ledgerfilt`), the project ScopePill in the rail's quiet label skin (unset: no border,
     no fill) on the shell's scope memory (key `home`), and a search well that is a DOOR to ⌘Y, then two groups and never the day buckets — the
     asks under an amber `NEEDS YOU · n` kicker (`.sgroup.ny`), the rest under `RECENT`, capped at 40, `Show n more` lifting
     the cap in steps of 40 (the rail's idiom; a new narrowing starts at the first step), and
     `Search every conversation ⌘Y` as the floor. One row (`shell/HistRow.tsx`) for the overlay and Home;
     one derivation (`shell/ledger.ts` over `historyRows` + `makeRowMarks`). The bell keeps its count and
     popover on every other screen: a notification is still not a destination, Home is one. **The
     composer's menus open DOWNWARD here** (`.stagewrap.ledgered .hcomposer .chpop / .cprojpop / .brainpop /
     .mpop / .slashpop`): every composer menu anchors upward because every other composer sits at the
     bottom of its sheet, and at the top of a page that put them off the view (George, 2026-09-11, on the
     harness). The machine chip's height cap measures the side the CSS picks (`roomOn`).
  Plus the frame ruling recorded in §2 (the dock strip's retirement) and one structural fix:
  **the main section's top-right is ONE rail** — the room's crew clusters and views burger slot
  into the workspace strip's right end (`WTabStrip aux`) before the file-pane toggle, one flex
  row in one positioning context, and the whole `.wtright` family opens tooltips leftward from
  the right edge. Two absolutely-positioned groups sharing that corner is the defect class the
  Files-tooltip collision came from; the rail makes the overlap impossible rather than tuned
  away.

- **A workspace destination narrows on its own bar, never on the shell's scope** (2026-08-07) —
  Tasks, Whiteboards, Automations, Files, Skills and Activity are workspace-wide, and each wears
  the same `ScopeBar`: search, then project, then room. Before this they narrowed four different
  ways (the board read the active project, whiteboards took a channel id, automations took a
  channel id *and* an `inScope` predicate, Files filtered through `rowsInProject`) and every one
  of them hid rows the human never asked to hide, with nothing on screen admitting it. **A filter
  the human cannot see is a bug, not a default.** Reuse `ScopeBar`; do not grow a fifth mechanism.
  A surface with its own search box takes `q` from the bar rather than rendering a second field.
  ▸ **The bar is ELEVATED, not a warm well** (2026-08-13, George). Its field and pills shipped on
  `--panel2`, which in Cream Oak read as an oak slab against the white cards on the same sheet —
  §3's trap exactly: `--panel2`/`--panel3` are for *passive* containers, and an input you type into
  with the pills you click beside it are the most interactive things on the page. Both take
  `--card` + `--card-border` + `--shadow-card`, hover lifts by **shadow**, and the row is one
  stratum because it is one band. Focus keeps `--card` and adds the ring: `.wfsearch:focus-within`
  used to swap to `--panel`, which **is** `--bg` in Paper and Cream Oak, so focusing the search
  dissolved it into the page. `--accent-soft`/`--sel-bg` stay reserved for the *set/open* states.
  The rail's compact twin (`.railscope .scopepill .cchip`) is insulated at (0,3,0) and deliberately
  stays a transparent `--border2` pill — it sits on the dock, not on a sheet of cards.

- **A destination with two bodies gets ONE bar, and its words are subheadings** (the Marketing OS
  desk round, 2026-09-17, George; visual contract
  [docs/design/marketing-os-desk-2026-09](design/marketing-os-desk-2026-09/)). Marketing OS is one
  page in reading order: the desk, the playbooks, the threads underneath as you scroll. Under the desk
  sits one bar (`.mkbar`): the filter pills at the LEFT (the ⌘Y / Home ledger chips, `.histovlfilter`,
  one recipe) and the section words at the RIGHT in the rail's kicker voice (`PLAYBOOKS · THREADS`,
  the count on the lit word only, the rail's rule). A word is not a tab. A click scrolls the page so
  the section's first group head lands under the bar (420 ms on `--ease`, the §7 hand-off), the
  section's own pills take the left slot (the old set leaves in `--dur-exit`, the new one rises in
  with `nm-rise`, one chip after another), and the bar sticks to the sheet's top with a hairline and
  `--shadow-card` (elevation over outline). Scroll-spy lights the word on a manual scroll too, so a
  click and a scroll end in the same state. Two controls stacked at the left of a row that has room
  at the right read as waste (George, on round 2): the pills and the words share ONE line. The
  "nests in the nav, never a tab strip" ruling above holds, because nothing here is a second surface,
  only a second place on one page. The rules are pure (`views/mkosdesk.ts`, tested).

- **Code is one conversation column beside one evidence pane** (2026-08-31, George — live web and
  desktop review). Do not add a permanent internal thread rail: the workspace rail already lists
  every task, while the Code column's history button and landing recents handle local switching.
  The Code tab, history, ＋, thread header, composer, and Plan/Act controls therefore occupy the
  left side of a single resizable split; Changes, Files, Work Plan, Checkpoints, and Terminal begin
  at the evidence pane's own x-coordinate in the shared workspace strip. Terminal is an evidence
  tab, not a shell workspace tab: opening it keeps the Code conversation and composer mounted,
  and switching evidence tabs keeps the terminal session alive.

  The empty/new state is still a working surface: animated NeuraMesh mark, “What can I do for
  you?”, compact connection state, scrollable recents, then the real composer. Plan/Act, Project,
  and Model live inside that one composer surface, with the context row directly under its
  attachment/permission/send row. Project and Model are shared `.cchip` controls and both open
  upward.
  At the minimum composer width they own independent flex shrink boundaries and ellipsise; labels
  never paint across each other. The project chip uses the shared `ProjectChip` implementation,
  and its `＋ New project` action follows the ordinary plan gate.

  Code owns one execution model per thread, so its control is a direct **Model** picker—not the
  multi-role Brain/Packs editor used by collaborative chat. It starts with Project default, groups
  the real model catalog by provider, marks configured models as available, disables unavailable
  models in place, and puts a compact Connect action on every unconfigured provider. Connect opens
  Workspace settings at that provider; credentials never enter the Code transcript or browser
  session metadata. Choosing a model changes only this thread and never changes repository policy.
  Once the machine resolves an inherited developer model, the trigger and inheritance row name
  that model and keep **Project default** as its provenance label; “Project default” alone is not
  an adequate model identity. Managed NeuraMesh models stay product-opaque: show **NM Cloud
  Starter v1** / **NeuraMesh managed**, never the backing vendor model id that can change.

  History markers describe action mode, not generic health: quiet Plan tasks use a hollow planning
  marker, quiet Act tasks a solid execution marker, active work the one thinking orb, and only
  warning/error states override those semantics. Completion must not turn an entire history list
  green. Recent rows reuse the left-rail thread typography and name project · repository · state.
  The composer/editor split keeps a full-height invisible drag target but draws only one short,
  thick centered lever—parallel full-height rules create a false extra column.

  Code recents and the active transcript hide native scrollbar gutters. Recents still load more
  rows incrementally as the list is scrolled; an active transcript instead reveals one compact
  down-arrow above the composer whenever the reader leaves the latest message, and removes it at
  the bottom. The Plan/Act segment and adjacent Project/Model chips inherit the composer's quiet,
  borderless-at-rest control skin so the footer reads as one control family inside one frame.

  Healthy Code connectivity is invisible: it is the expected state and must not consume a landing
  row. Connection chrome appears only while the runtime is checking or when it is unavailable, so
  every persistent status surface explains a blocked action or gives a next step.

  Product navigation calls the destination **Code**. The underlying coding runtime is
  implementation detail and must not appear in labels, transcript roles, errors, tool cards,
  tooltips, or empty states. Plan-to-Act is a contextual confirmation card
  directly above the composer, not instructions telling a person to toggle and resend. Reasoning
  may stream inside one disclosure while active, then collapses when useful output begins.

  Decisive approvals, send buttons, and picker Apply buttons use `--brand`/`--brand-ink` in every
  theme, including hover. `--accent` remains the word for selection and status. File attachment is
  the shared paperclip/attachment-tray idiom; Code must not invent a repository-specific file
  picker style.

- **A destination has no close button** — `SubPage`'s × is the thread-sheet convention: it belongs
  to an OVERLAY that covered the room you were standing in, and closing restores exactly that
  context. A **nav destination** has no covered context, so the × asks "close to *what?*" — a
  question the nav itself already answers. Workspace Files wore one until 2026-08-07 because it
  was a sub-page before it was a destination. The rule: if it is reachable from the nav, it gets
  the `.topbar` header the workspace pages use (title · `.desc` · right-aligned `.actions`), and
  the room-scoped views (Tasks, Whiteboards, Automations) carry no page header at all — the room
  tab strip above them is already the label. **Ask what the back-out is before drawing a ×.**

- **The folder tile is the thing it holds** (Workspace Files, 2026-08-07) — a folder in
  Workspace Files is the **project**: it wears the project's own detected `logo_url`, its rooms as
  mono pills, and an **access row** of the agents registered to those rooms. No coloured folder
  glyph — dark stays achromatic (§4) and the project's mark is the tile's one identity object. The
  silhouette is CSS on `--card`: a 56×11 tab at `top:-9px` that overlaps **2px into** the card so
  its own fill covers the card's top border. Overlap by 0 and the tab's bottom edge meets the
  card's top edge as two hairlines 1px apart — trap 9b, caught in this round's review.
  The access row exists because **an ACL nobody can see is an ACL nobody trusts**: registration to
  a channel is what lets an agent read a file, and until this round that rule was real but
  invisible, so "can rex read this?" was unanswerable from the UI. Any surface that grants read
  access states who it grants it to — the upload room picker names the readers on every option.

- **A grid surface skips the reading column** — `--col` centres surfaces you read *down*. Workspace
  Files, the board and the whiteboard shelf are read *across*: width is information (more folders,
  more columns), not measure. In a file table only the name column is elastic
  (`minmax(0, 1fr)`) and every meta cell is `white-space: nowrap`, so a row is exactly one line
  tall and the name ellipsises before any column is crushed. **A name cell is a block, never a
  flex row** — `text-overflow` does not apply to a flex container, so a name beside a star or a
  badge overran its neighbour at narrow widths (caught in review, same round).

- **A disclosure over a fact you already show** (2026-08-11) — when a card carries a *count* of
  things that exist somewhere (`5 runs so far`, `3 attachments`), the count line **becomes** the
  door: a caret, a hover wash, `aria-expanded`, and the list opening in place. Do not grow a second
  button beside the card's existing actions — the Automations card already carried Pause and
  Remove, and a third control would have read as a third verb rather than "look closer at the
  sentence you just read". Three rules make it behave:
  - it opens with `grid-template-rows: 0fr → 1fr` over `--dur-enter`, so the panel animates to its
    OWN height — two rows and eight both open correctly with no measured pixel value;
  - the panel stays **mounted** while shut (contributing zero height), which is what gives the
    *close* a transition instead of a disappearance;
  - **no count, no door.** A routine that has never run keeps a plain, unclickable line — a
    disclosure over nothing is a control that punishes curiosity.
  Revealed rows use the house entrance idiom (§7 `nm-rise`, staggered ~32ms), and each row shows
  what actually **differs** between entries: every run of one automation titles its thread the
  same way, so a list of titles is N copies of one line — the row leads with the time and carries
  the run's last message.

- **An absent control beats a disabled one** where the state has a different move. A closed task's
  composer is not greyed out, it is replaced by the card that reopens the task (docs/25 §1c). A
  disabled textarea still reads as somewhere to type; you learn otherwise by trying and failing.

- **Order lists by what people look for** (2026-08-11) — the channel strip sorted by slug, which is
  an order about *names*. Names are never why you are looking for a room. Rooms sort by traffic now
  (`chanOrder`: message count desc, slug breaking ties), and the ruling reaches the SQL that serves
  channels so every surface listing rooms agrees. Ties fall back to a stable key so quiet rooms
  don't shuffle between loads. **Any cap makes this load-bearing**: the strip folds past two chips,
  so under slug order the room you live in could sit inside a `+N`.

- **The phone's shell** (mobile-cloud round, 2026-09-05 — `docs/design/mobile-cloud-2026-09/plan.md`,
  D1–D2, D11–D13). The frame model survives the move to 390px by collapsing to ONE row, **the head**:
  the Porch mark · the workspace name with its `▾` (a switcher only when there is something to switch
  to) · the **cloud-machine pill** — the `cloudMachine` glyph coloured by `machineState()` (green
  awake · warm waking or refused · dim asleep · muted unknown), which is the whole telemetry of a
  machine you cannot see, and a door to Compute · the **credit ring** (§8 CreditRing rules unchanged:
  absent when it cannot read, no digits at rest, warm below a fifth) · the search magnifier (S3) · your
  tile (→ Settings). Every tab shows it, so a machine that fell asleep is never a surprise on the next
  screen. **The tab bar is the rail's mode switch**: Home (Chat mode's list) · Code · Routines · Tasks
  — each a destination, none a stack of sub-tabs (the nesting rule holds). Team retired with the round:
  "what a machine is serving" is a line on that machine's Compute card, not a tab. **Compute** is the
  member-machines page at phone scale: kind tags in mono, one elevated card per machine (name · kind
  tag · the one-line reason with its state mark `●/☾/○` · a mono facts line `up 2h 14m · seen 3m` ·
  who it serves · its ONE action, `Wake now`, offered only where it can succeed), the credits card
  (the ring · a serif number · three ledger lines · the refill sentence; **no purchase link — App
  Store 3.1.1**), the sharing switch, then the teammates' machines as rows (owner · grant · state
  icon). Individual collapses to one card — the runner IS your machine — because a page that says
  "your machine" and "the cloud" about the same pod is lying twice. Icons are the desktop's, verbatim
  (`client-core/icons.ts` is GENERATED from `ui/icons.tsx` and asserted against it): the phone draws
  them with `react-native-svg`, and the Feather set retired — one glyph vocabulary or none.
  **The phone's sessions** (S3, D3–D8): the session row is the docs/35 §3.2 anatomy verbatim (glyph ·
  title + snippet · chip · room), drawn by ONE component everywhere a session is listed; the row's
  chip says the LEG a task stands in (`build` · `review` · `accept?`), never the FSM noun. The
  needs-you cards are the elevated stratum with their buttons intact — a card you cannot act on from
  the queue is a card that should not be in it. The composer is the desktop's card recipe at phone
  scale (the textarea, then the chips row, then the round brand send); its **machine chip** shows the
  forecast machine's name with the cloud glyph even on Auto, and only the popover's ✓ says whether
  that is a pick or a forecast — the same reading the desktop chip gives. A phone send writes
  `birth_origin = 'web'` and, on Auto, no designation: the ladder decides live, and the thread's head
  says `auto` until a run says where it ran. **Emoji on the iOS 26.3 simulator draw as boxes** in
  every app, Safari included (evidence: `docs/evidence/mobile-cloud-2026-09/s3/simulator-emoji-probe-safari.png`);
  a device check is the only proof of emoji, and no code should be written to "fix" the simulator.
  **Routines · Calendar on the phone** (S4, D9–D10): the two Automations surfaces are a SEGMENT under
  the head (the nesting rule; the segment recipe is `--panel3` track · `--card` thumb), the routine is
  a card because it carries controls (Pause · Edit · Remove — the two-step's second press says
  "Remove — sure?"), and its run ledger is the door (no count, no door). The calendar's firings come
  from ONE projection, `scheduleFirings` in shared — the desktop grid walked its own loop over
  `nextScheduleRun` and the phone would have been a third answer to "when does this fire".
  **Code on the phone** (S5, D12): conversation first, evidence a segment away — the Engineering OS's
  phone-width rule; explicit controls, never gesture-only. Reasoning folds into one disclosure
  ("Thought for Ns"), tool receipts fold into rows, the approval card is the one elevated object and
  shows the paths before anything is applied, Plan·Act rides the composer's control row with the chips
  icon-only at this width (the note line under the box says the words). ONE reducer: the Engineering
  client model (`domain` · `remote` · `activity` · the protocol) moved to shared so the desktop, the
  browser and the phone reduce the same events through the same code. A Code session's id is a bare
  uuid — it IS the synced row's id (0135) — and a lane stays open across screen navigation, because a
  pending approval belongs to the channel that asked it.

  **Onboarding on the phone** (S6, D15–D20): the wizard is the browser wizard one screen per step —
  the step ring (an oak arc on the panel3 track, the count in mono inside) and the step's name as a
  kicker, the eyebrow · serif title · body sub · mono hint voice on every step, fields as warm wells
  (the address row keeps its host as a mono prefix), the machine tile (glyph in a soft well · name ·
  the fleet's word in mono · the breathing dot — warm while it wakes, green when it answers), provider
  rows whose mode is a word on a pill because "subscription" and "API key" are the decision, letter
  tiles for the crew (the identity-well idiom; the one face that never renders as a box), the reveal
  as a three-column grid with a green dot per seated agent. Continue rides --brand; Back is the
  hairline pill; a refusal is the server's own sentence under the field. The join moment and the
  setup tracker are pinned cards on Home above the queue — the setup card folds to a one-line pill
  and retires itself once every item is done, never dismissed by hand.

  **The terminal on the phone** (S8, D11): the pane is the whole surface, so the chrome is one head
  (machine tok · state tok) and one foot — the **key row** of what a software keyboard cannot type
  (↵ · esc · tab · ^C · ^D · arrows) as hairline chips on a warm well, scrolling horizontally, and a
  **paste line** that appears only when asked. Send normalises iOS's smart punctuation on the way to
  the shell; ↵ is a key, never a side effect of pasting. A refusal is a card with a sentence, never
  an empty black rectangle — the docs/42 rule, at phone scale.

  **Words and tap targets on the phone** (George, 2026-09-05): every string a person reads follows
  ASD-STE100 (CLAUDE.md #11) — no em dashes, no semicolons, active voice, simple tenses, one idea a
  sentence. A section with a clear title carries no explanatory line under it: the line is deleted,
  not shrunk. Busy states say **Please wait…** rather than a verb in `-ing`, with two deliberate
  exceptions kept because they are the product's own words on every client: **Thinking…** for a
  model's reasoning, and the mono status words the fleet supplies. Controls are sized for a thumb:
  a **button is 50px tall** with 22px of side padding at full size and **38px** for the `sm`
  variant inside a card's control row; ghost pills match the `sm` height; composer chips are 34px.

  **The store frames are the app** (S9): the App Store screenshots are captured from the running app
  at the slot's exact size (an iPhone 14 Plus simulator is 1284×2778), never resampled and never a
  design canvas standing in for a screen that changed. A designed frame is legal, but only when its
  art matches the shipped shell, and App Review 2.3.3 is the reason rather than taste.

## 9. The traps (etched — check these in review)

Each of these shipped as a real defect at least once during the revamp:

1. **Cream creep** — a card/modal/list defaulting to `--panel2/3`. If it hosts controls, it's
   elevated white. (Hit: modals, skills, marketing rail, onboarding crew — four times.)
2. **Amber focus outlines** — Chromium's UA outline picking up the OS accent on elements without
   custom focus. The global quiet ring covers this; never add per-component outlines.
3. **Border-swap hovers** — hover must read as light (shadow/wash), not a recolored border.
4. **Double focus rings** — a textarea glowing inside its already-ringed composer. Text controls
   stay exempt.
5. **Small buttons** — if a primary action isn't a comfortable pill, it's off-contract.
6. **Flipped tooltips entering from off-screen** — mirrored anchors need mirrored offsets.
   ▸ **Both edges, and per-CONTROL** (2026-08-17). The rule was only ever written for the nav's
   right edge; a control near the LEFT edge whose tip is wider than itself clips on the other
   side just as surely (the scope chip's "Filter by project", 40px into the scroller's
   `overflow-x: hidden`). And the fix must be scoped to the control, never the container: a
   blanket `.navscoperow [data-tip]` overrode the trailing magnifier's existing right-flip and
   sent *its* bubble off-screen — this trap, recreated while fixing this trap.
7. **Emoji faces** — any surface minting emoji avatars is regressing v0.49.
8. **Theme drift** — a `tokens.css` hex change without its `client-core` mirror fails CI; a theme
   change needs all its mirror points (win/bg/card/link/shadow…) in **both** files.
9. **One-theme verification** — UI evidence must show cream **and** graphite minimum (doctrine
   §10 says both themes beautiful, not one).
9b. **Hairline pile-up** — a separator at every boundary. Two rules 4px apart (a drag grip AND the
   panel border it sits against), or a strip fenced top *and* bottom *and* tinted, read as noise.
   Structure comes from spacing and material first; a hairline is for separating two documents,
   not two paragraphs. The design studio carried eight before the 2026-07-28 pass; it carries two.
9c. **Rails and gutters where a conversation lives** — the tick rail is the channel feed's
   affordance (a day of history worth scrubbing). A task thread and the studio lane are read top to
   bottom: no rail, no native gutter.
10. **Raw selects / native titles** — chips and `data-tip` exist; using the native controls in a
    user-facing row is off-contract.
13. **A menu under its own scrim** (rail-ink round, 2026-09-04) — `.projmenu-scrim` sits at z-index
    420 to catch the click-away; a menu mounted at 61 sat UNDER it, so every item click closed the
    menu and nothing ran. It shipped in the first cut of the folder menu and read as "the popup
    doesn't work" (George). Any menu paired with that scrim lives above 420.
12. **A card in a card** (rail-ink round, 2026-09-04) — an agent message body drawn as a hairline
    on `--panel` (the thread's own colour) with an answerable card inside it drawing a second
    hairline on `--card` five points lighter: two edges, no material, and the eye reads a box in a
    box. The unit card hit it first (2026-08-26); rex's question card made it a founder ask. The
    rule is §3's: prose is ground, the human's bubble is the one hairline a said thing gets, and a
    card is elevated exactly once.
11. **A cap sorted by the caller** (2026-08-11) — a helper that slices "the first N" must sort
    BEFORE it slices, not after. `stripChannels` sorted only the survivors, so the caller's order
    silently decided who survived; it read correct for a year purely because every caller happened
    to hand it a sorted array. Sorting the visible slice makes the *row* look right while the
    *choice* of what is in the row is arbitrary.

## 10. Enforcement & verification

- **Token parity is CI** — the client-core ↔ tokens.css THEMES test (resolves one level of var
  aliasing). Invariants in code, not etiquette (doctrine §4).
- **Design evidence is Electron** — `webContents.capturePage` via
  [capture-evidence-electron.mjs](../scripts/capture-evidence-electron.mjs) and the preview
  harness (`?theme=` / `?calm=1`); headless-Chrome screenshotting wedges on app timers. Evidence
  PNGs ride the PR (`git add -f docs/evidence/…` — the directory is gitignored by default).
- **The live walkthroughs** — `desktop-live` (CDP :9223) and `desktop-onboard` (fresh profile +
  `NM_FORCE_ONBOARDING`, :9224) launch entries exist to re-drive any flow for real screenshots.

## 11. How we design at NeuraMesh (the process)

**Any user-facing feature beyond a simple text change gets a design review before
implementation.** No exceptions for "small" — the cream-creep class of defect is born from
skipping this.

1. **Design first.** Board work already enforces this structurally (the design gate,
   [docs/14](14-design-stage.md): `todo → designing → design_review`, designer mockups in-thread,
   `approve_design` HUMAN-ONLY). Work arriving outside the board follows the same shape: a
   mockup — self-contained HTML studied from the **real tokens** (extend
   [mockups/cabinet-revamp.html](../mockups/cabinet-revamp.html) when it's an app surface) — or a
   preview-harness screenshot round, reviewed **before** code.
2. **The approved round is the contract.** Implementation matches it; the reviewer gates on it;
   deviations go back to design, not into "while I was here" drift.
3. **Build on the system.** New surfaces compose existing idioms (§8) and tokens (§4–7). A new
   token, stratum, or idiom is a *design-system change* — it lands in this doc in the same PR, or
   it doesn't land.
4. **Verify like you mean it.** Cream + graphite screenshots from the real app (or harness) in
   the PR; check the traps list (§9); motion within budget; reduced-motion path works.
5. **This doc is alive.** Founder rulings on look and feel get recorded here (with date) so the
   next feature inherits them instead of relitigating them.
