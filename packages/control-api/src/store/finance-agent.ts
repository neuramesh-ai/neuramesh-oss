import type postgres from 'postgres';
import { ROLE_DESCRIPTION, buildAgentCard } from '@neuramesh/shared';

export const FINANCE_AGENT = { name: 'ledger', emoji: '🐿️', brief: 'Answers questions about the shared money in Finance: spending, budgets, trends and single transactions, from the accounts Kinshi shares. It never moves money.' };

/** The workspace's Finance agent, seeded the way bosun and plume are: once, never a second one,
 * never over a person's agent of another role, and a retired one stays retired. It joins no room,
 * so no room message wakes it. It runs on the orchestrator's machine and model; the role grant
 * to Finance comes from the agents trigger (0189). */
export async function ensureFinanceAgentSql(sql: postgres.Sql, workspace: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`${workspace}:finance-agent`},0))`;
  const [taken] = await sql`select 1 from agents where workspace_id=${workspace}::uuid and (role='finance' or lower(name)=${FINANCE_AGENT.name}) limit 1`;
  if (taken) return;
  const [host] = await sql`select a.machine_id,a.model,a.runtime from agents a join machines m on m.id=a.machine_id
    where a.workspace_id=${workspace}::uuid and a.role='orchestrator' and a.retired_at is null and (m.lifecycle is null or m.lifecycle<>'destroyed')
    order by a.created_at limit 1`;
  if (!host) return;
  const machine = host['machine_id'] as string, model = host['model'] as string, runtime = host['runtime'] as string;
  const description = ROLE_DESCRIPTION.finance;
  const [row] = await sql`insert into agents(workspace_id,machine_id,name,role,model,runtime,model_source,emoji,description,brief,status)
    values(${workspace}::uuid,${machine}::uuid,${FINANCE_AGENT.name},'finance',${model},${runtime},'pack',${FINANCE_AGENT.emoji},${description},${FINANCE_AGENT.brief},'online')
    on conflict (workspace_id,name) do nothing returning id`;
  if (!row) return;
  const card = buildAgentCard({ agentId: row['id'] as string, name: FINANCE_AGENT.name, role: 'finance', runtime, model, machine, channels: [], description });
  await sql`update agents set card=${sql.json(card as never)} where id=${row['id'] as string}::uuid`;
}
