// Workspace commands — extracted from handler.ts (track C1).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. Every branch is verbatim: the guards, the DomainError
// codes and the events are the product's contract, and this move is about where they live.
import {



  createEvent,


  formatAddress,
  FREE_SEAT_CAP,
  isCustomPackId,


  renderInvite,
  seatLimitReason,


  type Actor,






} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';
import { sqlOf } from '../credits';
import { localMode } from '../localmode';
import { destroyForLeave, ensureTeamShape, fleetOn } from '../member-machines';
import { inviteAcceptUrl, sendEmail } from '../mail';
import { syncSeatsForRoster } from '../seats';

import { type Store } from '../store';
import { actorAddress } from './guards';


import type { CommandOutcome } from '../handler';

export async function workspaceCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'workspace.create') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'workspaces are created by humans');
    const result = await store.createWorkspace(
      { name: cmd.name, slug: cmd.slug, createdBy: actor.id },
      createEvent({
        type: 'workspace.created',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'resource', type: 'workspace', id: cmd.slug }),
        workspace: '00000000-0000-0000-0000-000000000000', // patched to the new id in the store
        payload: { name: cmd.name, slug: cmd.slug },
      }),
    );
    // A workspace is born on Free with NO credits and NO cloud machine (source release,
    // 2026-09-12). Both arrive with the plan flip to Pro, in the Stripe webhook (plan-flip.ts):
    // the signup grant and the day-one runner were the bill this round stops.
    return result as never;
  }
  if (cmd.type === 'workspace.delete') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'workspaces are deleted by their human owner');
    await store.deleteWorkspace(cmd.workspace, actor.id);
    console.log(`workspace_deleted id=${cmd.workspace} by=${actor.id}`);
    return { ok: true } as never;
  }
  if (cmd.type === 'workspace.invite') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'invites are human-only');
    // Free workspaces invite too, capped at FREE_SEAT_CAP (docs/27 §1e). The count includes
    // PENDING invites — counting members alone would let a free workspace issue ten invites
    // at 1/3 and wake up with eleven members when they all accept.
    //
    // The local stack (localmode.ts) lifts the cap and has no fleet to shape, so it takes neither
    // branch: its plan stays 'free' and neither arm below is its business.
    const plan = await store.workspacePlan(cmd.workspace);
    if (plan !== 'cloud' && !localMode()) {
      const used = await store.workspaceSeatsUsed(cmd.workspace);
      if (used >= FREE_SEAT_CAP) throw new DomainError('PLAN_LIMIT', seatLimitReason());
    } else if (plan === 'cloud') {
      // THE TEAM SHAPE (member-machines plan §3): before the first invitation on Team goes out — before
      // a second human can exist — the owner's runner becomes their own machine and a fresh runner is
      // minted, so nobody ever shells into another person's logins. Awaited and unguarded on purpose:
      // an invite that could not secure the owner's machine must not go out.
      const fleetSql = sqlOf(store);
      if (fleetSql && fleetOn()) await ensureTeamShape(fleetSql, cmd.workspace);
    }
    const event = createEvent({
      type: 'member.invited',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'workspace', id: cmd.workspace }),
      workspace: cmd.workspace,
      payload: { email: cmd.email, memberRole: cmd.memberRole },
    });
    const inv = await store.createInvite(
      { workspace: cmd.workspace, email: cmd.email, memberRole: cmd.memberRole, invitedBy: actor.id },
      event,
    );
    // Queue-then-send: the outbox row exists before the transport is touched, so a Resend
    // outage leaves a retryable row rather than a silently lost invitation.
    const rendered = renderInvite({
      inviter: inv.inviterName, inviterEmail: inv.inviterEmail, workspace: inv.workspaceName,
      role: cmd.memberRole, acceptUrl: inviteAcceptUrl(inv.token),
    });
    const queued = await store.enqueueEmail({
      workspace: cmd.workspace, toEmail: cmd.email, template: 'invite', kind: 'transactional',
      subject: rendered.subject, dedupeKey: `invite:${inv.inviteId}:${Date.now()}`,
      payload: { workspace: inv.workspaceName, inviter: inv.inviterName },
    });
    let delivery: string = 'queued';
    if (queued) {
      const r = await sendEmail({ to: cmd.email, email: rendered });
      await store.markEmail(queued.id, { status: r.status, providerId: r.providerId ?? null, error: r.error ?? null });
      delivery = r.status;
    }
    console.log(`invite_created workspace=${cmd.workspace} invite=${inv.inviteId} delivery=${delivery}`);
    return { inviteId: inv.inviteId, created: true, delivery } as never;
  }
  if (cmd.type === 'workspace.revoke_invite') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'invites are revoked by a human');
    const ok = await store.revokeInvite(cmd.invite, cmd.workspace);
    if (!ok) throw new DomainError('NOT_FOUND', 'no pending invite with that id');
    return { ok: true } as never;
  }
  if (cmd.type === 'workspace.leave') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'only a human leaves a workspace');
    await store.leaveWorkspace(cmd.workspace, actor.id);
    destroyForLeave(store, cmd.workspace, actor.id); // the machine, its volume and its logins go with the membership
    syncSeatsForRoster(store, cmd.workspace); // and the seat Stripe bills for (F4b)
    console.log(`workspace_left workspace=${cmd.workspace} user=${actor.id}`);
    return { ok: true } as never;
  }
  if (cmd.type === 'workspace.remove_member') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'members are removed by a human');
    await store.removeMember(cmd.workspace, cmd.member, actor.id);
    destroyForLeave(store, cmd.workspace, cmd.member);
    syncSeatsForRoster(store, cmd.workspace);
    console.log(`member_removed workspace=${cmd.workspace} member=${cmd.member} by=${actor.id}`);
    return { ok: true } as never;
  }
  if (cmd.type === 'workspace.update') {
    // Humans own workspace settings. The ONE exception is the active pack pointer moved
    // by the orchestrator as it executes a HUMAN-CONFIRMED failover switch: it already
    // re-seats every agent through agent.update (orchestrator-allowed), so refusing it
    // the pointer only left the workspace disagreeing with its own seats — and the
    // daemon swallowed the 403, so the drift was silent. Policy toggles stay human-only.
    const packPointerOnly = cmd.activeModelPack !== undefined && cmd.autoFailover === undefined && cmd.commRules === undefined;
    const mayUpdate = actor.kind === 'human' || (actor.role === 'orchestrator' && packPointerOnly);
    if (!mayUpdate) throw new DomainError('NOT_PERMITTED', 'workspace settings are managed by humans');
    // a custom-brain id must reference a saved row — a typo'd/deleted id can't persist
    if (cmd.activeModelPack && isCustomPackId(cmd.activeModelPack)) {
      const packs = await store.listModelPacks(cmd.workspace);
      if (!packs.some((p) => p.id === cmd.activeModelPack)) throw new DomainError('INVALID_INPUT', 'unknown model pack');
    }
    const { id } = await store.updateWorkspace(
      cmd.workspace,
      { autoFailover: cmd.autoFailover, activeModelPack: cmd.activeModelPack, commRules: cmd.commRules },
      (workspace) => createEvent({
        type: 'workspace.updated',
        source: actorAddress(actor),
        target: `resource/workspace/${workspace}`,
        workspace,
        payload: { autoFailover: cmd.autoFailover ?? null, activeModelPack: cmd.activeModelPack ?? null },
      }),
    );
    return { ok: true, workspaceId: id } as never;
  }
  if (cmd.type === 'workspace.sync_agents') {
    const mayManage = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayManage) throw new DomainError('NOT_PERMITTED', 'agent registration is managed by humans or the orchestrator');
    const { registered } = await store.syncWorkspaceAgents(
      cmd.workspace,
      (workspace) => createEvent({
        type: 'agent.channels_synced',
        source: actorAddress(actor),
        target: `resource/workspace/${workspace}`,
        workspace,
        payload: {},
      }),
    );
    console.log(`agent_channels_synced workspace=${cmd.workspace} registered=${registered} by=${actor.id}`);
    return { ok: true, registered } as never;
  }
  return undefined;
}
