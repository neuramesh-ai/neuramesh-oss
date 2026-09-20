// Replica lookups the host does constantly — extracted from agents.ts (track B2).
//
// Small reads several flows need and none owns: which task a thread carries, which
// workspace a task belongs to, the seat's display label, and the run a task's legs hang
// off. Here rather than inlined per caller so "what does the host consider a task's
// workspace" has exactly one answer.
//
// resolveSeat deliberately stayed behind: it calls seatFor, which is declared thousands of
// lines further down startAgentHost, and a lookup module is the wrong place to invert that.
import type { PowerSyncDatabase } from '@powersync/node';
import { machineOnline, type SessionOrigin } from '@neuramesh/shared';
import type { HostCtx } from './ctx';
import type { HostedAgent } from '../agents';

/** where a unit's owning conversation was born, and the machine it was designated to */
export interface UnitBirth { origin: SessionOrigin | null; machineId: string | null }
const NO_BIRTH: UnitBirth = { origin: null, machineId: null };
const isOrigin = (v: unknown): v is SessionOrigin => v === 'desktop' || v === 'web' || v === 'routine';

/** who is answering, and whose configuration they inherited (null = the plain role) */
export interface Seat { agent: HostedAgent; from: { id: string; name: string } | null }

export interface LookupWiring {
  db: PowerSyncDatabase;
  /** this host's `machines` row: what "another machine" means below */
  machineId: string;
}

export function makeLookups({ guards }: HostCtx, { db, machineId }: LookupWiring) {
  const { taskRunIds } = guards;
async function taskOf(threadId: string | null): Promise<string | null> {
  if (!threadId) return null;
  const row = await db.get<{ task_id: string | null }>('select task_id from threads where id = ?', [threadId]).catch(() => null);
  return row?.task_id ?? null;
}

const seatLabel = (s: Seat): string => `${s.agent.role}·${s.agent.model}${s.from ? `·@${s.from.name}` : ''}`;

async function workspaceOf(channelId: string): Promise<string> {
  const ch = await db.get<{ workspace_id: string }>('select workspace_id from channels where id = ?', [channelId]);
  return ch?.workspace_id ?? '';
}

const parentRunOf = (taskId: string): string | null => taskRunIds.get(taskId) ?? null;

/** THE UNIT'S BIRTH (George, 2026-09-19: "units for routines or threads started on the cloud
 *  should also run there on the cloud runner"). A unit runs where its conversation runs, so its
 *  claim reads the same two facts a chat wake reads from `threads`: the origin and the chip's
 *  designation. The owning conversation is `tasks.origin_thread_id`, a subtask's is its parent's,
 *  and a task born on the board has none: today's ladder, unchanged. */
async function unitBirth(taskId: string): Promise<UnitBirth> {
  // the replica's `get` throws on an empty result, and a board-born task IS the empty result
  const row = await db.get<{ origin: string | null; machine_id: string | null }>(
    `select th.origin, th.machine_id from tasks t
       join threads th on th.id = coalesce(t.origin_thread_id, (select p.origin_thread_id from tasks p where p.id = t.parent_task_id))
      where t.id = ?`,
    [taskId],
  ).catch(() => null);
  if (!row) return NO_BIRTH;
  return { origin: isOrigin(row.origin) ? row.origin : null, machineId: row.machine_id ?? null };
}

/** IS ANOTHER MACHINE, AWAKE RIGHT NOW, RUNNING THIS UNIT? The resume watches pick up in-progress
 *  units "this process is not executing", and under shared compute that set includes the units
 *  another host IS executing: a laptop that booted mid-unit resumed the runner's unit beside it,
 *  and units run on the runner by default now. A running run on an awake machine is the unit's
 *  live twin (docs/29). A running run on a machine that stopped beating is a crash, and the
 *  resume exists for exactly that, so it does not hold. */
async function heldElsewhere(taskId: string, now = Date.now()): Promise<boolean> {
  const rows = await db.getAll<{ last_seen_at: string | null }>(
    `select m.last_seen_at from runs r join machines m on m.id = r.machine_id
      where r.task_id = ? and r.state = 'running' and r.machine_id != ?`,
    [taskId, machineId],
  ).catch(() => [] as Array<{ last_seen_at: string | null }>);
  return rows.some((r) => machineOnline({ machineId: '', ownerUserId: '', runtimes: [], lastSeenAt: r.last_seen_at }, now));
}

  return { taskOf, seatLabel, workspaceOf, parentRunOf, unitBirth, heldElsewhere };
}
