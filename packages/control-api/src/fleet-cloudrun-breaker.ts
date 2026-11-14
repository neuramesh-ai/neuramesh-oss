// THE CRASH-LOOP BREAKER AND THE PARKED-BOOT REFUSAL (architecture §14, R16). Two ways a Cloud Run
// machine boots when it should not:
//
//   A BOOT LOOP. A boot that throws exits PID 1, and Cloud Run restarts the container into the same
//   failure. Each restart is a new boot and a new epoch, and the instance bills while it loops (two
//   e2e machines reached 390 and about 940 epochs). So nm-api counts the boots since the machine's
//   last `running` report. After NM_BOOT_LOOP_MAX boots inside NM_BOOT_LOOP_WINDOW_MIN with no
//   `running`, it refuses the boot credential (409 BOOT_LOOP), sets desired_replicas = 0 so nm-fleet
//   scales the pool to 0, stamps boot_loop_at, and posts one notice in the workspace. machined waits
//   for SIGTERM on that answer, because an exit would only start the loop again. A HUMAN wake or
//   message clears the stamp and allows exactly one more boot (bumpMachineWake, wakeMachine). A wake
//   nobody asked for (an agent message, a routine, an expired park) leaves a stamped machine asleep.
//
//   A GHOST BOOT. Cloud Run can start a replacement instance before a scale to 0 lands (the pool was
//   still settling from a wake). The e2e run saw one boot a new epoch for a parked machine. So the
//   boot route refuses a machine whose desired_replicas is 0 (409 PARKED). A real wake always sets
//   desired_replicas = 1 BEFORE the pool scales (nm-fleet reads the row), so it never sees PARKED.
//   A wake that lands while a ghost waits finds the pool at 1 already, so machined asks again every
//   NM_BOOT_HOLD_POLL_MS and boots once the row says 1.
//
// Neither refusal moves the epoch or the streak: a refused boot is no incarnation.
import { createEvent, formatAddress } from '@neuramesh/shared';
import type postgres from 'postgres';
import type { Store } from './store';

const intEnv = (name: string, fallback: number, min: number, max: number): number => {
  const n = Number(process.env[name] ?? fallback);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
/** boots with no `running` report before the breaker trips */
export const bootLoopMax = (): number => intEnv('NM_BOOT_LOOP_MAX', 8, 1, 1000);
/** a streak older than this starts again: a machine that crashes once an hour is not looping */
export const bootLoopWindowMin = (): number => intEnv('NM_BOOT_LOOP_WINDOW_MIN', 30, 1, 24 * 60);

export interface BreakerRow {
  desiredReplicas: number;
  bootLoopAt: Date | null;
  streak: number;
  streakSince: Date | null;
}

export type BootVerdict =
  /** a new incarnation: the streak to store, and whether it starts now */
  | { kind: 'boot'; streak: number; fresh: boolean }
  /** refused, the breaker stays (or, with trip, just became) open */
  | { kind: 'loop'; trip: boolean }
  | { kind: 'parked' };

/** the boot rule, pure. The stamp outranks the park: a tripped machine is also parked, and the
 *  breaker is what the person needs to hear about */
export function bootVerdict(row: BreakerRow, nowMs: number, cfg: { max: number; windowMin: number }): BootVerdict {
  if (row.bootLoopAt) return { kind: 'loop', trip: false };
  if (row.desiredReplicas !== 1) return { kind: 'parked' };
  const fresh = !row.streakSince || nowMs - row.streakSince.getTime() > cfg.windowMin * 60_000;
  const streak = fresh ? 1 : row.streak + 1;
  if (streak > cfg.max) return { kind: 'loop', trip: true };
  return { kind: 'boot', streak, fresh };
}

/** the type a `sql` tagged template returns, so a condition can be handed over as a fragment */
const _fragment = (sql: postgres.Sql) => sql`true`;
export type SqlFragment = ReturnType<typeof _fragment>;

/** The SET fragment a HUMAN wake adds: the stamp goes, and the streak steps back by one so the next
 *  boot is allowed and the one after it trips again. The window restarts so an old streak cannot
 *  hand out more than one try. `go` is the wake's own condition (credits), so a refused wake clears
 *  nothing. Every SET in an UPDATE reads the row as it was, so m.boot_loop_at is the old stamp here */
export const clearBreakerOnHumanWake = (sql: postgres.Sql, go: () => SqlFragment) => sql`
  boot_loop_at = case when (${go()}) then null else m.boot_loop_at end,
  boot_streak = case when (${go()}) and m.boot_loop_at is not null then greatest(m.boot_streak - 1, 0) else m.boot_streak end,
  boot_streak_since = case when (${go()}) and m.boot_loop_at is not null then now() else m.boot_streak_since end`;

/** what the person reads. It starts with "I can't reply now." so every client reads it as a
 *  compute notice (shared session-runs.ts isSessionRunNotice, desktop computenotice.ts), the same
 *  family as the failed-wake notice (host/wakefail.ts) */
export function bootLoopNotice(boots: number): string {
  return `I can't reply now. My cloud machine failed to start ${boots} times in a row, so I stopped it to save credits. Send your message again to try once more.`;
}

interface NoticeTarget { id: string | null; channel_id: string; thread_id: string | null; task_id: string | null; agent_id: string }

/** One notice for a tripped breaker. It answers the newest human message nobody answered (the one
 *  the loop was waking for, most likely), as an agent this machine hosts, so the thread reads
 *  settled with the reason, exactly as a failed wake does. With no such message it goes to the
 *  newest room of that agent. Never throws: the refusal already committed */
export async function postBootLoopNotice(store: Store, sql: postgres.Sql, machine: { id: string; workspaceId: string }, boots: number, windowMin: number): Promise<'said' | 'nowhere' | 'failed'> {
  try {
    const [target] = await sql<NoticeTarget[]>`
      with hosts as (
        select a.id, a.created_at, (a.machine_id = ${machine.id}::uuid) as here
          from agents a where a.workspace_id = ${machine.workspaceId}::uuid
      ), owed as (
        select m.id, m.channel_id, m.thread_id, m.task_id, m.created_at
          from messages m
         where m.workspace_id = ${machine.workspaceId}::uuid and m.author_kind = 'human'
           and m.created_at > now() - make_interval(mins => ${windowMin + 10}::int)
           and not exists (select 1 from messages r where r.reply_to = m.id and r.author_kind = 'agent')
         order by m.created_at desc limit 1
      ), picked as (
        select o.id, o.channel_id, o.thread_id, o.task_id, h.id as agent_id, 0 as rank
          from owed o cross join lateral (
            select x.id from hosts x
             order by x.here desc, exists (select 1 from agent_channels ac where ac.agent_id = x.id and ac.channel_id = o.channel_id) desc, x.created_at
             limit 1) h
        union all
        select null::uuid, ac.channel_id, null::uuid, null::uuid, h.id, case when h.here then 1 else 2 end
          from hosts h join agent_channels ac on ac.agent_id = h.id
      )
      select id, channel_id, thread_id, task_id, agent_id from picked order by rank limit 1`;
    if (!target) {
      console.log(`machine_boot_loop_notice machine=${machine.id} said=no reason=no agent or room to speak in`);
      return 'nowhere';
    }
    const body = bootLoopNotice(boots);
    const where = target.task_id ? `task:${target.task_id}` : `channel/${target.channel_id}`;
    await store.postMessage(
      {
        id: crypto.randomUUID(), workspace: machine.workspaceId, channel: target.channel_id,
        taskId: target.task_id, threadId: target.thread_id, author: { kind: 'agent', id: target.agent_id },
        body, createdAt: new Date().toISOString(), ...(target.id ? { replyTo: target.id } : {}),
      },
      createEvent({ type: 'message.posted', source: formatAddress({ kind: 'agent', id: target.agent_id }), target: where, workspace: machine.workspaceId, payload: { preview: body.slice(0, 120) } }),
    );
    console.log(`machine_boot_loop_notice machine=${machine.id} said=yes replyTo=${target.id ?? 'none'} channel=${target.channel_id}`);
    return 'said';
  } catch (e) {
    console.error(`machine_boot_loop_notice machine=${machine.id} said=no:`, e instanceof Error ? e.message : e);
    return 'failed';
  }
}
