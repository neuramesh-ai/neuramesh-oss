// Containment L1 — the egress allowlist proxy (the "lethal trifecta" breaker).
//
// Every agent runs behind a loopback CONNECT proxy (agentBaseEnv sets HTTP(S)_PROXY at it). The
// proxy is a plain tunnel — NO TLS interception, no CA to trust (per the research; MITM is only for
// L2 credential injection) — that makes two network verdicts physically binding regardless of which
// tool opened the socket or whether the runtime honored the PreToolUse gate:
//
//   1. ALWAYS block cloud metadata + link-local destinations (169.254.0.0/16, Alibaba/Azure metadata
//      IPs). No legitimate agent egress targets these; they are the classic SSRF credential-theft
//      sink. Blocked even under allow-by-default, and resolved-then-pinned so a hostname that
//      resolves into that range (DNS rebinding) is caught too.
//   2. Enforce the net.egress policy: a host the workspace tightened to `deny` cannot be reached.
//      `allow`/`ask` pass at this layer — the ASK is the upstream tool gate's job; the proxy is the
//      deny + metadata floor, so egress-allowed-by-default stays friction-free.
//
// If the proxy can't bind, the daemon leaves HTTP(S)_PROXY unset and agents run un-proxied — this
// layer is best-effort enforcement, never a hard dependency that could wedge every agent.
import { createServer, request as httpRequest, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect as netConnect, type Socket } from 'node:net';
import { lookup } from 'node:dns';
import { canonicalPolicyHost, evaluatePolicy, type PolicyRule } from '@neuramesh/shared';
import type { LogFn } from '../agentlog';

// Cloud-metadata + link-local IPs that no legitimate egress ever needs but SSRF exfil targets.
// Loopback and RFC1918 are deliberately NOT blocked here: agents legitimately curl their own
// localhost dev servers, and blanket-blocking private ranges would break legitimate internal work
// under an allow-by-default policy. A workspace that wants private ranges cut off tightens net.egress.
const METADATA_IPS = new Set(['169.254.169.254', '100.100.100.200', '168.63.129.16']);
const METADATA_IPV6 = new Set(['fd00:ec2::254', 'fd20:ce::254']);

function mappedIpv4(ip: string): string | null {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (dotted) return dotted;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (!hex) return null;
  const high = Number.parseInt(hex[1]!, 16); const low = Number.parseInt(hex[2]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function isMetadataOrLinkLocal(ip: string): boolean {
  const normalized = ip.trim().replace(/^\[|\]$/g, '').split('%')[0]!.toLowerCase();
  const mapped = mappedIpv4(normalized);
  if (mapped) return isMetadataOrLinkLocal(mapped);
  if (METADATA_IPV6.has(normalized) || normalized === '::' || normalized === '::1') return true;
  const firstV6 = normalized.includes(':') ? Number.parseInt(normalized.split(':')[0] || '0', 16) : -1;
  if ((firstV6 >= 0xfc00 && firstV6 <= 0xfdff) || (firstV6 >= 0xfe80 && firstV6 <= 0xfebf)) return true;
  if (METADATA_IPS.has(normalized)) return true;
  const p = normalized.split('.');
  if (p.length !== 4) return false;
  const n = p.map((x) => Number(x));
  if (!n.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) return false;
  return n[0] === 169 && n[1] === 254; // 169.254.0.0/16 link-local (covers AWS/GCP 169.254.169.254)
}

// "host:port" (CONNECT target or a proxied absolute URL's authority) → parts. Defaults port 443
// for CONNECT (TLS). Rejects empty/malformed authorities.
export function parseConnectTarget(target: string, defaultPort = 443): { host: string; port: number } | null {
  const t = (target || '').trim();
  if (!t) return null;
  // IPv6 literal in brackets: [::1]:443
  const v6 = /^\[([^\]]+)\]:(\d+)$/.exec(t);
  if (v6) return { host: v6[1]!, port: Number(v6[2]) };
  const i = t.lastIndexOf(':');
  if (i <= 0) return { host: t, port: defaultPort };
  const host = t.slice(0, i);
  const port = Number(t.slice(i + 1));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

// The proxy blocks only on a policy `deny` (or the metadata floor). allow + ask both pass here —
// ask is resolved by the upstream tool gate, and allow-by-default must not add proxy friction.
export function egressAllowedByPolicy(host: string, rules: readonly PolicyRule[]): boolean {
  return evaluatePolicy({ capability: 'net.egress', host }, rules).verdict !== 'deny';
}

const resolveHost = (host: string): Promise<string[]> => new Promise((resolve, reject) => {
  lookup(host, { all: true, verbatim: true }, (error, addresses) => {
    if (error) reject(error); else resolve(addresses.map(({ address }) => address));
  });
});

export interface EgressProxy {
  server: Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

// Decision shared by the CONNECT and plain-HTTP paths: resolve → pin → check metadata + policy.
// Returns the pinned IP to dial (so we connect to exactly what we vetted, defeating DNS rebinding),
// or a reason string to refuse.
export async function vetEgressDestination(host: string, rules: readonly PolicyRule[]): Promise<{ ip: string } | { deny: string }> {
  const canonicalHost = canonicalPolicyHost(host);
  if (!canonicalHost) return { deny: `invalid egress destination (${host})` };
  if (!egressAllowedByPolicy(canonicalHost, rules)) return { deny: `policy denies egress to ${canonicalHost}` };
  let ips: string[];
  try { ips = await resolveHost(canonicalHost); }
  catch { return { deny: `cannot resolve ${canonicalHost}` }; }
  const blocked = ips.find(isMetadataOrLinkLocal);
  if (blocked) return { deny: `blocked metadata/link-local destination (${canonicalHost} → ${blocked})` };
  if (!ips[0]) return { deny: `cannot resolve ${canonicalHost}` };
  return { ip: ips[0] };
}

// Start the loopback egress proxy. getRules supplies the LIVE effective net.egress policy so a
// mid-session tightening takes effect on the next connection. Binds to 127.0.0.1 on an ephemeral
// port; resolves once listening.
export function startEgressProxy(getRules: () => readonly PolicyRule[], log?: LogFn): Promise<EgressProxy> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // plain-HTTP proxying: absolute-form request URL (http://host/path). Enforce, then forward.
    void (async () => {
      let target: URL;
      try { target = new URL(req.url ?? ''); } catch { res.writeHead(400).end('bad request'); return; }
      const host = target.hostname;
      const verdict = await vetEgressDestination(host, getRules());
      if ('deny' in verdict) { log?.({ kind: 'result', phase: 'blocked', summary: `egress ${verdict.deny}` }); res.writeHead(403).end(`egress blocked: ${verdict.deny}`); return; }
      const port = target.port ? Number(target.port) : 80;
      const up = httpRequest({ host: verdict.ip, port, method: req.method, path: target.pathname + target.search, headers: { ...req.headers, host: target.host } }, (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers); upRes.pipe(res);
      });
      up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('upstream error'); });
      req.pipe(up);
    })();
  });

  // HTTPS tunneling: CONNECT host:443 → vet → pipe a raw TCP tunnel to the pinned IP (no MITM).
  server.on('connect', (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    // Attach the client-socket error handler FIRST: a refused/blocked tunnel makes the client
    // reset (ECONNRESET), and an unhandled 'error' on the socket would crash the whole daemon.
    clientSocket.on('error', () => clientSocket.destroy());
    void (async () => {
      const t = parseConnectTarget(req.url ?? '');
      if (!t) { clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
      const verdict = await vetEgressDestination(t.host, getRules());
      if ('deny' in verdict) {
        log?.({ kind: 'result', phase: 'blocked', summary: `egress ${verdict.deny}` });
        clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\negress blocked: ' + verdict.deny);
        return;
      }
      const upstream = netConnect(t.port, verdict.ip, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on('error', () => clientSocket.destroy());
    })();
  });

  // a malformed request or a client reset on the plain-HTTP path must never crash the daemon
  server.on('clientError', (_err, socket) => { try { socket.destroy(); } catch { /* already gone */ } });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const url = `http://127.0.0.1:${port}`;
      log?.({ kind: 'result', phase: 'success', summary: `egress proxy listening on ${url}` });
      resolve({ server, port, url, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
