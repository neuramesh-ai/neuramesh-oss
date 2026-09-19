// WHO IS WORKING ON THIS SURFACE — the rule, with no React in it.
//
// Kept apart from `convo-presence.ts` and `task/Presence.tsx` for the reason `waitghost-rule.ts`
// is kept apart from its component: those hooks reach `useWaitGhost` → `useCompute` → `bridge/nm`,
// which reads `window` at module scope, so a node test that imported them died before running an
// assertion. The decision is the part worth testing, and it needs none of that.
//
// Two rungs, and the second is the one this file was written for (2026-09-18):
//
//   1. THE LOCAL STREAM. The daemon that runs the wake opens a stream keyed to the surface the
//      reply will land in, as presence, before the first token (host/wake.ts). It is the most
//      precise signal there is — and the only one for a runtime whose run row never lands.
//   2. THE SYNCED RUN. Both wake paths open a `runs` row before they do any work, and so does a
//      task's execution (docs/29: the run is the ghost's synced twin). The row carries the surface
//      it belongs to, so this is the attribution for work served by ANOTHER machine — a cloud box,
//      a teammate's laptop — which emits no stream here at all.
//
// What is deliberately NOT a rung: the agent's synced status. `agents.status` is one column per
// agent, so `thinking` is true in every room and every thread at once. The old fallbacks read it —
// a conversation asked "is an agent in this room thinking", a task asked "is my assignee busy" —
// scoped only by which surface the LOCAL stream said the agent was in, and a wake on another
// machine never fills that map. One cloud wake lit the orb in every open conversation, and an
// assignee working elsewhere lit it in a task that was already done (George, live, both). Status
// survives here as a gate, not a claim: an open row on an agent that has gone quiet is an
// unsettled run, and an unsettled run must not be an eternal orb.
import { agentBusy, agentLive, isOnline } from '../lib/presence';
import { isRunOpen, type RunState } from '@neuramesh/shared';
import { runAt, type RunWhere } from '../runs/runs';
import type { AgentRow } from '../bridge/rows-crew';

/** the run fields the rule reads — a `RunUI` satisfies it */
export interface GhostRun { thread_id: string | null; task_id: string | null; agent_id: string; state: string; started_at: string; machine_id?: string | null }
/** the machine fields the rule reads — a `MachineRow` satisfies it */
export interface GhostMachine { id: string; last_seen_at: string | null }
/** the agent fields the rule reads — an `AgentRow` satisfies it */
export type GhostAgent = Pick<AgentRow, 'id' | 'name' | 'status' | 'machine_id'>;

/**
 * The agents working on THIS surface, most recent first: the local streamer leads, then each agent
 * with an open run here, newest run first, each named once. Empty when nothing is under way here —
 * and a busy agent with no run on this surface is exactly that, however busy it is elsewhere.
 *
 * `stream` is the caller's subscription on `${channel}:${thread|task}`, so an entry already means
 * this surface; `runs` may be the whole room's, the rule keys them by `where` itself (`runAt`, the
 * same predicate that builds the run cards).
 */
export function workingHere<A extends GhostAgent>(input: {
  agents: A[]; machines: GhostMachine[]; where: RunWhere; runs: GhostRun[]; stream: { agent: string } | null;
}): A[] {
  const { agents, machines, where, runs, stream } = input;
  const out: A[] = [];
  if (stream) {
    const a = agents.find((x) => x.name === stream.agent);
    if (a) out.push(a);
  }
  const here = runAt(where);
  const open = runs
    .filter((r) => here(r) && isRunOpen(r.state as RunState))
    .sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0));
  for (const r of open) {
    const a = agents.find((x) => x.id === r.agent_id);
    if (!a || out.some((x) => x.id === a.id) || !agentBusy(a)) continue;
    // Liveness is the machine SERVING the run. `agents.machine_id` is provenance only since 0114 —
    // where the agent was registered, not where it runs — so gating on it asked the wrong box: a
    // cloud wake passed as long as the laptop that registered rex was awake. Rows from before the
    // column keep the old gate, which is the best that can be said of them.
    const live = r.machine_id ? machines.some((m) => m.id === r.machine_id && isOnline(m.last_seen_at)) : agentLive(a, machines);
    if (live) out.push(a);
  }
  return out;
}

/**
 * Whose ghost, given who is working here and whose own run card is already on screen.
 *
 * One live surface per agent, ranked run card › ghost › chip (docs/29 §4). The card narrates with
 * the most truth, so the ghost stands down for an agent the card already names — and speaks for
 * the next one working here instead of nobody. The conversation used to skip this step: a fanned-
 * out wake put rex's card and rex's ghost in the same thread, one above the other.
 */
export function ghostPick<A extends { id: string }>(working: A[], carded: Set<string>): A | null {
  return working.find((a) => !carded.has(a.id)) ?? null;
}
