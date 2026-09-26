import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineeringAttachmentAcknowledgements, relayOverrides, runnerOf, shellMachineOf } from './webnm-relay';

test('Engineering attachment acknowledgements resolve the matching upload chunk', async () => {
  const acknowledgements = createEngineeringAttachmentAcknowledgements(100);
  const pending = acknowledgements.wait('upload:0');
  acknowledgements.resolve('upload:0');
  await pending;
});

test('a missing Engineering attachment acknowledgement rejects at the transport deadline', async () => {
  const acknowledgements = createEngineeringAttachmentAcknowledgements(5);
  await assert.rejects(acknowledgements.wait('upload:0'), /upload timed out/);
});

// R4 (George, 2026-09-25): the terminal opens the right machine. A plain shell is where a person
// signs in, so it dials their OWN machine when the server names one and puts a disk under it
// first. A task's terminal dials the runner that holds the worktree and never promotes it, because
// a promotion ends the claim pod and the worktree with it.

const RUNNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const MINE = 'bbbbbbbb-0000-4000-8000-000000000002';
const row = (id: string, awake: boolean) => ({
  id, name: id.slice(0, 8), desiredReplicas: awake ? 1 : 0,
  lastSeenAt: awake ? new Date().toISOString() : null, lastWakeAt: null, lifecycle: null,
});

test('the shell takes your own machine when the server names one, the runner otherwise', () => {
  const machines = [row(RUNNER, true), row(MINE, false)];
  assert.equal(runnerOf({ machines })?.id, RUNNER);
  assert.equal(shellMachineOf({ machines, yours: MINE })?.id, MINE);
  assert.equal(shellMachineOf({ machines, yours: null })?.id, RUNNER);
  // a name the list does not carry is not a machine to dial
  assert.equal(shellMachineOf({ machines, yours: 'cccccccc-0000-4000-8000-000000000003' })?.id, RUNNER);
  assert.equal(shellMachineOf({}), null);
});

/** a stub API: the usage read, the promote command, and the wake, each recorded */
function stubApi(machines: ReturnType<typeof row>[], yours: string | null) {
  const calls: Array<{ path: string; body: Record<string, unknown> | null }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ path, body });
    const reply = path === '/v1/machines/usage' ? { machines, yours, capMinutes: null }
      : path === '/v1/commands' ? { ok: true, promoted: false }
      : { ok: true };
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const env = { apiUrl: 'https://api.test', workspaceId: () => 'ws-1', authHeaders: async () => ({}), relayBearer: async () => null };
const promotes = (calls: Array<{ path: string; body: Record<string, unknown> | null }>) =>
  calls.filter((c) => c.path === '/v1/commands' && c.body?.['type'] === 'machine.promote').map((c) => c.body?.['machineId']);
const wakes = (calls: Array<{ path: string; body: Record<string, unknown> | null }>) =>
  calls.filter((c) => c.path === '/v1/machines/wake').map((c) => c.body?.['machineId']);

test('a plain shell promotes and wakes YOUR machine, never the runner', async () => {
  const api = stubApi([row(RUNNER, true), row(MINE, false)], MINE);
  try {
    const nm = relayOverrides(env, 'wss://relay.test');
    // cancel as soon as the wake is out: the assertion is WHICH machine, not the boot wait
    const out = await nm.machineEnsure!(() => {}, () => wakes(api.calls).length > 0, 'shell');
    assert.equal(out.ok, false);
    assert.deepEqual(promotes(api.calls), [MINE]);
    assert.deepEqual(wakes(api.calls), [MINE]);
  } finally { api.restore(); }
});

test('a task terminal wakes the runner and never promotes it', async () => {
  const api = stubApi([row(RUNNER, false), row(MINE, true)], MINE);
  try {
    const nm = relayOverrides(env, 'wss://relay.test');
    await nm.machineEnsure!(() => {}, () => wakes(api.calls).length > 0, 'task');
    assert.deepEqual(promotes(api.calls), []);
    assert.deepEqual(wakes(api.calls), [RUNNER]);
  } finally { api.restore(); }
});

test('an awake machine opens at once: the shell still asks for its disk, and nothing wakes', async () => {
  const api = stubApi([row(RUNNER, true), row(MINE, true)], MINE);
  try {
    const nm = relayOverrides(env, 'wss://relay.test');
    assert.deepEqual(await nm.machineEnsure!(() => {}, () => false, 'shell'), { ok: true });
    assert.deepEqual(promotes(api.calls), [MINE]);
    assert.deepEqual(wakes(api.calls), []);
  } finally { api.restore(); }
});
