// WHO IS LIVE IN THIS CONVERSATION — the four answers, derived once.
//
// The conversation's twin of `useTaskPresence` (thread/task/Presence.tsx), and extracted for the
// same reason: these four derivations are one question asked in one place, and the surface below
// them only renders. The wait ghost is what forced it — ConvoThread crossed the size ratchet, and
// the ratchet is shrink-only on purpose (scripts/lint-ratchet.mjs): a file that grows extracts.
//
// They are answers to ONE question, so they must not be computed in two places. The typist chip
// used to select on its own "thinking in this room" predicate beside the ghost's, and the two had
// to agree by hand or the same agent narrated itself twice under two labels. `typists` is now the
// ghost's own list, so they cannot disagree — and neither can name an agent working elsewhere.
import { isRunOpen, type RunState } from '@neuramesh/shared';
import { ghostPick, workingHere } from './ghost-rule';
import { useWaitGhost } from './WaitGhost';
import { waitRunFor, type WaitGhostRow } from './waitghost-rule';
import type { RunTree } from '../runs/runs';
import type { AgentRow, MachineRow } from '../bridge/rows-crew';
import type { MessageRow } from '../bridge/rows-rooms';
import type { RunUI } from '../bridge/rows-board';
import { useMemo } from 'react';

export interface ConvoPresence {
  /** the agent the WORKING ghost speaks for — null when nothing is under way here */
  ghostAgent: AgentRow | null;
  /** the agent the WAIT ghost speaks for, while the working one cannot exist yet */
  waitGhost: WaitGhostRow | null;
  /** agents whose own run card is on screen (docs/29 §4) */
  carded: Set<string>;
  /** everyone working HERE, streamer first — the composer chip names whoever the surfaces above
   *  it have not already spoken for */
  typists: AgentRow[];
}

export function useConvoPresence(d: {
  rows: MessageRow[];
  agents: AgentRow[];
  machines: MachineRow[];
  channelId: string;
  threadId: string;
  runRows: RunUI[];
  trees: RunTree[];
  stream: { agent: string; text: string } | null;
  /** the same entry once TOKENS flow — presence mounts the ghost, text draws the bubble (§4) */
  streaming: { agent: string; text: string } | null;
}): ConvoPresence {
  const { rows, agents, machines, channelId, threadId, runRows, trees, stream, streaming } = d;
  // Who is working in THIS thread (ghost-rule.ts): the local stream names the wake this machine
  // runs, and the synced run row names one served anywhere else — by the thread it answers in,
  // never by the agent's global status. The old room-wide fallback ("an agent here is thinking",
  // scoped only by where the LOCAL stream said it was) lit the orb in every open thread for one
  // cloud wake, because a wake on another machine never fills that map (George, 2026-09-18).
  const typists = useMemo(
    () => workingHere({ agents, machines, where: { threadId }, runs: runRows, stream }),
    [agents, machines, threadId, runRows, stream],
  );
  const carded = useMemo(() => new Set(trees.filter((t) => isRunOpen(t.run.state as RunState)).map((t) => t.run.agent_id)), [trees]);
  // the ghost fills the reply slot while an agent works here and no text flows yet — and stands
  // down for an agent whose own run card is on screen (card › ghost › chip), which the
  // conversation alone had skipped: a fanned-out wake showed rex's card and rex's ghost together
  const ghostAgent = streaming ? null : ghostPick(typists, carded);
  // …and who holds the row before any of that exists (docs/26 §5). On the browser this is the
  // only orb for the first seconds of every message: with no local stream, the working ghost
  // cannot mount until the wake's run row has made a round trip to the runner and back.
  const waitRun = useMemo(() => waitRunFor(runRows.filter((r) => r.thread_id === threadId), rows), [runRows, threadId, rows]);
  const waitGhost = useWaitGhost({ rows, agents, channelId, run: waitRun, carded });
  return { ghostAgent, waitGhost, carded, typists };
}
