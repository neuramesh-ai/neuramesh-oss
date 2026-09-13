// The library gate, at the parser. Run from apps/desktop:
//   pnpm exec tsx --test src/main/docdrop.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docDropParts } from '../renderer/src/docdrop';

const saved = '📄 **Brand guidelines** — saved to the library as `brand-guidelines.md`.\n\n# Brand\n\nbody text';
const proposed = '📄 **Messaging framework** — proposed for the library as `messaging-framework.md`.\n\n# Pillars\n\n1. One';

test('a SAVED doc reads as already on the shelf', () => {
  const d = docDropParts(saved);
  assert.ok(d);
  assert.equal(d.label, 'Brand guidelines');
  assert.equal(d.file, 'brand-guidelines.md');
  assert.equal(d.pending, false);          // no gate — it is already in the library
  assert.match(d.doc, /^# Brand/);
});

test('a PROPOSED doc is pending — this flag is the whole approval gate', () => {
  const d = docDropParts(proposed);
  assert.ok(d);
  assert.equal(d.label, 'Messaging framework');
  assert.equal(d.file, 'messaging-framework.md');
  assert.equal(d.pending, true);           // renders Approve; nothing is promoted until clicked
  assert.match(d.doc, /^# Pillars/);
});

test('the body is captured WHOLE — a truncated card would hide what is being approved', () => {
  const long = `${'line\n'.repeat(400)}end`;
  const d = docDropParts(`📄 **Big** — proposed for the library as \`big.md\`.\n\n${long}`);
  assert.ok(d);
  assert.equal(d.doc, long);
  assert.match(d.doc, /end$/);
});

test('anything that is not a doc drop stays a plain message', () => {
  assert.equal(docDropParts('just a normal reply'), null);
  assert.equal(docDropParts('📄 **X** — saved to the library as `x.md`.'), null);     // no body
  assert.equal(docDropParts('📄 **X** — sent to the library as `x.md`.\n\nbody'), null); // wrong verb
  // a header-only line with no blank separator is not the shape either
  assert.equal(docDropParts('📄 **X** — proposed for the library as `x.md`.\nbody'), null);
});
