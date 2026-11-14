// A RELAY CLIENT FOR THE LIVE CHECKS (Node 24, no dependencies). It attaches to nm-relay the way hq
// does: a relay token for one person in the attach message (the hq gateway mints the same token). It
// opens the lanes a machine serves: a terminal in the agent box, a browser pane, and the raw channel the
// engineering lane rides. Other checks import it: browser-lane.mjs, code-session.mjs, and the evals.
//
//   import { relayToken, RelayConnection } from './lib/relay.mjs';
//   const relay = await RelayConnection.open({ url, key, user, machine });
//   const term = await relay.terminal();            // a shell in the box
//   const { code, out } = await term.run('node -v');
//   const pane = await relay.browser({ tab: 'person' });
//   const state = await pane.navigate('https://example.com');   // waits for the load
//   relay.close();
//
// THE RELAY SHARDS (docs/42 "Relay shards"): `url` may be the shard list, a comma list in shard order
// (the stack's relayUrls output). The connection dials the machine's own shard by the one rule
// (packages/relay/src/shard.ts, imported through Node's type stripping, never copied). A shard that is
// not the machine's refuses with 4421 and names the right one: the connection dials that one at once,
// once. A second refusal is final, so two shards that disagree never make a loop.
//
// Every marker the terminal waits for is typed split in two ("DO""NE") because the shell echoes the typed
// line, and an unsplit marker would match the echo.
import { createHmac, randomBytes } from 'node:crypto';
import { parseRelayShards, shardUrlFor, WRONG_SHARD_CLOSE, wrongShardTarget } from '../../../packages/relay/src/shard.ts';

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** the token the hq gateway mints (gateway.mjs signRelayToken): HS256, kid nm-hq-relay, aud nm-relay */
export function relayToken(sub, key, ttl = 600) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'nm-hq-relay' }))}.${b64url(JSON.stringify({ sub, aud: 'nm-relay', iat: now, exp: now + ttl }))}`;
  return `${input}.${b64url(createHmac('sha256', Buffer.from(key, 'base64url')).update(input).digest())}`;
}

export class RelayConnection {
  /** attach as `user` to `machine` on its shard of `url` (one URL, or the shard list). A machine that is
   *  still joining answers 4404: retry for `joinMs`. A wrong-shard refusal (4421) is followed once */
  static async open({ url, key, user, machine, bearer, joinMs = 90_000 }) {
    const deadline = Date.now() + joinMs;
    const shards = parseRelayShards(url);
    let target = shardUrlFor(shards, machine) || url;
    let followed = false;
    for (;;) {
      const c = new RelayConnection(target, key, user, machine, bearer);
      const ok = await c.attach();
      if (ok) return c;
      c.close();
      if (c.closed?.code === WRONG_SHARD_CLOSE) {
        const next = followed ? null : wrongShardTarget(c.closed.reason, shards, target);
        if (!next) throw new Error(`the relay shards refused ${machine} (${JSON.stringify(c.closed)}): pass the stack's relayUrls list`);
        followed = true;
        target = next;
        continue;
      }
      if (Date.now() > deadline) throw new Error(`the relay did not attach to ${machine}: ${JSON.stringify(c.closed)}`);
      await sleep(3_000);
    }
  }

  constructor(url, key, user, machine, bearer) {
    Object.assign(this, { url, key, user, machine, bearer });
    this.attached = null;
    this.closed = null;
    this.channels = new Map(); // ch -> handler(frame)
  }

  async attach() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.t === 'attached') { this.attached = m; return; }
      if (typeof m.ch === 'string') this.channels.get(m.ch)?.(m);
    });
    ws.addEventListener('close', (ev) => { this.closed = { code: ev.code, reason: ev.reason }; for (const h of this.channels.values()) h({ t: 'socket-closed' }); });
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('the relay socket did not open')), { once: true }); });
    // Production qualification supplies a genuine Clerk bearer. Sandbox callers retain their
    // existing HMAC lane; production never enables or mints that sandbox identity.
    const token = typeof this.bearer === 'function' ? await this.bearer() : this.bearer ?? relayToken(this.user, this.key);
    this.send({ t: 'attach', machineId: this.machine, token });
    for (let i = 0; i < 100 && !this.attached && !this.closed; i++) await sleep(100);
    return this.attached;
  }

  get lanes() { return new Set(this.attached?.lanes ?? []); }
  send(m) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  data(ch, text) { this.send({ ch, t: 'data', d: Buffer.from(text).toString('base64') }); }
  channel(prefix = 'c') { return `${prefix}-${randomBytes(4).toString('hex')}`; }
  close() { try { this.ws?.close(1000, 'done'); } catch { /* closed */ } }

  /** a shell in the machine's agent box (the terminal lane) */
  async terminal({ cols = 200, rows = 50 } = {}) {
    const t = new Terminal(this, this.channel('term'));
    await t.open(cols, rows);
    return t;
  }

  /** a browser pane (the browser lane): `person` steers, `agent` only watches */
  async browser({ tab = 'person', width = 1024, height = 768 } = {}) {
    if (!this.lanes.has('browser')) throw new Error(`this machine serves no browser lane (lanes: ${[...this.lanes].join(', ')})`);
    const p = new BrowserPane(this, this.channel('browser'));
    await p.open(tab, width, height);
    return p;
  }

  /** a Code session (the engineering lane) with an EngineeringOpenMeta (packages/shared engineering/protocol.ts) */
  engineering(meta) {
    if (!this.lanes.has('engineering')) throw new Error(`this machine serves no engineering lane (lanes: ${[...this.lanes].join(', ')})`);
    const s = new CodeSession(this, this.channel('code'));
    s.open(meta);
    return s;
  }
}

/** one Code session: commands go one JSON per data frame, events come back as NDJSON across frames */
export class CodeSession {
  constructor(relay, ch) { Object.assign(this, { relay, ch }); this.events = []; this.buf = ''; this.closed = null; this.listeners = new Set(); }
  open(meta) {
    this.relay.channels.set(this.ch, (m) => {
      if (m.t === 'close' || m.t === 'socket-closed') { this.closed = m.reason ?? m.t; return; }
      if (m.t !== 'data' || typeof m.d !== 'string') return;
      this.buf += Buffer.from(m.d, 'base64').toString('utf8');
      for (let nl = this.buf.indexOf('\n'); nl !== -1; nl = this.buf.indexOf('\n')) {
        const line = this.buf.slice(0, nl); this.buf = this.buf.slice(nl + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        this.events.push(ev);
        for (const fn of this.listeners) fn(ev);
      }
    });
    this.relay.send({ ch: this.ch, t: 'open', lane: 'engineering', meta });
  }
  command(c) { this.relay.send({ ch: this.ch, t: 'data', d: Buffer.from(JSON.stringify(c)).toString('base64') }); }
  /** the first event at or after index `from` that matches, or null after `ms` (or a close) */
  async waitFor(pred, from = 0, ms = 120_000) {
    const deadline = Date.now() + ms;
    for (;;) {
      for (let i = from; i < this.events.length; i++) if (pred(this.events[i])) return { ev: this.events[i], index: i };
      if (this.closed || Date.now() > deadline) return null;
      await sleep(200);
    }
  }
  close() { this.relay.send({ ch: this.ch, t: 'close' }); }
}

export class Terminal {
  constructor(relay, ch) { Object.assign(this, { relay, ch }); this.out = ''; this.closedByMachine = false; }
  async open(cols, rows) {
    this.relay.channels.set(this.ch, (m) => {
      if (m.t === 'data' && typeof m.d === 'string') this.out += Buffer.from(m.d, 'base64').toString('utf8');
      else if (m.t === 'close' || m.t === 'socket-closed') this.closedByMachine = true;
    });
    this.relay.send({ ch: this.ch, t: 'open', cols, rows });
    if (!(await this.waitFor(/[#$] $/m, 0, 30_000))) throw new Error(`the terminal gave no prompt: ${this.out.slice(-300)}`);
  }
  async waitFor(re, from = 0, ms = 15_000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const m = re.exec(this.out.slice(from));
      if (m) return m;
      if (this.closedByMachine) return null;
      await sleep(100);
    }
    return null;
  }
  /** run one command line; resolves { code, out } with the output between the echo and the marker */
  async run(cmd, ms = 60_000) {
    const n = randomBytes(3).toString('hex');
    const from = this.out.length;
    this.relay.data(this.ch, `${cmd}; echo "NM""DONE-${n}[$?]"\r`);
    const m = await this.waitFor(new RegExp(`NMDONE-${n}\\[(\\d+)\\]`), from, ms);
    const all = this.out.slice(from);
    const echoEnd = all.indexOf('\n');
    const body = m ? all.slice(echoEnd + 1, all.indexOf(`NMDONE-${n}[`)) : all;
    // bash's bracketed-paste and other control sequences are not output
    return { code: m ? Number(m[1]) : null, out: body.replace(/\r/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '') };
  }
  close() { this.relay.send({ ch: this.ch, t: 'close' }); this.relay.channels.delete(this.ch); }
}

export class BrowserPane {
  constructor(relay, ch) {
    Object.assign(this, { relay, ch });
    this.messages = [];
    this.state = null;
    this.frame = null;
    this.frames = 0;
    this.notices = [];
    this.closed = false;
    this.buf = '';
  }
  async open(tab, width, height) {
    this.relay.channels.set(this.ch, (m) => {
      if (m.t === 'close' || m.t === 'socket-closed') { this.closed = true; return; }
      if (m.t !== 'data' || typeof m.d !== 'string') return;
      this.buf += Buffer.from(m.d, 'base64').toString('utf8');
      for (let nl = this.buf.indexOf('\n'); nl !== -1; nl = this.buf.indexOf('\n')) {
        const line = this.buf.slice(0, nl); this.buf = this.buf.slice(nl + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        this.messages.push(msg.t === 'frame' ? { t: 'frame', n: msg.n, w: msg.w, h: msg.h, bytes: msg.jpeg.length } : msg);
        if (msg.t === 'state') this.state = msg;
        else if (msg.t === 'notice') this.notices.push(msg.text);
        else if (msg.t === 'frame') { this.frame = msg; this.frames += 1; this.relay.data(this.ch, `${JSON.stringify({ t: 'ack', n: msg.n })}\n`); }
      }
    });
    this.relay.send({ ch: this.ch, t: 'open', lane: 'browser', meta: { v: 1, tab, width, height } });
    // the machine binds the page, then says where it is: a pane that sends before that is dropped
    for (let i = 0; i < 600 && !this.state && !this.closed && !this.notices.length; i++) await sleep(100);
    if (!this.state) throw new Error(`the browser pane did not open: ${this.closed ? 'the machine closed it' : this.notices.join(' ') || 'no state in 60 s'}`);
  }
  send(msg) { this.relay.data(this.ch, `${JSON.stringify(msg)}\n`); }
  /** navigate and wait until the page settles at a new address (or a notice refuses it).
   *  Resolves { ok, state, notice, frames } */
  async navigate(url, ms = 45_000) {
    const notices0 = this.notices.length;
    const frames0 = this.frames;
    const before = this.state;
    this.send({ t: 'navigate', url });
    const deadline = Date.now() + ms;
    let sawLoading = false;
    while (Date.now() < deadline && !this.closed) {
      if (this.notices.length > notices0) return { ok: false, state: this.state, notice: this.notices.at(-1), frames: this.frames - frames0 };
      if (this.state?.loading) sawLoading = true;
      const moved = this.state && this.state !== before && !this.state.loading && (sawLoading || this.state.url !== before?.url);
      if (moved && this.frames > frames0) return { ok: true, state: this.state, notice: null, frames: this.frames - frames0 };
      await sleep(150);
    }
    return { ok: false, state: this.state, notice: this.closed ? 'the pane closed' : 'timed out', frames: this.frames - frames0 };
  }
  /** a click at page coordinates (CSS pixels of the pane) */
  async click(x, y) {
    this.send({ t: 'mouse', type: 'move', x, y });
    this.send({ t: 'mouse', type: 'down', x, y, button: 'left', clicks: 1 });
    this.send({ t: 'mouse', type: 'up', x, y, button: 'left', clicks: 1 });
    await sleep(500);
  }
  type(text) { this.send({ t: 'text', text }); }
  /** the newest frame as JPEG bytes, or null */
  jpeg() { return this.frame ? Buffer.from(this.frame.jpeg, 'base64') : null; }
  /** A FRAME OF THE PAINTED PAGE. A screencast sends a frame when the page changes, and the frame that
   *  lands with the load is often the blank one before the first paint. Node has no JPEG decoder, so
   *  "painted" is judged by size: a blank page at this viewport packs to a few KB (`blankBytes`, the
   *  pane's own about:blank frame), and text or colour adds to that. Until a frame passes `minBytes`,
   *  the pane is nudged to repaint (a 1 px resize and back, which makes Chromium send a fresh frame).
   *  Resolves { jpeg, bytes, painted, tries } with the best frame seen in `ms` */
  async painted({ blankBytes = 0, minBytes = 0, ms = 5_000 } = {}) {
    const need = Math.max(minBytes, Math.ceil(blankBytes * 1.3));
    const size = () => (this.frame ? Buffer.from(this.frame.jpeg, 'base64').length : 0);
    let best = this.frame;
    let bestBytes = size();
    const deadline = Date.now() + ms;
    let tries = 0;
    while (bestBytes < need && Date.now() < deadline && !this.closed) {
      tries += 1;
      const w = this.frame?.w ?? 1024; const h = this.frame?.h ?? 768;
      this.send({ t: 'resize', width: w + 1, height: h });
      await sleep(250);
      this.send({ t: 'resize', width: w, height: h });
      await sleep(450);
      if (size() > bestBytes) { best = this.frame; bestBytes = size(); }
    }
    return { jpeg: best ? Buffer.from(best.jpeg, 'base64') : null, bytes: bestBytes, painted: bestBytes >= need, need, tries };
  }
  close() { this.relay.send({ ch: this.ch, t: 'close' }); this.relay.channels.delete(this.ch); }
}
