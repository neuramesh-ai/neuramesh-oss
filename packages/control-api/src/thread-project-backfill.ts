import type postgres from 'postgres';

/** Null is the durable checkpoint. Each batch commits on its own and can run again. */
export async function backfillThreadProjects(sql: postgres.Sql, workspace: string, options: { batchSize: number; maxBatches: number }) {
  const { batchSize, maxBatches } = options;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000 || !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 10000) {
    throw new Error('Use a batch size from 1 to 1000 and a batch count from 1 to 10000.');
  }
  let updated = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const count = await sql.begin(async (tx) => {
      await tx`set local lock_timeout = '3s'`;
      await tx`set local statement_timeout = '15s'`;
      const rows = await tx`
        with batch as (
          select t.id from threads t
          where t.workspace_id = ${workspace}::uuid and t.project_id is null
          order by t.id limit ${batchSize} for update skip locked
        )
        update threads t set project_id = c.project_id from batch b, channels c
          where t.id = b.id and c.id = t.channel_id and c.workspace_id = t.workspace_id
        returning t.id`;
      return rows.length;
    });
    updated += count;
    if (!count) break;
  }
  const [state] = await sql`
    select count(*) filter (where t.project_id is null)::int as remaining,
      count(*) filter (where t.project_id is not null and t.project_id is distinct from c.project_id)::int as conflicts
    from threads t join channels c on c.id = t.channel_id where t.workspace_id = ${workspace}::uuid`;
  return { updated, remaining: Number(state?.['remaining'] ?? 0), conflicts: Number(state?.['conflicts'] ?? 0) };
}
