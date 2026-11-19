// INTAKE, THE WRITE (round 9). One transaction applies an intake decision (control-api src/intake.ts):
// the decision, the title, and for a coding ask the kind and the workspace. It applies only while the
// thread is still in its first turn, so a late decision never overrides what already happened:
//   - no decision is stored yet (a second message never re-runs intake),
//   - no agent has answered yet, and the person has sent only the one message,
//   - the thread is no task thread (its unit is the code path already).
// A person's own choices win: a title someone set (titled_at) stays, and a thread a person already made
// a coding thread (the repo chip, or thread.set_kind) keeps its kind and workspace.
// The kind flip uses setThreadKindSql (store/thread-machine.ts), the leaf thread.set_kind writes through,
// after the same checks as store/coding-workspace.ts bindCodingWorkspace: a repo mode needs a repository
// of the thread's project, a scratch mode needs none.
import type postgres from 'postgres';
import type { IntakeDecision, WorkspaceMode } from '@neuramesh/shared';
import { setThreadKindSql } from './thread-machine';

/** What the write did. `stale`: the thread moved on before the decision landed, nothing was written. */
export type IntakeApplied = 'coding' | 'stored' | 'stale';

export async function applyIntakeSql(sql: postgres.Sql, input: {
  workspace: string;
  threadId: string;
  decision: IntakeDecision;
  effects: { kind: 'coding' | null; workspaceMode: WorkspaceMode | null; repoId: string | null };
}): Promise<IntakeApplied> {
  const { workspace, threadId, decision, effects } = input;
  return sql.begin(async (tx) => {
    const q = tx as unknown as postgres.Sql;
    // Replicated writes take the sync revision before touching rows (store/thread-title.ts): the same
    // lock order as every other thread write, so this never deadlocks with a permission save.
    await q`select revision from local_sync_state where singleton and enabled for update`;
    const [t] = await q`
      select t.kind, t.workspace_mode, t.intake, t.titled_at, t.task_id, t.project_id,
             (select count(*)::int from messages m where m.thread_id = t.id and m.author_kind = 'human') as humans,
             (select count(*)::int from messages m where m.thread_id = t.id and m.author_kind = 'agent') as agents
        from threads t where t.id = ${threadId}::uuid and t.workspace_id = ${workspace}::uuid for update`;
    if (!t || t['intake'] || t['task_id'] || Number(t['agents']) > 0 || Number(t['humans']) > 1) return 'stale' as const;
    const named = !!t['titled_at'];
    const flip = effects.kind === 'coding' && t['kind'] !== 'coding';
    let mode: WorkspaceMode = effects.workspaceMode ?? 'scratch';
    if (flip && mode === 'repo') {
      // the bindCodingWorkspace check, inside this transaction: the repository belongs to the thread's project
      const [bound] = effects.repoId && t['project_id']
        ? await q`select 1 from project_repos where project_id = ${t['project_id'] as string}::uuid and repo_id = ${effects.repoId}::uuid`
        : [];
      if (!bound) mode = 'scratch';
    }
    // the stored decision names the workspace that was really set up
    // (a thread a person already made a coding thread keeps its own workspace: the old rule is the primary repository)
    const stored: IntakeDecision = t['kind'] === 'coding'
      ? { ...decision, kind: 'coding', workspace: t['workspace_mode'] === 'scratch' ? 'scratch' : 'repo', repoId: null }
      : flip ? { ...decision, workspace: mode, repoId: mode === 'repo' ? effects.repoId : null } : decision;
    await q`update threads
               set intake = ${q.json(stored as never)},
                   title = case when titled_at is null then ${stored.title} else title end,
                   titled_at = coalesce(titled_at, now()),
                   updated_at = now()
             where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid`;
    if (!named) await q`update code_sessions set title = ${stored.title} where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid`;
    if (!flip) return 'stored' as const;
    await setThreadKindSql(q, workspace, threadId, 'coding', mode);
    return 'coding' as const;
  }) as Promise<IntakeApplied>;
}
