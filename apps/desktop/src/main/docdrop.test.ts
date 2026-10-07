// The library gate, at the parser. Run from apps/desktop:
//   pnpm exec tsx --test src/main/docdrop.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { docDropBody, scrubEmdash } from '@neuramesh/shared';
import { docDropParts } from '../renderer/src/docdrop';
import { fileDropBody } from './chatmode';

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
  assert.equal(docDropParts('📄 **X**: saved to the library as `x.md`.\n\nbody'), null); // another separator
});

// the server scrubs an agent's em dash into a comma (commrules.ts scrubEmdash, noEmdash on by default
// since #308), and this parser read only the dash, so every brand doc showed as raw markdown (2026-10-06)
test('each producer\'s body parses as the agent wrote it and as the server stored it', () => {
  const doc = '# Brand\n\n## Voice — plain\n\nbody';
  const bodies = [
    { from: 'host/marketing.ts, the bootstrap', body: docDropBody('Brand guidelines', 'brand-guidelines.md', doc), pending: false },
    { from: 'host/tools-context.ts, propose_library_doc', body: docDropBody('Messaging framework', 'messaging-framework.md', doc, 'proposed for'), pending: true },
    { from: 'chatmode.ts, a chat file', body: fileDropBody('Competitor teardown', 'competitor-teardown.md', doc), pending: false },
  ];
  for (const { from, body, pending } of bodies) {
    const stored = scrubEmdash(body);
    assert.match(stored, /^📄 \*\*[^*]+\*\*, (?:saved to|proposed for) the library/, `${from}: the scrub rewrites the separator`);
    for (const said of [body, stored]) {
      const d = docDropParts(said);
      assert.ok(d, `${from}: ${said.split('\n')[0]}`);
      assert.equal(d.pending, pending, from);
      assert.equal(d.doc, said.slice(said.indexOf('\n\n') + 2), from);
    }
  }
});

test('the daemon producers build the body with the shared shape, never a copy of it', () => {
  for (const [file, verb] of [['host/marketing.ts', ''], ['host/tools-context.ts', "'proposed for')"], ['chatmode.ts', '']] as const) {
    const src = readFileSync(join(import.meta.dirname, file), 'utf8');
    assert.match(src, /docDropBody\(/, file);
    assert.doesNotMatch(src, /📄 \*\*\$\{/, `${file} writes the shape by hand`);
    if (verb) assert.ok(src.includes(verb), `${file} posts its doc as a proposal`);
  }
});
