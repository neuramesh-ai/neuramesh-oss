// The context assembler (docs/harness/05 §3.7) — one place that decides what a turn is told.
//
// What it replaces: every flow hand-rolled its own context with an arbitrary SQL row cap — `limit 8`
// (chat), `limit 14` (orchestrator), `limit 24` (chat mode) — chosen per call site, with no notion of
// what actually fits or what it costs. Three different answers to one question, none of them a policy.
//
// The design is a PRIORITY FILL against the turn's token budget, and the ordering is the whole point:
// the transcript is trimmed FIRST because it is the only input that degrades gracefully. Losing the
// oldest chat turn costs a little continuity; losing the Definition of Done costs the task.
//
// Pure: given blocks and a budget, the output is fixed. No database, no model, no clock.
//
// Run: pnpm exec tsx --test src/main/harness/assemble.test.ts
import { TURN_BUDGETS, type TurnKind } from '@neuramesh/shared';

/** Where a piece of context came from — also its trim priority (earlier = kept longer). */
export type BlockSource =
  | 'contract'    // what this agent IS for this turn — never trimmed
  | 'facts'       // the task/thread: title, state, requirements
  | 'dod'         // the Definition of Done — the acceptance contract
  | 'rework'      // why this turn is running again (a review bounce, a park wake)
  | 'notes'       // what earlier agents on this subject wrote down (docs/harness/01)
  | 'results'     // subagent result envelopes (docs/harness/02)
  | 'lessons'     // channel lessons: corrections that must not repeat
  | 'recall'      // memory-spine hits
  | 'transcript'  // the conversation tail — trimmed first
  | 'skills'
  | 'attachments';

/**
 * Fill order, most load-bearing first.
 *
 * `transcript` sits late on purpose: it is the one block that still means something at half its size.
 * `contract` is first and never dropped — a turn that forgets what it is produces confident nonsense.
 */
export const FILL_ORDER: readonly BlockSource[] = [
  'contract', 'facts', 'dod', 'rework', 'notes', 'results', 'lessons', 'recall', 'transcript', 'skills', 'attachments',
];

export interface Block {
  source: BlockSource;
  text: string;
  /** transcript lines, newest last — a trimmable block hands over its parts so the tail can be cut */
  parts?: string[];
}

export interface Assembled {
  text: string;
  /** what made it in, with cost — written to the ledger so context spend is measurable, not asserted */
  included: Array<{ source: BlockSource; tokens: number }>;
  /** what was cut, and why — never silent (the #1015 lesson) */
  dropped: Array<{ source: BlockSource; reason: 'budget' | 'empty'; tokens: number }>;
  tokens: number;
}

/**
 * Token estimate.
 *
 * Deliberately a cheap heuristic (≈4 chars/token) rather than a real tokenizer: a tokenizer in the
 * assembly path is a vendor dependency in the agent hot path, which doctrine §8 says needs a written
 * justification. Budgets exist to prevent runaway prompts, and for that a consistent ±15% estimate is
 * as useful as an exact count — and an order of magnitude cheaper.
 */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/**
 * Assemble a turn's context within its budget.
 *
 * Blocks are filled in FILL_ORDER. A block that does not fit whole is TRIMMED if it has `parts`
 * (newest kept — recency is what a transcript is for) and dropped otherwise. Either way it is
 * reported, because a silently truncated prompt reads as "the model saw everything" when it did not.
 */
export function assemble(blocks: readonly Block[], budgetTokens: number): Assembled {
  const bySource = new Map<BlockSource, Block>();
  for (const b of blocks) if (b.text.trim() || b.parts?.length) bySource.set(b.source, b);

  const included: Assembled['included'] = [];
  const dropped: Assembled['dropped'] = [];
  const chosen: string[] = [];
  let spent = 0;

  for (const source of FILL_ORDER) {
    const b = bySource.get(source);
    if (!b) continue;
    const whole = estimateTokens(b.text);
    const room = budgetTokens - spent;

    if (whole <= room) {
      chosen.push(b.text);
      included.push({ source, tokens: whole });
      spent += whole;
      continue;
    }
    // does not fit whole. A parts-block keeps its NEWEST lines; anything else is dropped entire —
    // half a Definition of Done is worse than none, because it reads as complete.
    if (b.parts?.length && room > 0) {
      const kept: string[] = [];
      let used = 0;
      for (let i = b.parts.length - 1; i >= 0; i -= 1) {
        const cost = estimateTokens(b.parts[i]!) + 1;
        if (used + cost > room) break;
        kept.unshift(b.parts[i]!);
        used += cost;
      }
      if (kept.length) {
        const note = kept.length < b.parts.length ? `[earlier ${b.parts.length - kept.length} message(s) trimmed to fit]\n` : '';
        chosen.push(note + kept.join('\n'));
        included.push({ source, tokens: used });
        spent += used;
        if (kept.length < b.parts.length) dropped.push({ source, reason: 'budget', tokens: whole - used });
        continue;
      }
    }
    dropped.push({ source, reason: 'budget', tokens: whole });
  }

  return { text: chosen.join('\n\n'), included, dropped, tokens: spent };
}

/** The budget for a turn kind, minus a reserve for the model's own output. */
export function contextBudget(kind: TurnKind, reserve = 0.15): number {
  return Math.floor(TURN_BUDGETS[kind].contextTokens * (1 - reserve));
}

/**
 * Build a transcript block from message rows.
 *
 * The row cap it replaces was the arbitrary part: `limit 8` / `limit 14` / `limit 24` decided how much
 * history a turn got by call site rather than by budget. Rows still come from SQL with a generous
 * ceiling, but how many SURVIVE is now the budget's call — so a terse conversation keeps more turns
 * than a verbose one, which is what "fits" actually means.
 */
export function transcriptBlock(
  rows: ReadonlyArray<{ author_kind: string; author_id?: string; body: string }>,
  opts: { selfId?: string; label?: string } = {},
): Block {
  const parts = rows.map((r) => {
    const who = r.author_kind === 'agent' ? (opts.selfId && r.author_id === opts.selfId ? 'you' : 'another agent') : 'human';
    return `${who}: ${r.body.replace(/\s+/g, ' ').trim()}`;
  });
  return { source: 'transcript', text: (opts.label ? `${opts.label}\n` : '') + parts.join('\n'), parts };
}

/** A one-line summary for the ledger + the activity log: what the turn was told, and what it cost. */
export function assemblyLine(a: Assembled): string {
  const inc = a.included.map((i) => `${i.source} ${i.tokens}`).join(', ');
  const cut = a.dropped.length ? ` · trimmed: ${a.dropped.map((d) => d.source).join(', ')}` : '';
  return `context ${a.tokens} tok (${inc})${cut}`;
}
