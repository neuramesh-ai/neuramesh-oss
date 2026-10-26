import type postgres from 'postgres';

/** Metadata only. The transaction is read-only even when the caller has a writer credential. */
export async function projectMigrationAudit(sql: postgres.Sql, workspace: string | null = null) {
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    await tx`set local statement_timeout = '20s'`;
    const [mode] = await tx`show transaction_read_only`;
    const projects = await tx<Array<{ id: string; workspace_id: string; name: string; slug: string; status: string; is_default: boolean }>>`
      select p.id, p.workspace_id, p.name, p.slug, p.status, p.is_default
      from projects p where (${workspace}::uuid is null or p.workspace_id = ${workspace}::uuid)
      order by p.workspace_id, p.slug, p.id`;
    const channels = await tx`
      select c.id, c.workspace_id, c.project_id, c.slug, c.kind,
        md5(c.settings::text) as settings_hash,
        case when c.marketing is not null then md5((c.marketing - 'setup_at' - 'setup_by')::text) end as brand_hash,
        (select coalesce(string_agg(ac.agent_id::text, ',' order by ac.agent_id), '') from agent_channels ac
          join agents a on a.id = ac.agent_id where ac.channel_id = c.id and a.retired_at is null) as agent_ids,
        (select count(*)::int from threads t where t.channel_id = c.id) as threads,
        (select count(*)::int from tasks t where t.channel_id = c.id) as tasks,
        (select count(*)::int from messages m where m.channel_id = c.id and m.thread_id is null and m.task_id is null) as loose_messages,
        (select count(*)::int from artifacts a where a.channel_id = c.id) as artifacts,
        (select count(*)::int from schedules s where s.channel_id = c.id and s.status = 'active' and s.next_run_at is not null) as pending_routines,
        (select count(*)::int from content_items i where i.channel_id = c.id and i.status in ('draft', 'scheduled')) as unpublished_items,
        (select count(*)::int from policies p where p.channel_id = c.id) as policies,
        (select count(*)::int from memory_blocks m where m.channel_id = c.id) as memory_blocks,
        (select count(*)::int from facts f where f.channel_id = c.id) as facts,
        (select count(*)::int from skills s where s.channel_id = c.id and s.status = 'active') as active_skills,
        (select count(*)::int from whiteboards w where w.channel_id = c.id) as whiteboards
      from channels c where (${workspace}::uuid is null or c.workspace_id = ${workspace}::uuid)
      order by c.project_id, c.slug, c.id`;
    const conflicts = await tx`
      select c.project_id, s.name, count(distinct s.channel_id)::int as rooms,
        count(distinct md5(jsonb_build_array(s.body, s.description, s.enabled, coalesce(p.enabled, true))::text))::int as versions
      from skills s join channels c on c.id = s.channel_id left join skill_packs p on p.id = s.pack_id
      where s.status = 'active' and (${workspace}::uuid is null or c.workspace_id = ${workspace}::uuid)
      group by c.project_id, s.name having count(distinct s.channel_id) > 1
        and count(distinct md5(jsonb_build_array(s.body, s.description, s.enabled, coalesce(p.enabled, true))::text)) > 1
      order by c.project_id, s.name`;
    const mismatches = await tx`
      select 'channel_workspace' as kind, c.id, c.project_id from channels c join projects p on p.id = c.project_id
        where c.workspace_id <> p.workspace_id and (${workspace}::uuid is null or c.workspace_id = ${workspace}::uuid)
      union all select 'task_project', t.id, c.project_id from tasks t join channels c on c.id = t.channel_id
        where (t.project_id is distinct from c.project_id or t.workspace_id <> c.workspace_id)
          and (${workspace}::uuid is null or t.workspace_id = ${workspace}::uuid)
      union all select 'thread_workspace', t.id, c.project_id from threads t join channels c on c.id = t.channel_id
        where t.workspace_id <> c.workspace_id and (${workspace}::uuid is null or t.workspace_id = ${workspace}::uuid)
      union all select 'connector_origin', x.id, c.project_id from connectors x join channels c on c.id = x.channel_id
        where x.project_id is distinct from c.project_id and (${workspace}::uuid is null or x.workspace_id = ${workspace}::uuid)`;
    return {
      version: 1, capturedAt: new Date().toISOString(), readOnly: mode?.['transaction_read_only'] === 'on',
      workspace, projects: projects.map((p) => {
        const rooms = channels.filter((c) => c['project_id'] === p['id']);
        const brands = new Set(rooms.map((c) => c['brand_hash']).filter(Boolean));
        return {
          ...p, channels: rooms,
          review: {
            differentAgentGrants: new Set(rooms.map((c) => c['agent_ids'])).size > 1,
            differentSettings: new Set(rooms.map((c) => c['settings_hash'])).size > 1,
            differentBrands: brands.size > 1,
            channelPolicies: rooms.reduce((n, c) => n + Number(c['policies']), 0),
            conflictingSkills: conflicts.filter((c) => c['project_id'] === p['id']),
            ownershipMismatches: mismatches.filter((m) => m['project_id'] === p['id']),
          },
        };
      }),
    };
  });
}
