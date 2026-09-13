// Runs (docs/29) — extracted from agents.ts (track B2).
//
// A run is synced work that OUTLIVES the wake that started it: it survives the reply,
// renders on every machine, and nests a leg per fanned-out strand. openRun is where one is
// born; narrate rations an agent's activity stream down to the run's synced `step` line —
// a tool burst would otherwise be a write storm.
import { makeNarrator } from '../runs';
import type { LogFn } from '../agentlog';
import type { HostedAgent } from '../agents';
import type { HostCtx } from './ctx';

// ── Runs (docs/29): the durable, synced row behind a stretch of agent work ──────────────
// The ghost (docs/26) narrates a wake beautifully and dies with it, on one machine. A run is
// the same story written down: it opens when work starts, steps as it goes, and settles —
// so a second desktop, the phone, and the human who scrolls back all see the same thing.
//
// Every write is fire-and-forget-with-a-catch: a run is DESCRIPTIVE, so a failed status write
// must never take down the work it was describing.
export type RunTerminal = 'done' | 'failed' | 'stopped';
export interface RunHandle {
  id: string;
  /** true only for LEASE_LOST — another member's machine is answering this wake (0114) */
  lost?: boolean;
  step: (step: string, done?: number) => Promise<void>;
  settle: (state: RunTerminal, summary?: string) => Promise<void>;
}

export function makeRuns({ post, machineId }: HostCtx) {
const NO_RUN: RunHandle = { id: '', step: async () => {}, settle: async () => {} };
/** Another member's machine holds the wake lease — this host must generate NOTHING. Distinct
 *  from NO_RUN, which means "runs are unavailable, carry on as before runs existed". */
const LEASE_LOST: RunHandle = { id: '', lost: true, step: async () => {}, settle: async () => {} };

async function openRun(
  agent: HostedAgent,
  where: { workspace: string; channelId: string; threadId?: string | null; taskId?: string | null },
  spec: { kind: 'wake' | 'work' | 'leg'; title: string; total?: number; step?: string; parentRunId?: string; seat?: string; id?: string; triggerMessageId?: string | null },
): Promise<RunHandle> {
  // `id` lets a caller give the synced run the SAME identity as its local activity log. They were
  // two independent UUIDs, so the thread could not ask "what did this run do": agentLogs({runId})
  // matched nothing and the card read "no tool calls recorded yet" while the activity panel — which
  // queries by AGENT, not by run — showed sixteen steps of the same work.
  const id = spec.id ?? crypto.randomUUID(); // minted here so legs can reference the parent before the round trip
  const actor = { kind: 'agent', id: agent.id, role: agent.role };
  const res = await post('/v1/commands', actor, {
    type: 'run.open', id, workspace: where.workspace, channel: where.channelId,
    ...(where.threadId ? { threadId: where.threadId } : {}),
    ...(where.taskId ? { runTaskId: where.taskId } : {}),
    ...(spec.parentRunId ? { parentRunId: spec.parentRunId } : {}),
    kind: spec.kind, title: spec.title.slice(0, 200), total: spec.total ?? 0,
    ...(spec.step ? { step: spec.step.slice(0, 200) } : {}),
    ...(spec.seat ? { seat: spec.seat.slice(0, 160) } : {}),
    // Shared compute (0114): with a trigger, opening the run IS the wake lease. It is the
    // cheapest possible claim — one insert, before a single token is spent — and it is what
    // stops every member machine hosting this agent from answering the same message.
    ...(spec.triggerMessageId ? { triggerMessageId: spec.triggerMessageId, machineId } : { machineId }),
  }).catch(() => null);
  if (!res?.ok) return NO_RUN; // no row → the wake proceeds exactly as it did before runs existed
  // We asked for a lease and did not get it: another member's machine is already answering.
  // Stand down BEFORE generating — the whole point of moving the race in front of the spend.
  if (spec.triggerMessageId) {
    const body = await res.json().catch(() => null) as { won?: boolean; runId?: string } | null;
    if (body && body.won === false) {
      console.log(`wake_lease_lost agent=${agent.name} trigger=${spec.triggerMessageId.slice(0, 8)} held_by_run=${body.runId?.slice(0, 8) ?? '?'}`);
      return LEASE_LOST;
    }
  }
  let settled = false;
  return {
    id,
    step: async (step: string, done?: number) => {
      if (settled) return;
      await post('/v1/commands', actor, { type: 'run.step', runId: id, step: step.slice(0, 200), ...(done !== undefined ? { done } : {}) }).catch(() => {});
    },
    settle: async (state, summary) => {
      if (settled) return; // the `finally` and an explicit settle both fire on the happy path
      settled = true;
      await post('/v1/commands', actor, { type: 'run.settle', runId: id, state, ...(summary ? { summary: summary.slice(0, 600) } : {}) }).catch(() => {});
    },
  };
}

// A LogFn that also narrates the run: the activity stream the ghost reads, rationed down to
// a synced `step` line (see runs.ts — a tool burst would otherwise be a write storm).
function narrate(run: RunHandle, log: LogFn): LogFn {
  if (!run.id) return log;
  const narrator = makeNarrator();
  return (rec) => {
    log(rec);
    const verb = narrator.next({ kind: rec.kind, phase: rec.phase ?? null, summary: rec.summary }, Date.now());
    if (verb) void run.step(verb);
  };
}

  return { NO_RUN, LEASE_LOST, openRun, narrate };
}
