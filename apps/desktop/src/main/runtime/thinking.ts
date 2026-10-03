// THE THINKING LEVEL, IN EACH VENDOR'S WORDS (docs/design/models-and-replies-2026-10/plan.md §4). A
// person picks Low, Medium or High for an agent's model (shared agent-models.ts), seatFor puts it on
// the seat (HostedAgent.thinking), and each transport hands it over the way its SDK names it. A model
// that takes no level, the NeuraMesh brain and a Google sign-in (agy) get nothing, so the vendor's
// own default stands. Spread into an options object: an empty level adds no key at all.
import type { ThinkingLevel as GeminiLevel } from '@google/genai';
import { takesThinking, type ThinkingLevel } from '@neuramesh/shared';

type Seat = { model: string; thinking?: ThinkingLevel | null };
const levelOf = (s: Seat): ThinkingLevel | null => (s.thinking && takesThinking(s.model) ? s.thinking : null);

/** the Claude Agent SDK's `effort` (it lowers the level itself for a model that holds less) */
export function claudeEffort(s: Seat): { effort?: ThinkingLevel } {
  const l = levelOf(s);
  return l ? { effort: l } : {};
}

/** Codex's `modelReasoningEffort`, on the thread */
export function codexEffort(s: Seat): { modelReasoningEffort?: ThinkingLevel } {
  const l = levelOf(s);
  return l ? { modelReasoningEffort: l } : {};
}

/** Gemini through an API key: `thinkingConfig.thinkingLevel`. The SDK's enum values are the level's
 *  own name in upper case ('LOW'), so the type-only import keeps the enum out of the bundle */
export function geminiThinking(s: Seat): { thinkingConfig?: { thinkingLevel: GeminiLevel } } {
  const l = levelOf(s);
  return l ? { thinkingConfig: { thinkingLevel: l.toUpperCase() as GeminiLevel } } : {};
}
