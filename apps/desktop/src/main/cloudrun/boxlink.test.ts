// THE BOX LINK (boxlink.ts): the box's way back to the supervisor since the platform drops box → veth
// traffic. These tests run the REAL box end (the script the link writes) under this Node, with the
// "box" on this host's loopback: a client in the box dials the box port, and the bytes must reach a
// server on the supervisor's loopback, both ways, with the caps holding and the link coming back.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { BOXLINK_REL, BoxLink, boxLinkModeOf, CHUNK, dataFrames, encodeFrame, FrameReader, type Frame, type LinkBox } from './boxlink';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(10); }
}

/** a box that runs the box end the link wrote, with this Node, on this host */
function localBox(workDir: string): LinkBox & { children: ChildProcess[]; dead: boolean } {
  const children: ChildProcess[] = [];
  return {
    children,
    dead: false,
    exec(_cmd, o) {
      const child = spawn(process.execPath, [join(workDir, BOXLINK_REL)], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...(o.env ?? {}) } });
      children.push(child);
      return child;
    },
  };
}

async function listen(handler: (s: Socket) => void): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { server, port: (server.address() as { port: number }).port };
}
const echo = () => listen((s) => { s.on('error', () => {}); s.pipe(s); });

/** send `payload` through the box port and read back as many bytes */
async function roundTrip(boxPort: number, payload: Buffer): Promise<Buffer> {
  const c = connect({ host: '127.0.0.1', port: boxPort });
  const got: Buffer[] = [];
  let n = 0;
  await new Promise<void>((resolve, reject) => {
    c.on('error', reject);
    c.on('data', (d: Buffer) => { got.push(d); n += d.length; if (n >= payload.length) resolve(); });
    c.write(payload);
  });
  c.end();
  return Buffer.concat(got);
}

function setup(o: Partial<ConstructorParameters<typeof BoxLink>[0]> = {}) {
  const workDir = mkdtempSync(join(tmpdir(), 'nm-boxlink-'));
  const box = localBox(workDir);
  const lines: string[] = [];
  const link = new BoxLink({ box: () => box, workDir, log: (l) => lines.push(l), backoffFirstMs: 50, backoffMaxMs: 400, ...o });
  return { workDir, box, link, lines };
}

test('framing: one JSON object per line, data in CHUNK pieces, a line over the limit or a non-frame is an error', () => {
  const frames: Frame[] = [];
  const errors: string[] = [];
  const r = new FrameReader((f) => frames.push(f), (e) => errors.push(e), 64);
  const line = encodeFrame({ t: 'open', id: 1, svc: 'bus' });
  r.push(line.slice(0, 5)); r.push(line.slice(5) + encodeFrame({ t: 'close', id: 1 }));
  assert.deepEqual(frames, [{ t: 'open', id: 1, svc: 'bus' }, { t: 'close', id: 1 }]);
  r.push('x'.repeat(100));
  assert.match(errors[0]!, /a line over 64 bytes/);
  new FrameReader(() => {}, (e) => errors.push(e)).push('not json\n');
  assert.match(errors[1]!, /not a frame/);
  const big = randomBytes(CHUNK * 2 + 10);
  const parts = dataFrames(7, big);
  assert.equal(parts.length, 3);
  assert.deepEqual(Buffer.concat(parts.map((p) => Buffer.from((p as { d: string }).d, 'base64'))), big);
});

test('the mode knob: stdio by default, veth to go back, anything else refused', () => {
  assert.equal(boxLinkModeOf({}), 'stdio');
  assert.equal(boxLinkModeOf({ NM_BOX_LINK: 'veth' }), 'veth');
  assert.throws(() => boxLinkModeOf({ NM_BOX_LINK: 'tcp' }), /stdio or veth/);
});

test('a client in the box reaches the supervisor service through the box port, both ways, every byte', async () => {
  const s = setup();
  const target = await echo();
  try {
    const boxPort = await s.link.expose('bus', target.port);
    assert.ok(boxPort > 0 && boxPort !== target.port);
    assert.ok(s.link.up);
    const payload = randomBytes(5 * 1024 * 1024 + 17);
    const back = await roundTrip(boxPort, payload);
    assert.ok(back.equals(payload), 'the 5 MiB came back intact');
    assert.ok(s.lines.some((l) => l.includes(`bus → box 127.0.0.1:${boxPort}`)));
    assert.equal(await s.link.expose('bus', target.port), boxPort, 'a second expose answers the same port');
  } finally { await s.link.stop('test'); target.server.close(); }
});

test('many streams at once keep their own bytes, and a close on either side reaches the other', async () => {
  const s = setup();
  const target = await echo();
  let serverSide: Socket | null = null;
  const closer = await listen((sock) => { serverSide = sock; sock.on('error', () => {}); });
  try {
    const boxPort = await s.link.expose('echo', target.port);
    const payloads = Array.from({ length: 20 }, () => randomBytes(200_000));
    const backs = await Promise.all(payloads.map((p) => roundTrip(boxPort, p)));
    backs.forEach((b, i) => assert.ok(b.equals(payloads[i]!), `stream ${i}`));
    // the supervisor service closes: the box client sees the end
    const closePort = await s.link.expose('closer', closer.port);
    const c = connect({ host: '127.0.0.1', port: closePort });
    let ended = false;
    c.on('end', () => { ended = true; });
    c.on('error', () => {});
    await until(() => !!serverSide, 'the stream opened here');
    serverSide!.end();
    await until(() => ended, 'the box client hears the close');
    // the box client closes: the supervisor socket ends
    let gone = false;
    serverSide = null;
    const c2 = connect({ host: '127.0.0.1', port: closePort });
    await until(() => !!serverSide, 'a second stream');
    serverSide!.on('end', () => { gone = true; });
    c2.end();
    await until(() => gone, 'the supervisor side hears the close');
  } finally { await s.link.stop('test'); target.server.close(); closer.server.close(); }
});

// The pause is a frame, so the far side keeps reading until it reads it. Before 'one chunk per turn' (the
// header) the box end could read 2 MiB in one libuv turn after the pause was sent, and 4 of 20 runs in
// Cloud Build dropped the stream at 1,114,112 bytes queued. Now the queue stays near the cap (at most
// 512 KiB over 30 runs with this 256 KiB cap).
test('bounded: a supervisor service that stops reading pauses the stream instead of filling PID 1', async () => {
  const CAP = 256 * 1024;
  const s = setup({ streamCapBytes: CAP, totalCapBytes: 8 * 1024 * 1024 });
  let stuck: Socket | null = null;
  const target = await listen((sock) => { stuck = sock; sock.pause(); sock.on('error', () => {}); });
  try {
    const boxPort = await s.link.expose('slow', target.port);
    const c = connect({ host: '127.0.0.1', port: boxPort });
    c.on('error', () => {});
    let written = 0;
    const chunk = randomBytes(256 * 1024);
    // keep writing for a while; the box end must stop reading this client once paused
    const deadline = Date.now() + 1500;
    let maxQueued = 0;
    while (Date.now() < deadline) {
      if (c.writableLength < 4 * 1024 * 1024) { c.write(chunk); written += chunk.length; }
      maxQueued = Math.max(maxQueued, s.link.queued());
      await sleep(5);
    }
    assert.ok(written > 2 * 4 * CAP, 'the client wrote far more than the caps');
    assert.ok(maxQueued <= 4 * CAP, `PID 1 held under the hard cap (max ${maxQueued})`);
    assert.equal(s.link.stats.dropped, 0, 'paused, not dropped');
    // the service reads again: everything flows
    stuck!.resume();
    let read = 0;
    stuck!.on('data', (d: Buffer) => { read += d.length; });
    await until(() => read >= written, 'every byte arrives once the service reads', 20_000);
    c.destroy();
  } finally { await s.link.stop('test'); target.server.close(); }
});

test('the link comes back after its exec ends, on the same box port, and stop() ends it for good', async () => {
  const s = setup();
  const target = await echo();
  try {
    const boxPort = await s.link.expose('bus', target.port);
    s.box.children[0]!.kill('SIGKILL');
    await until(() => s.box.children.length === 2 && s.link.up && s.link.boxPort('bus') === boxPort, 'respawned, same port');
    assert.ok((await roundTrip(boxPort, Buffer.from('again'))).equals(Buffer.from('again')));
    assert.ok(s.lines.some((l) => /the box end ended \(exit/.test(l)));
    await s.link.stop('test');
    assert.equal(s.link.up, false);
    await sleep(300);
    assert.equal(s.box.children.length, 2, 'no respawn after stop');
    await assert.rejects(s.link.expose('bus', target.port), /stopped/);
  } finally { await s.link.stop('test'); target.server.close(); }
});

test('a dead box is not respawned into, and expose waits then fails while the box end is not up', async () => {
  const s = setup();
  const target = await echo();
  try {
    await s.link.expose('bus', target.port);
    s.box.dead = true;
    s.box.children[0]!.kill('SIGKILL');
    await until(() => s.lines.some((l) => l.includes('the box is gone')), 'stays down');
    await assert.rejects(s.link.expose('other', target.port, 300), /no box|did not open|ended/);
  } finally { await s.link.stop('test'); target.server.close(); }
});
