// The picker's LEGACY path. Run:
//   node --import tsx --test apps/desktop/src/renderer/src/lib/modelcatalog.test.ts
//
// Retiring an id removes it from the catalog but NOT from the agents and custom brains already
// holding it. The BrainBuilder's option list is what keeps those editable: it appends any role
// model the catalog no longer offers under a "Legacy" group. The 2026-09 reseat retired six ids at
// once, which made this path load-bearing for the first time, so it gets a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_GROUPS } from './modelcatalog';
import { modelLabel, LEGACY_MODELS, CURRENT_MODELS, MODEL_ID_SET } from '@neuramesh/shared';

/** mirrors BrainBuilder's modelOpts */
function optionsFor(roles: Record<string, string>) {
  const base = MODEL_GROUPS.flatMap((g) => g.models.map((m) => ({ value: m, label: modelLabel(m), group: g.provider })));
  const known = new Set(base.map((o) => o.value));
  const extras = [...new Set(Object.values(roles))].filter((m) => !known.has(m)).map((m) => ({ value: m, label: modelLabel(m), group: 'Legacy' }));
  return [...base, ...extras];
}

test('the picker offers exactly what the catalog offers', () => {
  const offered = MODEL_GROUPS.flatMap((g) => g.models).sort();
  const catalog = [...CURRENT_MODELS['claude-code'], ...CURRENT_MODELS.codex, ...CURRENT_MODELS.gemini].sort();
  assert.deepEqual(offered, catalog);
});

test('a brain still holding a RETIRED id keeps it, under Legacy', () => {
  // the exact case the 2026-09 reseat created for anyone with a custom brain
  const roles = { orchestrator: 'gpt-5.5', architect: 'claude-opus-4-8', developer: 'gemini-3.5-flash', reviewer: 'claude-sonnet-5' };
  const opts = optionsFor(roles);
  for (const dead of ['gpt-5.5', 'claude-opus-4-8', 'gemini-3.5-flash']) {
    const o = opts.find((x) => x.value === dead);
    assert.ok(o, `${dead} vanished from the picker — an existing brain would become uneditable`);
    assert.equal(o.group, 'Legacy');
  }
  // the seat that is still current stays in its provider group, not Legacy
  assert.equal(opts.find((x) => x.value === 'claude-sonnet-5')?.group, 'Anthropic');
});

test('every retired id still renders a human label, never a raw id', () => {
  for (const id of LEGACY_MODELS) {
    if (!MODEL_ID_SET.has(id)) continue;
    assert.notEqual(modelLabel(id), id, `${id} would render as a raw model id in the picker`);
  }
});

test('a legacy id is never duplicated into the offered list', () => {
  const roles = { developer: 'claude-sonnet-5' }; // all current
  const opts = optionsFor(roles);
  assert.equal(opts.filter((o) => o.group === 'Legacy').length, 0);
  assert.equal(new Set(opts.map((o) => o.value)).size, opts.length);
});
