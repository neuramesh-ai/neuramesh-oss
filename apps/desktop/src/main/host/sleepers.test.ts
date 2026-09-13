// The sleeper rung's daemon half: ask once, remember for five minutes, forget a refusal, and
// never wake anything while an awake machine could serve.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { MachineCapability } from '@neuramesh/shared';
import { makeSleeperWake, resetSleeperMemo, SLEEPER_MEMO_MS } from './sleepers';

const NOW = Date.parse('2026-09-03T12:00:00Z');
const fresh = new Date(NOW - 10_000).toISOString();
const stale = new Date(NOW - 10 * 60_000).toISOString();

const runner: MachineCapability = { machineId: 'm-runner', ownerUserId: 'u-owner', kind: 'runner', runtimes: [], lastSeenAt: fresh, sharesWith: ['*'] };
const georgeCloud: MachineCapability = { machineId: 'm-george', ownerUserId: 'u-george', kind: 'member', runtimes: ['claude-code'], lastSeenAt: stale, sharesWith: ['*'] };
const bobCloud: MachineCapability = { machineId: 'm-bob', ownerUserId: 'u-bob', kind: 'member', runtimes: ['claude-code'], lastSeenAt: stale, sharesWith: [] };
const actor = { kind: 'agent', id: 'a-dev', role: 'developer' };

function harness(machines: MachineCapability[], status = 200) {
  const posts: unknown[] = [];
  let t = NOW;
  const { requestSleeperWake } = makeSleeperWake({
    peerMachines: async () => machines,
    post: async (_p, _a, body) => { posts.push(body); return new Response('{}', { status }); },
    now: () => t,
  });
  return { requestSleeperWake, posts, advance: (ms: number) => { t += ms; } };
}

beforeEach(() => resetSleeperMemo());

test('wakes the origin\'s own sleeping machine, naming the origin, and memoises the ask', async () => {
  const h = harness([runner, georgeCloud, bobCloud]);
  const first = await h.requestSleeperWake({ runtime: 'claude-code', model: null, originUserId: 'u-george', workspace: 'ws', actor });
  assert.deepEqual(first, { machineId: 'm-george', ownerUserId: 'u-george', asked: true });
  assert.deepEqual(h.posts, [{ type: 'machine.wake', workspace: 'ws', machineId: 'm-george', forUserId: 'u-george' }]);
  const again = await h.requestSleeperWake({ runtime: 'claude-code', model: null, originUserId: 'u-george', workspace: 'ws', actor });
  assert.deepEqual(again, { machineId: 'm-george', ownerUserId: 'u-george', asked: false }, 'inside the memo window nothing is re-posted');
  assert.equal(h.posts.length, 1);
  h.advance(SLEEPER_MEMO_MS + 1);
  await h.requestSleeperWake({ runtime: 'claude-code', model: null, originUserId: 'u-george', workspace: 'ws', actor });
  assert.equal(h.posts.length, 2, 'after the window a machine still asleep is asked again');
});

test('for unattributed work only a machine lent to the whole workspace qualifies', async () => {
  const h = harness([runner, bobCloud]);
  assert.equal(await h.requestSleeperWake({ runtime: 'claude-code', model: null, originUserId: null, workspace: 'ws', actor }), null, 'bob lends to nobody');
  const lent = harness([runner, georgeCloud]);
  const out = await lent.requestSleeperWake({ runtime: 'claude-code', model: null, originUserId: null, workspace: 'ws', actor });
  assert.equal(out?.machineId, 'm-george');
  assert.deepEqual(lent.posts[0], { type: 'machine.wake', workspace: 'ws', machineId: 'm-george' }, 'no forUserId when there is no origin');
});

test('never wakes a sleeper while an awake lent machine can serve, and never a laptop', async () => {
  const awakeBob: MachineCapability = { ...bobCloud, lastSeenAt: fresh, sharesWith: ['*'] };
  const h = harness([runner, georgeCloud, awakeBob]);
  assert.equal(await h.requestSleeperWake({ runtime: 'claude-code', model: null, originUserId: 'u-george', workspace: 'ws', actor }), null);
  assert.equal(h.posts.length, 0);
  const laptop: MachineCapability = { machineId: 'm-mac', ownerUserId: 'u-george', kind: 'local', runtimes: ['claude-code'], lastSeenAt: stale, sharesWith: ['*'] };
  const l = harness([runner, laptop]);
  assert.equal(await l.requestSleeperWake({ runtime: 'claude-code', model: null, originUserId: 'u-george', workspace: 'ws', actor }), null, 'a closed laptop cannot be woken by anyone');
});

test('a refusal forgets the memo, so the next need asks again', async () => {
  const h = harness([runner, georgeCloud], 402);
  assert.equal(await h.requestSleeperWake({ runtime: 'claude-code', model: null, originUserId: 'u-george', workspace: 'ws', actor }), null);
  await h.requestSleeperWake({ runtime: 'claude-code', model: null, originUserId: 'u-george', workspace: 'ws', actor });
  assert.equal(h.posts.length, 2, 'a 402 (credits) is not a boot in progress');
});
