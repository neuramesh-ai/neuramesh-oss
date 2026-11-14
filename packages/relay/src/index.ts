// nm-relay: the machine lane's WSS hub (docs/design/cloud-first-2026-08 plan §3.5).
// machines dial out with their nmm_ token, browsers attach with their clerk session,
// and this process forwards PTY frames between them — stateless, keyless, restartable.
// TLS is terminated by the ingress in front of it; this listens plain HTTP/WS.
//
// env: PORT (default 8787) · NM_API_URL (control-api origin) · RELAY_SECRET (shared
// secret for /internal/relay/* — the fleet-secret idiom) · RELAY_SELF_URL (optional: the
// relay's own public URL, for the rollover watch; on Cloud Run it is found without it) ·
// RELAY_SHARDS + RELAY_SHARD_INDEX (optional: every shard's URL in shard order, and this one's
// index. Unset, or a list of one, = the only relay. shard.ts says why and how).
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createHub } from './hub.js';
import { keepAlive } from './keepalive.js';
import { RETIRED_CLOSE, resolveSelfUrl, watchRollover } from './rollover.js';
import { shardConfig } from './shard-config.js';
import { makeValidators } from './validate.js';
import { RelayOwnership, relayLeaseApi } from './ownership.js';

const port = Number(process.env['PORT'] ?? 8787);
const host = process.env['HOST'] ?? '0.0.0.0';
const apiUrl = process.env['NM_API_URL'];
const secret = process.env['RELAY_SECRET'];
if (!apiUrl || !secret) {
  console.error('[relay] NM_API_URL and RELAY_SECRET are required');
  process.exit(1);
}
// Cloud Run names the revision this instance runs (rollover.ts); unset everywhere else
const revision = process.env['K_REVISION'] ?? null;
let retired = false;
// a shard that does not know its own index would refuse its own machines: no start at all
const shard = shardConfig(process.env);
if (typeof shard === 'string') {
  console.error(`[relay] ${shard}`);
  process.exit(1);
}
const requiresOwnership = process.env['NM_DEPLOYMENT'] === 'production';
if (requiresOwnership && !shard) throw new Error('Production relay ownership requires explicit shard configuration');
let ownership: RelayOwnership | undefined;

const hub = createHub({
  ...makeValidators({ apiUrl, secret }),
  ...(shard ? { shard } : {}),
  canServe: () => !retired && (!requiresOwnership || ownership?.canServe() === true),
  log: (line) => console.log(`[relay] ${line}`),
});

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...hub.stats(), ...(shard ? { shard: { index: shard.index, count: shard.urls.length } } : {}) }));
    return;
  }
  // which revision answers on the service URL: the question an older instance asks (rollover.ts).
  // Not /…z: Cloud Run's front end reserves paths that end in z, so only the startup probe,
  // which reaches the container directly, can ask /healthz
  if (req.url === '/revision') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ revision, retired }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// pty frames are small; a megabyte is already generous. never buffer the world.
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
if (requiresOwnership) ownership = new RelayOwnership(relayLeaseApi(apiUrl, secret, shard!.index),
  () => wss.clients.size > 0, () => {
    console.log('[relay] ownership lost; reconnecting sockets');
    for (const sock of wss.clients) sock.close(RETIRED_CLOSE, 'relay ownership changed');
  });
server.on('upgrade', (req, socket, head) => {
  const refuse = () => { if (!socket.destroyed) socket.end('HTTP/1.1 503 Service Unavailable\r\nRetry-After: 1\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); };
  // Do not send 101 until admission succeeds. Early hello/attach frames then cannot
  // race asynchronous acquisition and disappear before a message pump exists.
  void (async () => {
    try {
      if (retired || (ownership && !await ownership.ensure()) || socket.destroyed || (ownership && !ownership.canServe())) { refuse(); return; }
      wss.handleUpgrade(req, socket, head, sock => wss.emit('connection', sock, req));
    } finally {
      // A caller can disappear during acquisition or send an invalid upgrade.
      if (wss.clients.size === 0 && ownership?.canServe()) void ownership.release();
    }
  })().catch(refuse);
});
wss.on('connection', (sock, req) => {
  // a retired instance takes no new socket: its machines and browsers belong on the serving revision
  if (retired) { sock.close(RETIRED_CLOSE, 'relay revision retired'); return; }
  // the half-open socket (keepalive.ts): a peer that misses a pong is terminated, so the hub's
  // close handlers run (machine_gone) instead of routing into a socket the balancer already closed
  keepAlive(sock, undefined, () => console.log('[relay] keepalive_reap: no pong, terminating'));
  hub.handleConnection(sock, req);
  sock.on('close', () => { if (wss.clients.size === 0) void ownership?.release(); });
});

server.listen(port, host, () => console.log(`[relay] listening on ${host}:${port}${revision ? ` (revision ${revision})` : ''}${shard ? ` as shard ${shard.index} of ${shard.urls.length}` : ''}`));

if (revision) {
  void resolveSelfUrl(process.env).then((selfUrl) => {
    if (!selfUrl) return console.log('[relay] rollover watch off: no RELAY_SELF_URL, and the metadata server named no region');
    console.log(`[relay] rollover watch: asking ${selfUrl}/revision which revision serves the traffic`);
    watchRollover({
      revision, selfUrl,
      active: () => wss.clients.size > 0,
      onRetire: () => {
        retired = true;
        void ownership?.stop();
        for (const sock of wss.clients) sock.close(RETIRED_CLOSE, 'relay revision retired');
      },
      log: (line) => console.log(`[relay] ${line}`),
    });
  });
}

const shutdown = (): void => {
  console.log('[relay] shutting down');
  retired = true;
  void ownership?.stop();
  for (const sock of wss.clients) sock.close(1001, 'relay shutting down');
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
