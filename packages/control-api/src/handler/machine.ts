// Machine commands — extracted from handler.ts (track C1); the cloud member kind's three verbs
// joined here in the member-machines round (docs/design/member-machines-2026-09/plan.md).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. register/heartbeat are verbatim from the extraction. The
// cloud verbs ride sqlOf(store) — the credit-ledger idiom — so the Store contract grows no
// delegates, and a store without postgres refuses them out loud rather than half-doing them.
import { createEvent, formatAddress, planLabel, type Actor } from '@neuramesh/shared';
import type { Command } from '../commands';
import { actorInWorkspace, sqlOf } from '../credits';
import { DomainError } from '../errors';
import { localMode } from '../localmode';
import { destroyMemberMachine, fleetOn, machineReach, mayUse, provisionMemberMachine, wakeMachine } from '../member-machines';
import { type Store } from '../store';
import { actorAddress } from './guards';
import type { CommandOutcome } from '../handler';

const NOT_SERVED = () => new DomainError('NOT_FOUND', 'cloud machines are not served by this store');

export async function machineCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | { machineId: string } | undefined> {
  if (cmd.type === 'machine.register') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'machines are registered by their human owner');
    const event = createEvent({
      type: 'machine.registered',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'machine', id: cmd.name }),
      workspace: cmd.workspace,
      payload: { platform: cmd.platform, daemonVersion: cmd.daemonVersion },
    });
    const { id } = await store.registerMachine(
      { workspace: cmd.workspace, name: cmd.name, platform: cmd.platform, daemonVersion: cmd.daemonVersion, ownerId: actor.id, transfer: cmd.transfer, runtimes: cmd.runtimes },
      event,
    );
    return { machineId: id };
  }
  if (cmd.type === 'machine.heartbeat') {
    await store.heartbeatMachine(cmd.machineId, { activeSeconds: cmd.activeSeconds ?? 0, busy: cmd.busy ?? false, ...(cmd.runtimes ? { runtimes: cmd.runtimes } : {}) });
    return { machineId: cmd.machineId };
  }
  if (cmd.type === 'machine.provision') {
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'a cloud machine is provisioned by the member it belongs to');
    if (!(await actorInWorkspace(store, actor, cmd.workspace))) throw new DomainError('NOT_PERMITTED', 'not a member of this workspace');
    // The local stack lifts the plan gate (localmode.ts); without a fleet the refusal below is then
    // the true one — nothing to provision here — rather than an upgrade door that leads nowhere.
    if (!localMode() && (await store.workspacePlan(cmd.workspace)) !== 'cloud') {
      throw new DomainError('PLAN_LIMIT', `${planLabel('free')} has no cloud machine. Upgrade to ${planLabel('cloud')} for a cloud machine per member.`);
    }
    const sql = sqlOf(store);
    if (!sql || !fleetOn()) throw NOT_SERVED();
    const r = await provisionMemberMachine(sql, cmd.workspace, actor.id);
    // the refusal names the real gate, and the fix: credits, not a plan or a seat
    if (r.refused === 'no_credits') throw new DomainError('PLAN_LIMIT', 'this workspace is out of credits — top up and your machine is provisioned on the next try');
    return { machineId: r.id, created: r.created } as never;
  }
  if (cmd.type === 'machine.remove') {
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'a cloud machine is removed by its owner');
    const sql = sqlOf(store);
    if (!sql) throw NOT_SERVED();
    const reach = await machineReach(sql, cmd.machineId);
    if (!reach || reach.workspaceId !== cmd.workspace) throw new DomainError('NOT_FOUND', 'no such cloud machine in this workspace');
    // the runner is the workspace's, nobody's to remove; a member machine goes only on its owner's word
    if (reach.kind !== 'member' || reach.ownerUserId !== actor.id) throw new DomainError('NOT_PERMITTED', 'only the owner removes their machine');
    const removed = await destroyMemberMachine(sql, cmd.workspace, actor.id);
    return { ok: true, removed } as never;
  }
  if (cmd.type === 'machine.wake') {
    // a person from a surface, or a daemon whose ladder found a lent sleeper (plan §4.3). The
    // grant is the consent: a member machine wakes for its owner and whoever they lend it to; an
    // agent has no member identity to be lent to, so for it "lent to the workspace" is the bar.
    if (!(await actorInWorkspace(store, actor, cmd.workspace))) throw new DomainError('NOT_PERMITTED', 'not a member of this workspace');
    const sql = sqlOf(store);
    if (!sql) throw NOT_SERVED();
    const reach = await machineReach(sql, cmd.machineId);
    if (!reach || reach.workspaceId !== cmd.workspace) throw new DomainError('NOT_FOUND', 'no such cloud machine in this workspace');
    // an agent may also name the member its work came from; that member must be here, and the
    // machine theirs or lent to them — the same bar a person meets, checked against the roster
    const origin = actor.kind === 'agent' && cmd.forUserId && (await store.humanMemberIds(cmd.workspace)).includes(cmd.forUserId) ? cmd.forUserId : null;
    const allowed = actor.kind === 'human' ? mayUse(reach, actor.id)
      : reach.kind === 'runner' || reach.shares.includes('*') || (origin !== null && mayUse(reach, origin));
    if (!allowed) throw new DomainError('NOT_PERMITTED', 'this machine is not lent to you');
    const out = await wakeMachine(sql, cmd.machineId);
    if (out.capped) throw new DomainError('PLAN_LIMIT', 'this workspace is out of credits — top up to wake its machine');
    return { ok: true, woken: out.woken } as never;
  }
  return undefined;
}
