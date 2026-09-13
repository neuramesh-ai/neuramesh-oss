// THE CONNECTIONS in the shell (U3b, the source-release round). Two hooks App mounts:
//  · `useConnections` — the list main holds (connections.ts), one read on mount, then main's pushes;
//  · `useForegroundSwap` — opening a rail row on ANOTHER connection: main flips the pointer
//    (`setForeground`, no relaunch), `nm:foreground` remounts the shell (renderer/main.tsx), and the
//    NEW shell opens the row — so the ask crosses the remount in sessionStorage with the click's
//    timestamp, and the effect lands it once the shell names the new workspace, printing the swap
//    against the <100ms view-switch budget as `rail_swap`;
// A hook rather than shell state so App.tsx's line ratchet holds.
import { useCallback, useEffect, useState } from 'react';
import { nm, type ConnectionInfo, type ConnectionSummary } from '../bridge/nm';
import { foregroundSwapFor, type NavConnTag } from '../navbands';
import type { NavTreeRowMeta } from '../navtree';

const PENDING_OPEN_KEY = 'nm:pendingOpen';

export function useConnections(authed: boolean): { conns: ConnectionSummary[]; refresh: () => void } {
  const [conns, setConns] = useState<ConnectionSummary[]>([]);
  useEffect(() => {
    if (!authed || !nm?.connections) return;
    void nm.connections().then(setConns).catch(() => { /* the shell still has its foreground */ });
    return nm.onConnections?.(setConns);
  }, [authed]);
  const refresh = useCallback(() => { void nm?.connections?.().then(setConns).catch(() => { /* the pushed list stands */ }); }, []);
  return { conns, refresh };
}

type SwapRow = NavTreeRowMeta & NavConnTag & { task: { id: string } | null; threadId: string | null; engineeringSessionId?: string };
type Pending = { t0: number; connectionId: string; taskId?: string; threadId?: string; channelId?: string | null };

export function useForegroundSwap(opts: {
  boot: { resolving?: boolean; connection?: ConnectionInfo } | null;
  connections: ConnectionSummary[];
  foregroundId: string | null;
  openTask: (id: string) => void;
  openThread: (id: string, channelId: string | null) => void;
  onError: (e: unknown) => void;
}): { openOnConnection: (r: SwapRow) => void } {
  const openOnConnection = (r: SwapRow) => {
    const swap = foregroundSwapFor(r, opts.foregroundId ?? '', opts.connections);
    if (!swap || !nm?.setForeground) return;
    const open = r.engineeringSessionId ? {} : r.task ? { taskId: r.task.id } : r.threadId ? { threadId: r.threadId, channelId: r.channelId } : {};
    try { sessionStorage.setItem(PENDING_OPEN_KEY, JSON.stringify({ t0: performance.now(), connectionId: swap.connectionId, ...open } satisfies Pending)); } catch { /* private mode */ }
    void nm.setForeground(swap.connectionId, swap.workspaceId).catch((e: unknown) => { console.error('foreground swap failed', e); opts.onError(e); });
  };
  const { boot } = opts;
  useEffect(() => {
    if (!boot || boot.resolving || !boot.connection) return;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(PENDING_OPEN_KEY); } catch { return; }
    if (!raw) return;
    let p: Pending;
    try { p = JSON.parse(raw) as Pending; } catch { sessionStorage.removeItem(PENDING_OPEN_KEY); return; }
    if (p.connectionId !== boot.connection.id) return;
    sessionStorage.removeItem(PENDING_OPEN_KEY);
    const ms = performance.now() - p.t0;
    console.log(`rail_swap ms=${ms.toFixed(1)} budget_ms=100 ok=${ms < 100} to=${p.connectionId}`);
    (window as unknown as { __nmSwapMs?: number }).__nmSwapMs = ms;
    if (p.taskId) opts.openTask(p.taskId);
    else if (p.threadId) opts.openThread(p.threadId, p.channelId ?? null);
  }, [boot]); // eslint-disable-line react-hooks/exhaustive-deps -- the openers close over the shell's setters
  return { openOnConnection };
}
