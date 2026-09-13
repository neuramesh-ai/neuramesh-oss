// The model-turn kit — extracted from agents.ts (track B1): drain a streaming SDK query,
// build a Claude turn, bound anything that talks to a model.
//
// withTimeout lives here so the budget discipline has ONE home: adoption.test.ts asserts no
// call site bounds a turn with a wall-clock literal instead of TURN_BUDGETS[kind].wallMs.
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { carryCards, resolveInstructions } from '@neuramesh/shared';
import { buildClaudeUserContent, chatSystemPrompt, claudePathOption, imageBlocks, providerEnv, type AgentAttachment } from '../runtime/adapter';
import { classifyExecError } from '../execpolicy';
import { contractFor, localInstructions } from '../contracts';
import { isStandDown } from '../replypolicy';
import type { LogFn } from '../agentlog';
import type { HostedAgent } from '../agents';


export function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

export function toolSummary(name: string, input: any): string {
  if (!input || typeof input !== 'object') return name;
  if (name === 'Bash') return `Bash: ${String(input.command ?? '').slice(0, 180)}`;
  if (name === 'Read') return `Read ${input.file_path ?? ''}`;
  if (name === 'Write') return `Write ${input.file_path ?? ''} (${String(input.content ?? '').length}b)`;
  if (name === 'Edit') return `Edit ${input.file_path ?? ''}`;
  if (name === 'Glob') return `Glob ${input.pattern ?? ''}`;
  if (name === 'Grep') return `Grep ${input.pattern ?? ''}`;
  // the ghost narrates these — carry the WHAT (url/query), not just the verb (round 9)
  if (name === 'WebFetch') return `WebFetch ${String(input.url ?? '')}`;
  if (name === 'WebSearch') return `WebSearch ${String(input.query ?? '').slice(0, 120)}`;
  if (name?.startsWith('mcp__')) return name.replace(/^mcp__nm__/, 'nm.');
  return name;
}

export async function drainQuery(stream: AsyncIterable<any>, fallback: string, log?: LogFn, onDelta?: (t: string) => void, onTodos?: (todos: Array<{ content?: string; status?: string }>) => void): Promise<string> {
  let text = '';
  // every superseded text block, because cards written in one are NOT narration — carryCards
  // rescues any ```nmq/```nms fence the final block dropped ("Waiting on those two", 2026-08-06)
  const earlier: string[] = [];
  for await (const m of stream) {
    if (m.type === 'assistant' && m.message?.content) {
      for (const b of m.message.content) {
        if (b.type === 'text' && b.text?.trim()) {
          if (text) earlier.push(text);
          text = b.text;
          onDelta?.(b.text);
          // NO_REPLY is addressed to US, not to a reader — the daemon drops the turn on it. Logged
          // as narration it rendered a bare "NO_REPLY" line in the activity feed under the tool
          // calls, which is the wiring showing through (founder report). The stand-down is already
          // recorded properly by the wake's own `stood_down` log line.
          if (!isStandDown(b.text)) log?.({ kind: 'turn', summary: b.text.slice(0, 280) });
        } else if (b.type === 'tool_use') {
          log?.({ kind: 'tool', phase: 'call', summary: toolSummary(b.name, b.input), detail: b.input, toolUseId: b.id });
          // the worker's own plan → beats: TodoWrite carries the full ordered list each update
          if (onTodos && b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) onTodos(b.input.todos);
        }
      }
    }
    if (m.type === 'user' && Array.isArray(m.message?.content)) {
      for (const b of m.message.content) {
        if (b?.type === 'tool_result') {
          const out = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
          log?.({ kind: 'tool', phase: 'result', summary: `→ ${out.replace(/\s+/g, ' ').slice(0, 160)}`, detail: out.slice(0, 4000), level: b.is_error ? 'warn' : 'info', toolUseId: b.tool_use_id });
        }
      }
    }
    if (m.type === 'result') {
      const dur = m.duration_ms ? ` ${Math.round(m.duration_ms / 1000)}s` : '';
      if (m.subtype === 'success' && typeof m.result === 'string' && m.result) {
        const u = m.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        const toks = u ? (u.input_tokens ?? 0) + (u.output_tokens ?? 0) : undefined;
        log?.({ kind: 'result', phase: 'success', summary: `completed${dur}`, detail: m.usage ?? null, tokens: toks });
        // m.result is the FINAL text block only — put back any card an earlier block posted
        if (text && text !== m.result) earlier.push(text);
        return carryCards(m.result, earlier);
      }
      // non-success: surface WHY instead of swallowing to a bland fallback. Carry the SDK's own error
      // TEXT (m.result / m.error), not just the subtype, so the wall handler's classifyExecError can see
      // a usage cap or refusal — the bare "[error_during_execution]" subtype hides it (docs/22 §9).
      const payload = [typeof m.result === 'string' ? m.result : '', m.error ? String(m.error) : '']
        .filter(Boolean).join(' ').trim();
      const why = m.subtype && m.subtype !== 'success' ? ` [${m.subtype}]` : '';
      log?.({ kind: 'result', phase: 'error', summary: `failed${why}${dur}`, level: 'error' });
      // Don't salvage partial assistant text as a success when the turn failed on a usage CAP or a
      // REFUSAL — that fabricates a summary and hides the wall the failover flow needs. Any other
      // non-success (e.g. max_turns) keeps the prior partial-text salvage.
      const cls = classifyExecError(`${why} ${payload}`);
      if (text && cls !== 'exhausted' && cls !== 'refusal') return carryCards(text, earlier);
      throw new Error(`SDK returned no result${why}${payload ? `: ${payload}` : why ? '' : ' (empty stream)'}`);
    }
  }
  return text ? carryCards(text, earlier) : fallback;
}

// Tool-less single-turn replies (chat, thread, memory block, fact extraction,
// checklists, estimates) go through the direct Messages API — NOT the Agent
// SDK. The SDK cold-starts a subprocess + MCP servers per call (~30s, the
// chat-latency complaint); a plain HTTP completion is ~2–4s and streams.
// `onDelta` receives the growing text for live "typing" bubbles (W-near).
// Build the prompt for an Agent-SDK turn (subscription/login chat + orchestrator). When images are
// attached, switch from a plain string to the SDK's streaming-input form — an async iterable that
// yields one user message carrying text + base64 image blocks — so the model SEES the images on the
// Claude Code login, not just the text manifest. No images → the plain string (the cheaper path).
export function claudeAgentPrompt(text: string, attachments?: AgentAttachment[]): string | AsyncIterable<SDKUserMessage> {
  const imgs = imageBlocks(attachments);
  if (!imgs.length) return text;
  return (async function* (): AsyncIterable<SDKUserMessage> {
    yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text }, ...imgs] } };
  })();
}

export async function claudeTurn(
  agent: HostedAgent,
  channelSlug: string,
  transcript: string,
  token: string,
  log?: LogFn,
  onDelta?: (text: string) => void,
  attachments?: AgentAttachment[],
): Promise<string> {
  const system = chatSystemPrompt(agent.name, channelSlug, instructionsFor(agent));
  // Subscription (no API key): the raw @anthropic-ai/sdk can't use the Claude Code login — route the
  // chat reply through the Agent SDK exactly as the orchestrator does, so it runs on the subscription
  // (providerEnv strips the key so the login is used). With a real key we keep the lighter raw-SDK
  // streaming path. Fixes "Could not resolve authentication method" for subscription teammates.
  if (!token) {
    const os = await import('node:os');
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const reply = await drainQuery(
      // allowedTools:[] keeps this a true tool-less reply; otherwise the SDK's default tools can burn the
      // one turn on a tool call (→ error_max_turns, no text). Same trap as directComplete.
      query({ prompt: claudeAgentPrompt(transcript, attachments), options: { ...claudePathOption(), env: providerEnv('anthropic', token), model: agent.model, maxTurns: 1, allowedTools: [], permissionMode: 'bypassPermissions', cwd: os.tmpdir(), systemPrompt: system } }) as AsyncIterable<any>,
      '(no reply)', log, onDelta,
    );
    return reply.trim() || '(no reply)';
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: token });
  const started = Date.now();
  try {
    const stream = client.messages.stream({
      model: agent.model,
      max_tokens: 1500,
      system,
      // image attachments ride as content blocks so Claude actually sees them; text-only context
      // (incl. the attachment manifest + inlined text files) stays in the transcript string
      messages: [{ role: 'user', content: buildClaudeUserContent(transcript, attachments) }],
    });
    if (onDelta) stream.on('text', (_delta, snapshot) => onDelta(snapshot));
    const final = await stream.finalMessage();
    const text = final.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    log?.({ kind: 'result', phase: 'success', summary: `replied (${final.usage.output_tokens} tok, ${Date.now() - started}ms)`, detail: final.usage, tokens: final.usage.input_tokens + final.usage.output_tokens });
    return text || '(no reply)';
  } catch (err) {
    log?.({ kind: 'result', phase: 'error', summary: `chat turn failed: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`, level: 'error' });
    throw err;
  }
}

// Generic tool-less completion via the direct Messages API. The architect's
// mixture-of-agents runs several of these — no agent runtime needed.
export async function directComplete(system: string, user: string, token: string, model: string, maxTokens = 2000): Promise<string> {
  // Subscription (no key): route through the Agent SDK so it runs on the Claude login (the raw SDK
  // needs an API key and can't use the subscription). With a real key, the lighter direct Messages API.
  if (!token) {
    const os = await import('node:os');
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    // Tool-less: an empty allowlist forbids the SDK's default tools. Without it a "research …" prompt
    // (the architect's planner) makes the model spend its single turn on a tool call instead of text →
    // the result returns `error_max_turns` with no output → drainQuery throws. The turn headroom is
    // belt-and-braces for a model that wants a reasoning step before the final answer.
    return (await drainQuery(query({ prompt: user, options: { ...claudePathOption(), env: providerEnv('anthropic', token), model, maxTurns: 6, allowedTools: [], permissionMode: 'bypassPermissions', cwd: os.tmpdir(), systemPrompt: system } }) as AsyncIterable<any>, '')).trim();
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: token });
  const m = await client.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
  return m.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
}

export function instructionsFor(agent: { name: string; role: string; brief?: string | null }): string | null {
  return resolveInstructions({
    local: localInstructions(agent.name),
    baseline: agent.brief,
    shipped: contractFor(agent.name, agent.role)?.instructions,
  });
}
