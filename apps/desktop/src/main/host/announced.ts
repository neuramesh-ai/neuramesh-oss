// A REPLY THAT ONLY ANNOUNCES WORK, one level above the transport (2026-11-17).
//
// The Gemini loop asks once inside the turn (host/orchturn-gemini.ts), because it owns each round.
// The Agent SDK and the Codex SDK do not: a query ends on its first text-only message and takes no
// message mid-query (host/turnkit.ts). So the turn runs once more from here, with the earlier reply
// and the note in its transcript. The tools the first run called are named, so the second run does
// not repeat them.
import { ACT_NOW_NOTE, announcesWork } from '../runtime/honesty';
import { isStandDown } from '../replypolicy';
import type { LogFn } from '../agentlog';

/** Whether the Gemini transport this turn takes asks by itself (geminiDispatch: the house model or a key → the loop). */
export function geminiLoopNudges(provider: string, houseModel: boolean, token: string): boolean {
  return provider === 'gemini' && (houseModel || !!token);
}

/** The transcript suffix for the second run. */
export function actNowSuffix(earlier: string, called: readonly string[]): string {
  const ran = [...new Set(called)];
  return `\n\nyou (earlier in this same turn, and no tool ran after it): ${earlier.trim()}\n\n[${ACT_NOW_NOTE}${ran.length ? ` Earlier in this turn you already called ${ran.join(', ')}. Do not call those again for the same work.` : ''}]`;
}

/**
 * Run `turn` with no suffix. If its reply only announces work, run it ONCE more with actNowSuffix.
 * A second run that stands down keeps the first reply, so the person still sees what was said.
 */
export async function actOnAnnounced(turn: (suffix: string) => Promise<string>, opts: { log?: LogFn; called?: () => readonly string[] } = {}): Promise<string> {
  const first = await turn('');
  if (!announcesWork(first)) return first;
  opts.log?.({ kind: 'result', phase: 'retry', summary: 'the reply said what it will do and made no tool call: running the turn once more', level: 'warn' });
  const again = await turn(actNowSuffix(first, opts.called?.() ?? []));
  return isStandDown(again) ? first : again;
}
