// THE ECHO HARNESS — what stands in for a live brain when NM_ECHO is set, so the loop can be
// exercised end to end without spending a token. It is deliberately inert: echo mode never
// triages, never files, never approves. Extracted from agents.ts (track B2).
import { SKILL_MARKER, parseSkillMarker, splitGoals } from '../agents';
import type { HostedAgent, ThreadTask } from '../agents';
import { bareAddressRe, mentionRe } from '@neuramesh/shared';
import { buildHireCard } from '../hirecards';

import type { PowerSyncDatabase } from '@powersync/node';




import type { makePlanFlow } from './planflow';

import type { HostCtx } from './ctx';

export function makeEcho(ctx: HostCtx & {
  agents: Map<string, HostedAgent>;
  db: PowerSyncDatabase;
  hireProposed: Set<string>;
  offerPlanToWorker: ReturnType<typeof makePlanFlow>['offerPlanToWorker'];
  post: any;
  workspace: string;
}) {
const { db, hireProposed, offerPlanToWorker, post } = ctx;

// deterministic intake for echo mode: open an unoffered task, put the
// requirements question in its thread, digest in the channel — gates
// exercise the intake→thread→offer protocol end to end
async function echoOrchestrate(agent: HostedAgent, body: string, ch: { id: string; slug: string; workspace_id: string }): Promise<string> {
  const actor = { kind: 'agent', id: agent.id, role: 'orchestrator' };
  // a `/`-attached skill steers the work — strip the marker from the goal text
  const attached = parseSkillMarker(body);
  const goal = body.replace(SKILL_MARKER, '').replace(mentionRe(agent.name, 'gi'), '').replace(bareAddressRe(agent.name), '').trim() || 'untitled goal';
  // one request can carry several distinct deliverables → one intake each
  const goals = splitGoals(goal);
  const opened: Array<{ number: number; title: string }> = [];
  for (let i = 0; i < goals.length; i++) {
    const g = goals[i]!;
    const res = await post('/v1/commands', actor, {
      type: 'task.create',
      workspace: ch.workspace_id,
      channel: ch.id,
      title: g.slice(0, 120),
      // plan-first (docs/41): an agent's live create carries its plan — echo declares the lean
      // stub journey so the e2e smoke walks the same gate the real orchestrator does
      plan: { legs: ['build'], subtasks: [], approach: `Echo-mode stub plan for: ${g.slice(0, 200)} — produce the placeholder deliverable and finish to the accept gate.` },
      description:
        goals.length > 1
          ? `Intake from #${ch.slug} (${i + 1} of ${goals.length} from one request): ${g}`
          : `Intake from #${ch.slug}: ${g}`,
    });
    if (!res.ok) continue; // best-effort across the batch; report what opened
    const { task } = (await res.json()) as { task: { id: string; number: number; title: string } };
    opened.push({ number: task.number, title: task.title });
    await post('/v1/messages', actor, {
      workspace: ch.workspace_id,
      channel: ch.id,
      taskId: task.id,
      body: `Intake for #${task.number} “${task.title}”.\n\n\`\`\`nmq\n${JSON.stringify({
        question: `What does done look like for #${task.number}?`,
        options: [
          { label: 'Stub result note', description: 'echo-mode placeholder deliverable' },
          { label: 'Repo-backed change', description: 'name the repo in your reply' },
        ],
        allowOther: true,
      })}\n\`\`\`\n\nReply here — I offer it to a worker once requirements are set.`,
    }).catch(() => {});
  }
  const skillNote = attached ? ` Applying the **${attached.name}** skill you attached.` : '';
  if (!opened.length) return `[echo · ${agent.name}] task.create failed — opened nothing.`;
  if (opened.length === 1) return `[echo · ${agent.name}] Opened #${opened[0]!.number} “${opened[0]!.title}” — requirements in the task thread.${skillNote}`;
  return `[echo · ${agent.name}] Decomposed into ${opened.length} intakes: ${opened.map((o) => `#${o.number} “${o.title}”`).join(', ')} — requirements in each thread.${skillNote}`;
}

// echo thread resolution: any human reply in an unclaimed intake thread
// counts as resolved requirements — offer to the first worker in scope
async function echoThreadOrchestrate(agent: HostedAgent, t: ThreadTask, ch: { id: string; slug: string; workspace_id: string }): Promise<string> {
  const orchActor = { kind: 'agent', id: agent.id, role: 'orchestrator' };
  // Plan-worthy work goes to the architect first (a plan gate before
  // execution). Echo's deterministic trigger is a "[plan]" marker in the
  // request; the real orchestrator judges plan-worthiness (1.3-claude). The
  // architect drafts, the orchestrator then approves+offers (orchPlanDecision).
  const planWorthy = /\[plan\]/i.test(`${t.title} ${t.description ?? ''}`);
  if (planWorthy) {
    const conf = await post('/v1/commands', orchActor, { type: 'task.confirm_requirements', taskId: t.id, checklist: ['intake resolved in thread', 'deliverable: stub result note'] }).catch(() => null);
    if (conf && !conf.ok && conf.status !== 409) { /* already confirmed is fine */ }
    const res = await post('/v1/commands', orchActor, { type: 'task.request_plan', taskId: t.id, kind: 'feature' });
    if (!res.ok) return `[echo · ${agent.name}] request_plan failed ${res.status}: ${(await res.text()).slice(0, 120)}`;
    return `[echo · ${agent.name}] Requirements noted — routed #${t.number} to the architect for an implementation plan.`;
  }
  const [worker] = await db.getAll<{ name: string }>(
    `select a.name from agents a join agent_channels ac on ac.agent_id = a.id
     where ac.channel_id = ? and a.role in ('worker', 'developer') and a.id != ? and a.retired_at is null order by a.name limit 1`,
    [ch.id, agent.id],
  );
  if (!worker) {
    // staffing hole: propose a hire instead of dead-ending. The card goes to the
    // CHANNEL (the confirm watch lives there); once per task per session so a
    // chatty thread doesn't spam interactive cards. Deterministic name/role —
    // the echo path is the LLM-free spine the e2e hire gate drives.
    if (!hireProposed.has(t.id)) {
      hireProposed.add(t.id);
      await post('/v1/messages', orchActor, {
        workspace: ch.workspace_id, channel: ch.id,
        body: buildHireCard({ chanSlug: ch.slug, name: `${ch.slug}-worker`, role: 'worker', taskNumber: t.number, remit: 'echo-mode stub worker' }),
      }).catch(() => {});
    }
    return `[echo · ${agent.name}] no worker agents registered to #${ch.slug} — proposed hiring one in the channel; #${t.number} stays unoffered until you approve.`;
  }
  const res = await post('/v1/commands', orchActor, {
    type: 'task.offer',
    taskId: t.id,
    offerTo: worker.name,
    checklist: ['intake resolved in thread', 'deliverable: stub result note'],
    kind: 'feature',
  });
  if (!res.ok) return `[echo · ${agent.name}] task.offer failed ${res.status}: ${(await res.text()).slice(0, 120)}`;
  return `[echo · ${agent.name}] Requirements noted — offered #${t.number} to @${worker.name}.`;
}

// human plan-review resolution (echo): the human approved or asked for changes
// on a proposed plan. Approve → offer to a worker; changes → revise_plan
// (back to the architect). The real orchestrator reads the intent (1.3-claude).
async function echoPlanReview(agent: HostedAgent, t: ThreadTask, ch: { id: string; slug: string; workspace_id: string }, reply: string): Promise<string> {
  const orchActor = { kind: 'agent', id: agent.id, role: 'orchestrator' };
  if (/\b(approve|approved|proceed|looks good|lgtm|ship it)\b/i.test(reply)) {
    await offerPlanToWorker(agent, { id: t.id, number: t.number, title: t.title, description: t.description, channel_id: t.channel_id, requirements: null, repo_id: null, base_ref: null }, ch);
    return `[echo · ${agent.name}] Plan approved by you — assigning #${t.number} for implementation.`;
  }
  if (/\b(change|changes|revise|rework|reject|redo)\b/i.test(reply)) {
    const res = await post('/v1/commands', orchActor, { type: 'task.revise_plan', taskId: t.id, feedback: reply.slice(0, 500) });
    if (!res.ok) return `[echo · ${agent.name}] revise_plan failed ${res.status}: ${(await res.text()).slice(0, 120)}`;
    return `[echo · ${agent.name}] Sent #${t.number} back to the architect with your notes.`;
  }
  return `[echo · ${agent.name}] For #${t.number}: reply “approve” to proceed or “request changes” with notes.`;
}


  return { echoOrchestrate, echoPlanReview, echoThreadOrchestrate };
}
