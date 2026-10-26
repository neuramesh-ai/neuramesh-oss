import type { EngineeringMessage, EngineeringToolReceipt } from './domain';

const LIMIT = 16 * 1024;
/** Keep display data small. Binary tool payloads and credential fields have no transcript view. */
export function toolDisplayInput(value: unknown): unknown {
  let remaining = LIMIT;
  let nodes = 200;
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (--nodes < 0 || remaining <= 0 || depth > 5) return '[truncated]';
    if (typeof item === 'string') {
      const kept = item.slice(0, remaining); remaining -= kept.length;
      return kept.length < item.length ? `${kept}\n[truncated]` : kept;
    }
    if (item === null || typeof item === 'boolean' || typeof item === 'number') return item;
    if (!item || typeof item !== 'object') return undefined;
    if (seen.has(item)) return '[circular]';
    seen.add(item);
    if (Array.isArray(item)) return item.slice(0, 50).map(child => visit(child, depth + 1));
    return Object.fromEntries(Object.entries(item).slice(0, 50).map(([key, child]) => [key.slice(0, 200), /token|password|secret|api.?key|authorization|base64|^data$/i.test(key) ? '[redacted]' : visit(child, depth + 1)]));
  };
  return visit(value, 0);
}

/** Only textual results cross the display channel. No image bytes or provider metadata. */
export function toolDisplayOutput(value: unknown): string | undefined {
  const parts: string[] = [];
  let remaining = LIMIT;
  const visit = (item: unknown, depth = 0) => {
    if (remaining <= 0 || depth > 4) return;
    if (typeof item === 'string') {
      if (item.startsWith('data:')) return;
      const text = item.slice(0, remaining); remaining -= text.length;
      parts.push(text + (text.length < item.length ? '\n[truncated]' : '')); return;
    }
    if (Array.isArray(item)) { for (const child of item.slice(0, 50)) visit(child, depth + 1); return; }
    if (!item || typeof item !== 'object') return;
    const o = item as Record<string, unknown>;
    if (o['type'] === 'image' || o['type'] === 'image_url') return;
    for (const key of ['stdout', 'stderr', 'text', 'content', 'output', 'message']) if (o[key] !== undefined) visit(o[key], depth + 1);
  };
  visit(value);
  return parts.length ? parts.join('\n') : undefined;
}

export function recordToolReceipt(messages: EngineeringMessage[], event: Record<string, unknown>, create: (body: string) => EngineeringMessage): EngineeringMessage[] {
  const name = String(event['toolName'] ?? 'tool');
  const callId = typeof event['toolCallId'] === 'string' ? event['toolCallId'] : undefined;
  const start = event['type'] === 'content_start';
  let index = -1;
  for (let at = messages.length - 1; at >= 0; at--) {
    const tool = messages[at]?.tool;
    if (tool && (callId ? tool.callId === callId : tool.name === name && tool.state === 'running')) { index = at; break; }
  }
  const previous = index < 0 ? undefined : messages[index];
  // A duplicate start must not erase a completed result during journal replay.
  if (start && previous?.tool?.state !== undefined && previous.tool.state !== 'running') return messages;
  const error = event['error'] ? toolDisplayOutput(event['error']) ?? 'The action did not complete.' : undefined;
  const tool: EngineeringToolReceipt = {
    ...previous?.tool, name, ...(callId ? { callId } : {}),
    ...('input' in event ? { input: toolDisplayInput(event['input']) } : {}),
    ...(typeof event['durationMs'] === 'number' && Number.isFinite(event['durationMs']) ? { durationMs: Math.max(0, event['durationMs']) } : {}),
    ...(!start ? { ...('output' in event ? { output: toolDisplayOutput(event['output']) } : {}), error } : {}),
    state: start ? 'running' : error ? 'failed' : 'succeeded',
  };
  const body = `${name} ${start ? 'started' : error ? 'failed' : 'completed'}`;
  const row: EngineeringMessage = { ...(previous ?? create(body)), body, tool, tone: start ? 'plain' : error ? 'warning' : 'success' };
  return index < 0 ? [...messages, row] : messages.map((m, at) => at === index ? row : m);
}

export function interruptToolReceipts(messages: EngineeringMessage[]): EngineeringMessage[] {
  return messages.map(m => m.tool?.state === 'running' ? { ...m, tone: 'warning', tool: { ...m.tool, state: 'interrupted' } } : m);
}
