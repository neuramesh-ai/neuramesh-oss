// Drafted posts written IN a conversation (0115). Identical cards to a content task's — a
// social draft needs review, not a board row, and before this the only way to render one was
// to create a task, which is why an agent asked for drafts proposed one instead of just
// drafting. contentByThread is a query rather than a synced watch, so this polls, exactly as
// the task panel and the other content surfaces do. Split out of thread/ConvoThread.tsx.
import { useEffect, useState } from 'react';
import { imageCredOf } from '../settings/ConnectionsList';
import { nm as nmBridge } from '../bridge/nm';
import type { ContentItemRow } from '../bridge/rows-content';

const nm = nmBridge;

export function useThreadPosts(threadId: string, rowCount: number) {
// Drafted posts written IN this conversation (0115). Identical cards to a content task's — a
// social draft needs review, not a board row, and before this the only way to render one was to
// create a task, which is why an agent asked for drafts proposed one instead of just drafting.
const [mkPosts, setMkPosts] = useState<ContentItemRow[]>([]);
const [mkImageReady, setMkImageReady] = useState<boolean | undefined>(undefined);
const [mkPreview, setMkPreview] = useState<ContentItemRow | null>(null);
const [mkReplyTo, setMkReplyTo] = useState<{ id: string; letter: string } | null>(null);
const [mkTick, setMkTick] = useState(0);
useEffect(() => {
  let dead = false;
  const load = () => { void nm?.contentByThread(threadId).then((r) => { if (!dead) setMkPosts(r.items); }, () => {}); };
  load();
  void nm?.credentials().then((r) => { if (!dead) setMkImageReady(!!imageCredOf(r.credentials ?? [])); }, () => {});
  // contentByThread is a query, not a synced watch — poll it like the task panel and the other
  // content surfaces do, so drafts appear without closing and reopening the conversation
  const iv = setInterval(load, 4000);
  return () => { dead = true; clearInterval(iv); };
  // rows.length: the agent's "drafted 3 posts" message is the cue they just landed — refetch
  // immediately instead of waiting out the interval
}, [threadId, mkTick, rowCount]);
// the armed pill can't outlive its card (a draft published or deleted while you were typing)
useEffect(() => { if (mkReplyTo && !mkPosts.some((p) => p.id === mkReplyTo.id && p.status !== 'published')) setMkReplyTo(null); }, [mkReplyTo, mkPosts]);
useEffect(() => { setMkReplyTo(null); }, [threadId]);
  return { mkPosts, mkImageReady, mkPreview, setMkPreview, mkReplyTo, setMkReplyTo, setMkTick };
}
