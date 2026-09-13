// The runtime catalog + its label — extracted from App.tsx (track A3). Small on purpose:
// AgentFace needs the label and must not drag the provider-card cluster with it.
import { CURRENT_MODELS } from '@neuramesh/shared';

export const RUNTIME_OPTS: Record<string, { label: string; provider: string; models: string[] }> = {
  // models come from the shared catalog (@neuramesh/shared CURRENT_MODELS) — the single source of
  // truth the packs + the server allow-list also read, so the picker can never drift from them.
  'claude-code': { label: 'Claude', provider: 'Anthropic', models: [...CURRENT_MODELS['claude-code']] },
  codex: { label: 'Codex', provider: 'OpenAI', models: [...CURRENT_MODELS.codex] },
  gemini: { label: 'Gemini', provider: 'Gemini', models: [...CURRENT_MODELS.gemini] },
};
export const runtimeLabel = (rt?: string | null): string => RUNTIME_OPTS[rt ?? 'claude-code']?.label ?? (rt ?? 'claude-code');
