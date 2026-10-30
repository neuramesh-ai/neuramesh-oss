import type { BrainConversationEvent } from '@neuramesh/shared';
import { decodedBrainSnapshot } from './brain-decoded';
const kinds = new Set(['turn.open', 'turn.settle', 'assistant.message', 'tool.call', 'tool.result']);
/** Display only. The original journal remains complete. Never expose model prompts or runtime state. */
function bounded(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > 16_000 ? `${value.slice(0, 16_000)}\n… Output shortened for display.` : value;
  if (!value || typeof value !== 'object') return value;
  if (depth >= 5) return '[Nested details omitted]';
  if (Array.isArray(value)) return [...value.slice(0, 30).map(v => bounded(v, depth + 1)), ...(value.length > 30 ? ['… Additional items omitted for display.'] : [])];
  const entries = Object.entries(value);
  return Object.fromEntries([...entries.slice(0, 30).map(([key, v]) => [key, bounded(v, depth + 1)]), ...(entries.length > 30 ? [['…', 'Additional fields omitted for display.']] : [])]);
}
export function brainActivityProjection(value: unknown): unknown {
  const event = value as BrainConversationEvent;
  if (!event || !kinds.has(event.type)) return undefined;
  const decoded = decodedBrainSnapshot({ workspace: '', threadId: '', revision: 0, events: [event] }).events[0]!;
  const p = decoded.payload as Record<string, unknown> | null;
  if (!p || typeof p !== 'object') return undefined;
  // Public provider text is part of the conversation. Imported database messages already
  // render through the replica; model prompts, reasoning and unscoped text stay private.
  if (event.type === 'assistant.message' && (typeof p.text !== 'string' || typeof p.turnId !== 'string' || p.actorId)) return undefined;
  // Canonical tool invocations are recorded by recordedTools. Provider event copies have a
  // prefixed name (Claude) or `tool` instead of `name` (Codex). Rendering both doubles receipts.
  if (event.type === 'tool.call' && (typeof p.name !== 'string' || p.name.startsWith('mcp__'))) return undefined;
  const fields = event.type === 'turn.open' ? ['turnId', 'agentId', 'kind']
    : event.type === 'turn.settle' ? ['turnId', 'state']
    : event.type === 'assistant.message' ? ['text', 'turnId']
    : event.type === 'tool.call' ? ['id', 'name', 'input', 'turnId']
    : ['id', 'name', 'output', 'ok', 'isError', 'turnId'];
  return { id: event.id, type: event.type, timestamp: event.timestamp,
    payload: Object.fromEntries(fields.filter(key => p[key] !== undefined).map(key => [key, bounded(p[key])])) };
}
