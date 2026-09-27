// A cloud machine says which build it runs (desktop decoupling plan, Phase 1). The machine image
// bakes the commit it was built from, machined sends it on every beat as `daemonVersion`, and the
// store writes it to machines.daemon_version. Before this the fleet's pin was the only record of
// what a machine ran. An older machine beats without the field and must keep working, and its
// beat must not erase a build the row already holds. The pg lane (member-machines.pg.test.ts)
// proves the write against the real schema.
import type { Actor } from '@neuramesh/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { CommandSchema } from '../src/commands';
import { machineCommands } from '../src/handler/machine';
import { MemoryStore, type Store } from '../src/store';

const SHA = '1f455e231a192aa542dc402a031e6f6fd2830778';
const owner: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };

/** a store that records the one call a heartbeat makes */
function spyStore() {
  const calls: unknown[][] = [];
  const store = { heartbeatMachine: async (...args: unknown[]) => { calls.push(args); } } as unknown as Store;
  return { store, calls };
}

describe('machine.heartbeat carries the build', () => {
  it('parses a beat with daemonVersion and a beat without one', () => {
    expect(CommandSchema.parse({ type: 'machine.heartbeat', machineId: 'm1', daemonVersion: SHA })).toMatchObject({ daemonVersion: SHA });
    expect(CommandSchema.parse({ type: 'machine.heartbeat', machineId: 'm1', activeSeconds: 5 })).not.toHaveProperty('daemonVersion');
  });

  it('refuses an empty or an oversized build, so the column holds a version and not a payload', () => {
    expect(CommandSchema.safeParse({ type: 'machine.heartbeat', machineId: 'm1', daemonVersion: '' }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: 'machine.heartbeat', machineId: 'm1', daemonVersion: 'x'.repeat(65) }).success).toBe(false);
  });

  it('hands the build to the store, and a beat without one hands none, so the row keeps its build', async () => {
    const { store, calls } = spyStore();
    await machineCommands(store, owner, CommandSchema.parse({ type: 'machine.heartbeat', machineId: 'm1', busy: true, daemonVersion: SHA }));
    await machineCommands(store, owner, CommandSchema.parse({ type: 'machine.heartbeat', machineId: 'm1', activeSeconds: 5 }));
    expect(calls).toEqual([
      ['m1', { activeSeconds: 0, busy: true, daemonVersion: SHA }],
      ['m1', { activeSeconds: 5, busy: false }],
    ]);
  });

  it('answers 200 on the command route with and without the field', async () => {
    const app = createApp(new MemoryStore());
    const headers = { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(owner) };
    for (const body of [{ type: 'machine.heartbeat', machineId: 'm1', daemonVersion: SHA }, { type: 'machine.heartbeat', machineId: 'm1' }]) {
      const res = await app.request('/v1/commands', { method: 'POST', headers, body: JSON.stringify(body) });
      expect(res.status).toBe(200);
    }
  });
});
