// The model-invocation seam for the harness — one-shot completions via each provider's REST
// API, keyed off the same provider mapping production uses (@neuramesh/shared:providerForModel).
// BYOK via env vars; a missing key throws NoCredError so the CLI can stop cleanly and NEVER
// fabricate a result. (The developer role's agentic coding loop is a separate seam — see run/.)
import { providerForModel, type Provider } from '@neuramesh/shared';

export class NoCredError extends Error {}

/**
 * The model declined the request on policy grounds (Anthropic returns HTTP 200 with
 * stop_reason "refusal"). A refusal is a real property of the model under test, so it is counted
 * against it like a format failure — never rescued onto a fallback model, which would publish one
 * model's number under another model's name.
 */
export class RefusalError extends Error {}

/**
 * The model could not finish inside the output ceiling. OpenAI reports this as a 400 rather than a
 * truncated body, which would otherwise read as a contract error and erase the model's whole row
 * for that role. It is neither: it is one failed sample, and the row's `truncations` says so.
 * If this fires at the ceilings in CEILINGS, raise them rather than let a budget decide a seat.
 */
export class TruncationError extends Error {}

/**
 * The model returned no text at all. This is a FORMAT failure, not an ability signal, and the role
 * runners retry it the way the reviewer has always retried an unparseable verdict.
 *
 * The case that forced this: Gemini 3.8 Flash answers the worker's coding prompt with a malformed
 * function call about half the time (`finishReason: MALFORMED_FUNCTION_CALL`, empty text). The
 * prompt is the real production worker prompt, which describes an agent that HAS tools, and in
 * production that model does have them — so its instinct to call one is right there and only
 * useless here, where the bench offers a single REST call and no tools. Scored raw it read as 32%
 * on coding while its own predecessor scored 92%, which is a measurement of the harness.
 * `toolConfig.functionCallingConfig.mode = 'NONE'` does not suppress it (tested 2026-09-07).
 *
 * Retries are capped and an exhausted retry still counts against the model, so a model that
 * genuinely cannot answer is not rescued.
 */
export class EmptyAnswerError extends Error {}

export interface CompleteResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  /** true when the model hit the output ceiling — a truncated answer graded as ability is the
   * budget-artifact bug that has bitten this suite three times (docs/11). */
  truncated?: boolean;
  /** the provider's own word for why generation stopped, kept for diagnosis */
  finishReason?: string;
}

/**
 * What every model is asked to do, recorded in the report so a number can be read years later.
 * Deliberately the vendor DEFAULT everywhere: the bench compares models as the product calls them
 * (the desktop adapters send no thinking, effort or sampling parameters either), not models tuned
 * per family, which would make the leaderboard a tuning contest.
 */
export const PROVIDER_SETTINGS = {
  anthropic: 'default effort (high), adaptive thinking on the models that have it, no sampling parameters',
  openai: 'default reasoning effort (medium), no sampling parameters',
  gemini: 'default thinking level (medium), no sampling parameters',
} as const;

/** One HTTP attempt may take this long. Fable-tier turns run for minutes on the hard tasks. */
const CALL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Output ceilings per role. These are ceilings, not targets: every provider bills on ACTUAL usage,
 * so a generous ceiling costs a terse model nothing and costs a verbose one exactly what it spent.
 *
 * They are set high because the failure they prevent is the worst one this suite has: a model that
 * runs out of budget mid-answer is graded on the truncation, not on the ability. That has happened
 * three times here, and the 2026-09 pre-flight found a fourth — GPT-6 Astra returned a 400 on the
 * coding task because its reasoning consumed the entire 6000-token budget before a single line of
 * the file was written. The reasoning share of an answer has grown every generation, so these are
 * sized for a model that thinks for thousands of tokens and THEN writes a long answer.
 *
 * Raising a ceiling can only remove a truncation. It cannot invent quality.
 */
export const CEILINGS = {
  /** a verdict plus a short reason, after thinking */
  reviewer: 16000,
  /** a whole source file, after thinking. The largest, because the answer itself is long. */
  developer: 32000,
  /** long-form research answers and implementation plans, after thinking */
  judged: 16000,
  /** a structured decomposition, after thinking */
  orchestrator: 16000,
  /** one small rubric object, but a thinking judge reasons first and used to return nothing */
  judge: 8000,
} as const;

export function credFor(provider: Provider): string | undefined {
  if (provider === 'anthropic') return process.env['ANTHROPIC_API_KEY'];
  if (provider === 'openai') return process.env['OPENAI_API_KEY'] ?? process.env['CODEX_API_KEY'];
  return process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'];
}

function envHint(provider: Provider): string {
  return provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : provider === 'openai' ? 'OPENAI_API_KEY (or CODEX_API_KEY)' : 'GEMINI_API_KEY (or GOOGLE_API_KEY)';
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * POST with a hard timeout and ONE retry on the failures that are the network's fault, not the
 * model's: 429, 5xx, and transport errors. A 4xx other than 429 is a contract error (a rejected
 * parameter, an unknown model) and must surface immediately — retrying it would just spend twice.
 */
async function postJson(url: string, headers: Record<string, string>, body: unknown, label: string): Promise<unknown> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(2000);
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    } catch (e) {
      lastErr = new Error(`${label} transport: ${(e as Error).message}`);
      continue;
    }
    if (res.ok) return res.json();
    const text = (await res.text()).slice(0, 240);
    if (res.status === 400 && /max_tokens|output limit|maximum context/i.test(text)) {
      throw new TruncationError(`${label}: ran out of output budget before finishing — ${text.slice(0, 120)}`);
    }
    const err = new Error(`${label} ${res.status}: ${text}`);
    if (res.status !== 429 && res.status < 500) throw err;
    lastErr = err;
  }
  throw lastErr ?? new Error(`${label}: failed`);
}

/** One-shot completion. Mirrors the host adapter's complete() (plan/review verdicts). */
export async function complete(model: string, system: string, user: string, maxTokens = 600): Promise<CompleteResult> {
  const provider = providerForModel(model);
  const key = credFor(provider);
  if (!key) throw new NoCredError(`no ${provider} credential — set ${envHint(provider)}`);
  const r = provider === 'anthropic'
    ? await anthropic(model, system, user, maxTokens, key)
    : provider === 'openai'
      ? await openai(model, system, user, maxTokens, key)
      : await gemini(model, system, user, maxTokens, key);
  if (!r.text.trim()) throw new EmptyAnswerError(`${model} returned no text (${r.finishReason ?? 'no finish reason'})`);
  return r;
}

type AnthropicResponse = {
  content: { type: string; text?: string; input?: unknown }[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason?: string;
  stop_details?: { category?: string; explanation?: string };
};

function anthropicHeaders(key: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
}

/**
 * The system prompt is byte-identical across every call a model makes in a role, so caching it
 * turns the repeated prefix into a cache read (a tenth of the input price, a fortieth on Fable
 * 5.1). It changes cost, never the answer.
 */
function anthropicSystem(system: string): unknown {
  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
}

function anthropicResult(j: AnthropicResponse, model: string): CompleteResult {
  if (j.stop_reason === 'refusal') {
    throw new RefusalError(`${model} declined the request (${j.stop_details?.category ?? 'no category'})`);
  }
  const tool = j.content.find((b) => b.type === 'tool_use');
  const text = tool ? JSON.stringify(tool.input) : j.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  return { text, tokensIn: j.usage.input_tokens, tokensOut: j.usage.output_tokens, truncated: j.stop_reason === 'max_tokens', finishReason: j.stop_reason };
}

async function anthropic(model: string, system: string, user: string, maxTokens: number, key: string): Promise<CompleteResult> {
  const j = (await postJson(
    'https://api.anthropic.com/v1/messages',
    anthropicHeaders(key),
    { model, max_tokens: maxTokens, system: anthropicSystem(system), messages: [{ role: 'user', content: user }] },
    'anthropic',
  )) as AnthropicResponse;
  return anthropicResult(j, model);
}

type OpenAiResponse = {
  choices: { message: { content: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
};

function openaiResult(j: OpenAiResponse): CompleteResult {
  return {
    text: j.choices[0]?.message.content ?? '',
    tokensIn: j.usage?.prompt_tokens ?? 0,
    tokensOut: j.usage?.completion_tokens ?? 0,
    truncated: j.choices[0]?.finish_reason === 'length',
    finishReason: j.choices[0]?.finish_reason,
  };
}

async function openai(model: string, system: string, user: string, maxTokens: number, key: string): Promise<CompleteResult> {
  const j = (await postJson(
    'https://api.openai.com/v1/chat/completions',
    { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    { model, max_completion_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] },
    'openai',
  )) as OpenAiResponse;
  return openaiResult(j);
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; thoughtsTokenCount?: number };
};

function geminiResult(j: GeminiResponse): CompleteResult {
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  // Google bills thinking as output but reports it in its own field, so a thinking model looked
  // free until this was added. candidatesTokenCount alone under-reported every Gemini cost.
  const out = (j.usageMetadata?.candidatesTokenCount ?? 0) + (j.usageMetadata?.thoughtsTokenCount ?? 0);
  return { text, tokensIn: j.usageMetadata?.promptTokenCount ?? 0, tokensOut: out, truncated: j.candidates?.[0]?.finishReason === 'MAX_TOKENS', finishReason: j.candidates?.[0]?.finishReason };
}

function geminiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

// The key rides a header, not the query string, so it cannot land in a proxy or shell log.
function geminiHeaders(key: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-goog-api-key': key };
}

async function gemini(model: string, system: string, user: string, maxTokens: number, key: string): Promise<CompleteResult> {
  const j = (await postJson(
    geminiUrl(model),
    geminiHeaders(key),
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    },
    'gemini',
  )) as GeminiResponse;
  return geminiResult(j);
}

type JSchema = Record<string, unknown>;

// Gemini's responseSchema uses the OpenAPI Type enum (UPPERCASE) and rejects `additionalProperties`.
function toGeminiSchema(s: JSchema): JSchema {
  const out: JSchema = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'additionalProperties') continue;
    if (k === 'type' && typeof v === 'string') out[k] = v.toUpperCase();
    else if (k === 'properties' && v && typeof v === 'object') {
      const props: Record<string, JSchema> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, JSchema>)) props[pk] = toGeminiSchema(pv);
      out[k] = props;
    } else if (k === 'items' && v && typeof v === 'object') out[k] = toGeminiSchema(v as JSchema);
    else out[k] = v;
  }
  return out;
}

/**
 * One-shot completion FORCED to return a JSON object matching `schema`, using each provider's
 * native structured-output path (Anthropic output_config.format · OpenAI json_schema · Gemini
 * responseSchema). This is what makes a rambling model measurable on the reviewer verdict instead
 * of being dropped for never emitting the JSON.
 *
 * Anthropic used to get here by forcing a tool call (tool_choice type "tool"). Claude Fable 5.1
 * REJECTS forced tool choice with a 400, which would have dropped it from the leaderboard with a
 * single grey warning line. Structured outputs give the same schema guarantee on every current
 * Claude model, so the forced call is gone rather than branched.
 */
export async function completeJson(model: string, system: string, user: string, schema: JSchema, maxTokens = 1500): Promise<CompleteResult> {
  const provider = providerForModel(model);
  const key = credFor(provider);
  if (!key) throw new NoCredError(`no ${provider} credential — set ${envHint(provider)}`);

  if (provider === 'anthropic') {
    const j = (await postJson(
      'https://api.anthropic.com/v1/messages',
      anthropicHeaders(key),
      {
        model,
        max_tokens: maxTokens,
        system: anthropicSystem(system),
        messages: [{ role: 'user', content: user }],
        output_config: { format: { type: 'json_schema', schema } },
      },
      'anthropic',
    )) as AnthropicResponse;
    return anthropicResult(j, model);
  }

  if (provider === 'openai') {
    const j = (await postJson(
      'https://api.openai.com/v1/chat/completions',
      { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      {
        model,
        max_completion_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } },
      },
      'openai',
    )) as OpenAiResponse;
    return openaiResult(j);
  }

  const j = (await postJson(
    geminiUrl(model),
    geminiHeaders(key),
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema) },
    },
    'gemini',
  )) as GeminiResponse;
  return geminiResult(j);
}
