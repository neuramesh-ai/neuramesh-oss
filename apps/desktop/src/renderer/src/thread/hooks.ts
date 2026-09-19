// Thread hooks — live runs and the token stream itself.
// Extracted from App.tsx (track A3).
import { nm as nmBridge } from '../bridge/nm';
import { type RunUI } from '../bridge/rows-board';
import { useEffect, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// live token stream for one conversation key (`${channelId}:${taskId??''}`).
// local agents on this machine paint a building bubble; it clears on `done`,
// just as the finished message lands over sync.
// PRESENCE, not just content (v0.43.1): the daemon opens the stream the moment an agent
// wakes for this surface — empty text means "working here, no tokens yet". That's how a
// non-assignee (rex answering in someone else's task thread) gets a live status at all:
// attribution comes from the daemon that ran the wake, never a guess at global status.
// `done` closes it. Consumers split the two: presence mounts the ghost, text draws the bubble.
export function useAgentStream(key: string | null): { agent: string; text: string } | null {
  const [s, setS] = useState<{ agent: string; text: string } | null>(null);
  useEffect(() => {
    if (!nm || !key) return;
    setS(null);
    return nm.watchAgentStream((p) => {
      if (p.key !== key) return;
      setS(p.done ? null : { agent: p.agent, text: p.text });
    });
  }, [key]);
  return s;
}

/** the room's runs, live from the synced replica */
export function useRuns(channelId: string | null): RunUI[] {
  const [rows, setRows] = useState<RunUI[]>([]);
  useEffect(() => {
    if (!nm || !channelId) { setRows([]); return; }
    return nm.watchRuns(channelId, setRows);
  }, [channelId]);
  return rows;
}

// ── Deliverables (docs/30): the file renders where it lands ───────────────────────────────
// A finished task's payoff used to be a sentence ("Delivered 1 file: X.md — attached for review")
// with the payload one drawer-click away. These cards put the file IN the transcript: typed by the
// SAME previewType() the artifacts drawer uses, bounded to a scrollable window so a 3,000-word
// report can never push the composer off screen, and horizontally scrollable when a submit drops
// several. The artifact itself is untouched — this is a second VIEW of the same row, never a copy.
