// Human display labels for model ids (the page shows these). Ids remain the source of truth.
export const LABELS: Record<string, string> = {
  'claude-fable-5-1': 'Claude Fable 5.1',
  'claude-fable-5': 'Claude Fable 5',
  'claude-opus-5': 'Claude Opus 5',
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
  'gpt-6-astra': 'GPT-6 Astra',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.5-pro': 'GPT-5.5 Pro',
  'gpt-5.4-mini': 'GPT-5.4 mini',
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
  'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite',
  // the bench names the MODEL, not the product: this page compares brains, and "NeuraMesh
  // Starter" beside nine vendor ids would hide which one is actually on the chart
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
};

/** True when the model has a display label (the CLI pre-flights every selected model). */
export function isLabeled(model: string): boolean {
  return LABELS[model] !== undefined;
}
