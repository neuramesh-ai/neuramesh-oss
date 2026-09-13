// WHICH IDENTITY A MACHINE TOKEN MAY CLAIM.
//
// The token authenticates the MACHINE. What it must not do is authenticate whatever the machine
// says it is — and until now it did: `resolveMachineActor` returned `actorHeader ?? owner`
// verbatim, so a machine token was a licence to act as any human or any agent, in any workspace.
// The workspace id was even resolved and handed back, then dropped unused by the middleware.
//
// These tests pin the rule the file's comment always claimed: a machine is trusted for its OWN
// workspace, as its own owner or as an agent that lives there. Everything else is refused, and
// refused rather than silently downgraded — attributing a row to a human who did not write it is
// worse than a 401.
import { describe, expect, it } from 'vitest';
import { hashMachineToken, mintMachineToken, resolveMachineActor, type MachineAuthStore } from './machine-auth.js';

const WS = 'ws-mine';
const OTHER_WS = 'ws-theirs';
const OWNER = 'u-owner';

const { token: TOKEN, hash: HASH } = mintMachineToken();

/** a store holding one machine in WS owned by OWNER, and two agents in different workspaces */
const store: MachineAuthStore = {
  machineByTokenHash: async (h) =>
    h === HASH ? { id: 'm-1', workspace_id: WS, owner_user_id: OWNER, kind: 'local' } : null,
  agentWorkspace: async (id) => (id === 'a-mine' ? WS : id === 'a-theirs' ? OTHER_WS : null),
};

describe('a machine token authenticates the machine, not its claims', () => {
  it('with no actor header, the machine acts as its owner', async () => {
    const r = await resolveMachineActor(store, TOKEN, null);
    expect(r?.actor).toEqual({ kind: 'human', id: OWNER });
    expect(r?.machine.workspaceId).toBe(WS);
  });

  it('may claim an agent that lives in its own workspace', async () => {
    // shared compute: the agent need not belong to the machine's owner, only to its workspace
    const r = await resolveMachineActor(store, TOKEN, { kind: 'agent', id: 'a-mine' });
    expect(r?.actor).toEqual({ kind: 'agent', id: 'a-mine' });
  });

  it('may NOT claim an agent from another workspace', async () => {
    // the escalation this closes: one workspace's machine authoring rows in another's
    expect(await resolveMachineActor(store, TOKEN, { kind: 'agent', id: 'a-theirs' })).toBeNull();
  });

  it('may NOT claim an agent that does not exist', async () => {
    expect(await resolveMachineActor(store, TOKEN, { kind: 'agent', id: 'a-invented' })).toBeNull();
  });

  it('may claim its OWNER as a human, and no other human', async () => {
    expect((await resolveMachineActor(store, TOKEN, { kind: 'human', id: OWNER }))?.actor).toEqual({ kind: 'human', id: OWNER });
    // a teammate's identity is not the machine's to speak with, even inside its own workspace
    expect(await resolveMachineActor(store, TOKEN, { kind: 'human', id: 'u-teammate' })).toBeNull();
  });

  it('REFUSES rather than downgrading to the owner', async () => {
    // silently reinterpreting a bad claim as the owner would attribute rows to a human who did
    // not write them, and would hide the bug (or the attack) that produced the claim
    const r = await resolveMachineActor(store, TOKEN, { kind: 'human', id: 'u-teammate' });
    expect(r).toBeNull();
    expect(r?.actor).not.toEqual({ kind: 'human', id: OWNER });
  });

  it('still rejects an unknown or malformed token before any of this', async () => {
    expect(await resolveMachineActor(store, 'nmm_not-a-real-token', null)).toBeNull();
    expect(await resolveMachineActor(store, 'Bearer-shaped-but-not-nmm', null)).toBeNull();
  });

  it('fails closed when the store cannot answer where an agent lives', async () => {
    // a store without agentWorkspace must not become a store that trusts every agent claim
    const blind: MachineAuthStore = { machineByTokenHash: store.machineByTokenHash };
    expect(await resolveMachineActor(blind, TOKEN, { kind: 'agent', id: 'a-mine' })).toBeNull();
    // …while the no-header owner path still works, so the lane is not broken by the guard
    expect((await resolveMachineActor(blind, TOKEN, null))?.actor).toEqual({ kind: 'human', id: OWNER });
  });

  it('hashes the token rather than storing it — the row never holds the secret', () => {
    expect(HASH).not.toContain(TOKEN);
    expect(hashMachineToken(TOKEN)).toBe(HASH);
    expect(TOKEN.startsWith('nmm_')).toBe(true);
  });
});
