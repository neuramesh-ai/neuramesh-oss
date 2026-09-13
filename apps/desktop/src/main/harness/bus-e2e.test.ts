// End-to-end test of the tool-bus delivery path for the CLI runtimes (docs/harness/03 §3.4).
//
// This drives the REAL mechanism, not a mock: it starts the actual loopback HTTP bridge, registers a
// real turn's real tool definitions, writes the real stdio shim to disk, spawns it as a subprocess,
// and speaks MCP JSON-RPC to it over stdin/stdout — which is exactly the path `codex` and `agy` take.
//
// It is the evidence that a Codex- or Gemini-seated worker can genuinely call declare_beats and
// record_lesson, rather than the evidence that a unit test can be written about it.
//
// Run: pnpm exec tsx --test src/main/harness/bus-e2e.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { bridgeToolsForTurn, type ToolHost } from './toolbus';
import { beatsAdapter } from './turntools';
import * as orchmcp from '../runtime/orchmcp';

// The bridge is a live HTTP listener; without closing it the suite's event loop never drains and the
// runner hangs forever. (Found by this test hanging — which is exactly why orchmcp gained closeBridge.)
after(() => orchmcp.closeBridge());

/** Speak line-delimited JSON-RPC to the shim, resolving on the reply with a matching id. */
class Shim {
  private buf = '';
  private waiting = new Map<number, (v: Record<string, unknown>) => void>();
  constructor(private child: ChildProcessWithoutNullStreams) {
    child.stdout.on('data', (d) => {
      this.buf += String(d);
      for (;;) {
        const nl = this.buf.indexOf('\n');
        if (nl < 0) break;
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { id?: number };
          if (typeof msg.id === 'number') this.waiting.get(msg.id)?.(msg as Record<string, unknown>);
        } catch { /* not our line */ }
      }
    });
  }
  call(id: number, method: string, params?: unknown): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`shim did not answer ${method} in 10s`)), 10_000);
      this.waiting.set(id, (v) => { clearTimeout(timer); resolve(v); });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n');
    });
  }
  kill() { this.child.kill('SIGTERM'); }
}

interface Recorder { lessons: string[]; backlog: string[]; declared: string[][]; advanced: Array<[number, string]> }

function turnHost(rec: Recorder): ToolHost {
  return {
    dir: '/tmp/nm-e2e',
    skills: [{ name: 'ship-a-pr', description: 'how this team ships', body: '1. branch\n2. push\n3. open the PR' }],
    recordLesson: async (i) => { rec.lessons.push(i.lesson); return { ok: true }; },
    addBacklogItem: async (i) => { rec.backlog.push(i.title); return { ok: true, number: 77 }; },
    beats: beatsAdapter({
      declare: async (steps) => { rec.declared.push(steps); },
      advance: async (seq, status) => { rec.advanced.push([seq, status]); },
    }),
  };
}

test('E2E — a CLI runtime reaches the real nm toolset over the real loopback bridge', async (t) => {
  const rec: Recorder = { lessons: [], backlog: [], declared: [], advanced: [] };
  const host = turnHost(rec);
  const tools = bridgeToolsForTurn('work', host);

  const port = await orchmcp.ensureBridge();
  const turnId = randomBytes(8).toString('hex');
  const secret = randomBytes(16).toString('hex');
  orchmcp.registerTurn(turnId, secret, tools);

  const dir = mkdtempSync(join(tmpdir(), 'nm-bus-e2e-'));
  const shimFile = orchmcp.ensureShim(dir);
  const child = spawn(process.execPath, [shimFile], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NM_ORCH_URL: `http://127.0.0.1:${port}`, NM_ORCH_TURN: turnId, NM_ORCH_SECRET: secret },
  }) as ChildProcessWithoutNullStreams;
  const shim = new Shim(child);
  t.after(() => { shim.kill(); orchmcp.unregisterTurn(turnId); rmSync(dir, { recursive: true, force: true }); });

  // 1 — MCP handshake, exactly as codex/agy perform it
  const init = await shim.call(1, 'initialize', { protocolVersion: '2025-06-18' });
  const initResult = init['result'] as { serverInfo?: { name?: string }; capabilities?: { tools?: unknown } };
  assert.equal(initResult.serverInfo?.name, 'nm');
  assert.ok(initResult.capabilities?.tools, 'the shim must advertise tool capability');

  // 2 — tools/list returns the WORK turn's toolset, fetched live over the bridge
  const listed = await shim.call(2, 'tools/list');
  const names = ((listed['result'] as { tools: Array<{ name: string; inputSchema: unknown }> }).tools).map((x) => x.name).sort();
  // Exactly the work-turn tools this host can service: screenshot and propose_skill are absent
  // because no closure was injected, which is the "never advertise what you cannot do" rule.
  assert.deepEqual(names, ['add_backlog_item', 'add_subtask', 'advance_beat', 'declare_beats', 'load_skill', 'record_lesson'],
    'a CLI worker sees exactly the serviceable work-turn tools');
  const schema = ((listed['result'] as { tools: Array<{ name: string; inputSchema: { properties?: Record<string, unknown>; required?: string[] } }> }).tools)
    .find((x) => x.name === 'declare_beats')!.inputSchema;
  assert.ok(schema.properties?.['steps'], 'the advertised JSON Schema survives the transport');
  assert.deepEqual(schema.required, ['steps']);

  // 3 — declare_beats: the tool that was pure prompt-etiquette (NM_BEAT_DONE stdout markers) before
  const declared = await shim.call(3, 'tools/call', { name: 'declare_beats', arguments: { steps: ['read the spec', 'patch the nav', 'run the suite'] } });
  assert.match(String(((declared['result'] as { content: Array<{ text: string }> }).content)[0]!.text), /3 steps/);
  assert.deepEqual(rec.declared, [['read the spec', 'patch the nav', 'run the suite']], 'the daemon actually received the plan');

  const advanced = await shim.call(4, 'tools/call', { name: 'advance_beat', arguments: { step: 2 } });
  assert.match(String(((advanced['result'] as { content: Array<{ text: string }> }).content)[0]!.text), /step 2 marked done/);
  assert.deepEqual(rec.advanced, [[2, 'done']]);

  // 4 — record_lesson: previously "Claude-tool only today"
  const lesson = 'evidence HTML belongs under .nm-evidence and never in the commit';
  const recorded = await shim.call(5, 'tools/call', { name: 'record_lesson', arguments: { lesson } });
  assert.match(String(((recorded['result'] as { content: Array<{ text: string }> }).content)[0]!.text), /recorded in team memory/);
  assert.deepEqual(rec.lessons, [lesson]);

  // 5 — add_backlog_item: the one board write a worker gets, now on every runtime
  const parked = await shim.call(6, 'tools/call', { name: 'add_backlog_item', arguments: { title: 'delete the dead NM_BEAT_DONE sink' } });
  assert.match(String(((parked['result'] as { content: Array<{ text: string }> }).content)[0]!.text), /#77/);
  assert.deepEqual(rec.backlog, ['delete the dead NM_BEAT_DONE sink']);

  // 6 — kind-scoping survives the transport: a SUBAGENT turn on the same bridge cannot create a
  // board row (docs/harness/04 — a subtask belongs to the parent), and an unknown name is a hard
  // error rather than a silent no-op.
  const legTurn = randomBytes(8).toString('hex');
  const legSecret = randomBytes(16).toString('hex');
  orchmcp.registerTurn(legTurn, legSecret, bridgeToolsForTurn('leg', host));
  t.after(() => orchmcp.unregisterTurn(legTurn));
  const legList = await fetch(`http://127.0.0.1:${port}/tools?turn=${legTurn}&secret=${legSecret}`).then((r) => r.json() as Promise<{ tools: Array<{ name: string }> }>);
  const legNames = legList.tools.map((x) => x.name).sort();
  assert.ok(!legNames.includes('add_subtask'), 'a leg may not create a board row, over the wire as in-process');
  assert.ok(legNames.includes('record_lesson'), 'but it may still teach the channel something');

  const denied = await shim.call(7, 'tools/call', { name: 'not_a_real_tool', arguments: {} });
  assert.match(String(((denied['result'] as { content: Array<{ text: string }> }).content)[0]!.text), /unknown tool/);

  // 7 — invalid input comes back as a correctable message, never a crash
  const invalid = await shim.call(8, 'tools/call', { name: 'record_lesson', arguments: { lesson: 'short' } });
  assert.match(String(((invalid['result'] as { content: Array<{ text: string }> }).content)[0]!.text), /invalid input/);
  assert.equal(rec.lessons.length, 1, 'the rejected call never reached the closure');
});

test('E2E — a finished turn grants nothing, and a wrong secret is refused', async (t) => {
  const rec: Recorder = { lessons: [], backlog: [], declared: [], advanced: [] };
  const tools = bridgeToolsForTurn('work', turnHost(rec));
  const port = await orchmcp.ensureBridge();
  const turnId = randomBytes(8).toString('hex');
  const secret = randomBytes(16).toString('hex');
  orchmcp.registerTurn(turnId, secret, tools);
  const base = `http://127.0.0.1:${port}`;
  t.after(() => orchmcp.unregisterTurn(turnId));

  // the right secret works
  const ok = await fetch(`${base}/tools?turn=${turnId}&secret=${secret}`);
  assert.equal(ok.status, 200);

  // a wrong secret does not — this is what stops another local process invoking a live turn's tools
  const wrong = await fetch(`${base}/tools?turn=${turnId}&secret=deadbeef`);
  assert.equal(wrong.status, 403);

  // …and after cleanup the turn is gone entirely, which is why registration is per-turn
  orchmcp.unregisterTurn(turnId);
  const after = await fetch(`${base}/tools?turn=${turnId}&secret=${secret}`);
  assert.equal(after.status, 403, 'a settled turn must not remain callable');
});

test('E2E — the bridge binds loopback only (doctrine §5.4: no inbound surface)', async () => {
  const port = await orchmcp.ensureBridge();
  const { createConnection } = await import('node:net');
  // Connecting to the port on a NON-loopback local address must fail: the listener is bound to
  // 127.0.0.1, so nothing off-box can reach a turn's tools even with a valid secret.
  const reachable = await new Promise<boolean>((resolve) => {
    const s = createConnection({ port, host: '0.0.0.0', timeout: 1500 });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
  // 0.0.0.0 routes to loopback on macOS, so this asserts the weaker true property: the socket is
  // not listening on a routable interface. The strong guarantee is the bind address itself.
  assert.ok(typeof reachable === 'boolean');
  const addrs = await import('node:os').then((os) => Object.values(os.networkInterfaces()).flat().filter((i) => i && !i.internal && i.family === 'IPv4'));
  for (const a of addrs) {
    const off = await new Promise<boolean>((resolve) => {
      const s = createConnection({ port, host: a!.address, timeout: 1500 });
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => resolve(false));
      s.on('timeout', () => { s.destroy(); resolve(false); });
    });
    assert.equal(off, false, `the bridge must not be reachable on ${a!.address}`);
  }
});
