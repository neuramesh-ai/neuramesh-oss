import { playbookFromAsk } from '@neuramesh/shared';

/** Read original asks, not mutable titles or the last reply. Chat-only playbooks have no task
 * or post receipt, but must stay discoverable after the agent retitles their conversation. */
export async function marketingThreadIds(db: { getAll<T>(sql: string, params: unknown[]): Promise<T[]> }, workspaceId: string): Promise<string[]> {
  const asks = await db.getAll<{ thread_id: string; body: string }>(
    `select thread_id, body from messages where workspace_id = ? and author_kind = 'human'
      and thread_id is not null and lower(body) like '%run the %playbook%'`, [workspaceId]);
  return [...new Set(asks.filter((m) => playbookFromAsk(m.body)).map((m) => m.thread_id))];
}
