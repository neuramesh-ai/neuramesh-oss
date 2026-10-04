// A task's design round in the thread (docs/14, docs/25): the round on stage, the door to its
// review tab, and the one-shot reveal when a new round lands. The studio column that once
// docked beside the thread retired into the side panel's review tab (the side-panel round,
// 2026-10-03). Split out of thread/TaskThread.tsx.
import { useEffect, useRef } from 'react';
import { pickDesigns } from '../../design/plans';
import { designVer } from '../../review';
import type { ArtifactUI, TaskRow } from '../../bridge/rows-board';

export function useDesignDock(d: {
  task: TaskRow;
  arts: ArtifactUI[];
  listRef: React.RefObject<HTMLDivElement | null>;
  onOpenReview?: (name?: string | null) => void;
}) {
  const { task, arts, listRef, onOpenReview } = d;
const { all: designArts, latestRound } = pickDesigns(arts);
const roundMockups = designArts.filter((a) => designVer(a.name) === latestRound && a.inline_content);
// v0.64 retired the tab strip — the thread IS the panel, so opening the studio no
// longer has to switch views first
/**
 * A design round opens as a REVIEW TAB (founder ruling 2026-08-01), and since the side-panel round
 * (2026-10-03) as ONE tab for the round in the side panel: the round is the thing being judged, so
 * its mockups share the tab as a strip. Named puts that direction on stage, and unnamed opens the
 * round on the mockup you read last.
 *
 * It routes through the shell's single artifact door rather than a private opener: the duplication
 * that door exists to prevent is two ways into one review (docs/36 §13, ruling 3).
 */
const openDesign = (name?: string) => onOpenReview?.(name ?? null);

// Artifacts and messages sync on separate streams. On a cold task open the
// message watcher can pin first, then the design gallery arrives below the
// viewport. Reveal each newly synced round once so "ready" never looks like
// prose-only chat; normal reading remains untouched after that first reveal.
const revealedDesignRound = useRef<string | null>(null);
useEffect(() => {
  if (!roundMockups.length) return;
  const key = `${task.id}:${latestRound}`;
  if (revealedDesignRound.current === key) return;
  revealedDesignRound.current = key;
  requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
}, [task.id, latestRound, roundMockups.length]);
  return { openDesign, roundMockups, latestRound };
}
