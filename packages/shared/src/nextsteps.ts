// Next-step cards (docs/design/marketing-os-2026-08 §13, round 4) — a finished playbook
// run's report, distilled to ≤5 armable items. The ```nmnext block is the nmsched/nmplays
// sibling: the daemon's distill writes it, ONE renderer derivation turns it into the card,
// and every arm verb fires from the HUMAN's client. The block carries its own channel +
// anchor so the card is self-contained in any thread renderer (the SchedRecsCard rule).
//
// Custody (round 4a, George): armed items stay in the thread the card lives in — a task
// becomes a SUBTASK when the anchor is a task, an origin-anchored unit when it is a
// conversation; research posts its opener INTO the same thread.

import { fencedBlock, stripFenced } from './linear';

export type NextStepKind = 'task' | 'routine' | 'research';

export interface NextStepItem {
  kind: NextStepKind;
  title: string;
  /** one line: why this, from the report's own reasoning */
  why?: string;
  /** source anchor — the report section the item came from ("Fix these first · #1") */
  src?: string;
  // task
  description?: string;
  taskKind?: 'research' | 'content' | 'feature' | 'bug' | 'chore';
  // routine
  cadence?: 'daily' | 'weekdays' | 'weekly';
  weekday?: number;
  atTime?: string;
  prompt?: string;
  // research
  opener?: string;
}

export interface NmNext {
  report: string;
  channel: string;
  anchor: { taskId?: string; threadId?: string };
  /** honesty header: "picked of total" — the card says when the agent chose */
  picked: number;
  total: number;
  items: NextStepItem[];
}

// The card pages at 5; the distill keeps EVERY worthwhile recommendation up to 40 —
// "5 of 40" with no way at the other 35 was the founder's 2026-08-22 bug.
export const NEXT_STEPS_CAP = 40;
export const NEXT_STEPS_PAGE = 5;

/** clamp/validate a model-extracted item list — the shape guard the distill trusts */
export function cleanNextItems(raw: unknown): NextStepItem[] {
  if (!Array.isArray(raw)) return [];
  const out: NextStepItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const kind = o['kind'];
    const title = typeof o['title'] === 'string' ? o['title'].trim().slice(0, 90) : '';
    if (!title || (kind !== 'task' && kind !== 'routine' && kind !== 'research')) continue;
    const item: NextStepItem = { kind, title };
    if (typeof o['why'] === 'string' && o['why'].trim()) item.why = o['why'].trim().slice(0, 140);
    if (typeof o['src'] === 'string' && o['src'].trim()) item.src = o['src'].trim().slice(0, 60);
    if (kind === 'task') {
      if (typeof o['description'] === 'string') item.description = o['description'].slice(0, 2000);
      const tk = o['taskKind'];
      item.taskKind = tk === 'content' || tk === 'feature' || tk === 'bug' || tk === 'chore' ? tk : 'research';
    }
    if (kind === 'routine') {
      const c = o['cadence'];
      item.cadence = c === 'daily' || c === 'weekly' ? c : 'weekdays';
      if (item.cadence === 'weekly') item.weekday = typeof o['weekday'] === 'number' && o['weekday'] >= 0 && o['weekday'] <= 6 ? o['weekday'] : 1;
      item.atTime = typeof o['atTime'] === 'string' && /^\d{2}:\d{2}$/.test(o['atTime']) ? o['atTime'] : '09:00';
      item.prompt = typeof o['prompt'] === 'string' && o['prompt'].trim() ? o['prompt'].trim().slice(0, 300) : title;
    }
    if (kind === 'research') {
      item.opener = typeof o['opener'] === 'string' && o['opener'].trim() ? o['opener'].trim().slice(0, 500) : title;
    }
    out.push(item);
    if (out.length >= NEXT_STEPS_CAP) break;
  }
  return out;
}

export function nextStepsBlock(data: NmNext): string {
  return '```nmnext\n' + JSON.stringify(data) + '\n```';
}

export function parseNextSteps(body: string): NmNext | null {
  const m = fencedBlock(body, 'nmnext');
  if (!m) return null;
  try {
    const d = JSON.parse(m.inner) as NmNext;
    if (!d || typeof d.report !== 'string' || typeof d.channel !== 'string' || !d.anchor) return null;
    const items = cleanNextItems(d.items);
    if (!items.length) return null;
    return { report: d.report, channel: d.channel, anchor: d.anchor, picked: items.length, total: Number(d.total) || items.length, items };
  } catch { return null; }
}

export function stripNextSteps(body: string): string {
  return stripFenced(body, 'nmnext').trim();
}
