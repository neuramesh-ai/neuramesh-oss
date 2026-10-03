// the egress proxy (models-and-replies round, board C3): the one road from the machine's browsers to
// the web. both Chromium processes start with --proxy-server pointed here, so every connection a
// page makes passes one check: navigations, redirects, subresources, workers and WebSockets alike.
//
// why a proxy and not request interception: interception sees a request before Chromium resolves
// the name, so a name that resolves to a public address for the check and to the metadata server for
// the connection would pass. here the proxy resolves the name itself, checks every answer
// (address-guard.ts), and connects to the very address it checked. a CONNECT tunnel carries HTTPS
// bytes the proxy never reads, so it learns the host and the port and nothing of the content.
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import { resolveAllowed, type Resolved } from './address-guard';

export interface EgressProxy {
  port: number;
  /** the newest refusal, so a tool can say why a page failed instead of a bare network error */
  lastRefusal(): { host: string; reason: string; at: number } | null;
  close(): Promise<void>;
}

/** marks a plain-http refusal, so a page's response says it was this guard and not the site */
export const REFUSED_HEADER = 'x-nm-refused';
const CACHE_MS = 30_000;

/** `host:port` from a CONNECT target, with IPv6 brackets */
export function splitHostPort(target: string): { host: string; port: number } | null {
  const m = /^\[([^\]]+)\]:(\d+)$/.exec(target) ?? /^([^:]+):(\d+)$/.exec(target);
  const port = m ? Number(m[2]) : 0;
  return m && port > 0 && port < 65536 ? { host: m[1]!, port } : null;
}

export async function startEgressProxy(opts: { resolve?: (host: string) => Promise<Resolved>; log?: (line: string) => void } = {}): Promise<EgressProxy> {
  const resolve = opts.resolve ?? ((host: string) => resolveAllowed(host));
  const cache = new Map<string, { at: number; verdict: Resolved }>();
  let refusal: { host: string; reason: string; at: number } | null = null;
  const sockets = new Set<Socket>();

  const verdict = async (host: string): Promise<Resolved> => {
    const hit = cache.get(host);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.verdict;
    const v = await resolve(host);
    cache.set(host, { at: Date.now(), verdict: v });
    if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
    return v;
  };
  const refused = (host: string, reason: string): void => {
    refusal = { host, reason, at: Date.now() };
    opts.log?.(`refused ${host}: ${reason}`);
  };

  const plain = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let url: URL;
    try { url = new URL(req.url ?? ''); } catch { res.writeHead(400).end(); return; }
    const v = url.protocol === 'http:' ? await verdict(url.hostname) : { ok: false as const, reason: 'only http and https open' };
    if (!v.ok) {
      refused(url.hostname, v.reason);
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', [REFUSED_HEADER]: encodeURIComponent(v.reason) });
      res.end(`NeuraMesh refused this address: ${v.reason}.`);
      return;
    }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    // the Host header stays the site's own, and the socket goes to the address the check read
    const up = httpRequest({ host: v.address, family: v.family, port: Number(url.port) || 80, method: req.method, path: `${url.pathname}${url.search}`, headers, setHost: false }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  };

  const tunnel = async (req: IncomingMessage, client: Socket, head: Buffer): Promise<void> => {
    const target = splitHostPort(req.url ?? '');
    const v = target ? await verdict(target.host) : { ok: false as const, reason: 'the address has no host' };
    if (!target || !v.ok) {
      refused(target?.host ?? String(req.url), v.ok ? 'the address has no host' : v.reason);
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const up = connect({ host: v.address, port: target.port, family: v.family }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) up.write(head);
      up.pipe(client);
      client.pipe(up);
    });
    sockets.add(up);
    up.on('close', () => sockets.delete(up));
    up.on('error', () => { if (client.writable) client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); else client.destroy(); });
    client.on('error', () => up.destroy());
  };

  const server = createServer((req, res) => void plain(req, res));
  server.on('connect', (req: IncomingMessage, client: Socket, head: Buffer) => void tunnel(req, client, head));
  server.on('connection', (s: Socket) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => ok()); });
  const address = server.address();
  return {
    port: typeof address === 'object' && address ? address.port : 0,
    lastRefusal: () => refusal,
    close: () => new Promise<void>((done) => {
      for (const s of sockets) s.destroy();
      server.close(() => done());
    }),
  };
}
