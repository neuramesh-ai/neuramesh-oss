// THE ROLE FLOWS — what each teammate actually does when it holds a task (track B2).
//
// architect → designer → developer → reviewer → shipper, plus the claim/own/resume paths and
// the block/unblock machinery around them. They call each other (an execute that fails resumes,
// a review that passes hands to ship), which is why they leave as ONE module: splitting a cycle
// across files buys nothing and costs an import graph nobody can read.
//
// Extracted from agents.ts — makeFlows(ctx) destructures the host services and returns the same
// functions, so the bodies are unchanged and every call site inside them still resolves.
//
// executeFlow's repo branch (the `if (t.repo_id)` arm) deliberately STAYS inline. It reads 20
// locals and writes back 7 — a signature that long is a closure written out longhand, not a
// module boundary — and it is the path by which code reaches a PR, with no end-to-end test
// under it. The turn-inputs block above it moved out instead (host/workerturn.ts) precisely
// because it crosses the boundary in one direction only.
import { starterFallback, unavailableOf, whyUnavailable } from './starterfallback';
import { CONTENT_OUTPUT_CONTRACT, RESEARCH_OUTPUT_CONTRACT, EXEC_FAIL_BLOCK_AFTER, brandTokensFor, collectFiles, designerImageCred, generateBrandImage, imageDataUri, projectPolicy, resolveToken, runCoding, runtimeFor, stageApprovedDesigns, stageBrandContext, stageConnections, stageTaskAttachments, stoppedTasks, worktreeRun } from '../agents';
import type { ExecTask, HostedAgent, OfferedTask, SkillRef } from '../agents';
import { EVIDENCE_IMAGE_BUDGET, IMAGE_EXT, evidenceDropNote, planEvidenceBudget, sweepEvidenceImages } from '../evidence';
import { approvedPlanNote } from './planinject';
import { FINISH_NOW_NOTE, claimsPendingWork, shouldBlockEcho } from '../runtime/honesty';
import { PACKS, TURN_BUDGETS, UNBLOCK_MARKER, type DraftedPost, type ClaimVerdict } from '@neuramesh/shared';



import { generateBeatPlan } from './plan';
import { deliverablePath, type SubjectRef } from '../harness/brain';
import { classifyExecError, planWallOutcome } from '../execpolicy';


import { git, localRepoRemote } from './gh';
import { draftPostsFromWorkspace } from '../content-producer';


import { providerFor, type BeatsFn } from '../runtime/adapter';
import { parkStepLine } from '../harness/park';
import { contractDeliverables, finishLeanUnit, postSubtaskAcceptance, taskFlowMeta } from './leanunits';
import { pickImageProvider } from '../imagegen';
import { prepareScratchWorkspace } from '../rework';

import { type BeatStatusW } from './beats';
import { type LogFn } from '../agentlog';
import { type RunTerminal } from './runs';

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
import { makeBlock } from './block';
import { makeReleaseDocs } from './releasedocs';
import { makeSkillImport } from './skillimport';
import { makeClaimFlow } from './claimflow';
import { makeDesignFlow } from './designflow';
import { makePlanFlow } from './planflow';
import { makeReviewFlow } from './reviewflow';
import { makeShipFlow } from './shipflow';
import { makeWorkerTurn } from './workerturn';

export const STATIC_CHECKLIST = ['scope understood from title + channel context', 'registered to this channel', 'no blocking questions'];
export const workspaceFor = (t: ExecTask): string =>
  t.repo_id
    ? `\`~/.neuramesh/worktrees/nm-${t.number}\`${t.branch ? ` on branch \`${t.branch}\`` : ''} (pushed before review)`
    : 'scratch workspace — produced files attach to this thread as artifacts';

/** the shape the ship + verify flows read a task in — shared with host/releasedocs.ts */
export type ShipTask = { id: string; number: number; title: string; channel_id: string; pr_number: number | null; ship_plan: string | null };

export function makeFlows(ctx: HostCtx & {
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
  priorMachineFor: (threadId?: string | null, taskId?: string | null) => Promise<string | null>; requestSleeperWake: ReturnType<typeof import('./sleepers').makeSleeperWake>['requestSleeperWake']; nobodyServes: ReturnType<typeof import('./sleepers').makeSleeperWake>['nobodyServes'];
  readOnlyStudy: (agent: HostedAgent, dir: string, token: string, log?: LogFn) => ((system: string, user: string) => Promise<string>) | null;
  seatFor: (agent: HostedAgent, channelId: string, scope?: { threadId?: string | null; taskId?: string | null }) => Promise<HostedAgent>;
  setStatus: (agent: HostedAgent, status: 'online' | 'thinking' | 'working') => void;
  sinceFirstSeen: (key: string) => number;
  spawnLegFor: (parent: HostedAgent, where: { workspace: string; channelId: string; taskId?: string | null; threadId?: string | null }, dir: string, task: ExecTask, budget: { wallMs: number; contextTokens: number }, log: LogFn | undefined, _depth: number) => (i: { role: string; prompt: string; label?: string }) => Promise<{ ok: boolean; summary?: string; error?: string }>;
  taskRecallNote: (workspaceId: string, query: string, lessonsNote: string) => Promise<string>;
  whiteboardClosures: (actor: { kind: string; id: string; role?: string }, ch: { id: string; workspace_id: string }, at: { taskId?: string; threadId?: string }) => WhiteboardToolClosures;
  /** the reply card on the worker bus (reply-radar): the turn that FOUND the conversations hands them over */
  replyDraft: (actor: { kind: string; id: string; role?: string }, ch: { id: string; workspace_id: string }, at: { taskId?: string; threadId?: string }) => (i: { report?: string; baseline?: string; replies: unknown[] }) => Promise<string>;
  /** X reads for a WORK turn — the grant and the closure move together (see agents.ts) */
  searchXFor: (actor: { kind: string; id: string; role?: string }, ch: { id: string; workspace_id: string }) => (q: { query: string; max?: number }) => Promise<string>;
}) {
const { db, apiUrl, workspace, ownerActorId, post, agents, parkBook, execQueue, claimed,
        NO_RUN, openRun, narrate, declareBeats, advanceBeat, parkFor,
        arun, handleExhaustion,
        seatFor, setStatus, spawnLegFor, whiteboardClosures, replyDraft, searchXFor } = ctx;
// The guard registry's fields keep their short names, exactly as they read inside startAgentHost.
const { 
        parkRequests, parkResumeNotes, reviewed,
        taskRunIds } = ctx.guards;

// Split-out neighbours: the same ctx, so they are built here and their results keep the names
// the flows below already call them by (host/block.ts · host/skillimport.ts · host/releasedocs.ts).
const { blockFor, refreshChannelBlock, sleepTimeTick } = makeBlock(ctx);
const { walkSkillMd, curatorImport } = makeSkillImport(ctx);
const { releaseDocsNote } = makeReleaseDocs(ctx);
const { buildWorkerTurn } = makeWorkerTurn(ctx);

// The flow modules, built in dependency order — each takes the neighbours it CALLS, so the
// cycle that kept them together (execute ⇄ resume, execute → review → ship) is now a chain.
const { shipperFlow } = makeShipFlow({ ...ctx, releaseDocsNote });
const { reviewFlow } = makeReviewFlow({ ...ctx, shipperFlow });
const { architectFlow, ownerHandle, orchPlanDecision, offerPlanToWorker } = makePlanFlow(ctx);
const { designerFlow, orchDesignNotify } = makeDesignFlow({ ...ctx, ownerHandle, blockFor });
const { estimateFor, checklistFor, claimFlow, ownFlow, owningContext, remoteDelegate } = makeClaimFlow({ ...ctx, executeFlow });


async function resumeFlow(agent: HostedAgent, t: ExecTask & { requirements_confirmed: number }) {
  const actor = { kind: 'agent', id: agent.id, role: agent.role };
  try {
    if (Number(t.requirements_confirmed) !== 1) {
      const conf = await post('/v1/commands', actor, {
        type: 'task.confirm_requirements',
        taskId: t.id,
        checklist: ['scope understood from title + channel context', 'registered to this channel', 'no blocking questions'],
      });
      if (!conf.ok) throw new Error(`confirm ${conf.status}`);
    }
    const ch = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [t.channel_id]);

    // restart-loop guard: a task that keeps failing execution must not retry
    // forever on every relaunch. After a small budget, block it with the last
    // reason so a human sees it (blocked is off the resume watch — loop ends).
    const [fc] = await db.getAll<{ n: number }>(
      // walls SINCE THE LAST UNBLOCK — an all-time count made the budget a latch that no
      // human action could reset, so Unblock put the task straight back into blocked
      `select count(*) as n from messages where task_id = ? and author_kind = 'agent' and body like 'Execution hit a wall%'
         and created_at > coalesce((select max(created_at) from messages m2 where m2.task_id = ? and m2.body like ? ), '')`,
      [t.id, t.id, `${UNBLOCK_MARKER}%`],
    );
    const fails = Number(fc?.n ?? 0);
    if (fails >= EXEC_FAIL_BLOCK_AFTER) {
      const [last] = await db.getAll<{ body: string }>(
        `select body from messages where task_id = ? and author_kind = 'agent' and body like 'Execution hit a wall%'
           and created_at > coalesce((select max(created_at) from messages m2 where m2.task_id = ? and m2.body like ? ), '')
         order by created_at desc limit 1`,
        [t.id, t.id, `${UNBLOCK_MARKER}%`],
      );
      const why = (last?.body ?? '').replace(/^Execution hit a wall:\s*/, '').slice(0, 160);
      const reason = `execution failed ${fails}× — ${why || 'see thread'}`;
      const blk = await post('/v1/commands', actor, { type: 'task.block', taskId: t.id, reason });
      await post('/v1/messages', actor, {
        workspace: ch.workspace_id,
        channel: ch.id,
        taskId: t.id,
        body: `Auto-blocked #${t.number} after ${fails} failed execution attempts — not retrying on restart anymore.\n\n**Likely cause:** ${why || 'execution kept failing'}\n\nCheck @${agent.name}'s Anthropic key/quota (Agents → key), then **Unblock** to retry, or **Close** the task.`,
      }).catch(() => {});
      console.warn(`agent_resume agent=${agent.name} task=${t.number} auto-blocked after ${fails} failures (block ${blk.status})`);
      return; // claimed releases when the guard watch observes 'blocked'
    }

    await post('/v1/messages', actor, {
      workspace: ch.workspace_id,
      channel: ch.id,
      taskId: t.id,
      body: `Resuming #${t.number} (attempt ${fails + 1}) — picking the work back up.
- **Workspace:** ${workspaceFor(t)}
- **Progress:** watch the live run on this task — no time limit, and I'll post here when there's something to say.`,
    });
    console.log(`agent_resume agent=${agent.name} task=${t.number} attempt=${fails + 1} ok`);
    await executeFlow(agent, t, ch); // never throws — reports its own failures
  } catch (err) {
    claimed.delete(t.id);
    console.error(`agent_resume agent=${agent.name} task=${t.number} failed:`, err);
  }
}


// execute → result note in the thread → submit. Repo-backed tasks work in a
// worktree and push their branch first (submit carries the sha — the server
// rejects repo-backed submits without one); no-repo tasks attach the note.
async function executeFlow(agent: HostedAgent, t: ExecTask, ch: { id: string; slug: string; workspace_id: string }) {
  agent = await seatFor(agent, ch.id, { taskId: t.id }); // per-project + per-thread brains (docs/10)
  const actor = { kind: 'agent', id: agent.id, role: agent.role };
  const { log: rawLog, runId: workLogRunId } = arun(agent, t, ch.slug);
  // Rebound to `narrate(workRun, rawLog)` the moment the run opens (below): every log line
  // then also drives the run's synced step. `let`, so the closures below see the wrapped one.
  let log: LogFn = rawLog;
  // Subtasks (docs/24) ride their PARENT: the result note lands in the parent's
  // thread and the deliverables attach to the parent via finish_subtask (no
  // submit/review of their own — the parent's gates cover the sum).
  const parent = await db.get<{ id: string; number: number }>(
    'select p.id, p.number from tasks p where p.id = (select parent_task_id from tasks where id = ?)', [t.id],
  ).catch(() => null);
  // a lean unit (no review leg — leanunits.ts) finishes to the accept gate instead of
  // submitting; a playbook run's deliverable takes the contract name at delivery
  const { lean: leanPlan, playbook } = !t.repo_id ? await taskFlowMeta(db, t.id) : { lean: false, playbook: null };
  setStatus(agent, 'working');
  // The task's synced work run (docs/29): the live activity feed for THIS execution, on every
  // machine. It replaced the "Still on it — 6m in" thread heartbeat: a run narrates what the
  // agent is actually doing (rationed to one step ≥2.5s) instead of asserting that it is alive,
  // and the stall watchdog reads the same row to tell a long run from a wedged one.
  let workRun: RunHandle = NO_RUN;
  let runEnd: RunTerminal = 'failed'; // pessimistic: only a real submit/finish flips it to done
  // Beats (docs/17): Claude mirrors its live TodoWrite; codex/gemini get a first-pass
  // plan declared up front (populated in the try). Hoisted so the wall/catch can settle it.
  const isAnthropic = agent.runtime !== 'codex' && agent.runtime !== 'gemini';
  const beatsFns: BeatsFn = {
    declare: (items) => declareBeats(actor, t.id, 'in_progress', items).then(() => {}),
    advance: (seq, status) => advanceBeat(actor, t.id, seq, status as BeatStatusW),
  };
  let coarsePlan: string[] = []; // non-Claude first-pass plan (empty for Claude / unparseable)
  try {
    let cred = await resolveToken(apiUrl, ch.workspace_id, agent, ownerActorId);
    // the seat cannot run → the Starter door (host/starterfallback.ts): a routine's unit re-seats and
    // runs on the Starter worker lane; a human's gets the reason and the card, and the task blocks
    const gap = unavailableOf(cred, agent.runtime);
    const next = gap ? await starterFallback(agent, gap, { workspace: ch.workspace_id, channelId: ch.id, taskId: t.id, taskNumber: t.number }, log) : agent;
    if (!next) {
      await post('/v1/commands', actor, { type: 'task.block', taskId: t.id, reason: `@${agent.name} cannot run here. ${whyUnavailable(gap!, agent.runtime)} Sign in again, or switch this conversation to the NeuraMesh brain, then re-offer #${t.number}.` });
      log({ kind: 'exec', phase: 'error', summary: `blocked — ${whyUnavailable(gap!, agent.runtime)}`, level: 'error' }); return;
    }
    if (gap) { agent = next; cred = await resolveToken(apiUrl, ch.workspace_id, agent, ownerActorId); }
    const token = cred.token ?? ''; // apikey → the key; subscription → '' (providerEnv strips keys)
    const mode = process.env['NM_AGENT_MODE'] === 'echo' ? 'echo' : cred.authMode !== 'none' ? 'claude' : 'echo';
    const adapter = runtimeFor(agent.runtime); // selects the codex/gemini/anthropic runtime

    // On a rework (a reviewer bounced the PR back), fold the latest change-request +
    // any human guidance into the developer's prompt so it addresses THOSE specific
    // points instead of re-running the whole task. Empty on a first attempt.
    const reworkFb = await db.getAll<{ body: string }>(
      `select body from messages where task_id = ? and (body like 'Auto-review of #%changes requested%' or author_kind = 'human') order by created_at desc limit 4`,
      [t.id],
    ).catch(() => [] as Array<{ body: string }>);
    // a resumed PARK carries its own reason (docs/harness/05 §3.8), which rides the same slot as
    // review feedback — both answer "why are you running again". Consumed once, so a later attempt
    // does not re-read a stale wake reason.
    const parkNote = parkResumeNotes.get(t.id) ?? '';
    parkResumeNotes.delete(t.id);
    // per-message cap (2026-08-18 audit: four FULL bodies rode into every rework prompt uncapped)
    const reworkNotes = [parkNote, reworkFb.some((m) => /changes requested/.test(m.body)) ? reworkFb.map((m) => m.body.length > 1_200 ? `${m.body.slice(0, 1_200)} […]` : m.body).reverse().join('\n') : ''].filter(Boolean).join('\n\n');
    if (reworkNotes) log({ kind: 'exec', phase: 'started', summary: "rework: addressing the reviewer's change-request directly (not a full redo)" });

    // An agent with NO resolvable credential would otherwise silently fall to the echo
    // STUB (a fake RESULT that looks like real work — the misleading-dogfooding bug).
    // Block with an actionable message instead; the human sets a key/subscription and
    // re-offers. This now covers EVERY runtime including claude-code (which used to keep
    // a silent echo fallback). The explicit dev gate (NM_AGENT_MODE=echo) is unaffected.
    // Enforced honesty over a fake deliverable.
    if (shouldBlockEcho({ mode, globalEchoGate: process.env['NM_AGENT_MODE'] === 'echo' })) {
      const provider = agent.runtime === 'codex' ? 'OpenAI/Codex' : agent.runtime === 'gemini' ? 'Gemini' : 'Anthropic/Claude';
      const envvar = agent.runtime === 'codex' ? 'CODEX_API_KEY' : agent.runtime === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY';
      const reason = `no ${provider} auth for @${agent.name} (${agent.runtime} runtime) — sign in to your ${provider} subscription on this machine, or set an API key on the agent (Agents → @${agent.name}) or as ${envvar} on the host, then re-offer #${t.number}. Won't fake a deliverable.`;
      await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: `⚠️ Can't run #${t.number}: ${reason}` }).catch(() => {});
      await post('/v1/commands', actor, { type: 'task.block', taskId: t.id, reason });
      log({ kind: 'exec', phase: 'error', summary: `blocked — ${reason}`, level: 'error' });
      return;
    }

    let result: string;
    // "still waiting on my background agents" is not a deliverable (docs/29). A worker's turn
    // IS its execution — nothing it starts survives the return — so a summary that ends by
    // waiting gets ONE nudge to finish here, and blocks if it still won't. Set when that
    // second turn also fails; checked just before submit, on every path.
    let heldReason: string | null = null;
    let sha: string | null = null;
    let diffText = '';
    let prUrl: string | null = null;
    let prNumber: number | null = null;
    let files: Array<{ kind: 'file' | 'screenshot'; name: string; content: string }> = [];
    // evidence images that did NOT attach (over budget / unreadable) — named in the
    // submit note so the worker, reviewer, and human all see the gap (never silent)
    const droppedEvidence: string[] = [];
    // Long runs must never read as stalled — and must not have to SAY so in the thread.
    // The run row is where "still moving" lives now: opened here, stepped by `narrate`
    // off the same activity stream the ghost reads, settled on every exit path below.
    if (mode === 'claude') {
      workRun = await openRun(agent, { workspace: ch.workspace_id, channelId: ch.id, taskId: t.id },
        { kind: 'work', title: `#${t.number} ${t.title}`.slice(0, 120), step: 'starting the run', id: workLogRunId }).catch(() => NO_RUN);
      // Record the exec run so a SPAWNED LEG hangs off it (docs/harness/04). Found live: without
      // this, `parentRunOf` returned null and every subagent opened as a ROOT run — the fan-out
      // ran correctly but rendered as separate top-level cards, so the tree could never nest.
      if (workRun.id) taskRunIds.set(t.id, workRun.id);
    }
    log = narrate(workRun, rawLog); // every exec log line also feeds the run's live step
    const stoppedNote = 'Stopped by a human mid-run — submitting what was on disk at that point; review carefully.';
    // Everything the runtime needs in hand (host/workerturn.ts): the skills it may reach for,
    // the three commands it may issue, the permission gate, the sandbox's protected paths, and
    // the memory injected into its prompt. `log` is passed by VALUE — it was rebound to the
    // run-narrating wrapper on the line above, and that wrapper is what the injections log to.
    const { skills, proposeSkill, recordLesson, addBacklogItem, permissionGate, sandboxProtectedPaths, memoryNote } =
      await buildWorkerTurn({ t, ch, agent, actor, mode, adapter, token, log });
    // The worker's own plan → beats (docs/17). Two mechanisms, one per runtime family:
    //  · Claude — its native TodoWrite list is mirrored live as the beat set (in claudeCode).
    //  · codex/gemini — no host-readable todo, so a FIRST-PASS analysis (generateBeatPlan,
    //    the same model) produces the ordered plan up front; the daemon declares it here,
    //    injects it into the run, and settles it on a clean finish.
    let planNote = ''; // the non-Claude plan carried into the coding prompt
    if (!isAnthropic && mode === 'claude') {
      coarsePlan = await generateBeatPlan(adapter, agent.model, token, t);
      if (coarsePlan.length) {
        await beatsFns.declare(coarsePlan);
        await beatsFns.advance(0, 'active');
        log({ kind: 'tool', phase: 'inject', summary: `first-pass plan → ${coarsePlan.length} beats declared` });
        planNote = `\n\nYour plan for this task — work through these IN ORDER (they are shown to the human live as your progress "beats", so follow and complete them):\n${coarsePlan.map((s, i) => `${i + 1}. ${s}`).join('\n')}\nThe MOMENT you finish each step, output a line on its own that is EXACTLY \`NM_BEAT_DONE <n>\` (n = that step's number above) and nothing else — this ticks the step off live for the human. Do this as you complete each step, not all at the end.\n`;
      }
    }
    // the approved plan + description reach the builder (audit defect A3) — planinject.ts
    planNote += await approvedPlanNote(db, t.id, log);
    if (t.repo_id) {
      // repo row arrives on its own sync stream; give it a beat if needed
      let repo: { clone_url: string; default_branch: string; local_path: string | null } | undefined;
      for (let i = 0; i < 10 && !repo; i++) {
        [repo] = await db.getAll<{ clone_url: string; default_branch: string; local_path: string | null }>(
          'select clone_url, default_branch, local_path from repos where id = ?',
          [t.repo_id],
        );
        if (!repo) await new Promise((r) => setTimeout(r, 500));
      }
      if (!repo) throw new Error(`repo ${t.repo_id} not in sync scope`);
      // A locally-attached repo can have an empty clone_url while its checkout has a real git remote —
      // auto-detect it so the normal clone → push → PR flow runs against the repo's origin.
      if (!repo.clone_url && repo.local_path) repo.clone_url = await localRepoRemote(repo.local_path);
      if (!repo.clone_url) throw new Error(`repo ${t.repo_id} has no clone_url and no git remote at its local path (${repo.local_path ?? 'none'}) — add a remote (\`git remote add origin <github-url>\`) so tasks can open PRs`);
      let note = '';
      const policy = await projectPolicy(db, t.channel_id); // project's auto-open-PR / CI flags
      const pushed = await worktreeRun(t as ExecTask & { repo_id: string }, repo, async (dir) => {
        if (mode === 'claude') {
          // a human-stopped run falls through with whatever changed in the worktree —
          // worktreeRun commits/pushes it; an untouched tree still fails
          const attNote = (await stageTaskAttachments(db, t.id, dir, true)) + (await stageApprovedDesigns(db, t.id, dir, true)) + (await stageBrandContext(db, t.channel_id, dir)) + planNote;
          // Fan-out for this execution (docs/harness/04): ONE closure, so every spawn in the turn
          // draws from a single remaining budget and lands in one subtree. `work` is the root budget;
          // each child takes a slice, and the slices are what terminate depth.
          const spawnLeg = spawnLegFor(agent, { workspace: ch.workspace_id, channelId: ch.id, taskId: t.id }, dir, t, TURN_BUDGETS.work, log, 0);
          const parkTurn = parkFor(agent, t, ch);
          let run = await runCoding(adapter, agent, t, dir, token, await blockFor(t.channel_id), true, log, skills, proposeSkill, reworkNotes, attNote, recordLesson, memoryNote, addBacklogItem, beatsFns, permissionGate, sandboxProtectedPaths, { spawn: spawnLeg, park: parkTurn, whiteboards: whiteboardClosures(actor, ch, { taskId: t.id }) });
          if (!run.stopped && claimsPendingWork(run.note)) {
            log({ kind: 'exec', phase: 'held', summary: 'turn ended still waiting on background work — one nudge to finish here', level: 'warn' });
            run = await runCoding(adapter, agent, t, dir, token, await blockFor(t.channel_id), true, log, skills, proposeSkill, [reworkNotes, FINISH_NOW_NOTE].filter(Boolean).join('\n\n'), attNote, recordLesson, memoryNote, addBacklogItem, beatsFns, permissionGate, sandboxProtectedPaths, { spawn: spawnLeg, park: parkTurn, whiteboards: whiteboardClosures(actor, ch, { taskId: t.id }) });
            if (!run.stopped && claimsPendingWork(run.note)) heldReason = run.note.replace(/\s+/g, ' ').trim().slice(0, 400);
          }
          note = run.stopped ? stoppedNote : run.note;
          // Lift the worker's evidence images into artifacts so the reviewer's evidence gate + the
          // human's cockpit surface them — pooled budget, in-tree captures first (explicit DoD
          // evidence, e.g. running-app routes from the screenshot tool), then the recursive
          // .nm-evidence sweep, newest first (evidence.ts — the #1015 review loop: a flat readdir
          // missed captures/ subfolders and a shared cap of 8 silently dropped the tail forever).
          // Scan only the worker's CHANGES (git status) for in-tree images, and remove EVERY one
          // from the tree — attached or dropped — so binaries never ride the commit (review happens
          // on the artifacts, not the PR blob). .nm-evidence/ is git-excluded (structural — see
          // worktreeRun), so its images never show in status; the sweep walks it directly.
          const { join } = await import('node:path');
          const { rm } = await import('node:fs/promises');
          const changed = (await git(['status', '--porcelain', '--untracked-files=all'], dir).catch(() => ''))
            .split('\n').map((l) => l.slice(3).trim()).filter((p) => p && IMAGE_EXT.test(p));
          const evRels = await sweepEvidenceImages(join(dir, '.nm-evidence'));
          const pool = planEvidenceBudget([
            ...changed.map((rel) => ({ path: join(dir, rel), name: rel.split('/').pop() ?? rel, inTree: true })),
            ...evRels.map((rel) => ({ path: join(dir, '.nm-evidence', rel), name: rel, inTree: false })),
          ], EVIDENCE_IMAGE_BUDGET);
          for (const img of pool.take) {
            const uri = imageDataUri(img.path);
            if (uri) files.push({ kind: 'screenshot', name: img.name, content: uri });
            else droppedEvidence.push(`${img.name} (unreadable/oversize)`);
          }
          droppedEvidence.push(...pool.dropped.map((img) => img.name));
          for (const img of [...pool.take, ...pool.dropped]) {
            if (img.inTree) await rm(img.path, { force: true }).catch(() => {});
          }
          if (droppedEvidence.length) log({ kind: 'exec', phase: 'evidence', summary: `evidence: ${files.filter((f) => f.kind === 'screenshot').length} image(s) attached, ${droppedEvidence.length} dropped: ${droppedEvidence.slice(0, 6).join(', ')}${droppedEvidence.length > 6 ? ' …' : ''}`, level: 'warn' });
        } else {
          note = `[echo · ${agent.name}] Executed #${t.number} “${t.title}”: stub result — validation note attached as RESULT.md.`;
          const { writeFile } = await import('node:fs/promises');
          const { join } = await import('node:path');
          await writeFile(join(dir, 'RESULT.md'), `# nm #${t.number}: ${t.title}\n\n${note}\n`);
        }
        // stopped mid-run → don't commit/push/open a PR for abandoned work
        if (stoppedTasks.has(t.id)) throw new Error('__stopped__');
      }, policy.autoOpenPr);
      sha = pushed.sha;
      diffText = pushed.diff;
      prUrl = pushed.prUrl ?? null;
      prNumber = pushed.prNumber ?? null;
      result = `Pushed \`${pushed.branch}\` @ ${sha.slice(0, 7)} — review from any machine.${pushed.prNote ? `\n${pushed.prNote}` : ''}\n\n${note}`;
    } else if (mode === 'claude') {
      // repo-less deliverables get a scratch workspace — produced files
      // submit as artifacts so "build me X" actually ships X for review
      // retained deliverable workspace — survives submit so the reviewer can
      // open a terminal here; the retention watch removes it on accept/close.
      // prepareScratchWorkspace decides fresh (first attempt) vs retain+rehydrate
      // (a review bounce: the prior submission's files ARE the starting point).
      const scratch = deliverablePath(t.number);
      const priorNote = await prepareScratchWorkspace(db, t.id, scratch);
      if (priorNote) log({ kind: 'exec', phase: 'started', summary: 'rework: prior deliverables restored to the workspace — editing, not redoing' });
      const attNote = (await stageTaskAttachments(db, t.id, scratch, false)) + (await stageApprovedDesigns(db, t.id, scratch, false)) + (await stageBrandContext(db, t.channel_id, scratch)) + (await stageConnections(db, t.channel_id)) + (t.kind === 'content' ? CONTENT_OUTPUT_CONTRACT : t.kind === 'research' ? RESEARCH_OUTPUT_CONTRACT : '') + planNote + priorNote;
      // the scratch branch is its own scope, so it builds its own fan-out closure over the
      // deliverable dir — same budget root, same ownership rules, different working directory
      const spawnLeg = spawnLegFor(agent, { workspace: ch.workspace_id, channelId: ch.id, taskId: t.id }, scratch, t, TURN_BUDGETS.work, log, 0);
      const parkTurn = parkFor(agent, t, ch);
      let run = await runCoding(adapter, agent, t, scratch, token, await blockFor(t.channel_id), false, log, skills, proposeSkill, reworkNotes, attNote, recordLesson, memoryNote, addBacklogItem, beatsFns, permissionGate, sandboxProtectedPaths, { spawn: spawnLeg, park: parkTurn, whiteboards: whiteboardClosures(actor, ch, { taskId: t.id }), draftReplies: replyDraft(actor, ch, { taskId: t.id }), searchX: searchXFor(actor, ch) });
      // the #1032 case: the summary WAS "waiting for the background research agents…" and it
      // got submitted as result.md. Retry in the SAME workspace so the work so far survives.
      if (!run.stopped && claimsPendingWork(run.note)) {
        log({ kind: 'exec', phase: 'held', summary: 'turn ended still waiting on background work — one nudge to finish here', level: 'warn' });
        run = await runCoding(adapter, agent, t, scratch, token, await blockFor(t.channel_id), false, log, skills, proposeSkill, [reworkNotes, FINISH_NOW_NOTE].filter(Boolean).join('\n\n'), attNote, recordLesson, memoryNote, addBacklogItem, beatsFns, permissionGate, sandboxProtectedPaths, { spawn: spawnLeg, park: parkTurn, whiteboards: whiteboardClosures(actor, ch, { taskId: t.id }) });
        if (!run.stopped && claimsPendingWork(run.note)) heldReason = run.note.replace(/\s+/g, ' ').trim().slice(0, 400);
      }
      const collected = await collectFiles(scratch); // salvage whether the run finished or was stopped
      files = contractDeliverables(collected.files, playbook); // a playbook run's report takes the contract name
      droppedEvidence.push(...collected.droppedImages);
      result = run.stopped ? stoppedNote : run.note;
      if (run.stopped && !files.length) throw new Error('stopped mid-run with no deliverable on disk');
      if (files.length) result = `Delivered ${files.length} file${files.length === 1 ? '' : 's'}: ${files.map((f) => f.name).join(', ')} — attached for review.\n\n${result}`;
      // Marketing content task: turn the marketer's posts.json into content_items ATTACHED to this
      // task, each rendering inline as a reviewable post card (marketing-workflow §4.5). content.create
      // is a DRAFT create, never the publish gate — the human approves + schedules each card.
      if (t.kind === 'content') {
        // §4.6: a drafted image brief becomes a real on-brand picture, generated here with the
        // machine's own provider key. No key → the drafts still land, carrying their briefs.
        const brand = await brandTokensFor(db, t.channel_id);
        const [wsRow] = await db.getAll<{ workspace_id: string }>('select workspace_id from channels where id = ?', [t.channel_id]).catch(() => [] as Array<{ workspace_id: string }>);
        // the room's designer commissions the picture — its seat, its provider
        const designer = [...agents.values()].find((a) => a.role === 'designer' && a.channels.has(t.channel_id));
        const { cred, note: credNote } = wsRow
          ? await designerImageCred(apiUrl, wsRow.workspace_id, designer, ownerActorId)
          : { cred: pickImageProvider(), note: undefined as string | undefined };
        // The marketer's sign-off seat: its own brain when that provider is the one holding the
        // key, else the catalog's marketer seat for whichever provider is (so the model id
        // tracks the pack instead of being hardcoded here).
        const reviewSeat = cred
          ? (providerFor(agent.runtime) === cred.provider ? agent.model : (PACKS[cred.provider === 'openai' ? 'openai-core' : 'gemini-core']?.roles.marketer ?? ''))
          : '';
        const reviewNotes: string[] = [];
        const drewOn = new Set<string>(); // which image model actually served this run
        const makeImage = cred
          ? async (p: DraftedPost) => {
              // the marketer owns the post, so it looks before the picture rides the draft — one
              // basics pass, one redraw at most; a picture it merely wouldn't have picked still ships
              const g = await generateBrandImage(cred, reviewSeat, brand, p.imageBrief ?? '', p.platform, agent.name);
              if (g.error) return { error: g.error };
              if (g.model) drewOn.add(g.model);
              if (g.reviewNote) reviewNotes.push(g.reviewNote);
              return { bytes: g.bytes, mime: g.mime, thumb: g.thumb, publish: g.publish };
            }
          : undefined;
        const out = await draftPostsFromWorkspace(scratch, { taskId: t.id, channelId: t.channel_id }, async (cmd) => {
          const r = await post('/v1/commands', { kind: 'agent', id: agent.id, role: agent.role }, cmd).catch(() => null);
          const j = r as { ok?: boolean; itemId?: string } | null;
          return j?.ok && j.itemId ? j.itemId : null;
        }, makeImage, async (itemId, dataUrl) => {
          const r = await post('/v1/commands', { kind: 'agent', id: agent.id, role: agent.role }, { type: 'content.attach_media', item: itemId, dataUrl }).catch(() => null);
          return !!(r && (r as { ok?: boolean }).ok);
        });
        const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
        const by = designer ? ` by ${designer.name}` : '';
        const on = drewOn.size ? ` (${[...drewOn].join(', ')})` : '';
        const imgNote = out.images ? ` with ${plural(out.images, 'on-brand image')}${by}${on}` : '';
        log({ kind: 'exec', phase: 'evidence', summary: `drafted ${plural(out.made, 'post')} → inline review cards${imgNote}` });
        if (out.made > 0) {
          const notes = [...out.notes, ...reviewNotes];
          if (credNote && out.images) notes.push(credNote);
          if (!cred && out.made) notes.push(`no image key on this workspace or machine, so the art direction stayed on paper — add an OpenAI or Gemini API key${designer ? ` (or move ${designer.name} to a seat on one of those)` : ''} and these become real images. A ChatGPT/Google subscription login carries no key.`);
          result = `Drafted ${plural(out.made, 'post')}${imgNote} — each is a review card in the thread, held for your approve. Nothing publishes yet.${notes.length ? `\n\n${notes.map((n) => `· ${n}`).join('\n')}` : ''}`;
        }
      }
    } else {
      // echo writes to the same retained workspace as the claude path, so
      // retention + the reviewer terminal are exercised hermetically
      const { mkdir, rm, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const ws = deliverablePath(t.number);
      await rm(ws, { recursive: true, force: true }).catch(() => {});
      await mkdir(ws, { recursive: true });
      if (t.kind === 'content') {
        // echo stands in for the marketer's model: emit the SAME posts.json contract a real
        // content run produces, so the producer path runs end to end without a model (dev-e2e).
        await writeFile(join(ws, 'posts.json'), `${JSON.stringify([
          { platform: 'x', body: `[echo] ${t.title} — draft 1. Subagents forget everything the moment a task ends. Your team shouldn't.` },
          { platform: 'x', body: `[echo] ${t.title} — draft 2. "Context window" is a euphemism for amnesia.` },
        ], null, 2)}\n`);
      } else {
        await writeFile(
          join(ws, 'index.html'),
          `<!doctype html><html><head><meta charset="utf-8"><title>#${t.number}</title></head><body style="font-family:system-ui;padding:24px"><h1>${t.title}</h1><p>echo-mode stub deliverable for #${t.number}.</p></body></html>\n`,
        );
      }
      result = `[echo · ${agent.name}] Executed #${t.number} “${t.title}”: stub result — validation note attached.`;
      files = (await collectFiles(ws)).files;
      if (t.kind === 'content') {
        // no image maker on this path by construction: echo mode never spends a provider dollar
        const { made } = await draftPostsFromWorkspace(ws, { taskId: t.id, channelId: t.channel_id }, async (cmd) => {
          const r = await post('/v1/commands', { kind: 'agent', id: agent.id, role: agent.role }, cmd).catch(() => null);
          const j = r as { ok?: boolean; itemId?: string } | null;
          return j?.ok && j.itemId ? j.itemId : null;
        });
        log({ kind: 'exec', phase: 'evidence', summary: `drafted ${made} post${made === 1 ? '' : 's'} → inline review cards` });
        if (made > 0) result = `Drafted ${made} post${made === 1 ? '' : 's'} — each is a review card in the thread, held for your approve. Nothing publishes yet.`;
      }
    }

    // stopped during the run (repo-less path, or after a salvaged repo run):
    // the task is already closed — halt cleanly without announcing or submitting
    if (stoppedTasks.has(t.id)) { stoppedTasks.delete(t.id); runEnd = 'stopped'; log({ kind: 'exec', phase: 'stopped', summary: `halted #${t.number} — stopped by a human`, level: 'warn' }); return; }
    // Enforced honesty (docs/29): the worker ended BOTH turns still waiting on work that does
    // not exist for it. Submitting that would put "I'm not finished" into review as the
    // deliverable — the #1032 bug. Block instead, with its own words as the reason, so a human
    // sees the truth and can re-offer. Any files it DID produce stay in the workspace for the
    // rework round (prepareScratchWorkspace restores them).
    if (heldReason) {
      const why = `ended its turn still waiting on background work that does not exist for a worker (its turn IS the execution), twice. Last words: “${heldReason}”. Nothing was submitted — re-offer #${t.number} to run it again.`;
      await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: `⚠️ Held #${t.number}: @${agent.name} ${why}` }).catch(() => {});
      await post('/v1/commands', actor, { type: 'task.block', taskId: t.id, reason: why.slice(0, 500) });
      log({ kind: 'exec', phase: 'error', summary: `blocked #${t.number} — unfinished turn, not submitted`, level: 'error' });
      return;
    }
    // non-Claude beats: the first-pass plan ran to completion — settle every beat done
    // before submit transitions the phase out of in_progress (a beat write needs ownership).
    for (let i = 0; i < coarsePlan.length; i++) await beatsFns.advance(i, 'done');
    // one seam for both paths: a truncated evidence attach is named in the submitted
    // summary, so a "missing screenshot" review bounce always has its cause in-thread
    result += evidenceDropNote(droppedEvidence, EVIDENCE_IMAGE_BUDGET);
    if (parent) {
      // subtask: the note narrates in the PARENT thread; deliverables attach to
      // the parent; the row finishes (done) instead of entering review
      await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: parent.id, body: `Subtask #${t.number} done — ${result}` });
      // the #1032 rule, mirrored (found live, round 3): the summary is ALREADY the
      // "Subtask #N done" message above — attaching it as a file too made the parent's
      // delivery strip show a fake deliverable next to the real report. It rides only
      // when the subtask produced no files, so the finish never lands empty-handed.
      const finish = await post('/v1/commands', actor, { type: 'task.finish_subtask', taskId: t.id, note: result.slice(0, 1900),
        artifacts: files.length ? files : [{ kind: 'doc', name: `subtask-${t.number}-result.md`, content: result }] });
      if (!finish.ok) throw new Error(`finish_subtask ${finish.status}: ${await finish.text()}`);
      console.log(`agent_finish_subtask agent=${agent.name} task=${t.number} parent=${parent.number} ok`);
      // a delivered report's acceptance card, in the SUBTASK'S own thread (leanunits.ts)
      await postSubtaskAcceptance(db, post, actor, t, parent.id, { id: ch.id, workspace_id: ch.workspace_id }, files, { complete: runtimeFor(agent.runtime).complete, model: agent.model, token }, playbook).catch(() => {});
      runEnd = 'done';
      log({ kind: 'exec', phase: 'submitted', summary: `finished subtask #${t.number} — deliverables on #${parent.number}${files.length ? ` · ${files.length} file(s)` : ''}` });
      return;
    }
    await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: result });
    // `result.md` is the summary we JUST posted as the message above — attaching it as a file
    // too made every delivery say itself twice (live #1032: three artifacts, two of them
    // result.md echoes). Attach it ONLY when the worker produced nothing else, because submit
    // requires at least one artifact and a summary beats an empty hand. A repo task's diff is a
    // real deliverable and always rides.
    const summaryArtifact = { kind: 'doc' as const, name: 'result.md', content: result };
    const artifacts = t.repo_id
      ? [{ kind: 'diff' as const, name: `nm-${t.number}.diff`, content: diffText }, ...files]
      : files.length
        ? files
        : [summaryArtifact];
    if (!t.repo_id && files.length) log({ kind: 'exec', phase: 'evidence', summary: `${files.length} deliverable file(s) attached — summary stays the message, not a result.md echo` });
    // ── A PARKED turn does NOT submit (docs/harness/05 §3.8) ──────────────────────────────
    // The turn ended; the WORK has not. Submitting here would put unfinished work into review, so
    // the park is honoured instead: the run settles `parked` (open, not terminal — every client keeps
    // painting a live ring), the claim is released so the sweep can re-admit, and the task stays in
    // `in_progress` exactly where it was. The FSM is untouched — park is a run state, never a task one.
    const parked = parkRequests.get(t.id);
    if (parked) {
      parkRequests.delete(t.id);
      parkBook.park(parked);
      await workRun.settle('parked' as RunTerminal, parkStepLine(parked));
      await post('/v1/messages', actor, {
        workspace: ch.workspace_id, channel: ch.id, taskId: t.id,
        body: `⏸️ Parked — ${parkStepLine(parked)}. Nothing is running and nothing is being spent; I pick this up the moment it resolves.`,
      }).catch(() => {});
      log({ kind: 'exec', phase: 'held', summary: `parked — ${parkStepLine(parked)} (no submit)` });
      claimed.delete(t.id); // the sweep re-admits when the wake condition fires
      setStatus(agent, 'online');
      return;
    }
    if (!parent && leanPlan) {
      await finishLeanUnit(db, post, actor, t, { id: ch.id, workspace_id: ch.workspace_id }, agent.name, result, artifacts, files.length, log, { complete: runtimeFor(agent.runtime).complete, model: agent.model, token }, playbook);
      runEnd = 'done';
      return;
    }
    const submit = await post('/v1/commands', actor, {
      type: 'task.submit',
      taskId: t.id,
      artifacts,
      ...(sha ? { sha } : {}),
      ...(prUrl ? { prUrl } : {}),
      ...(prNumber ? { prNumber } : {}),
    });
    if (!submit.ok) throw new Error(`submit ${submit.status}: ${await submit.text()}`);
    console.log(`agent_submit agent=${agent.name} task=${t.number} mode=${mode}${sha ? ` sha=${sha.slice(0, 7)}` : ''} ok`);
    runEnd = 'done';
    log({ kind: 'exec', phase: 'submitted', summary: `submitted #${t.number} for review${sha ? ` @ ${sha.slice(0, 7)}` : ''}${files.length ? ` · ${files.length} file(s)` : ''}` });
  } catch (err) {
    // a stop aborts mid-run (the worktree callback throws __stopped__, or the
    // adapter throws on the aborted signal) — that's a clean halt, not a wall
    if (stoppedTasks.has(t.id) || (err instanceof Error && err.message === '__stopped__')) {
      stoppedTasks.delete(t.id);
      runEnd = 'stopped';
      log({ kind: 'exec', phase: 'stopped', summary: `halted #${t.number} — stopped by a human`, level: 'warn' });
      return;
    }
    console.error(`agent_submit agent=${agent.name} task=${t.number} failed:`, err);
    // classify on the FULL message (not the truncated reason) so a usage cap / refusal phrase
    // isn't sliced off before it's seen (docs/22 §9).
    const fullReason = err instanceof Error ? err.message : 'unknown error';
    const reason = fullReason.slice(0, 200);
    const foClass = classifyExecError(fullReason);
    log({ kind: 'exec', phase: 'wall', summary: `hit a wall: ${reason}`, level: 'error' });
    // non-Claude beats: the plan run hit a wall — mark its in-flight beat blocked (before any
    // task.block transition) so the tracker stops pulsing; a retry declares a fresh set.
    if (coarsePlan.length) await beatsFns.advance(0, 'blocked');
    // Capacity failover: a usage cap surfaces the human-confirmed re-seat card and PARKS the task —
    // retrying the capped model just re-walls. A refusal repeats on retry too, so hand it to a human
    // rather than burning the retry budget. Everything else → the normal retry-then-block path below.
    if (foClass === 'exhausted') { await handleExhaustion(agent, t, ch).catch((e) => console.error('failover_exhaust', e)); return; }
    if (foClass === 'refusal') {
      await post('/v1/commands', actor, { type: 'task.block', taskId: t.id, reason: `@${agent.name} declined this task — a decline repeats on retry, so it needs a human.` }).catch(() => {});
      await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: `Stopped #${t.number}: @${agent.name} declined this task. It won't pass on retry — reassign, rescope, or close it.` }).catch(() => {});
      return;
    }
    // A wall must never strand the task: the old path left it in_progress AND in the
    // in-flight guard, so the retry-then-block budget only ran after an app relaunch —
    // a silent zombie the human discovered hours later. Decide the budget HERE
    // (execpolicy — pure, tested): this failure + the replicated wall trail →
    // retry in-session, or block with the reason so the board and Mission
    // Control's needs-you surface it.
    const [wc] = await db.getAll<{ n: number }>(
      // walls SINCE THE LAST UNBLOCK — an all-time count made the budget a latch that no
      // human action could reset, so Unblock put the task straight back into blocked
      `select count(*) as n from messages where task_id = ? and author_kind = 'agent' and body like 'Execution hit a wall%'
         and created_at > coalesce((select max(created_at) from messages m2 where m2.task_id = ? and m2.body like ? ), '')`,
      [t.id, t.id, `${UNBLOCK_MARKER}%`],
    ).catch(() => [{ n: 0 }]);
    const outcome = planWallOutcome({ reason, priorWalls: Number(wc?.n ?? 0), blockAfter: EXEC_FAIL_BLOCK_AFTER, taskNumber: t.number, agentName: agent.name });
    const say = (body: string) => post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body }).catch(() => {});
    await say(outcome.wallNote);
    if (outcome.action === 'block') {
      const blk = await post('/v1/commands', actor, { type: 'task.block', taskId: t.id, reason: outcome.blockReason }).catch(() => null);
      await say(outcome.blockNote);
      console.warn(`agent_exec agent=${agent.name} task=${t.number} auto-blocked: ${outcome.blockReason} (block ${blk ? blk.status : 'offline'})`);
    } else {
      // release the in-flight guard and re-enter through resumeFlow after the wall
      // message replicates (its budget + attempt numbering read the replica). The
      // relaunch resume watch stays the backstop if this process dies first.
      claimed.delete(t.id);
      setTimeout(() => {
        if (claimed.has(t.id)) return; // another watch already picked it up
        claimed.add(t.id);
        execQueue.run({ key: t.id, kind: 'work', cause: 'board', agentId: agent.id, subject: { kind: 'task', number: t.number } }, () => resumeFlow(agent, { ...t, requirements_confirmed: 1 }));
      }, 4000);
    }
  } finally {
    // settle the run on EVERY exit path — a `running` row that outlives its work is the
    // exact lie docs/29 exists to end (and the watchdog would read it as live forever).
    await workRun.settle(runEnd).catch(() => {});
    setStatus(agent, 'online');
  }
}

// reviewer pool: reviewer-role agents on this machine pick up in_review tasks
// in their channels. First approve wins; the server blocks self-review and
// non-reviewers regardless of what happens here.
db.watch(
  `select id, number, title, channel_id, assignee_id from tasks where state = 'in_review'`,
  [],
  {
    onResult: (r) => {
      for (const t of (r.rows?._array ?? []) as Array<{ id: string; number: number; title: string; channel_id: string; assignee_id: string | null }>) {
        if (reviewed.has(t.id)) continue;
        const reviewer = [...agents.values()].find(
          (a) => a.role === 'reviewer' && a.channels.has(t.channel_id) && a.id !== t.assignee_id,
        );
        if (!reviewer) continue;
        reviewed.add(t.id);
        // a review is a runtime turn like any other — it queues for a slot (docs/harness/05).
        // Keyed `review:<taskId>` so it cannot collide with the exec key for the same task.
        execQueue.run({ key: `review:${t.id}`, kind: 'review', cause: 'board', agentId: reviewer.id, subject: { kind: 'task', number: t.number } }, () => reviewFlow(reviewer, t));
      }
    },
    onError: () => {},
  },
);

  return { architectFlow, blockFor, checklistFor, claimFlow, curatorImport, designerFlow, estimateFor, executeFlow, offerPlanToWorker, orchDesignNotify, orchPlanDecision, ownFlow, ownerHandle, owningContext, refreshChannelBlock, releaseDocsNote, remoteDelegate, resumeFlow, reviewFlow, shipperFlow, sleepTimeTick, walkSkillMd };
}
