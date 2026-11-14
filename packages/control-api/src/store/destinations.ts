import type postgres from 'postgres';
import type { Actor, Destination, DestinationPerson } from '@neuramesh/shared';
export interface DestinationStore {
  directory(workspace: string): Promise<Omit<DestinationPerson, 'hasAccess'>[]>;
  granted(workspace: string, destination: Destination): Promise<Array<{ kind: 'human' | 'agent'; id: string }>>;
  set(workspace: string, destination: Destination, kind: 'human' | 'agent', id: string, on: boolean, by: string): Promise<void>;
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
    const agents = await this.sql`select id,name,role,description from agents where workspace_id=${workspace}::uuid and retired_at is null order by name`;
    return [...humans.map(r => ({ id: String(r.id), kind: 'human' as const, name: String(r.name), role: String(r.role), description: null, owner: r.role === 'owner' })), ...agents.map(r => ({ id: String(r.id), kind: 'agent' as const, name: String(r.name), role: String(r.role), description: r.description == null ? null : String(r.description), owner: false }))];
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
}
export async function destinationPermission(store: DestinationStore, actor: Actor, workspace: string, destination: Destination) {
  const [directory, grants] = await Promise.all([store.directory(workspace), store.granted(workspace, destination)]);
  const me = directory.find(p => p.kind === actor.kind && p.id === actor.id);
  const canManage = !!me?.owner;
  const people = directory.map(p => ({ ...p, hasAccess: p.owner || grants.some(g => g.kind === p.kind && g.id === p.id) }));
  const canView = !!me && (canManage || people.some(p => p.kind === actor.kind && p.id === actor.id && p.hasAccess));
  return { destination, canManage, canView, people: canManage ? people : canView ? people.filter(p => p.hasAccess) : [] };
}
