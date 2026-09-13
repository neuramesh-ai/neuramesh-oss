// TRIAGE AND DISPATCH — routing a task to the architect or the designer, surfacing the
// staffing gap when nobody in the room fits, and the board reconcile that re-derives what
// should be running. Extracted from agents.ts (track B2).
import { DESIGN_PROVIDER_QUESTION, designProviderQuestionBlock } from '@neuramesh/shared';
import type { DesignTask, ExecTask, HostedAgent, PlanTask } from '../agents';
import { buildPlanningArchitectCard } from '../hirecards';

import type { PowerSyncDatabase } from '@powersync/node';

import type { HostQueue } from '../harness/hostqueue';

import type { DesignProvider } from '@neuramesh/shared';




import type { makeFlows } from './flows';
import type { makePlanFlow } from './planflow';
import type { makeDesignFlow } from './designflow';
import type { makeClaimFlow } from './claimflow';


import type { HostCtx } from './ctx';

export function makeDispatch(ctx: HostCtx & {
  agents: Map<string, HostedAgent>;
  architectFlow: ReturnType<typeof makePlanFlow>['architectFlow'];
  claimed: { has: (id: string) => boolean; add: (id: string) => unknown; delete: (id: string) => boolean };
  db: PowerSyncDatabase;
  designProviderFor: (taskId: string) => Promise<{ provider: DesignProvider; runKey: string } | null>;
  designerFlow: ReturnType<typeof makeDesignFlow>['designerFlow'];
  execQueue: HostQueue;
  orchDesignNotify: ReturnType<typeof makeDesignFlow>['orchDesignNotify'];
  orchPlanDecision: ReturnType<typeof makePlanFlow>['orchPlanDecision'];
  ownFlow: ReturnType<typeof makeClaimFlow>['ownFlow'];
  post: unknown;
  resumeFlow: ReturnType<typeof makeFlows>['resumeFlow'];
  setStatus: (agent: HostedAgent, status: 'online' | 'thinking' | 'working') => void;
  workspace: string;
}) {
const { agents, architectFlow, claimed, db, designProviderFor, designerFlow, execQueue, orchDesignNotify, orchPlanDecision, ownFlow, post, resumeFlow, setStatus } = ctx;
const { decided , designAsked, designNotified, designQuestionRetries, designed, planned, planningStaffingNotified } = ctx.guards;

// A design approval can enter planning without an architect because the human
// gate cannot assign a role that is absent from the room. Never silently park
// that task: Rex asks to add an existing workspace architect, or—only when none
// exists—asks permission to hire one. The nmq message is task-linked, so it also
// becomes a durable decision + desktop notification when the user is elsewhere.
async function surfacePlanningStaffing(t: PlanTask) {
  if (planningStaffingNotified.has(t.id)) return;
  planningStaffingNotified.add(t.id);
  try {
    const ch = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [t.channel_id]);
    // An architect hosted on another machine may already own this room. Their
    // host will run the board watcher; this host must not emit a false staffing card.
    const inRoom = await db.get<{ id: string }>(
      `select a.id from agents a join agent_channels ac on ac.agent_id = a.id
        where ac.channel_id = ? and a.role = 'architect' and a.retired_at is null limit 1`,
      [ch.id],
    ).catch(() => null);
    if (inRoom) return;
    const orch = [...agents.values()].find((a) => a.role === 'orchestrator' && a.channels.has(ch.id));
    if (!orch) { planningStaffingNotified.delete(t.id); return; }
    const marker = `Planning handoff for #${t.number}`;
    const alreadyPosted = await db.get<{ id: string }>(
      `select id from messages where task_id = ? and author_kind = 'agent' and body like ? limit 1`,
      [t.id, `%${marker}%`],
    ).catch(() => null);
    if (alreadyPosted) return;
    const workspaceArchitect = await db.get<{ name: string }>(
      `select a.name from agents a
        where a.workspace_id = ? and a.role = 'architect' and a.retired_at is null
          and a.id not in (select agent_id from agent_channels where channel_id = ?)
        order by a.name limit 1`,
      [ch.workspace_id, ch.id],
    ).catch(() => null);
    const names = await db.getAll<{ name: string }>(
      `select name from agents where workspace_id = ? order by name`, [ch.workspace_id],
    ).catch(() => [] as Array<{ name: string }>);
    const used = new Set(names.map((row) => row.name.toLowerCase()));
    let hireName = 'atlas';
    for (let n = 2; used.has(hireName); n += 1) hireName = `atlas-${n}`;
    const body = buildPlanningArchitectCard({
      chanSlug: ch.slug,
      taskNumber: t.number,
      existingArchitect: workspaceArchitect?.name ?? null,
      hireName,
    });
    const res = await post('/v1/messages', { kind: 'agent', id: orch.id, role: 'orchestrator' }, {
      workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body,
    });
    if (!res.ok) throw new Error(`planning staffing message ${res.status}`);
    console.warn(`planning #${t.number}: no architect in #${ch.slug} — surfaced ${workspaceArchitect ? `add @${workspaceArchitect.name}` : `hire @${hireName}`} decision`);
  } catch (err) {
    planningStaffingNotified.delete(t.id);
    console.error(`planning staffing #${t.number} failed:`, err);
  }
}
function dispatchPlanning(t: PlanTask) {
  if (planned.has(t.id)) return;
  // An OWNED task runs its own planning phase (docs/29 §4d): rex holds it, so rex decides how the
  // plan gets drafted — usually by spawning an architect subagent. Handing it to the seated
  // architect here would take the task away from its owner mid-flow, which is the delegation this
  // model replaced. Without this branch an owned task entering `planning` sat there: the owner was
  // not woken, and the architect could not claim what it did not hold.
  const owner = t.assignee_id ? agents.get(t.assignee_id) : undefined;
  if (owner?.role === 'orchestrator') {
    planned.add(t.id);
    execQueue.run({ key: `plan:${t.id}`, kind: 'own', cause: 'board', agentId: owner.id, subject: { kind: 'task', number: t.number } }, () => ownFlow(owner, t));
    return;
  }
  const arch = [...agents.values()].find((a) => a.role === 'architect' && a.channels.has(t.channel_id));
  if (!arch) { void surfacePlanningStaffing(t); return; }
  planned.add(t.id);
  execQueue.run({ key: `plan:${t.id}`, kind: 'plan', cause: 'board', agentId: arch.id, subject: { kind: 'task', number: t.number } }, () => architectFlow(arch, t));
}
// designer: a task routed into `designing` (the orchestrator triaged it as
// user-facing) gets mockups drafted from a study of the repo's design system,
// then proposed (designing -> design_review). Board-driven, mirroring the
// architect watch — no orchestrator↔designer chat.
function retryDesignQuestion(des: HostedAgent, t: DesignTask) {
  designAsked.delete(t.id);
  const attempt = (designQuestionRetries.get(t.id) ?? 0) + 1;
  if (attempt > 3) { designQuestionRetries.delete(t.id); return; }
  designQuestionRetries.set(t.id, attempt);
  setTimeout(() => void dispatchDesigner(des, t), 1_000 * 2 ** (attempt - 1));
}
async function dispatchDesigner(des: HostedAgent, t: DesignTask) {
  // An open provider card is the durable pause signal. It survives app
  // restarts and prevents decision/message sync from self-triggering retries.
  const awaitingChoice = await db.get<{ id: string }>(
    "select id from decisions where task_id = ? and question = ? and status = 'open' order by created_at desc limit 1",
    [t.id, DESIGN_PROVIDER_QUESTION],
  ).catch(() => null);
  if (awaitingChoice) return;
  const selection = await designProviderFor(t.id);
  if (!selection) {
    if (designAsked.has(t.id)) return;
    designAsked.add(t.id);
    const ch = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [t.channel_id]).catch(() => null);
    if (!ch) { retryDesignQuestion(des, t); return; }
    const alreadyAsked = await db.get<{ id: string }>(
      "select id from messages where task_id = ? and author_kind = 'agent' and body like ? limit 1",
      [t.id, `%${DESIGN_PROVIDER_QUESTION}%`],
    ).catch(() => null);
    if (!alreadyAsked) {
      try {
        const res = await post('/v1/messages', { kind: 'agent', id: des.id, role: 'designer' }, {
          workspace: ch.workspace_id,
          channel: ch.id,
          taskId: t.id,
          // NOT "I've picked up" (George, live 2026-08-11): the orchestrator OWNS the design
          // phase and brings designers in as subagents (docs/14, the contract's option 4) — a
          // designer announcing pickup contradicts the ownership the thread then shows, and
          // reads as the task having been handed off. It is drafting a ROUND, not owning a task.
          body: `${des.name} here — I'm drafting the design round for #${t.number}. Choose where I should draft it; either route comes back here for your approval before anything is built.\n\n${designProviderQuestionBlock()}`,
        });
        if (!res.ok) throw new Error(`provider question ${res.status}`);
      } catch (err) {
        retryDesignQuestion(des, t);
        console.error(`design provider question #${t.number} failed:`, err);
        return;
      }
    }
    designQuestionRetries.delete(t.id);
    setStatus(des, 'online');
    return;
  }
  if (designed.get(t.id) === selection.runKey) return;
  designAsked.delete(t.id);
  designQuestionRetries.delete(t.id);
  designed.set(t.id, selection.runKey);
  execQueue.run({ key: `design:${t.id}`, kind: 'design', cause: 'board', agentId: des.id, subject: { kind: 'task', number: t.number } }, () => designerFlow(des, t, selection.provider));
}
// Re-evaluate board-driven pending work against the CURRENT roster. The planning / plan_review
// watches fire once on boot; if the agents Map wasn't populated yet (the roster syncs on a separate
// watch), a task waiting in those states is skipped and — since its result set never changes — is
// never retried, stranding it (the "architect picked it up but nothing happens after a restart" trap).
// Running this whenever the roster (re)loads closes that boot race and any later agent-join.
async function reconcileBoard() {
  const designRows = await db.getAll<DesignTask>(`select id, number, title, description, channel_id, requirements, repo_id, base_ref, updated_at, assignee_id from tasks where state = 'designing'`).catch(() => [] as DesignTask[]);
  for (const t of designRows) {
    const des = [...agents.values()].find((a) => a.role === 'designer' && a.channels.has(t.channel_id));
    if (!des) continue;
    void dispatchDesigner(des, t);
  }
  const designReviewRows = await db.getAll<PlanTask>(`select id, number, title, description, channel_id, requirements from tasks where state = 'design_review'`).catch(() => [] as PlanTask[]);
  for (const t of designReviewRows) {
    if (designNotified.has(t.id)) continue;
    const orch = [...agents.values()].find((a) => a.role === 'orchestrator' && a.channels.has(t.channel_id));
    if (!orch) continue;
    designNotified.add(t.id);
    void orchDesignNotify(orch, t);
  }
  const planningRows = await db.getAll<PlanTask>(`select id, number, title, description, channel_id, requirements, repo_id, base_ref, assignee_id from tasks where state = 'planning'`).catch(() => [] as PlanTask[]);
  for (const t of planningRows) {
    dispatchPlanning(t);
  }
  const reviewRows = await db.getAll<PlanTask>(`select id, number, title, description, channel_id, requirements from tasks where state = 'plan_review' and offered_agent_id is null`).catch(() => [] as PlanTask[]);
  for (const t of reviewRows) {
    if (decided.has(t.id)) continue;
    const orch = [...agents.values()].find((a) => a.role === 'orchestrator' && a.channels.has(t.channel_id));
    if (!orch) continue;
    decided.add(t.id);
    void orchPlanDecision(orch, t);
  }
  // in_progress tasks assigned to a local agent that this process isn't running (host restarted
  // mid-task) — same boot race: the resume watch fires before the roster loads. Pick them back up.
  type ResumeRow = ExecTask & { assignee_id: string; requirements_confirmed: number };
  const resumeRows = await db.getAll<ResumeRow>(
    `select id, number, title, channel_id, assignee_id, repo_id, base_ref, branch, requirements, requirements_confirmed
     from tasks where state = 'in_progress' and assignee_kind = 'agent'`,
  ).catch(() => [] as ResumeRow[]);
  for (const t of resumeRows) {
    if (claimed.has(t.id)) continue;
    const agent = agents.get(t.assignee_id);
    if (!agent) continue;
    claimed.add(t.id);
    execQueue.run({ key: t.id, kind: 'work', cause: 'board', agentId: agent.id, subject: { kind: 'task', number: t.number } }, () => resumeFlow(agent, t));
  }
}

  return { dispatchDesigner, dispatchPlanning, reconcileBoard, retryDesignQuestion, surfacePlanningStaffing };
}
