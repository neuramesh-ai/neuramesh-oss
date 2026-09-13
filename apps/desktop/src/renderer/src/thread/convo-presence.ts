// WHO IS LIVE IN THIS CONVERSATION — the four answers, derived once.
//
// The conversation's twin of `useTaskPresence` (thread/task/Presence.tsx), and extracted for the
// same reason: these four derivations are one question asked in one place, and the surface below
// them only renders. The wait ghost is what forced it — ConvoThread crossed the size ratchet, and
// the ratchet is shrink-only on purpose (scripts/lint-ratchet.mjs): a file that grows extracts.
//
// They are answers to ONE question, so they must not be computed in two places. The typist chip
// selects on the same "thinking in this room" predicate as the ghosts, so `spokenFor` and the
// ghosts have to agree, or the same agent narrates itself twice under two labels.
import { agentInChannel, isRunOpen, type RunState } from '@neuramesh/shared';
import { agentLive } from '../lib/presence';
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
  streamOwners: Map<string, string>;
}): ConvoPresence {
  const { rows, agents, machines, channelId, threadId, runRows, trees, stream, streaming, streamOwners } = d;
  // the ghost fills the reply slot while an agent works here and no text flows yet. The
  // STREAM names it (daemon attribution — precise even for an agent busy elsewhere too);
  // the room's thinking set is the fallback for runtimes that emit no deltas.
  const ghostAgent = useMemo(() => {
    if (streaming) return null;
    if (stream) return agents.find((a) => a.name === stream.agent) ?? null;
    // …and the room-wide fallback stands down for an agent streaming into ANOTHER thread: the
    // task peek can put two of this room's threads on screen at once, and a channel-scoped
    // guess would narrate the task's work in the conversation beside it (George, live).
    return agents.find((a) => a.status === 'thinking' && agentLive(a, machines) && agentInChannel(a.channel_ids, channelId)
      && (streamOwners.get(a.name) ?? `${channelId}:${threadId}`) === `${channelId}:${threadId}`) ?? null;
  }, [agents, machines, channelId, threadId, stream, streaming, streamOwners]);
  const carded = useMemo(() => new Set(trees.filter((t) => isRunOpen(t.run.state as RunState)).map((t) => t.run.agent_id)), [trees]);
  // …and who holds the row before any of that exists (docs/26 §5). On the browser this is the
  // only orb for the first seconds of every message: with no local stream, the working ghost
  // cannot mount until `thinking` has made a round trip to the runner and back.
  const waitRun = useMemo(() => waitRunFor(runRows.filter((r) => r.thread_id === threadId), rows), [runRows, threadId, rows]);
  const waitGhost = useWaitGhost({ rows, agents, channelId, run: waitRun, carded });
  return { ghostAgent, waitGhost, carded };
}
