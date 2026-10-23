import type postgres from 'postgres';
import { backfillThreadProjects } from './thread-project-backfill';

/** Every batch commits independently. Null ownership is the durable checkpoint. */
export async function backfillProjectOwnership(sql: postgres.Sql, workspace: string, options: { batchSize: number; maxBatches: number }) {
  const result: Record<string, { updated: number; remaining: number; conflicts: number }> = {
    threads: await backfillThreadProjects(sql, workspace, options),
  };
  for (const table of ['tasks', 'artifacts', 'schedules', 'content_items', 'whiteboards', 'facts', 'skills', 'skill_packs']) {
    let updated = 0;
    for (let batch = 0; batch < options.maxBatches; batch++) {
      const n = await sql.begin(async tx => {
        await tx`set local lock_timeout = '3s'`;
        await tx`set local statement_timeout = '15s'`;
        const rows = await tx`with batch as (
          select t.id from ${tx(table)} t where t.workspace_id = ${workspace}::uuid
            and t.project_id is null and t.channel_id is not null order by t.id limit ${options.batchSize} for update skip locked
        ) update ${tx(table)} t set project_id = c.project_id from batch b, channels c
          where t.id = b.id and c.id = t.channel_id and c.workspace_id = t.workspace_id returning t.id`;
        return rows.length;
      });
      updated += n;
      if (!n) break;
    }
    const [state] = await sql`select count(*) filter (where t.project_id is null)::int as remaining,
      count(*) filter (where t.project_id is not null and t.project_id is distinct from c.project_id)::int as conflicts
      from ${sql(table)} t join channels c on c.id = t.channel_id where t.workspace_id = ${workspace}::uuid`;
    // A promoted artifact can intentionally belong to a different library project.
    result[table] = { updated, remaining: Number(state?.['remaining'] ?? 0), conflicts: table === 'artifacts' ? 0 : Number(state?.['conflicts'] ?? 0) };
  }
  return result;
}
