#!/usr/bin/env node
// The size-ratchet keeper (docs/design/modularization-2026-08/plan.md §2).
//
//   --update     re-measure every over-250 file and write lint-ratchet.json. Caps only
//                ever go DOWN: a file that grew keeps its old cap (and so fails lint,
//                which is the point); a file now at or under 250 leaves the list.
//   --self-test  prove the gate can fail: every ratchet path must exist on disk, and a
//                planted 300-line violation must produce a max-lines error through the
//                real config. An audit that cannot fail reports success forever.
//
// Measurement runs through ESLint itself (same skipBlankLines/skipComments counting as
// the rule), via a probe pass that raises every cap to Infinity and reads the counts
// from the rule's own message.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ESLint } from 'eslint';

const RATCHET_PATH = new URL('../lint-ratchet.json', import.meta.url);
const ratchet = JSON.parse(readFileSync(RATCHET_PATH, 'utf8'));
const mode = process.argv[2];

// Count max-lines overages with the real config, caps neutralized so every file
// reports its true size against the base 250.
async function measure() {
  const eslint = new ESLint({
    overrideConfig: [{ rules: { 'max-lines': ['error', { max: 250, skipBlankLines: true, skipComments: true }] } }],
  });
  const results = await eslint.lintFiles(['.']);
  const sizes = new Map();
  for (const r of results) {
    for (const m of r.messages) {
      if (m.ruleId !== 'max-lines') continue;
      const counted = Number(/\((\d+)\)/.exec(m.message)?.[1]);
      if (!Number.isFinite(counted)) throw new Error(`unparseable max-lines message: ${m.message}`);
      sizes.set(r.filePath.replace(`${process.cwd()}/`, ''), counted);
    }
  }
  return sizes;
}

// A test file's length tracks the SURFACE IT COVERS, not a failure to modularize: splitting a
// table-driven suite by line count hides which behaviours are asserted together, which is the
// opposite of what the cap is for. Tests keep the blanket 800-line guard in eslint.config.mjs —
// loose enough never to force a split, tight enough to catch a runaway file — and are never
// given a per-file burn-down entry. Policy set 2026-08-15 (founder call).
const IS_TEST = /(\.test\.tsx?$|(^|\/)test\/)/;

if (mode === '--update') {
  const sizes = await measure();
  const next = {};
  for (const [file, counted] of [...sizes].sort()) {
    if (file in ratchet.standing) continue; // standing exceptions are hand-managed
    if (IS_TEST.test(file)) continue; // tests are policy-capped, never burned down (see below)
    const prior = ratchet.files[file];
    // shrink-only: a grown file keeps its old (smaller) cap and fails lint until split
    next[file] = prior === undefined ? counted : Math.min(prior, counted);
    if (prior !== undefined && counted > prior) {
      console.error(`ratchet: ${file} grew (${prior} -> ${counted}); cap stays ${prior} — split it or hand-raise with a reason`);
    }
  }
  const dropped = Object.keys(ratchet.files).filter((f) => !(f in next));
  ratchet.files = next;
  writeFileSync(RATCHET_PATH, `${JSON.stringify(ratchet, null, 2)}\n`);
  console.log(`ratchet: ${Object.keys(next).length} burn-down entries${dropped.length ? `; retired: ${dropped.join(', ')}` : ''}`);
} else if (mode === '--self-test') {
  const stale = [...Object.keys(ratchet.files), ...Object.keys(ratchet.standing)].filter((f) => !existsSync(f));
  if (stale.length) {
    console.error(`ratchet self-test FAIL: stale entries (file gone — prune them): ${stale.join(', ')}`);
    process.exit(1);
  }
  // Plant a violation through the real config: a virtual 300-line source file.
  const eslint = new ESLint();
  const planted = Array.from({ length: 300 }, (_, i) => `export const line${i} = ${i};`).join('\n');
  const [res] = await eslint.lintText(planted, { filePath: 'packages/shared/src/__ratchet_selftest__.ts' });
  const caught = res.messages.some((m) => m.ruleId === 'max-lines');
  if (!caught) {
    console.error('ratchet self-test FAIL: a planted 300-line file produced no max-lines error — the gate is broken');
    process.exit(1);
  }
  console.log(`ratchet self-test OK: ${Object.keys(ratchet.files).length} entries all exist; planted violation caught`);
} else {
  console.error('usage: node scripts/lint-ratchet.mjs --update | --self-test');
  process.exit(1);
}
