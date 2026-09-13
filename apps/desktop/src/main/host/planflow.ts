// THE PLAN FLOW — the architect drafting an implementation plan, and the orchestrator relaying
// the human's verdict on it. Split out of host/flows.ts.
import { notifyDesktop, resolveToken, runtimeFor } from '../agents';
import type { ExecTask, HostedAgent, OfferedTask, SkillRef, PlanTask } from '../agents';


import { type ClaimVerdict } from '@neuramesh/shared';





import { type SubjectRef } from '../harness/brain';












import { type LogFn } from '../agentlog';


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
import { makeArchitect } from './architect';




export function makePlanFlow(ctx: HostCtx & {
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
}) {
const { db, apiUrl, workspace, ownerActorId, post, 
        
        arun, 
        
        setStatus } = ctx;
// The guard registry's fields keep their short names, exactly as they read inside startAgentHost.
const { approvedOffered, decided, 
        planOfferRetries } = ctx.guards;

  // Split-out neighbours: same ctx, so every call below keeps the name it always used.
  const { architectFlow } = makeArchitect(ctx);

// tag the workspace's human owner so an approval ask pings them by name
async function ownerHandle(workspaceId: string): Promise<string | null> {
  const m = await db.get<{ display_name: string | null }>(
    `select display_name from workspace_members where workspace_id = ? and role = 'owner' limit 1`, [workspaceId],
  ).catch(() => null);
  const n = m?.display_name?.trim();
  return n ? `@${n}` : null;
}

// The orchestrator REVIEWS the architect's proposed plan and decides: auto-accept
// + assign when it clearly + fully satisfies the requirements, OR route to the
// human for explicit approval (default-safe — and what real, assumption-bearing
// plans get). Echo stays deterministic for the gate: a "[review]" task holds for
// the human, anything else auto-accepts.
async function orchPlanDecision(orch: HostedAgent, t: PlanTask) {
  const actor = { kind: 'agent', id: orch.id, role: 'orchestrator' };
  const ch = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [t.channel_id]).catch(() => null);
  if (!ch) { decided.delete(t.id); return; }
  const { log: olog } = arun(orch, { id: t.id, number: t.number, channel_id: t.channel_id }, ch.slug);
  const say = (body: string) => post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body });
  try {
    // point at the latest plan version (a revise may have produced v2+)
    const lp = await db.get<{ name: string; inline_content: string | null }>(
      `select name, inline_content from artifacts where task_id = ? and name like 'implementation-plan%' order by created_at desc limit 1`, [t.id],
    );
    const planName = lp?.name ?? 'implementation-plan.md';
    const planBody = lp?.inline_content ?? '';
    let checklist: string[] = [];
    try { checklist = JSON.parse(t.requirements ?? '[]') as string[]; } catch { /* none */ }

    const cred = await resolveToken(apiUrl, ch.workspace_id, orch, ownerActorId);
    const token = cred.token ?? ''; // apikey → the key; subscription → '' (providerEnv strips keys)
    const live = process.env['NM_AGENT_MODE'] !== 'echo' && cred.authMode !== 'none';

    let decision: 'accept' | 'human' = 'human';
    let reason = '';
    let summary = '';
    if (live && planBody) {
      setStatus(orch, 'thinking');
      olog({ kind: 'turn', phase: 'review', summary: `reviewing the architect's plan for #${t.number}` });
      try {
        const raw = await runtimeFor(orch.runtime).complete(
          'You are the orchestrator reviewing an implementation plan the architect proposed, against the resolved requirements. Decide if it can proceed to implementation automatically, or needs the human owner\'s explicit approval first. Auto-approve ONLY when the plan clearly and fully satisfies every requirement with no material open assumptions, unanswered questions, scope ambiguity, or risky/irreversible/security-sensitive choices — otherwise require human approval. Output ONLY one JSON object, no prose: {"decision":"accept"|"human","reason":"one short sentence","summary":"one-line summary of what the plan does"}.',
          `Resolved requirements / checklist:\n${checklist.map((c) => `- ${c}`).join('\n') || '(none recorded)'}\n\nProposed plan (${planName}):\n${planBody.slice(0, 8000)}`,
          token, orch.model, 400,
        );
        const j = JSON.parse((raw.match(/\{[\s\S]*\}/)?.[0]) ?? '{}') as { decision?: string; reason?: string; summary?: string };
        decision = j.decision === 'accept' ? 'accept' : 'human';
        reason = (j.reason ?? '').trim();
        summary = (j.summary ?? '').trim();
      } catch (err) {
        console.error(`orch_plan_judge #${t.number} failed (defaulting to human):`, err);
        decision = 'human';
      }
    } else if (!live) {
      // echo: deterministic for the gate — "[review]" holds, else auto-accepts. But a BLOCKED
      // cred (real subscription down + Manual failover) must NOT auto-accept an unreviewed plan
      // — route to the human (who'll see the reconnect card when execution is attempted).
      decision = cred.blocked || /\[review\]/i.test(`${t.title} ${t.description ?? ''}`) ? 'human' : 'accept';
    }

    if (decision === 'accept') {
      // "Accept" can no longer mean execute: task.approve_plan is HUMAN_ONLY (docs/29 §4d)
      // and the server refuses any claim out of plan_review without plan_approved_at. So the
      // orchestrator's accept = PRE-OFFER the worker and RECOMMEND approval — the human's
      // stamp is what releases the claim (the claim watch keys on plan_approved_at).
      olog({ kind: 'lifecycle', phase: 'accepted', summary: `recommended plan approval for #${t.number}` });
      await offerPlanToWorker(orch, t, ch);
      // ONE approval component (2026-08-22, George): the ‹plan:vN› card IS the gate — this
      // message used to add its own nmq "Approve the plan?" card, whose answer routes to the
      // orchestrator and CANNOT approve (task.approve_plan is HUMAN_ONLY), so the human clicked
      // a button that did nothing while the real one sat above it. Prose points at the card.
      await say(`📋 The implementation plan for #${t.number} “${t.title}” is ready (see **${planName}** in the artifacts).${summary ? ` In brief: ${summary}.` : ''} I've reviewed it against the requirements and recommend approving${reason ? ` (${reason})` : ''} — a worker is lined up, and nothing executes until you approve. **Approve plan** on the plan card in this thread releases it.`);
      notifyDesktop(`Plan ready for review — #${t.number}`, `${t.title} — the orchestrator recommends approval.`);
      return;
    }
    // route to the human: tag them, summarize the plan, point at the plan card (the ONE gate)
    const tag = live ? await ownerHandle(ch.workspace_id) : null;
    await say(`📋 ${tag ? `${tag} — ` : ''}the implementation plan for #${t.number} “${t.title}” is ready for your review (see **${planName}** in the artifacts).${summary ? ` In brief: ${summary}.` : ''}${reason ? ` ${reason}.` : ''} Nothing executes until you approve — **Approve plan** on the plan card in this thread.`);
    notifyDesktop(`Plan ready for review — #${t.number}`, `${t.title} — approve to proceed, or request changes.`);
    olog({ kind: 'lifecycle', phase: 'review', summary: `routed plan #${t.number} to the human for approval` });
    console.log(`plan_review_human task=${t.number} notified`);
    // hold here; the `decided` guard prevents a re-notify
  } catch (err) {
    decided.delete(t.id);
    console.error(`orch_plan_decision #${t.number} failed:`, err);
  } finally {
    setStatus(orch, 'online');
  }
}

async function offerPlanToWorker(orch: HostedAgent, t: PlanTask, ch: { id: string; slug: string; workspace_id: string }) {
  const actor = { kind: 'agent', id: orch.id, role: 'orchestrator' };
  // marketer included (marketing-os round, found live): a playbook unit in a marketing room
  // has no worker/developer to offer — plume IS its builder, and excluding the role stranded
  // an approved plan in plan_review through five retries. Devs still win the tie in mixed rooms.
  const [worker] = await db.getAll<{ name: string }>(
    `select a.name from agents a join agent_channels ac on ac.agent_id = a.id
     where ac.channel_id = ? and a.role in ('worker', 'developer', 'marketer') and a.id != ? and a.retired_at is null
     order by case a.role when 'developer' then 0 when 'worker' then 1 else 2 end, a.name limit 1`,
    [t.channel_id, orch.id],
  );
  if (!worker) {
    // A miss here was a SILENT ONE-SHOT: the plan_review watch only refires on TASK changes,
    // so replica lag on agents/agent_channels stranded an approved plan in plan_review forever
    // (the smoke-gate stall — pre-existing on main, verified at f72cc147). Say so and retry
    // with backoff, the same recovery shape the designer's provider question already uses.
    approvedOffered.delete(t.id);
    const attempt = (planOfferRetries.get(t.id) ?? 0) + 1;
    planOfferRetries.set(t.id, attempt);
    console.warn(`plan_offer #${t.number}: no worker/developer registered in the channel yet (attempt ${attempt})${attempt <= 5 ? ' — retrying' : ' — giving up until the board changes'}`);
    if (attempt <= 5) {
      // retry the OFFER, not the judgment — the decision (orchestrator's or the human's
      // stamp) is already settled by the time an offer is attempted
      setTimeout(() => { void offerPlanToWorker(orch, t, ch); }, 2_000 * attempt);
    } else {
      planOfferRetries.delete(t.id);
    }
    return;
  }
  planOfferRetries.delete(t.id);
  let checklist: string[] = [];
  try { checklist = JSON.parse(t.requirements ?? '[]') as string[]; } catch { /* none */ }
  const res = await post('/v1/commands', actor, {
    type: 'task.offer', taskId: t.id, offerTo: worker.name, checklist: checklist.length ? checklist : ['plan approved'],
  });
  if (!res.ok) throw new Error(`plan offer ${res.status}: ${await res.text()}`);
  await post('/v1/messages', actor, {
    workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: `Plan approved — offered #${t.number} to @${worker.name} for execution.`,
  });
}

  return { architectFlow, ownerHandle, orchPlanDecision, offerPlanToWorker };
}
