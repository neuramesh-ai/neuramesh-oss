import type postgres from 'postgres';
import type { Actor, Destination, DestinationPerson } from '@neuramesh/shared';
import { ensureFinanceAgentSql, FINANCE_AGENT } from './finance-agent';
import { ensureSalesAgentSql } from './sales-agent';
import { SALES_ROOM_SLUG } from '@neuramesh/shared';
export interface DestinationStore {
  directory(workspace: string): Promise<Omit<DestinationPerson, 'hasAccess'>[]>;
  granted(workspace: string, destination: Destination): Promise<Array<{ kind: 'human' | 'agent'; id: string }>>;
  set(workspace: string, destination: Destination, kind: 'human' | 'agent', id: string, on: boolean, by: string): Promise<void>;
  /** the workspace's Finance agent, seeded once (finance-agent.ts); only Postgres has agents to seed */
  ensureFinanceAgent?(workspace: string): Promise<void>;
  /** the workspace's sales agent and its `sales` room, seeded once (sales-agent.ts) */
  ensureSalesAgent?(workspace: string): Promise<void>;
}
export class MemDestinationStore implements DestinationStore {
  private rows = new Map<string, { kind: 'human' | 'agent'; id: string }[]>();
  constructor(private readonly list: (workspace: string) => Promise<Omit<DestinationPerson, 'hasAccess'>[]> = async () => []) {}
  directory(workspace: string) { return this.list(workspace); }
  async granted(workspace: string, destination: Destination) { return structuredClone(this.rows.get(`${workspace}:${destination}`) ?? []); }
  async set(workspace: string, destination: Destination, kind: 'human' | 'agent', id: string, on: boolean) {
    const key = `${workspace}:${destination}`; const rows = (this.rows.get(key) ?? []).filter(r => r.kind !== kind || r.id !== id);
    if (on) rows.push({ kind, id }); this.rows.set(key, rows);
  }
}
export class PgDestinationStore implements DestinationStore {
  constructor(private readonly sql: postgres.Sql) {}
  async directory(workspace: string): Promise<Omit<DestinationPerson, 'hasAccess'>[]> {
    const humans = await this.sql`select m.user_id as id, coalesce(m.display_name,u.email,'Member') as name,m.role from workspace_members m join nm_users u on u.id=m.user_id where m.workspace_id=${workspace}::uuid order by m.created_at`;
    const agents = await this.sql`select id,name,role,description,emoji,model from agents where workspace_id=${workspace}::uuid and retired_at is null order by name`;
    return [...humans.map(r => ({ id: String(r.id), kind: 'human' as const, name: String(r.name), role: String(r.role), description: null, owner: r.role === 'owner' })), ...agents.map(r => ({ id: String(r.id), kind: 'agent' as const, name: String(r.name), role: String(r.role), description: r.description == null ? null : String(r.description), owner: false, emoji: r.emoji == null ? null : String(r.emoji), model: String(r.model) }))];
  }
  async granted(workspace: string, destination: Destination) {
    const rows = await this.sql`select principal_kind,principal_id from workspace_destination_members where workspace_id=${workspace}::uuid and destination=${destination}`;
    return rows.map(r => ({ kind: r.principal_kind as 'human' | 'agent', id: String(r.principal_id) }));
  }
  async set(workspace: string, destination: Destination, kind: 'human' | 'agent', id: string, on: boolean, by: string) {
    await this.sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`destination:${workspace}:${destination}`},0))`;
      if (on) await tx`insert into workspace_destination_members(workspace_id,destination,principal_kind,principal_id,added_by) values(${workspace}::uuid,${destination},${kind},${id}::uuid,${by}::uuid) on conflict do nothing`;
      else await tx`delete from workspace_destination_members where workspace_id=${workspace}::uuid and destination=${destination} and principal_kind=${kind} and principal_id=${id}::uuid`;
      await tx`insert into workspace_destination_revisions(workspace_id,destination,revision) values(${workspace}::uuid,${destination},1) on conflict(workspace_id,destination) do update set revision=workspace_destination_revisions.revision+1`;
      await tx`select pg_notify('nm_sync',${workspace})`;
    });
  }
  async ensureFinanceAgent(workspace: string): Promise<void> {
    // the Finance page polls access, so the common answer (already seeded) takes no lock
    if ((await this.sql`select 1 from agents where workspace_id=${workspace}::uuid and (role='finance' or lower(name)=${FINANCE_AGENT.name}) limit 1`).length) return;
    await this.sql.begin(async tx => ensureFinanceAgentSql(tx as unknown as postgres.Sql, workspace));
  }
  async ensureSalesAgent(workspace: string): Promise<void> {
    // the Sales page reads access on each open, so the common answer (both seeded) takes no lock
    const [ready] = await this.sql`select exists(select 1 from agents where workspace_id=${workspace}::uuid and role='sales' and retired_at is null)
      and exists(select 1 from channels c join projects p on p.id=c.project_id and p.is_default where c.workspace_id=${workspace}::uuid and c.slug=${SALES_ROOM_SLUG}) as ok`;
    if (ready?.['ok']) return;
    await this.sql.begin(async tx => ensureSalesAgentSql(tx as unknown as postgres.Sql, workspace));
  }
}
export async function destinationPermission(store: DestinationStore, actor: Actor, workspace: string, destination: Destination) {
  const [directory, grants] = await Promise.all([store.directory(workspace), store.granted(workspace, destination)]);
  const me = directory.find(p => p.kind === actor.kind && p.id === actor.id);
  const canManage = !!me?.owner;
  const people = directory.map(p => ({ ...p, hasAccess: p.owner || grants.some(g => g.kind === p.kind && g.id === p.id) }));
  const canView = !!me && (canManage || people.some(p => p.kind === actor.kind && p.id === actor.id && p.hasAccess));
  return { destination, canManage, canView, people: canManage ? people : canView ? people.filter(p => p.hasAccess) : [] };
}
