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
  open(session: EngineeringSession): Handle;
  failed(error: unknown): void;
}): Handle {
  let closed = false;
  let handle: Handle | undefined;
  const ready = (async () => {
    const snapshot = await input.read();
    if (closed) throw new Error('The Code connection closed while loading its history.');
    if (snapshot.workspace !== input.workspace) throw new Error('The recorded conversation belongs to another workspace.');
    if (snapshot.threadId !== input.session.id) throw new Error('The recorded conversation belongs to another thread.');
    // Older hosts may not have published their first checkpoint yet. An authenticated empty
    // recording is not evidence that their cached transcript should be erased.
    const unrecorded = snapshot.revision === 0 && snapshot.events.length === 0 && !snapshot.runtimeMessages?.length;
    const session = unrecorded ? input.session : restoreEngineeringBrain(input.session, snapshot);
    input.restored(session);
    handle = input.open(session);
    return handle;
  })();
  void ready.catch(error => { if (!closed) input.failed(error); });
  return {
    subId: `restore-${input.session.id}`,
    async send(command) { const current = await ready; if (closed) throw new Error('The Code connection is closed.'); await current.send(command); },
    close() { closed = true; handle?.close(); },
  };
}
