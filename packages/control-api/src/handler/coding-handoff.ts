import { createHash } from 'node:crypto';
import { isValidationImageName, requireCaptureReceipts, type CaptureReceipt, isAcceptWord, validationImages, codingDeliveryPolicy, createEvent, formatAddress, validateWorkPlanLegs, taskBranch, planArtifactName, renderPlanMarkdown, type Actor, type Task } from '@neuramesh/shared';
import type { Command } from '../commands';
import { actorAddress, taskTarget } from './guards';
import type { MutationResult, Store } from '../store';
import { sqlOf } from '../credits';
import { DomainError } from '../errors';
import { createCodingTaskThread } from '../store/coding-task-thread';
import { postPlanMessage } from './planfollowup';

/** A narrow exception to chat's board restriction, never a conversion of the home thread. */
export async function validateCodingHandoff(store: Store, actor: Actor, cmd: Extract<Command, { type: 'task.create' }>, verifiedMessage?: string) {
  if (!cmd.codingHandoff) return null;
  const sql = sqlOf(store);
  if (!sql || actor.kind !== 'agent' || !cmd.originThread || !cmd.repo || cmd.thread || cmd.parent || cmd.backlog || !cmd.plan || !['bug','feature','refactor','chore'].includes(cmd.kind ?? '')) {
    throw new DomainError('INVALID_INPUT', 'A coding handoff needs an agent home, project repository, implementation plan and code task kind.');
  }
  const invalidPlan = validateWorkPlanLegs(cmd.plan.legs, true);
  if (invalidPlan) throw new DomainError('INVALID_INPUT', invalidPlan);
  const [home] = await sql`select t.project_id,t.channel_id,t.created_by from threads t
    join agents a on a.id=${actor.id}::uuid and a.workspace_id=t.workspace_id and a.retired_at is null
    join channels c on c.id=t.channel_id
    where t.id=${cmd.originThread}::uuid and t.workspace_id=${cmd.workspace}::uuid
      and ((t.home_agent_id=a.id and exists(select 1 from project_agents pa where pa.project_id=t.project_id and pa.agent_id=a.id))
        or (${verifiedMessage ?? null}::uuid is not null and t.home_agent_id is null and a.role='orchestrator'
          and exists(select 1 from agent_channels ac where ac.agent_id=a.id and ac.channel_id=t.channel_id)))
      and t.archived_at is null
      and (c.id::text=${cmd.channel} or c.slug=${cmd.channel})`;
  if (!home || !String(home['created_by']).startsWith('human:')) throw new DomainError('NOT_PERMITTED', 'Create coding work from your own active agent thread.');
  const owner = String(home['created_by']).slice(6);
  const [member] = await sql`select 1 from workspace_members where workspace_id=${cmd.workspace}::uuid and user_id=${owner}::uuid`;
  const [repo] = await sql`select r.id from repos r join project_repos pr on pr.repo_id=r.id
    where r.id=${cmd.repo.id}::uuid and pr.project_id=${home['project_id']}::uuid and r.workspace_id=${cmd.workspace}::uuid`;
  if (!member || !repo) throw new DomainError('NOT_PERMITTED', 'Use a repository attached to this project and an active workspace member.');
  if (cmd.project && cmd.project !== home['project_id']) throw new DomainError('NOT_PERMITTED', 'A coding task belongs to its parent agent project.');
  const [coder] = await sql`select a.id from agents a
    where a.workspace_id=${cmd.workspace}::uuid and a.retired_at is null and a.role='developer'
      and (${cmd.offerTo ?? null}::text is null or a.id::text=${cmd.offerTo ?? null} or a.name=${cmd.offerTo ?? null})
    order by exists(select 1 from project_agents pa where pa.project_id=${home['project_id']}::uuid and pa.agent_id=a.id) desc,
      (a.role='developer') desc, (lower(a.name)='patch') desc, a.created_at limit 1`;
  if (!coder) throw new DomainError('NOT_FOUND','Add a developer agent to this workspace before handing off implementation.');
  return { owner, agentId:String(coder['id']), project: String(home['project_id']), channel: String(home['channel_id']) };
}

/** Rescue an existing unstarted task without making a duplicate or bypassing its plan gate. */
export async function adoptCodingTask(store: Store, actor: Actor, cmd: Extract<Command,{type:'task.create'}>, scope: {owner:string;agentId:string;project:string;channel:string}, scheduledMessage?:string) {
  const taskId=cmd.codingHandoff?.taskId;
  if (!taskId) return null;
  const sql=sqlOf(store)!;
  const changed = await sql.begin(async tx=>{
    const q=tx as unknown as typeof sql;
    const [task]=await q`select t.*,th.kind as thread_kind,th.created_by as thread_owner from tasks t left join threads th on th.task_id=t.id where t.id=${taskId}::uuid for update of t`;
    if (!task || task['workspace_id']!==cmd.workspace || task['project_id']!==scope.project || (task['origin_thread_id'] && task['origin_thread_id']!==cmd.originThread)) throw new DomainError('NOT_PERMITTED','Choose an unstarted task owned by this agent thread or unowned in this project.');
    if (task['thread_owner'] && String(task['thread_owner']).startsWith('human:') && task['thread_owner']!==`human:${scope.owner}`) throw new DomainError('NOT_PERMITTED','Keep this task with its existing conversation owner.');
    if (task['thread_kind']==='coding' && task['origin_thread_id']===cmd.originThread) return false;
    if (!['backlog','todo','planning','plan_review'].includes(task['state']) || task['assignee_id'] || task['submitted_sha'] || task['pr_number']) throw new DomainError('INVALID_INPUT','This task already has implementation work. Stop or finish that run before changing its runtime.');
    if (task['repo_id'] && task['repo_id']!==cmd.repo!.id) throw new DomainError('INVALID_INPUT','Keep the existing task repository.');
    if (task['state']==='backlog') await q`update tasks set state='todo' where id=${taskId}::uuid`;
    if (['backlog','todo'].includes(task['state'])) await q`update tasks set state='planning' where id=${taskId}::uuid`;
    const version=(task['work_plan']?.version ?? 0)+1;
    await q`update tasks set origin_thread_id=${cmd.originThread!}::uuid,repo_id=${cmd.repo!.id}::uuid,base_ref=${cmd.repo!.baseRef},
      branch=${task['branch'] ?? taskBranch(task['number'],task['title'])},state='plan_review',kind=${cmd.kind!}::task_kind,
      permission_run_message_id=${scheduledMessage ?? null}::uuid,plan_approved_at=case when ${!!scheduledMessage} then now() else null end,assignee_kind='agent',assignee_id=${scope.agentId}::uuid,offered_agent_id=${scope.agentId}::uuid,requirements=${q.json(cmd.checklist ?? [])},requirements_confirmed=true,
      work_plan=${q.json({...cmd.plan!,codingDelivery:codingDeliveryPolicy(cmd.codingHandoff!,[cmd.title,cmd.description,...(cmd.checklist ?? [])]),version,proposedAt:new Date().toISOString()} as never)},updated_at=now(),version=version+1 where id=${taskId}::uuid`;
    await q`insert into project_agents(workspace_id,project_id,agent_id) values(${cmd.workspace}::uuid,${scope.project}::uuid,${scope.agentId}::uuid) on conflict do nothing`;
    await q`insert into agent_channels(agent_id,channel_id) values(${scope.agentId}::uuid,${scope.channel}::uuid) on conflict do nothing`;
    await createCodingTaskThread(q,taskId,scope.owner);
    await q`select nm_coding_task_report(${taskId}::uuid,'task','plan_review')`;
    await q`insert into messages(workspace_id,channel_id,thread_id,author_kind,author_id,body) values(${cmd.workspace}::uuid,${scope.channel}::uuid,${cmd.originThread!}::uuid,'agent',${actor.id}::uuid,${`‹task:${taskId}›`})`;
    const event=createEvent({type:'task.plan_proposed',source:formatAddress(actor),target:`task:${task['number']}`,workspace:cmd.workspace,payload:{codingHandoff:true,originThread:cmd.originThread,version,...(scheduledMessage ? {scheduledMessage} : {})}});
    await q`insert into events(id,workspace_id,type,source,target,channel_id,task_id,payload) values(${event.id},${cmd.workspace}::uuid,${event.type},${event.source},${event.target},${scope.channel}::uuid,${taskId}::uuid,${q.json(event.payload as never)})`;
    return true;
  });
  const task=await store.getTask(taskId);
  if (!task) throw new DomainError('NOT_FOUND','Coding task not found.');
  if (changed && task.workPlan) {
    const p=task.workPlan;
    await store.mutate(task.id, async current=>({task:current,events:[],artifacts:[{kind:'doc',name:planArtifactName(p.version),content:renderPlanMarkdown({number:task.number,title:task.title,kind:task.kind,legs:p.legs,subtasks:p.subtasks,approach:p.approach,version:p.version,repo:true})}]}));
    await postPlanMessage(store,task,actor,p.version,'birth');
  }
  return {task,events:[]};
}

/** Record the person's request without casting a review or release verdict. The
 * existing owner dispatcher picks it up once implementation review passes. */
export function requestCodingChecklist(task: Task, actor: Actor): MutationResult {
  if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'Only a person can request release preparation.');
  const plan = task.workPlan;
  if (!plan?.codingDelivery || !task.prNumber || task.parentTaskId) throw new DomainError('INVALID_INPUT', 'A coding task with a pull request is required.');
  if (!['in_review', 'done'].includes(task.state)) throw new DomainError('ILLEGAL_TRANSITION', 'Release preparation can be requested during implementation review.');
  if (plan.codingDelivery.prepareRelease) return { task, events: [], unchanged: true };
  const next = { ...task, workPlan: { ...plan, codingDelivery: { ...plan.codingDelivery, prepareRelease: true } },
    updatedAt: new Date().toISOString(), version: task.version + 1 };
  return { task: next, events: [createEvent({ type: 'task.release_checklist_requested', source: actorAddress(actor),
    target: taskTarget(task), workspace: task.workspace, payload: { prNumber: task.prNumber } })] };
}

export async function requireReleasePreparation(store: Store, actor: Actor, taskId: string) {
  const t = await store.getTask(taskId);
  if (!t) throw new DomainError('NOT_FOUND', `task ${taskId} not found`);
  if (t.workPlan?.codingDelivery && !t.workPlan.codingDelivery.prepareRelease && actor.kind !== 'human') {
    throw new DomainError('HUMAN_ONLY', 'Ask the person to request a release checklist for this coding task.');
  }
  if (!t.prNumber) {
    throw new DomainError('INVALID_INPUT', 'the ship gate covers repo-backed tasks with an open pull request — a human accept ships this one directly');
  }
  if (!t.workPlan?.codingDelivery && !(await store.shipGate(taskId))) {
    throw new DomainError('NOT_PERMITTED', 'the release gate is off for this project — a human accept merges it directly');
  }
}

/** Submission files are agent-controlled. Match them against the actual browser capture
 * uploaded for this coding thread, never against tags supplied with the submission. */
async function verifyCodingScreenshots(store: Store, taskId: string, images: Parameters<typeof validationImages>[0], reviewedRevision?: string | null) {
  const sql = sqlOf(store);
  const rows = sql ? await sql`select b.capture,b.object_ref,b.created_at from brain_artifacts b
    join threads th on th.id=b.thread_id and th.workspace_id=b.workspace_id
    where th.task_id=${taskId}::uuid and th.kind='coding' and b.capture is not null` : [];
  const receipts: CaptureReceipt[] = rows.map(row=>({...row['capture'],sha256:row['object_ref'].sha256,capturedAt:new Date(row['created_at']).toISOString()}));
  const names = validationImages(images);
  if (!names.length) throw new Error('Attach verified before and after screenshots of the implementation.');
  // A verifier can supersede bad historical submission images for the exact PR
  // revision. Every submitted view still needs both phases of the same target.
  if (reviewedRevision) {
    const external = receipts.filter(r=>r.source==='independent-observer' && r.reviewedRevision===reviewedRevision);
    if (names.every(name=>external.some(r=>r.name===name))) {
      const pairs = names.map(name=>external.filter(r=>r.name===name).at(-1)!);
      requireCaptureReceipts(pairs,external);
      return;
    }
  }
  requireCaptureReceipts(images.filter(i=>i.kind==='screenshot' && names.includes(i.name)).map(image=>({name:image.name,
    sha256:createHash('sha256').update(Buffer.from(image.content!.split(',')[1]!, 'base64')).digest('hex')})), receipts);
}

/** Older in-review submissions reached this state before the evidence gate existed. */
export async function assertSubmittedVisualEvidence(store: Store, taskId: string, submission?: Parameters<typeof validationImages>[0]) {
  const task = await store.getTask(taskId);
  const delivery = task?.workPlan?.codingDelivery;
  if (!delivery || (!delivery.visualEvidence && !submission?.some(a=>a.kind==='screenshot' && isValidationImageName(a.name)))) return;
  try {
    if (submission) await verifyCodingScreenshots(store,taskId,submission);
    else {
      const rows = await store.listArtifacts(taskId);
      const latest = new Map(rows.filter(row => row.kind === 'screenshot').map(row => [row.name,row]));
      await verifyCodingScreenshots(store,taskId,[...latest.values()],task?.submittedSha);
    }
  } catch (error) {
    throw new DomainError(submission ? 'EVIDENCE_REQUIRED' : 'INVALID_INPUT', error instanceof Error ? error.message : 'Visual validation is incomplete.');
  }
}

/** The existing chat accept tool carries a human's word. For an owned PR, an explicit
 * request to ship starts checklist preparation; the separate human approval still gates execution. */
export async function wantsCodingRelease(store: Store, taskId: string, wordId: string): Promise<boolean> {
  const sql = sqlOf(store);
  if (!sql) return false;
  const [word] = await sql`select m.body from messages m join tasks t on t.id=${taskId}::uuid
    where m.id=${wordId}::uuid and t.work_plan ? 'codingDelivery' and t.pr_number is not null
      and m.workspace_id=t.workspace_id and m.author_kind='human' and m.schedule_id is null and not m.machine_authored`;
  return !!word && isAcceptWord(word['body']) && /\b(?:merge|land|ship)\b/i.test(word['body']);
}
