// THE STARTER BRAIN'S THOUGHTS, in codex's shape (runtime/codexsdk.ts drainTurn, the repo-connect
// round's Option A). Sections are joined by a blank line: the model's summary grows in its own section
// as its `thought` lines arrive, each tool call is its own section in thoughtStep's words, and a new
// round of the tool loop opens a new summary section. The thoughts ride beside the reply on every
// bubble update and never become the reply (replyText).
import { thoughtStep } from '../runtime/codexsdk';

/** the most the thoughts hold: a piece that would pass it ends them with one '…' section, and they stop growing */
export const STARTER_THOUGHTS_CAP = 8000;

export interface StarterThoughts {
  /** the summary's next words, from one `thought` line */
  thought(delta: string): void;
  /** one tool call, its own section, added before the tool runs */
  step(name: string, args: unknown): void;
  /** a new round of the tool loop: its summary opens a new section */
  round(): void;
  /** the thoughts so far, or undefined while there are none */
  text(): string | undefined;
}

export function starterThoughts(cap = STARTER_THOUGHTS_CAP): StarterThoughts {
  const sections: string[] = [];
  let open = false; // the last section is this round's summary, and the next words grow it
  let full = false;
  const joined = (): string => sections.join('\n\n');
  const close = (): void => {
    if (open) sections[sections.length - 1] = sections[sections.length - 1]!.trimEnd();
    open = false;
  };
  const room = (more: number): boolean => {
    if (full) return false;
    if (joined().length + more <= cap) return true;
    close();
    full = true;
    sections.push('…');
    return false;
  };
  const gap = (): number => (sections.length ? 2 : 0);
  return {
    thought(delta) {
      if (open) { if (room(delta.length)) sections[sections.length - 1] += delta; return; }
      const words = delta.trimStart();
      if (words && room(gap() + words.length)) { sections.push(words); open = true; }
    },
    step(name, args) {
      close();
      const line = thoughtStep({ type: 'mcp_tool_call', tool: name, arguments: args });
      if (line && room(gap() + line.length)) sections.push(line);
    },
    round: close,
    text: () => (sections.length ? joined() : undefined),
  };
}

type Parts = { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean } | null> } }> };

/** the reply's words: the text of every part the model did not mark as a thought */
export const replyText = (r: Parts | null | undefined): string =>
  (r?.candidates?.[0]?.content?.parts ?? []).filter((p) => !p?.thought).map((p) => p?.text).filter(Boolean).join('');
