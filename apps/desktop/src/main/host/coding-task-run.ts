import { realpathSync } from 'node:fs';
import { CODING_IMPLEMENTATION_PLAN_SKILL, OPEN_ENGINEERING_POLICY, RECOMMENDED_ENGINEERING_PERMISSIONS, type EngineeringSession } from '@neuramesh/shared';
import type { ReplicaDatabase } from '@neuramesh/client-core/replica';
import type { EngineeringMachineHost } from '../relay/engineering-host';
import type { ExecTask, HostedAgent } from '../agents';
import { executing, stoppedTasks } from '../agents';
import { cachePath } from '../harness/brain';
import type { LogFn } from '../agentlog';

/** Null means a legacy worker task. A coding task must never silently fall back to pasted output. */
export async function runTaskCoding(o: {db: ReplicaDatabase; engineering?: () => EngineeringMachineHost; task: ExecTask; agent: HostedAgent; dir: string; context: string; log: LogFn; onProgress?: (step: string) => Promise<void>; mode?: 'plan' | 'act'}): Promise<{note:string;stopped:boolean} | null> {
  const [row] = await o.db.getAll<{id:string;created_by:string;project_id:string;description:string;repo_name:string}>(
    `select th.id,th.created_by,th.project_id,t.description,r.name as repo_name from threads th join tasks t on t.id=th.task_id join repos r on r.id=t.repo_id where t.id=? and th.kind='coding'`,[o.task.id]);
  if (!row) return null;
  const host = o.engineering?.();
  if (!host?.runTask) throw new Error('This machine needs the coding-task runtime update before it can implement this task.');
  if (!row.created_by.startsWith('human:') || !o.task.repo_id) throw new Error('The coding task has no valid owner or repository.');
  const ac = new AbortController(); executing.set(o.task.id,ac);
  let last = '', at = 0;
  const progress = (state: EngineeringSession) => {
    const step = codingTaskProgress(state);
    if (step !== last && Date.now()-at > 2500) {
      last=step; at=Date.now();
      o.log({kind:'exec',phase:'progress',summary:step});
      void o.onProgress?.(step).catch(() => {});
    }
  };
  try {
    const note = await host.runTask({ actorId:row.created_by.slice(6),threadId:row.id,projectId:row.project_id,
      repoId:o.task.repo_id,repoName:row.repo_name,branch:o.task.branch ?? `nm/${o.task.number}`,agentId:o.agent.id,modelId:o.agent.model,reasoningEffort:o.agent.thinking ?? null,
      mode:o.mode ?? 'act',permissions:{...RECOMMENDED_ENGINEERING_PERMISSIONS},policy:{...OPEN_ENGINEERING_POLICY} },
      {cwd:realpathSync(o.dir),repoRoot:o.mode === 'plan' ? null : realpathSync(cachePath('repos',o.task.repo_id))},
      o.mode === 'plan' ? `Revise the implementation plan for task #${o.task.number}: ${o.task.title}\n\n${row.description}\n\n${o.context}\n\n${CODING_IMPLEMENTATION_PLAN_SKILL}\n\nRemain in Plan mode. Inspect the repository, address all review feedback, and call propose_work_plan with the full revised plan. Include concrete files, implementation steps, meaningful tests, definition of done, and real screenshot validation for any UI changes. Do not implement, commit, push or open a PR. The human reviews this task plan before execution.` : `Implement task #${o.task.number}: ${o.task.title}\n\n${row.description}\n\n${o.context}\n\nThe human approved this task's implementation plan. Work in the repository: implement, run meaningful tests, and report the actual result. Give concise public updates before starting and as you inspect, implement and verify. The approved task plan is included above; only update a native work-plan checklist if one is recorded in this coding conversation. Do not return proposed diffs as a substitute for editing files. The host commits, pushes and opens the PR after you finish; do not run git push or create the PR yourself. State failures and unrun checks accurately. Summarize changes and actual verification in your final response; the host appends commit and PR status separately, so omit explanations about internal task machinery.`,
      ()=>ac.signal.aborted || stoppedTasks.has(o.task.id),progress);
    return {note,stopped:false};
  } finally { if (executing.get(o.task.id)===ac) executing.delete(o.task.id); }
}

/** Public commentary and approved plan state only; never provider reasoning. */
export function codingTaskProgress(state: EngineeringSession): string {
  if (state.pendingApproval) return `Waiting for approval: ${state.pendingApproval.title}`;
  const step = state.planProgress?.plan.steps[state.planProgress.statuses.indexOf('in_progress')]?.description;
  if (step) return step;
  const update = [...state.messages].reverse().find(message => message.role === 'assistant' && !message.kind && !message.streaming && message.body.trim());
  if (update) return update.body.replace(/\s+/g, ' ').slice(0, 600);
  return {thinking:'Reviewing the implementation approach',tool:'Working through the approved implementation',composing:'Preparing an implementation update',restoring:'Restoring the coding conversation'}[state.activeActivity?.phase ?? 'thinking'];
}
