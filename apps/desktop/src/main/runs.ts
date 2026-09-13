// Runs (docs/29) — the pure parts: how an activity stream becomes a run's live `step` line.
//
// The ghost pill (docs/26) can afford to swap every 450ms because it's local IPC. A run's step
// is a SERVER WRITE that fans out to every machine over PowerSync, so it has to be rationed:
// a tool burst fires ~10 rows/second and would turn a status line into a write storm for no
// human benefit — nobody reads a line that changes ten times a second.
//
// Kept pure (clock injected) so the rationing is unit-testable without a daemon.
import { toolVerb } from '@neuramesh/shared';

/** the floor between two synced step writes. Below this, a human reads flicker, not progress. */
export const STEP_MIN_MS = 2_500;

export interface Narrator {
  /** the verb this row becomes, or null when it's too soon / the row says nothing new */
  next(row: { kind: string; phase: string | null; summary: string }, now: number): string | null;
}

export function makeNarrator(minMs = STEP_MIN_MS): Narrator {
  // `null` means NOTHING HAS BEEN SAID YET, which is not the same as "said at time 0" — the
  // first real verb is the one that ends the dead air, so it never waits out the interval.
  let lastAt: number | null = null;
  let lastVerb = '';
  return {
    next(row, now) {
      const v = toolVerb(row);
      if (!v) return null;
      if (v.verb === lastVerb) return null; // the same words twice is not news
      if (lastAt !== null && now - lastAt < minMs) return null;
      lastAt = now;
      lastVerb = v.verb;
      return v.verb;
    },
  };
}

// ── deep work: the fan-out plan ────────────────────────────────────────────────────────────
// A leg is one named strand of a `work` run. The names are the human's read of the fan-out, so
// they're held to the same bar as beats (docs/17 §10): few, legible, no identifiers.
export interface WorkLeg {
  name: string;
  prompt: string;
}
export const MAX_LEGS = 6;
export const MAX_LEG_CONCURRENCY = 3;

/** what the parent's step line says while N legs are in flight */
export function fanoutStep(done: number, total: number, live: string[]): string {
  if (done >= total) return 'synthesizing the report';
  const head = live.length ? live.slice(0, 2).join(' · ') : 'starting the legs';
  return `${head}${live.length > 2 ? ` +${live.length - 2}` : ''}`;
}

/** trim/dedupe/cap the model's proposed legs — the prompt asks nicely, this enforces */
export function normalizeLegs(legs: Array<{ name?: string; prompt?: string }>): WorkLeg[] {
  const out: WorkLeg[] = [];
  const seen = new Set<string>();
  for (const l of legs) {
    const name = (l.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const prompt = (l.prompt ?? '').trim();
    if (!name || !prompt) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, prompt });
    if (out.length >= MAX_LEGS) break;
  }
  return out;
}

/** run `fn` over items with a concurrency cap, preserving input order in the results */
export async function mapCapped<T, R>(items: T[], cap: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(cap, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}
