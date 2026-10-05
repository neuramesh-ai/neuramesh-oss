// THE MODEL CHIP AND THE AGENT CHIP, AS RULES (docs/design/models-and-replies-2026-10/plan.md §4).
// Pure, so a Node test reads them: the seat a person sees is the daemon's seat (host/seatpick.ts
// seatAgent), the provider state is the machines' word, and Send addresses the picked agent with the
// same `@name` the daemon routes on (shared mentions.ts). The components in this folder only draw.
import {
  addressedIn, availableMachines, isChatThread, machineOnline, parseAgentModels, parseBrainOverride, providerForModel, seatModel, STARTER_MODEL, thinkingFor, unaddressedWake,
  type AgentModelPicks, type AgentRole, type BrainOverride, type MachineCapability, type ThinkingLevel,
} from '@neuramesh/shared';

export type ProviderKey = 'anthropic' | 'openai' | 'gemini';
export type ProviderState = 'ready' | 'signin' | 'connect';
export const PROVIDER_RUNTIME: Record<ProviderKey, string> = { anthropic: 'claude-code', openai: 'codex', gemini: 'gemini' };

/** what one agent runs for this person, here. `source` says why, so the menu can say it */
export interface SeatView { model: string; thinking: ThinkingLevel | null; source: 'automation' | 'thread' | 'pick' | 'agent' }

type AgentLike = { id: string; role: string; model: string; model_source?: string | null };

/** the member row's picks, by agent id */
export const picksOf = (members: ReadonlyArray<{ user_id: string; agent_models?: string | null }>, me: string | null): AgentModelPicks =>
  parseAgentModels(members.find((m) => m.user_id === me)?.agent_models ?? null);

/**
 * The seat the daemon will take for this person: an automation runs on the NeuraMesh brain, the
 * conversation's override beats the person's pick, and the pick beats the agent's own model (and a
 * project's pack, through seatModel). Custom packs are not read here: a project on one shows the
 * agent's own model.
 */
export function seatView(agent: AgentLike, picks: AgentModelPicks, place: { override?: BrainOverride | string | null; automation?: boolean; projectPack?: string | null } = {}): SeatView {
  if (place.automation) return { model: STARTER_MODEL, thinking: null, source: 'automation' };
  const override = parseBrainOverride(place.override ?? null);
  const pick = picks[agent.id] ?? null;
  const model = seatModel({ role: agent.role as AgentRole, currentModel: agent.model, modelSource: agent.model_source ?? null, projectPack: place.projectPack ?? null, threadOverride: override, memberPick: pick?.model ?? null });
  const source = override?.[agent.role as AgentRole] ? 'thread' : pick?.model === model ? 'pick' : 'agent';
  return { model, thinking: thinkingFor(model, pick), source };
}

/** each provider's state for this person: ready when a machine they may use serves its runtime,
 *  sign-in when it is set up but no such machine serves it, connect when nothing is set up. A cloud
 *  machine counts asleep, because a message wakes it; a laptop counts only while it beats (one
 *  offline since last week read every provider as ready, live on the harness, 2026-10-02) */
export function providerStates(
  machines: ReadonlyArray<{ id: string; owner_user_id?: string | null; runtimes?: string | null; kind?: string | null; last_seen_at?: string | null }>,
  members: ReadonlyArray<{ user_id: string; compute?: string | null }>,
  me: string | null,
  configured: ReadonlySet<string>,
  now: number = Date.now(),
): Record<ProviderKey, ProviderState> {
  const sharesOf = (owner: string | null | undefined): string[] => {
    try { const c = JSON.parse(members.find((m) => m.user_id === owner)?.compute ?? '{}') as { shares?: string[] }; return Array.isArray(c.shares) ? c.shares : []; } catch { return []; }
  };
  const caps: MachineCapability[] = machines.map((m) => {
    let runtimes: string[] = [];
    try { const r = JSON.parse(m.runtimes ?? '[]'); if (Array.isArray(r)) runtimes = r.filter((x): x is string => typeof x === 'string'); } catch { /* none */ }
    return { machineId: m.id, ownerUserId: m.owner_user_id ?? '', runtimes, lastSeenAt: m.last_seen_at ?? null, sharesWith: sharesOf(m.owner_user_id), kind: m.kind ?? 'local' } as MachineCapability;
  });
  const mine = availableMachines(caps, me).filter((m) => m.kind === 'runner' || m.kind === 'member' || machineOnline(m, now));
  const state = (p: ProviderKey): ProviderState =>
    mine.some((m) => m.runtimes.includes(PROVIDER_RUNTIME[p])) ? 'ready' : configured.has(p) ? 'signin' : 'connect';
  return { anthropic: state('anthropic'), openai: state('openai'), gemini: state('gemini') };
}

/** who answers a message sent now with no @name: a conversation's coordinator (an old chat-mode
 *  thread keeps the last agent who spoke, host/chatsupport.ts), or what a task's state says (shared
 *  threadwake.ts). null = nobody wakes unless the message names someone */
export function defaultAnswerer<A extends { id: string; role: string }>(
  roomAgents: readonly A[],
  task?: { state: string; kind?: string | null; assigneeKind?: string | null; assigneeId?: string | null } | null,
  chat?: { mode?: string | null; messages: ReadonlyArray<{ author_kind: string; author_id: string }> } | null,
): A | null {
  const orch = roomAgents.find((a) => a.role === 'orchestrator') ?? null;
  if (!task && chat && isChatThread(chat.mode ?? null)) {
    for (const m of chat.messages.slice(-30).reverse()) {
      const hit = m.author_kind === 'agent' ? roomAgents.find((a) => a.id === m.author_id) : undefined;
      if (hit) return hit;
    }
  }
  if (!task) return orch;
  const who = unaddressedWake(task.state, task.kind ?? null);
  if (who === 'orchestrator') return orch;
  if (who === 'assignee' && task.assigneeKind === 'agent') return roomAgents.find((a) => a.id === task.assigneeId) ?? null;
  return null;
}

/** the body Send posts: the picked agent named up front, unless it is the default answerer or the
 *  body already names it (the one grammar the daemon routes on) */
export function addressTo(body: string, picked: string | null, byDefault: string | null): string {
  if (!picked || picked === byDefault || addressedIn(body, picked)) return body;
  return `@${picked} ${body}`;
}

/** the conversation's override without one role, so a person's pick takes effect here: null when empty */
export function withoutRole(override: BrainOverride | string | null | undefined, role: string): BrainOverride | null | undefined {
  const o = parseBrainOverride(override ?? null);
  if (!o || !(role in o)) return undefined;
  const rest = Object.fromEntries(Object.entries(o).filter(([r]) => r !== role)) as BrainOverride;
  return Object.keys(rest).length ? rest : null;
}

/** the chip's name for a model: the catalog label, the house brain without its version */
export const chipLabel = (label: string): string => label.replace(/\s*\(Starter v\d+\)$/, '');

/** the mark a model wears: its vendor's, a retired model's too (the catalog lookup knows current ones
 *  only, so Opus 4.8 wore the house mark), and the house mark for the NeuraMesh brain or a stranger */
export function markOf(model: string): ProviderKey | 'neuramesh' {
  if (model === STARTER_MODEL) return 'neuramesh';
  try { return providerForModel(model); } catch { return 'neuramesh'; }
}
