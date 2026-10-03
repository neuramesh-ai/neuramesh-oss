// WHO A TURN SERVES, AND WHAT THEY PICKED (docs/design/models-and-replies-2026-10/plan.md §4). A
// person's model for an agent lives on their own member row (workspace_members.agent_models, 0148),
// and seatFor (host/staffing.ts) reads it for the REQUESTER: the person whose message woke the agent,
// else the person who started the conversation, else the person who made the unit (or started the
// conversation the unit came from). All of it from the replica, so every machine seats the same way
// on every interface the person used.
import { STARTER_MODEL, isCustomPackId, parseAgentModels, runtimeForModel, seatModel, thinkingFor, type AgentModelPick, type AgentRole, type CustomModelPack } from '@neuramesh/shared';
import type { HostedAgent } from '../agents';
import { owningThread, reseatOnStarter } from './starterfallback';

type Db = { get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined | null> };
export type SeatScope = { threadId?: string | null; taskId?: string | null; trigger?: string | null };

/** 'human:<id>' (threads.created_by) → the id, else null */
const humanOf = (createdBy: string | null | undefined): string | null =>
  createdBy?.startsWith('human:') ? createdBy.slice('human:'.length) || null : null;

/** the human a turn serves, or null (an agent's own sweep, a turn nobody asked for) */
export async function requesterOf(db: Db, scope: SeatScope): Promise<string | null> {
  // the replica's `get` throws on an empty result (PowerSync), so every read is caught to undefined
  const one = <T>(sql: string, params: unknown[]) => db.get<T>(sql, params).catch(() => undefined);
  if (scope.trigger) {
    const m = await one<{ author_kind: string; author_id: string }>('select author_kind, author_id from messages where id = ?', [scope.trigger]);
    if (m?.author_kind === 'human' && m.author_id) return m.author_id;
  }
  if (scope.threadId) {
    const t = await one<{ created_by: string | null }>('select created_by from threads where id = ?', [scope.threadId]);
    const who = humanOf(t?.created_by);
    if (who) return who;
  }
  if (scope.taskId) {
    const t = await one<{ creator_kind: string | null; creator_id: string | null; origin_thread_id: string | null }>(
      'select creator_kind, creator_id, origin_thread_id from tasks where id = ?', [scope.taskId]);
    if (t?.creator_kind === 'human' && t.creator_id) return t.creator_id;
    // an agent made the unit (rex, from a conversation): the person who started that conversation
    const origin = t?.origin_thread_id
      ? await one<{ created_by: string | null }>('select created_by from threads where id = ?', [t.origin_thread_id])
      : undefined;
    return humanOf(origin?.created_by);
  }
  return null;
}

/** the requester's pick for this agent, read from their member row, or null */
export async function memberPickOf(db: Db, workspace: string, requester: string, agentId: string): Promise<AgentModelPick | null> {
  const row = await db.get<{ agent_models: string | null }>(
    'select agent_models from workspace_members where workspace_id = ? and user_id = ?', [workspace, requester],
  ).catch(() => undefined);
  return parseAgentModels(row?.agent_models ?? null)[agentId] ?? null;
}

// does the server serve the NeuraMesh brain (/v1/usage brain.serves): the local stack and a server
// without the key do not, and there an automation keeps its configured brain. Asked once per
// workspace every ten minutes; an answer that cannot be read keeps the configured brain too.
const HOUSE_TTL_MS = 10 * 60_000;
const houseSeen = new Map<string, { at: number; serves: boolean }>();
export async function houseBrainHere(apiUrl: string, workspace: string, headers: () => Promise<Record<string, string>>): Promise<boolean> {
  const seen = houseSeen.get(workspace);
  if (seen && Date.now() - seen.at < HOUSE_TTL_MS) return seen.serves;
  let serves = false;
  try {
    const res = await fetch(`${apiUrl}/v1/usage?workspace=${encodeURIComponent(workspace)}`, { headers: await headers() });
    serves = res.ok && ((await res.json()) as { brain?: { serves?: boolean } }).brain?.serves === true;
  } catch { serves = false; }
  houseSeen.set(workspace, { at: Date.now(), serves });
  return serves;
}
/** tests only: forget the probe's answers */
export const forgetHouseBrain = (): void => houseSeen.clear();

/**
 * The agent as it should run for this work: the channel's project, the conversation, and the person
 * the turn serves (seatFor in host/staffing.ts is this with the host's reads).
 *
 * `automation > thread > requester's pick > pin > project > workspace`, the last five decided by
 * `seatModel` in packages/shared so the precedence lives in one tested place. An automation (a
 * scheduled run's conversation, and the units anchored to it) uses the NeuraMesh brain wherever the
 * server serves one (George, 2026-10-02), so neither a person's pick nor a vendor login reaches it.
 */
export async function seatAgent(
  agent: HostedAgent, channelId: string, scope: SeatScope | undefined,
  deps: { db: Db; customPacksFor: (workspace: string) => Promise<CustomModelPack[]>; houseBrain: (workspace: string) => Promise<boolean> },
): Promise<HostedAgent> {
  const { db } = deps;
  // the conversation that owns the turn: its override, and whether a schedule opened it. Read BEFORE
  // the pin short-circuit (2026-09-17): a pinned orchestrator used to skip it, so a routine's Starter
  // stamp never seated him and the routine ran on the human's vendor login.
  const owner = scope ? await owningThread(db, scope).catch(() => null) : null;
  const row = await db.get<{ workspace_id: string; model_pack: string | null }>(
    `select c.workspace_id, p.model_pack from channels c
       left join projects p on p.id = c.project_id
      where c.id = ?`,
    [channelId],
  ).catch(() => null);
  if (owner?.routine && row && await deps.houseBrain(row.workspace_id)) {
    if (agent.model === STARTER_MODEL && !agent.thinking) return agent;
    console.log(`agent_seat agent=${agent.name} automation ${agent.model} → ${STARTER_MODEL}`);
    return { ...reseatOnStarter(agent), thinking: null };
  }
  const threadOverride = owner?.override ?? null;
  const requester = scope && row ? await requesterOf(db, scope) : null;
  const pick = requester && row ? await memberPickOf(db, row.workspace_id, requester, agent.id) : null;
  if ((agent.modelSource ?? 'pack') === 'manual' && !threadOverride && !pick) return agent;
  const pack = row?.model_pack ?? null;
  // no project pack, no thread override, no pick → the workspace materialization stands
  if (!pack && !threadOverride && !pick) return agent;
  const custom = pack && isCustomPackId(pack) ? await deps.customPacksFor(row!.workspace_id) : [];
  const model = seatModel({ role: agent.role as AgentRole, currentModel: agent.model, modelSource: agent.modelSource, projectPack: pack, custom, threadOverride, memberPick: pick?.model ?? null });
  const thinking = thinkingFor(model, pick);
  if (model === agent.model && thinking === (agent.thinking ?? null)) return agent;
  const why = threadOverride?.[agent.role as AgentRole] ? 'thread_brain' : pick?.model === model ? `member_pick=${requester}` : `project_pack=${pack}`;
  console.log(`agent_seat agent=${agent.name} ${why} ${agent.model} → ${model}${thinking ? ` thinking=${thinking}` : ''}`);
  return { ...agent, model, runtime: runtimeForModel(model), thinking };
}
