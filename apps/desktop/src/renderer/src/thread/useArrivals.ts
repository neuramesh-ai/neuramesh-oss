// The React side of shell/arrivals.ts: one watch's deliveries, noted per session, and the agent
// messages whose markers name something to open (an article, a report, a brief, a whiteboard).
import { useEffect, useRef } from 'react';
import { parseArticleRef, parseBriefRef, parseReportRef, parseWhiteboardRef } from '@neuramesh/shared';
import { fileArrivalKind, noteRows, seenStart, type ArrivalRow, type PanelArrival, type SeenState } from '../shell/arrivals';
import { designVer } from '../review';
import { reviewKind } from '../review-names';
import type { ArtifactUI } from '../bridge/rows-board';
import type { ChannelArtifactRow, MessageRow } from '../bridge/rows-rooms';

/**
 * Report the rows of one watch that land AFTER the session `key` settled. `onFresh` absent (a task
 * inside a panel tab) means this surface reports nothing: it is not the session in front.
 */
export function useArrivals<T extends ArrivalRow>(rows: readonly T[] | null | undefined, key: string | null, onFresh: ((fresh: T[]) => void) | undefined): void {
  const st = useRef<SeenState | null>(null);
  const cb = useRef(onFresh);
  cb.current = onFresh;
  useEffect(() => {
    if (!key) return;
    const now = Date.now();
    if (!st.current || st.current.key !== key) st.current = seenStart(key, now);
    const fresh = noteRows(st.current, rows ?? [], now);
    if (fresh.length) cb.current?.(fresh);
  }, [rows, key]);
}

/** what an agent's new messages ask the panel to open: the card markers, one per message */
export function markerArrivals(msgs: readonly MessageRow[]): PanelArrival[] {
  const out: PanelArrival[] = [];
  for (const m of msgs) {
    if (m.author_kind !== 'agent' || !m.body) continue;
    const article = parseArticleRef(m.body);
    if (article) { out.push({ kind: 'article', via: 'artifact', id: article.id, article: true }); continue; }
    const report = parseReportRef(m.body) ?? parseBriefRef(m.body);
    if (report) { out.push({ kind: 'doc', via: 'artifact', id: report.id }); continue; }
    const wb = parseWhiteboardRef(m.body);
    if (wb) out.push({ kind: 'board', via: 'board', id: wb.id, title: /⊞ \*\*(.{1,220}?)\*\*/.exec(m.body)?.[1] ?? 'Whiteboard' });
  }
  return out;
}

/**
 * A task's new deliverables: a review under a gate (a plan, a release plan, a design round) or a
 * file. A human's attachment carries a message id and never opens by itself, and a design round's
 * mockups open as ONE arrival per round.
 */
export function taskArrivals(fresh: readonly ArtifactUI[]): PanelArrival[] {
  const rounds = new Set<number>();
  const out: PanelArrival[] = [];
  for (const a of fresh) {
    if (a.message_id) continue;
    const rk = reviewKind(a.name, a.kind);
    if (rk === 'design') { const v = designVer(a.name); if (rounds.has(v)) continue; rounds.add(v); }
    out.push({ kind: rk ? 'gate' : fileArrivalKind(a.name, a.kind), via: 'task', name: a.name });
  }
  return out;
}

/** a conversation's new files: what an agent's message carries (a human's own upload never opens by itself) */
export function convoArrivals(fresh: readonly ChannelArtifactRow[], msgs: readonly MessageRow[]): PanelArrival[] {
  // an artifact can sync before its message: only a message KNOWN to be a human's holds a file back
  const human = new Set(msgs.filter((m) => m.author_kind === 'human').map((m) => m.id));
  return fresh
    .filter((a) => !!a.inline_content && !(a.message_id && human.has(a.message_id)))
    .map((a) => ({ kind: fileArrivalKind(a.name, a.kind), via: 'doc' as const, label: a.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), file: a.name, doc: a.inline_content! }));
}
