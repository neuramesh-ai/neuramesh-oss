// CLAIMING AND OWNING — how a task reaches a machine: the voluntary claim, the orchestrator
// taking it itself, the remote A2A delegate, and the checklist/estimate a claim resolves.
// Split out of host/flows.ts.
import { conversationOrigin, onCloudMachine, starterDoorOpen, starterFallback, unavailableOf, whyUnavailable } from './starterfallback';
import { noComputeReasonOf } from '../computenotice';
import { providerFor } from '../runtime/adapter';
import { ghRaw } from './gh';
import type { UnitBirth } from './lookups';

/** units this host already offered the Starter switch for — one card per unit, never one per poll */
const offered = new Set<string>();
import { resolveToken } from '../agents';
import type { ExecTask, HostedAgent, OfferedTask, SkillRef } from '../agents';


import { isCloudBorn, type ClaimVerdict, type SessionOrigin } from '@neuramesh/shared';





import { type SubjectRef } from '../harness/brain';












import { type LogFn } from '../agentlog';


import type { makeFlows } from './flows';
import { STATIC_CHECKLIST, workspaceFor } from './flows';
import type { HostCtx } from './ctx';
import type { PowerSyncDatabase } from '@powersync/node';
import type { Brain } from '../harness/brain';
import type { AgentAttachment } from '../runtime/adapter';
import type { HostQueue } from '../harness/hostqueue';
import type { ParkBook } from '../harness/park';
import type { WhiteboardToolClosures } from '../harness/toolbus';
import type { makeRuns, RunHandle } from './runs';
import type { makeSleeperWake } from './sleepers';
import type { makeBeats } from './beats';
import type { makePark } from './park';
import { makeClaimResolve } from './claim-resolve';
import { makeClaimOwn } from './claim-own';




/**
* The orchestrator ADVANCING a task it owns (docs/29 §4d) — the owning flow.
*
* Where `claimFlow` hands a task to a worker that builds it, this is rex taking the work itself:
* it claims, decides which phase the task is in, fans out the subagents that phase needs, and
* answers for what they produce. It must never drop into `executeFlow` — an owner decides and
* delegates; the moment it starts coding it has stopped orchestrating.
*
* **Ownership is durable; execution is per-turn.** A build spans days and several human gates, and
* a subagent cannot outlive the turn that spawned it (`sliceBudget` carves from the parent's
* remainder). So this runs ONCE PER PHASE: it advances what it can, ends, and is re-woken when the
* gate it is waiting on resolves. What makes that survivable is the subject brain — `owningContext`
* below rebuilds what earlier turns established, so a re-woken owner continues rather than restarts.
*/
// Only what the owning flow reads — so BOTH entry points fit: the offer watch (an OfferedTask)
// and the resume watch (an ExecTask carrying its assignee). Narrowing the parameter to the fields
// used beats widening either row shape to satisfy the other.
export type OwnedTask = { id: string; number: number; title: string; channel_id: string; requirements?: string | null };
/** what the ladder needs of a unit before any claim: an offer, an owned unit, a plan row alike */
export type AdmitTask = OwnedTask & Partial<Pick<OfferedTask, 'creator_kind' | 'creator_id'>>;

export function makeClaimFlow(ctx: HostCtx & {
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
  claimVerdict: (runtime: string, model: string | null, originUserId: string | null, elapsedMs: number, extra?: { agentId?: string; priorMachineId?: string | null; threadMachineId?: string | null; origin?: SessionOrigin | null }) => Promise<ClaimVerdict>;
  discoverSkills: (channelId: string, workspaceId: string) => Promise<SkillRef[]>;
  handleExhaustion: (agent: HostedAgent, t: ExecTask | null, ch: { id: string; slug: string; workspace_id: string }) => Promise<void>;
  legSummary: (out: string) => string;
  mineLessons: (reviewer: HostedAgent, t: { id: string; number: number; title: string }, ch: { id: string; slug: string; workspace_id: string }, token: string, live: boolean, log?: LogFn) => Promise<void>;
  orchestratorTurn: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, transcript: string, token: string, thread?: { id: string; number: number; title: string; state: string }, log?: LogFn, skills?: SkillRef[], attachments?: AgentAttachment[], convoThreadId?: string | null, run?: RunHandle, onDelta?: (t: string) => void) => Promise<string>;
  originOf: (t: Pick<OfferedTask, 'creator_kind' | 'creator_id'>) => string | null;
  priorMachineFor: (threadId?: string | null, taskId?: string | null) => Promise<string | null>;
  requestSleeperWake: ReturnType<typeof makeSleeperWake>['requestSleeperWake'];
  nobodyServes: ReturnType<typeof makeSleeperWake>['nobodyServes'];
  readOnlyStudy: (agent: HostedAgent, dir: string, token: string, log?: LogFn) => ((system: string, user: string) => Promise<string>) | null;
  seatFor: (agent: HostedAgent, channelId: string, scope?: { threadId?: string | null; taskId?: string | null }) => Promise<HostedAgent>;
  setStatus: (agent: HostedAgent, status: 'online' | 'thinking' | 'working') => void;
  sinceFirstSeen: (key: string) => number;
  spawnLegFor: (parent: HostedAgent, where: { workspace: string; channelId: string; taskId?: string | null; threadId?: string | null }, dir: string, task: ExecTask, budget: { wallMs: number; contextTokens: number }, log: LogFn | undefined, _depth: number) => (i: { role: string; prompt: string; label?: string }) => Promise<{ ok: boolean; summary?: string; error?: string }>;
  taskRecallNote: (workspaceId: string, query: string, lessonsNote: string) => Promise<string>;
  /** the owning conversation's origin and designation (host/lookups.ts): a unit runs where it runs */
  unitBirth: (taskId: string) => Promise<UnitBirth>;
  whiteboardClosures: (actor: { kind: string; id: string; role?: string }, ch: { id: string; workspace_id: string }, at: { taskId?: string; threadId?: string }) => WhiteboardToolClosures;
  executeFlow: ReturnType<typeof makeFlows>['executeFlow'];
}) {
const { db, apiUrl, workspace, ownerActorId, post, claimed, execQueue,
        
        alog, claimVerdict, 
        originOf, priorMachineFor, requestSleeperWake, nobodyServes,
        sinceFirstSeen, executeFlow, unitBirth } = ctx;
// The guard registry's fields keep their short names, exactly as they read inside startAgentHost.
const { claimFailNoticed, 
 } = ctx.guards;

  // Split-out neighbours: same ctx, so every call below keeps the name it always used.
  const { estimateFor, checklistFor } = makeClaimResolve(ctx);
  const { ownFlow, owningContext, remoteDelegate } = makeClaimOwn(ctx, { admitUnit });

/**
 * THE LADDER BEFORE ANY CLAIM, for claimFlow and ownFlow alike (2026-09-19: an OWNED unit raced
 * `task.claim` with no ladder at all, and the runner, when it won, blocked it for want of a
 * credential). The seat the turn will take is what the ladder judges (2026-09-16, the Starter
 * worker lane: a unit in a conversation switched to the Starter brain is servable by any awake
 * machine, whatever login the agent's base runtime would need). Resolves to true when this host
 * proceeds to the claim, false when it stands down: a better-placed machine is given the window,
 * a sleeper is asked, or the claim door re-seats the unit and `again` runs it on the new seat.
 */
async function admitUnit<T extends AdmitTask>(agent: HostedAgent, t: T, kind: 'work' | 'own', again: (seat: HostedAgent, t: T) => Promise<void>): Promise<boolean> {
  const actor = { kind: 'agent', id: agent.id, role: agent.role };
  const seat = await ctx.seatFor(agent, t.channel_id, { taskId: t.id });
  // A UNIT RUNS WHERE ITS CONVERSATION RUNS (George, 2026-09-19): the owning conversation's origin
  // and designation go to the ladder exactly as a chat wake's do (wakerouting.ts), so a unit born
  // of a web, phone or routine session claims on the cloud machine (rung 0), whatever brain it
  // holds. Before this the claim passed no origin: rung 0 never fired, capability decided, and
  // the member's laptop took the units of a conversation the cloud machine had just answered.
  // The origin MEMBER is the conversation's human for a cloud-born unit (the orchestrator files
  // it, so the creator is an agent), which keeps the member's own cloud machine ahead of the
  // runner; every other unit keeps its creator, as before.
  const birth = await unitBirth(t.id);
  const originUser = isCloudBorn(birth.origin) ? (originOf(t) ?? await conversationOrigin({ taskId: t.id })) : originOf(t);
  const verdict = await claimVerdict(seat.runtime, seat.model ?? null, originUser, sinceFirstSeen(t.id), { agentId: agent.id, priorMachineId: await priorMachineFor(null, t.id), threadMachineId: birth.machineId, origin: birth.origin });
  if (verdict.act === 'skip') {
    // THE SLEEPER RUNG (member-machines plan §4.3): this host cannot run the runtime, but a lent
    // cloud machine that can may be asleep — ask the fleet, then stand down; the offer waits
    if (verdict.why !== 'incapable') return false;
    const sleeper = await requestSleeperWake({ runtime: seat.runtime, model: seat.model ?? null, originUserId: originOf(t), workspace, actor }).catch(() => null);
    // THE STARTER DOOR for a seat NOBODY can serve (host/starterfallback.ts, 2026-09-17): no sleeper
    // to wake, no awake machine that could — the origin member's own machine speaks, once per unit.
    // A routine's unit is re-seated on the house model (any awake machine serves it) and the offer is
    // evaluated again; a human's unit gets the reason and the card in its thread, and is looked at
    // again each minute so the click is acted on without a restart. Before this, such a unit sat
    // unclaimed and silent until the stall watchdog noticed.
    // a unit the orchestrator created has no human creator, but its CONVERSATION does (a routine's
    // opener is the owner's word) — that member's machine is the one that speaks
    const origin = originOf(t) ?? await conversationOrigin({ taskId: t.id });
    const nobody = await nobodyServes({ runtime: seat.runtime, model: seat.model ?? null, originUserId: origin });
    // said out loud, like wake_skip: a unit nobody can serve is the exact silence this door exists to end
    console.log(`agent_claim_door agent=${agent.name} task=${t.number} seat=${seat.model}/${seat.runtime} sleeper=${sleeper ? 'asked' : 'none'} origin=${origin ? (origin === ownerActorId ? 'mine' : 'other') : 'none'} nobody=${nobody} door=${starterDoorOpen()} offered=${offered.has(t.id)}`);
    if (sleeper || !origin || origin !== ownerActorId || !starterDoorOpen() || !nobody) return false;
    if (!offered.has(t.id)) {
      offered.add(t.id);
      const probe = await resolveToken(apiUrl, workspace, seat, ownerActorId).catch(() => null);
      const next = await starterFallback(seat, { kind: 'nocompute', provider: providerFor(seat.runtime), reason: noComputeReasonOf(probe) }, { workspace, channelId: t.channel_id, taskId: t.id, taskNumber: t.number });
      // the offer watch fires on TASK rows and the re-seat touched none: the re-seated unit is
      // claimed right here, through the same flow, on the seat it now has
      if (next) { await again(next, t); return false; }
    }
    // still offered, still unservable: looked at again in a minute (the click on the card touches
    // no task row either), until the seat moves or a machine that can serve it comes online. The
    // sleeper memo keeps the fleet ask to one per five minutes.
    setTimeout(() => {
      claimed.delete(t.id); claimed.add(t.id);
      execQueue.run({ key: t.id, kind, cause: 'board', agentId: agent.id, subject: { kind: 'task', number: t.number } }, () => again(agent, t));
    }, 60_000);
    return false;
  }
  if (verdict.act === 'wait') {
    // re-ask rather than drop: a wedged origin machine must be a delay, never a black hole
    setTimeout(() => { claimed.delete(t.id); }, verdict.retryInMs);
    return false;
  }
  return true;
}

async function claimFlow(agent: HostedAgent, t: OfferedTask) {
  const actor = { kind: 'agent', id: agent.id, role: agent.role };
  try {
    // Shared compute (0114): every member machine in this workspace sees this offer now, so
    // decide whether it is OURS to take before racing for it. The origin member's own machine
    // gets first refusal; we step in only if it cannot serve, or if it has not within the
    // grace window. The server's atomic claim below is still the thing that makes exactly one
    // host win — this only stops the pointless attempts (and, on a wake, the pointless spend).
    if (!(await admitUnit(agent, t, 'work', claimFlow))) return;

    const claim = await post('/v1/commands', actor, { type: 'task.claim', taskId: t.id });
    if (claim.status === 409) return; // someone else won — offers are voluntary
    if (!claim.ok) throw new Error(`claim ${claim.status}: ${await claim.text()}`);

    // A repo-backed unit needs a push credential, and a cloud machine carries none until its
    // owner signs in through the machine's terminal (docs/42). Said at the claim, with the fix,
    // rather than at the push, where it read as a raw git error. Asked live, not memoized: the
    // login lands while the daemon runs. A laptop keeps its own git remotes and SSH keys: no gate.
    if (t.repo_id && onCloudMachine() && !(await ghRaw(['auth', 'status']).then((r) => r.ok).catch(() => false))) {
      await post('/v1/commands', actor, { type: 'task.block', taskId: t.id, reason: `This cloud machine has no GitHub login, so it cannot push a branch for #${t.number}. Open the machine's terminal and run \`gh auth login\`, then unblock #${t.number}.` }).catch((e) => console.error(`task_block #${t.number} failed:`, e));
      console.log(`agent_claim agent=${agent.name} task=${t.number} blocked=no_gh_login_on_cloud`);
      return;
    }

    const ch = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [t.channel_id]);
    let cred = await resolveToken(apiUrl, ch.workspace_id, agent, ownerActorId);
    // the seat cannot run → the Starter door (host/starterfallback.ts): a routine's unit re-seats
    // and runs; a human's gets the reason and the card, and the just-claimed task blocks until they act
    const gap = unavailableOf(cred, agent.runtime);
    if (gap) {
      const next = await starterFallback(agent, gap, { workspace: ch.workspace_id, channelId: ch.id, taskId: t.id, taskNumber: t.number });
      if (!next) {
        await post('/v1/commands', actor, { type: 'task.block', taskId: t.id, reason: `@${agent.name} cannot run here. ${whyUnavailable(gap, agent.runtime)} Sign in again, or switch this conversation to the NeuraMesh brain, then re-offer #${t.number}.` }).catch((e) => console.error(`task_block #${t.number} failed:`, e));
        console.log(`agent_claim agent=${agent.name} task=${t.number} unavailable=${gap.kind}`);
        return;
      }
      agent = next; cred = await resolveToken(apiUrl, ch.workspace_id, agent, ownerActorId);
    }
    const token = cred.token ?? ''; // apikey → the key; subscription → '' (providerEnv strips keys)
    const live = process.env['NM_AGENT_MODE'] !== 'echo' && cred.authMode !== 'none';
    const preConfirmed = Number(t.requirements_confirmed) === 1;
    let checklist: string[];
    if (preConfirmed) {
      // intake already resolved these in the thread — run them, don't invent
      try { checklist = JSON.parse(t.requirements ?? '[]') as string[]; } catch { checklist = []; }
      if (!checklist.length) checklist = STATIC_CHECKLIST;
    } else {
      checklist = live ? await checklistFor(agent, t, token) : STATIC_CHECKLIST;
      const conf = await post('/v1/commands', actor, { type: 'task.confirm_requirements', taskId: t.id, checklist });
      if (!conf.ok) throw new Error(`confirm ${conf.status}`);
    }
    const estimate = await estimateFor(agent, t, token, live, checklist);
    await post('/v1/messages', actor, {
      workspace: ch.workspace_id,
      channel: ch.id,
      taskId: t.id,
      body: `Claimed #${t.number} “${t.title}”.
- **Checklist${preConfirmed ? ' (intake-resolved)' : ' (confirmed)'}:** ${checklist.join(' · ')}
- **Estimate:** ${estimate}
- **Workspace:** ${workspaceFor(t)}

Starting now — the live run on this task shows what I'm doing; I'll post here when there's something to say.`,
    });
    console.log(`agent_claim agent=${agent.name} task=${t.number} ok`);
    alog(agent, t, ch.slug)({ kind: 'lifecycle', phase: 'claimed', summary: `claimed #${t.number} "${t.title}" — ${preConfirmed ? 'intake-resolved' : 'confirmed'} checklist` });
    await executeFlow(agent, t, ch); // never throws — reports its own failures
  } catch (err) {
    claimed.delete(t.id);
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`agent_claim agent=${agent.name} task=${t.number} failed:`, err);
    // Never let a failed pickup be silent — otherwise the human just sees the agent go quiet while the
    // offered task sits (e.g. a denied claim that keeps retrying). Log it + post ONE note to the thread
    // (deduped so the retrying offer-watch doesn't spam) so it's visible and actionable.
    if (!claimFailNoticed.has(t.id)) {
      claimFailNoticed.add(t.id);
      const ch = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [t.channel_id]).catch(() => null);
      alog(agent, t, ch?.slug ?? null)({ kind: 'result', phase: 'error', summary: `couldn't claim #${t.number}: ${reason.slice(0, 180)}`, level: 'error' });
      if (ch) {
        await post('/v1/messages', actor, {
          workspace: ch.workspace_id, channel: ch.id, taskId: t.id,
          body: `⚠️ @${agent.name} couldn't pick up #${t.number} — ${reason.slice(0, 180)}. The offer is still open; re-offer it or check my activity log.`,
        }).catch(() => {});
      }
    }
  }
}


  return { estimateFor, checklistFor, claimFlow, ownFlow, owningContext, remoteDelegate };
}
