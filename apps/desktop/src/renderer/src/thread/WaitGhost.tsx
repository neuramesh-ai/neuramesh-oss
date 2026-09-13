// THE GHOST FOR WORK THAT HAS NOT STARTED YET (2026-08-29, widened 2026-09-09).
//
// AgentGhost shows an agent that IS working: it reads that run's log rows and narrates them. Until
// there is a run to read it renders nothing, so the person who just sent a message sees their
// words sit there with no reply, no orb, and no reason. George hit that twice, at the two stages
// this component now covers:
//
//   · the machine is still coming up — "instead of just no response, when the machine is
//     unavailable or starting, the thinking orb should show with the machine's progress";
//   · the machine is UP and the wake is in flight — "it takes a few seconds before the agent
//     thinking states orbs appear, which makes the user think nothing is happening" (2026-09-09).
//
// The second gap is the browser's by construction. The desktop has a local token stream that opens
// the instant an agent wakes, and the browser has none (webnm ships no `watchAgentStream`), so the
// only signal there is the agent's synced `status` — which has to travel to the runner and back
// through PowerSync before a single pixel can change. The frontend cannot make that faster. It can
// stop pretending nothing happened in the meantime, which is all this is.
//
// He is right, and the reason is bigger than politeness. Silence is the same shape as failure. A
// person cannot tell "nothing is happening" from "something is happening that you cannot see", so
// they wait, then re-send, then conclude it is broken. An orb with a status costs nothing and
// removes the ambiguity: the request is held, and here is what it is waiting on.
//
// It shows the SAME orb the working ghost uses, deliberately, and opens on the same word. This is
// the same promise at an earlier stage, not a different kind of event: giving it its own indicator
// would teach people to read two spinners, and giving it its own verb would swap the line under
// the reader at the exact moment the real ghost takes the row over.
//
// …AND IT GIVES UP HONESTLY (George, 2026-09-09: "add a bounded time to the thinking state, if no
// response for up to x minutes, then it should show an error and user can retry"). Past
// WAIT_LIMIT_MS with no run ever opened for the message, it drops the orb, states the fact, and
// offers the one move that has ever fixed this: say it again.
import { Orb } from '../ui/Orb';
import { AgentAvatar } from '../components/AgentAvatar';
import { WAIT_RETRY, WAIT_TICK_MS } from '@neuramesh/shared';
import { waitGhostFor, type WaitGhostRow, type WaitRun, type WaitTask } from './waitghost-rule';
import { useCompute } from '../compute/useCompute';
import { useEffect, useState } from 'react';
import type { AgentRow } from '../bridge/rows-crew';
import type { MessageRow } from '../bridge/rows-rooms';

/**
 * The clock, ticked only while somebody is actually waiting.
 *
 * `active` is the ladder's own rung 0 — the newest row is a human's — asked cheaply here so a
 * settled thread never re-renders its surface on a timer. This app has a 60fps list budget, and a
 * per-thread interval that fires forever to answer a question with a fixed answer is exactly the
 * kind of thing that quietly spends it.
 *
 * It re-reads the clock when it ARMS, not only on the interval: without that, a thread mounted an
 * hour ago and typed into now would measure a fresh message against a stale `now` and declare the
 * deadline passed on the first render.
 */
function useWaitClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), WAIT_TICK_MS);
    return () => clearInterval(iv);
  }, [active]);
  return now;
}

/**
 * The decision, as a hook — because the CALLER has to know who this ghost speaks for.
 *
 * One live surface per agent, ranked run card › ghost › chip (docs/29 §4). The composer's typist
 * bar is that chip, and it selects on the same "thinking in this room" predicate: without the
 * ghost's face in hand, a thread showed "rex · thinking…" in the transcript and "rex is thinking"
 * under the composer at the same time — the same sentence twice, each with its own door to the one
 * activity log. So the surface asks first and renders second.
 */
export function useWaitGhost(input: {
  rows: MessageRow[]; agents: AgentRow[]; channelId: string; run?: WaitRun | null; task?: WaitTask | null;
  carded?: Set<string>;
}): WaitGhostRow | null {
  const machine = useCompute(true)?.status;
  const now = useWaitClock(input.rows[input.rows.length - 1]?.author_kind === 'human');
  return waitGhostFor({ ...input, machine, now });
}

export function WaitGhost({ found, onRetry }: {
  found: WaitGhostRow | null;
  /** send the waiting message again — the one move the deadline offers. Absent = no control. */
  onRetry?: () => void | Promise<void>;
}) {
  const [sending, setSending] = useState(false);
  if (!found) return null;
  const { agent, kind, line, stalled, note } = found;
  return (
    <div className="msg ghostmsg">
      <AgentAvatar name={agent.name} size={26} interactive />
      <div className="body">
        <div className="head">
          <b>{agent.name}</b>
          {agent.role ? <span className="rolechip msgrole" data-role={agent.role}>{agent.role}</span> : null}
          <span className="time">now</span>
        </div>
        <div className="ghostrow">
          <span className="liveact ghoststep" aria-live="polite">
            {/* NO ORB WHEN NOTHING IS MOVING. A spinner is a promise that something is underway,
                and at a zero balance — or after a wake that died, or one that never started —
                nothing is: spinning there made an unpayable machine look like a slow one. */}
            {stalled ? null : (
              /* two words, two truths. `connecting` is the honest one while the MACHINE is being
                 reached — that is not the agent thinking. Once it is up, the wait IS the agent
                 starting to think, so the orb breathes exactly as the working ghost's does and
                 the handover is invisible. */
              <Orb
                state={kind === 'thinking' ? 'breathing' : 'connecting'}
                label={kind === 'thinking' ? `${agent.name} is ${line}` : `${agent.name} is waiting for the cloud machine`}
              />
            )}
            {/* keyed on the text so the sheen replays when the wait moves to the next state */}
            <span className="liveact-txt" key={line}>{line}</span>
          </span>
          {/* The deadline's one move. It rides the ghost row rather than docking above the
              composer, because the docked slot is the contextual GATE (docs/25 §3), and a send
              nothing picked up is not a gate — it is a fact about the message already on screen. */}
          {kind === 'timeout' && onRetry && (
            <button type="button" className="ghostact" disabled={sending}
              onClick={() => { setSending(true); void Promise.resolve(onRetry()).finally(() => setSending(false)); }}>
              {sending ? 'Sending…' : WAIT_RETRY}
            </button>
          )}
        </div>
        {/* Only where there is reassurance worth making. The plain wait makes none: the orb and
            the agent's own name already say a reply is on its way, and a line under them
            explaining that is the subtext CLAUDE.md #11 says to delete rather than shrink. */}
        {note ? <div className="ghostelapsed">{note}</div> : null}
      </div>
    </div>
  );
}
