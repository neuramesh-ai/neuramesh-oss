import { AgyEventMapper } from '../relay/engineering-agy-events';
import { starterThoughts } from './starterthoughts';
import { carryCards } from '@neuramesh/shared';

// Some Gemini CLI responses mislabel a reasoning section as public text. There is no
// reliable end delimiter to recover its answer, so do not stream or salvage that block.
const reasoningBlock = (text: string) => /^(?:thought|analysis)\s*\n/i.test(text.trimStart());
const visibleText = (text: string) => reasoningBlock(text) || ['thought', 'analysis'].some(marker => marker.startsWith(text.trim().toLowerCase())) ? '' : text;

/** The same provider events as Code, projected onto the conversation's live bubble. */
export function agyConversationStream(tools: readonly string[], onDelta?: (text: string, thinking?: string) => void, record?: (event: unknown) => void, onMessage?: (text: string) => void) {
  const mapper = new AgyEventMapper(new Set(tools));
  const thoughts = starterThoughts();
  let pending = '';
  let text = '';
  const completed: string[] = [];
  let afterTool: string[] = [];
  let final: string | undefined;
  let failure: string | undefined;
  const show = () => { try { onDelta?.(visibleText(text), thoughts.text()); } catch { /* A closed client must not cancel the provider turn. */ } };
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
      if (part?.['type'] === 'content_end' && part['contentType'] === 'text' && typeof part['text'] === 'string') {
        completed.push(part['text']); afterTool.push(part['text']);
        if (!reasoningBlock(part['text'])) onMessage?.(part['text']);
      }
      if (part?.['type'] !== 'content_start') continue;
      if (part['contentType'] === 'reasoning' && typeof part['reasoning'] === 'string') thoughts.thought(part['reasoning']);
      if (part['contentType'] === 'text' && typeof part['accumulated'] === 'string') text = part['accumulated'];
      if (part['contentType'] === 'tool') { thoughts.step(String(part['toolName']), part['input']); text = ''; afterTool = []; }
      show();
    }
    if (mapped.result) {
      if (!mapped.result.ok) failure = mapped.result.response || 'Gemini could not complete the turn.';
      else if (!mapped.result.response.trim() && mapped.result.denied.length) {
        failure = `Gemini could not finish because this machine refused ${mapped.result.denied.join(', ')}. Check that your Google account allows the nm MCP server, or choose another model.`;
      } else {
        // agy.result.response can concatenate every public step, including commentary
        // already displayed before tools. Retain the answer after the last action and
        // rescue earlier cards, without repeating the progress paragraphs.
        const response = mapped.result.response;
        const cumulative = completed.length > 0 && response.trim() === completed.join('').trim();
        const answer = cumulative && afterTool.length ? afterTool.join('\n\n') : response;
        if (reasoningBlock(answer)) failure = 'Gemini returned an incorrectly formatted response. Please retry or choose another model.';
        else {
          final = cumulative ? carryCards(answer, completed.filter(part => !reasoningBlock(part))) : answer;
          text = final; show();
        }
      }
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
