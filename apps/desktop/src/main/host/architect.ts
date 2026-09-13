// The architect's own flow — drafting an implementation plan. Split out of host/planflow.ts.
import { PROVIDER_LABEL, authBlockedCard, openPlanningWorkspace, resolveToken, runtimeFor } from '../agents';
import type { ExecTask, HostedAgent, OfferedTask, SkillRef, PlanTask } from '../agents';
import { type ClaimVerdict } from '@neuramesh/shared';
import { architectBeatTitles } from '../beats';
import { buildImplementationPlan, extractDefinitionOfDone } from './plan';
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

export function makeArchitect(ctx: HostCtx & {
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
        beatCursor, 
        alog, arun, 
        readOnlyStudy,
        seatFor, setStatus } = ctx;
// The guard registry's fields keep their short names, exactly as they read inside startAgentHost.
const { 
        planned } = ctx.guards;

async function architectFlow(arch: HostedAgent, t: PlanTask) {
  arch = await seatFor(arch, t.channel_id, { taskId: t.id }); // per-project + per-thread brains (docs/10)
  const actor = { kind: 'agent', id: arch.id, role: 'architect' };
  const beats = beatCursor(actor, t.id); // inert until declare(); the catch can fail() it safely
  let chRef: { id: string; slug: string; workspace_id: string } | undefined; // hold the channel so the catch can surface a failed plan to it
  let plog: LogFn | undefined; // the plan run's log sink, hoisted so a failure lands in the same run
  let cleanupStudy: (() => Promise<void>) | null = null; // the study clone — removed on every exit path the user is watching
  try {
    const ch = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [t.channel_id]);
    chRef = ch;
    const cred = await resolveToken(apiUrl, ch.workspace_id, arch, ownerActorId);
    // Preferred subscription is down + failover is Manual → post the reconnect card and block,
    // rather than fabricate a deterministic echo plan that looks like real architecture.
    if (cred.blocked && process.env['NM_AGENT_MODE'] !== 'echo') {
      const reason = `${PROVIDER_LABEL[cred.blocked.provider]} subscription login is ${cred.blocked.reason} on the host — reconnect it, or switch @${arch.name} to API-key mode (or enable Auto failover with a key), then re-plan #${t.number}. Won't bill a key automatically.`;
      await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: authBlockedCard(arch, cred.blocked, t.number) }).catch(() => {});
      await post('/v1/commands', actor, { type: 'task.block', taskId: t.id, reason }).catch((e) => console.error(`task_block #${t.number} failed:`, e));
      setStatus(arch, 'online');
      return;
    }
    const token = cred.token ?? ''; // apikey → the key; subscription → '' (providerEnv strips keys)
    const live = process.env['NM_AGENT_MODE'] !== 'echo' && cred.authMode !== 'none';
    setStatus(arch, 'thinking');
    let checklist: string[] = [];
    try { checklist = JSON.parse(t.requirements ?? '[]') as string[]; } catch { /* none */ }
    // a re-draft (revise_plan bounced it back) folds in the human's review
    // notes — the inline-comment packet they submitted on the previous plan.
    const feedback = await db.getAll<{ body: string }>(
      `select body from messages where task_id = ? and author_kind = 'human' order by created_at desc limit 4`,
      [t.id],
    );
    const notes = feedback.map((f) => f.body).reverse().join('\n');
    // the server versions each proposal (implementation-plan-v{N}.md); N = prior plans + 1
    // (already synced before this re-draft) — computed up front so a re-plan's beats and
    // the final announcement both carry the same version.
    const priorPlans = await db.get<{ n: number }>(`select count(*) as n from artifacts where task_id = ? and name like 'implementation-plan%'`, [t.id]);
    const planVersion = (priorPlans?.n ?? 0) + 1;
    // Beats: the architect's mixture-of-agents milestones (docs/17), advanced from
    // buildImplementationPlan's onPhase callbacks. Live runs only — echo stays
    // deterministic for the e2e gate. A re-plan (v2+) declares rework-named titles:
    // the fresh run_id alone left the tracker pixel-identical to the prior draft's.
    await beats.declare('planning', architectBeatTitles(planVersion), live);
    // a design-gated task arrives in planning with human-APPROVED mockups — the
    // plan must implement to match them, and the DoD must carry that contract
    const dArts = await db.getAll<{ name: string }>(`select name from artifacts where task_id = ? and kind = 'design'`, [t.id]).catch(() => [] as Array<{ name: string }>);
    const dLatest = dArts.reduce((m, a) => Math.max(m, Number(/^design-mockup-v(\d+)-/.exec(a.name)?.[1] ?? 0)), 0);
    const designNames = dArts.filter((a) => a.name.startsWith(`design-mockup-v${dLatest}-`)).map((a) => a.name);
    const designBrief = designNames.length
      ? `\n\nApproved design mockups (the human-approved visual contract): ${designNames.join(', ')} — OPEN THEM in ./.nm-evidence/design/ and read them end to end before you plan. They are the contract the developer builds to and the reviewer gates on. Plan the implementation to MATCH them (layout, spacing, tokens, both themes), name the actual files that must change to produce them, and include "matches the approved design mockups (${designNames.join(', ')})" as a Definition of Done item.`
      : '';
    const planLog = arun(arch, { id: t.id, number: t.number, channel_id: t.channel_id }, ch.slug).log;
    plog = planLog; // expose the run's sink to the catch (a failure logs into the same run)
    // The study workspace: the repo this plan targets + the approved mockups, on disk,
    // read-only. Without it the planner was writing against filenames it had never opened.
    const study = live ? await openPlanningWorkspace(db, t, planLog) : { dir: null, repoBacked: false, note: '', cleanup: async () => {} };
    cleanupStudy = study.cleanup;
    const brief =
      `Task #${t.number}: ${t.title}\n${t.description ?? ''}\nResolved requirements / checklist: ${checklist.join(' · ') || '(none yet)'}` +
      designBrief +
      study.note +
      (notes ? `\n\nHuman review notes to incorporate (address each):\n${notes}` : '');
    // Acknowledge the moment we pick it up — the task can sit in `planning` for a while during the
    // mixture-of-agents draft, so without this the human sees no sign the architect is on it.
    // Live only: the echo gate's deterministic stub posts instantly, so an ack would just be noise.
    if (live) {
      await post('/v1/messages', actor, {
        workspace: ch.workspace_id, channel: ch.id, taskId: t.id,
        body: `🏗 ${arch.name} here — I've picked up #${t.number} and I'm ${notes ? 'revising the plan with your notes' : 'drafting the implementation plan'} now (planner → adversarial critics → synthesis). I'll post it here for your review shortly.`,
      }).catch(() => {});
      planLog({ kind: 'lifecycle', phase: 'claimed', summary: `picked up #${t.number} to plan` });
    }
    // Each mixture-of-agents milestone (planner → critics → synthesis) both logs to
    // the run and advances the beat tracker one step; the final next() below settles
    // the "finalize" beat once the plan (with its DoD) is in hand.
    const plan = live
      ? await buildImplementationPlan(
          runtimeFor(arch.runtime), arch.model, token, brief,
          (summary) => { planLog({ kind: 'turn', phase: 'moa', summary }); void beats.next(); },
          study.dir ? readOnlyStudy(arch, study.dir, token, planLog) : null,
        )
      : `# Implementation plan — #${t.number} ${t.title}\n\n## Approach\nEcho stub plan (set an API key for the mixture-of-agents architect: planner + two adversarial critics + synthesis).\n\n> [!IMPORTANT]\n> **Assumption:** this is the echo stub — confirm an API key is configured to get a real mixture-of-agents plan.\n\n## Steps\n1. ${checklist[0] ?? 'do the work'}\n\n## Risks & fallbacks\n- none noted (stub)\n\n> [!NOTE]\n> **Open question:** anything to clarify before execution?\n\n## Validation\n- ${checklist.join('\n- ') || 'stub deliverable'}`;
    await beats.next(); // finalize done — the plan + Definition of Done are written (before the phase transitions)
    const res = await post('/v1/commands', actor, { type: 'task.propose_plan', taskId: t.id, plan });
    if (!res.ok) throw new Error(`propose_plan ${res.status}: ${await res.text()}`);
    // The SERVER names the artifact; read that name back instead of deriving a second
    // one. Announcing a locally-computed version is how #1034 linked
    // implementation-plan-v1.md while the artifact list held v5 — the two derivations
    // disagree on every design-gated task, and the linkified name pointed at nothing.
    const proposed = await res.json().catch(() => null) as { artifacts?: Array<{ name?: string }> } | null;
    const planName = proposed?.artifacts?.find((a) => /^implementation-plan-v\d+\.md$/i.test(a?.name ?? ''))?.name
      ?? `implementation-plan-v${planVersion}.md`;
    // lift the plan's `## Definition of Done` onto the task as its authoritative
    // acceptance contract — the human reviews it as part of approving the plan,
    // the reviewer later gates the submission against it (editable in the UI).
    const dod = extractDefinitionOfDone(plan);
    if (dod) {
      const dr = await post('/v1/commands', actor, { type: 'task.set_definition_of_done', taskId: t.id, dod });
      if (!dr.ok) console.error(`set_definition_of_done #${t.number} failed: ${dr.status} ${await dr.text()}`);
    }
    await post('/v1/messages', actor, {
      workspace: ch.workspace_id, channel: ch.id, taskId: t.id,
      body: `📐 Implementation plan ${notes ? 'revised' : 'proposed'} for #${t.number} — see **${planName}** in the artifacts${dod ? ' (it sets the Definition of Done)' : ''}. Awaiting approval before execution.`,
    });
    alog(arch, null, ch.slug)({ kind: 'lifecycle', phase: 'proposed', summary: `proposed plan for #${t.number} (${live ? 'mixture-of-agents' : 'echo stub'})` });
  } catch (err) {
    planned.delete(t.id);
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`architect_flow #${t.number} failed:`, err);
    // Never let a plan die silently — that's the "is anything even happening?" trap. Log it as an error,
    // tell the human in the thread, and BLOCK the task so it surfaces as an actionable state instead of
    // sitting forever in `planning` (unblocking re-enters planning → the architect re-plans).
    (plog ?? alog(arch, t, chRef?.slug ?? null))({ kind: 'result', phase: 'error', summary: `plan generation failed for #${t.number}: ${reason.slice(0, 180)}`, level: 'error' });
    await beats.fail(); // mark the in-flight beat blocked while we still own `planning` (before task.block)
    if (chRef) {
      await post('/v1/messages', actor, {
        workspace: chRef.workspace_id, channel: chRef.id, taskId: t.id,
        body: `⚠️ ${arch.name} couldn't draft the plan for #${t.number} — ${reason.slice(0, 180)}. I've blocked it so it isn't silently stuck; unblock it to have me retry.`,
      }).catch(() => {});
      await post('/v1/commands', actor, { type: 'task.block', taskId: t.id, reason: `plan generation failed: ${reason.slice(0, 200)}` }).catch((e) => console.error(`task_block #${t.number} failed:`, e));
    }
  } finally {
    await cleanupStudy?.(); // the read-only clone never outlives the plan that used it
    setStatus(arch, 'online');
  }
}

  return { architectFlow };
}
