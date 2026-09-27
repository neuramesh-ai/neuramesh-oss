// A cloud machine says which build it runs (desktop decoupling plan, Phase 1). The machine image
// bakes the commit it was built from, machined sends it on every beat as `daemonVersion`, and the
// store writes it to machines.daemon_version. Before this the fleet's pin was the only record of
// what a machine ran. An older machine beats without the field and must keep working, and its
// beat must not erase a build the row already holds. The pg lane (member-machines.pg.test.ts)
// proves the write against the real schema.
//
// A beat is also its machine's own (2026-09-27): it moves last_seen_at and bills a cloud machine's
// workspace, so a beat from anyone who may not beat that machine must move and charge nothing.
import type { Actor } from '@neuramesh/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { CommandSchema } from '../src/commands';
import { DomainError } from '../src/errors';
import { machineCommands } from '../src/handler/machine';
import { MemoryStore, type Store } from '../src/store';

const SHA = '1f455e231a192aa542dc402a031e6f6fd2830778';
const owner: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const member: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000002' };
const stranger: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000009' };
const agent: Actor = { kind: 'agent', id: '10000000-0000-0000-0000-000000000001', role: 'orchestrator' };

/** a store that records the one call a heartbeat makes, and finds the machine */
function spyStore() {
  const calls: unknown[][] = [];
  const store = { heartbeatMachine: async (...args: unknown[]) => { calls.push(args); return true; } } as unknown as Store;
  return { store, calls };
}

/** a memory store holding one local machine of `owner` in workspace ws-1, with `member` a member */
async function oneMachine() {
  const store = new MemoryStore();
  const { machineId } = (await machineCommands(store, owner, CommandSchema.parse({ type: 'machine.register', workspace: 'ws-1', name: 'studio', platform: 'darwin', daemonVersion: '0.150.0' }))) as { machineId: string };
  (store as unknown as { addMember(workspace: string, userId: string): void }).addMember('ws-1', member.id);
  return { store, machineId };
}

const beat = (store: Store, actor: Actor, machineId: string) =>
  machineCommands(store, actor, CommandSchema.parse({ type: 'machine.heartbeat', machineId, activeSeconds: 5 }));

describe('machine.heartbeat carries the build', () => {
  it('parses a beat with daemonVersion and a beat without one', () => {
    expect(CommandSchema.parse({ type: 'machine.heartbeat', machineId: 'm1', daemonVersion: SHA })).toMatchObject({ daemonVersion: SHA });
    expect(CommandSchema.parse({ type: 'machine.heartbeat', machineId: 'm1', activeSeconds: 5 })).not.toHaveProperty('daemonVersion');
  });

  it('refuses an empty or an oversized build, so the column holds a version and not a payload', () => {
    expect(CommandSchema.safeParse({ type: 'machine.heartbeat', machineId: 'm1', daemonVersion: '' }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: 'machine.heartbeat', machineId: 'm1', daemonVersion: 'x'.repeat(65) }).success).toBe(false);
  });

  it('hands the build to the store with the beating actor, and a beat without one hands none, so the row keeps its build', async () => {
    const { store, calls } = spyStore();
    await machineCommands(store, owner, CommandSchema.parse({ type: 'machine.heartbeat', machineId: 'm1', busy: true, daemonVersion: SHA }));
    await machineCommands(store, owner, CommandSchema.parse({ type: 'machine.heartbeat', machineId: 'm1', activeSeconds: 5 }));
    expect(calls).toEqual([
      ['m1', owner.id, { activeSeconds: 0, busy: true, daemonVersion: SHA }],
      ['m1', owner.id, { activeSeconds: 5, busy: false }],
    ]);
  });

  it('answers 200 on the command route for the owner, with and without the field', async () => {
    const app = createApp(new MemoryStore());
    const headers = { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(owner) };
    const reg = await app.request('/v1/commands', { method: 'POST', headers, body: JSON.stringify({ type: 'machine.register', workspace: 'ws-1', name: 'studio', platform: 'darwin', daemonVersion: '0.150.0' }) });
    const { machineId } = (await reg.json()) as { machineId: string };
    for (const body of [{ type: 'machine.heartbeat', machineId, daemonVersion: SHA }, { type: 'machine.heartbeat', machineId }]) {
      const res = await app.request('/v1/commands', { method: 'POST', headers, body: JSON.stringify(body) });
      expect(res.status).toBe(200);
    }
  });
});

describe('machine.heartbeat is its machine\'s own', () => {
  it('the owner beats, and so does a member of a local machine\'s workspace (two laptops can share a default name)', async () => {
    const { store, machineId } = await oneMachine();
    await expect(beat(store, owner, machineId)).resolves.toEqual({ machineId });
    await expect(beat(store, member, machineId)).resolves.toEqual({ machineId });
  });

  it('a stranger\'s beat is refused as not found, and so is an id nobody has', async () => {
    const { store, machineId } = await oneMachine();
    await expect(beat(store, stranger, machineId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(beat(store, owner, '00000000-0000-0000-0000-00000000dead')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('an agent never beats a machine: a daemon beats as its person', async () => {
    const { store, machineId } = await oneMachine();
    await expect(beat(store, agent, machineId)).rejects.toBeInstanceOf(DomainError);
    await expect(beat(store, agent, machineId)).rejects.toMatchObject({ code: 'NOT_PERMITTED' });
  });

  it('on the route, a stranger gets 404 and the owner still gets 200', async () => {
    const app = createApp(new MemoryStore());
    const as = (actor: Actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
    const reg = await app.request('/v1/commands', { method: 'POST', headers: as(owner), body: JSON.stringify({ type: 'machine.register', workspace: 'ws-1', name: 'studio', platform: 'darwin', daemonVersion: '0.150.0' }) });
    const { machineId } = (await reg.json()) as { machineId: string };
    const beatBody = JSON.stringify({ type: 'machine.heartbeat', machineId, activeSeconds: 60 });
    expect((await app.request('/v1/commands', { method: 'POST', headers: as(stranger), body: beatBody })).status).toBe(404);
    expect((await app.request('/v1/commands', { method: 'POST', headers: as(owner), body: beatBody })).status).toBe(200);
  });
});
