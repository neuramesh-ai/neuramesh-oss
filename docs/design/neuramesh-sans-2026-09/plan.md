# NeuraMesh Sans (2026-09-11)

The house face. Rung 1 shipped as `packages/fonts`: a renamed build of Geist 1.800 under the
SIL Open Font License 1.1 with the outlines untouched. This folder holds the research the rungs
rest on, so the next rung starts from measurements, not memory.

## What the reference is made of

The reference was the type in the Claude desktop app. That app bundles Anthropic Sans, and the
font's own name table credits it as "BSPK x Geist x Anthropic": a bespoke edit of Geist by BSPK
LLC, the same base NeuraMesh already shipped. Both fonts were instanced from their real files and
compared glyph by glyph after matching cap height and stem weight (`specimen.png`, and
`glyph-diff.png` where red is Geist only, blue is Anthropic Sans only, white is shared).

| Item | Geist 1.800 | Anthropic Sans 25.258 |
| --- | --- | --- |
| Axes | wght 100 to 900 | wght 300 to 800, plus opsz 16 to 48 (Text and Display cuts) |
| x-height, cap height | 0.53, 0.71 em | 0.54, 0.72 em |
| Weight match | 400 | 370 has the same stem |
| Text cut line length | baseline | 0.9% wider (Display cut 0.4% tighter) |
| Same shape | | I B F L v x i o |
| Lightly tweaked | | X H m p D l e b T c h n E U r |
| Redrawn or re-proportioned | | g J W N Q M V a y, every figure, the operators, brackets, punctuation heights, @ & % $ # |
| OpenType | eleven stylistic sets (ss01 to ss11), case, dlig, frac, tnum, pnum | drops the stylistic sets, adds onum and zero, kern and mark |
| Glyphs, hinting | 975, unhinted | 693, unhinted |

The skeleton is Geist. The work was an optical-size axis, a trimmed weight range, new figures and
symbols, and a handful of letters. Open question for rung 2: Geist's own stylistic sets were not
compared against the Anthropic choices, and some may already be the alternate wanted.

## The rungs

1. **Rename** (shipped). `packages/fonts/scripts/build.py` fetches the pinned upstream release,
   checks its sha256, rewrites the name table, subsets the five web faces and instances the
   phone's three cuts. `test/fonts.test.ts` holds the committed files to the manifest and to the
   name-table contract. No pixel moved: the old and the new font render the OG card identically
   in the same Electron, and every glyph the old build carried is identical in outline and
   advance at 400, 500 and 600.
2. **House face.** Replace `upstream()` with a fontmake build of Geist's published sources
   (`sources/*.glyphspackage` in vercel/geist-font). Draw the brand set: figures first (the board
   is numbers, so tabular figures and a slashed zero as defaults), then g J W Q @ &, the operator
   and punctuation set re-centred on the UI's optical middle, a kerning pass. The opsz axis is a
   Display master per weight, not a tweak. Nothing downstream moves: same file names, same CSS,
   same manifest contract.
3. **Commission.** BSPK (contact@bspk.xyz, Anthropic is on their client list) or basement.studio,
   who co-drew Geist. A Geist-based bespoke is the cheapest kind of commission because the
   skeleton exists.

Geist Mono stays until a mono rung is scoped. The Claude bundle carries no mono derivative either.

## Lineage and law

Geist is Copyright (c) 2023 Vercel, in collaboration with basement.studio, OFL 1.1 with no
Reserved Font Name. NeuraMesh Sans is a Modified Version under the same license and reserves its
own name, so the derivative stays open and nobody else can ship one called NeuraMesh Sans.
Anthropic Sans is proprietary (no license record in the file): studied, never copied.
