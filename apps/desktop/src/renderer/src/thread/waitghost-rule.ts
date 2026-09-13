// WHAT A THREAD SAYS BETWEEN YOUR MESSAGE AND THE ANSWER — the rule, with no React in it.
//
// Kept apart from the component on purpose. Importing WaitGhost.tsx reaches `useCompute`, which
// reaches `bridge/nm`, which reads `window` at module scope — so a node test that imported the
// component died on `ReferenceError: window is not defined` before running an assertion. The
// decision is the part worth testing and it needs none of that, so it lives here and the component
// imports it. Types only across that line; type imports are erased, values are not.
//
// It began as the machine rung alone (`machineGhostFor`, cloud-cap round): a machine coming up had
// nothing to narrate, so the thread sat blank. The gap it left was the one directly beside it —
// a machine that IS up still takes seconds to answer, because the wake has to travel to the
// runner and its `thinking` status has to travel back. On the browser that is TWO PowerSync round
// trips with no local stream to short-circuit them (webnm has no `watchAgentStream`), so the orb
// arrived several seconds after the send and the thread read as broken in between (George,
// 2026-09-09: "it takes a few seconds before the agent thinking states orbs appear, which makes
// the user think nothing is happening").
//
// The phone already answered this, and the ladder here is its ladder (apps/mobile's ActivityStrip,
// 2026-09-07): every rung is something we can prove, and the last one is the one that kills the
// dead air. One question, one answer, three clients.
import { addressedIn, agentInChannel, MACHINE_WAIT_LINE, MACHINE_WAIT_STALLED, unaddressedWake, waitTimedOut, waitTimeoutLine, WAIT_THINKING, type MachineStatus } from '@neuramesh/shared';
import type { AgentRow } from '../bridge/rows-crew';

// The WORDS moved to @neuramesh/shared (MACHINE_WAIT_LINE), because the phone needs the same ones
// and one machine must never get two stories. Re-exported under their old names so this module's
// tests and the component keep their imports.
export const PROGRESS = MACHINE_WAIT_LINE;
export const STALLED = MACHINE_WAIT_STALLED;

/** what the working ghost says with no tool verbs yet, so the handover is seamless (docs/26).
 *  Re-exported from @neuramesh/shared, where the phone reads the same word. */
export const THINKING = WAIT_THINKING;

/**
 * WHICH WAIT THIS IS. A discriminant rather than a string test on `line`: the surface picks an orb
 * and an affordance from it, and matching on copy is how a reworded line silently changes both.
 */
export type WaitKind = 'thinking' | 'machine' | 'dead' | 'timeout';

export interface WaitGhostRow {
  /** the face: the agent that will actually take this message */
  agent: AgentRow;
  /** which rung of the ladder answered */
  kind: WaitKind;
  /** the one line beside the orb */
  line: string;
  /** nothing is moving — the orb is dropped rather than promising an answer that is not coming */
  stalled: boolean;
  /** the second line, when there is reassurance worth making. The plain wait makes none. */
  note?: string;
}

/** the newest run in this thread, when the UI has one to offer */
export interface WaitRun { agent_id: string | null; state: string; summary: string | null }

/** the task a thread belongs to, when it is a task thread rather than a conversation */
export interface WaitTask { state: string; kind?: string | null; assignee_kind?: string | null; assignee_id?: string | null }

/**
 * WHO IS ABOUT TO ANSWER, or null when the honest answer is nobody.
 *
 * An @mention wins everywhere, exactly as the wake path resolves it — and in a task thread it is
 * the reason a reply on an `in_review` task gets an orb at all, because naming somebody is what
 * makes that message answerable.
 *
 * A CONVERSATION always has a responder: the room's orchestrator, which is the choice the wake
 * path makes and the choice the phone's strip and the machine rung already show. A TASK thread
 * does not, and that is the whole difference — `unaddressedWake` is the wake's own policy, so a
 * settled task (in_review, done, accepted, closed, a parked backlog item) draws no orb here for
 * the same reason it wakes nobody there. Guessing from the FSM a second time is how the two would
 * drift, and a drifted orb promises a reply nobody will send.
 */
export function responderFor(body: string, agents: AgentRow[], channelId: string, task?: WaitTask | null): AgentRow | null {
  const inRoom = agents.filter((a) => agentInChannel(a.channel_ids, channelId));
  const named = inRoom.find((a) => addressedIn(body, a.name));
  if (named) return named;
  const orch = inRoom.find((a) => a.role === 'orchestrator');
  if (!task) return orch ?? inRoom[0] ?? null;
  const who = unaddressedWake(task.state, task.kind);
  if (who === 'orchestrator') return orch ?? null;
  if (who === 'assignee' && task.assignee_kind === 'agent' && task.assignee_id) {
    return inRoom.find((a) => a.id === task.assignee_id) ?? null;
  }
  return null;
}

/**
 * THE RUN THAT SPEAKS FOR THIS WAIT — the newest one, and only if it started after the newest
 * message.
 *
 * A wake that died is synced truth, and nothing on these surfaces read it: a bare wake run draws
 * no card (`isWatchableRun`), so a turn that threw — "starter brain unavailable (503)" — left the
 * thread with the same blank a healthy turn left. That blank is what the wait ghost fills, so it
 * has to be able to STOP.
 *
 * The `since` clause is what keeps it honest in the other direction: a failure the human has
 * already answered by writing again is history, and it must not outrank the fresh wake that
 * followed it. Callers pass the runs already scoped to their thread or task.
 */
export function waitRunFor<T extends { started_at: string }>(runs: T[], rows: { created_at: string }[]): T | null {
  const since = rows[rows.length - 1]?.created_at ?? '';
  let best: T | null = null;
  for (const r of runs) if (r.started_at >= since && (!best || r.started_at > best.started_at)) best = r;
  return best;
}

/**
 * The ladder, in the order the phone climbs it. Each rung removes a way to cry wolf:
 *
 *   0. a HUMAN spoke last — an answered thread is not waiting on anything, and neither is one
 *      whose newest word is an agent's;
 *   1. somebody here can answer it, and is not already narrating itself — with nobody the orb
 *      promises a reply that is not on its way, and beside that agent's own run card it is the
 *      same agent reported twice;
 *   2. THE WAKE DIED and nothing has answered since — the run says so in its own words. This is
 *      the rung that stops rung 4 lying forever, and without it the fix would be worse than the
 *      dead air it removes: a spinner with nothing behind it, until the thread is closed;
 *   3. the machine is not up — its own state, in the words the phone uses (`capped` is excluded
 *      by MACHINE_WAIT_LINE because it has a card, which says far more than an orb ever could,
 *      and `online` because the real ghost takes over — two orbs are worse than none);
 *   4. NOTHING EVER STARTED, and the deadline has passed — no orb, the fact, and a way to send
 *      the message again (WAIT_LIMIT_MS). It rests on a provable absence: both wake paths open a
 *      `runs` row before they do any work, so "no run for my message" is evidence, not a guess;
 *   5. your message is the newest and nobody has answered — so show the orb and say who will.
 *
 * Rung 5 is unbounded in every other respect, exactly as the phone's is: a message nobody answered
 * is still waiting an hour later, and giving up on a run that IS stepping would teach people the
 * orb quits before the work does. That is why rung 4 tests for a missing run rather than for
 * elapsed time alone, and why a running one keeps the orb however long it takes.
 */
export function waitGhostFor(input: {
  rows: { author_kind: string; body?: string; created_at?: string }[];
  agents: AgentRow[];
  channelId: string;
  machine: MachineStatus | undefined;
  /** the newest run in this thread — a failed one outranks every wait */
  run?: WaitRun | null;
  /** set for a task thread; omitted for a conversation */
  task?: WaitTask | null;
  /** agents whose OWN run card is already on screen (docs/29 §4) */
  carded?: Set<string>;
  /** the clock, passed in so the rule stays pure and the deadline stays testable */
  now?: number;
}): WaitGhostRow | null {
  const { rows, agents, channelId, machine, run, task, carded, now } = input;
  const last = rows[rows.length - 1];
  if (last?.author_kind !== 'human') return null;
  const agent = responderFor(last.body ?? '', agents, channelId, task);
  if (!agent) return null;
  // …and it stands down for an agent already narrating itself, exactly as the working ghost does.
  // A live run card says everything this row would and more, so the two together are one agent
  // reported twice — the case a task-thread capture caught on the day this rung landed.
  if (carded?.has(agent.id)) return null;
  // the run's OWN words. A reason invented here would be a second story about one failure — and
  // the face stays whoever actually died, not who we thought would answer.
  if (run?.state === 'failed') {
    const who = agents.find((a) => a.id === run.agent_id) ?? agent;
    return { agent: who, kind: 'dead', line: run.summary || 'The answer did not start.', stalled: true };
  }
  if (machine && PROGRESS[machine]) {
    const stalled = !!STALLED[machine];
    return {
      agent,
      kind: 'machine',
      line: PROGRESS[machine]!,
      stalled,
      // the reassurance the cap card also makes, and for the same reason: chatsweep answers a
      // message the host slept through, so the request is genuinely held rather than dropped. A
      // stalled machine gets the honest version — the message IS kept, but "as soon as it is up"
      // would be promising an event nobody has scheduled.
      note: stalled
        ? 'We keep your message. Add credits, then an agent answers it.'
        : 'Your message waits here. An agent answers it when the machine is awake.',
    };
  }
  // NOTHING EVER STARTED. Not "slow": both wake paths open a run before they do any work, so a
  // message with no run of its own, past the deadline, has nothing behind it. Say the fact, drop
  // the orb, and offer the one move that has ever fixed this — say it again.
  const sinceMs = last.created_at ? Date.parse(last.created_at) : NaN;
  if (!run && now !== undefined && waitTimedOut(sinceMs, now)) {
    return { agent, kind: 'timeout', line: waitTimeoutLine(sinceMs, now), stalled: true };
  }
  // THE SEND ITSELF. Same word the working ghost opens with, so when the real one arrives it
  // takes the row over mid-sentence instead of swapping the line under the reader.
  return { agent, kind: 'thinking', line: THINKING, stalled: false };
}
