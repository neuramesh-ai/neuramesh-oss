// THE RAIL ROW'S GLYPH VOCABULARY (rail-ink round, 2026-09-04 — docs/design/rail-ink-type-2026-09).
//
// A row's leading glyph says what KIND of thing it is; colour survives only while a task is
// active; animation is spent on exactly two things — a run in progress and a question waiting on
// a human. Before this every task row led with the same 6px state dot, and the dot pulsed for
// liveness and for needs-you alike, so a settled thread and a live one looked like siblings and
// the settled ones read as "the boring pulsing dot" (George).
//
// Pure and total over the FSM (src/main/rowglyph.test.ts walks every state) so the renderer
// never has to think about a state it has not met.
import type { ThreadStatus } from '@neuramesh/shared';

export type RowKind = 'chat' | 'task' | 'routine' | 'code';
export type RowGlyph = 'orb' | 'clock' | 'chat' | 'code' | 'circle' | 'dot' | 'check';

/** nothing is happening yet — a hollow circle, no colour */
export const WAITING_STATES: ReadonlySet<string> = new Set(['backlog', 'todo']);
/** the work is over — a check in a circle, no colour */
export const SETTLED_STATES: ReadonlySet<string> = new Set(['done', 'accepted', 'closed']);

export function rowGlyphFor(row: { kind: RowKind; state: string | null; run: boolean }): RowGlyph {
  if (row.run) return 'orb';
  if (row.kind === 'routine') return 'clock';
  if (row.kind === 'code') return 'code'; // an engineering session (#391): the prompt glyph, no FSM hue
  if (row.kind === 'chat' || !row.state) return 'chat';
  if (WAITING_STATES.has(row.state)) return 'circle';
  if (SETTLED_STATES.has(row.state)) return 'check';
  return 'dot'; // every active state keeps its hue, as before
}

export type RowTrail =
  | { kind: 'status'; status: ThreadStatus }
  | { kind: 'ask' }
  | { kind: 'frac'; text: string }
  | { kind: 'fact'; text: string }
  | { kind: 'when'; text: string };

/**
 * The ONE trailing thing.
 *
 * THE STATUS WORD TAKES THE SLOT (2026-09-09, George — settle round, mark M4). A rail row said
 * nothing about its status, so the ⋯ menu's old `Bring back` named a state the row hid; the fix is the
 * word itself, the one the ⌘Y overlay and the phone already wear. It costs the room name and the
 * age, which is the price the mark was chosen at: both come back on the hover card, and ⌘Y is
 * where you search. The `ask` pulse folds INTO the word — "needs you" says the same thing in
 * letters — and a run's fraction yields to it too, the orb in the gutter carrying liveness.
 *
 * Rows with no status (an engineering session, a routine with no thread) keep the old ladder:
 * question, progress, the fact the scope does not say, then the age.
 */
export function rowTrailFor(row: { status?: ThreadStatus | null; ask: boolean; run: { done: number; total: number } | null; fact: string | null; when: string }): RowTrail {
  if (row.status) return { kind: 'status', status: row.status };
  if (row.ask) return { kind: 'ask' };
  if (row.run && row.run.total > 0) return { kind: 'frac', text: `${row.run.done}/${row.run.total}` };
  if (row.fact) return { kind: 'fact', text: row.fact };
  return { kind: 'when', text: row.when };
}

/** a chat is named by its human; a task's title is frozen once work starts (handler/fsm.ts) */
export function renamable(kind: RowKind, state: string | null): boolean {
  if (kind === 'chat') return true;
  if (kind === 'task') return !!state && WAITING_STATES.has(state);
  return false;
}
