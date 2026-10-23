import type postgres from 'postgres';

/** Human project view, with separate source summaries and the legacy fact limits. */
export async function memoryViewSql(sql: postgres.Sql, workspace: string, chId: string | null, project: string | null) {
    const blocks = await sql`select b.content, b.basis_count, b.updated_at, b.kind from memory_blocks b
      join channels c on c.id = b.channel_id
      where b.workspace_id = ${workspace}::uuid and b.kind = 'channel_summary' and ((${project}::uuid is not null and c.project_id = ${project}::uuid)
        or (${project}::uuid is null and b.channel_id = ${chId}::uuid))
      order by b.updated_at desc`;
    const blk = blocks[0];
    const facts = await sql`with scoped as (
      select f.id, f.content, f.kind, t.number as task_number, f.valid_from, f.valid_until, f.superseded_by
      from facts f join channels c on c.id = f.channel_id left join tasks t on t.id = f.task_id
      where f.workspace_id = ${workspace}::uuid
        and ((${project}::uuid is not null and coalesce(f.project_id, c.project_id) = ${project}::uuid)
          or (${project}::uuid is null and f.channel_id = ${chId}::uuid))
    ) (select * from scoped where valid_until is null order by valid_from desc limit 30)
      union all (select * from scoped where valid_until is not null order by valid_until desc limit 8)`;
    return {
      blocks: blocks.map(b => ({ content: b['content'] as string, basisCount: Number(b['basis_count']), updatedAt: new Date(b['updated_at']).toISOString() })),
      block: blk
        ? { content: blk['content'] as string, basisCount: Number(blk['basis_count']), updatedAt: new Date(blk['updated_at']).toISOString() }
        : null,
      facts: facts.map((f) => ({
        id: f['id'] as string,
        content: f['content'] as string,
        kind: f['kind'] as string,
        taskNumber: f['task_number'] == null ? null : Number(f['task_number']),
        validFrom: new Date(f['valid_from']).toISOString(),
        validUntil: f['valid_until'] ? new Date(f['valid_until']).toISOString() : null,
        // distinguishes a superseded lesson (has a successor) from a retired one
        supersededBy: (f['superseded_by'] as string | null) ?? null,
      })),
    };
}
