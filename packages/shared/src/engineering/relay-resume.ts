// WHAT A CODE PANE SAYS WHILE ITS RELAY SOCKET COMES BACK (the session round, 2026-10; relay-client
// openRelayJsonChannel). A Code session outlives its socket: the client redials and takes the session
// back, and the machine replays the events the pane missed. Both clients (hq's web bridge and the
// desktop's relay lanes) speak the same lines through the thread's own notice event, so the two panes
// cannot drift.
//
// A COMMAND IN THE GAP. The replay covers what the machine SENT. What the pane sent in the instant
// after a cut, before the client saw the socket close, went into a dead socket. The engineering
// protocol (protocol.ts EngineeringCommand) has no command id, so the machine could not tell a resent
// prompt from a second one, and a resend could run a turn twice. So the pane does not resend: it says
// that the last command may not have arrived, and the person sends it again if nothing happens.
import type { EngineeringCommand } from './protocol';

/** a notice event in the thread's own vocabulary (remote.ts applies `notice` as a system line) */
export const relayNotice = (message: string) => ({
  type: 'agent_event' as const,
  event: { type: 'agent_event', payload: { event: { type: 'notice', message } } },
});
export const CODE_RECONNECTING = 'The connection to the machine dropped. Reconnecting...';
export const codeReconnected = (lost: number): string => lost
  ? 'Reconnected. Some updates were lost while the connection was down. Open the thread again if it looks out of date.'
  : 'Reconnected.';
export const CODE_COMMAND_MAY_BE_LOST = 'Your last command may not have reached the machine while the connection dropped. If nothing happens, send it again.';

/** commands a person means, as against the parts of an upload (each chunk has its own ack) */
const MEANT: ReadonlySet<EngineeringCommand['type']> = new Set(['prompt', 'approval', 'abort', 'restore', 'model', 'configure', 'controls', 'brain']);

/** how long after a send a command still counts as possibly lost when the socket comes back */
export const COMMAND_GAP_MS = 30_000;

/** Tracks the last command the pane sent and whether the machine has said anything since. At a
 *  resume, a command with no machine event after it, sent within COMMAND_GAP_MS, may be lost */
export function createCommandGapWatch(opts: { now?: () => number; windowMs?: number } = {}) {
  const now = opts.now ?? Date.now;
  const windowMs = opts.windowMs ?? COMMAND_GAP_MS;
  let pendingAt: number | null = null;
  return {
    /** the pane sent a command */
    sent(command: EngineeringCommand): void {
      if (MEANT.has(command.type)) pendingAt = now();
    },
    /** the machine sent an event: everything sent before it reached a live machine, or never will */
    received(): void {
      pendingAt = null;
    },
    /** the session is back (every resume, short or long): true when the pane should say the note */
    resumed(): boolean {
      const at = pendingAt;
      pendingAt = null;
      return at !== null && now() - at <= windowMs;
    },
  };
}
