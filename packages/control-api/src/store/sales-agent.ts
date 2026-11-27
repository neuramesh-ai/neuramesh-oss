import type postgres from 'postgres';
import { ROLE_DESCRIPTION, SALES_AGENT, SALES_ROOM_SLUG, buildAgentCard } from '@neuramesh/shared';

/** The workspace's sales agent and its room, seeded when a person first opens Sales (plan S2, DS15), the ledger way:
 * once, never a second one, never over a person's agent of another role, and a retired one stays retired. A hired
 * sales agent (Piper) is the sales agent, so no pike is made beside it. The agent runs on the orchestrator's machine
 * and model, and its Sales grant comes from the agents trigger (0200).
 *
 * The room is one `sales` room in the default project: the Sales chat and each deal's session live there. It gets
 * the orchestrators and the sales agent once, when it is made, so a person who later takes an agent out of the room
 * keeps that choice. */
export async function ensureSalesAgentSql(sql: postgres.Sql, workspace: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`${workspace}:sales-agent`},0))`;
  let [agent] = await sql`select id from agents where workspace_id=${workspace}::uuid and role='sales' and retired_at is null order by created_at limit 1`;
  if (!agent) {
    const [taken] = await sql`select 1 from agents where workspace_id=${workspace}::uuid and (role='sales' or lower(name)=${SALES_AGENT.name}) limit 1`;
    if (taken) return;
    const [host] = await sql`select a.machine_id,a.model,a.runtime from agents a join machines m on m.id=a.machine_id
      where a.workspace_id=${workspace}::uuid and a.role='orchestrator' and a.retired_at is null and (m.lifecycle is null or m.lifecycle<>'destroyed')
      order by a.created_at limit 1`;
    if (!host) return;
    const machine = host['machine_id'] as string, model = host['model'] as string, runtime = host['runtime'] as string;
    const description = ROLE_DESCRIPTION.sales;
    [agent] = await sql`insert into agents(workspace_id,machine_id,name,role,model,runtime,model_source,emoji,description,brief,status)
      values(${workspace}::uuid,${machine}::uuid,${SALES_AGENT.name},'sales',${model},${runtime},'pack',${SALES_AGENT.emoji},${description},${SALES_AGENT.brief},'online')
      on conflict (workspace_id,name) do nothing returning id`;
    if (!agent) return;
    const card = buildAgentCard({ agentId: agent['id'] as string, name: SALES_AGENT.name, role: 'sales', runtime, model, machine, channels: [], description });
    await sql`update agents set card=${sql.json(card as never)} where id=${agent['id'] as string}::uuid`;
  }
  const [room] = await sql`select c.id from channels c join projects p on p.id=c.project_id and p.is_default
    where c.workspace_id=${workspace}::uuid and c.slug=${SALES_ROOM_SLUG} limit 1`;
  if (room) return;
  const [project] = await sql`select id from projects where workspace_id=${workspace}::uuid and is_default limit 1`;
  if (!project) return;
  const [made] = await sql`insert into channels (workspace_id, slug, topic, project_id) values (${workspace}::uuid, ${SALES_ROOM_SLUG}, ${'The Sales chat and the deal sessions'}, ${project['id'] as string}::uuid)
    on conflict do nothing returning id`;
  if (!made) return;
  await sql`insert into agent_channels (agent_id, channel_id)
    select a.id, ${made['id'] as string}::uuid from agents a
     where a.workspace_id=${workspace}::uuid and a.retired_at is null and (a.role='orchestrator' or a.id=${agent['id'] as string}::uuid)
    on conflict do nothing`;
}
