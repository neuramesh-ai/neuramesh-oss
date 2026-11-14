// A MEMBER MACHINE OPENS FOR ITS OWNER ONLY, on the machine too (machine-edge.ts ownerOnly). nm-api's
// validate-client is the authority; this edge closes any open whose actor is someone else, on every
// lane and on a resume, so a misjudged attach still reaches no shell, Code session or browser.
// Run: pnpm exec tsx --test src/main/relay/machine-edge-owner.test.ts
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { connectMachineEdge, NOT_THE_OWNER, type PtyLike, type SpawnPty } from './machine-edge';

const brain = mkdtempSync(join(tmpdir(), 'nm-edge-owner-'));
process.env['NM_BRAIN'] = brain;
after(() => rmSync(brain, { recursive: true, force: true }));

async function until(cond: () => boolean, what: string, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface Frame { ch?: string; t: string; d?: string; [k: string]: unknown }
async function relay(): Promise<{ url: string; frames: Frame[]; send(f: Frame): void; close(): void }> {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  let sock: WsSocket | null = null;
  const state = {
    url: '', frames: [] as Frame[],
    send: (f: Frame): void => { sock?.send(JSON.stringify(f)); },
    close: (): void => { sock?.terminate(); wss.close(); server.close(); },
  };
  wss.on('connection', (s: WsSocket) => { sock = s; s.on('message', (raw) => { state.frames.push(JSON.parse(raw.toString()) as Frame); }); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  state.url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  return state;
}

function fakePtys(): { spawn: SpawnPty; spawned: { n: number } } {
  const spawned = { n: 0 };
  const spawn: SpawnPty = () => {
    spawned.n += 1;
    let exit: () => void = () => {};
    const pty: PtyLike = {
      onData: (cb) => { setTimeout(() => cb('nm $ '), 0); },
      onExit: (cb) => { exit = cb; },
      write: () => {},
      resize: () => {},
      kill: () => { setTimeout(() => exit(), 0); },
    };
    return pty;
  };
  return { spawn, spawned };
}

test('ownerOnly: a teammate\'s open is closed with the reason on every lane, the owner\'s opens', async () => {
  const r = await relay();
  const ptys = fakePtys();
  const lines: string[] = [];
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', spawnPty: ptys.spawn, ownerOnly: 'owner-a', log: (l) => lines.push(l) });
  try {
    await until(() => r.frames.some((f) => f.t === 'hello'), 'the hello');
    const closed = (ch: string) => r.frames.find((f) => f.ch === ch && f.t === 'close');
    r.send({ ch: 'b1', t: 'open', cols: 80, rows: 24, actorId: 'member-b' });
    r.send({ ch: 'b2', t: 'open', lane: 'browser', actorId: 'member-b' });
    r.send({ ch: 'b3', t: 'open', lane: 'engineering', actorId: 'member-b', meta: {} });
    r.send({ ch: 'b4', t: 'open', resume: true, from: 0, actorId: 'member-b' });
    r.send({ ch: 'b5', t: 'open', cols: 80, rows: 24 });
    await until(() => ['b1', 'b2', 'b3', 'b4', 'b5'].every((ch) => closed(ch)), 'the refusals');
    for (const ch of ['b1', 'b2', 'b3', 'b4', 'b5']) assert.equal(closed(ch)!['reason'], NOT_THE_OWNER, ch);
    assert.equal(ptys.spawned.n, 0, 'no shell for anyone but the owner');
    assert.equal(edge.sessionCount(), 0);
    assert.ok(lines.some((l) => l.includes('open_refused ch=b1') && l.includes('actor=member-b')));

    r.send({ ch: 'a1', t: 'open', cols: 80, rows: 24, actorId: 'owner-a' });
    await until(() => edge.sessionCount() === 1, 'the owner\'s terminal');
    assert.equal(ptys.spawned.n, 1);
    assert.equal(closed('a1'), undefined);
  } finally { edge.close(); r.close(); }
});

test('without ownerOnly (a runner) every member\'s open reaches a shell, as before', async () => {
  const r = await relay();
  const ptys = fakePtys();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', spawnPty: ptys.spawn, log: () => {} });
  try {
    await until(() => r.frames.some((f) => f.t === 'hello'), 'the hello');
    r.send({ ch: 'x1', t: 'open', cols: 80, rows: 24, actorId: 'member-b' });
    r.send({ ch: 'x2', t: 'open', cols: 80, rows: 24, actorId: 'owner-a' });
    await until(() => edge.sessionCount() === 2, 'both terminals');
  } finally { edge.close(); r.close(); }
});
