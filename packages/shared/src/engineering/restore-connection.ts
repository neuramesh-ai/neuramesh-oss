import type { BrainThreadSnapshot } from '../brain-sync';
import type { EngineeringSession } from './domain';
import type { EngineeringCommand } from './protocol';
import { restoreEngineeringBrain } from './brain-restore';

type Handle = { subId: string; send(command: EngineeringCommand): Promise<void>; close(): void };

/** Cached text is useful immediately, but cached controls must wait for the recording. */
export function awaitingEngineeringHistory(session: EngineeringSession): EngineeringSession {
  return { ...session, state: 'streaming', activeActivity: { phase: 'restoring', startedAt: new Date().toISOString() }, pendingApproval: null };
}

/** A cache is not the conversation. Restore before opening the writer or accepting new work.
 * Closing during a download must never reopen the departed thread or publish its history. */
export function restoreEngineeringConnection(input: {
  workspace: string;
  session: EngineeringSession;
  read(): Promise<BrainThreadSnapshot>;
  restored(session: EngineeringSession): void;
  /** `observe` takes each event from the host, before the client applies it: it reads the host's `ready` */
  open(session: EngineeringSession, observe: (event: { type?: unknown; recordedRevision?: unknown }) => void): Handle;
  failed(error: unknown): void;
}): Handle {
  let closed = false;
  let handle: Handle | undefined;
  // the revision this restore shows, and whether a command went out: a turn that started is never read over
  let shown = -1;
  let sent = false;
  let heard = false;
  const own = (snapshot: BrainThreadSnapshot): void => {
    if (snapshot.workspace !== input.workspace) throw new Error('The recorded conversation belongs to another workspace.');
    if (snapshot.threadId !== input.session.id) throw new Error('The recorded conversation belongs to another thread.');
  };
  // A reload can read the cloud before the last turn's checkpoint lands: the host flushes it when the old connection
  // closes, and its ready names the revision that it reaches. Read again until the restore covers it, for 30 s at most.
  const catchUp = async (head: number): Promise<void> => {
    const until = Date.now() + 30_000;
    while (!closed && !sent && shown < head && Date.now() < until) {
      const next = await input.read().catch(() => null);
      if (!next || closed || sent) return;
      try { own(next); } catch { return; }
      if (next.revision > shown) { shown = next.revision; input.restored(restoreEngineeringBrain(input.session, next)); }
      if (shown < head) await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  };
  const observe = (event: { type?: unknown; recordedRevision?: unknown }): void => {
    if (heard || event.type !== 'ready') return;
    heard = true;
    if (typeof event.recordedRevision === 'number' && event.recordedRevision > shown && !sent) void catchUp(event.recordedRevision);
  };
  const ready = (async () => {
    const snapshot = await input.read();
    if (closed) throw new Error('The Code connection closed while loading its history.');
    own(snapshot);
    // Older hosts may not have published their first checkpoint yet. An authenticated empty
    // recording is not evidence that their cached transcript should be erased.
    const unrecorded = snapshot.revision === 0 && snapshot.events.length === 0 && !snapshot.runtimeMessages?.length;
    const session = unrecorded ? input.session : restoreEngineeringBrain(input.session, snapshot);
    shown = snapshot.revision;
    input.restored(session);
    handle = input.open(session, observe);
    return handle;
  })();
  void ready.catch(error => { if (!closed) input.failed(error); });
  return {
    subId: `restore-${input.session.id}`,
    async send(command) { const current = await ready; if (closed) throw new Error('The Code connection is closed.'); sent = true; await current.send(command); },
    close() { closed = true; handle?.close(); },
  };
}
