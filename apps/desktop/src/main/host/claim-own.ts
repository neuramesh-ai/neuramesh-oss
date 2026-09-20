// The orchestrator taking a task itself, and the remote A2A delegate — the two ways a task gets
// an owner that is not a channel worker claiming it. Split out of host/claimflow.ts.
import { resolveToken } from '../agents';
import { starterFallback, unavailableOf, whyUnavailable } from './starterfallback';
import type { ExecTask, HostedAgent, OfferedTask, SkillRef } from '../agents';
import { TURN_BUDGETS, type ClaimVerdict } from '@neuramesh/shared';
import { a2aArtifactsToSubmit, a2aSend } from './a2a';
import { assemble, assemblyLine, contextBudget, transcriptBlock } from '../harness/assemble';
import { type SubjectRef } from '../harness/brain';
import { isStandDown } from '../replypolicy';
import { type LogFn } from '../agentlog';
import { withTimeout } from './turnkit';
import { STATIC_CHECKLIST } from './flows';
import type { AdmitTask, OwnedTask } from './claimflow';
import type { HostCtx } from './ctx';
import type { PowerSyncDatabase } from '@powersync/node';
import type { Brain } from '../harness/brain';
import type { AgentAttachment } from '../runtime/adapter';
import type { HostQueue } from '../harness/hostqueue';
import type { ParkBook } from '../harness/park';
import type { WhiteboardToolClosures } from '../harness/toolbus';
import type { makeRuns, RunHandle } from './runs';
import type { makeBeats } from './beats';
import type { makePark } from './park';

export function makeClaimOwn(ctx: HostCtx & {
  db: PowerSyncDatabase;
  apiUrl: string;
  workspace: string;
  ownerActorId: string;
  agents: Map<string, HostedAgent>;
  brain: Brain;
  parkBook: ParkBook;
  execQueue: HostQueue;
  /** the claim registry — `delete` also re-arms the queue slot, which is why it is not a bare Set */
  claimed: { has: (id: string) => boolean; add: (id: string) => unknown; delete: (id: string) => boolean };
  // ── services other makers already built: their types are INFERRED, never restated ──────────
  NO_RUN: ReturnType<typeof makeRuns>['NO_RUN'];
  openRun: ReturnType<typeof makeRuns>['openRun'];
  narrate: ReturnType<typeof makeRuns>['narrate'];
  declareBeats: ReturnType<typeof makeBeats>['declareBeats'];
  advanceBeat: ReturnType<typeof makeBeats>['advanceBeat'];
  beatCursor: ReturnType<typeof makeBeats>['beatCursor'];
  parkFor: ReturnType<typeof makePark>['parkFor'];
  // ── the host's own helpers ────────────────────────────────────────────────────────────────
  alog: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null, runId?: string | null) => LogFn;
  arun: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null) => { log: LogFn; runId: string };
  brainNotes: (subject: SubjectRef, cap?: number, perNote?: number) => string;
  brainNotesFor: (task: ExecTask, cap?: number, perNote?: number) => string;
  brainResults: (subject: SubjectRef, cap?: number, per?: number) => string;
  channelLessons: (workspaceId: string, channelId: string) => Promise<string>;
  claimVerdict: (runtime: string, model: string | null, originUserId: string | null, elapsedMs: number, extra?: { agentId?: string; priorMachineId?: string | null }) => Promise<ClaimVerdict>;
  discoverSkills: (channelId: string, workspaceId: string) => Promise<SkillRef[]>;
  handleExhaustion: (agent: HostedAgent, t: ExecTask | null, ch: { id: string; slug: string; workspace_id: string }) => Promise<void>;
  legSummary: (out: string) => string;
  mineLessons: (reviewer: HostedAgent, t: { id: string; number: number; title: string }, ch: { id: string; slug: string; workspace_id: string }, token: string, live: boolean, log?: LogFn) => Promise<void>;
  orchestratorTurn: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, transcript: string, token: string, thread?: { id: string; number: number; title: string; state: string }, log?: LogFn, skills?: SkillRef[], attachments?: AgentAttachment[], convoThreadId?: string | null, run?: RunHandle, onDelta?: (t: string) => void) => Promise<string>;
  originOf: (t: OfferedTask) => string | null;
  priorMachineFor: (threadId?: string | null, taskId?: string | null) => Promise<string | null>;
  readOnlyStudy: (agent: HostedAgent, dir: string, token: string, log?: LogFn) => ((system: string, user: string) => Promise<string>) | null;
  seatFor: (agent: HostedAgent, channelId: string, scope?: { threadId?: string | null; taskId?: string | null }) => Promise<HostedAgent>;
  setStatus: (agent: HostedAgent, status: 'online' | 'thinking' | 'working') => void;
  sinceFirstSeen: (key: string) => number;
  spawnLegFor: (parent: HostedAgent, where: { workspace: string; channelId: string; taskId?: string | null; threadId?: string | null }, dir: string, task: ExecTask, budget: { wallMs: number; contextTokens: number }, log: LogFn | undefined, _depth: number) => (i: { role: string; prompt: string; label?: string }) => Promise<{ ok: boolean; summary?: string; error?: string }>;
  taskRecallNote: (workspaceId: string, query: string, lessonsNote: string) => Promise<string>;
  whiteboardClosures: (actor: { kind: string; id: string; role?: string }, ch: { id: string; workspace_id: string }, at: { taskId?: string; threadId?: string }) => WhiteboardToolClosures;
}, wiring: {
  /** the ladder before any claim (host/claimflow.ts admitUnit): one for the worker's claim and the owner's alike */
  admitUnit: <T extends AdmitTask>(agent: HostedAgent, t: T, kind: 'work' | 'own', again: (seat: HostedAgent, t: T) => Promise<void>) => Promise<boolean>;
}) {
const { admitUnit } = wiring;
const { db, apiUrl, workspace, ownerActorId, post, claimed,
        NO_RUN, openRun, 
        arun, brainNotes, brainResults, discoverSkills,
        legSummary, orchestratorTurn } = ctx;
// The guard registry's fields keep their short names, exactly as they read inside startAgentHost.
const { 
 } = ctx.guards;

async function ownFlow(orch: HostedAgent, t: OwnedTask): Promise<void> {
  orch = await ctx.seatFor(orch, t.channel_id, { taskId: t.id }); // per-project + per-thread brains (docs/10)
  const actor = { kind: 'agent', id: orch.id, role: 'orchestrator' };
  const ch = await db.get<{ id: string; slug: string; workspace_id: string }>(
    'select id, slug, workspace_id from channels where id = ?', [t.channel_id],
  ).catch(() => null);
  if (!ch) { claimed.delete(t.id); return; }
  const { log, runId: logRunId } = arun(orch, t, ch.slug);
  let run: RunHandle = NO_RUN;
  // the phase this turn started in — the catch compares against it before calling itself a
  // failure, because a turn can run out of wall clock having already done its job.
  let startState: string | null = null;
  try {
    // This flow is entered TWICE over a task's life: on the offer (take it), and again every time
    // an owned task returns to in_progress — a reviewer's changes, or a host that died mid-turn.
    // Only the first is a claim; claiming a task it already holds would fail and abort the rework.
    const held = await db.get<{ state: string; assignee_id: string | null }>(
      'select state, assignee_id from tasks where id = ?', [t.id],
    ).catch(() => null);
    startState = held?.state ?? null;
    const alreadyMine = held?.state === 'in_progress' && held.assignee_id === orch.id;
    if (!alreadyMine) {
      // THE LADDER (2026-09-19): an owned unit used to race the claim with no placement at all, so
      // every host that served rex raced, and the runner, when it won, blocked the unit for want
      // of a credential. The same admission as the worker's claim: the seat, the unit's birth
      // (a cloud-born conversation's unit claims on the cloud, rung 0), the sleeper rung, the door.
      if (!(await admitUnit(orch, t, 'own', ownFlow))) return;
      const res = await post('/v1/commands', actor, { type: 'task.claim', taskId: t.id });
      if (!res.ok) throw new Error(`claim ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 200));
      log({ kind: 'lifecycle', phase: 'claimed', summary: `took ownership of #${t.number} "${t.title}"` });
    } else {
      log({ kind: 'lifecycle', phase: 'resumed', summary: `picking #${t.number} back up — continuing from the notes` });
    }

    let cred = await resolveToken(apiUrl, ch.workspace_id, orch, ownerActorId);
    // the seat cannot run → the Starter door (host/starterfallback.ts), the ONE door every flow
    // walks through: a routine's unit and any unit on a cloud machine re-seat on the NeuraMesh
    // brain and say so; a human's unit on a laptop gets the reason and the card, and blocks until
    // they act. Before this the owning turn posted its own block, "no usable credential", and a
    // cloud machine that owned a unit could never run it.
    const gap = unavailableOf(cred, orch.runtime);
    if (gap) {
      const next = await starterFallback(orch, gap, { workspace: ch.workspace_id, channelId: ch.id, taskId: t.id, taskNumber: t.number }, log);
      if (!next) {
        await post('/v1/commands', actor, { type: 'task.block', taskId: t.id, reason: `@${orch.name} cannot run here. ${whyUnavailable(gap, orch.runtime)} Sign in again, or switch this conversation to the NeuraMesh brain, then unblock #${t.number}.` }).catch(() => {});
        return;
      }
      orch = next; cred = await resolveToken(apiUrl, ch.workspace_id, orch, ownerActorId);
    }
    run = await openRun(orch, { workspace: ch.workspace_id, channelId: ch.id, taskId: t.id }, {
      // "Owning #N — …", never the bare task title: this row is the owner's TURN, and a
      // task-titled row wearing DONE reads as the TASK being done while the header says
      // designing (founder screenshot, #1055).
      kind: 'work', title: `Owning #${t.number} — ${t.title}`, step: 'taking stock', id: logRunId,
    });
    const skills = await discoverSkills(ch.id, ch.workspace_id);
    const transcript = await owningContext(orch, t, ch, log);
    const reply = await withTimeout(
      orchestratorTurn(
        orch, ch, transcript, cred.token ?? '',
        { id: t.id, number: t.number, title: t.title, state: 'in_progress' },
        log, skills, [], null, run,
      ),
      TURN_BUDGETS.own.wallMs,
      `the owning turn on #${t.number} timed out`,
    );
    if (reply && !isStandDown(reply)) {
      await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: reply }).catch(() => {});
    }
    await run.settle('done', legSummary(reply || 'phase advanced'));
    console.log(`agent_own agent=${orch.name} task=${t.number} ok`);
  } catch (err) {
    claimed.delete(t.id);
    const why = err instanceof Error ? err.message.slice(0, 200) : 'the owning turn failed';
    // Did the WORK fail, or only the turn? The wall-clock budget fires on the turn, and a turn
    // can spend its last minutes having already moved the task. The live run did exactly that:
    // it proposed the design round, announced it, then timed out and posted "I couldn't advance
    // #1020" underneath its own success. The board is the arbiter, not the exception.
    const after = await db.get<{ state: string }>('select state from tasks where id = ?', [t.id]).catch(() => null);
    const advanced = !!after && !!startState && after.state !== startState;
    if (advanced) {
      // Say what actually ended the turn. The first version hardcoded "ran out of time" — true
      // of the incident that birthed this path, and a lie for every other error after it (a
      // founder-observed run died at 2:20 of a 25-minute budget wearing that message).
      const ended = /timed out/i.test(why) ? 'the turn hit its time budget afterwards' : `the turn then ended early: ${why}`;
      await run.settle('done', `phase advanced to ${after!.state} — ${ended}`);
      log({ kind: 'result', phase: 'done', summary: `owning #${t.number}: reached ${after!.state} before the turn ended (${why})` });
      console.log(`agent_own agent=${orch.name} task=${t.number} advanced=${after!.state} then=${why}`);
      return;   // nothing is stuck and nothing needs saying — the gate card speaks for itself
    }
    await run.settle('failed', why);
    log({ kind: 'result', phase: 'error', summary: `owning #${t.number} failed: ${why}`, level: 'error' });
    console.error(`agent_own agent=${orch.name} task=${t.number} failed:`, err);
    // an owner that dies silently leaves a task in_progress with nobody on it — say so
    await post('/v1/messages', actor, {
      workspace: ch.workspace_id, channel: ch.id, taskId: t.id,
      body: `⚠️ I couldn't advance #${t.number} — ${why}. The task stays with me; ask me to pick it up again and I'll continue from where the notes leave off.`,
    }).catch(() => {});
  }
}

/**
 * What a re-woken owner needs to continue rather than restart.
 *
 * This is the payoff of the per-subject brain (docs/harness/01 §2.2) at the flow level. A gate
 * resolution wakes rex hours or days after the phase it is continuing, with none of the working
 * memory that produced it — so the context is rebuilt from what its own subagents FILED: the notes
 * they wrote and the result envelopes they returned. Without this, "rex owns the flow" would mean
 * rex re-commissioning the fan-out it already paid for, every single gate.
 */
async function owningContext(
  orch: HostedAgent,
  t: OwnedTask,
  ch: { id: string; slug: string; workspace_id: string },
  log?: LogFn,
): Promise<string> {
  const subject: SubjectRef = { kind: 'task', number: t.number };
  const full = await db.get<{ state: string; description: string | null; definition_of_done: string | null; kind: string | null }>(
    'select state, description, definition_of_done, kind from tasks where id = ?', [t.id],
  ).catch(() => null);
  const rows = await db.getAll<{ author_kind: string; author_id: string; body: string }>(
    `select author_kind, author_id, body from messages where task_id = ? order by created_at desc limit 20`, [t.id],
  ).catch(() => [] as Array<{ author_kind: string; author_id: string; body: string }>);
  let reqs: string[] = [];
  try { reqs = JSON.parse(t.requirements ?? '[]') as string[]; } catch { /* unparsed requirements are simply absent */ }

  const ctx = assemble([
    { source: 'facts', text:
      `[you OWN task #${t.number}: ${t.title}]\n` +
      `state: ${full?.state ?? 'in_progress'}${full?.kind ? ` · kind: ${full.kind}` : ''}\n` +
      `${full?.description ? `description: ${full.description}\n` : ''}` +
      `${reqs.length ? `resolved requirements:\n${reqs.map((r) => `- ${r}`).join('\n')}\n` : ''}` },
    { source: 'dod', text: full?.definition_of_done ? `[definition of done]\n${full.definition_of_done}` : '' },
    { source: 'notes', text: brainNotes(subject) },
    { source: 'results', text: brainResults(subject) },
    transcriptBlock(rows.reverse(), { selfId: orch.id }),
  ], contextBudget('own'));
  log?.({ kind: 'turn', phase: 'inject', summary: assemblyLine(ctx) });
  return ctx.text;
}

// Delegate a task to a REMOTE (external A2A) agent. The host claims on its
// behalf (the atomic claim de-dupes across hosts), sends the task over A2A
// JSON-RPC, ingests the returned artifacts, and submits for review — the same
// board FSM as a local agent, just executed over the wire. Only the task text +
// requirements leave the machine (no worktree exists for a remote agent → no
// code/secrets can leak); owner-registration was the grant.
async function remoteDelegate(remote: { id: string; name: string; role: string; endpoint_url: string }, t: OfferedTask & { description?: string | null }) {
  const actor = { kind: 'agent', id: remote.id, role: remote.role };
  const proxy: HostedAgent = { id: remote.id, name: remote.name, model: 'external', role: remote.role, runtime: 'a2a', channels: new Set() };
  try {
    const claim = await post('/v1/commands', actor, { type: 'task.claim', taskId: t.id });
    if (claim.status === 409) return; // another host is already delegating it
    if (!claim.ok) throw new Error(`remote claim ${claim.status}`);
    const ch = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [t.channel_id]);
    const { log } = arun(proxy, t, ch.slug);
    const preConfirmed = Number(t.requirements_confirmed) === 1;
    let checklist: string[] = [];
    try { checklist = preConfirmed ? (JSON.parse(t.requirements ?? '[]') as string[]) : []; } catch { checklist = []; }
    if (!checklist.length) checklist = STATIC_CHECKLIST;
    if (!preConfirmed) await post('/v1/commands', actor, { type: 'task.confirm_requirements', taskId: t.id, checklist });
    await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: `Delegating #${t.number} to external agent **@${remote.name}** over A2A — sending the task + requirements (no code or secrets).` });
    log({ kind: 'lifecycle', phase: 'claimed', summary: `delegating #${t.number} to remote @${remote.name} over A2A (${remote.endpoint_url})` });
    const prompt = `Task #${t.number}: ${t.title}\n\nRequirements (every check must be satisfied):\n${checklist.map((c) => `- ${c}`).join('\n')}\n\n${t.description ?? ''}\n\nProduce the deliverable as A2A artifacts.`;
    const result = await a2aSend(remote.endpoint_url, prompt, `task:${t.number}`);
    if (result.status?.state === 'failed' || result.status?.state === 'rejected') {
      const why = (result.status?.message?.parts ?? []).filter((p) => p.kind === 'text').map((p) => p.text).join(' ') || result.status?.state;
      throw new Error(`remote agent ${result.status?.state}: ${String(why).slice(0, 160)}`);
    }
    const artifacts = a2aArtifactsToSubmit(result);
    const submit = await post('/v1/commands', actor, { type: 'task.submit', taskId: t.id, artifacts });
    if (!submit.ok) throw new Error(`remote submit ${submit.status}: ${await submit.text()}`);
    log({ kind: 'result', phase: 'success', summary: `external @${remote.name} returned ${artifacts.length} artifact(s) → submitted for review` });
    await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: `Submitted #${t.number} — **@${remote.name}** (external A2A) returned ${artifacts.length} artifact(s). Auto-review next.` });
  } catch (err) {
    claimed.delete(t.id);
    const msg = err instanceof Error ? err.message.slice(0, 180) : 'delegation failed';
    console.error(`remote_delegate agent=${remote.name} task=${t.number} failed:`, err);
    await post('/v1/commands', actor, { type: 'task.block', taskId: t.id, reason: `external A2A delegation failed: ${msg}` }).catch((e) => console.error(`task_block #${t.number} failed:`, e));
  }
}

  return { ownFlow, owningContext, remoteDelegate };
}
