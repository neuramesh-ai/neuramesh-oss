// Member commands — extracted from handler.ts (track C1).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. Every branch is verbatim: the guards, the DomainError
// codes and the events are the product's contract, and this move is about where they live.
import {















  type Actor,






} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';


import { type Store } from '../store';





import type { CommandOutcome } from '../handler';

export async function memberCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'member.update_profile') {
    // self-service only: the write is scoped to actor.id, so a member can edit
    // their own display name but never someone else's (no target id is accepted).
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'only a member can edit their own profile');
    await store.updateMemberProfile(cmd.workspace, actor.id, cmd.displayName.trim());
    console.log(`member_profile_updated workspace=${cmd.workspace} user=${actor.id}`);
    return { ok: true } as never;
  }
  // docs/34 — the Tasks toggle on an existing conversation. HUMAN_ONLY by construction: an
  // agent that could flip its own chat to 'tasks' would have found a way to file board work
  // from a conversation, which is the exact thing chat mode exists to prevent.
  // Compute choice (0118): where this member's requests run. HUMAN_ONLY and SELF-ONLY by
  // construction — the row written is the actor's own, so the payload cannot reach anyone
  // else's routing (and an agent steering work onto a chosen machine is exactly the confused-
  // deputy shape the guard exists for).
  if (cmd.type === 'member.set_compute') {
    if (actor.kind !== 'human') {
      throw new DomainError('HUMAN_ONLY', 'compute choice is the member\'s own — an agent cannot route work onto a machine');
    }
    // PARTIAL update: an omitted field must stay as it is. Coercing to a default here meant the
    // join card — which sends only `machine` — silently wiped the member's grants (found by the
    // impact scan, 2026-08-14; same family as the client-side set math it replaced).
    await store.setMemberCompute(cmd.workspace, actor.id, {
      ...(cmd.machine !== undefined ? { machine: cmd.machine } : {}),
      ...(cmd.agents !== undefined ? { agents: cmd.agents } : {}),
      ...(cmd.shares !== undefined ? { shares: cmd.shares } : {}),
      ...(cmd.desktopSessions !== undefined ? { desktopSessions: cmd.desktopSessions } : {}),
    });
    return { ok: true } as never;
  }
  if (cmd.type === 'member.share_compute') {
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'lending a machine is the owner\'s own decision');
    await store.shareCompute(cmd.workspace, actor.id, cmd.member, cmd.on);
    return { ok: true } as never;
  }
  return undefined;
}
