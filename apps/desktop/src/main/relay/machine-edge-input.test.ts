// AN IDLE OPEN TAB IS NOT WORK (machined-busy.ts). The relay edge records when a person last typed into
// each open terminal or Code session (the open counts as input), and machined's busy rule asks whether
// that was within NM_TERMINAL_IDLE_MS. A resize is not input, and a closed session counts for nothing.
// Run: pnpm exec tsx --test src/main/relay/machine-edge-input.test.ts
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { connectMachineEdge, type PtyLike, type SpawnPty } from './machine-edge';
import type { EngineeringMachineHost } from './engineering-host';

const brain = mkdtempSync(join(tmpdir(), 'nm-edge-input-'));
process.env['NM_BRAIN'] = brain;
after(() => rmSync(brain, { recursive: true, force: true }));

async function until(cond: () => boolean, what: string, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

function fakePtys(): { spawn: SpawnPty; written: string[] } {
  const written: string[] = [];
  const spawn: SpawnPty = () => {
    let exit: () => void = () => {};
    const pty: PtyLike = {
      onData: (cb) => { setTimeout(() => cb('nm $ '), 0); },
      onExit: (cb) => { exit = cb; },
      write: (d) => { written.push(d); },
      resize: () => {},
      kill: () => { setTimeout(() => exit(), 0); },
    };
    return pty;
  };
  return { spawn, written };
}

const b64 = (s: string): string => Buffer.from(s).toString('base64');

test('lastInputAt: 0 with nothing open, the open and each keystroke count, a resize does not, a close forgets', async () => {
  const r = await relay();
  const ptys = fakePtys();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', spawnPty: ptys.spawn, log: () => {} });
  try {
    await until(() => r.frames.some((f) => f.t === 'hello'), 'the hello');
    assert.equal(edge.lastInputAt(), 0);
    const t0 = Date.now();
    r.send({ ch: 'c1', t: 'open', cols: 80, rows: 24, actorId: 'u1' });
    await until(() => edge.sessionCount() === 1 && edge.lastInputAt() > 0, 'the open');
    const opened = edge.lastInputAt();
    assert.ok(opened >= t0 && opened <= Date.now());

    await sleep(30);
    r.send({ ch: 'c1', t: 'resize', cols: 120, rows: 40 });
    await sleep(30);
    assert.equal(edge.lastInputAt(), opened, 'a resize is not input');

    r.send({ ch: 'c1', t: 'data', d: b64('ls\r') });
    await until(() => ptys.written.includes('ls\r'), 'the keystroke');
    assert.ok(edge.lastInputAt() > opened, 'a keystroke is input');

    r.send({ ch: 'c1', t: 'close' });
    await until(() => edge.sessionCount() === 0, 'the close');
    assert.equal(edge.lastInputAt(), 0, 'a closed terminal holds nothing');
  } finally { edge.close(); r.close(); }
});

test('lastInputAt: a Code session counts its commands as input, and the newest of all open sessions wins', async () => {
  const r = await relay();
  const commands: unknown[] = [];
  const engineering: EngineeringMachineHost = {
    open: async () => ({ command: (v) => { commands.push(v); }, close: () => {} }),
  };
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', spawnPty: fakePtys().spawn, engineering, log: () => {} });
  try {
    await until(() => r.frames.some((f) => f.t === 'hello'), 'the hello');
    r.send({ ch: 't1', t: 'open', cols: 80, rows: 24, actorId: 'u1' });
    await until(() => edge.sessionCount() === 1, 'the terminal');
    const terminalAt = edge.lastInputAt();
    await sleep(30);
    r.send({
      ch: 'e1', t: 'open', lane: 'engineering', actorId: 'u1',
      meta: { threadId: 'th1', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'act', permissions: { read: true, edit: true, command: true, web: true, mcp: true }, policy: { read: true, edit: true, command: true, web: true, mcp: true } },
    });
    await until(() => edge.sessionCount() === 2, 'the Code session');
    const codeAt = edge.lastInputAt();
    assert.ok(codeAt > terminalAt, 'the Code open is the newest input');
    await sleep(30);
    r.send({ ch: 'e1', t: 'data', d: b64(JSON.stringify({ type: 'prompt', prompt: 'hi' })) });
    await until(() => commands.length === 1, 'the prompt');
    assert.ok(edge.lastInputAt() > codeAt);
  } finally { edge.close(); r.close(); }
});
