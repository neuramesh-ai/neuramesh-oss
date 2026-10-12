import { useCallback, useEffect, useRef, useState } from 'react';
import { engineeringReviewMessages, type EngineeringChangeReview } from '@neuramesh/shared';
import type { EngineeringSession } from './domain';

/** Show each pending patch once, including one restored from another device. A manual close
 * stays closed until a different approval arrives. Empty frames do not consume the arrival. */
export function codeReviewArrival(seen: Set<string>, session: EngineeringSession | null): string | null {
  const approval = session?.pendingApproval;
  if (!session || !approval?.changes?.length) return null;
  const key = `${session.id}:${approval.id}`;
  if (seen.has(key)) return null;
  seen.add(key);
  return approval.changes[0]!.path;
}

export function useCodeReview(session: EngineeringSession | null, show: () => void) {
  const seen = useRef(new Set<string>());
  const showRef = useRef(show);
  showRef.current = show;
  const [selection, setSelection] = useState<{ session: string; path: string | null; reviewId?: string } | null>(null);
  const id = session?.id ?? '';
  const select = useCallback((path: string) => setSelection((current) => ({ ...(current?.session === id ? current : {}), session: id, path })), [id]);
  const open = useCallback((path?: string) => { setSelection({ session: id, path: path ?? null }); showRef.current(); }, [id]);
  const openReview = useCallback((review: EngineeringChangeReview, path?: string) => { setSelection({ session: id, reviewId: review.id, path: path ?? review.changes[0]?.path ?? null }); showRef.current(); }, [id]);
  useEffect(() => {
    const path = codeReviewArrival(seen.current, session);
    if (path) open(path);
  }, [session, open]);
  const selectedReview = selection?.session === id && selection.reviewId && session
    ? engineeringReviewMessages(session).find((m) => m.review?.id === selection.reviewId)?.review ?? null : null;
  return { path: selection?.session === id ? selection.path : null, selectedReview, select, open, openReview };
}
