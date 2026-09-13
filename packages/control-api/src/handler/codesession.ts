// Code-session commands (0135, the mobile-cloud round — plan D8, S0.2): the synced row every
// client lists Code work from. The row is DESCRIPTIVE, never gating; what this module enforces is
// WHO may write it, because the row names a member and a machine:
//
//   · a human actor only — a machine token speaks as its owner (machine-auth.ts), an agent never
//   · create as yourself, or — if you OWN the hosting machine — for the member it works for
//     (a cloud runner is its owner's and serves every member; the desktop host is its member's)
//   · update as the creator, or as the owner of the hosting machine
//
// SQL rides sqlOf(store) (code-sessions.ts), so the Store contract grows no delegates.
import { createEvent, formatAddress, type Actor } from '@neuramesh/shared';
import type { Command } from '../commands';
import { insertCodeSession, machineOwnerIn, patchCodeSession, readCodeSession, type CodeSessionHead } from '../code-sessions';
import { actorInWorkspace, sqlOf } from '../credits';
import { DomainError } from '../errors';
import { type Store } from '../store';
import { actorAddress } from './guards';
import type { CommandOutcome } from '../handler';

const NOT_SERVED = () => new DomainError('NOT_FOUND', 'Code sessions are not served by this store');

type CodeCommand = Extract<Command, { type: `code_session.${string}` }>;

export async function codeSessionCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (!cmd.type.startsWith('code_session.')) return undefined;
  const c = cmd as CodeCommand;
  if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'Code sessions belong to members — a machine speaks as its owner, an agent never');
  if (!(await actorInWorkspace(store, actor, c.workspace))) throw new DomainError('NOT_PERMITTED', 'not a member of this workspace');
  const sql = sqlOf(store);
  if (!sql) throw NOT_SERVED();
  const existing = await readCodeSession(sql, c.codeSessionId);
  if (existing && existing.workspaceId !== c.workspace) throw new DomainError('NOT_FOUND', 'no such Code session in this workspace');
  // the machine the row names must be one of this workspace's; owning it is what lets a host
  // speak for the members it works for
  const machineId = 'machineId' in c && c.machineId !== undefined ? c.machineId : existing?.machineId ?? null;
  const machine = machineId ? await machineOwnerIn(sql, c.workspace, machineId) : undefined;
  if (machineId && !machine) throw new DomainError('NOT_FOUND', 'no such machine in this workspace');
  const hostsIt = !!machine && machine.ownerUserId === actor.id;
  const mayWrite = (row: CodeSessionHead): boolean => row.createdBy === actor.id || hostsIt;

  if (c.type === 'code_session.upsert') {
    const { type: _t, workspace, codeSessionId, createdBy: named, ...patch } = c;
    if (!existing) {
      const createdBy = named ?? actor.id;
      if (createdBy !== actor.id) {
        if (!hostsIt) throw new DomainError('NOT_PERMITTED', 'only the owner of the hosting machine records a session for someone else');
        if (!(await store.humanMemberIds(workspace)).includes(createdBy)) throw new DomainError('NOT_FOUND', 'that member is not in this workspace');
      }
      await insertCodeSession(sql, { id: codeSessionId, workspaceId: workspace, createdBy, ...patch, ...(machineId !== undefined ? { machineId } : {}) }, createEvent({
        type: 'code_session.created', source: actorAddress(actor), workspace,
        target: formatAddress({ kind: 'resource', type: 'code_session', id: codeSessionId }),
        payload: { createdBy, machineId, repoName: patch.repoName ?? null, branch: patch.branch ?? null },
      }));
      return { ok: true, codeSessionId, created: true } as never;
    }
    if (!mayWrite(existing)) throw new DomainError('NOT_PERMITTED', 'only the session\'s member or the hosting machine\'s owner may update it');
    await patchCodeSession(sql, codeSessionId, patch, false);
    return { ok: true, codeSessionId, created: false } as never;
  }
  if (!existing) throw new DomainError('NOT_FOUND', 'no such Code session');
  if (!mayWrite(existing)) throw new DomainError('NOT_PERMITTED', 'only the session\'s member or the hosting machine\'s owner may update it');
  if (c.type === 'code_session.close') {
    const state = c.state ?? 'resumable';
    await patchCodeSession(sql, c.codeSessionId, { state, ...(c.lastLine !== undefined ? { lastLine: c.lastLine } : {}) }, true, createEvent({
      type: 'code_session.closed', source: actorAddress(actor), workspace: c.workspace,
      target: formatAddress({ kind: 'resource', type: 'code_session', id: c.codeSessionId }),
      payload: { state },
    }));
    return { ok: true, codeSessionId: c.codeSessionId, state } as never;
  }
  // approval_waiting: the row learns the state; the route pushes it to the session's member
  // (push.ts pushAfterCommand) — the server, not the host, decides who is told
  await patchCodeSession(sql, c.codeSessionId, { state: 'awaiting_approval' }, false);
  return {
    ok: true, codeSessionId: c.codeSessionId, workspace: c.workspace, ownerUserId: existing.createdBy, title: existing.title,
    machineName: machine?.name ?? null, approvalId: c.approvalId, category: c.category, toolName: c.toolName,
  } as never;
}
