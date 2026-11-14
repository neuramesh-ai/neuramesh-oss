// THE WAIT A PERSON SEES (decision D13 follow-up). The rule for W2, a warm pool, is "only if the p50
// wait is over 8 s". This file measures that wait on the server, with no client clock involved.
//
// The wait runs from the person's message (messages.created_at, written when nm-api accepts it) to the
// run the machine opens for it (runs.started_at). The machine opens that run before it does any work,
// and the run is what hq draws as the ghost for a cloud machine (thread/ghost-rule.ts, rung 2). So
// this is the time to the first sign of an agent, less one replica sync hop.
//
// Each run with a human trigger message and a machine logs ONE line, machine_wake_wait, with the
// machine's state when the message came:
//   cold      the message started the machine (started_at at or after the message, 2 s tolerance)
//   prewoken  a prewake started this run of the machine before the message (fleet-prewake.ts).
//             lead_ms says how long before the message the wake began
//   warm      the machine was already up for another reason
// up_ms is how long the machine had been up when the message came, for every class, so a warm machine
// that was still booting can be told apart. The p50 for the W2 decision is over cold plus prewoken.
import type postgres from 'postgres';
import { sqlOf } from './credits';
import type { Store } from './store';

export type WakeStart = 'cold' | 'prewoken' | 'warm' | 'unknown';
export interface WakeWait {
  runId: string; machineId: string; workspaceId: string; substrate: string;
  waitMs: number; start: WakeStart; leadMs: number | null; upMs: number | null;
}

/** a message wake stamps started_at just AFTER the message row (fire-and-forget from the send path) */
const COLD_TOLERANCE_MS = 2000;

/** pure: which state the machine was in when the message came */
export function classifyWakeStart(at: { messageAt: Date; startedAt: Date | null; speculativeAt: Date | null; firstSincePrewake?: boolean }): { start: WakeStart; leadMs: number | null; upMs: number | null } {
  if (!at.startedAt) return { start: 'unknown', leadMs: null, upMs: null };
  const upMs = at.messageAt.getTime() - at.startedAt.getTime();
  // only the FIRST message after the prewake waited on it: a later one found the machine up already
  const fromPrewake = at.speculativeAt !== null && at.speculativeAt.getTime() >= at.startedAt.getTime() && at.firstSincePrewake !== false;
  if (fromPrewake && upMs >= 0) return { start: 'prewoken', leadMs: upMs, upMs };
  if (upMs <= COLD_TOLERANCE_MS) return { start: 'cold', leadMs: null, upMs: Math.max(upMs, 0) };
  return { start: 'warm', leadMs: null, upMs };
}

export async function wakeWait(sql: postgres.Sql, runId: string): Promise<WakeWait | null> {
  const [row] = await sql<Array<{ run_id: string; machine_id: string; workspace_id: string; substrate: string | null; run_at: Date; message_at: Date; started_at: Date | null; speculative_at: Date | null; first_since_prewake: boolean }>>`
    select r.id as run_id, mc.id as machine_id, r.workspace_id, mc.substrate, r.started_at as run_at,
           msg.created_at as message_at, mc.started_at, mc.wake_speculative_at as speculative_at,
           not exists (select 1 from messages e
                        where e.workspace_id = r.workspace_id and e.author_kind = 'human' and e.id <> msg.id
                          and e.created_at >= mc.wake_speculative_at and e.created_at < msg.created_at) as first_since_prewake
      from runs r
      join messages msg on msg.id = r.trigger_message_id and msg.author_kind = 'human'
      join machines mc on mc.id = r.machine_id and mc.kind <> 'local'
     where r.id = ${runId}::uuid`;
  if (!row) return null;
  const cls = classifyWakeStart({ messageAt: new Date(row.message_at), startedAt: row.started_at ? new Date(row.started_at) : null, speculativeAt: row.speculative_at ? new Date(row.speculative_at) : null, firstSincePrewake: row.first_since_prewake });
  return {
    runId: row.run_id, machineId: row.machine_id, workspaceId: row.workspace_id, substrate: row.substrate ?? 'kube',
    waitMs: new Date(row.run_at).getTime() - new Date(row.message_at).getTime(), ...cls,
  };
}

/** the run.open path's tap, fire-and-forget: never awaited, never throws, a no-op without postgres */
export function fireWakeWait(store: Store, runId: string): void {
  const sql = sqlOf(store);
  if (!sql) return;
  void wakeWait(sql, runId)
    .then((w) => {
      if (!w) return;
      console.log(`machine_wake_wait run=${w.runId} machine=${w.machineId} workspace=${w.workspaceId} substrate=${w.substrate} ms=${w.waitMs} start=${w.start} lead_ms=${w.leadMs ?? ''} up_ms=${w.upMs ?? ''}`);
    })
    .catch((e: unknown) => console.error('machine_wake_wait failed:', e instanceof Error ? e.message : e));
}
