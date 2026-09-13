# Mobile design contract

The approved visual contract for the phone. Screens are built to this; each is verified in both
**Graphite** (dark) and **Paper** (light) — the canonical review pair since the Foundry round; Soft
dark and Cream oak also ship. Tokens come from `@neuramesh/client-core` (`THEMES`, kept in parity
with the desktop's `tokens.css` by a CI test); the glyphs from `client-core/icons.ts` (generated
from the desktop's sheet); the faces from `TYPOGRAPHY` — **Geist** for UI and display, **Geist
Mono** for kickers, chips, facts, buttons and code — bundled and registered before the splash hides;
the corners from `R` in `src/type.ts`, the desktop's radius ramp verbatim.

## Round 3 — the Foundry system (2026-09-09, `docs/evidence/mobile-foundry-2026-09/`)

The site (#468) and then the desktop and the HQ web client (#477) took the Foundry system: Geist and
Geist Mono, 3px controls in mono uppercase, corners that stop at 8, paper and graphite. George:
"then start making the changes on the mobile app as well". The phone is a port, not a redesign: the
same tokens, the same recipes, at phone scale. The simulator captures in both themes are the round
and the merge is the approval, as for the app.

- **Faces.** Geist carries UI and display (the serif retired with the desktop's); Geist Mono is the
  one mono (JetBrains Mono retired). Three cuts each, 400 · 500 · 600: `F.body(700)` folded to 600,
  `F.mono(600)` labels to 500, every `F.serif` to `F.display()` = Geist 500 with `F.tight(size)`.
  Italics are gone (the phone registers uprights only, so an italic fell back to the system face).
- **Tracking.** Mono labels are tracked tight (`F.track` = -0.2px at 10px, `F.tight(size)` =
  -0.02em), never letterspaced. Every positive `letterSpacing` inverted.
- **Shape.** `R = { xs: 3, sm: 4, md: 6, lg: 8, pill: 3, full: 999 }`, read from the desktop's
  `--r-*`. Controls, chips, toks, tags, segments and the FAB at 3; fields, menus, the composer card
  and the question card's field at 6; cards, sheets, popovers, modals and the human bubble at 8.
  Only dots, rings, faces, the credit ring and the round send stay round.
- **Buttons.** `Btn` is a 3px block in mono uppercase (13px, 12 for `sm`): primary fills with
  `--brand` over `--brand-ink` under the site's static 135° hatch (`Hatch`, an SVG pattern at 14%),
  ghost wears a `--border2` hairline, a disabled primary sits on `--panel3` in `--dim`. The thumb
  sizes hold (50px, 38px for `sm`). The hand-rolled buttons on the task, design-review, capture and
  gate screens compose `btnBox` + `btnText`, so one recipe covers every button.
- **Fields.** `Input` / `inputStyle`: the card ground under a `--border` hairline that turns to ink
  on focus, 6px, Geist 15 (mono 13 for slugs, commands and post text). Every raw `TextInput` on the
  wizard, capture, task, design-review, post, routine and repo screens wears it.
- **Cards.** 8px on `--card` with the `--card-border` hairline; no shadow on the darks (the
  desktop's `--shadow-sheet: none`), a 1px shadow on paper. Sheets and popovers are 8px with the
  grip bar kept.
- **Labels.** `labelText(t, size)` is the kicker, the chip and the section head voice: mono 500,
  uppercase, tight, `--dim`. The tab bar's labels are Geist 500.
- **Ground.** The light theme is paper already (client-core mirrors the desktop); the splash's light
  ground moves from the cream-oak `#f0e5d3` to paper `#f5f4f2`. The terminal page names Geist Mono
  first in its stack.
- **Enforced.** `test/type-ramp.test.ts` reads the ramp from tokens.css, checks the family names
  fonts.ts registers, and scans every screen for a `fontWeight`, a `fontFamily` literal, a positive
  `letterSpacing`, an italic or `F.serif`. A screen that escapes the ramp fails CI, not review.
- **Copy.** "Skip gate — accept" became "Skip the gate and accept" (CLAUDE.md #11).


## Round 2 — the cloud round (2026-09, `docs/design/mobile-cloud-2026-09/`)

The phone stops being a companion to a desktop and becomes a **client of the cloud plane**: you can
sign up on it, get a cloud machine, start sessions, and clear every gate — without a Mac. The approved
canvas (`mockup.html`, both themes, 25 artboards) and the decisions D1–D20 in `plan.md` are the
contract; this file summarizes what each slice lands.

- **S2 · the shell** — the **head** on every tab (mark · workspace ▾ · the cloud-machine pill coloured
  by `machineState()` · the credit ring · you); the tab bar as the rail's mode switch (**Home · Tasks**
  today; Code and Routines arrive with their slices; Team retired); **Compute** (your machine · credits
  · the runner · the sharing switch · teammates' machines, Individual collapsing to one card); Settings
  with the theme names Graphite · Paper · Soft dark · Cream oak. Primitives in `src/kit.tsx`: Kicker ·
  Card · Btn (pill; primary = brand) · Tok · Chip · Ring · Facts · Reason · Kind · Tile.
- **S3 · sessions** — **Home** = the needs-you queue (tasks on human gates + open decision cards, every
  card keeping its buttons: Approve plan · Accept and merge · the question's options and typed line) +
  the session list, day-grouped, in **one row anatomy** (`src/session-row.tsx`: a task wears its dial,
  a chat the speech glyph, a routine's run the clock; an open run swaps the glyph for the orb; a
  question waiting on you pulses at the trailing edge); the channel list retired as Home's body.
  **New chat** (`app/new.tsx`): the serif greeting whose project name is the switcher · ghost
  suggestion pills (pre-drafted messages, never commands) · the composer card with the room chip · the
  brain pill (the room's seated crew) · the **machine chip** (the shared forecast, origin `web`; Auto
  first with what it resolves to; a phone never offers "This Mac"). A send is a local insert carrying
  the birth columns (`src/send.ts`) and lands in its thread. **The thread** (`app/thread/[id].tsx`):
  crumb · title · toks (chat chip · the machine the session was born on · the crew), the hairline human
  bubble, unboxed agent prose, the question card as ghost pills + the pill field, the unit card as a
  LINE, attachments inline, the live line from open runs, the reply-to card on a reply-born thread.
  **History** (`app/history.tsx`): the one search field, project chips, the count, the same rows. A
  room opens to its session list (`app/channel/[id].tsx`); the task screen shares the rows and the
  composer card; Capture (park an idea) moved to the Tasks tab's header.
- **S4 · Routines · Calendar** (`app/(tabs)/routines.tsx`) — Automations' two surfaces nest under one
  head as a **segment** (a destination never grows a tab strip). Routines: a room narrowing in chips,
  one **routine card** each (`src/routine-card.tsx`: title · armed/paused/once chip · the cadence line
  · next run / last run · "n runs so far" as the door that opens the run history in place, each run a
  session · Pause/Resume · Edit · Remove as a two-step); New routine is the FAB → the **routine sheet**
  (`src/routine-form.tsx`: title · what each run asks · room · cadence pills · weekday · time or date,
  `schedule.create` with `routine: true` / `schedule.update`). Calendar: a Monday-start day strip with
  dots, the week's agenda in two lanes — firings projected through the shared `scheduleFirings` (the
  desktop's calendar walks the same function now) and scheduled posts — a paused routine dimmed, a
  draft saying it needs approval, the legend at the foot.
- **S5 · Code over the relay** — the **Code tab** (`app/(tabs)/code.tsx`): one row per synced
  `code_sessions` row in the one anatomy (the branch as the fact; the orb for a streaming turn, the
  ask pulse for an approval waiting on you, `done` for a settled one), a repo narrowing, the FAB.
  **New Code session** (`app/code/new.tsx`): the mark, "What can I do for you?", the composer with
  **Plan·Act**, the project chip and the machine chip (cloud machines only; icons only at this width —
  the note line says the words), the boot card when the machine sleeps. **The Code thread**
  (`app/code/[id].tsx`): the head (branch · machine toks, the approval chip), the evidence segments
  Transcript · Changes · Checkpoints · Plan, the transcript from the SHARED reducer (reasoning folded
  into "Thought for Ns", receipts grouped into rows, the approval card as the one elevated object with
  the paths before anything is applied, the "Continue in Act?" handoff card), the composer with
  Plan·Act. The lane: `src/relay.ts` composes `@neuramesh/relay-client` for Expo (the dev relay token
  on the harness, the Clerk bearer in production); `src/code-store.ts` holds the open channels and
  reduces their events — the transcript lives on the machine, never offline. The Engineering client
  model, reducer, contract and copy moved to `@neuramesh/shared` (the desktop re-exports).
- **S6 · onboarding** — **Welcome** (`app/sign-in.tsx`): the mark on its tile, "Your people. Your
  agents. Your projects.", Start free (the handoff page in sign-up mode, D15) and Sign in; the
  "download the desktop app first" sheet retired. The **arrival gate** (`app/onboarding/index.tsx`,
  D19): an unfinished wizard resumes at its Machine step (its workspace exists — a second is never
  minted), a membership in the replica goes straight to the tabs, otherwise the API decides:
  memberships → tabs, an invitation → **Invited** (`app/onboarding/invited.tsx`: "<host> is expecting
  you", the workspace tile, Join → `workspace.accept_invite`, "Set up my own workspace"), nothing →
  the **wizard** (`app/onboarding/wizard.tsx`, D16–D17, D20): the browser wizard one screen per step
  under the step ring — Workspace (name · address · the plan said out loud; Continue mints the
  workspace and the fleet provisions its machine) · Machine (the runner tile with the fleet's word,
  never a gate) · Keys (three provider rows with subscription/API-key pills, the starter door) ·
  Team (six letter-tile crew cards, names editable, the pack's brain as one fact) · Launch (the
  reveal grid, the stats, "Meet @rex" once the crew registered on the runner AND the replica has
  the rooms). The state machine is `onboarding-wizard.ts` in shared (order · guards · resume · the
  pack recommendation · `launchCommands`, the browser's `onboard` as data); the phone posts the
  list (`src/onboard.ts`). Meet @rex hands New chat the draft, #general and the runner as the chip's
  pick, so the first send is born on the cloud machine; the thread's reply wears the attribution
  line from its settled run ("on your cloud machine · replied in 4s"). **Home** gains the **join card**
  (`src/joined-card.tsx`: the member machine the join minted, its state, the sharing switch =
  `member.set_compute`) and the **setup card** (`src/setup-card.tsx`: the shared `onboardingItems`
  minus the mobile item, folding to a pill; Connect → Compute, Invite → the invite sheet whose
  refusal is the server's sentence, Get → the download page). Sign-out wipes the replica
  (`disconnectAndClear`) so the next identity never routes on the last one's rows.
- **S7 · push + deep links** — a notification is not a destination (D12): `src/deeplink.ts` is the ONE
  mapping from a push's payload to a route — a Code approval → `/code/[id]`, a gate or a card on a
  task → `/task/[id]`, a card in a chat → `/thread/[id]`, a room → `/channel/[id]`, a machine event
  → `/compute` — pure and tested (`test/deeplink.test.ts`, the phone's first vitest); the same routes
  answer `neuramesh://…` links by construction. The permission is asked **when it matters**
  (`askPushWhenItMatters`): the first reply an agent gives you, or the first approval a Code session
  waits on — once per install — never as a cold-start sheet; boot only re-registers a device whose
  permission is already granted. The banners themselves are the server's (S0.3: the Code approval
  joined the gates, cards and routine-done).
- **S8 · the terminal** — a shell on YOUR cloud machine (`app/terminal.tsx`), the vendor-login door
  for a member who only has a phone: `claude setup-token` and `gh auth login` complete in the
  vendor's own flow, on a machine you own. It is a **WebView running xterm.js over nm-relay**
  (`terminal/page.ts`, bundled by `scripts/build-mobile-terminal.mjs` into `src/terminal-html.ts`):
  the WebView owns its own socket — the phone's second relay edge, said out loud — and the screen
  hands it the relay url, the attach credential, the machine and the theme by message, four in and
  four out. The chrome is the session head (the machine tok, the state tok) plus the **key row** the
  software keyboard lacks (↵ · esc · tab · ^C · ^D · arrows) and a **paste line** whose Send
  normalises what iOS did to your command (`src/shell-text.ts`: `—version` back to `--version`,
  curly quotes back to straight) — a pasted script runs when you press ↵, never because it arrived.
  Doors: the machine card on Compute (**your own machine only** — a shell is the owner's), and the
  setup card's *Bring your subscription*, which now opens the terminal rather than a page about it.
  It never pretends: no relay on the build, or no machine yet, is a sentence in a card.

### The fix round (2026-09-06, `docs/design/mobile-fixes-2026-09/mockup.html`)

George ran the TestFlight build on a real device and found four things. The mockup is the contract;
each fix lands as its own slice.

- **The session list arrives in pages.** The list holds 25 sessions and grows as you reach the end,
  capped at eight pages. The queries take the page as a parameter, so the launch read is 26 threads
  and 26 tasks instead of 300 threads (each with a correlated subquery for its last message) and
  every task in the workspace, re-run on every message any agent wrote. A page arrives OVER the list
  rather than replacing it, because a re-running watched query reports nothing until it answers. The
  row is one fixed height, and Home renders a plain scroll view: with a bounded list, recycling was
  pure cost and it was losing every cell to a blank screen. The queue's dead "8 more wait for you"
  line is a control that reveals four at a time.

### Shipping it (S9, 2026-09-05)

Version **0.2.0**. The App Store listing (`appstore/APPSTORE.md`) is rewritten around the sentence
that changed: the phone is not a companion, you sign up on it and a cloud machine comes with the
workspace. The screenshots are the REAL app now, captured at the 6.5-inch size from a seeded
workspace (`appstore/screenshots/iphone-6.5/`); the designed 0.1.x frames in `appstore/marketing/`
show a shell that no longer exists and must not be uploaded. The build ran on George's word:
0.2.0 build 23 went to App Store Connect for TestFlight the same day.

### The copy and control pass (2026-09-05)

George read the built screens and set two rules for the whole app. **Every string is ASD-STE100**
(CLAUDE.md #11): no em dashes, no semicolons, active voice, simple tenses, one idea a sentence, and
no explanatory line under a heading that already says the thing. Busy buttons say "Please wait…"
instead of a verb in `-ing`; "Thinking…" survives because it is the product's word for a model's
reasoning on every client. **Controls are sized for a thumb**: a button is 50px tall with 22px side
padding, the `sm` variant is 38px, ghost pills match it, composer chips are 34px. The pass touched
every screen and the shared setup-tracker text the desktop reads too.

## Round 1 — the companion (2026-07)

1. **Sign in** — the Porch tile, "Continue in browser" (device handoff), tagline.
2. **Home** — the **Needs you · N** rail of human-gate cards, then the room list, a `+` FAB.
3. **Thread** — agent messages (emoji avatar · name · role · time), **nmq question cards** as tappable
   options + "type your own", a composer. Answering posts `**question** → answer` lines.
4. **Task detail** — state chip · assignee · branch · PR + CI · Definition of Done · the FSM gate
   actions (Accept, Request changes, Promote, Block/Unblock).
5. **Design review** — mockup rounds in a sandboxed WebView · Approve design / Request changes.
6. **Tasks** (the board) — one FSM column at a time with the next peeking; pager dots.
7. **Capture** — a sheet to park a backlog idea (`task.create backlog:true`).
8. **Push** — gates + questions reach the lock screen; a tap deep-links to the exact task / thread.
9. **Settings** — theme picker, per-kind notification toggles, account / sign out, version.

## Product rules (so the UI stays honest)

- Threads-first, not a dashboard — the needs-you queue surfaces exactly what waits on the human.
- The phone hosts no agents and holds no keys; it observes live work and sends decisions. Code needs
  an awake cloud machine, and the app says so rather than pretending.
- Actions are state-driven, never invented (Accept only on `done`; Approve design only in
  `design_review`); approving a plan or a design and accepting work are human-only.
- Nothing is bought in the app: the credit ring shows a balance, Compute names the refill; Team and
  credit packs stay on the web (App Store 3.1.1).
- Both themes must look intentional — every slice's evidence is captured in Graphite and Cream oak.
