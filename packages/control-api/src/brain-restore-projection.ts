import { decodedBrainSnapshot } from './brain-decoded';
import type { BrainConversationEvent } from '@neuramesh/shared';

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' ? value as Record<string, any> : {};
const textStart = (event: Record<string, any>): boolean => event.type === 'content_start' && event.contentType === 'text' && typeof event.text === 'string';

/** A lossless conversation projection, not an archive rewrite. SDK text events repeat the
 * entire answer-so-far alongside each delta, then repeat that event as a transport string.
 * Remove an accumulated value only when its exact value is reconstructible from the deltas.
 * Keep every event ID/order, tool result, unknown transport chunk and discontinuity. */
export function brainRestoreProjection(): (value: unknown) => unknown {
  const streams = new Map<string, { text: string; original?: string; compact?: string }>();
  return value => {
    const record = object(value);
    if (record.type !== 'runtime.event') return value;
    const raw = object(record.payload);
    const core = raw.brainEncoding === 'neuramesh.gzip.v1'
      ? object(decodedBrainSnapshot({ workspace: '', threadId: '', revision: 0, events: [value as BrainConversationEvent] }).events[0]!.payload)
      : raw;
    const payload = object(core.payload);
    if (typeof payload.sessionId !== 'string') return value;
    const stream = streams.get(payload.sessionId) ?? { text: '' };
    streams.set(payload.sessionId, stream);
    let projected = core;
    if (core.type === 'agent_event') {
      const event = object(payload.event);
      let compact = event;
      if (textStart(event)) {
        if (typeof event.accumulated === 'string') {
          if (event.accumulated === stream.text + event.text) {
            compact = { ...event }; delete compact.accumulated;
          }
          stream.text = event.accumulated;
        } else stream.text += event.text;
      } else if (event.type === 'done' || (event.type === 'content_end' && event.contentType === 'text')) stream.text = '';
      stream.original = JSON.stringify(event);
      stream.compact = JSON.stringify(compact);
      if (compact !== event) projected = { ...core, payload: { ...payload, event: compact } };
    } else if (core.type === 'chunk' && payload.stream === 'agent' && typeof payload.chunk === 'string'
      && payload.chunk === stream.original && stream.compact !== stream.original) {
      projected = { ...core, payload: { ...payload, chunk: stream.compact } };
    }
    return projected === core ? value : { ...record, payload: projected };
  };
}
