// Turn budgets as a CONTRACT, not a table of numbers.
// Run: pnpm exec tsx --test src/main/harness/budget.test.ts
//
// The `own` budget was chosen for one reason — a fan-out has to survive being halved repeatedly and
// still clear BUDGET_FLOOR on the last child — and that reason is invisible in the literal. These
// tests state it, so a future "let's trim own to 15 minutes" fails here instead of silently turning
// a three-way design round into a two-way one at run time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TURN_BUDGETS, BUDGET_FLOOR, TURN_KINDS, TOOL_KINDS, OWNING_KINDS, WORKING_KINDS } from '@neuramesh/shared';
import { planFanout, planSpawn } from './subagents';

const spec = (label: string) => ({ role: 'designer' as const, prompt: 'draw a direction for the landing page', label });

test('an owning turn can fund a three-way fan-out — the whole reason it is not `triage`', () => {
  const fan = planFanout(TURN_BUDGETS.own, [spec('A'), spec('B'), spec('C')]);
  assert.equal(fan.length, 3);
  for (const { spec: s, decision } of fan) {
    assert.equal(decision.ok, true, `child ${s.label} was refused: ${decision.reason}`);
    assert.ok(decision.budget!.wallMs >= BUDGET_FLOOR.wallMs, `${s.label} fell under the wall floor`);
    assert.ok(decision.budget!.contextTokens >= BUDGET_FLOOR.contextTokens, `${s.label} fell under the token floor`);
  }
  // and the owner keeps enough left to actually synthesise what came back
  const spent = fan.reduce((n, f) => n + (f.decision.budget?.wallMs ?? 0), 0);
  assert.ok(TURN_BUDGETS.own.wallMs - spent >= BUDGET_FLOOR.wallMs, 'nothing left for the owner to reconcile with');
});

test('the same fan-out from a triage budget starves — which is why the kind is separate', () => {
  // Not a regression guard: this is the JUSTIFICATION. Folding `own` back into `triage` reintroduces
  // exactly this, and it fails as a silently shorter fan-out rather than as an error.
  const fan = planFanout(TURN_BUDGETS.triage, [spec('A'), spec('B'), spec('C')]);
  const refused = fan.filter((f) => !f.decision.ok);
  assert.ok(refused.length > 0, 'triage funding a full three-way fan-out would make `own` pointless');
});

test('a single spawn from an owning turn leaves the owner more than the child', () => {
  // `share = 0.5` of the REMAINDER, so the first child can never take more than half
  const d = planSpawn(TURN_BUDGETS.own, spec('only'));
  assert.equal(d.ok, true);
  assert.ok(d.budget!.wallMs <= TURN_BUDGETS.own.wallMs / 2);
});

test('every turn kind has a budget, and none is below the floor it must fund', () => {
  for (const k of TURN_KINDS) {
    const b = TURN_BUDGETS[k];
    assert.ok(b, `${k} has no budget`);
    assert.ok(b.wallMs >= BUDGET_FLOOR.wallMs, `${k} cannot fund even one child`);
    assert.ok(b.contextTokens >= BUDGET_FLOOR.contextTokens, `${k} has no room for context`);
  }
});

test('`own` is declared a working kind and may spawn — the two facts it exists for', () => {
  assert.deepEqual([...OWNING_KINDS], ['own']);
  assert.ok(WORKING_KINDS.includes('own'), 'an owning turn produces the deliverable it answers for');
  assert.ok(TOOL_KINDS.spawn.includes('own'), 'an owner that cannot fan out is just a slow router');
  assert.ok(TOOL_KINDS.park.includes('own'), 'nobody else is left holding the task to wait on CI');
});
