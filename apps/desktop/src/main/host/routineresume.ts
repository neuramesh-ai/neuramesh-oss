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
// only compute notices — and that anchors no unit. Action is the ordinary wake: this host posts the
// prompt again AS THE OWNER into the same thread. A fresh human trigger rides every mechanism
// unchanged (the placement ladder, the wake lease, the exactly-once reply index, the thread wake
// that carries the conversation), which is what makes the server birth the unit approved.
//
// Bounded three ways: never while a newer run of the same routine exists (the next slot supersedes
// a missed one — no pile-up), at most MAX_REASKS per thread (counted in the thread itself, so a
// restart cannot reset it), and only from the origin's own machine once it holds a usable
// credential (the no-compute notice's own rule, so one host speaks, and never into the void).
import { resolveToken } from '../agents';
import { isComputeNotice } from '../computenotice';
import type { HostedAgent } from '../agents';
import type { PowerSyncDatabase } from '@powersync/node';

export interface RoutineThreadState {
  threadId: string;
  scheduleId: string;
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

  async function gather(ch: { id: string }, nowMs: number): Promise<RoutineThreadState[]> {
    const threads = await db.getAll<{ id: string; schedule_id: string; created_at: string }>(
      `select id, schedule_id, created_at from threads where channel_id = ? and schedule_id is not null and created_at > ? order by created_at desc limit 20`,
      [ch.id, new Date(nowMs - RESUME_WINDOW_MS).toISOString()],
    ).catch(() => [] as Array<{ id: string; schedule_id: string; created_at: string }>);
    const out: RoutineThreadState[] = [];
    for (const th of threads) {
      const msgs = await db.getAll<{ author_kind: string; author_id: string; body: string | null; created_at: string }>(
        `select author_kind, author_id, body, created_at from messages where thread_id = ? order by created_at asc limit 60`, [th.id],
      ).catch(() => [] as Array<{ author_kind: string; author_id: string; body: string | null; created_at: string }>);
      const humans = msgs.filter((m) => m.author_kind === 'human');
      if (!humans.length) continue;
      const lastHumanAtMs = Date.parse(humans[humans.length - 1]!.created_at);
      const [units] = await db.getAll<{ n: number }>(`select count(*) as n from tasks where origin_thread_id = ?`, [th.id]).catch(() => [{ n: 0 }]);
      const [runs] = await db.getAll<{ n: number }>(`select count(*) as n from runs where thread_id = ? and state = 'running'`, [th.id]).catch(() => [{ n: 0 }]);
      out.push({
        threadId: th.id, scheduleId: th.schedule_id, bornMs: Date.parse(th.created_at), ownerId: humans[0]!.author_id, lastHumanAtMs,
        agentReplies: msgs.filter((m) => m.author_kind === 'agent' && Date.parse(m.created_at) > lastHumanAtMs).map((m) => ({ atMs: Date.parse(m.created_at), body: m.body ?? '' })),
        reasks: humans.filter((m) => (m.body ?? '').startsWith(REASK_PREFIX)).length,
        anchoredUnits: units?.n ?? 0, runningRuns: runs?.n ?? 0,
        newerRunExists: threads.some((o) => o.schedule_id === th.schedule_id && o.created_at > th.created_at),
      });
    }
    return out;
  }

  /** one channel, one tick: re-ask every stranded routine this host may speak for. Returns the count. */
  async function resumeStrandedRoutines(orch: HostedAgent, ch: { id: string; slug: string; workspace_id: string }): Promise<number> {
    if (process.env['NM_AGENT_MODE'] === 'echo') return 0;
    const now = Date.now();
    const stranded = pickStrandedRoutines(await gather(ch, now), now)
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
