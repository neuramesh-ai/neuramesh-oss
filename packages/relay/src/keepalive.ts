// KEEPALIVE (2026-09-19). The load balancer in front of the relay closes an idle socket at its
// timeout (3600 s on GKE, GCPBackendPolicy nm-relay-ws), and the peer on the other side does not
// always see a close: in production both machines went `machine_gone` exactly one hour after
// `machine_online` while their daemons still held a socket that read as open, so every browser
// attach answered 4404 to a machine whose heartbeat was green. A ping every 30 s keeps every leg
// busy, and a socket that misses one pong is terminated, so the close handlers on that end run:
// machine_gone on the hub, the redial on the machine. ONE watchdog for both ends of the wire.
import type WebSocket from 'ws';

export const KEEPALIVE_MS = 30_000;

/** ping `sock` every `periodMs`; a missed pong terminates it, which is the close event the
 *  caller's own handlers wait for. Stops itself on close; the return stops it earlier. */
export function keepAlive(sock: WebSocket, periodMs: number = KEEPALIVE_MS, onDead?: () => void): () => void {
  let answered = true;
  const onPong = (): void => { answered = true; };
  sock.on('pong', onPong);
  const beat = setInterval(() => {
    if (sock.readyState !== sock.OPEN) return;
    if (!answered) { onDead?.(); sock.terminate(); return; }
    answered = false;
    sock.ping();
  }, periodMs);
  beat.unref?.();
  const stop = (): void => { clearInterval(beat); sock.off('pong', onPong); };
  sock.once('close', stop);
  return stop;
}
