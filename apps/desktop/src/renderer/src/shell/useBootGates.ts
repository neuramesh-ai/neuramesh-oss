// THE BOOT GATES, as the shell reads them: the first-run doors (main/firstrunipc.ts) and Local
// mode's stack card (main/localStack/ipc.ts). Both are main's state pushed over IPC; the shell
// draws and decides nothing. Their one rule lives here: the door comes FIRST, auth is read only
// once the door is done, so no data effect runs against a connection that has not booted (a fresh
// profile's Local stays dormant until the door says This Mac). The stack payload is read only on
// a local connection: a cloud or dev boot has no stack and never asks.
import { useEffect, useState } from 'react';
import { nm as nmBridge, type FirstRunState, type LocalStackPayload } from '../bridge/nm';

const nm = nmBridge;
const DONE: FirstRunState = { phase: 'done', door: null };

export function useBootGates(authMode: string | undefined) {
  // `null` until main answers; a bridge without the lane (the browser) is `done`
  const [firstRun, setFirstRun] = useState<FirstRunState | null>(null);
  useEffect(() => {
    if (!nm) return;
    if (!nm.firstRunState) { setFirstRun(DONE); return; }
    void nm.firstRunState().then(setFirstRun).catch(() => setFirstRun(DONE));
    return nm.onFirstRun?.(setFirstRun);
  }, []);
  const [localStack, setLocalStack] = useState<LocalStackPayload | null>(null);
  useEffect(() => {
    if (!nm || authMode !== 'local' || !nm.localStackState) return;
    void nm.localStackState().then(setLocalStack).catch(() => {});
    return nm.onLocalStack?.(setLocalStack);
  }, [authMode]);
  return { firstRun, setFirstRun, doorDone: firstRun?.phase === 'done', localStack, setLocalStack };
}
