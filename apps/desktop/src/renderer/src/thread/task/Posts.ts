// A content task's drafted posts. contentByThread is a query rather than a synced watch, so
// this polls — the same shape as the conversation's own thread-native drafts (thread/usePosts).
// Split out of thread/TaskThread.tsx.
import { useEffect, useState } from 'react';
import { imageCredOf } from '../../settings/ConnectionsList';
import { nm as nmBridge } from '../../bridge/nm';
import type { ContentItemRow } from '../../bridge/rows-content';
import type { TaskRow } from '../../bridge/rows-board';

const nm = nmBridge;

export function useTaskPosts(task: TaskRow, rowCount: number) {
// Marketing content tasks: the drafted posts (content_items attached to this task) render inline
// as cards; every mutation rides the existing human PostPreviewModal (marketing-workflow §4.5).
const isContent = task.kind === 'content';
const [mkPosts, setMkPosts] = useState<ContentItemRow[]>([]);
// is there anything to draw WITH? undefined until we know — the card must not accuse the setup
// of being broken before we've checked. Only a content task ever asks.
const [mkImageReady, setMkImageReady] = useState<boolean | undefined>(undefined);
const [mkPreview, setMkPreview] = useState<ContentItemRow | null>(null);
const [mkTick, setMkTick] = useState(0);
useEffect(() => {

  let dead = false;
  const load = () => { void nm?.contentByTask(task.id).then((r) => { if (!dead) setMkPosts(r.items); }, () => {}); };
  load();
  // one check, not per card: is any image-capable provider key on file?
  void nm?.credentials().then(
    (r) => { if (!dead) setMkImageReady(!!imageCredOf(r.credentials ?? [])); },
    () => {},
  );
  // the marketer's drafts land AFTER the panel is already open — contentByTask is a query, not a
  // synced watch, so poll it like the other content surfaces (BrandDocsRail / UpcomingList do the
  // same). Without this the cards only appeared on remount (close + reopen the thread).
  const iv = setInterval(load, 4000);
  return () => { dead = true; clearInterval(iv); };
  // rowCount: a new thread message ("Drafted 2 posts…") is the cue the drafts just landed —
  // refetch immediately instead of waiting out the poll interval
}, [task.id, mkTick, rowCount]);
  return { isContent, mkImageReady, mkPosts, mkPreview, setMkPreview, setMkTick };
}
