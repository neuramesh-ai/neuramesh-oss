// A WAKE THAT FAILED says so in its thread, once (the sandbox browser run, 2026-10-27).
//
// The host queue runs a wake inside its thread's conversation brain (host/brain-recording.ts), and the
// brain loads its cloud checkpoint first. When that load failed ("The cloud brain could not load
// (503). Retry before this thread continues.") the queue logged "flow … threw" and that was all: the
// wake never ran, so no run row opened and no reply came. The person's message stayed the thread's
// last word, and every client derives "in progress" from exactly that (shared/threadstatus.ts: the
// agent owes a reply), so the thread read in progress for as long as anyone looked. A wake that failed
// INSIDE its turn (the starter brain's 503, the four-minute wall) ended the same way on the rail: its
// run settled failed and the thread view said why, but the person's message stayed the last word.
//
// A request must never vanish (wakerouting.ts, 2026-08-14), so a failed turn ends out loud, the way a
// wake that cannot run already does (the no-compute and no-credits notices): the agent's notice in the
// thread, as its reply to the message, with the machine's own reason. The thread then reads settled on
// every client, the reason is on screen, and the message sent again is a fresh wake (a brain that did
// not load retries its load on the next turn).
//
// It keeps the wake's rules about who speaks. Only the machine that holds the message says anything:
// a wake that got past its lease speaks with the run it holds, and one that failed before its lease
// takes the lease first, exactly as the wake does (agents.ts openWakeRun), so a machine whose turn
// failed never talks over the member machine that is answering. The run settles failed, with the same
// words, and the reply index (0060) keeps it to one reply per message.
import { turnFailedNotice } from '../computenotice';
import type { HostedAgent } from '../agents';
import type { RunHandle } from './runs';

/** where the wake was asked: a conversation names its thread, a task thread its task */
export interface WakeAt { channelId: string; threadId?: string | null; taskId?: string | null }

export interface FailedWakeDeps {
  db: { get<T>(sql: string, params?: unknown[]): Promise<T> };
  openWakeRun: (agent: HostedAgent, where: { workspace: string; channelId: string; threadId?: string | null; taskId?: string | null }, prompt: string, triggerMessageId?: string | null) => Promise<RunHandle>;
  post: (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<Response>;
  log?: (line: string) => void;
}

/** what became of the notice: said in the thread, left to the machine that holds the message, unsaid,
 *  or held back on purpose (a reply the dead-letter sweep answers once the server is back) */
export type FailedWakeOutcome = 'said' | 'elsewhere' | 'unsaid' | 'quiet';

const reasonOf = (err: unknown): string => (err instanceof Error && err.message.trim() ? err.message.trim() : 'The turn could not start.');
const noteFailure = (deps: Pick<FailedWakeDeps, 'log'>, m: { id: string }, why: string): void => deps.log?.(`failed wake ${m.id.slice(0, 8)}: the notice did not post (${why})`);

/** the wake holds the message (`run` is its lease, or no run at all when runs are down): settle the run
 *  failed and answer the message with the reason */
export async function sayTurnFailed(deps: Pick<FailedWakeDeps, 'db' | 'post' | 'log'>, agent: HostedAgent, m: { id: string; body: string }, at: WakeAt, err: unknown, run: RunHandle): Promise<FailedWakeOutcome> {
  const reason = reasonOf(err);
  try {
    await run.settle('failed', reason.slice(0, 200));
    const ch = await deps.db.get<{ id: string; workspace_id: string }>('select id, workspace_id from channels where id = ?', [at.channelId]);
    // a conversation can move rooms mid-turn (file_conversation): its thread names the room it lives in now
    const moved = at.threadId
      ? await deps.db.get<{ channel_id: string } | null>('select channel_id from threads where id = ?', [at.threadId]).catch(() => null)
      : null;
    const res = await deps.post('/v1/messages', { kind: 'agent', id: agent.id }, {
      workspace: ch.workspace_id, channel: moved?.channel_id ?? ch.id, replyTo: m.id, body: turnFailedNotice(reason),
      ...(at.threadId ? { threadId: at.threadId } : {}), ...(at.taskId ? { taskId: at.taskId } : {}),
    });
    // a 409 is the reply index (0060): this agent already answered the message, and nothing is owed
    if (!res.ok && res.status !== 409) noteFailure(deps, m, String(res.status));
    return res.ok ? 'said' : 'unsaid';
  } catch (e) {
    noteFailure(deps, m, e instanceof Error ? e.message.slice(0, 120) : 'error');
    return 'unsaid';
  }
}

/** a wake that failed before it held its message (the queue's around, or before its lease): take the
 *  lease the way the wake does, and speak only with it */
export async function failedWake(deps: FailedWakeDeps, agent: HostedAgent, m: { id: string; body: string }, at: WakeAt, err: unknown): Promise<FailedWakeOutcome> {
  try {
    const ch = await deps.db.get<{ id: string; workspace_id: string }>('select id, workspace_id from channels where id = ?', [at.channelId]);
    const run = await deps.openWakeRun(agent, { workspace: ch.workspace_id, channelId: ch.id, threadId: at.threadId ?? null, taskId: at.taskId ?? null }, m.body, m.id);
    // another machine holds this message: it answers, or says itself why it cannot
    if (run.lost) return 'elsewhere';
    return await sayTurnFailed(deps, agent, m, at, err, run);
  } catch (e) {
    noteFailure(deps, m, e instanceof Error ? e.message.slice(0, 120) : 'error');
    return 'unsaid';
  }
}

/** how a wake's own catch ends a failed turn (wake.ts). `held`: the wake got past its lease, so its run
 *  speaks for the message. `rearmed`: the reply post gave up and the dead-letter sweep answers once the
 *  server is back, so a notice must not take the one reply the message may get */
export async function endFailedTurn(deps: FailedWakeDeps, f: { agent: HostedAgent; m: { id: string; body: string }; at: WakeAt; err: unknown; run: RunHandle; held: boolean; rearmed: boolean }): Promise<FailedWakeOutcome> {
  if (f.rearmed) {
    await f.run.settle('failed', reasonOf(f.err).slice(0, 200));
    return 'quiet';
  }
  return f.held ? sayTurnFailed(deps, f.agent, f.m, f.at, f.err, f.run) : failedWake(deps, f.agent, f.m, f.at, f.err);
}
