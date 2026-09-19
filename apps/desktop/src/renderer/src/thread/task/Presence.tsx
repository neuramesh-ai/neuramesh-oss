// Who is on this task right now, and the ONE gate card that docks above the composer.
//
// docs/25: a working state docks NOTHING, and exactly one contextual gate shows at a time —
// which is why every branch here returns a single node and the beats ticker hides while a gate
// is up. The facts line (`factcap`) names the holder, because "who has the ball" is the question
// a task panel exists to answer. Split out of thread/TaskThread.tsx.
import { useMemo } from 'react';
import { isRunOpen, journeyFor, type RunState, type ShipPlan } from '@neuramesh/shared';
import { TypistChip } from '../parts';
import { ghostPick, workingHere } from '../ghost-rule';
import type { AgentRow, MachineRow } from '../../bridge/rows-crew';
import type { BeatUI, RunUI, TaskRow } from '../../bridge/rows-board';
import type { RunTree } from '../../runs/runs';

export function useTaskPresence(d: {
  task: TaskRow;
  agents: AgentRow[];
  machines: MachineRow[];
  beats: BeatUI[];
  spectrumLegs: ReturnType<typeof journeyFor>;
  runTrees_: RunTree[];
  /** the room's run rows — the rule keys them to this task itself */
  taskRunRows: RunUI[];
  assignee: string | null;
  offered: string | null;
  threadStream: { agent: string; text: string } | null;
  busy: boolean;
  act: (type: string, fb?: string, opts?: { silentThread?: boolean }) => Promise<void>;
  blocking: boolean;
  setBlocking: (v: boolean) => void;
  blockReason: string;
  setBlockReason: (v: string) => void;
  onActivity?: (a: AgentRow) => void;
}) {
  const { task, agents, machines, beats, spectrumLegs, runTrees_, taskRunRows, assignee, offered, threadStream, busy, act, blocking, setBlocking, blockReason, setBlockReason, onActivity } = d;
// The facts caption is the ASSIGNMENT line only (George, 2026-07-30): its old live-leg form
// ("DESIGN · IRIS") restated what the state chip and the phase ring already say a few px to
// the left — the caption earns its ink only for what nothing else carries: who holds it, or
// that nobody does.
const liveLeg = spectrumLegs.find((l) => l.status === 'live') ?? null;
/**
 * Who holds this task, preferring whoever is ACTUALLY WORKING it (George, 2026-08-01).
 *
 * The caption read "unassigned" all the way through `designing` and `planning`, because
 * `assignee_id` tracks the BOARD owner and the designer/architect legs are staffed by routing
 * rather than assignment. So a task with Atlas mid-plan and a live phase ring two inches away
 * announced that nobody had it — the one thing the caption exists to say, said wrong.
 *
 * The spectrum already resolved the answer (`liveLeg.owner`); the caption just wasn't asking.
 * 'you' is skipped: it is the accept leg's owner, and "@you" is not a name.
 */
const workingNow = liveLeg?.owner && liveLeg.owner !== 'you' ? liveLeg.owner : null;
const factHolder = assignee ?? workingNow ?? null;
const factcap =
  task.state === 'backlog' ? 'parked idea' : factHolder ? `@${factHolder}` : offered ? `offered @${offered}` : 'unassigned';

// ONLY this task's work (thread/ghost-rule.ts): the agent streaming into this task's key, and
// every agent with an open run ON this task — the execution's work run, a wake answering in
// its thread, wherever either is served. It used to be "the assignee, if busy", scoped by where
// the LOCAL stream said the assignee was (2026-08-10): a claimed task holds `working` on one
// column for the whole workspace, so an assignee executing #1046 on a teammate's machine wore
// the orb in #1042 too, a task that was already done (George, 2026-09-18). The run row says
// which task; the status never could. (The legs that open no run — design, plan, review, ship —
// narrate through their beats below, as they always have.)
const typists = useMemo(
  () => workingHere({ agents, machines, where: { taskId: task.id }, runs: taskRunRows, stream: threadStream }),
  [agents, machines, task.id, taskRunRows, threadStream],
);
// the live run's active step — the ghost pill carries it (docs/26: one live surface)
const liveBeat = useMemo(() => {
  if (!beats.length) return null;
  const runId = beats[beats.length - 1]!.run_id;
  const run = beats.filter((b) => b.run_id === runId);
  const active = run.find((b) => b.status === 'active');
  if (!active) return null;
  return { title: active.title, done: run.filter((b) => b.status === 'done').length, total: run.length };
}, [beats]);
// …and the RELEASE checklist drives one too (docs/23): while the rollout runs — CI
// wait, a human step, the merge, post-merge verification — the ghost narrates the
// first open item instead of the thread sitting idle
const shipBeat = useMemo(() => {
  if (task.state !== 'releasing' && task.state !== 'verifying') return null;
  let plan: ShipPlan | null = null;
  try { plan = task.ship_plan ? (JSON.parse(task.ship_plan) as ShipPlan) : null; } catch { return null; }
  if (!plan || plan.status !== 'approved') return null;
  const done = plan.items.filter((i) => i.state !== 'pending').length;
  const next = plan.items.find((i) => i.state === 'pending');
  const title = !next
    ? 'wrapping up the release…'
    : next.owner === 'human' ? `waiting on you — ${next.title}`
    : next.auto === 'ci' ? `waiting on ${next.title}`
    : next.title;
  return { title, done, total: plan.items.length };
}, [task.state, task.ship_plan]);
// One live surface per agent, ranked run card › ghost › chip (docs/29 §4's stand-down rule,
// applied twice). An open run card narrates with the most truth, so both the ghost and the
// chip yield to it; the ghost (restored 2026-07-30 for cardless wakes — triage/replies draw
// no card) narrates verbs in the stream, so the chip yields to it too. The chip survives
// only for an agent with neither — e.g. a second typist while the first holds the ghost.
const carded = useMemo(
  () => new Set(runTrees_.filter((t) => isRunOpen(t.run.state as RunState)).map((t) => t.run.agent_id)),
  [runTrees_],
);
const ghostAgentId = useMemo(() => {
  const ga = ghostPick(typists, carded) ?? (liveBeat || shipBeat ? agents.find((a) => a.id === task.assignee_id) ?? null : null);
  return ga && !carded.has(ga.id) ? ga.id : null;
}, [agents, typists, liveBeat, shipBeat, task.assignee_id, carded]);
// the live streamer is shown by the composer's own stream chip, so it is excluded here too
const shownTypists = typists.filter((a) => !carded.has(a.id) && a.id !== ghostAgentId && a.name !== threadStream?.agent);
const typistsBar = shownTypists.length ? (
  <div className="typingbar" style={{ padding: '6px 12px 0' }}>
    {shownTypists.map((a) => (
      <TypistChip key={a.id} name={a.name} label={a.status === 'thinking' ? 'typing' : a.status} onOpen={() => onActivity?.(a)} />
    ))}
    <span className="tdots"><i /><i /><i /></span>
  </div>
) : null;
const blockingInput = blocking && task.state === 'in_progress' ? (
  <div className="tbounce">
    <input
      value={blockReason}
      onChange={(e) => setBlockReason(e.target.value)}
      placeholder="why is this blocked? (it can then be closed)"
      autoFocus
      onKeyDown={(e) => e.key === 'Enter' && blockReason.trim() && void act('task.block', blockReason.trim()).then(() => setBlocking(false))}
    />
    <button className="btn" disabled={busy || !blockReason.trim()} onClick={() => void act('task.block', blockReason.trim()).then(() => setBlocking(false))}>
      Block
    </button>
  </div>
) : null;
  return { liveLeg, factHolder, factcap, liveBeat, shipBeat, ghostAgentId, typists, typistsBar, blockingInput };
}
