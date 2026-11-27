import { AgyEventMapper } from '../relay/engineering-agy-events';
import { starterThoughts } from './starterthoughts';
import { addProgressLine, carryCards } from '@neuramesh/shared';
import type { NarrationStats } from './narration-stats';

// Some Gemini CLI responses mislabel a reasoning section as public text. There is no
// reliable end delimiter to recover its answer, so do not stream or salvage that block.
const reasoningBlock = (text: string) => /^(?:thought|analysis)\s*\n/i.test(text.trimStart());
const visibleText = (text: string) => reasoningBlock(text) || ['thought', 'analysis'].some(marker => marker.startsWith(text.trim().toLowerCase())) ? '' : text;

/**
 * The same provider events as Code, projected onto the conversation's live bubble.
 *
 * LIVE NARRATION (round 9): the words the model writes before a tool step are its progress line
 * ("I will check the library, then draft"). They used to vanish from the bubble when the tool
 * started. Now they stay on screen as `progress`, the third argument of every update, and the
 * bubble's text holds only the words since the last tool step. The final reply is still only the
 * answer after the last action, so a progress line is never posted twice.
 */
export function agyConversationStream(tools: readonly string[], onDelta?: (text: string, thinking?: string, progress?: readonly string[]) => void, record?: (event: unknown) => void, onMessage?: (text: string) => void, stats?: NarrationStats) {
  const mapper = new AgyEventMapper(new Set(tools));
  const thoughts = starterThoughts();
  let pending = '';
  /** the words of the text block being written now */
  let current = '';
  const completed: string[] = [];
  /** the text blocks finished since the last tool step */
  let afterTool: string[] = [];
  /** the finished narration, one line per tool batch it introduced */
  let progress: readonly string[] = [];
  /** a tool step started and no words or thoughts came after it yet: the next tool joins its batch */
  let inBatch = false;
  let final: string | undefined;
  let failure: string | undefined;
  const segment = (): string => [...afterTool, current].map(block => visibleText(block).trim()).filter(Boolean).join('\n\n');
  const show = () => {
    const text = final !== undefined ? visibleText(final) : segment();
    stats?.text(!!text.trim() || progress.length > 0);
    try { onDelta?.(text, thoughts.text(), progress); } catch { /* A closed client must not cancel the provider turn. */ }
  };
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
        completed.push(part['text']); afterTool.push(part['text']); current = '';
        if (!reasoningBlock(part['text'])) onMessage?.(part['text']);
      }
      if (part?.['type'] !== 'content_start') continue;
      if (part['contentType'] === 'reasoning' && typeof part['reasoning'] === 'string') { thoughts.thought(part['reasoning']); stats?.thought(); inBatch = false; }
      if (part['contentType'] === 'text' && typeof part['accumulated'] === 'string') { current = part['accumulated']; inBatch = false; }
      if (part['contentType'] === 'tool') {
        thoughts.step(String(part['toolName']), part['input']);
        // the words before this step introduced it: they stay on screen as a progress line
        const said = segment();
        if (said) { progress = addProgressLine(progress, said); stats?.progress(progress.length); }
        current = ''; afterTool = [];
        if (inBatch) stats?.call(); else { stats?.batch(1); inBatch = true; }
      }
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
          show();
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

export function agyFailureMessage(code: number | null, stderr: string): string {
  if (/flags? provided but not defined.{0,20}-settings|unknown (?:flag|option).{0,20}-settings/i.test(stderr)) {
    return 'This machine needs a newer Gemini runtime to use thread permissions. Choose another model in the composer, or retry after the machine updates.';
  }
  if (/authentication required|authentication failed|not signed in/i.test(stderr)) {
    return 'Gemini needs you to sign in again. Reconnect your Google account on this machine, then retry.';
  }
  return code === 2 ? 'Gemini could not start this reply. Retry, or choose another model in the composer and retry.'
    : 'Gemini stopped before it finished replying. Retry, or choose another model in the composer.';
}
