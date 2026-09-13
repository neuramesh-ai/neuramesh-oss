# The rail's two views: Recents and Projects

> **Status:** BUILT on the offscreen harness, 2026-09-12 (George picked direction A on the canvas the
> same day: "lets go with A, makes sense"). Visual contract: the canvas
> [Rail Recents and Projects](https://claude.ai/code/artifact/25169737-dfeb-4878-99e2-9c92628290f7)
> (A in both states and both themes, A2 with the scope row, the B glyph toggle, the C both-at-once and
> the D second-segment alternates). The artboards are the `*.dc.html` files beside this plan, generated
> by `build.mjs`. Evidence: [rail1-projects-dark](evidence/rail1-projects-dark.png) ·
> [rail2-recents-dark](evidence/rail2-recents-dark.png) · [rail3-recents-cream](evidence/rail3-recents-cream.png)
> · [rail4-projects-cream](evidence/rail4-projects-cream.png) · [rail5-recents-more-dark](evidence/rail5-recents-more-dark.png)
> (spec: `apps/desktop/scripts/nav-recents-shots.json`).

## 1. The ask

George (2026-09-12): "provide a way for users to filter the left nav either by recents (which shows all
threads in a flat design style fully under the recent) or projects (what we have today), easy to switch
in between based on users preference". And, with the pick: "slightly increase the default width of our
left nav, its a bit too tight".

## 2. What was decided

- **The kicker is the switch.** The band head reads two words, `RECENTS · PROJECTS`. The lit word is
  the view and carries the count (threads in Recents, folders in Projects). The dim word is the door,
  one click. Remembered per machine (`nm:navView`) beside the mode, like the theme.
- **Recents is the mode's rows flat**, newest first, the same one-line row as everywhere (glyph ·
  title · status word), in steps of 30 behind `Show n more`. No scope row: George picked the bare
  list. **Projects is the folders exactly as before.** Chat and Code both honour the preference.
- **One deviation from the canvas:** the fold-all chevron leads the head in both views. It folds the
  whole band (`nm:navSec.recents`), not the folders, so it belongs in front of the list's name whichever
  view is on. The canvas had drawn it in the right cluster for the Projects state.
- **The nav's default width is 290px** (266 before). The clamp stays 224 to 356.

## 3. What was built

| Piece | Where |
|---|---|
| The two-word head, `NavView` | `apps/desktop/src/renderer/src/views/NavGroups.tsx` (`NavGroupsHead`) |
| The flat Recents list with its steps, the `view` and `onView` props | `views/HistoryRail.tsx` |
| The preference, and the uncapped flat rows while Recents is on | `App.tsx` (three lines, under the ratchet cap) |
| The head's words, the flat step, the width fallback | `tokens.css` · `shell/useLayoutPrefs.ts` |
| The harness seed `?navview=recents` | `src/renderer/preview/main.tsx` |
| The rulings | `docs/33` §2 (the width) and §8 (the rail) |

Zero schema, zero sync, zero server change.
