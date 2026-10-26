import { AgyEventMapper } from '../relay/engineering-agy-events';
import { starterThoughts } from './starterthoughts';

/** The same provider events as Code, projected onto the conversation's live bubble. */
export function agyConversationStream(tools: readonly string[], onDelta?: (text: string, thinking?: string) => void, record?: (event: unknown) => void) {
  const mapper = new AgyEventMapper(new Set(tools));
  const thoughts = starterThoughts();
  let pending = '';
  let text = '';
  let final: string | undefined;
  let failure: string | undefined;
  const show = () => { try { onDelta?.(text, thoughts.text()); } catch { /* A closed client must not cancel the provider turn. */ } };
  const line = (raw: string) => {
    if (!raw.trim()) return;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return; }
    record?.(value);
    const mapped = mapper.map(value);
    for (const event of mapped.events) {
      if (event.type !== 'agent_event') continue;
      const payload = event.event['payload'] as { event?: Record<string, unknown> } | undefined;
      const part = payload?.event;
      if (part?.['type'] !== 'content_start') continue;
      if (part['contentType'] === 'reasoning' && typeof part['reasoning'] === 'string') thoughts.thought(part['reasoning']);
      if (part['contentType'] === 'text' && typeof part['accumulated'] === 'string') text = part['accumulated'];
      if (part['contentType'] === 'tool') { thoughts.step(String(part['toolName']), part['input']); text = ''; }
      show();
    }
    if (mapped.result) {
      if (!mapped.result.ok) failure = mapped.result.response || 'Gemini could not complete the turn.';
      else if (!mapped.result.response.trim() && mapped.result.denied.length) {
        failure = `Gemini could not finish because this machine refused ${mapped.result.denied.join(', ')}. Check that your Google account allows the nm MCP server, or choose another model.`;
      } else { final = mapped.result.response; text = final; show(); }
    }
  };
  return {
    push(chunk: string) {
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) { line(pending.slice(0, end)); pending = pending.slice(end + 1); }
      if (pending.length > 4 * 1024 * 1024) throw new Error('Gemini stream frame exceeds the supported size.');
    },
    finish(): string {
      line(pending); pending = '';
      if (failure) throw new Error(failure);
      if (final === undefined) throw new Error('Gemini ended without a completed response. Please retry.');
      return final.trim();
    },
  };
}
