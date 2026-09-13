// Schedule commands — extracted from handler.ts (track C1).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. Every branch is verbatim: the guards, the DomainError
// codes and the events are the product's contract, and this move is about where they live.
import {



  createEvent,


  formatAddress,








  type Actor,



  nextScheduleRun,


} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';
import { localMode } from '../localmode';

import { type Store } from '../store';
import { actorAddress } from './guards';




import type { CommandOutcome } from '../handler';

export async function scheduleCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'schedule.create') {
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'schedules are armed by a human — agents propose, humans arm');
    const { workspace } = await store.channelWorkspace(cmd.channel);
    if (!localMode() && (await store.workspacePlan(workspace)) === 'free') {
      // THE deep-funnel paywall (plan §4.2): the crew, the docs and the strategy were free —
      // putting it on a cadence is Cloud. The desktop routes 402 to the full-powers card.
      // The local stack lifts it (localmode.ts): the cadence runs on the person's own machine.
      throw new DomainError('PLAN_LIMIT', 'Content schedules ship with Team — upgrade to put the crew on a cadence.');
    }
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
    const { id } = await store.createSchedule(
      {
        channelId: cmd.channel, title: cmd.title, prompt: cmd.prompt, cadence: cmd.cadence,
        atTime, tz, weekday: cmd.weekday ?? null, nextRunAt, agentName: cmd.agent ?? null,
        createdByKind: actor.kind, createdBy: actor.id,
        ...(cmd.routine ? { payloadExtra: { routine: true } } : {}),
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
      { title: cmd.title, prompt: cmd.prompt, cadence: cmd.cadence, atTime, tz, weekday: cmd.weekday ?? null, nextRunAt },
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