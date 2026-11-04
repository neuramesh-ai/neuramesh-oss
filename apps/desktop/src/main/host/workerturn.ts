import { chatPermissionAction } from '../chat-permission-action';
import { remoteThreadPermissionGate } from '../thread-permission-gate';
import { apiAuthHeaders } from '../apiauth';
import { loadEngineeringPolicyRules } from '../relay/engineering-policy';
// THE WORKER'S TURN INPUTS — everything a worker needs in hand before its runtime starts.
//
// Split out of flows.ts, where it sat as ~95 lines between "open the run" and "run the code":
// the skills it may reach for, the three commands it may issue (propose a skill, record a
// lesson, park a backlog item), the permission gate every tool call passes through, the kernel
// sandbox's protected paths, and the memory injected into its prompt.
//
// It is one unit because it is one moment: none of it depends on the repo/scratch branch that
// follows, and all of it is read-then-close-over — nothing here writes back into the flow.
// `log` arrives as a VALUE, deliberately: flows.ts rebinds its `log` to the run-narrating
// wrapper on the line before this block runs, so the wrapper is what gets passed and these
// injection lines still land on the run's live step.
import { awaitDecision } from '../agents';
import type { ExecTask, HostedAgent, SkillRef } from '../agents';
import { buildPermissionCardBody, permissionQuestion, policyGateOutcome, protectedPathsFromRules, taskWhere } from '../policygate';
import type { LogFn } from '../agentlog';
import type { HostCtx } from './ctx';
import type { ReplicaDatabase } from '@neuramesh/client-core/replica';
import type { PermissionGate, RuntimeAdapter } from '../runtime/adapter';

export function makeWorkerTurn(ctx: HostCtx & {
  apiUrl: string; ownerActorId: string;
  db: ReplicaDatabase;
  brainNotesFor: (task: ExecTask, cap?: number, perNote?: number) => string;
  channelLessons: (workspaceId: string, channelId: string) => Promise<string>;
  discoverSkills: (channelId: string, workspaceId: string) => Promise<SkillRef[]>;
  taskRecallNote: (workspaceId: string, query: string, lessonsNote: string) => Promise<string>;
}) {
  const { db, post, brainNotesFor, channelLessons, discoverSkills, taskRecallNote } = ctx;

  /** Everything the worker's runtime needs handed to it — assembled once, per execution. */
  async function buildWorkerTurn(a: {
    t: ExecTask;
    ch: { id: string; slug: string; workspace_id: string };
    agent: HostedAgent;
    actor: { kind: string; id: string; role: string };
    mode: string;
    adapter: RuntimeAdapter;
    token: string;
    log: LogFn;
  }) {
    const { t, ch, agent, actor, log } = a;
  // team Agent Skills the worker may reach for (the enforcement seam). Logging
  // the count makes "did it consider skills?" visible in the activity log —
  // the model is then prompted to scan + load_skill a fitting one first.
  const skills = await discoverSkills(t.channel_id, ch.workspace_id);
  if (skills.length) log({ kind: 'tool', phase: 'inject', summary: `${skills.length} skill${skills.length === 1 ? '' : 's'} available — scan before improvising` });
  // self-learning: workers propose drafts the team curates (W11 slice 2)
  const proposeSkill = (input: { name: string; description: string; scope: 'channel' | 'global'; body: string }) =>
    post('/v1/commands', actor, {
      type: 'skill.propose',
      workspace: ch.workspace_id,
      ...(input.scope === 'global' ? {} : { channel: ch.id }),
      name: input.name,
      description: input.description,
      scope: input.scope,
      body: input.body,
    }).then((r) => ({ ok: r.ok }), () => ({ ok: false, error: 'request failed' }));
  // …and record one-line lessons a correction taught (memory.record_lesson, task provenance)
  const recordLesson = (input: { lesson: string }) =>
    post('/v1/commands', actor, {
      type: 'memory.record_lesson',
      workspace: ch.workspace_id,
      channel: ch.id,
      content: input.lesson,
      taskId: t.id,
    }).then((r) => ({ ok: r.ok }), () => ({ ok: false, error: 'request failed' }));
  // …and park out-of-scope discoveries on the channel backlog (docs/15).
  // task.create backlog:true is the one creation path open to a worker actor;
  // the parked item can't be offered/claimed until a human or the orchestrator
  // promotes it, so this can never route work by itself.
  const addBacklogItem = (input: { title: string; description?: string; parent?: boolean }) =>
    post('/v1/commands', actor, {
      type: 'task.create',
      workspace: ch.workspace_id,
      channel: ch.id,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      // parent → a SUBTASK riding THIS task (docs/24); else a backlog park
      ...(input.parent ? { parent: t.id } : { backlog: true }),
    }).then(
      async (r) => (r.ok ? { ok: true, number: ((await r.json()) as { task?: { number?: number } }).task?.number } : { ok: false, error: 'request failed' }),
      () => ({ ok: false, error: 'request failed' }),
    );
  // …and gate every tool call against the effective permission policy (agent policy
  // engine, Phase 1): map the call, evaluate baseline+overrides read from the replica,
  // and on `ask` post a permission card the human answers (fail-closed to deny).
  const modeGate = remoteThreadPermissionGate({apiUrl:ctx.apiUrl,workspace:ch.workspace_id,actorId:ctx.ownerActorId,taskId:t.id,
    headers:()=>apiAuthHeaders(ctx.apiUrl,{kind:'agent',id:agent.id})});
  const project = await db.get<{project_id:string}>('select project_id from tasks where id=? and workspace_id=?',[t.id,ch.workspace_id]);
  const rules = await loadEngineeringPolicyRules(db,ch.workspace_id,project?.project_id);
  const permissionGate: PermissionGate = async (toolName, toolInput) => {
    const mapped=chatPermissionAction(toolName,toolInput);
    if (!mapped) return {decision:'allow'};
    const action=mapped.actions[0];
    if (!action) return {decision:'deny',reason:'Unknown tool action.'};
    const mode=await modeGate.decide(mapped.kind,mapped.actions,rules);
    const outcome=policyGateOutcome(action,rules);
    if (mode && mode.verdict!=='review') { outcome.decision=mode.verdict; outcome.reason=mode.reason; }
    if (outcome.decision!=='ask') return {decision:outcome.decision,reason:outcome.reason};
    const summary = typeof toolInput.description==='string' ? toolInput.description.slice(0,200) : undefined;
    const res = await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: buildPermissionCardBody(action, outcome, agent.name, taskWhere(t.number), summary || undefined) }).catch(() => null);
    if (!res || !res.ok) return { decision: 'deny', reason: 'could not raise the approval request' };
    const messageId = ((await res.json().catch(() => ({}))) as { message?: { id?: string } }).message?.id;
    if (!messageId) return { decision: 'deny', reason: 'approval request had no id' };
    const answer = await awaitDecision(db, messageId, { taskId: t.id }, permissionQuestion(action, agent.name, taskWhere(t.number)), undefined, true);
    return answer === 'Approve' ? { decision: 'allow' } : { decision: 'deny', reason: answer == null ? 'approval timed out — denied' : 'a human denied this action' };
  };
  // The kernel FS sandbox enforces the same fs.read deny paths the tool-gate does: read the
  // effective policy once at run-start and hand the human-added protected paths to the runtime,
  // so a workspace's custom "agents can never read X" is a real kernel jail, not just a tool block.
  const sandboxProtectedPaths = protectedPathsFromRules(rules);
  // lessons already learned here — injected so the worker starts warned
  const lessonsNote = await channelLessons(ch.workspace_id, ch.id);
  if (lessonsNote) log({ kind: 'tool', phase: 'inject', summary: `${(lessonsNote.match(/\n- /g) ?? []).length} lesson(s) from past reviews injected` });
  // …plus top-k memory recalled for the task itself (context packet, docs/03 §6);
  // rides the lessons slot into every runtime's prompt — no adapter change.
  const recallQuery = `${t.title} ${((t as ExecTask & { description?: string | null }).description ?? '').slice(0, 200)}`.trim();
  const recallNote = await taskRecallNote(ch.workspace_id, recallQuery, lessonsNote);
  if (recallNote) log({ kind: 'tool', phase: 'inject', summary: `${(recallNote.match(/\n- /g) ?? []).length} memory hit(s) recalled into the task context` });
  const memoryNote = (lessonsNote + recallNote) + brainNotesFor(t);
    return { skills, proposeSkill, recordLesson, addBacklogItem, permissionGate, sandboxProtectedPaths, memoryNote, permissionRules:rules };
  }

  return { buildWorkerTurn };
}
