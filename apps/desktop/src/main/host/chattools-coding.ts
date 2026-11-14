import { normalizeTaskMarkdown, TASK_HANDOFF_SKILL, IMPLEMENTATION_PLAN_SKILL } from '@neuramesh/shared';
import type { ChatToolCtx } from './chattools';
import { onCloudMachine } from '../runtime/adapter';
import { localRepoRemote } from './gh';

/** Shared by every Agent Desk role. Code executes in a task, never in the home chat. */
export function codingChatTools(t: ChatToolCtx) {
  const { z, tool, text, db, post, agent, ch, threadId } = t;
  const actor = { kind: 'agent', id: agent.id, role: agent.role };
  return [
    tool('create_coding_task', 'Hand off requested code implementation to a coding task with its own live coding thread, file review, commands, tests and PR pipeline. Available to every Agent Desk role. Use instead of pasting diffs or claiming that NeuraMesh cannot write code. Read list_repos first; include clear implementation instructions, a proposed plan, definition of done, meaningful tests and real screenshot validation for UI changes. Assign a developer who owns the task through planning, revision and delivery; never rotate ownership by phase. If architecture or marketing input is needed, ask that specialist separately and include their result in the developer handoff. The existing human plan approval applies; after approval the coding agent starts automatically. Your parent thread receives persisted progress, blockers and a completion summary. Reuse requestId only when retrying identical work. Never claim completion from a proposal.\n\n' + TASK_HANDOFF_SKILL + '\n\n' + IMPLEMENTATION_PLAN_SKILL, {
      taskId: z.string().uuid().optional().describe('Reuse an existing unstarted task in this project instead of creating a duplicate.'),
      taskNumber: z.number().int().positive().optional().describe('The existing #number, if its UUID is unknown. Use this instead of creating another task for the same work.'),
      requestId: z.string().uuid(), title: z.string().min(1).max(200), description: z.string().min(1).max(20000),
      repoId: z.string().uuid(), baseRef: z.string().min(1).default('main'),
      kind: z.enum(['bug','feature','refactor','chore']),
      approach: z.string().min(1).max(20000), acceptance: z.array(z.string().min(1)).min(1).max(12),
      roleContext: z.string().min(10).max(2000).describe('Recipient role, project and objective; enough context to begin independently.'),
      references: z.array(z.string().min(1)).max(20).describe('Verified repository paths, design/artifact references and source findings. Empty only when none are needed.'),
      validation: z.array(z.string().min(1)).min(1).max(12).describe('Verified test commands and manual checks. UI work requires real runtime screenshots with themes/viewports and artifact delivery.'),
      visualEvidence: z.boolean().describe('True for visible website or app changes, or an explicit request for new screenshots. Removing old screenshot artifacts from Git is a repository cleanup. Use false for that task unless new captures are also requested.'),
      prepareRelease: z.boolean().optional().describe('True only if the user requested shipping. Opening a PR alone does not request release. Execution needs separate human release approval.'),
      agentId: z.string().uuid().optional().describe('A developer on this project; omit to let the project route implementation.'),
    }, async i => {
      // Local and remote attachments can share a name. Validate the selected
      // project attachment on this machine; never substitute a repo by basename.
      if (onCloudMachine()) {
        const [repo] = await db.getAll<{clone_url: string | null; local_path: string | null}>(`
          select r.clone_url,r.local_path from repos r
          join project_repos pr on pr.repo_id=r.id
          join threads th on th.project_id=pr.project_id and th.workspace_id=r.workspace_id
          where th.id=? and r.workspace_id=? and r.id=?`, [threadId, ch.workspace_id, i.repoId]);
        if (!repo) throw new Error('Choose a repository attached to this project.');
        if (!repo.clone_url && !(repo.local_path && await localRepoRemote(repo.local_path))) {
          throw new Error('This repository is a local checkout with no remote accessible on the cloud machine. Call list_repos and choose the matching GitHub or GitLab attachment by organization and repository ID, or ask the user to connect it.');
        }
      }
      const existing = i.taskNumber ? await db.get<{id:string}>('select id from tasks where workspace_id=? and channel_id=? and number=?',[ch.workspace_id,ch.id,i.taskNumber]) : null;
      if (i.taskNumber && !existing) throw new Error('That task is not in this project.');
      if (i.taskId && existing && i.taskId!==existing.id) throw new Error('The task number and ID do not match.');
      const taskId=i.taskId ?? existing?.id;
      const response = await post('/v1/commands', actor, { type:'task.create', workspace:ch.workspace_id, channel:ch.id,
        originThread:threadId, permissionRunId:t.permissionRunId, codingHandoff:{requestId:i.requestId,visualEvidence:i.visualEvidence,prepareRelease:i.prepareRelease,...(taskId?{taskId}:{})}, title:i.title, description:normalizeTaskMarkdown(`${i.roleContext}\n\n${i.description}\n\n## References\n${i.references.map(r => `- ${r}`).join('\n') || 'No additional references.'}\n\n## Validation\n${i.validation.map(v => `- ${v}`).join('\n')}`),
        kind:i.kind, repo:{id:i.repoId,baseRef:i.baseRef}, ...(i.agentId ? {offerTo:i.agentId} : {}),
        checklist:i.acceptance, definitionOfDone:i.acceptance.join('\n'), plan:{legs:['build','review'],subtasks:[],approach:normalizeTaskMarkdown(`${i.approach}\n\n## Definition of done\n${i.acceptance.map(v => `- [ ] ${v}`).join('\n')}\n\n## Validation\n${i.validation.map(v => `- ${v}`).join('\n')}`)} });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? result.error ?? 'Could not create the coding task.');
      return text(JSON.stringify(result));
    }),
    tool('read_coding_tasks', 'Read the current state, implementation progress and PR for coding work owned by this agent thread. Status is evidence, not permission to approve or merge. Parent updates arrive automatically; use this when asked for current status, not a polling loop.', {}, async () => {
      const rows = await db.getAll(`select t.number,t.title,t.state,t.pr_url,t.pr_number,t.submitted_sha,th.id as thread_id,cs.state as runtime_state,cs.last_line
        from tasks t join threads th on th.task_id=t.id left join code_sessions cs on cs.id=th.id
        join threads origin on origin.id=t.origin_thread_id join threads current on current.project_id=origin.project_id and current.home_agent_id=origin.home_agent_id
        where t.workspace_id=? and current.id=? and th.kind='coding' order by t.updated_at desc limit 20`, [ch.workspace_id,threadId]);
      return text(JSON.stringify(rows));
    }),
  ];
}
