// LIVE NARRATION (round 9, 2026-11-06). The person sees what the agent does while it works:
// one short line before each group of tool calls, one line after a finding that changes the next
// step, and the answer at the end. George asked for it after a 3.5 minute turn that showed only
// "Used tools, searched 10" and typing dots.
//
// ONE RULE, ONE HOME. The chat turn (apps/desktop/src/main/chatmode.ts), the orchestrator turn
// (host/orchestratorturn.ts appends it to the contract's style block), the agy suffix
// (host/orchturn.ts) and the coding runtime (relay/engineering-runtime-input.ts) all read this
// constant. A second copy would drift, as the chat copy did from the orchestrator contract.

/** What every conversational agent is told about narrating its work. */
export const NARRATION_RULE =
  'Keep the person informed while you work. Before each group of tool calls, write one short line that says what you will check or do, and why. ' +
  'After a finding that changes your next step, write one short line: what you found and what you will do next. ' +
  'For a request that needs no tools, start with a one-line plan, then answer. ' +
  'These lines are ordinary text, separate from the tool calls. Do not narrate every single tool, list dry steps, expose private reasoning, or claim results before you have them.';

/** The most progress lines one live reply carries. The oldest line drops first. */
export const MAX_PROGRESS_LINES = 12;
/** The longest progress line on the wire. A longer block is a draft, not a progress line. */
export const MAX_PROGRESS_CHARS = 600;

/**
 * Add one finished narration block to a turn's progress lines. Returns the same array when the
 * block adds nothing (empty, or the same as the last line), so a caller can skip an update.
 */
export function addProgressLine(lines: readonly string[], block: string): readonly string[] {
  const line = block.trim();
  if (!line || lines.at(-1) === line) return lines;
  const clipped = line.length > MAX_PROGRESS_CHARS ? `${line.slice(0, MAX_PROGRESS_CHARS - 1).trimEnd()}…` : line;
  return [...lines, clipped].slice(-MAX_PROGRESS_LINES);
}

/** True when two progress lists hold the same lines in the same order. */
export function sameProgress(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const x = a ?? [], y = b ?? [];
  return x.length === y.length && x.every((line, i) => line === y[i]);
}
