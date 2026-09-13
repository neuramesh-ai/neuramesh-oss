import type { CoreSessionEvent } from '@cline/sdk';

const MAX_EVENT_TEXT = 256 * 1024;
const MAX_EVENT_ERROR = 16 * 1024;
const MAX_TOOL_INPUT_CHARS = 128 * 1024;
const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return value.length <= max ? value : `${value.slice(0, max)}\n[truncated]`;
};
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

interface SanitizeState { chars: number; nodes: number; seen: WeakSet<object> }
const safeValue = (value: unknown, state: SanitizeState, depth = 0): unknown => {
  if (state.nodes <= 0 || state.chars <= 0 || depth > 5) return '[truncated]';
  state.nodes -= 1;
  if (typeof value === 'string') {
    const kept = value.slice(0, state.chars);
    state.chars -= kept.length;
    return kept.length === value.length ? kept : `${kept}\n[truncated]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (value instanceof Error) return {
    name: text(value.name, 200), message: text(value.message, MAX_EVENT_ERROR), stack: text(value.stack, MAX_EVENT_ERROR),
  };
  if (typeof value !== 'object') return undefined;
  if (state.seen.has(value)) return '[circular]';
  state.seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeValue(item, state, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 50)) result[key.slice(0, 200)] = safeValue(item, state, depth + 1);
  return result;
};
const boundedValue = (value: unknown, chars = MAX_TOOL_INPUT_CHARS): unknown =>
  safeValue(value, { chars, nodes: 500, seen: new WeakSet() });

const metadata = (event: Record<string, unknown>): Record<string, unknown> => ({
  ...(typeof event['agentId'] === 'string' ? { agentId: text(event['agentId'], 200) } : {}),
  ...(typeof event['conversationId'] === 'string' ? { conversationId: text(event['conversationId'], 200) } : {}),
  ...(typeof event['parentAgentId'] === 'string' || event['parentAgentId'] === null
    ? { parentAgentId: typeof event['parentAgentId'] === 'string' ? text(event['parentAgentId'], 200) : null } : {}),
});

const projectAgentEvent = (event: Record<string, unknown>): Record<string, unknown> => {
  const type = event['type'];
  const base = { type, ...metadata(event) };
  if (type === 'content_start') return {
    ...base, contentType: event['contentType'],
    ...(text(event['text'], MAX_EVENT_TEXT) !== undefined ? { text: text(event['text'], MAX_EVENT_TEXT) } : {}),
    ...(text(event['accumulated'], MAX_EVENT_TEXT) !== undefined ? { accumulated: text(event['accumulated'], MAX_EVENT_TEXT) } : {}),
    ...(text(event['reasoning'], MAX_EVENT_TEXT) !== undefined ? { reasoning: text(event['reasoning'], MAX_EVENT_TEXT) } : {}),
    ...(typeof event['redacted'] === 'boolean' ? { redacted: event['redacted'] } : {}),
    ...(typeof event['toolName'] === 'string' ? { toolName: text(event['toolName'], 200) } : {}),
    ...(typeof event['toolCallId'] === 'string' ? { toolCallId: text(event['toolCallId'], 200) } : {}),
    ...('input' in event ? { input: boundedValue(event['input']) } : {}),
    ...(event['execution'] === 'client' || event['execution'] === 'provider' ? { execution: event['execution'] } : {}),
  };
  if (type === 'content_update') return {
    ...base, contentType: 'tool',
    ...(typeof event['toolName'] === 'string' ? { toolName: text(event['toolName'], 200) } : {}),
    ...(typeof event['toolCallId'] === 'string' ? { toolCallId: text(event['toolCallId'], 200) } : {}),
    update: boundedValue(event['update']),
  };
  if (type === 'content_end') {
    if (event['contentType'] === 'tool') return {
      ...base, contentType: 'tool',
      ...(typeof event['toolName'] === 'string' ? { toolName: text(event['toolName'], 200) } : {}),
      ...(typeof event['toolCallId'] === 'string' ? { toolCallId: text(event['toolCallId'], 200) } : {}),
      ...(number(event['durationMs']) !== undefined ? { durationMs: number(event['durationMs']) } : {}),
      ...('error' in event ? { error: boundedValue(event['error'], MAX_EVENT_ERROR) } : {}),
    };
    const field = event['contentType'] === 'reasoning' ? 'reasoning' : 'text';
    return { ...base, contentType: event['contentType'], [field]: text(event[field], MAX_EVENT_TEXT) };
  }
  if (type === 'notice') return {
    ...base, noticeType: event['noticeType'], message: text(event['message'], MAX_EVENT_ERROR),
    displayRole: event['displayRole'], reason: event['reason'],
  };
  if (type === 'done') return { ...base, reason: event['reason'], text: text(event['text'], MAX_EVENT_TEXT), iterations: number(event['iterations']) };
  if (type === 'error') return {
    ...base, error: boundedValue(event['error'], MAX_EVENT_ERROR), errorClass: event['errorClass'],
    recoverable: event['recoverable'], iteration: number(event['iteration']),
  };
  if (type === 'iteration_start') return { ...base, iteration: number(event['iteration']) };
  if (type === 'iteration_end') return {
    ...base, iteration: number(event['iteration']), hadToolCalls: event['hadToolCalls'], toolCallCount: number(event['toolCallCount']),
  };
  if (type === 'usage') {
    const result = { ...base };
    for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'cost', 'totalInputTokens', 'totalOutputTokens', 'totalCacheReadTokens', 'totalCacheWriteTokens', 'totalCost']) {
      const value = number(event[key]);
      if (value !== undefined) (result as Record<string, unknown>)[key] = value;
    }
    return result;
  }
  return { type: typeof type === 'string' ? text(type, 100) : 'unknown' };
};

/** Allowlist and bound events before serialization. Full snapshots, tool output and provider
 * metadata never enter the relay projection, avoiding both disclosure and memory spikes. */
export function projectEngineeringCoreEvent(event: CoreSessionEvent): Record<string, unknown> {
  const source = event as unknown as Record<string, unknown>;
  const payload = source['payload'] as Record<string, unknown> | undefined;
  if (source['type'] === 'session_snapshot') {
    const snapshot = payload?.['snapshot'] as Record<string, unknown> | undefined;
    return {
      type: 'session_snapshot',
      payload: {
        ...(typeof payload?.['sessionId'] === 'string' ? { sessionId: text(payload['sessionId'], 200) } : {}),
        snapshot: { checkpoint: boundedValue(snapshot?.['checkpoint'], MAX_EVENT_ERROR) ?? null },
      },
    };
  }
  if (source['type'] === 'agent_event') {
    const content = payload?.['event'];
    return {
      type: 'agent_event',
      payload: {
        ...(typeof payload?.['sessionId'] === 'string' ? { sessionId: text(payload['sessionId'], 200) } : {}),
        ...(typeof payload?.['teamAgentId'] === 'string' ? { teamAgentId: text(payload['teamAgentId'], 200) } : {}),
        ...(payload?.['teamRole'] === 'lead' || payload?.['teamRole'] === 'teammate' ? { teamRole: payload['teamRole'] } : {}),
        event: typeof content === 'object' && content !== null ? projectAgentEvent(content as Record<string, unknown>) : { type: 'unknown' },
      },
    };
  }
  return { type: typeof source['type'] === 'string' ? text(source['type'], 100) : 'unknown' };
}
