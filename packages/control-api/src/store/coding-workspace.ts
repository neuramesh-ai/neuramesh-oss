// THE CODING WORKSPACE OF A THREAD (round 9, 0177). A coding thread works in one of two workspaces:
//   repo     a worktree of a project repository (the old rule, and the repo chip)
//   scratch  a local scratch workspace: a fresh git repository on the machine, with no remote
//
// bindCodingWorkspace is the one gate for both callers:
//   - thread.set_kind {kind: 'coding', codeWorkspace} (handler/thread.ts), after its actor check
//   - the intake service (round 9), which decides the workspace from the first message
// It refuses a task thread (its unit is the code path already) and a repo mode with no repository.
// A scratch mode needs no repository. The machine reads threads.workspace_mode (and threads.intake for
// the name) when the session opens (apps/desktop relay/engineering-scratch.ts).
//
// Inside a transaction, use setThreadKindSql(tx, workspace, threadId, 'coding', mode) from
// store/thread-machine.ts after the same checks.
import type { WorkspaceMode } from '@neuramesh/shared';
import { DomainError } from '../errors';
import type { Store } from '../store';

export interface CodingWorkspaceInput {
  workspace: string;
  threadId: string;
  mode: WorkspaceMode;
  /** repo mode only: the repository to work on. Absent: the project's primary repository */
  repoId?: string | null;
}

export interface CodingWorkspaceBound { threadId: string; kind: 'coding'; codeWorkspace: WorkspaceMode; repoId: string | null }

export async function bindCodingWorkspace(store: Pick<Store, 'threadFiling' | 'setThreadKind' | 'announcements'>, input: CodingWorkspaceInput): Promise<CodingWorkspaceBound> {
  const subject = await store.threadFiling(input.workspace, input.threadId);
  if (!subject) throw new DomainError('NOT_FOUND', `thread ${input.threadId} not found`);
  if (subject.taskId) throw new DomainError('TASK_THREAD', 'a task thread is already the code path — its unit carries the worktree and the pull request');
  let repoId: string | null = null;
  if (input.mode === 'repo') {
    const repo = await store.announcements?.repoForChannel(subject.channelId, input.repoId ?? undefined);
    if (!repo || (input.repoId && repo.repoId !== input.repoId)) throw new DomainError('REPO_REQUIRED', 'connect a repository to this project before code work can start here');
    repoId = repo.repoId;
  }
  await store.setThreadKind(input.workspace, input.threadId, 'coding', input.mode);
  return { threadId: input.threadId, kind: 'coding', codeWorkspace: input.mode, repoId };
}
