// nm-relay: the machine lane's WSS hub (docs/design/cloud-first-2026-08 plan §3.5).
// machines dial out with their nmm_ token, browsers attach with their clerk session,
// and this process forwards PTY frames between them — stateless, keyless, restartable.
// TLS is terminated by the ingress in front of it; this listens plain HTTP/WS.
//
// env: PORT (default 8787) · NM_API_URL (control-api origin) · RELAY_SECRET (shared
// secret for /internal/relay/* — the fleet-secret idiom).
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createHub } from './hub.js';
import { keepAlive } from './keepalive.js';
import { makeValidators } from './validate.js';

const port = Number(process.env['PORT'] ?? 8787);
const host = process.env['HOST'] ?? '0.0.0.0';
const apiUrl = process.env['NM_API_URL'];
const secret = process.env['RELAY_SECRET'];
if (!apiUrl || !secret) {
  console.error('[relay] NM_API_URL and RELAY_SECRET are required');
  process.exit(1);
}

const hub = createHub({
  ...makeValidators({ apiUrl, secret }),
  log: (line) => console.log(`[relay] ${line}`),
});

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...hub.stats() }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// pty frames are small; a megabyte is already generous. never buffer the world.
const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 });
wss.on('connection', (sock, req) => {
  // the half-open socket (keepalive.ts): a peer that misses a pong is terminated, so the hub's
  // close handlers run (machine_gone) instead of routing into a socket the balancer already closed
  keepAlive(sock, undefined, () => console.log('[relay] keepalive_reap: no pong, terminating'));
  hub.handleConnection(sock, req);
});

server.listen(port, host, () => console.log(`[relay] listening on ${host}:${port}`));

const shutdown = (): void => {
  console.log('[relay] shutting down');
  for (const sock of wss.clients) sock.close(1001, 'relay shutting down');
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
