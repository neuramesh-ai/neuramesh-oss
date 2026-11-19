// THE INTAKE WAIT (round 9). nm-api runs intake on a thread's first human message in parallel with the
// machine wake (control-api src/intake.ts). The machine can see the message before the decision lands.
// If it woke the orchestrator at once, a coding ask would be answered in chat, and the coding runtime
// would start a moment later in the same thread. So the routing waits, briefly, for the decision on a
// new thread's first message, then reads the thread again: a coding thread goes to the coding runtime
// (team-routing.ts routeOwnedThread), anything else to the agent, now with the decision in its context.
//
// The wait is bounded. If intake never lands (the starter brain is down, the rule decided nothing, an
// older nm-api), the routing proceeds as before after NM_INTAKE_WAIT_MS (default 7000 ms, the server's
// 6 s deadline plus the replica's sync).

/** the replica reads this needs: the same `getAll` the routing already holds */
export interface IntakeWaitDb {
  getAll<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export type IntakeWaitOutcome = 'none' | 'landed' | 'timeout';

interface ThreadFacts {
  intake: string | null; kind: string | null; home_agent_id: string | null; schedule_id: string | null;
  origin: string | null; task_id: string | null; created_at: string | null;
}

const waitMs = (env: NodeJS.ProcessEnv = process.env): number => {
  const n = Number.parseInt(env['NM_INTAKE_WAIT_MS'] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(15_000, n) : 7_000;
};

/**
 * Wait for the intake decision of a thread's first human message. Returns at once ('none') for every
 * message intake does not decide: a later turn, an Agent Desk home, a routine, a task thread, a coding
 * thread, a thread older than `maxAgeMs`, or a thread whose decision is already there ('landed').
 */
export async function waitForIntake(db: IntakeWaitDb, threadId: string, opts: {
  maxWaitMs?: number; maxAgeMs?: number; pollMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void>;
} = {}): Promise<IntakeWaitOutcome> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxWait = opts.maxWaitMs ?? waitMs();
  // a replica without the 0177 column (an older schema) or any read error reads as "nothing to wait for"
  const rows = async <T,>(sql: string): Promise<T[]> => { try { return await db.getAll<T>(sql, [threadId]); } catch { return []; } };
  const read = async () => (await rows<ThreadFacts>('select intake, kind, home_agent_id, schedule_id, origin, task_id, created_at from threads where id = ?'))[0] ?? null;
  const t = await read();
  if (!t) return 'none';
  if (t.intake) return 'landed';
  if (!maxWait || t.kind === 'coding' || t.home_agent_id || t.schedule_id || t.task_id || t.origin === 'routine') return 'none';
  const born = Date.parse(t.created_at ?? '');
  if (Number.isFinite(born) && now() - born > (opts.maxAgeMs ?? 20_000)) return 'none';
  const [counts] = await rows<{ humans: number; agents: number }>(
    `select sum(case when author_kind = 'human' then 1 else 0 end) as humans, sum(case when author_kind = 'agent' then 1 else 0 end) as agents
       from messages where thread_id = ?`);
  if (Number(counts?.humans ?? 0) > 1 || Number(counts?.agents ?? 0) > 0) return 'none';
  const deadline = now() + maxWait;
  while (now() < deadline) {
    await sleep(Math.min(opts.pollMs ?? 250, Math.max(0, deadline - now())));
    const next = await read();
    if (!next) return 'none';
    if (next.intake) return 'landed';
  }
  return 'timeout';
}
