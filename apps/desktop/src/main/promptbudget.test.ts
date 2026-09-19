// The prompt-size gauge AND the shrink-only ratchet over the static instruction surface
// (2026-08-18 audit, P0 + P3).
//
// Every run prints the measured table, so any test run doubles as the report the audit had to
// reconstruct by hand. prompts-ratchet.json (repo root) pins a budget per surface; growth past
// a budget fails here, in CI, with the number in hand — the corpus reached ~16k tokens per wake
// through six unmeasured feature rounds, and this is what makes the seventh impossible to miss.
// Raising a budget is legal but DELIBERATE: name what grew and why, in the same commit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { staticPayloadReport } from './promptmeter';

test('static payload report — the numbers every diet commit answers to', async () => {
  const { lines, totals } = await staticPayloadReport();
  console.log('\n── static instruction payload (chars, ~tok = chars/4) ──');
  for (const l of lines) console.log('  ' + l);

  assert.ok((totals['contract.orchestrator'] ?? 0) > 5_000, 'orchestrator contract composed to (nearly) nothing');
  assert.ok((totals['contract.worker'] ?? 0) > 1_000, 'worker contract composed to (nearly) nothing');
  for (const kind of ['triage', 'own'] as const) {
    assert.ok((totals[`registry.${kind}`] ?? 0) > 3_000, `orchestrator ${kind} registry weighed (nearly) nothing — did it stop building?`);
    assert.ok((totals[`registry.${kind}.tools`] ?? 0) >= 10, `orchestrator ${kind} registry lost most of its tools`);
  }
  // sweeps are scoped (2026-08-18): each carries its own small set — see SWEEP_TOOLSETS
  // monitor 14 → 12 (2026-09-19): create_task and propose_impl_plan left it, a self-check never creates work
  for (const [scope, minTools] of [['digest', 5], ['watchdog', 10], ['monitor', 12]] as const) {
    assert.ok((totals[`registry.sweep.${scope}`] ?? 0) > 500, `sweep.${scope} registry weighed (nearly) nothing`);
    assert.ok((totals[`registry.sweep.${scope}.tools`] ?? 0) >= minTools, `sweep.${scope} registry lost tools its prompt instructs`);
  }
  assert.ok((totals['registry.bus'] ?? 0) > 3_000, 'CLI bus defs weighed (nearly) nothing');
});

test('THE RATCHET: every budgeted surface fits its prompts-ratchet.json budget', async () => {
  const { totals } = await staticPayloadReport();
  const file = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'prompts-ratchet.json'), 'utf8')) as { budgets: Record<string, number> };
  for (const [surface, budget] of Object.entries(file.budgets)) {
    const measured = totals[surface];
    assert.ok(typeof measured === 'number', `prompts-ratchet.json budgets '${surface}' but the meter no longer measures it — remove the stale row or restore the surface`);
    assert.ok(measured <= budget,
      `'${surface}' grew past its ratchet: ${measured} > ${budget} chars. Shrink it back, or raise the budget DELIBERATELY in prompts-ratchet.json in this same commit, naming what grew and why.`);
  }
  // completeness: a measured surface with no budget grows silently — the exact failure this ends
  for (const key of Object.keys(totals)) {
    if (key.endsWith('.tools')) continue;
    assert.ok(key in file.budgets, `the meter measures '${key}' but prompts-ratchet.json has no budget for it — add one`);
  }
});
