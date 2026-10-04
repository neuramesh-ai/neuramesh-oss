// Schedule commands — extracted from handler.ts (track C1).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. Every branch is verbatim: the guards, the DomainError
// codes and the events are the product's contract, and this move is about where they live.
import {



  createEvent,


  formatAddress,








  type Actor,



  isCodingThread,
  nextScheduleRun,
  ROUTINE_SCHEDULED_MARKER,


} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';

import { type Store } from '../store';
import { actorAddress } from './guards';




import type { CommandOutcome } from '../handler';
import type { ScheduleInput } from '../store/types';
import { ROUTINE_TAKEN } from '../store/routine-session';

/**
 * THE ROUTINE WRITER (docs/design/routine-writer-2026-10): the session a person schedules a routine in. It
 * must be a plain conversation in the routine's own room that holds no routine yet. A task's thread belongs
 * to its unit and a coding thread to the coding runtime, so neither can hold one. The store re-checks the
 * last rule in its transaction, which is what stops two clicks from arming two routines into one session.
 */
async function routineSession(store: Store, actor: Actor, workspace: string, channel: string, threadId: string): Promise<NonNullable<ScheduleInput['session']>> {
  const th = await store.threadFiling(workspace, threadId);
  if (!th) throw new DomainError('NOT_FOUND', `session ${threadId} not found`);
  if (th.taskId) throw new DomainError('TASK_THREAD', "A task's thread cannot hold a routine. Open a new session for it.");
  if (isCodingThread(th.kind)) throw new DomainError('CODING_THREAD', 'A coding thread cannot hold a routine. Open a new session for it.');
  if (th.scheduleId) throw new DomainError('THREAD_HAS_ROUTINE', ROUTINE_TAKEN);
  if (th.channelId !== channel) throw new DomainError('INVALID_INPUT', "A routine runs in the room of its session.");
  return {
    threadId, dividerId: crypto.randomUUID(), author: { kind: actor.kind, id: actor.id },
    makeEvent: (ws) => createEvent({
      type: 'message.posted', source: actorAddress(actor), target: `channel/${channel}`, workspace: ws,
      payload: { preview: ROUTINE_SCHEDULED_MARKER },
    }),
  };
}

export async function scheduleCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'schedule.create') {
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'schedules are armed by a human — agents propose, humans arm');
    // no plan gate (George, 2026-10-03: "allow routines on the trial"). a routine runs on every
    // plan: on the Pro trial its runs spend the trial's credits like any other work, and the
    // credit gate is what stops them at zero. the old paywall refused routines on the trial
    // while the site sold them.
    const { workspace } = await store.channelWorkspace(cmd.channel);
    const atTime = cmd.atTime ?? '09:00';
    const tz = cmd.tz ?? 'UTC';
    let nextRunAt: string;
    if (cmd.cadence === 'once') {
      if (!cmd.runAt) throw new DomainError('INVALID_INPUT', 'a one-shot schedule needs its exact runAt');
      if (new Date(cmd.runAt).getTime() <= Date.now()) throw new DomainError('INVALID_INPUT', 'runAt must be in the future');
      nextRunAt = cmd.runAt;
    } else {
      const next = nextScheduleRun({ cadence: cmd.cadence, atTime, tz, weekday: cmd.weekday ?? null, after: new Date() });
      if (!next) throw new DomainError('INVALID_INPUT', 'could not compute the next run — check the time and timezone');
      nextRunAt = next.toISOString();
    }
    const session = cmd.thread ? await routineSession(store, actor, workspace, cmd.channel, cmd.thread) : null;
    const { id } = await store.createSchedule(
      {
        channelId: cmd.channel, title: cmd.title, prompt: cmd.prompt, cadence: cmd.cadence,
        atTime, tz, weekday: cmd.weekday ?? null, nextRunAt, agentName: cmd.agent ?? null,
        createdByKind: actor.kind, createdBy: actor.id,
        ...(cmd.routine || session ? { payloadExtra: { routine: true, ...(cmd.replyGap ? { replyGap: cmd.replyGap } : {}) } } : {}),
        session,
      },
      (ws) => createEvent({
        type: 'schedule.created',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'channel', slug: cmd.channel }),
        workspace: ws,
        payload: { channel: cmd.channel, title: cmd.title, cadence: cmd.cadence, nextRunAt },
      }),
    );
    return { ok: true, scheduleId: id, nextRunAt } as never;
  }
  if (cmd.type === 'schedule.update') {
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'schedules are managed by a human');
    const atTime = cmd.atTime ?? '09:00';
    const tz = cmd.tz ?? 'UTC';
    let nextRunAt: string;
    if (cmd.cadence === 'once') {
      if (!cmd.runAt) throw new DomainError('INVALID_INPUT', 'a one-shot schedule needs its exact runAt');
      if (new Date(cmd.runAt).getTime() <= Date.now()) throw new DomainError('INVALID_INPUT', 'runAt must be in the future');
      nextRunAt = cmd.runAt;
    } else {
      const next = nextScheduleRun({ cadence: cmd.cadence, atTime, tz, weekday: cmd.weekday ?? null, after: new Date() });
      if (!next) throw new DomainError('INVALID_INPUT', 'could not compute the next run — check the time and timezone');
      nextRunAt = next.toISOString();
    }
    const { id } = await store.updateSchedule(
      cmd.schedule,
      { title: cmd.title, prompt: cmd.prompt, cadence: cmd.cadence, atTime, tz, weekday: cmd.weekday ?? null, nextRunAt, ...(cmd.replyGap !== undefined ? { replyGap: cmd.replyGap } : {}) },
      (ws) => createEvent({
        type: 'schedule.updated', source: actorAddress(actor),
        target: formatAddress({ kind: 'resource', type: 'schedule', id: cmd.schedule }), workspace: ws,
        payload: { schedule: cmd.schedule, title: cmd.title, cadence: cmd.cadence, nextRunAt },
      }),
    );
    return { ok: true, scheduleId: id, nextRunAt } as never;
  }
  if (cmd.type === 'schedule.claim_run') {
    // the daemon's CAS — any authenticated teammate may claim; the counter is the dedupe
    const { claimed } = await store.claimScheduleRun(
      cmd.schedule, cmd.runCount, cmd.nextRunAt,
      (ws) => createEvent({
        type: 'schedule.run_claimed',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'resource', type: 'schedule', id: cmd.schedule }),
        workspace: ws,
        payload: { schedule: cmd.schedule, runCount: cmd.runCount, nextRunAt: cmd.nextRunAt },
      }),
    );
    return { ok: true, claimed } as never;
  }
  if (cmd.type === 'schedule.run_now') {
    // Run now (routine sessions, 2026-09-28): a person fires the routine into its session. The row turns
    // due at once, and the daemon's next tick claims it like any slot (store/schedule-now.ts)
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'a person runs a routine now. agents wait for its slot');
    const { id } = await store.runScheduleNow(cmd.schedule, (ws) => createEvent({
      type: 'schedule.updated', source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'schedule', id: cmd.schedule }), workspace: ws,
      payload: { schedule: cmd.schedule, runNow: true },
    }));
    return { ok: true, scheduleId: id } as never;
  }
  if (cmd.type === 'schedule.mark_result') {
    // the fire's outcome, written by the daemon lane that claimed the slot — any authenticated
    // teammate, like the claim itself: the row is the truth and the attention bar its reader
    await store.markScheduleResult(cmd.schedule, cmd.error ?? null, (ws) => createEvent({
      type: 'schedule.result',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'schedule', id: cmd.schedule }),
      workspace: ws,
      payload: { schedule: cmd.schedule, error: cmd.error ?? null },
    }));
    return { ok: true } as never;
  }
  if (cmd.type === 'schedule.set_cursor') {
    // the scan's finish line, written by whichever lane completed it: the cursor moves ONLY here,
    // never on the claim, so a scan that dies after claiming leaves tomorrow's window covering today
    await store.setScheduleCursor(cmd.schedule, cmd.cursor, cmd.log ?? null, (ws) => createEvent({
      type: 'schedule.cursor',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'schedule', id: cmd.schedule }),
      workspace: ws,
      payload: { schedule: cmd.schedule, cursor: cmd.cursor, note: cmd.log?.note ?? null },
    }));
    return { ok: true } as never;
  }
  // Left behind when this module was first split out: these branches sat in handler.ts
  // beside the FSM tail with no reason other than the order they were written in.

  if (cmd.type === 'schedule.set_status' || cmd.type === 'schedule.delete') {
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'schedules are managed by a human');
    const mk = (type: 'schedule.updated' | 'schedule.deleted') => (ws: string) => createEvent({
      type, source: actorAddress(actor), target: formatAddress({ kind: 'resource', type: 'schedule', id: cmd.schedule }), workspace: ws,
      payload: cmd.type === 'schedule.set_status' ? { schedule: cmd.schedule, status: cmd.status } : { schedule: cmd.schedule },
    });
    const { id } = cmd.type === 'schedule.set_status'
      ? await store.setScheduleStatus(cmd.schedule, cmd.status, mk('schedule.updated'))
      : await store.deleteSchedule(cmd.schedule, mk('schedule.deleted'));
    return { ok: true, scheduleId: id } as never;
  }

  return undefined;

}