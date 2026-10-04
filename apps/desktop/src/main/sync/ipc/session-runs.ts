// A ROUTINE'S RUNS, FOR THE AUTOMATIONS PANEL (docs/design/routine-sessions-2026-09/plan.md, PR 3): the
// desktop twin of hq's web/webnm-sessionruns.ts.
//
// A schedule's runs live in its session. Each run opens with a message that keeps the schedule
// (messages.schedule_id, 0145), and a session from before 0145 opens with its first message. The panel
// lists the newest runs, each with its strip, so this read takes the openers first, then the rows the
// strips count, for the sessions those runs live in. The strip itself is derived in the renderer by
// @neuramesh/shared session-runs.ts, the same derivation the session runs.
//
// Every read is capped at the oldest listed run: a year of daily runs in one session stays a read of the
// last eight.
type ReadDb = { getAll<T>(sql: string, params?: unknown[]): Promise<T[]> };

// a run's opener: a message that keeps the schedule, or the first message of a session the schedule
// opened before the column existed
export const RUNS_SQL = `select m.id, m.thread_id, m.created_at, t.channel_id, c.slug as channel_slug, t.title, t.settled_at
     from messages m join threads t on t.id = m.thread_id left join channels c on c.id = t.channel_id
    where t.schedule_id = ? and t.workspace_id = ? and t.archived_at is null
      and (m.schedule_id = ? or m.id = (select f.id from messages f where f.thread_id = t.id order by f.created_at asc, f.id asc limit 1))
    order by m.created_at desc limit ?`;

export interface ScheduleRunsRead {
  runs: Array<{ id: string; thread_id: string; created_at: string; channel_id: string; channel_slug: string | null; title: string | null; settled_at: string | null }>;
  messages: unknown[]; units: unknown[]; cards: unknown[]; drafts: unknown[]; files: unknown[]; openRuns: unknown[];
}

/** the listed runs, and the rows their strips count, for the sessions they live in */
export async function scheduleRunsFor(db: ReadDb, ws: string, scheduleId: string, limit?: number): Promise<ScheduleRunsRead> {
  const runs = await db.getAll<ScheduleRunsRead['runs'][number]>(RUNS_SQL, [scheduleId, ws, scheduleId, Math.min(Math.max(limit ?? 8, 1), 50)]).catch(() => []);
  if (!runs.length) return { runs, messages: [], units: [], cards: [], drafts: [], files: [], openRuns: [] };
  const threads = [...new Set(runs.map((r) => r.thread_id))];
  const since = runs[runs.length - 1]!.created_at;
  const inThreads = `(${threads.map(() => '?').join(', ')})`;
  const read = (sql: string, withSince = true): Promise<unknown[]> => db.getAll<unknown>(sql, withSince ? [...threads, since] : threads).catch(() => []);
  const [messages, units, cards, drafts, files, openRuns] = await Promise.all([
    read(`select id, author_kind, body, created_at, schedule_id, thread_id from messages where thread_id in ${inThreads} and created_at >= ? order by created_at asc, id asc`),
    // the units each session owns (docs/41), with the ball rule's stamp (watch-board.ts TASKS_ALL_SQL)
    read(`select t.id, t.number, t.title, t.state, t.kind, t.parent_task_id, t.plan_approved_at, t.pr_number, t.created_at, t.updated_at, t.origin_thread_id,
                 (select max(m.created_at) from messages m where m.author_kind = 'human' and m.task_id = t.id and m.body not like '‹github:connected:%') as last_human_msg_at
            from tasks t where t.origin_thread_id in ${inThreads} and t.parent_task_id is null and t.created_at >= ?`),
    // a card asked in a session is answered in that session (watch-board.ts DECISIONS_ALL_SQL). the strip
    // overrides this with the newest person's word inside the card's own run
    read(`select d.message_id, d.status, d.created_at, d.allow_other, m.thread_id,
                 (select max(h.created_at) from messages h where h.thread_id = m.thread_id and h.author_kind = 'human' and h.body not like '‹github:connected:%') as human_replied_at
            from decisions d join messages m on m.id = d.message_id where m.thread_id in ${inThreads} and d.created_at >= ?`),
    read(`select body, status, created_at, scheduled_at, published_at, last_error, thread_id from content_items where thread_id in ${inThreads} and created_at >= ?`),
    read(`select a.created_at, a.name, m.thread_id from artifacts a join messages m on m.id = a.message_id where m.thread_id in ${inThreads} and a.created_at >= ?`),
    read(`select started_at, thread_id from runs where thread_id in ${inThreads} and state = 'running'`, false),
  ]);
  return { runs, messages, units, cards, drafts, files, openRuns };
}
