// A person's model for each agent (0148, docs/design/models-and-replies-2026-10/plan.md §4): one
// object, two implementations, the store/announce.ts way, so memory.ts and pgstore.ts (both at their
// size caps) each gain one line. A write touches the actor's OWN row only: the handler passes the
// actor's id, and there is no argument that names another member.
import { parseAgentModels, type AgentModelPick, type AgentModelPicks } from '@neuramesh/shared';
import type postgres from 'postgres';
import { DomainError } from '../errors';

export interface AgentModelStore {
  /** the member's picks, by agent id (empty when none, or when not a member) */
  get(workspace: string, userId: string): Promise<AgentModelPicks>;
  /** set one agent's pick on the member's own row, or clear it (null) */
  set(workspace: string, userId: string, agentId: string, pick: AgentModelPick | null): Promise<void>;
}

/** the test double: membership and agents come from the memory store's own maps */
export class MemAgentModelStore implements AgentModelStore {
  readonly rows = new Map<string, AgentModelPicks>();
  constructor(
    private readonly isMember: (workspace: string, userId: string) => boolean = () => false,
    private readonly agentOf: (id: string) => { workspace: string; retired: boolean } | undefined = () => undefined,
  ) {}
  async get(workspace: string, userId: string): Promise<AgentModelPicks> {
    return { ...(this.rows.get(`${workspace}/${userId}`) ?? {}) };
  }
  async set(workspace: string, userId: string, agentId: string, pick: AgentModelPick | null): Promise<void> {
    if (!this.isMember(workspace, userId)) throw new DomainError('NOT_FOUND', `not a member of ${workspace}`);
    const a = this.agentOf(agentId);
    if (!a || a.workspace !== workspace || a.retired) throw new DomainError('NOT_FOUND', `agent ${agentId} is not in this workspace`);
    const key = `${workspace}/${userId}`;
    const next = { ...(this.rows.get(key) ?? {}) };
    if (pick) next[agentId] = pick; else delete next[agentId];
    this.rows.set(key, next);
  }
}

export class PgAgentModelStore implements AgentModelStore {
  constructor(private readonly sql: postgres.Sql) {}
  async get(workspace: string, userId: string): Promise<AgentModelPicks> {
    const [row] = await this.sql<Array<{ agent_models: unknown }>>`select agent_models from workspace_members
      where workspace_id = ${workspace}::uuid and user_id = ${userId}::uuid`;
    return parseAgentModels(row?.agent_models ?? null);
  }
  async set(workspace: string, userId: string, agentId: string, pick: AgentModelPick | null): Promise<void> {
    const sql = this.sql;
    const [agent] = await sql<Array<{ id: string }>>`select id from agents
      where id = ${agentId}::uuid and workspace_id = ${workspace}::uuid and retired_at is null`;
    if (!agent) throw new DomainError('NOT_FOUND', `agent ${agentId} is not in this workspace`);
    // sql.json for the jsonb value (a stringified bind double-encodes), and `-` to clear one key
    const [row] = pick
      ? await sql<Array<{ user_id: string }>>`update workspace_members
          set agent_models = coalesce(agent_models, '{}'::jsonb) || jsonb_build_object(${agentId}::text, ${sql.json(pick as never)}::jsonb)
        where workspace_id = ${workspace}::uuid and user_id = ${userId}::uuid returning user_id`
      : await sql<Array<{ user_id: string }>>`update workspace_members
          set agent_models = coalesce(agent_models, '{}'::jsonb) - ${agentId}::text
        where workspace_id = ${workspace}::uuid and user_id = ${userId}::uuid returning user_id`;
    if (!row) throw new DomainError('NOT_FOUND', `not a member of ${workspace}`);
  }
}
