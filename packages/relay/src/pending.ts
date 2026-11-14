// AN UNIDENTIFIED SOCKET HAS A DEADLINE (R10 lane A, NM-007, 2026-11-09). A browser socket that never
// sent its attach (and a machine socket that never said hello) was held forever: anyone could open
// the shard's whole socket budget (Cloud Run's 1000 per instance) with idle connections, redial
// hourly, and keep every machine and browser off the relay. Each one now gets ATTACH_DEADLINE_MS to
// identify itself, and the hub holds at most MAX_PENDING_SOCKETS of them at once (one more: 1013).
import type { WebSocket } from 'ws';
import { CLOSE } from './protocol.js';

export const ATTACH_DEADLINE_MS = 10_000;
export const MAX_PENDING_SOCKETS = 200;
// a peer that never answers the close frame would hold its socket for the 30 s close timeout of `ws`
const CLOSE_GRACE_MS = 2_000;

// BOTH REFUSALS SAY "TRY AGAIN" (1013), NEVER A VERDICT. the clients read 1008 as final and do not
// dial again, so a slow token fetch that missed the deadline ended a terminal or a Code session for
// good (the security lane's review, 2026-11-13). a socket that was only late dials again.
function refuse(sock: WebSocket, reason: string): void {
  sock.close(CLOSE.VALIDATE_UNAVAILABLE, reason);
  setTimeout(() => { if (sock.readyState !== sock.CLOSED) sock.terminate(); }, CLOSE_GRACE_MS).unref();
}

export interface PendingSockets {
  /** start the socket's deadline; false = refused (the cap), and the socket is already closing */
  admit(sock: WebSocket): boolean;
  /** the socket attached (or said hello), or went: its deadline ends */
  identified(sock: WebSocket): void;
  size(): number;
}

export function pendingSockets(opts: { deadlineMs?: number; max?: number; log: (line: string) => void }): PendingSockets {
  const pending = new Map<WebSocket, ReturnType<typeof setTimeout>>();
  const identified = (sock: WebSocket): void => {
    const t = pending.get(sock);
    if (t) clearTimeout(t);
    pending.delete(sock);
  };
  return {
    admit(sock) {
      if (pending.size >= (opts.max ?? MAX_PENDING_SOCKETS)) {
        opts.log(`refuse_pending_cap pending=${pending.size}`);
        refuse(sock, 'too many unidentified sockets, try again');
        return false;
      }
      pending.set(sock, setTimeout(() => {
        pending.delete(sock);
        opts.log('attach_timeout');
        refuse(sock, 'attach timeout, try again');
      }, opts.deadlineMs ?? ATTACH_DEADLINE_MS).unref());
      sock.on('close', () => identified(sock));
      return true;
    },
    identified,
    size: () => pending.size,
  };
}
