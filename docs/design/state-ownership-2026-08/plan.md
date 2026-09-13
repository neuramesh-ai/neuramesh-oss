# State ownership — who owns what in the shell (2026-08-16)

The modularization round ([modularization-2026-08](../modularization-2026-08/plan.md)) took
~34,000 over-cap lines to 5,596 and then stopped, because the seven files left resist the same
technique. `App.tsx` is 2,995 lines and holds **135 `useState` hooks**; `TaskThread` declares 127
bindings with no cluster over 21 lines. Neither has a seam left to cut. What they have is an
ownership question, and this round answers it with measurements rather than taste.

The first slice already shipped: `shell/useScopeMemory.ts`. It is the template — measure who
reads what, move the state to its owner, and leave the shell only the job the shell alone can do.

## 1 · What the measurement says

Every one of App's 135 states classified by who reads it — the JSX carved into destination
regions, then each state's reads attributed:

| verdict | count | meaning |
| --- | ---: | --- |
| **spine (shared)** | 51 | two or more destinations read it — `nav` (134 uses), `current` (131), `view` (99), `roster`, `chans`, `auth`, `boot` |
| **shell chrome** | 48 | only the shell reads it — modal flags, dock position, section collapse |
| **derivation-only** | 20 | never reaches the JSX; internal to App's own effects |
| **destination-local** | 16 | exactly one destination reads it |

**Only 16 of 135 can move down.** That is the finding, and it is smaller than it looks from the
outside. But the states are not the volume — what travels with them is:

| bundle | bindings | predicted | **actual** |
| --- | ---: | ---: | ---: |
| Memory | 15 | 54 | **54** |
| Board | 9 | 38 | **14** |
| Library | 6 | 176 | **7** |
| Crew | 9 | 206 | **5** |
| Home | 8 | 101 | *no owner* |
| Invites | 6 | 88 | *shell chrome* |
| | | 567 | **~80** |

> **The prediction was wrong and the correction matters more than the number.** Attribution was
> done per *statement*: any top-level statement mentioning a bundle member was counted whole. A
> 96-line `peekNode` that says `libraryAll` once put 96 lines on Library's total. Measure what
> moves, not what mentions.
>
> Home and Invites turned out to have no owner to move into at all. Home's region is 299 lines
> reading **96** bindings — not a boundary — and the invite flow is the workspace switcher and the
> first-run banner, which is chrome. They were never destination-local in the sense that mattered.

## 2 · Why most of it is behaviour-neutral

The scope-memory slice forced a product question ("does a filter survive navigation?") because
the state outlived the destination. Most of these do not:

- **`mem` already discards.** Its effect gates on `view !== 'memory'` and calls `setMem(null)` on
  the way out. Moving it into `MemorySurface` changes nothing a user can see.
- Most of the rest are one-shot fetches with the same shape (`wsInvites`, the lesson editor's
  four states, `ideaDraft`).
- **Two are live subscriptions and are the real decision.** `journeyEv` is `nm.watchJourney` —
  it feeds the board's phase spectrum and nothing else. `library` is `nm.watchLibrary(room)` —
  it feeds the room's Library tab and nothing else.

For those two, moving the state down moves the *subscription* down: it attaches when you open the
destination and detaches when you leave. Today both stay attached, so the data is warm when you
arrive. After, there is a brief empty state on first paint.

## 3 · The three options

**A · Move the 16 down.** Each destination owns its local state, its fetches, and its two
subscriptions. *(Executed 2026-08-16: ~80 lines left App, not 567 — see the correction above.
`App.tsx` 2,995 → 2,929.)* Behaviour-neutral except the two watches.
Days, not weeks, and every step is verifiable by the existing 16-shot harness.

**B · Split the shell itself.** The 48 chrome states are the modals, the docks, the section
collapse. A `<ShellChrome>` boundary or a shell context would take them out of `App()`. This is
the larger structural move and the only one that gets `App.tsx` near the cap — but it touches
every overlay in the app, and the overlays are not uniform (`retiredOpen` is a section collapse,
`moreOpen` and `viewMenuOpen` are flyouts, the rest are modals), so a single `overlay` state
would change modal semantics rather than relocate them.

**C · Accept the shell.** 99 of 135 states are genuinely shell-wide (51 spine + 48 chrome). A
shell that owns nav, tabs, modals, auth, boot, the workspace and project switchers, the composer
and the peek is a large object however it is filed. Standing exception, exit condition written.

## 4 · Recommendation

**A now, C for the remainder, B only if it earns itself later.**

A is real work with a real payoff and almost no product risk — and the two subscriptions it does
touch are exactly the kind of decision this round exists to make explicit. C is honest about what
a shell is: `nav` has 134 references, and no filing system makes that number smaller. B is the
one to be suspicious of, because collapsing 22 non-uniform overlay flags into one state is a
behaviour change dressed as a refactor, which is the thing this whole round keeps catching.

Doing A does **not** bring `App.tsx` under 250, and no honest version of this plan does. The
question C answers is whether that is a failure or a fact.

## 5 · The decision this needs from a human

For `journeyEv` and `library` — the two live subscriptions:

1. **Move them down.** The watch lives with the destination. Simplest ownership, and the empty
   state is one frame on a local replica read.
2. **Leave them in the shell.** The data stays warm; the shell keeps two subscriptions it does
   not itself render.
3. **Move them down behind a shared cache**, the way `useScopeMemory` remembers filters — the
   destination owns the subscription, the shell remembers the last rows.

## 6 · Order of work

1. The four behaviour-neutral bundles first — Memory, Invites, Board, Home (281 lines).
2. Crew and Library after the subscription decision (382 lines).
3. Re-measure. If `App.tsx` lands where this plan predicts (~2,400) the remainder is C.
4. `TaskThread` and `ConvoThread` get the same treatment as a second round, using whatever this
   one teaches — the docs/25 zones are the natural owners there.

## 7 · What actually happened (2026-08-16)

Four bundles moved — Memory, Board, Library, Crew. Two could not, because they had no owner.

**The line count is not the result.** `App.tsx` went 2,995 → 2,929, which is nothing. What
changed is the coupling:

| surface | props before | props after |
| --- | ---: | ---: |
| `MemorySurface` | 14 | **3** |
| `LibrarySurface` | 4 | **1** |
| `AgentsSurface` | 22 | **18** |
| `BoardSurface` | 18 | **15** |

`MemorySurface` used to be handed fourteen things by a parent that read none of them. It now
takes three — the rooms, the current room, the projects — and owns its recall fetch, its room
picker and its lesson editor. That is the change worth having, and no line count shows it.

**Both subscriptions moved and both are covered.** `nm.watchJourney` (the board's phase spectrum)
and `nm.watchLibrary` (the room's shelf) now attach with their destination. The preview fixture
serves `watchJourney` and the board renders 15 spectra, so the shot exercises the moved
subscription rather than passing over an empty one.

**Two simplifications fell out of ownership**, both deletions rather than moves: Memory's effect
no longer tests `view !== 'memory'`, and the board's journey watch no longer tests `authed`.
Neither gate could ever be false once the component only mounts inside that view, in a signed-in
shell. A condition that cannot fail is the same defect as an assertion that cannot fail.

**Verdict on the rest: C.** 99 of App's 135 states are shell-wide (51 spine, 48 chrome). `nav` has
134 references. There is no filing system that makes a shell smaller than the shell's job, and
the next honest move on `App.tsx` is not another ownership pass.
