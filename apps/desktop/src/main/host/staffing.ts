// STAFFING AND SEATS — add-before-hire, the brain a seat resolves to, and the capacity
// failover when a model runs out. A hire is human-gated by construction: these functions
// propose, and a card is what commits. Extracted from agents.ts (track B2).
import type { HostedAgent } from '../agents';
import { STARTER_MODEL, isCustomPackId, runtimeForModel as runtimeForModelId, seatModel, type AgentRole } from '@neuramesh/shared';



import type { PowerSyncDatabase } from '@powersync/node';
import type { Brain } from '../harness/brain';
import type { HostQueue } from '../harness/hostqueue';






import type { makeFlows } from './flows';





import type { HostCtx } from './ctx';
import { makeHire } from './hire';
import { makeFailover } from './failover';

const MODEL_LABEL: Record<string, string> = {
  'claude-fable-5-1': 'Fable 5.1', 'claude-opus-5': 'Opus 5', 'claude-sonnet-5': 'Sonnet 5',
  'claude-fable-5': 'Fable 5', 'claude-opus-4-8': 'Opus 4.8', 'claude-sonnet-4-6': 'Sonnet 4.6', 'claude-haiku-4-5': 'Haiku 4.5',
  'gpt-6-astra': 'GPT-6 Astra', 'gpt-5.6-sol': 'GPT-5.6 Sol', 'gpt-5.6-terra': 'GPT-5.6 Terra', 'gpt-5.5': 'GPT-5.5', 'gpt-5.5-pro': 'GPT-5.5 Pro', 'gpt-5.4-mini': 'GPT-5.4 mini',
  'gemini-3.8-flash': 'Gemini 3.8 Flash', 'gemini-3.5-flash': 'Gemini 3.5 Flash', 'gemini-3.1-pro-preview': 'Gemini 3.1 Pro', 'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite',
  // the house brain, in this table's short form — a failover card is read by a human, and the
  // mark beside it already says whose brain it is
  [STARTER_MODEL]: 'NM Cloud Starter v1',
};
export const foLabel = (id: string): string => MODEL_LABEL[id] ?? id;

/** one add-offer per room and agent per day (offerAddAgents): the card is deterministic, and a
 *  second copy is noise — the answer path adds the agent, after which the room has them */
export const ADD_OFFER_COOLDOWN_MS = 24 * 3_600_000;

// The failover label table and the seat query — module scope, because both the staffing
// module and the host name a seat, and two copies of a label map is how they drift.
export type FoSeat = { id: string; role: AgentRole; model: string; model_source: string | null; kind: string | null; retired_at: string | null };
export const FO_SEAT_SQL = `select id, role, model, model_source, kind, retired_at from agents where workspace_id = ? and retired_at is null`;

export function makeStaffing(ctx: HostCtx & {
  agents: Map<string, HostedAgent>;
  apiUrl: string;
  brain: Brain;
  claimed: { has: (id: string) => boolean; add: (id: string) => unknown; delete: (id: string) => boolean };
  db: PowerSyncDatabase;
  execQueue: HostQueue;
  machineId: string;
  ownerActorId: string;
  post: unknown;
  resumeFlow: ReturnType<typeof makeFlows>['resumeFlow'];
  workspace: string;
}) {
const { db, post } = ctx;

  // Split-out neighbours: same ctx, so every call below keeps the name it always used.
  const { executeHire, confirmCreateAgent, activePackRoles, activePackId, customPacksFor, threadBrain } = makeHire(ctx);
  const { handleExhaustion, confirmFailover } = makeFailover({ ...ctx, activePackId });

// ── Capacity failover (docs/22 §9): a usage cap → a human-confirmed re-seat ──────────────
// Detection is deterministic (classifyExecError → composeFailover over the live logins); the human
// is the only actor who can apply it (the card is HUMAN_ONLY to answer). One card per (workspace,
// model); the exhausted task is parked WITHOUT the futile 4s retry on the capped model. NOTE: the
// card's auto-revert toggle is captured in the payload but the reset-detection sweep is a follow-up
// (docs/22 slice 4) — v1 applies the switch and reports; the human reverts in Settings.

// B3 (agent channel scoping): a human tagged a workspace agent that ISN'T in this channel.
// Agents only see the rooms they're added to, so it can't answer — instead the orchestrator
// posts an nmq "add @agent?" card. Clicking "Add @agent" posts "…→ Add @agent" back, which the
// channel watch routes to confirmAddAgent. Membership is host-enforced — no LLM round-trip.
async function offerAddAgents(orch: HostedAgent, channelId: string, absent: HostedAgent[]) {
  const ch = await db.get<{ workspace_id: string; slug: string }>('select workspace_id, slug from channels where id = ?', [channelId]).catch(() => null);
  if (!ch) return;
  const actor = { kind: 'agent', id: orch.id, role: 'orchestrator' };
  for (const a of absent) {
    const card = JSON.stringify({ question: `Add @${a.name} to #${ch.slug}?`, options: [
      { label: `Add @${a.name}`, description: `${a.name} joins #${ch.slug} and can see + respond here` },
      { label: 'Not now', description: 'keep this room as it is' },
    ] });
    const since = new Date(Date.now() - ADD_OFFER_COOLDOWN_MS).toISOString();
    const offered = await db.get<{ id: string }>(
      'select id from messages where channel_id = ? and created_at > ? and body like ? limit 1',
      [channelId, since, `%"question":"Add @${a.name} to #${ch.slug}?"%`],
    ).catch(() => null);
    if (offered) continue;
    await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: channelId,
      body: `@${a.name} isn't in #${ch.slug} yet — agents only see the rooms they're added to, so they didn't get that. Want me to bring them in?\n\n\`\`\`nmq\n${card}\n\`\`\`` }).catch(() => {});
  }
}
// the human clicked "Add @agent" on the card — register it (attributed to the orchestrator, which
// owns membership). channel.add_agent rebuilds the agent's A2A card so the room flows into discovery.
async function confirmAddAgent(orch: HostedAgent, channelId: string, agentName: string) {
  const ch = await db.get<{ workspace_id: string; slug: string }>('select workspace_id, slug from channels where id = ?', [channelId]).catch(() => null);
  if (!ch) return;
  const actor = { kind: 'agent', id: orch.id, role: 'orchestrator' };
  const r = await post('/v1/commands', actor, { type: 'channel.add_agent', workspace: ch.workspace_id, channel: channelId, agent: agentName }).catch(() => null);
  if (r?.ok) await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: channelId,
    body: `Added @${agentName} to #${ch.slug} — they're in the room now. Tag them and they'll jump in.` }).catch(() => {});
}
/**
 * The agent as it should run for work in this channel's project — and, when the work has a
 * conversation, under that conversation's brain override.
 *
 * `pin > thread > project > workspace`, all of it decided by `seatModel` in packages/shared so
 * the precedence lives in one tested place rather than in this call site.
 */
async function seatFor(agent: HostedAgent, channelId: string, scope?: { threadId?: string | null; taskId?: string | null }): Promise<HostedAgent> {
  if ((agent.modelSource ?? 'pack') === 'manual') return agent; // a human pin outranks any pack
  const row = await db.get<{ workspace_id: string; model_pack: string | null }>(
    `select c.workspace_id, p.model_pack from channels c
       left join projects p on p.id = c.project_id
      where c.id = ?`,
    [channelId],
  ).catch(() => null);
  const pack = row?.model_pack ?? null;
  const threadOverride = scope ? await threadBrain(scope) : null;
  // no project pack AND no thread override → the workspace materialization stands
  if (!pack && !threadOverride) return agent;
  const custom = pack && isCustomPackId(pack) ? await customPacksFor(row!.workspace_id) : [];
  const model = seatModel({ role: agent.role as AgentRole, currentModel: agent.model, modelSource: agent.modelSource, projectPack: pack, custom, threadOverride });
  if (model === agent.model) return agent;
  const why = threadOverride?.[agent.role as AgentRole] ? 'thread_brain' : `project_pack=${pack}`;
  console.log(`agent_seat agent=${agent.name} ${why} ${agent.model} → ${model}`);
  return { ...agent, model, runtime: runtimeForModelId(model) };
}
  return { activePackId, activePackRoles, confirmAddAgent, confirmCreateAgent, confirmFailover, customPacksFor, executeHire, handleExhaustion, offerAddAgents, seatFor, threadBrain };
}
