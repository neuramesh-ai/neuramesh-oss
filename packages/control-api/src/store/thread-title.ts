import type postgres from 'postgres';
import { DomainError } from '../errors';

/** Serialize generated titles with human renames, and keep old Code-list readers in sync. */
export async function updateThreadTitleSql(sql: postgres.Sql, workspace: string, threadId: string,
  patch: { title?: string; description?: string }, opts?: { agentTitleOnce?: boolean }): Promise<void> {
  await sql.begin(async tx => {
    const [current] = await tx`select titled_at from threads where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid for update`;
    if (!current) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
    if (patch.title !== undefined && opts?.agentTitleOnce && current['titled_at']) {
      throw new DomainError('THREAD_ALREADY_TITLED', 'this conversation is already named — only the human renames it');
    }
    await tx`update threads set title = coalesce(${patch.title ?? null}, title),
      titled_at = case when ${patch.title ?? null}::text is not null then now() else titled_at end,
      description = coalesce(${patch.description ?? null}, description), updated_at = now()
      where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid`;
    if (patch.title !== undefined) await tx`update code_sessions set title = ${patch.title}
      where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid`;
  });
}
