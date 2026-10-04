// one session per routine, the launcher's half (docs/design/routine-sessions-2026-09/plan.md, PR 2).
//
// a schedule's next run continues its newest session: the routine's opener, the draft run's message
// and the release digest all post there, in the session's own room. the orchestrator may file a
// session into a sibling room on its first run, and a message posted in another room would split
// the run from its thread. the session is live (not archived), not a task's own thread, and not a
// coding thread: the coding runtime answers there, and only a client that opens the thread starts
// it, so a run posted there would wait with no answer. with no such session, the run opens a new
// one, as every run did before. the server gives the session the schedule's title (control-api
// store/session-title.ts), so the launcher never names it.
//
// before the run, an automatic Starter switch ends. the NeuraMesh brain took the seat for one run
// because the configured brain could not run, and the next run tries the configured brain again. a
// seat a person picked stays: only a switch the fallback door made leaves its card or its line in
// the run (host/starterfallback.ts autoSwitchOf). the edge: a person who picks the NeuraMesh brain
// in the same run as an automatic switch of that role gets the configured brain back next run.
import { parseBrainOverride, STARTER_MODEL, type BrainOverride } from '@neuramesh/shared';
import { runCut } from './runwindow';
import { autoSwitchOf } from './starterfallback';

type ReadDb = { getAll: <T>(sql: string, params?: unknown[]) => Promise<T[]> };
type Post = (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<Response>;

export interface ScheduleSession { id: string; channel_id: string; workspace_id: string; brain_override: string | null }

/** the session the next run continues, or null. `room` keeps it to one room: a draft run posts as its agent, which the room registers */
export async function scheduleSession(db: ReadDb, scheduleId: string, room?: string): Promise<ScheduleSession | null> {
  const [s] = await db.getAll<ScheduleSession>(
    `select id, channel_id, workspace_id, brain_override from threads
      where schedule_id = ? and archived_at is null and task_id is null and coalesce(kind, 'chat') <> 'coding'${room ? ' and channel_id = ?' : ''}
      order by created_at desc limit 1`,
    room ? [scheduleId, room] : [scheduleId],
  ).catch(() => [] as ScheduleSession[]);
  return s ?? null;
}

/** the roles the newest run moved to the NeuraMesh brain by itself (the next opener is not posted yet, so the newest run is the one that ends) */
export async function autoSwitchedRoles(db: ReadDb, session: Pick<ScheduleSession, 'id' | 'workspace_id'>): Promise<string[]> {
  const cut = await runCut(db, session.id);
  const bodies = await db.getAll<{ body: string | null }>(
    `select body from messages where thread_id = ? and created_at >= ? order by created_at`, [session.id, cut],
  ).catch(() => [] as Array<{ body: string | null }>);
  const roles = new Set<string>();
  for (const { body } of bodies) {
    const hit = autoSwitchOf(body ?? '');
    if (hit?.role) roles.add(hit.role);
    else if (hit?.agent) {
      const [a] = await db.getAll<{ role: string }>(`select role from agents where name = ? and workspace_id = ? limit 1`, [hit.agent, session.workspace_id]).catch(() => [] as Array<{ role: string }>);
      if (a) roles.add(a.role);
    }
  }
  return [...roles];
}

/** pure: the override with those roles off the NeuraMesh brain. undefined when nothing moves, null when nothing is left */
export function withoutAutoSwitch(override: BrainOverride | null, roles: readonly string[]): BrainOverride | null | undefined {
  if (!override) return undefined;
  const drop = roles.filter((r) => override[r as keyof BrainOverride] === STARTER_MODEL);
  if (!drop.length) return undefined;
  const rest = Object.fromEntries(Object.entries(override).filter(([r]) => !drop.includes(r))) as BrainOverride;
  return Object.keys(rest).length ? rest : null;
}

/** where the next run of a schedule posts: its newest session (the id and that session's room), else a new session in the schedule's room */
export async function continueSession(
  ctx: { db: ReadDb; post: Post; ownerActorId: string },
  s: { id: string; channel_id: string },
  opts: { sameRoom?: boolean } = {},
): Promise<{ threadId: string; channelId: string; continued: boolean }> {
  const found = await scheduleSession(ctx.db, s.id, opts.sameRoom ? s.channel_id : undefined);
  if (!found) return { threadId: crypto.randomUUID(), channelId: s.channel_id, continued: false };
  const next = withoutAutoSwitch(parseBrainOverride(found.brain_override), await autoSwitchedRoles(ctx.db, found));
  if (next !== undefined) {
    // the owner's word, as the switch was (the server keeps thread.set_brain HUMAN_ONLY). it lands
    // before the opener, so the replica that wakes on the opener already holds the configured brain
    await ctx.post('/v1/commands', { kind: 'human', id: ctx.ownerActorId }, { type: 'thread.set_brain', workspace: found.workspace_id, threadId: found.id, override: next }).catch(() => null);
  }
  return { threadId: found.id, channelId: found.channel_id, continued: true };
}
