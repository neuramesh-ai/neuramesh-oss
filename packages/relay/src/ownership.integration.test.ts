import { afterEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { shardIndexFor } from './shard.js';

const children: ChildProcess[] = [];
const sockets: WebSocket[] = [];
const servers: Server[] = [];
const listen = (server: Server) => new Promise<number>(resolve => {
  servers.push(server);
  server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
});
const availablePort = async () => {
  const server = createServer(); const port = await listen(server);
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
};
async function until(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out: ' + label);
}
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const child of children.splice(0)) {
    if (child.exitCode !== null) continue;
    const exit = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exit; clearTimeout(timer);
  }
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

// Actual Node processes and WebSockets. This API fixture supplies only identity and a
// single-owner lease. The production SQL lease and its secret boundary have separate tests.
it('admits one owner across two processes of the same shard and revision, then hands off after the last socket closes', async () => {
  let machineId = randomUUID();
  while (shardIndexFor(machineId, 2) !== 0) machineId = randomUUID();
  let owner = ''; let expires = 0; let generation = 0;
  const api = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    let answer: unknown;
    if (req.headers.authorization !== 'Bearer fixture-relay-secret') { res.writeHead(403); res.end(); return; }
    if (req.url === '/internal/relay/lease') {
      const won = !owner || owner === body.holder || expires < Date.now();
      if (won) { if (owner !== body.holder) generation++; owner = body.holder; expires = Date.now() + 30_000; }
      answer = { held: won, holder: owner, ttlMs: Math.max(0, expires - Date.now()), generation, acquired: won };
    } else if (req.url === '/internal/relay/lease/release') {
      const released = owner === body.holder; if (released) expires = 0;
      answer = { released };
    } else if (req.url === '/internal/relay/validate-machine') answer = { machineId, workspaceId: randomUUID() };
    else { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer));
  });
  const apiPort = await listen(api);
  const a = await availablePort(), b = await availablePort();
  for (const port of [a, b]) {
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./index.ts', import.meta.url))], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production',
        NM_DEPLOYMENT: 'production', HOST: '127.0.0.1', PORT: String(port),
        NM_API_URL: `http://127.0.0.1:${apiPort}`, RELAY_SECRET: 'fixture-relay-secret',
        K_REVISION: 'nm-cr-relay-0-00001-tst', RELAY_SELF_URL: `http://127.0.0.1:${a}`,
        RELAY_SHARDS: `ws://127.0.0.1:${a},ws://127.0.0.1:1`, RELAY_SHARD_INDEX: '0' },
      stdio: 'ignore',
    });
    children.push(child);
    await until(async () => (await fetch(`http://127.0.0.1:${port}/revision`)).ok, 'relay startup');
  }
  const machine = new WebSocket(`ws://127.0.0.1:${a}`, { headers: { authorization: 'Bearer nmm_fixture-machine' } });
  sockets.push(machine); machine.on('error', () => {});
  await new Promise<void>(resolve => machine.once('open', () => resolve()));
  machine.send(JSON.stringify({ t: 'hello', machineId, lanes: ['shard'] }));
  await until(async () => (await (await fetch(`http://127.0.0.1:${a}/healthz`)).json() as { machines: string[] }).machines.includes(machineId), 'machine admission');
  const status = await new Promise<number>(resolve => {
    const other = new WebSocket(`ws://127.0.0.1:${b}`); sockets.push(other);
    other.on('error', () => {});
    other.once('open', () => resolve(101));
    other.once('unexpected-response', (_req, response) => { response.resume(); other.terminate(); resolve(response.statusCode!); });
  });
  expect(status, 'the non-owner must reject the upgrade, even when K_REVISION is identical').toBe(503);
  const closed = new Promise<void>(resolve => machine.once('close', () => resolve())); machine.close(); await closed;
  await until(async () => expires === 0, 'idle owner releases its lease');
  const successor = new WebSocket(`ws://127.0.0.1:${b}`); sockets.push(successor); successor.on('error', () => {});
  await new Promise<void>(resolve => successor.once('open', () => resolve()));
  expect(generation).toBe(2);
}, 25_000);
