// THE PERSON'S MODEL FOR EACH AGENT (docs/design/models-and-replies-2026-10/plan.md §4). George,
// 2026-10-02: "a model choice changes that agent for the user; technically model selection is a user
// configuration, not workspace ... since web is not the only interface". So a pick belongs to ONE member
// and ONE agent, and it holds on every interface: it lives on the member's own row
// (workspace_members.agent_models, 0148, synced), and every daemon reads the requester's pick from its
// replica when it seats the agent (seatModel below the conversation's own word). Automations are the
// rule's one exception: a scheduled run uses the NeuraMesh brain, whoever made it.
import { MODEL_IDS } from './model-packs';
import { STARTER_MODEL } from './rates';

export const THINKING_LEVELS = ['low', 'medium', 'high'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export const THINKING_LABEL: Record<ThinkingLevel, string> = { low: 'Low', medium: 'Medium', high: 'High' };
/** the level a new pick starts at, when the model takes one */
export const DEFAULT_THINKING: ThinkingLevel = 'medium';

export interface AgentModelPick { model: string; thinking?: ThinkingLevel | null }
/** one member's picks, by agent id */
export type AgentModelPicks = Record<string, AgentModelPick>;

const KNOWN = new Set<string>(MODEL_IDS);
const isLevel = (v: unknown): v is ThinkingLevel => typeof v === 'string' && (THINKING_LEVELS as readonly string[]).includes(v);

/**
 * Does this model take a thinking level? Every Claude and GPT model does (the Agent SDK's `effort`,
 * Codex's `modelReasoningEffort`), and Gemini from 3 up does through an API key (`thinkingLevel`),
 * except Flash-Lite. The NeuraMesh brain never does: its level is fixed at minimal, and that level
 * is part of its price (rates.ts STARTER_THINKING_LEVEL).
 */
export function takesThinking(model: string | null | undefined): boolean {
  if (!model || model === STARTER_MODEL) return false;
  if (model.startsWith('claude') || model.startsWith('gpt')) return true;
  return /^gemini-[3-9]/.test(model) && !/flash-lite/.test(model);
}

/** the synced column, read tolerantly: a jsonb object, its JSON text on a replica, or nothing. An entry
 *  with an unknown model is dropped, and a level the model does not take is dropped from its entry */
export function parseAgentModels(raw: unknown): AgentModelPicks {
  let v: unknown = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return {}; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: AgentModelPicks = {};
  for (const [agent, p] of Object.entries(v as Record<string, unknown>)) {
    const model = (p as { model?: unknown } | null)?.model;
    if (typeof model !== 'string' || !KNOWN.has(model)) continue;
    const thinking = (p as { thinking?: unknown }).thinking;
    out[agent] = { model, ...(isLevel(thinking) && takesThinking(model) ? { thinking } : {}) };
  }
  return out;
}

/** one agent's pick for one person, or null */
export function pickFor(picks: AgentModelPicks | null | undefined, agentId: string): AgentModelPick | null {
  return picks?.[agentId] ?? null;
}

/** the level a run gets: the person's level, when the pick holds the model the run takes and that
 *  model takes a level. null leaves the vendor's default in place */
export function thinkingFor(model: string, pick: AgentModelPick | null | undefined): ThinkingLevel | null {
  if (!takesThinking(model) || pick?.model !== model) return null;
  return pick.thinking ?? null;
}
