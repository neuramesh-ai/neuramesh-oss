// agy's stream-json events, projected onto the coding runtime's own event vocabulary
// (engineering-events.ts), so the web, the desktop and the phone render a Gemini sign-in thread
// with no change. pure apart from the clock, so a test replays recorded NDJSON through it.
import type { EngineeringRuntimeEvent } from '../../engineering-protocol';
import { AGY_EDIT_TOOLS, nmToolCall } from './engineering-agy-args';

const MAX_TEXT = 256 * 1024;
const clip = (value: string): string => value.length <= MAX_TEXT ? value : `${value.slice(0, MAX_TEXT)}\n[truncated]`;
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const str = (value: unknown): string => typeof value === 'string' ? value : '';
const num = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;

export interface AgyInit { conversationId: string; model: string; tools: string[]; permissionMode: string }
export interface AgyResult { conversationId: string; ok: boolean; response: string; denied: string[]; inputTokens: number; outputTokens: number }
export interface AgyMapped { events: EngineeringRuntimeEvent[]; init?: AgyInit; result?: AgyResult; edited?: boolean }

/** one agent_event on the wire, wrapped the way ClineChannelSession forwards a projected core event */
const agentEvent = (sessionId: string, event: Record<string, unknown>): EngineeringRuntimeEvent =>
  ({ type: 'agent_event', event: { type: 'agent_event', payload: { sessionId, event } } });

export class AgyEventMapper {
  private readonly texts = new Map<string, string>();
  private readonly reasoning = new Map<string, string>();
  private readonly started = new Map<string, number>();
  private readonly names = new Map<string, string>();

  constructor(private readonly ours: ReadonlySet<string>, private readonly now: () => number = Date.now) {}

  map(raw: unknown): AgyMapped {
    const line = obj(raw);
    if (line['event'] === 'init') {
      const init = obj(line['init']);
      return { events: [], init: {
        conversationId: str(line['conversation_id']), model: str(init['model']), permissionMode: str(init['permission_mode']),
        tools: Array.isArray(init['tools']) ? init['tools'].filter((t): t is string => typeof t === 'string') : [],
      } };
    }
    if (line['event'] === 'result') return this.result(obj(line['result']));
    if (line['event'] !== 'step_update') return { events: [] };
    const step = obj(line['step_update']);
    const conversation = str(step['conversation_id']);
    const key = `${conversation}:${num(step['step_index'])}`;
    const state = str(step['state']);
    if (step['step_type'] === 'agent_response') return { events: this.text(conversation, key, state, step) };
    if (step['step_type'] === 'tool') return this.tool(conversation, key, state, step);
    return { events: [] };
  }

  private text(conversation: string, key: string, state: string, step: Record<string, unknown>): EngineeringRuntimeEvent[] {
    const events: EngineeringRuntimeEvent[] = [];
    const thought = str(step['thinking_delta']);
    if (thought) {
      this.reasoning.set(key, (this.reasoning.get(key) ?? '') + thought);
      events.push(agentEvent(conversation, { type: 'content_start', contentType: 'reasoning', reasoning: clip(thought) }));
    }
    const delta = str(step['text_delta']);
    const accumulated = (this.texts.get(key) ?? '') + delta;
    if (delta) {
      this.texts.set(key, accumulated);
      events.push(agentEvent(conversation, { type: 'content_start', contentType: 'text', text: clip(delta), accumulated: clip(accumulated) }));
    }
    if (state === 'DONE' || state === 'ERROR') {
      if (this.reasoning.has(key)) events.push(agentEvent(conversation, { type: 'content_end', contentType: 'reasoning', reasoning: clip(this.reasoning.get(key)!) }));
      if (accumulated.trim()) events.push(agentEvent(conversation, { type: 'content_end', contentType: 'text', text: clip(accumulated) }));
      this.texts.delete(key); this.reasoning.delete(key);
    }
    return events;
  }

  private tool(conversation: string, key: string, state: string, step: Record<string, unknown>): AgyMapped {
    const info = obj(step['tool_info']);
    const agyName = str(step['tool_name']) || str(info['name']) || 'tool';
    // a NeuraMesh tool wears its own name and input, so clients render it as on the Cline lane
    const ours = nmToolCall(agyName, info['parameters'], this.ours);
    const toolName = ours?.toolName ?? agyName;
    const toolCallId = `agy-${key}`;
    if (state === 'ACTIVE') {
      if (this.started.has(key)) return { events: [] };
      this.started.set(key, this.now());
      this.names.set(key, toolName);
      return { events: [agentEvent(conversation, { type: 'content_start', contentType: 'tool', toolName, toolCallId, input: ours?.input ?? info['parameters'] ?? {} })] };
    }
    if (state !== 'DONE' && state !== 'ERROR') return { events: [] };
    const begun = this.started.get(key) ?? this.now();
    const named = this.names.get(key) ?? toolName;
    this.started.delete(key); this.names.delete(key);
    const failed = state === 'ERROR';
    return {
      events: [agentEvent(conversation, {
        type: 'content_end', contentType: 'tool', toolName: named, toolCallId, durationMs: Math.max(0, this.now() - begun),
        ...(failed ? { error: { message: `${named} did not run.` } } : {}),
      })],
      edited: !failed && AGY_EDIT_TOOLS.has(named),
    };
  }

  private result(result: Record<string, unknown>): AgyMapped {
    const conversation = str(result['conversation_id']);
    const ok = result['status'] === 'SUCCESS';
    const usage = obj(result['usage']);
    const denied = Array.isArray(result['denied_actions'])
      ? result['denied_actions'].map((d) => str(obj(d)['display_name']) || str(obj(d)['action'])).filter(Boolean) : [];
    const events: EngineeringRuntimeEvent[] = denied.map((name) => agentEvent(conversation, { type: 'notice', noticeType: 'status', message: `${name} was refused on this machine.`, displayRole: 'system' }));
    events.push(agentEvent(conversation, { type: 'done', reason: ok ? 'completed' : 'error' }));
    return { events, result: {
      conversationId: conversation, ok, response: str(result['response']), denied,
      // agy's total is input + output (16170 = 16169 + 1 on the first probe), so those two are the turn
      inputTokens: num(usage['input_tokens']), outputTokens: num(usage['output_tokens']),
    } };
  }
}
