#!/usr/bin/env python3
"""Build NeuraMesh Sans from the pinned upstream Geist release.

Rung 1 of the house face (docs/33 §5): NeuraMesh Sans is a renamed build of Geist, outlines
untouched, so the app renders exactly as it did before the rename. The pipeline is the point:
the name table, the license lineage, the web subsets and the phone's static cuts all come out
of this one script. Rung 2 (redrawn figures, punctuation, letters) replaces only `upstream()`
with a fontmake build of Geist's published sources.

    python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt
    .venv/bin/python scripts/build.py

Outputs are committed: files/*.woff2 (web, one per unicode range), files/*.ttf (the phone's
400 / 500 / 600 cuts), neuramesh-sans.css and manifest.json. Apps never run this script.
test/fonts.test.ts holds the committed outputs to the manifest and to the name-table contract.
"""
from __future__ import annotations

import hashlib
import io
import json
import sys
import urllib.request
from pathlib import Path
from urllib.parse import quote

from fontTools.subset import Options, Subsetter, parse_unicodes
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[1]
FILES = ROOT / 'files'
CACHE = ROOT / '.upstream'

# vercel/geist-font main on 2026-06-01. The font there is Version 1.800, the same cut the apps
# shipped through @fontsource-variable/geist 5.2.9 before the rename, so the rename moves no pixel.
UPSTREAM = {
    'repo': 'vercel/geist-font',
    'commit': '10dc7658f13c38a474cde201bb09a4617267545b',
    'path': 'fonts/Geist/variable/Geist[wght].ttf',
    'sha256': '73894e0448cae90a92b6c2f8732b7bb9acb7b94c418bff559dad4a18e1de9659',
    'version': '1.800',
}
FAMILY = 'NeuraMesh Sans'
PS_FAMILY = 'NeuraMeshSans'
VENDOR = 'NMSH'
VENDOR_URL = 'https://neuramesh.app'
COPYRIGHT = (
    'Copyright (c) 2023 Vercel, in collaboration with basement.studio (Geist). '
    'NeuraMesh Sans is a Modified Version: Copyright (c) 2026 NeuraMesh, '
    'with Reserved Font Name "NeuraMesh Sans".'
)
DESIGNER = 'Andrés Briganti, basement.studio and Vercel (Geist)'
DESCRIPTION = (
    f'{FAMILY} is the NeuraMesh house face: a renamed build of Geist {UPSTREAM["version"]} '
    f'(https://github.com/{UPSTREAM["repo"]}), outlines unchanged, under the SIL Open Font License 1.1.'
)
LICENSE = (
    'This Font Software is licensed under the SIL Open Font License, Version 1.1. '
    'This license is available with a FAQ at: https://openfontlicense.org'
)
LICENSE_URL = 'https://openfontlicense.org'
# Name IDs that deliberately still say "Geist": the copyright lineage, the designer credit and
# the description. Every other record must carry the new name.
CREDIT_IDS = {0, 9, 10}

# The web faces: fontsource's five unicode ranges verbatim, so the browser loads exactly what it
# loaded before (the latin file on almost every page, the others only when a glyph asks for them).
SUBSETS = {
    'cyrillic-ext': 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F',
    'cyrillic': 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116',
    'vietnamese': 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,'
                  'U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB',
    'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,'
                 'U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
    'latin': 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,'
             'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
}
# The phone's cuts (apps/mobile/src/fonts.ts): expo-font registers each weight as its own family.
STATIC = {400: 'Regular', 500: 'Medium', 600: 'SemiBold'}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def upstream() -> bytes:
    """The pinned Geist variable TTF, fetched once into .upstream/ and checksummed on every build."""
    CACHE.mkdir(exist_ok=True)
    cached = CACHE / Path(UPSTREAM['path']).name
    if not cached.exists():
        url = f"https://raw.githubusercontent.com/{UPSTREAM['repo']}/{UPSTREAM['commit']}/{quote(UPSTREAM['path'])}"
        print('fetch', url)
        cached.write_bytes(urllib.request.urlopen(url).read())
    data = cached.read_bytes()
    if sha256(data) != UPSTREAM['sha256']:
        sys.exit(f'{cached}: checksum mismatch, refusing to build from an unpinned font')
    return data


def rename(font: TTFont) -> None:
    """Rewrite the name table: Geist becomes NeuraMesh Sans everywhere except the credit records."""
    name = font['name']
    ps_ids = {i.postscriptNameID for i in font['fvar'].instances if i.postscriptNameID != 0xFFFF}
    fixed = {0: COPYRIGHT, 8: 'NeuraMesh', 9: DESIGNER, 10: DESCRIPTION, 11: VENDOR_URL, 13: LICENSE, 14: LICENSE_URL}
    name.names = [r for r in name.names if r.nameID not in (7, 12)]  # no trademark, no designer URL
    seen: set[int] = set()
    for r in name.names:
        s = r.toUnicode()
        if r.nameID in fixed:
            r.string = fixed[r.nameID]
            seen.add(r.nameID)
        elif r.nameID == 3:
            r.string = s.replace('Geist', PS_FAMILY).replace('VRCL', VENDOR)
        elif r.nameID == 6 or r.nameID in ps_ids:
            r.string = s.replace('Geist', PS_FAMILY)
        else:
            r.string = s.replace('Geist', FAMILY)
    for nid, s in fixed.items():
        if nid not in seen:
            name.setName(s, nid, 3, 1, 0x409)
    font['OS/2'].achVendID = VENDOR


def assert_clean(font: TTFont, label: str) -> None:
    for r in font['name'].names:
        if 'Geist' in r.toUnicode() and r.nameID not in CREDIT_IDS:
            sys.exit(f'{label}: nameID {r.nameID} still names Geist: {r.toUnicode()!r}')


def subset_woff2(vf_bytes: bytes, unicodes: str) -> bytes:
    font = TTFont(io.BytesIO(vf_bytes))
    opts = Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.name_languages = ['*']
    opts.notdef_outline = True
    sub = Subsetter(options=opts)
    sub.populate(unicodes=parse_unicodes(unicodes))
    sub.subset(font)
    font.flavor = 'woff2'
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


def static_ttf(vf_bytes: bytes, wght: int) -> bytes:
    font = TTFont(io.BytesIO(vf_bytes))
    inst = instancer.instantiateVariableFont(font, {'wght': wght}, inplace=False, updateFontNames=True)
    out = io.BytesIO()
    inst.save(out)
    return out.getvalue()


def css(files: list[str]) -> str:
    head = (
        f"/* {FAMILY}, generated by packages/fonts/scripts/build.py from Geist {UPSTREAM['version']}\n"
        f"   ({UPSTREAM['repo']}@{UPSTREAM['commit'][:8]}), SIL Open Font License 1.1. Five unicode-range\n"
        "   faces, fontsource's ranges verbatim: the browser fetches the latin file on almost every page\n"
        "   and the others only when a glyph asks. Generated, do not edit: rebuild. */\n"
    )
    blocks = []
    for subset, ranges in SUBSETS.items():
        fname = f'neuramesh-sans-{subset}-wght-normal.woff2'
        assert fname in files, fname
        blocks.append(
            f'/* {fname} */\n'
            '@font-face {\n'
            f"  font-family: '{FAMILY}';\n"
            '  font-style: normal;\n'
            '  font-display: swap;\n'
            '  font-weight: 100 900;\n'
            f"  src: url(./files/{fname}) format('woff2-variations');\n"
            f'  unicode-range: {ranges};\n'
            '}\n'
        )
    return head + '\n' + '\n'.join(blocks)


def main() -> None:
    vf = TTFont(io.BytesIO(upstream()))
    got = vf['name'].getDebugName(5)
    if got != f"Version {UPSTREAM['version']}":
        sys.exit(f'upstream says {got!r}, the pin says {UPSTREAM["version"]}: update UPSTREAM together')
    rename(vf)
    assert_clean(vf, 'variable')
    buf = io.BytesIO()
    vf.save(buf)
    vf_bytes = buf.getvalue()

    FILES.mkdir(exist_ok=True)
    for old in FILES.iterdir():  # the directory is generated whole: a stale file is a lie
        old.unlink()
    outputs: dict[str, bytes] = {}
    for subset, ranges in SUBSETS.items():
        fname = f'neuramesh-sans-{subset}-wght-normal.woff2'
        outputs[fname] = subset_woff2(vf_bytes, ranges)
    for wght, style in STATIC.items():
        fname = f'{PS_FAMILY}-{style}.ttf'
        data = static_ttf(vf_bytes, wght)
        assert_clean(TTFont(io.BytesIO(data)), fname)
        outputs[fname] = data
    for fname, data in outputs.items():
        (FILES / fname).write_bytes(data)
    (ROOT / 'neuramesh-sans.css').write_text(css(list(outputs)))
    manifest = {
        'family': FAMILY,
        'upstream': UPSTREAM,
        'files': {n: {'bytes': len(d), 'sha256': sha256(d)} for n, d in outputs.items()},
    }
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    for n, d in outputs.items():
        print(f'{len(d):>8}  {n}')


if __name__ == '__main__':
    main()
