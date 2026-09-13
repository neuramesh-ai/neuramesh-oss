// WHAT THE THREAD SAYS BETWEEN YOUR MESSAGE AND THE ANSWER — the phone's ladder, with no React
// in it.
//
// Split out of ActivityStrip the way the desktop's `waitghost-rule.ts` is split out of its ghost,
// and for the same two reasons. Importing the component reaches `useQuery`, the theme and the
// compute store, so a test of the DECISION would drag half the app in; and the decision is the
// part that can be wrong. It began inline and shipped with a rung nobody could pin.
//
// The ladder is the desktop's, rung for rung. That is not tidiness: the two clients show one
// person one wait, and a client that climbs its own ladder is how "the phone said something else"
// happens. The words live in @neuramesh/shared for the same reason.
import { machineWaitLine, waitTimedOut, waitTimeoutLine, WAIT_THINKING, type MachineStatus } from '@neuramesh/shared';

export interface StripAgent { id: string; name: string; emoji: string | null; role: string; status: string }

/** the newest run in this thread, as the strip reads it */
export interface StripRun { agent_id: string | null; state: string; summary: string | null; started_at: string }

/**
 * The one line, or nothing.
 *
 * `who` is optional because a machine that starts is motion with nobody's name on it. `still`
 * drops the orb for a state that is not going anywhere, which is the difference between a wait and
 * a dead end. `retry` is the way out of a dead end, and only the deadline rung offers one.
 */
export interface StripLine {
  rung: 'working' | 'unsent' | 'dead' | 'machine' | 'timeout' | 'waiting';
  who?: string;
  verb: string;
  still: boolean;
  warn: boolean;
  retry: boolean;
}

const face = (a: { emoji: string | null; name: string }) => `${a.emoji ? `${a.emoji} ` : ''}${a.name}`;

/**
 * The ladder, and every rung is something we can prove:
 *
 *   1. an agent in this room IS working — its own synced status. 'thinking' ONLY: 'working' means
 *      a claimed TASK somewhere else in this room, and including it let patch, grinding on #1003,
 *      present itself as the answer to a conversation it had never seen (2026-09-07);
 *   2. your send has not left the phone — the local upload queue;
 *   3. the wake DIED — the run's own words. A reason invented here would be a second story about
 *      one failure;
 *   4. the machine that answers this thread is not up — its own state, in the desktop's words;
 *   5. NOTHING started and the deadline passed — the fact, and a way to send it again;
 *   6. your message is the newest and nobody has answered — so say who will.
 *
 * Rung 6 is what killed the dead air: the strip used to fall to nothing between the send and the
 * agent's status flip, then to nothing again whenever that status blinked, so the line appeared,
 * vanished, and appeared again saying something else. Rung 5 is what stops rung 6 promising
 * forever — the two arrived together on the desktop, and one wait must not get two stories.
 */
export function stripLineFor(input: {
  crew: StripAgent[];
  /** the newest message is a human's — when it was sent. Null when an agent spoke last. */
  awaitingAtMs: number | null;
  /** rows still in the local upload queue: your send has not left this phone */
  pending: number;
  /** the newest run in this thread, whenever it started */
  run: StripRun | null;
  /** the state of the machine that answers THIS thread, never any other */
  machine: MachineStatus | undefined;
  now: number;
}): StripLine | null {
  const { crew, awaitingAtMs, pending, run, machine, now } = input;
  const busy = crew.filter((a) => a.status === 'thinking').slice(0, 3);
  if (busy.length) return { rung: 'working', who: busy.map(face).join(', '), verb: WAIT_THINKING, still: false, warn: false, retry: false };
  if (pending > 0) return { rung: 'unsent', verb: 'Please wait…', still: false, warn: false, retry: false };
  if (awaitingAtMs === null) return null;
  // THE RUN THAT SPEAKS FOR THIS WAIT — the newest one, and only if it started after the message.
  // A failure the human has already answered by writing again is history, and it must not outrank
  // the fresh wake that followed it.
  const since = run && Date.parse(run.started_at) >= awaitingAtMs ? run : null;
  if (since?.state === 'failed') {
    const who = crew.find((a) => a.id === since.agent_id);
    return { rung: 'dead', ...(who ? { who: who.name } : {}), verb: since.summary || 'The answer did not start.', still: true, warn: true, retry: false };
  }
  const wait = machineWaitLine(machine);
  if (wait) return { rung: 'machine', verb: wait.line, still: wait.stalled, warn: false, retry: false };
  // NOTHING EVER STARTED, and the deadline has passed. Provable, not guessed: both wake paths open
  // a `runs` row before they do any work, so a message with no run of its own is a message nothing
  // picked up. Two minutes past that is not slow, it is silent (WAIT_LIMIT_MS).
  if (!since && waitTimedOut(awaitingAtMs, now)) {
    return { rung: 'timeout', verb: waitTimeoutLine(awaitingAtMs, now), still: true, warn: true, retry: true };
  }
  // who answers when nobody has yet: the room's orchestrator, which is the same choice the wake
  // path makes and the same one the desktop's wait ghost makes. The agent on the orb is the agent
  // that will reply. The verb is the SAME word rung 1 opens with, so this row hands over
  // mid-sentence — it said "answers next" until 2026-09-09.
  const responder = crew.find((a) => a.role === 'orchestrator') ?? crew[0];
  if (!responder) return null;
  return { rung: 'waiting', who: face(responder), verb: WAIT_THINKING, still: false, warn: false, retry: false };
}
