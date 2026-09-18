// THE MODEL LABELS, SHARED (the mobile-cloud round, S5.1): the phone's Code thread names the model
// a session switched to with the same words the desktop uses. Moved verbatim from
// apps/desktop/src/renderer/src/lib/modelcatalog.ts, which re-exports it.
import { STARTER_MODEL } from './rates';

// Labels are what a human READS, so the house brain wears the house name: a user who never
// connected a provider has no idea what a "gemini-3.5-flash-lite" is, and naming the vendor there
// would advertise a relationship they don't have. Which model serves it is our operational
// business (rates.ts) — the catalog id stays the same everywhere the machine reads it.
export const MODEL_LABELS: Record<string, string> = {
  // the PACK is "NeuraMesh brain"; the MODEL is a VERSION of it. "Starter" alone told a person
  // nothing (George, 2026-09-17: "the text starter in general — what's that?"), so the label
  // leads with what it IS, the product's own brain, and keeps the tier as the version that can
  // move when the model behind it does (which is the whole reason we never name the vendor).
  [STARTER_MODEL]: 'NeuraMesh brain (Starter v1)',
  'claude-fable-5-1': 'Claude Fable 5.1', 'claude-opus-5': 'Claude Opus 5', 'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-fable-5': 'Claude Fable 5', 'claude-opus-4-8': 'Claude Opus 4.8', 'claude-sonnet-4-6': 'Claude Sonnet 4.6', 'claude-haiku-4-5': 'Claude Haiku 4.5',
  'gpt-6-astra': 'GPT-6 Astra', 'gpt-5.6-sol': 'GPT-5.6 Sol', 'gpt-5.6-terra': 'GPT-5.6 Terra', 'gpt-5.5': 'GPT-5.5', 'gpt-5.5-pro': 'GPT-5.5 Pro', 'gpt-5.4-mini': 'GPT-5.4 mini', 'gpt-5.1-codex': 'GPT-5.1 Codex', 'gpt-5-codex': 'GPT-5 Codex', 'gpt-5': 'GPT-5', 'o4-mini': 'o4-mini', 'gpt-4o-mini': 'GPT-4o mini', 'gpt-4.1-mini': 'GPT-4.1 mini',
  'gemini-3.8-flash': 'Gemini 3.8 Flash', 'gemini-3.5-flash': 'Gemini 3.5 Flash', 'gemini-3.1-pro-preview': 'Gemini 3.1 Pro (preview)', 'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite', 'gemini-2.5-pro': 'Gemini 2.5 Pro', 'gemini-2.5-flash': 'Gemini 2.5 Flash',
};

/** the label a human reads for a model id — the id itself when the catalogue has no word for it */
export const modelLabel = (m: string): string => MODEL_LABELS[m] ?? m;
