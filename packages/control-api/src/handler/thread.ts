// Thread commands — extracted from handler.ts (track C1).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. Every branch is verbatim: the guards, the DomainError
// codes and the events are the product's contract, and this move is about where they live.
import {
  AGENT_ROLES,
  plainTitle,

  canFileConversation,






  MODEL_ID_SET,
  parseBrainOverride,




  type Actor,
  type FilingActor,





} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';


import { type Store } from '../store';





import type { CommandOutcome } from '../handler';

export async function threadCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  // Conversation threads: refine the heuristic title/description. The orchestrator does
  // this after its first reply; humans may rename their threads any time. Worker agents
  // may not — a thread's name is triage surface, not scratch space.
  if (cmd.type === 'thread.update') {
    const mayName = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayName) throw new DomainError('NOT_PERMITTED', 'threads are named by humans or the orchestrator');
    if (cmd.title === undefined && cmd.description === undefined) {
      throw new DomainError('INVALID_INPUT', 'nothing to update — pass a title or description');
    }
    // titled-once (0124, founder report): the orchestrator christens a conversation ONE time —
    // "don't rename it again" was a prompt rule, and it lost (a subtask arm re-titled its
    // parent thread on the next wake). Now the second agent rename is refused by the server.
    // a title is plain text (2026-09-12): the strip runs HERE, so no client and no agent prompt can
    // put emphasis markers on a rail row, and a stripped-empty title is refused rather than saved blank
    const title = cmd.title === undefined ? undefined : plainTitle(cmd.title);
    if (title !== undefined && !title) throw new DomainError('INVALID_INPUT', 'a title needs plain text in it');
    await store.updateThread(cmd.workspace, cmd.threadId, { title, description: cmd.description }, { agentTitleOnce: actor.kind !== 'human' });
    return { ok: true, threadId: cmd.threadId } as never;
  }
  if (cmd.type === 'thread.set_mode') {
    if (actor.kind !== 'human') {
      throw new DomainError('NOT_PERMITTED', 'the Tasks toggle is a human decision — an agent cannot move its own conversation onto the board');
    }
    await store.setThreadMode(cmd.workspace, cmd.threadId, cmd.mode);
    return { ok: true, threadId: cmd.threadId, mode: cmd.mode } as never;
  }
  if (cmd.type === 'thread.set_machine') {
    if (actor.kind !== 'human') {
      throw new DomainError('NOT_PERMITTED', 'where a conversation runs is a human decision — an agent cannot route its own conversation onto a machine');
    }
    await store.setThreadMachine(cmd.workspace, cmd.threadId, cmd.machineId);
    return { ok: true, threadId: cmd.threadId, machineId: cmd.machineId } as never;
  }
  // Auto-filing (0109): move a conversation into the room it belongs in. The rules are one pure
  // function — `canFileConversation` (packages/shared/filing.ts) — so this handler and the
  // daemon's tool cannot drift, and every refusal is asserted without a database.
  //
  // The refusal CODE is the error code on the wire: the renderer reads TASK_THREAD to explain why
  // Undo disappeared once work started, and rex reads SAME_CHANNEL to tell "already right" from
  // "moved" instead of reporting a move that never happened.
  if (cmd.type === 'thread.move') {
    const who: FilingActor = actor.kind === 'human' ? 'human' : actor.role === 'orchestrator' ? 'orchestrator' : 'agent';
    if (who === 'orchestrator' && !cmd.reason) {
      throw new DomainError('INVALID_INPUT', 'say why in one clause — a filing with no stated reason is one the human cannot argue with');
    }
    const subject = await store.threadFiling(cmd.workspace, cmd.threadId);
    if (!subject) throw new DomainError('NOT_FOUND', `thread ${cmd.threadId} not found`);
    const target = await store.channelProject(cmd.workspace, cmd.channel);
    if (!target) throw new DomainError('NOT_FOUND', `channel ${cmd.channel} not found`);
    const verdict = canFileConversation(who, subject, { channelId: cmd.channel, projectId: target.projectId });
    if (!verdict.ok) throw new DomainError(verdict.code, verdict.message);
    // an agent's move burns its one shot; a human's correction leaves the gate alone
    await store.moveThread(cmd.workspace, cmd.threadId, cmd.channel, cmd.reason ?? null, who === 'orchestrator');
    return { ok: true, threadId: cmd.threadId, channel: cmd.channel, slug: target.slug } as never;
  }
  // docs/10 §15 — the thread brain override. HUMAN_ONLY for the same family of reason as
  // approve_ship_plan: it spends money on the human's account, and an agent that could choose
  // its own model could choose the most expensive one in the catalog.
  if (cmd.type === 'thread.set_brain') {
    if (actor.kind !== 'human') {
      // HUMAN_ONLY, not NOT_PERMITTED: the renderer reads this code to draw the human-only badge,
      // the same way it does for approve_ship_plan
      throw new DomainError('HUMAN_ONLY', 'the brain for a conversation is a human decision — an agent cannot choose its own model');
    }
    // The allow-list is enforced HERE rather than in the schema, because the catalog lives in
    // packages/shared and restating it in zod (or in Postgres) is the drift this avoids. A
    // rejected model is a 400 with the offending id named, never a seat that dies at run time.
    const raw = cmd.override ?? null;
    if (raw) {
      for (const [role, model] of Object.entries(raw)) {
        if (!(AGENT_ROLES as readonly string[]).includes(role)) {
          throw new DomainError('INVALID_INPUT', `unknown role '${role}' — the override names a seat that does not exist`);
        }
        if (!MODEL_ID_SET.has(model)) {
          throw new DomainError('INVALID_INPUT', `unknown model '${model}' for ${role} — not in the catalog this workspace can run`);
        }
      }
    }
    // parseBrainOverride is the SAME function the daemon resolves with, so what is stored and
    // what is honoured cannot drift; it also collapses an emptied override to null, which is
    // what Reset writes (ruling 7 — the whole override, no partial states).
    const override = parseBrainOverride(raw);
    await store.setThreadBrain(cmd.workspace, cmd.threadId, override);
    return { ok: true, threadId: cmd.threadId, override } as never;
  }
  // Left behind when this module was first split out: these branches sat in handler.ts
  // beside the FSM tail with no reason other than the order they were written in.

  // Archiving a conversation (0108). HUMAN_ONLY, and CHAT-ONLY: a task thread is the board's
  // record of a work attempt — hiding it from the list would leave a task that still counts as open
  // with nowhere to read it. The refusal names the reason so the UI can say it rather than guess.
  if (cmd.type === 'thread.archive' || cmd.type === 'thread.unarchive') {
    if (actor.kind !== 'human') {
      throw new DomainError('HUMAN_ONLY', 'archiving a conversation is the human\'s own filing — an agent cannot hide a thread');
    }
    const taskId = await store.threadTaskId(cmd.workspace, cmd.threadId);
    if (taskId === undefined) throw new DomainError('NOT_FOUND', `thread ${cmd.threadId} not found`);
    if (taskId) throw new DomainError('TASK_THREAD', 'a task thread cannot be archived — its life belongs to the board (close the task instead)');
    await store.setThreadArchived(cmd.workspace, cmd.threadId, cmd.type === 'thread.archive');
    return { ok: true, threadId: cmd.threadId, archived: cmd.type === 'thread.archive' } as never;
  }

  // Settling a thread (0137; George, 2026-09-08). HUMAN_ONLY for the archive reason: an agent that
  // could settle could take a thread out of Needs you while the human still owes it a word. Unlike
  // archive it is legal on a TASK thread: it moves the thread's status, never the board, so a done
  // task stays done and its PR stays unmerged until the human says merge. Settle is not an accept.
  if (cmd.type === 'thread.settle' || cmd.type === 'thread.unsettle') {
    if (actor.kind !== 'human') {
      throw new DomainError('HUMAN_ONLY', 'settling a thread is the human\'s own act — an agent cannot decide a thread no longer needs them');
    }
    const taskId = await store.threadTaskId(cmd.workspace, cmd.threadId);
    if (taskId === undefined) throw new DomainError('NOT_FOUND', `thread ${cmd.threadId} not found`);
    await store.setThreadSettled(cmd.workspace, cmd.threadId, cmd.type === 'thread.settle');
    return { ok: true, threadId: cmd.threadId, settled: cmd.type === 'thread.settle' } as never;
  }

  return undefined;

}