// the egress proxy is the browsers' one road out. these drive it over real sockets: a plain request
// and a CONNECT tunnel reach an allowed site, and both kinds are refused for a private address, with
// the refusal recorded so a tool can name it. the allowed "site" listens on loopback, so its tests
// hand the proxy a resolver that allows that one name. the real resolver refuses loopback, which the
// last test proves.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { REFUSED_HEADER, splitHostPort, startEgressProxy } from './egress-proxy';
import { resolveAllowed } from './address-guard';

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function site(): Promise<number> {
  const s = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`hello from ${req.headers.host}${req.url}`); });
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  return (s.address() as AddressInfo).port;
}

/** a resolver that allows site.test (on loopback, for the test) and runs the real guard for the rest */
const testResolve = async (host: string) => (host === 'site.test'
  ? { ok: true as const, address: '127.0.0.1', family: 4 }
  : resolveAllowed(host, async (h) => (h === 'rebind.test' ? [{ address: '169.254.169.254', family: 4 }] : [{ address: '93.184.216.34', family: 4 }])));

const viaProxy = (proxyPort: number, url: string): Promise<{ status: number; headers: Record<string, unknown>; body: string }> => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: proxyPort, method: 'GET', path: url, headers: { host: new URL(url).host } }, (res) => {
    let body = '';
    res.on('data', (d) => { body += String(d); });
    res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
  });
  req.on('error', reject);
  req.end();
});

/** open a CONNECT tunnel and return the proxy's status line plus what came back through it */
const tunnel = (proxyPort: number, target: string, payload?: string): Promise<string> => new Promise((resolve) => {
  const s = connect(proxyPort, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
  let seen = '';
  s.on('data', (d) => {
    seen += String(d);
    if (payload && seen.includes('200 Connection Established') && !seen.includes('hello')) { s.write(payload); return; }
    if (!payload || seen.includes('hello')) { s.end(); resolve(seen); }
  });
  s.on('close', () => resolve(seen));
});

test('a plain request reaches an allowed site with its own Host header, and a private one is refused with the mark', async () => {
  const port = await site();
  const proxy = await startEgressProxy({ resolve: testResolve });
  try {
    const ok = await viaProxy(proxy.port, `http://site.test:${port}/hi?q=1`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body, `hello from site.test:${port}/hi?q=1`);
    const refused = await viaProxy(proxy.port, 'http://rebind.test/latest/meta-data');
    assert.equal(refused.status, 403);
    assert.match(decodeURIComponent(String(refused.headers[REFUSED_HEADER])), /private or local address/);
    assert.equal(proxy.lastRefusal()?.host, 'rebind.test');
  } finally { await proxy.close(); }
});

test('a CONNECT tunnel carries bytes to an allowed site and is refused for the metadata server', async () => {
  const port = await site();
  const proxy = await startEgressProxy({ resolve: testResolve });
  try {
    const through = await tunnel(proxy.port, `site.test:${port}`, `GET /tls HTTP/1.1\r\nHost: site.test\r\nConnection: close\r\n\r\n`);
    assert.match(through, /^HTTP\/1\.1 200 Connection Established/);
    assert.match(through, /hello from site\.test\/tls/);
    const refused = await tunnel(proxy.port, '169.254.169.254:80');
    assert.match(refused, /^HTTP\/1\.1 403/);
    assert.equal(proxy.lastRefusal()?.host, '169.254.169.254');
  } finally { await proxy.close(); }
});

test('the real resolver refuses loopback, so nothing on the machine itself is reachable through the proxy', async () => {
  const port = await site();
  const proxy = await startEgressProxy();
  try {
    assert.match(await tunnel(proxy.port, `127.0.0.1:${port}`), /^HTTP\/1\.1 403/);
    assert.match(await tunnel(proxy.port, `[::1]:${port}`), /^HTTP\/1\.1 403/);
    assert.equal((await viaProxy(proxy.port, `http://localhost:${port}/`)).status, 403);
  } finally { await proxy.close(); }
});

test('a CONNECT target is a host and a port, IPv6 in brackets', () => {
  assert.deepEqual(splitHostPort('x.com:443'), { host: 'x.com', port: 443 });
  assert.deepEqual(splitHostPort('[2606:4700::1111]:443'), { host: '2606:4700::1111', port: 443 });
  assert.equal(splitHostPort('x.com'), null);
  assert.equal(splitHostPort('x.com:99999'), null);
});
