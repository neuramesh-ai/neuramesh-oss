import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MachineStatus } from '@neuramesh/shared';
import { ensureMachine, ENSURE_TIMEOUT_MS, type EnsureDeps, type EnsurePhase } from '@neuramesh/relay-client';

/** a scripted machine: each poll pops the next status. Time is fake, so a five-minute timeout
 *  costs microseconds and the tests never sleep. */
function rig(statuses: (MachineStatus | null)[], opts: {
  id?: string | null; idAfter?: number; wake?: { ok: boolean; capped?: boolean }; cancelAt?: number;
} = {}) {
  let t = 0, polls = 0, wakes = 0;
  const phases: EnsurePhase[] = [];
  const deps: EnsureDeps = {
    machineId: async () => (opts.idAfter !== undefined && polls < opts.idAfter ? null : opts.id ?? 'm1'),
    status: async () => statuses[Math.min(polls, statuses.length - 1)] ?? null,
    wake: async () => { wakes += 1; return opts.wake ?? { ok: true }; },
    wait: async (ms) => { t += ms; polls += 1; },
    now: () => t,
    cancelled: () => opts.cancelAt !== undefined && polls >= opts.cancelAt,
  };
  return { deps, phases, wakes: () => wakes, polls: () => polls };
}

test('an online machine costs nothing — no wake, no boot screen', async () => {
  const r = rig(['online']);
  const out = await ensureMachine(r.deps, (p) => r.phases.push(p));
  assert.deepEqual(out, { ok: true, machineId: 'm1' });
  assert.equal(r.wakes(), 0, 'waking an already-online machine would reset its idle clock for nothing');
  assert.deepEqual(r.phases, ['connecting'], 'never say "starting" about a machine that is already up');
});

test('asleep wakes once, then resolves when it comes online', async () => {
  const r = rig(['asleep', 'unreachable', 'waking', 'online']);
  const out = await ensureMachine(r.deps, (p) => r.phases.push(p));
  assert.deepEqual(out, { ok: true, machineId: 'm1' });
  assert.equal(r.wakes(), 1);
  assert.deepEqual(r.phases, ['starting', 'connecting']);
});

test('unreachable is NOT terminal — a booting machine has no heartbeat yet', async () => {
  // treating it as failure would abort almost every real cold start
  const r = rig(['asleep', 'unreachable', 'unreachable', 'unreachable', 'online']);
  const out = await ensureMachine(r.deps, (p) => r.phases.push(p));
  assert.equal(out.ok, true);
});

test('already waking does not wake again', async () => {
  const r = rig(['waking', 'online']);
  await ensureMachine(r.deps);
  assert.equal(r.wakes(), 0, 'a second wake only resets the idle clock; the person waits on the same boot');
});

test('capped is a verdict, and it never spends a wake', async () => {
  const r = rig(['capped']);
  const out = await ensureMachine(r.deps);
  assert.equal(out.ok, false);
  assert.equal((out as { reason: string }).reason, 'capped');
  assert.equal(r.wakes(), 0);
});

test('capped discovered mid-wait stops the wait', async () => {
  const r = rig(['asleep', 'waking', 'capped']);
  const out = await ensureMachine(r.deps);
  assert.equal((out as { reason: string }).reason, 'capped');
});

test('a wake refused as capped is reported as capped, not as a failure', async () => {
  const r = rig(['asleep'], { wake: { ok: false, capped: true } });
  const out = await ensureMachine(r.deps);
  assert.equal((out as { reason: string }).reason, 'capped');
});

test('a machine id that appears late is picked up rather than failing early', async () => {
  // a workspace whose first runner row is only now being created
  const r = rig(['asleep', 'waking', 'online'], { idAfter: 2 });
  const out = await ensureMachine(r.deps);
  assert.deepEqual(out, { ok: true, machineId: 'm1' });
});

test('cancelling stops the wait — and says cancelled, not failed', async () => {
  const r = rig(['asleep', 'waking', 'waking', 'online'], { cancelAt: 2 });
  const out = await ensureMachine(r.deps);
  assert.equal((out as { reason: string }).reason, 'cancelled');
  assert.equal(r.wakes(), 1, 'the wake stands: leaving cancels the WAIT, never the machine');
});

test('it gives up eventually, and blames the wait rather than the machine', async () => {
  const r = rig(['asleep', 'waking']);
  const out = await ensureMachine(r.deps);
  assert.equal(out.ok, false);
  const d = out as { reason: string; detail: string };
  assert.equal(d.reason, 'unavailable');
  assert.match(d.detail, /can still start/i);
  assert.ok(r.polls() * 4000 >= ENSURE_TIMEOUT_MS, 'should have waited the full budget first');
});

test('a stopped machine is not something waiting can fix', async () => {
  const r = rig(['stopped']);
  const out = await ensureMachine(r.deps);
  assert.equal((out as { reason: string }).reason, 'unavailable');
  assert.equal(r.wakes(), 0);
});
