// THE ROUTINE RESUME — a routine's ask is re-asked, by code, until it is answered (2026-09-16).
//
// The failure this closes (#1093, George's report): a weekly routine fired into its thread while no
// machine could serve the orchestrator's runtime. rex answered with the no-compute notice, and that
// notice was an ANSWER to every re-answer mechanism the host has — the dead-letter sweep saw an agent
// post after the human's, `saidNoCompute` never re-arms, and the notice held the one-reply-per-trigger
// slot (0060). Fifteen hours later the monitor sweep filed the ask flat, with no conversation to
// anchor, so the server could not see a routine and the unit was born gated: it asked a human who
// is not in this loop, twice, and the stall watchdog nagged them at 2am.
//
// Detection is code: a routine thread whose opener got no real answer — nothing after a grace, or
// only compute notices — and that anchors no unit. a content schedule's session is not a routine's
// (host/routinerule.ts, 2026-09-27), so it is never re-asked. Action is the ordinary wake: this host posts the
// prompt again AS THE OWNER into the same thread. A fresh human trigger rides every mechanism
// unchanged (the placement ladder, the wake lease, the exactly-once reply index, the thread wake
// that carries the conversation), which is what makes the server birth the unit approved.
//
// Bounded three ways: never while a newer run of the same routine exists (the next slot supersedes
// a missed one — no pile-up), at most MAX_REASKS per run (counted in the thread itself, so a
// restart cannot reset it), and only from the origin's own machine once it holds a usable
// credential (the no-compute notice's own rule, so one host speaks, and never into the void).
//
// Per RUN since one session holds every run of its routine (docs/design/routine-sessions-2026-09,
// PR 2): the window, the count, the unit check and the owner all start at the newest run's opener
// (host/runwindow.ts). A re-ask carries no schedule, so it stays inside its run.
import { resolveToken } from '../agents';
import { isComputeNotice } from '../computenotice';
import { isRoutineSchedule, schedulePayload } from '@neuramesh/shared';
import type { HostedAgent } from '../agents';
import type { PowerSyncDatabase } from '@powersync/node';

export interface RoutineThreadState {
  threadId: string;
  scheduleId: string;
  /** when the newest run opened: the session's birth for its first run */
  bornMs: number;
  /** who the opener was posted as — the owner whose machine may re-ask */
  ownerId: string;
  /** the newest HUMAN message: the opener, or the last re-ask */
  lastHumanAtMs: number;
  /** agent messages NEWER than that human message */
  agentReplies: Array<{ atMs: number; body: string }>;
  /** re-asks already in the thread (the durable count) */
  reasks: number;
  anchoredUnits: number;
  runningRuns: number;
  newerRunExists: boolean;
}

export const REASK_GRACE_MS = 10 * 60_000;
export const MAX_REASKS = 3;
export const RESUME_WINDOW_MS = 24 * 3600_000;
export const REASK_PREFIX = 'Routine resumed · ';

/** the message the host posts as the owner — its first line stays plain text, like the opener's */
export function reaskBody(title: string, prompt: string): string {
  return `${REASK_PREFIX}${title}\n\n${prompt}`;
}

/** pure: which routine threads deserve a re-ask right now */
export function pickStrandedRoutines(cands: RoutineThreadState[], nowMs: number): RoutineThreadState[] {
  return cands.filter((c) => {
    if (nowMs - c.bornMs > RESUME_WINDOW_MS) return false;
    if (c.anchoredUnits > 0 || c.runningRuns > 0 || c.newerRunExists) return false;
    if (c.reasks >= MAX_REASKS) return false;
    if (c.agentReplies.some((r) => !isComputeNotice(r.body))) return false; // a real answer exists
    const lastSignal = Math.max(c.lastHumanAtMs, ...c.agentReplies.map((r) => r.atMs));
    return nowMs - lastSignal > REASK_GRACE_MS;
  });
}

type ReadDb = { getAll: <T>(sql: string, params?: unknown[]) => Promise<T[]> };

/** the room's routine sessions of the last day, as the picker reads them. a content schedule's session is
 *  not one (2026-09-27): its draft waits for a person, and asking its drafting prompt again as the owner
 *  only makes the agent draft a second post while the person's reply stays unanswered */
export async function gatherRoutineThreads(db: ReadDb, ch: { id: string }, nowMs: number): Promise<RoutineThreadState[]> {
  // each session's newest run opener (host/runwindow.ts runCut, per row). the window test runs on parsed
  // times, never in SQL: the replica's time text and an ISO string do not sort together
  const rows = await db.getAll<{ id: string; schedule_id: string; run_at: string | null; payload: string | null; room_kind: string | null }>(
    `select th.id, th.schedule_id, s.payload, c.kind as room_kind,
            coalesce((select max(m.created_at) from messages m where m.thread_id = th.id and m.schedule_id is not null),
                     (select min(m.created_at) from messages m where m.thread_id = th.id)) as run_at
       from threads th join schedules s on s.id = th.schedule_id left join channels c on c.id = s.channel_id
      where th.channel_id = ? order by th.updated_at desc limit 20`,
    [ch.id],
  ).catch(() => [] as Array<{ id: string; schedule_id: string; run_at: string | null; payload: string | null; room_kind: string | null }>);
  const runAt = (o: { run_at: string | null }): number => (o.run_at ? Date.parse(o.run_at) : NaN);
  const out: RoutineThreadState[] = [];
  for (const th of rows) {
    const bornMs = runAt(th);
    if (!Number.isFinite(bornMs) || nowMs - bornMs > RESUME_WINDOW_MS) continue;
    if (!isRoutineSchedule(schedulePayload(th.payload), th.room_kind)) continue;
    const msgs = await db.getAll<{ author_kind: string; author_id: string; body: string | null; created_at: string }>(
      `select author_kind, author_id, body, created_at from messages where thread_id = ? and created_at >= ? order by created_at asc limit 60`, [th.id, th.run_at],
    ).catch(() => [] as Array<{ author_kind: string; author_id: string; body: string | null; created_at: string }>);
    const humans = msgs.filter((m) => m.author_kind === 'human');
    if (!humans.length) continue;
    const lastHumanAtMs = Date.parse(humans[humans.length - 1]!.created_at);
    const [units] = await db.getAll<{ n: number }>(`select count(*) as n from tasks where origin_thread_id = ? and created_at >= ?`, [th.id, th.run_at]).catch(() => [{ n: 0 }]);
    const [runs] = await db.getAll<{ n: number }>(`select count(*) as n from runs where thread_id = ? and state = 'running'`, [th.id]).catch(() => [{ n: 0 }]);
    out.push({
      threadId: th.id, scheduleId: th.schedule_id, bornMs, ownerId: humans[0]!.author_id, lastHumanAtMs,
      agentReplies: msgs.filter((m) => m.author_kind === 'agent' && Date.parse(m.created_at) > lastHumanAtMs).map((m) => ({ atMs: Date.parse(m.created_at), body: m.body ?? '' })),
      reasks: humans.filter((m) => (m.body ?? '').startsWith(REASK_PREFIX)).length,
      anchoredUnits: units?.n ?? 0, runningRuns: runs?.n ?? 0,
      newerRunExists: rows.some((o) => o.schedule_id === th.schedule_id && o.id !== th.id && runAt(o) > bornMs),
    });
  }
  return out;
}

/** the monitor sweep's newest room messages, the other half of the rescue. a routine's session stays out
 *  (2026-09-16, #1093): the thread wake answers it or the resume above asks again, and a sweep that saw it
 *  once filed it flat. a content schedule's session stays in (2026-09-27): the resume skips it, so the sweep
 *  is what rescues a reply there. the rule runs on the room's schedules, a handful of rows, so the query
 *  still drops the routine sessions before its limit */
export async function sweepMessages(db: ReadDb, channelId: string): Promise<Array<{ author_kind: string; body: string }>> {
  const scheds = await db.getAll<{ id: string; payload: string | null; kind: string | null }>(
    `select distinct s.id, s.payload, c.kind from threads th join schedules s on s.id = th.schedule_id left join channels c on c.id = s.channel_id where th.channel_id = ?`,
    [channelId],
  );
  const routines = scheds.filter((s) => isRoutineSchedule(schedulePayload(s.payload), s.kind)).map((s) => s.id);
  const keepOut = routines.length ? ` and (thread_id is null or thread_id not in (select id from threads where schedule_id in (${routines.map(() => '?').join(', ')})))` : '';
  return db.getAll<{ author_kind: string; body: string }>(`select author_kind, body from messages where channel_id = ? and task_id is null${keepOut} order by created_at desc limit 18`, [channelId, ...routines]);
}

export function makeRoutineResume(ctx: {
  db: PowerSyncDatabase;
  apiUrl: string;
  ownerActorId: string;
  post: (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<Response>;
}) {
  const { db, apiUrl, ownerActorId, post } = ctx;
  // threadId → when THIS host last re-asked: the replica lags its own post by a few seconds, and
  // the durable count above is what bounds the thread across restarts
  const reasked = new Map<string, number>();

  /** one channel, one tick: re-ask every stranded routine this host may speak for. Returns the count. */
  async function resumeStrandedRoutines(orch: HostedAgent, ch: { id: string; slug: string; workspace_id: string }): Promise<number> {
    if (process.env['NM_AGENT_MODE'] === 'echo') return 0;
    const now = Date.now();
    const stranded = pickStrandedRoutines(await gatherRoutineThreads(db, ch, now), now)
      .filter((c) => (c.ownerId === ownerActorId || process.env['NM_MACHINE_KIND'] === 'runner') && now - (reasked.get(c.threadId) ?? 0) > REASK_GRACE_MS);
    if (!stranded.length) return 0;
    // still no compute here → the notice already said so; asking again would only post another one
    const cred = await resolveToken(apiUrl, ch.workspace_id, orch, ownerActorId).catch(() => null);
    if (!cred || cred.blocked || cred.authMode === 'none') return 0;
    let n = 0;
    for (const c of stranded) {
      const [s] = await db.getAll<{ title: string; payload: string | null }>(`select title, payload from schedules where id = ?`, [c.scheduleId]).catch(() => []);
      if (!s) continue;
      const prompt = ((): string => { try { return (JSON.parse(s.payload ?? '{}') as { prompt?: string }).prompt ?? s.title; } catch { return s.title; } })();
      reasked.set(c.threadId, now);
      const res = await post('/v1/messages', { kind: 'human', id: ownerActorId }, { workspace: ch.workspace_id, channel: ch.id, threadId: c.threadId, body: reaskBody(s.title, prompt) }).catch(() => null);
      if (res?.ok) { n++; console.log(`routine_resume channel=${ch.slug} thread=${c.threadId.slice(0, 8)} reask=${c.reasks + 1}/${MAX_REASKS}`); }
      else console.warn(`routine_resume channel=${ch.slug} thread=${c.threadId.slice(0, 8)} post failed ${res?.status ?? '(network)'}`);
    }
    return n;
  }

  return { resumeStrandedRoutines };
}
