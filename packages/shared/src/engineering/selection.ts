import { DEFAULT_THINKING, takesThinking, THINKING_LEVELS, type ThinkingLevel } from '../agent-models';
import { MODEL_ID_SET } from '../model-packs';
import { STARTER_MODEL } from '../rates';

/** One atomic choice for the next turn. Agent instructions are resolved on the host. */
export interface EngineeringSelection {
  agentId: string | null;
  modelId: string | null;
  reasoningEffort: ThinkingLevel | null;
}
export interface EngineeringAgent { id: string; name: string; role: string; emoji?: string | null }
export const DEFAULT_ENGINEERING_AGENT: EngineeringAgent = { id: '', name: 'rex', role: 'orchestrator' };
export const engineeringEffort = (model: string | null, effort?: ThinkingLevel | null): ThinkingLevel | null =>
  takesThinking(model ?? STARTER_MODEL) ? effort ?? DEFAULT_THINKING : null;
export function isEngineeringSelection(value: unknown): value is EngineeringSelection {
  if (!value || typeof value !== 'object') return false;
  const v = value as EngineeringSelection;
  return (v.agentId === null || (typeof v.agentId === 'string' && v.agentId.length > 0 && v.agentId.length <= 200))
    && (v.modelId === null || MODEL_ID_SET.has(v.modelId))
    && (v.reasoningEffort === null || THINKING_LEVELS.includes(v.reasoningEffort));
}
