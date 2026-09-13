# @neuramesh/fonts

NeuraMesh Sans is the NeuraMesh house face. Today it is a renamed build of Geist 1.800 with the
outlines unchanged, under the SIL Open Font License 1.1 (see LICENSE). The name is ours, the
pipeline is ours, and every app reads the family from this package.

## What ships

- `neuramesh-sans.css`: five `@font-face` blocks, one per unicode range. The desktop renderer,
  the browser client and the site import it.
- `files/neuramesh-sans-*-wght-normal.woff2`: the variable web faces, weight 100 to 900.
- `files/NeuraMeshSans-{Regular,Medium,SemiBold}.ttf`: the phone's static cuts. expo-font
  registers one family per weight (`apps/mobile/src/fonts.ts`).
- `manifest.json`: the upstream pin and a checksum per file. `test/fonts.test.ts` holds the
  committed files to it and to the name-table contract.

## Rebuild

```
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
.venv/bin/python scripts/build.py
pnpm test
```

The script fetches the pinned Geist release into `.upstream/` (gitignored), verifies its
checksum, rewrites the name table, subsets the web faces and instances the phone's cuts. Commit
`files/`, the CSS and the manifest together. Apps never run the script.

## Lineage and license

Geist is Copyright (c) 2023 Vercel, in collaboration with basement.studio, OFL 1.1 with no
Reserved Font Name. NeuraMesh Sans is a Modified Version under the same license, with
"NeuraMesh Sans" reserved. The credit stays inside the font: name IDs 0, 9 and 10 name Geist
on purpose, and nothing else does. The test enforces that.

## Next rung

docs/33 §5 records the plan. Rung 2 replaces `upstream()` in `scripts/build.py` with a fontmake
build of Geist's published sources (`sources/*.glyphspackage` in vercel/geist-font) that carry
NeuraMesh's own figures, punctuation and letters. Nothing downstream changes: same file names,
same CSS, same manifest contract.
