// The orchestrator model catalog, grouped by provider — extracted from App.tsx (track A3b).
import { RUNTIME_OPTS } from './runtimes';
import type { ProviderId } from '../bridge/rows-infra';

// Orchestrator model catalog, grouped by provider (A2A multi-runtime). Each model maps to the
// runtime that serves it, so picking a non-Claude model routes the agent's runtime + credential
// correctly. Derived from RUNTIME_OPTS so it grows as runtimes gain models.
export const MODEL_GROUPS: Array<{ providerId: ProviderId; provider: string; runtime: string; models: string[] }> = [
  { providerId: 'anthropic', provider: 'Anthropic', runtime: 'claude-code', models: RUNTIME_OPTS['claude-code']?.models ?? [] },
  { providerId: 'openai', provider: 'OpenAI', runtime: 'codex', models: RUNTIME_OPTS['codex']?.models ?? [] },
  { providerId: 'gemini', provider: 'Google', runtime: 'gemini', models: RUNTIME_OPTS['gemini']?.models ?? [] },
];
// MODEL_LABELS moved to @neuramesh/shared (model-labels.ts, the mobile-cloud round S5.1) — re-exported here
export { MODEL_LABELS } from '@neuramesh/shared';
