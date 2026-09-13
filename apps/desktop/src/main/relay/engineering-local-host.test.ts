// The desktop's own Code host (engineering-local-host.ts): it speaks as the signed-in member, it
// holds one lease per thread like the relay edge, and the client's machine choice never reaches
// the host. The same fake coding core the machine host's test uses; no git, no brain, no relay.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClineCore } from '@cline/sdk';
import type { EngineeringMachineOpenMeta, EngineeringOpenMeta, EngineeringRuntimeEvent } from '../../engineering-protocol';
import { createLocalEngineeringHost, LocalEngineeringSessions } from './engineering-local-host';
import type { EngineeringMachineHost } from './engineering-host';

const fakeCore = {
  subscribe: () => () => {}, listHistory: async () => [], readMessages: async () => [], start: async () => ({ sessionId: 'cline-1' }),
  send: async () => undefined, abort: async () => {}, stop: async () => {}, dispose: async () => {},
  restore: async () => ({ messages: [], checkpoint: { ref: 'x', createdAt: Date.now(), runCount: 1 } }),
} as unknown as ClineCore;
const createCore = (async () => fakeCore) as typeof import('@cline/sdk').ClineCore.create;
const db = { get: async () => null, getAll: async () => [] } as unknown as Parameters<typeof createLocalEngineeringHost>[0]['db'];
const meta = (threadId = 'e1', machineId?: string): EngineeringOpenMeta => ({
  threadId, repoId: 'r1', repoName: 'app', branch: 'main', mode: 'plan',
  permissions: { read: true, edit: false, command: false, web: false, mcp: false },
  policy: { read: true, edit: true, command: true, web: true, mcp: true },
  ...(machineId ? { machineId } : {}),
});

function hostWith(seen: { headers: Array<Record<string, string>>; metas: EngineeringMachineOpenMeta[] }): EngineeringMachineHost {
  const host = createLocalEngineeringHost({
    db, apiUrl: 'https://api.test', workspaceId: 'w1',
    authHeaders: async () => ({ 'x-nm-actor': '{"kind":"human","id":"u1"}' }),
    fetchImpl: async (_input, init) => { seen.headers.push(Object.fromEntries(new Headers(init?.headers).entries())); return new Response(JSON.stringify({ token: 'sk-test', authMode: 'apikey' }), { status: 200 }); },
    createCore, log: () => {},
    resolveCwd: async () => '/work/app',
    resolveBrain: async () => ({ modelId: 'claude-sonnet-4-6' }),
  });
  return { open: (m, emit) => { seen.metas.push(m); return host.open(m, emit); } };
}

test('the local host speaks as the member: its headers reach the provider read, no machine bearer anywhere', async () => {
  const seen = { headers: [] as Array<Record<string, string>>, metas: [] as EngineeringMachineOpenMeta[] };
  const sessions = new LocalEngineeringSessions(hostWith(seen), () => 'u1');
  const events: EngineeringRuntimeEvent[] = [];
  const opened = await sessions.open('s1', meta('e1', 'm-here'), (e) => events.push(e), () => events.push({ type: 'error', message: 'EXIT' }));
  assert.equal(opened, true);
  assert.equal(sessions.size, 1);
  assert.ok(seen.headers.length >= 1, 'the provider was resolved');
  for (const h of seen.headers) { assert.equal(h['x-nm-actor'], '{"kind":"human","id":"u1"}'); assert.equal(h['authorization'], undefined); }
  // the actor is the app's own user, injected here the way the relay injects it after auth; the
  // client's machine choice is a routing key and never reaches the host
  assert.equal(seen.metas[0]!.actorId, 'u1');
  assert.equal('machineId' in seen.metas[0]!, false);
  assert.equal(events.some((e) => e.type === 'error'), false, `no error: ${JSON.stringify(events)}`);
  sessions.close('s1');
});

test('one lease per thread: a second open on the same thread is refused with SESSION_ACTIVE and exits; close frees it', async () => {
  const seen = { headers: [] as Array<Record<string, string>>, metas: [] as EngineeringMachineOpenMeta[] };
  const sessions = new LocalEngineeringSessions(hostWith(seen), () => 'u1');
  assert.equal(await sessions.open('a', meta('e1'), () => {}, () => {}), true);
  const events: EngineeringRuntimeEvent[] = [];
  let exited = 0;
  assert.equal(await sessions.open('b', meta('e1'), (e) => events.push(e), () => { exited += 1; }), false);
  assert.equal(events[0]?.type, 'error');
  assert.equal((events[0] as { code?: string }).code, 'SESSION_ACTIVE');
  assert.equal(exited, 1);
  assert.equal(sessions.close('a'), true);
  assert.equal(sessions.close('a'), false, 'closing twice is a no-op, not an error');
  assert.equal(await sessions.open('c', meta('e1'), () => {}, () => {}), true, 'the lease is free again');
  sessions.close('c');
});

test('a host that fails to open reports the reason as an event and exits, and holds no lease', async () => {
  const failing: EngineeringMachineHost = { open: async () => { throw new Error('no brain configured'); } };
  const sessions = new LocalEngineeringSessions(failing, () => 'u1');
  const events: EngineeringRuntimeEvent[] = [];
  let exited = 0;
  assert.equal(await sessions.open('x', meta('e9'), (e) => events.push(e), () => { exited += 1; }), false);
  assert.deepEqual(events, [{ type: 'error', message: 'no brain configured' }]);
  assert.equal(exited, 1);
  assert.equal(sessions.size, 0);
  // the lease was released with the failure: the thread can be tried again
  assert.equal(await sessions.open('y', meta('e9'), () => {}, () => {}), false);
});
