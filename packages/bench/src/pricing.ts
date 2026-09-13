// $ per 1M tokens (input / output). Re-verify per release alongside @neuramesh/shared's
// CURRENT_MODELS — the same discipline docs/10-model-packs.md already documents for the catalog.
// ALL rows verified 2026-09-07 against the vendors' own pricing pages (Anthropic
// platform.claude.com/docs/en/about-claude/pricing · OpenAI developers.openai.com/api/docs/pricing ·
// Google ai.google.dev/gemini-api/docs/pricing). Never price a model from memory: the 2026-07-02
// audit found six stale rows across three providers, and this pass found three more.
//
// Dated rows to re-check:
//  - claude-sonnet-5: $2/$10 is now the STANDARD price. The scheduled 2026-09-01 rise to $3/$15 was
//    cancelled, so the old "list the sticker price" note here was overcharging Sonnet 5 by 50%.
//  - gemini-3.8-flash: $0.75/$3.75 is introductory through 2026-12-31; it becomes $1.50/$7.50 on
//    2027-01-01. Re-price then (rows carry mean tokens, so no re-run is needed).
//  - gpt-5.6-sol: $4/$20 is promotional at least through 2026-11-21 (was $5/$30 at launch).
//  - gpt-6-astra and gpt-5.6-sol double the input rate and add 50% to output above 272K context;
//    gemini-3.1-pro doubles above 200K. Every bench prompt is far below both.
//
// The two Flash-Lite rows are NOT the same price, and they are adjacent on Google's page, which is
// how this pass first got them wrong: 3.1 Flash-Lite is $0.25/$1.50 and 3.5 Flash-Lite is
// $0.30/$2.50. The NEWER lite model is the DEARER one. Read the row label, not the neighbour.
export const PRICING: Record<string, { inPer1M: number; outPer1M: number }> = {
  'claude-fable-5-1': { inPer1M: 10, outPer1M: 50 },
  'claude-fable-5': { inPer1M: 10, outPer1M: 50 },
  'claude-opus-5': { inPer1M: 5, outPer1M: 25 },
  'claude-opus-4-8': { inPer1M: 5, outPer1M: 25 },
  'claude-sonnet-5': { inPer1M: 2, outPer1M: 10 },
  'claude-sonnet-4-6': { inPer1M: 3, outPer1M: 15 },
  'claude-haiku-4-5': { inPer1M: 1, outPer1M: 5 },
  'gpt-6-astra': { inPer1M: 10, outPer1M: 50 },
  'gpt-5.6-sol': { inPer1M: 4, outPer1M: 20 },
  'gpt-5.6-terra': { inPer1M: 2, outPer1M: 12 },
  'gpt-5.5': { inPer1M: 5, outPer1M: 30 },
  'gpt-5.5-pro': { inPer1M: 30, outPer1M: 180 },
  'gpt-5.4-mini': { inPer1M: 0.75, outPer1M: 4.5 },
  'gemini-3.8-flash': { inPer1M: 0.75, outPer1M: 3.75 },
  'gemini-3.5-flash': { inPer1M: 1.5, outPer1M: 9 },
  'gemini-3.1-pro-preview': { inPer1M: 2, outPer1M: 12 },
  'gemini-3.1-flash-lite': { inPer1M: 0.25, outPer1M: 1.5 },
  // the starter brain. Mirrors MODEL_RATES in @neuramesh/shared/rates (µUSD there, $ here).
  'gemini-3.5-flash-lite': { inPer1M: 0.3, outPer1M: 2.5 },
};

/** True when the model has a verified price (the CLI pre-flights every selected model). */
export function isPriced(model: string): boolean {
  return PRICING[model] !== undefined;
}

/**
 * Total $ for a token spend on a given model. THROWS on an unpriced model rather than returning 0:
 * a free-looking row wins pickWinner's value tiebreak outright, so a forgotten PRICING entry would
 * silently crown the newest model. The CLI checks every model before the first call.
 */
export function costUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model];
  if (!p) throw new Error(`no PRICING row for "${model}" — add it (packages/bench/src/pricing.ts) before benchmarking`);
  return (tokensIn / 1e6) * p.inPer1M + (tokensOut / 1e6) * p.outPer1M;
}
