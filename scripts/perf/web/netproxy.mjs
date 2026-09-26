#!/usr/bin/env node
// netproxy.mjs: a shaping HTTP proxy, so the network profiles reach EVERYTHING the page does,
// the PowerSync WebSocket included.
//
//   node netproxy.mjs --port 9358 --down 2500000 --up 625000 --rtt 40
//
// Why: CDP's Network.emulateNetworkConditions shapes HTTP requests but not WebSocket frames (the
// cold sync moved 18.3 MB in 2.75 s under a 20 Mbps profile, about 53 Mbps). The initial sync is the
// largest download of a cold load, so a profile that skips it is not the profile.
//
// Chrome is started with --proxy-server=http://127.0.0.1:<port> --proxy-bypass-list=<-loopback>
// (the second flag removes Chrome's implicit "never proxy loopback" rule). Plain http:// requests
// arrive as absolute-URI requests and are forwarded; ws:// (and anything else) arrives as CONNECT
// and is tunnelled. Both directions of every connection share ONE link per direction.
//
// The link is a FIFO queue drained at `rate` bytes/s in chunks of at most 16 KB; a chunk is
// delivered half an RTT after it finished "transmitting". A chunk whose connection has closed is
// dropped when it reaches the head of the queue, so it never takes bandwidth from live traffic
// (v1 scheduled every chunk at enqueue time: a server that kept streaming into a closed tunnel then
// stole the link from the reconnected stream, and runs moved 32 MB for an 8 MB load).
// A CONNECT's "200" is held one RTT (the TCP handshake a direct connection would pay).
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHUNK = 16 * 1024;

/** one direction of the link */
export class Link {
  constructor(rate, delayMs) {
    this.rate = rate; this.delay = delayMs;
    this.q = []; this.busyUntil = 0; this.timer = null;
    // deliveries leave in queue order from ONE timer. v2 gave every chunk its own setTimeout, and
    // Node rounds timer delays to whole milliseconds: two small chunks queued back to back could
    // then fire out of order, which corrupted the sync stream ("bson error ... unexpected end of
    // file") and made the client reconnect every 5 s.
    this.out = []; this.outTimer = null;
    this.bytes = 0; this.dropped = 0;
  }
  /** queue `buf` for `write`; `alive()` false = drop it unsent; `done` runs when delivered or dropped */
  send(buf, write, alive = () => true, done = () => {}) {
    if (!buf.length) { this.out.push({ at: performance.now() + this.delay, part: null, write: null, alive, done }); this.flush(); return; }
    for (let i = 0; i < buf.length; i += CHUNK) {
      const last = i + CHUNK >= buf.length;
      this.q.push({ part: buf.subarray(i, i + CHUNK), write, alive, done: last ? done : null });
    }
    this.pump();
  }
  /** transmit: move queued chunks onto the wire at `rate`, dropping chunks nobody will read */
  pump() {
    if (this.timer) return;
    for (;;) {
      const now = performance.now();
      while (this.q.length && !this.q[0].alive()) { const it = this.q.shift(); this.dropped += it.part.length; it.done?.(); }
      if (!this.q.length) return;
      if (this.busyUntil > now + 0.5) { this.timer = setTimeout(() => { this.timer = null; this.pump(); }, this.busyUntil - now); return; }
      const it = this.q.shift();
      const start = Math.max(now, this.busyUntil);
      this.busyUntil = this.rate > 0 ? start + (it.part.length / this.rate) * 1000 : start;
      this.bytes += it.part.length;
      this.out.push({ at: this.busyUntil + this.delay, ...it });
      this.flush();
    }
  }
  /** deliver: in order, each chunk at its arrival time */
  flush() {
    if (this.outTimer) return;
    const now = performance.now();
    while (this.out.length && this.out[0].at <= now + 0.5) {
      const it = this.out.shift();
      if (it.part && it.alive()) { try { it.write(it.part); } catch { /* closed */ } }
      it.done?.();
    }
    if (this.out.length) this.outTimer = setTimeout(() => { this.outTimer = null; this.flush(); }, Math.max(0, this.out[0].at - now));
  }
}

export function startProxy({ port, down, up, rtt, host = '127.0.0.1' }) {
  const downLink = new Link(down, rtt / 2);
  const upLink = new Link(up, rtt / 2);
  const stats = { requests: 0, tunnels: 0 };
  const alive = (s) => () => !s.destroyed && s.writable !== false;
  // pipe `from` → `to` through a link, with backpressure; a close on either side closes both
  const shape = (from, to, link) => {
    let inflight = 0;
    const toAlive = alive(to);
    from.on('data', (buf) => {
      inflight++;
      if (inflight > 32) from.pause();
      link.send(buf, (part) => to.write(part), toAlive, () => { inflight--; if (inflight <= 8) from.resume(); });
    });
    from.on('end', () => {
      // end `to` once everything queued for it has been delivered (or dropped)
      const w = setInterval(() => { if (!inflight || !toAlive()) { clearInterval(w); try { to.end(); } catch { /* closed */ } } }, 10);
    });
    from.on('close', () => { if (!from.readableEnded) { try { to.destroy(); } catch { /* closed */ } } });
    from.on('error', () => { try { to.destroy(); } catch { /* closed */ } });
  };
  const server = createServer((req, res) => {
    // an absolute-URI request: forward it, shaping the request up and the response down
    stats.requests++;
    let u;
    try { u = new URL(req.url); } catch { res.writeHead(400); res.end('absolute URI expected'); return; }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    const resAlive = () => !res.destroyed && !res.writableEnded;
    const upReq = httpRequest({ hostname: u.hostname, port: u.port || 80, method: req.method, path: u.pathname + u.search, headers }, (ur) => {
      // the status line + headers are bytes on the link too (about 300): they queue behind
      // whatever is already travelling down, then pay half an RTT; then the body is shaped
      downLink.send(Buffer.alloc(300), () => {}, resAlive, () => {
        if (!resAlive()) { ur.destroy(); return; }
        res.writeHead(ur.statusCode ?? 502, ur.statusMessage, ur.headers);
        shape(ur, res, downLink);
      });
    });
    upReq.on('error', (e) => { if (!res.headersSent) res.writeHead(502); res.end(String(e.message)); });
    res.on('close', () => { if (!res.writableFinished) upReq.destroy(); });
    // the request line + headers travel up first (about 500 bytes), then the body
    upLink.send(Buffer.alloc(500), () => {}, () => !upReq.destroyed, () => shape(req, upReq, upLink));
  });
  // a plain-http Upgrade (ws:// sent as an absolute-URI request, if Chrome ever does): tunnel it raw
  server.on('upgrade', (req, client, head) => {
    stats.tunnels++;
    let u;
    try { u = new URL(req.url); } catch { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    const target = netConnect({ host: u.hostname, port: Number(u.port || 80) }, () => {
      const lines = [`${req.method} ${u.pathname}${u.search} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) if (!/^proxy-/i.test(req.rawHeaders[i])) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upLink.send(Buffer.from(lines.join('\r\n') + '\r\n\r\n'), (part) => target.write(part), alive(target));
      if (head?.length) upLink.send(head, (part) => target.write(part), alive(target));
      shape(client, target, upLink);
      shape(target, client, downLink);
    });
    target.on('error', () => { try { client.destroy(); } catch { /* closed */ } });
    client.on('error', () => { try { target.destroy(); } catch { /* closed */ } });
  });
  server.on('connect', (req, client, head) => {
    // a tunnel (the PowerSync WebSocket): shape both directions of the raw bytes
    stats.tunnels++;
    const [h, p] = String(req.url).split(':');
    const target = netConnect({ host: h, port: Number(p) }, () => {
      setTimeout(() => {
        if (client.destroyed) { target.destroy(); return; }
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head?.length) upLink.send(head, (part) => target.write(part), alive(target));
        shape(client, target, upLink);
        shape(target, client, downLink);
      }, rtt);
    });
    target.on('error', () => { try { client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch { /* closed */ } });
    client.on('error', () => { try { target.destroy(); } catch { /* closed */ } });
  });
  server.keepAliveTimeout = 65_000;
  return new Promise((res) => server.listen(port, host, () => res({ server, stats, downLink, upLink, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) })));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? Number(a[i + 1]) : d; };
  const p = await startProxy({ port: get('--port', 9358), down: get('--down', 2_500_000), up: get('--up', 625_000), rtt: get('--rtt', 40) });
  console.log(`[netproxy] listening 127.0.0.1:${get('--port', 9358)} down ${get('--down', 2_500_000)} B/s, up ${get('--up', 625_000)} B/s, rtt ${get('--rtt', 40)} ms`);
  const bye = () => { console.log(`[netproxy] stats ${JSON.stringify({ ...p.stats, bytesDown: p.downLink.bytes, bytesUp: p.upLink.bytes, droppedDown: p.downLink.dropped, droppedUp: p.upLink.dropped })}`); p.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
}
