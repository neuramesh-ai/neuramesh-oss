import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { expect, test } from 'vitest';

// The committed fonts are build outputs. This test is the contract every consumer relies on:
// the files are exactly what the manifest says, the CSS names them all, and every name table
// says NeuraMesh Sans where the upstream said Geist (the credit records excepted, on purpose).
// It reads the binaries itself (sfnt + WOFF2 directories, brotli from node:zlib) so CI needs
// no Python.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = join(ROOT, 'files');
type Manifest = {
  family: string;
  upstream: { repo: string; commit: string; path: string; sha256: string; version: string };
  files: Record<string, { bytes: number; sha256: string }>;
};
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as Manifest;
const CREDIT_IDS = new Set([0, 9, 10]);

type Tables = Map<string, Buffer>;

function sfntTables(buf: Buffer): Tables {
  const num = buf.readUInt16BE(4);
  const tables: Tables = new Map();
  for (let i = 0; i < num; i++) {
    const rec = 12 + i * 16;
    const off = buf.readUInt32BE(rec + 8);
    const len = buf.readUInt32BE(rec + 12);
    tables.set(buf.toString('latin1', rec, rec + 4), buf.subarray(off, off + len));
  }
  return tables;
}

// WOFF2 §5.2: the known-tag table, indexed by the low six bits of each directory entry's flags.
const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

function base128(buf: Buffer, at: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[at + i]!;
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return [value, at + i + 1];
  }
  throw new Error('UIntBase128 longer than 5 bytes');
}

function woff2Tables(buf: Buffer): Tables {
  expect(buf.toString('latin1', 0, 4)).toBe('wOF2');
  const num = buf.readUInt16BE(12);
  const compressed = buf.readUInt32BE(20);
  let at = 48;
  const dir: { tag: string; len: number }[] = [];
  for (let i = 0; i < num; i++) {
    const flags = buf[at++]!;
    const idx = flags & 0x3f;
    const xform = flags >> 6;
    let tag: string;
    if (idx === 63) {
      tag = buf.toString('latin1', at, at + 4);
      at += 4;
    } else tag = KNOWN[idx]!;
    let len: number;
    [len, at] = base128(buf, at);
    // glyf and loca are transformed at version 0 (3 = untouched), every other table only at 1+.
    const transformed = tag === 'glyf' || tag === 'loca' ? xform === 0 : xform !== 0;
    if (transformed) [len, at] = base128(buf, at);
    dir.push({ tag, len });
  }
  const data = brotliDecompressSync(buf.subarray(at, at + compressed));
  const tables: Tables = new Map();
  let off = 0;
  for (const { tag, len } of dir) {
    tables.set(tag, data.subarray(off, off + len));
    off += len;
  }
  return tables;
}

function utf16be(raw: Buffer): string {
  const swapped = Buffer.alloc(raw.length);
  for (let i = 0; i + 1 < raw.length; i += 2) {
    swapped[i] = raw[i + 1]!;
    swapped[i + 1] = raw[i]!;
  }
  return swapped.toString('utf16le');
}

function names(tables: Tables): Map<number, string> {
  const name = tables.get('name')!;
  const count = name.readUInt16BE(2);
  const strings = name.readUInt16BE(4);
  const out = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    const platform = name.readUInt16BE(rec);
    const lang = name.readUInt16BE(rec + 4);
    const id = name.readUInt16BE(rec + 6);
    const len = name.readUInt16BE(rec + 8);
    const off = name.readUInt16BE(rec + 10);
    const raw = name.subarray(strings + off, strings + off + len);
    const s = platform === 3 || platform === 0 ? utf16be(raw) : raw.toString('latin1');
    if ((platform === 3 && lang === 0x409) || !out.has(id)) out.set(id, s);
  }
  return out;
}

function fvar(tables: Tables) {
  const f = tables.get('fvar');
  if (!f) return null;
  const axesOff = f.readUInt16BE(4);
  const axisCount = f.readUInt16BE(8);
  const axisSize = f.readUInt16BE(10);
  const instCount = f.readUInt16BE(12);
  const instSize = f.readUInt16BE(14);
  const axes = [];
  for (let i = 0; i < axisCount; i++) {
    const a = axesOff + i * axisSize;
    axes.push({ tag: f.toString('latin1', a, a + 4), min: f.readInt32BE(a + 4) / 65536, def: f.readInt32BE(a + 8) / 65536, max: f.readInt32BE(a + 12) / 65536 });
  }
  const psIds: number[] = [];
  const instOff = axesOff + axisCount * axisSize;
  for (let i = 0; i < instCount; i++) {
    const o = instOff + i * instSize;
    if (instSize >= 6 + axisCount * 4) psIds.push(f.readUInt16BE(o + 4 + axisCount * 4));
  }
  return { axes, psIds, instCount };
}

test('the committed files are the manifest, byte for byte', () => {
  expect(manifest.family).toBe('NeuraMesh Sans');
  expect(readdirSync(FILES).sort()).toEqual(Object.keys(manifest.files).sort());
  for (const [file, m] of Object.entries(manifest.files)) {
    const buf = readFileSync(join(FILES, file));
    expect(buf.length, file).toBe(m.bytes);
    expect(createHash('sha256').update(buf).digest('hex'), file).toBe(m.sha256);
  }
});

test('the phone finds exactly the three cuts it names', () => {
  for (const cut of ['Regular', 'Medium', 'SemiBold']) expect(existsSync(join(FILES, `NeuraMeshSans-${cut}.ttf`))).toBe(true);
});

test('the CSS names every web face once, as NeuraMesh Sans, and never Geist', () => {
  const css = readFileSync(join(ROOT, 'neuramesh-sans.css'), 'utf8');
  const urls = [...css.matchAll(/url\(\.\/files\/([^)]+)\)/g)].map((m) => m[1]!).sort();
  const woff2 = Object.keys(manifest.files).filter((f) => f.endsWith('.woff2')).sort();
  expect(urls).toEqual(woff2);
  expect(css.match(/font-family: 'NeuraMesh Sans';/g)?.length).toBe(woff2.length);
  expect(css.match(/font-weight: 100 900;/g)?.length).toBe(woff2.length);
  expect(css.match(/font-display: swap;/g)?.length).toBe(woff2.length);
  expect(css.match(/unicode-range: U\+/g)?.length).toBe(woff2.length);
  // the header comment credits the lineage on purpose. The declarations must not.
  expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('Geist');
});

test.each(Object.keys(manifest.files))('%s carries the NeuraMesh Sans name table and the OFL', (file) => {
  const buf = readFileSync(join(FILES, file));
  const tables = file.endsWith('.woff2') ? woff2Tables(buf) : sfntTables(buf);
  const n = names(tables);
  expect(n.get(16) ?? n.get(1)).toBe('NeuraMesh Sans');
  expect(n.get(1)).toMatch(/^NeuraMesh Sans( |$)/);
  expect(n.get(4)).toMatch(/^NeuraMesh Sans /);
  expect(n.get(6)).toMatch(/^NeuraMeshSans-[A-Za-z]+$/);
  expect(n.get(0)).toContain('Vercel');
  expect(n.get(0)).toContain('Reserved Font Name "NeuraMesh Sans"');
  expect(n.get(13)).toContain('SIL Open Font License, Version 1.1');
  expect(n.get(14)).toBe('https://openfontlicense.org');
  expect(n.get(7), 'no trademark record').toBeUndefined();
  for (const [id, s] of n) if (!CREDIT_IDS.has(id)) expect(s, `nameID ${id}`).not.toContain('Geist');
  expect(tables.get('OS/2')!.toString('latin1', 58, 62)).toBe('NMSH');
  const v = fvar(tables);
  if (file.endsWith('.woff2')) {
    expect(v?.axes).toEqual([{ tag: 'wght', min: 100, def: 400, max: 900 }]);
    expect(v?.instCount).toBe(9);
    for (const id of v!.psIds) expect(n.get(id)).toMatch(/^NeuraMeshSans-/);
  } else {
    expect(v).toBeNull();
    expect(tables.has('glyf')).toBe(true);
  }
});

test('the files stay inside the budget', () => {
  // docs/18: the latin face is on the cold-start path of every surface. Geist's was 29 KB.
  expect(manifest.files['neuramesh-sans-latin-wght-normal.woff2']!.bytes).toBeLessThan(40_000);
  expect(Object.values(manifest.files).reduce((sum, f) => sum + f.bytes, 0)).toBeLessThan(600_000);
});
