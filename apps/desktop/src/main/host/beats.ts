// The host's beat writer (docs/17) — extracted from agents.ts (track B2).
//
// Beats are DESCRIPTIVE, never an FSM gate: a write that the server refuses (the role no
// longer owns the task's phase) is swallowed on purpose, which is why a flow must settle
// its beats BEFORE the command that moves it out of that phase.
//
// The first service on the ctx pattern: the maker destructures what it needs, so the
// function bodies below are the originals, unedited.
import type { HostCtx } from './ctx';

/** the four states a beat row can hold (docs/17) */
export type BeatStatusW = 'pending' | 'active' | 'done' | 'blocked';

// No hand-written interface: the return type is INFERRED from the functions themselves.
// A written one is a second statement of the same signatures, and the first draft of this
// file proved the point — it guessed three of them wrong and typecheck caught all three.
export function makeBeats({ post }: HostCtx) {
async function declareBeats(actor: { kind: string; id: string; role?: string }, taskId: string, phase: string, items: string[]): Promise<boolean> {
  try {
    const res = await post('/v1/commands', actor, { type: 'beats.declare', taskId, phase, items });
    if (res.ok) return true;
    console.error(`beats.declare ${taskId} failed: ${res.status} ${await res.text().catch(() => '')}`);
    return false;
  } catch (err) {
    console.error(`beats.declare ${taskId} error:`, err);
    return false;
  }
}
async function advanceBeat(actor: { kind: string; id: string; role?: string }, taskId: string, seq: number, status: BeatStatusW): Promise<void> {
  try {
    const res = await post('/v1/commands', actor, { type: 'beats.advance', taskId, seq, status });
    if (!res.ok) console.error(`beats.advance ${taskId} seq ${seq} failed: ${res.status} ${await res.text().catch(() => '')}`);
  } catch (err) {
    console.error(`beats.advance ${taskId} seq ${seq} error:`, err);
  }
}
// A per-flow cursor over one declared set: declare() lights beat 0; next() finishes the
// active beat and lights the next (or settles the set when it was the last); fail() marks
// the in-flight beat blocked when the flow stops there — call it BEFORE the command that
// transitions the task out of this phase, since a beat write needs the agent to still own
// the phase. Inert until declare() succeeds, so a flow constructs it unconditionally and
// gates on `enabled` (live vs. the deterministic echo gate) at declare time only.
function beatCursor(actor: { kind: string; id: string; role?: string }, taskId: string) {
  let cur = -1; // the currently-active beat seq, -1 = none pending
  let count = 0;
  let on = false;
  return {
    async declare(phase: string, items: string[], enabled: boolean): Promise<void> {
      if (!enabled) return;
      on = await declareBeats(actor, taskId, phase, items);
      count = items.length;
      if (on) { cur = 0; await advanceBeat(actor, taskId, 0, 'active'); }
    },
    async next(): Promise<void> {
      if (!on || cur < 0) return;
      await advanceBeat(actor, taskId, cur, 'done');
      cur += 1;
      if (cur < count) await advanceBeat(actor, taskId, cur, 'active');
      else cur = -1;
    },
    async fail(): Promise<void> {
      if (!on || cur < 0) return;
      await advanceBeat(actor, taskId, cur, 'blocked');
      cur = -1;
    },
  };
}
  return { declareBeats, advanceBeat, beatCursor };
}
