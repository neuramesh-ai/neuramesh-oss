// Plan + design-round artifact derivations — extracted from App.tsx (track A2).
// The block splitter is what the review overlay comments against, so its fence handling
// is load-bearing: a mis-split block silently re-anchors every comment after it.
import { designVer, planVer, shipPlanVer } from '../review';

// Plan review (Phase 3): the human reads the proposed implementation plan and
// leaves inline comments — highlight a line, leave a note — which batch into ONE
// revision request (task.revise_plan) that wakes the architect to re-draft
// incorporating them. "Approve" releases the plan to execution instead.
// Split plan markdown into top-level renderable blocks (separated by blank lines),
// keeping fenced code regions intact. Each block is independently rendered + commentable.
export function splitPlanBlocks(md: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence = false;
  const flush = () => { const s = cur.join('\n').replace(/\s+$/, ''); if (s.trim()) out.push(s); cur = []; };
  for (const ln of md.split('\n')) {
    if (/^\s*```/.test(ln)) { fence = !fence; cur.push(ln); continue; }
    if (!fence && ln.trim() === '') { flush(); continue; }
    cur.push(ln);
  }
  flush();
  return out;
}

// GitHub-style alert callouts (> [!IMPORTANT] etc.) render as colored, labeled boxes
// so assumptions / open questions / recommendations pop out of the plan during review.
export const ALERT_META: Record<string, { label: string; cls: string }> = {
  NOTE: { label: 'Note', cls: 'note' },
  TIP: { label: 'Tip', cls: 'tip' },
  IMPORTANT: { label: 'Important', cls: 'important' },
  WARNING: { label: 'Warning', cls: 'warning' },
  CAUTION: { label: 'Caution', cls: 'caution' },
};

export function parsePlanAlert(block: string): { type: string; body: string } | null {
  const m = block.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][^\n]*\n?([\s\S]*)$/i);
  if (!m) return null;
  const body = (m[2] ?? '').split('\n').map((l) => l.replace(/^>\s?/, '')).join('\n').trim();
  return { type: (m[1] ?? 'NOTE').toUpperCase(), body };
}

// What a reviewable artifact IS — its name pattern and its version — now belongs to `review.ts`
// (`planVer` · `shipPlanVer` · `designVer` · `reviewKind`), because that is what binds a gate to
// it. These list helpers stay here: picking the latest round out of a task's artifact rows is the
// renderer's business, and the version rule they sort by is imported rather than restated.
export const DESIGN_RE = /^design-mockup-v(\d+)-/;

export function pickPlans<T extends { name: string }>(arts: T[]): { all: T[]; latest: T | undefined } {
  const all = arts.filter((a) => planVer(a.name) > 0).sort((a, b) => planVer(b.name) - planVer(a.name));
  return { all, latest: all[0] };
}

export function pickShipPlans<T extends { name: string }>(arts: T[]): { all: T[]; latest: T | undefined } {
  const all = arts.filter((a) => shipPlanVer(a.name) > 0).sort((a, b) => shipPlanVer(b.name) - shipPlanVer(a.name));
  return { all, latest: all[0] };
}

export function pickDesigns<T extends { name: string; kind: string }>(arts: T[]): { all: T[]; latestRound: number } {
  const all = arts.filter((a) => a.kind === 'design' || designVer(a.name) > 0);
  return { all, latestRound: all.reduce((m, a) => Math.max(m, designVer(a.name)), 0) };
}

// Render a mockup under a chosen (or the app's current) theme: mockups honor
// data-theme on <html> (the docs/14 designer contract) — rewrite it, injecting
// it when absent, since an iframe can't be forced to a prefers-color-scheme.
export function themedMockupDoc(html: string, mode?: 'dark' | 'light'): string {
  const m = mode ?? (((document.documentElement.getAttribute('data-theme') ?? 'dark').includes('dark')) ? 'dark' : 'light');
  if (/<html[^>]*data-theme\s*=\s*"/i.test(html)) return html.replace(/(<html[^>]*data-theme\s*=\s*")[^"]*(")/i, `$1${m}$2`);
  if (/<html/i.test(html)) return html.replace(/<html/i, `<html data-theme="${m}"`);
  return `<!doctype html><html data-theme="${m}"><body>${html}</body></html>`;
}

export function designMockupLabel(name: string): string {
  const plain = name.replace(DESIGN_RE, '').replace(/\.html?$/i, '').replace(/[-_]+/g, ' ').trim();
  return plain ? plain.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Design direction';
}

// A note: something the human said in the round that should CHANGE. Local to the
// studio (exactly like the review tab's comment batch, docs/36 §13) — they accumulate as
// editable pills and are spent all at once by Redraw. Losing un-spent notes on close matches a
// review tab losing its unsent batch when you close it; the alternative is a second store of design feedback,
// and dual truth has bitten this codebase before.
export type DesignNote = { id: number; text: string; from?: string | null };
