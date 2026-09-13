// SETTLE (the thread-status round, 2026-09-08): the one act a needs-you row offers. It stamps
// threads.settled_at (thread.settle, HUMAN_ONLY) and nothing else — no approve, no merge, no dismiss.
//
// Two things make it feel right on a phone. The row leaves AT ONCE: the stamp is held locally
// until the synced row carries it (a swipe that leaves the row sitting there is the "not now"
// bug of 2026-09-06 again). And it is reversible, so there is no confirm: an undo pill holds
// the last settle for a beat (UNDO_MS), the desktop's archive idiom.
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { api } from './auth';
import { shouldPeek, UNDO_MS } from './settle-rules';

const SETTLED_ONCE_KEY = 'nm.settled-once';
let settledOnce: boolean | null = null;
let peekedThisLaunch = false;

async function loadSettledOnce(): Promise<boolean> {
  if (settledOnce !== null) return settledOnce;
  settledOnce = (await SecureStore.getItemAsync(SETTLED_ONCE_KEY).catch(() => null)) === '1';
  return settledOnce;
}
function markSettledOnce(): void {
  settledOnce = true;
  void SecureStore.setItemAsync(SETTLED_ONCE_KEY, '1').catch(() => {});
}

export interface Undo { threadId: string; title: string }

export function useSettle(ws: string | null) {
  /** threadId → the moment it was settled here, ahead of sync */
  const [local, setLocal] = useState<Map<string, string>>(() => new Map());
  const [undo, setUndo] = useState<Undo | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const settle = useCallback(async (threadId: string, title: string) => {
    if (!ws) return;
    const now = new Date().toISOString();
    setLocal((m) => new Map(m).set(threadId, now));
    setUndo({ threadId, title });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setUndo(null), UNDO_MS);
    markSettledOnce();
    try {
      await api.command({ type: 'thread.settle', workspace: ws, threadId });
    } catch {
      // the server said no: the row comes back rather than sitting settled on this phone only
      setLocal((m) => { const n = new Map(m); n.delete(threadId); return n; });
      setUndo(null);
    }
  }, [ws]);

  const unsettle = useCallback(async () => {
    const u = undo;
    if (!u || !ws) return;
    setUndo(null);
    if (timer.current) clearTimeout(timer.current);
    setLocal((m) => { const n = new Map(m); n.delete(u.threadId); return n; });
    await api.command({ type: 'thread.unsettle', workspace: ws, threadId: u.threadId }).catch(() => {});
  }, [undo, ws]);

  return { local, undo, settle, unsettle };
}

/** Decide, once, whether the top row should peek — and claim the launch's one peek if so. */
export async function claimPeek(rows: number): Promise<boolean> {
  const [reduceMotion, once] = await Promise.all([AccessibilityInfo.isReduceMotionEnabled().catch(() => false), loadSettledOnce()]);
  if (!shouldPeek({ reduceMotion, settledOnce: once, peekedThisLaunch, rows })) return false;
  peekedThisLaunch = true;
  return true;
}

/** reduced motion gets the words instead of the motion */
export async function wantsHint(): Promise<boolean> {
  const [reduceMotion, once] = await Promise.all([AccessibilityInfo.isReduceMotionEnabled().catch(() => false), loadSettledOnce()]);
  return reduceMotion && !once;
}
