import type { BrainThreadSnapshot } from '../brain-sync';
import type { EngineeringSession } from './domain';
import type { EngineeringCommand, EngineeringRuntimeEvent } from './protocol';
import { restoreEngineeringConnection } from './restore-connection';

type Handle = { subId: string; send(command: EngineeringCommand): Promise<void>; close(): void };
export type EngineeringTaskConnectionState = { phase: 'connecting' | 'connected' | 'reconnecting' | 'offline'; detail?: string };

/** A board task keeps running when its viewer disconnects. Reattach to the host's
 * live snapshot, never replay a prompt, approval, or other command on reconnect. */
export function connectEngineeringTask(input: {
  workspace: string;
  session(): EngineeringSession;
  read(): Promise<BrainThreadSnapshot>;
  restored(session: EngineeringSession): void;
  open(session: EngineeringSession, event: (event: EngineeringRuntimeEvent) => void, exit: () => void): Handle;
  event(event: EngineeringRuntimeEvent): void;
  changed(state: EngineeringTaskConnectionState): void;
}): Handle {
  let closed = false;
  let generation = 0;
  let current: Handle | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let connected = false;
  let retries = 0;
  const delays = [1000, 2000, 4000, 8000, 15000];
  const clear = () => { clearTimeout(timer); clearTimeout(watchdog); };
  const attach = () => {
    if (closed) return;
    clear();
    const own = ++generation;
    connected = false;
    let gone = false;
    let refused: string | undefined;
    const active = () => !closed && !gone && generation === own;
    const lost = (detail?: string) => {
      if (!active()) return;
      gone = true;
      connected = false;
      clear();
      current?.close();
      current = undefined;
      if (refused || retries >= delays.length) {
        input.changed({ phase: 'offline', detail: refused ?? detail ?? 'The coding task connection is unavailable.' });
        return;
      }
      input.changed({ phase: 'reconnecting' });
      timer = setTimeout(attach, delays[retries++]!);
    };
    input.changed({ phase: retries ? 'reconnecting' : 'connecting' });
    // The host can wait up to 30s for a just-approved task to start.
    watchdog = setTimeout(() => lost('The coding task did not respond. Reconnect to check its latest state.'), 45_000);
    const handle = restoreEngineeringConnection({
      workspace: input.workspace, session: input.session(), read: input.read,
      restored: session => { if (active()) input.restored(session); },
      failed: error => lost(error instanceof Error ? error.message : String(error)),
      open: (session, observe) => input.open(session, event => {
        if (!active()) return;
        if (event.type === 'disconnected') { lost(event.message); return; }
        // Authentication/refused attaches need a deliberate retry, not a retry loop.
        if (event.type === 'error' && !connected) refused = event.message;
        observe(event);
        input.event(event);
        if (event.type === 'ready' || event.type === 'task_state') {
          clearTimeout(watchdog);
          connected = true;
          retries = 0;
          input.changed({ phase: 'connected' });
        }
      }, () => lost()),
    });
    if (active()) current = handle;
    else handle.close();
  };
  attach();
  return {
    subId: `task-${input.session().id}`,
    async send(command) {
      if (closed || !connected || !current) throw new Error('Reconnect to the coding task before sending this action.');
      await current.send(command);
    },
    close() { closed = true; generation++; clear(); current?.close(); current = undefined; },
  };
}
