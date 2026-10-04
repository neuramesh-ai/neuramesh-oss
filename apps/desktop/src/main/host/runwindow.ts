// one session per routine, the woken agent's half (docs/design/routine-sessions-2026-09/plan.md, PR 2).
//
// a schedule's session holds every run, and each run starts clean. a run opens at the message its
// launcher posts, which carries the schedule (messages.schedule_id, 0145), so the cut is a column,
// never a text marker: the wake reads the thread from the newest opener, and so do the drafts, the
// angle gate and the release digest. before this, one session would have handed tomorrow's run
// today's transcript, today's brain notes ("build on it, do NOT redo it") and today's results ("do
// NOT fan out again"), and the run would skip its own work.
//
// the session's first message opens a run too, as in @neuramesh/shared session-runs.ts: a session
// from before 0145 holds no column on its opener. any other thread has no cut ('' sorts before every
// time, so a read cut at it reads the whole thread).
type ReadDb = { getAll: <T>(sql: string, params?: unknown[]) => Promise<T[]> };

/** the newest run's opener time in a schedule's session, as the replica holds it. '' for any other thread */
export async function runCut(db: ReadDb, threadId: string | null | undefined): Promise<string> {
  if (!threadId) return '';
  const [r] = await db.getAll<{ cut: string | null }>(
    `select coalesce((select max(m.created_at) from messages m where m.thread_id = t.id and m.schedule_id is not null),
                     (select min(m.created_at) from messages m where m.thread_id = t.id)) as cut
       from threads t where t.id = ? and t.schedule_id is not null limit 1`,
    [threadId],
  ).catch(() => [] as Array<{ cut: string | null }>);
  return r?.cut ?? '';
}

/** the schedule a session belongs to, or null. the server names such a session after its schedule, so no agent names it */
export async function scheduleOfThread(db: ReadDb, threadId: string | null | undefined): Promise<string | null> {
  if (!threadId) return null;
  const [r] = await db.getAll<{ schedule_id: string | null }>(`select schedule_id from threads where id = ? limit 1`, [threadId]).catch(() => [] as Array<{ schedule_id: string | null }>);
  return r?.schedule_id ?? null;
}

export interface RunWindow {
  /** a read of the thread keeps `created_at >= cut` */
  cut: string;
  /** the same moment in ms, for the brain's notes and results. undefined keeps them all */
  since: number | undefined;
}

/** the window a wake reads of its thread */
export async function runWindow(db: ReadDb, threadId: string | null | undefined): Promise<RunWindow> {
  const cut = await runCut(db, threadId);
  const ms = cut ? Date.parse(cut) : NaN;
  return { cut, since: Number.isFinite(ms) ? ms : undefined };
}

/**
 * The drafts on screen, oldest first, so the index is the card letter: a thread's drafts in its newest
 * run, whose cards the letters restart at (@neuramesh/shared draftLetters), and a task's drafts all.
 * "reschedule b" means the b the person sees in the run below the newest divider.
 */
export async function runDrafts<T>(db: ReadDb, at: { taskId?: string | null; threadId?: string | null }, cols: string): Promise<T[]> {
  const id = at.taskId ?? at.threadId;
  if (!id) return [];
  const cut = at.taskId ? '' : await runCut(db, id);
  return db.getAll<T>(
    `select ${cols} from content_items where ${at.taskId ? 'task_id' : 'thread_id'} = ?${cut ? ' and created_at >= ?' : ''} order by created_at asc`,
    cut ? [id, cut] : [id],
  ).catch(() => [] as T[]);
}

const CLOSED = new Set(['accepted', 'closed']);
const unitLine = (u: { number: number; title: string; state: string }): string => `#${u.number} "${u.title.slice(0, 80)}" (${u.state})`;
const utc = (at: string): string => new Date(Date.parse(at)).toISOString().slice(0, 16).replace('T', ' ');

/**
 * The previous run in one line, for the orchestrator's prompt: when it opened, the units it made and
 * their states, and the units older runs left open. The wake reads only the newest run, so without
 * this line a daily run files again the unit that yesterday's run made. '' for a first run and for
 * any thread that is no schedule's.
 */
export async function previousRunNote(db: ReadDb, threadId: string | null | undefined): Promise<string> {
  if (!threadId) return '';
  const openers = await db.getAll<{ created_at: string }>(
    `select m.created_at from messages m join threads t on t.id = m.thread_id
      where m.thread_id = ? and t.schedule_id is not null
        and (m.schedule_id is not null or m.created_at = (select min(f.created_at) from messages f where f.thread_id = t.id))
      order by m.created_at desc limit 2`,
    [threadId],
  ).catch(() => [] as Array<{ created_at: string }>);
  const [newest, previous] = openers;
  if (!newest || !previous) return '';
  const units = await db.getAll<{ number: number; title: string; state: string; created_at: string }>(
    `select number, title, state, created_at from tasks where origin_thread_id = ? and parent_task_id is null and created_at < ? order by created_at desc limit 24`,
    [threadId, newest.created_at],
  ).catch(() => [] as Array<{ number: number; title: string; state: string; created_at: string }>);
  const from = Date.parse(previous.created_at);
  const made = units.filter((u) => Date.parse(u.created_at) >= from).slice(0, 8);
  const open = units.filter((u) => Date.parse(u.created_at) < from && !CLOSED.has(u.state)).slice(0, 8);
  return `\n\n[EARLIER RUNS. This session holds every run of its schedule, and the transcript starts at this run's opener. The previous run opened ${utc(previous.created_at)} UTC and made ${made.length ? made.map(unitLine).join(', ') : 'no units'}.${open.length ? ` Older runs left these units open: ${open.map(unitLine).join(', ')}.` : ''} Do not file the same work again. Build on it, or say that it still waits.]`;
}
