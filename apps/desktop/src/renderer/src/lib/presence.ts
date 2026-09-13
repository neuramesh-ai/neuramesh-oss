// Agent presence/focus derivations — extracted from App.tsx (track A1). Derived, never
// stored: the machine heartbeat is liveness ground truth; AGENT_BUSY is the ONE busy set.
import type { AgentRow, MachineRow } from '../bridge/rows-crew';
import type { TaskRow, RunUI } from '../bridge/rows-board';

export const isOnline = (lastSeen: string | null) => !!lastSeen && Date.now() - new Date(lastSeen).getTime() < 90_000;
// agent presence is derived, not stored: status rows go stale when a host
// dies mid-session — the machine heartbeat is the liveness ground truth
export const agentLive = (a: AgentRow, machines: MachineRow[]) =>
  !!a.machine_id && machines.some((m) => m.id === a.machine_id && isOnline(m.last_seen_at));
// mid-task, by the agent's own synced status. The ONE definition — the rail's working-first
// sort, the ping ring, and the overlay's status line all read it, so "busy" can't mean three
// different things in three places.
export const AGENT_BUSY = new Set(['working', 'review', 'thinking']);
export const agentBusy = (a: AgentRow) => AGENT_BUSY.has(a.status);
// an agent's current focus line — its in-flight assigned task, else its live status.
// derived (not stored); reused by the unified nav's Agents section (was LiveRail.focusOf).
// Runs (docs/29) come FIRST: an open run is the most specific true thing we know about an
// agent, and it's the clause that stops the rail from reporting "standing by" while the thread
// shows the same agent mid-fan-out. Cross-machine, because a run is a synced row.
export const agentFocus = (a: AgentRow, tasks: TaskRow[], runs: RunUI[] = []): string => {
  const run = runs.find((r) => r.agent_id === a.id && r.state === 'running' && !r.parent_run_id && (r.kind !== 'wake' || r.total > 0));
  // the run's TITLE, not its step: this row is ~180px of roster, and a truncated leg name
  // ("productivity & focus sc…") says less than the work's own name. The live step belongs
  // where there's room for it — the card and the dock.
  if (run) return run.total > 0 ? `${run.title} · ${run.done}/${run.total}` : run.title;
  // No run of its own, but a machine is hosting it right now (0114) — under shared compute that
  // is a teammate's laptop serving this workspace, and it is the difference between "idle" and
  // "busy somewhere you cannot see". Reported rather than flattened to "standing by".
  if (a.hosted_on) return `working on ${a.hosted_on}`;
  const t = tasks.find((x) => x.assignee_id === a.id && (x.state === 'in_progress' || x.state === 'in_review'));
  if (t) return `${t.state === 'in_review' ? 'review' : 'working'} #${t.number}`;
  if (a.status === 'idle' || a.status === 'online') return 'standing by';
  return a.status;
};
