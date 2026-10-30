import type postgres from 'postgres';
import { TEAM_TEMPLATES, buildAgentCard, packModelForRole, runtimeForModel } from '@neuramesh/shared';

/** New projects reuse workspace identities; existing teams and retired identities are untouched. */
export async function seedStartupTeamSql(sql: postgres.Sql, workspace: string, projectId: string) {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`${workspace}:startup-team`},0))`;
  const [project] = await sql`select context_channel_id from projects where id=${projectId}::uuid and workspace_id=${workspace}::uuid`;
  if (!project?.['context_channel_id']) return;
  const channel = project['context_channel_id'] as string;
  const [machine] = await sql`select id from machines where workspace_id=${workspace}::uuid and (lifecycle is null or lifecycle <> 'destroyed') order by (kind='runner') desc,last_seen_at desc nulls last limit 1`;
  const selected: string[] = [];
  for (const name of ['Rex', 'Plume', 'Echo']) {
    const template = TEAM_TEMPLATES.find(t => t.name === name)!;
    const social = name === 'Echo';
    const [existing] = await sql`select id from agents where workspace_id=${workspace}::uuid and retired_at is null and role=${template.role}::agent_role
      and not (id = any(${selected}::uuid[]))
      and (${template.role} <> 'marketer' or (lower(name) ~ '^echo(-[0-9]+)?$' or coalesce(description,'') ~* 'social media') = ${social})
      order by (lower(name)=${name.toLowerCase()}) desc,created_at,id limit 1`;
    let id = existing?.['id'] as string | undefined;
    if (!id) {
      const base = name.toLowerCase(); let unique = base;
      for (let n = 2; (await sql`select 1 from agents where workspace_id=${workspace}::uuid and lower(name)=${unique}`).length; n++) unique = `${base}-${n}`;
      const [peer] = await sql`select model from agents where workspace_id=${workspace}::uuid and retired_at is null order by (role=${template.role}::agent_role) desc,created_at limit 1`;
      const model = (peer?.['model'] as string | undefined) ?? packModelForRole('openai-core', template.role)!;
      const runtime = runtimeForModel(model);
      const [created] = await sql`insert into agents(workspace_id,machine_id,name,role,model,runtime,model_source,description,brief,status)
        values(${workspace}::uuid,${machine?.['id'] ?? null}::uuid,${unique},${template.role}::agent_role,${model},${runtime},'pack',${template.description},${template.description},'online') returning id`;
      id = created!['id'] as string;
      if (machine?.['id']) {
        const card = buildAgentCard({ agentId:id,name:unique,role:template.role,model,runtime,machine:machine['id'] as string,channels:[channel],description:template.description });
        await sql`update agents set card=${sql.json(card as never)} where id=${id}::uuid`;
      }
    }
    selected.push(id);
    await sql`insert into project_agents(workspace_id,project_id,agent_id) values(${workspace}::uuid,${projectId}::uuid,${id}::uuid) on conflict do nothing`;
  }
}
