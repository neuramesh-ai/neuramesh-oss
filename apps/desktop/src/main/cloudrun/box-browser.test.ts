// THE BROWSER IN THE AGENT BOX (box-browser.ts) and the preview rule (address-guard.ts). The lane
// choice, where each profile lives, the in-box command line (CDP on the exec's stdio, the proxy on the
// veth IP, loopback left in the box, no debugging port), a launch and a close against a fake box, and
// the refusal while the box is down. One test runs the exact in-box shell line for real with a stand-in
// browser that speaks CDP on fds 3 and 4 only, so the redirect is proven on a real shell, not a fake.
// Run: pnpm exec tsx --test src/main/cloudrun/box-browser.test.ts
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoSecrets, type BoxResult, type ExecOptions } from './box';
import { BOX_BROWSER_KEEP, BOX_BROWSER_TMP, boxChromiumCommand, boxProfileDir, browserLaneOf, createBoxChromiumLauncher, type BrowserBox } from './box-browser';
import { chromiumArgs } from '../browser/chromium';
import { checkUrl, isPreviewUrl, setLoopbackPreview } from '../browser/address-guard';
import { cdpOverPipe } from '../browser/cdp';

after(() => setLoopbackPreview(false));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('the lane: the box on Cloud Run, the supervisor elsewhere, and an unknown value refused', { timeout: 20_000 }, () => {
  assert.equal(browserLaneOf({}, true), 'box');
  assert.equal(browserLaneOf({}, false), 'supervisor');
  assert.equal(browserLaneOf({ NM_BROWSER_LANE: 'off' }, true), 'off');
  assert.equal(browserLaneOf({ NM_BROWSER_LANE: 'supervisor' }, true), 'supervisor');
  assert.throws(() => browserLaneOf({ NM_BROWSER_LANE: 'host' }, true), /must be box, supervisor or off/);
});

test('profiles: only a member machine keeps the person profile, and every other one is ephemeral', { timeout: 20_000 }, () => {
  assert.deepEqual(boxProfileDir('/nm/state/browser/person-u1', true), { dir: `${BOX_BROWSER_KEEP}/person-u1`, keep: true });
  assert.deepEqual(boxProfileDir('/nm/state/browser/person-u1', false), { dir: `${BOX_BROWSER_TMP}/person-u1`, keep: false });
  assert.deepEqual(boxProfileDir('/tmp/nm-agent-browser-AbC123', true), { dir: `${BOX_BROWSER_TMP}/nm-agent-browser-AbC123`, keep: false });
  assert.equal(boxProfileDir('/x/person-a b;rm -rf', false).dir, `${BOX_BROWSER_TMP}/person-a_b_rm_-rf`);
});

test('the in-box command: CDP on the exec stdio, no proxy (the box egress), loopback in the box, no port', { timeout: 20_000 }, () => {
  const cmd = boxChromiumCommand({ bin: '/usr/bin/chromium', profileDir: '/tmp/nm-browser/person-u1', proxyPort: 41234, proxyHost: '172.20.0.1', width: 1024, height: 768 });
  assert.equal(cmd[0], '/bin/sh');
  assert.equal(cmd[1], '-c');
  const line = cmd[2]!;
  assert.match(line, /exec '\/usr\/bin\/chromium' .* 3<&0 4>&1 >\/dev\/null$/);
  for (const flag of ['--headless=new', '--remote-debugging-pipe', '--user-data-dir=/tmp/nm-browser/person-u1', '--disable-quic']) assert.ok(line.includes(flag), flag);
  // direct by default: the box reaches no supervisor port, and its own egress is public-only
  assert.equal(line.includes('--proxy-server'), false, 'the box browser uses the box egress, no proxy');
  assert.equal(line.includes('<-loopback>'), false, 'loopback stays in the box: a preview');
  const proxied = boxChromiumCommand({ bin: '/usr/bin/chromium', profileDir: '/tmp/nm-browser/p', proxyPort: 41234, proxyHost: '172.20.0.1', direct: false, width: 1024, height: 768 })[2]!;
  assert.ok(proxied.includes('--proxy-server=http://172.20.0.1:41234'));
  assert.equal(proxied.includes('<-loopback>'), false);
  assert.equal(line.includes('--remote-debugging-port'), false);
  assert.match(line, /rm -f '\/tmp\/nm-browser\/person-u1'\/SingletonLock/);
  assertNoSecrets(cmd);
  // the supervisor's browser keeps every connection on the proxy, loopback too
  const host = chromiumArgs({ profileDir: '/p', proxyPort: 1, width: 800, height: 600 });
  assert.ok(host.includes('--proxy-bypass-list=<-loopback>'));
  assert.ok(host.includes('--proxy-server=http://127.0.0.1:1'));
});

const OK: BoxResult = { code: 0, stdout: '', stderr: '', ms: 1 };
/** a fake box whose exec is a browser that answers CDP over the exec's stdin and stdout */
function fakeBox(o: { answer?: boolean } = {}) {
  const execs: Array<{ cmd: readonly string[]; o: ExecOptions | undefined; child: ChildProcess }> = [];
  const waits: Array<readonly string[]> = [];
  const signals: Array<[string, string]> = [];
  const methods: string[] = [];
  const box: BrowserBox = {
    exec: (cmd, opts) => {
      const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: () => { stdout.end(); child.emit('close', null); return true; } }) as unknown as ChildProcess;
      let held = '';
      stdin.on('data', (b: Buffer) => {
        held += b.toString('utf8');
        for (let nul = held.indexOf('\0'); nul !== -1; nul = held.indexOf('\0')) {
          const m = JSON.parse(held.slice(0, nul)) as { id: number; method: string };
          held = held.slice(nul + 1);
          methods.push(m.method);
          if (o.answer === false) continue;
          stdout.write(`${JSON.stringify({ id: m.id, result: m.method === 'Browser.getVersion' ? { product: 'Chrome/fake' } : {} })}\0`);
          if (m.method === 'Browser.close') setTimeout(() => { stdout.end(); child.emit('close', 0); }, 5);
        }
      });
      if (o.answer === false) setTimeout(() => stderr.write('chromium: cannot open display\n'), 1);
      execs.push({ cmd, o: opts, child });
      return child;
    },
    execWait: async (cmd) => { waits.push(cmd); return OK; },
    signal: async (pidFile, sig) => { signals.push([pidFile, sig]); return OK; },
  };
  return { box, execs, waits, signals, methods };
}

test('a launch runs Chromium in the box with its stdio as the pipe, and a close removes an ephemeral profile', { timeout: 20_000 }, async () => {
  const f = fakeBox();
  const launch = createBoxChromiumLauncher({ box: () => f.box, proxyHost: '172.20.0.1', keepPersonProfiles: false });
  const c = await launch({ bin: '/usr/bin/chromium', profileDir: '/nm/state/browser/person-u1', proxyPort: 4000, width: 800, height: 600 });
  assert.equal(f.execs.length, 1);
  assert.equal(f.execs[0]!.o?.stdin, 'pipe');
  assert.match(String(f.execs[0]!.o?.pidFile), /^\/tmp\/nm-browser-pids\/.+\.pid$/);
  assert.ok(f.execs[0]!.cmd[2]!.includes('--user-data-dir=/tmp/nm-browser/person-u1'));
  assert.deepEqual((await c.cdp.send('Target.getTargets')), {});
  await c.close();
  assert.ok(f.methods.includes('Browser.close'));
  assert.deepEqual(f.signals.map((s) => s[1]), ['KILL']);
  assert.deepEqual(f.waits, [['/bin/rm', '-rf', '--', '/tmp/nm-browser/person-u1']]);
});

test('a member machine keeps the person profile: the close removes nothing', { timeout: 20_000 }, async () => {
  const f = fakeBox();
  const launch = createBoxChromiumLauncher({ box: () => f.box, proxyHost: '172.20.0.1', keepPersonProfiles: true });
  const c = await launch({ bin: '/usr/bin/chromium', profileDir: '/nm/state/browser/person-u1', proxyPort: 4000, width: 800, height: 600 });
  assert.ok(f.execs[0]!.cmd[2]!.includes(`--user-data-dir=${BOX_BROWSER_KEEP}/person-u1`));
  await c.close();
  assert.deepEqual(f.waits, []);
});

test('a browser that never answers fails with its own words, and leaves no profile behind', { timeout: 20_000 }, async () => {
  const f = fakeBox({ answer: false });
  const launch = createBoxChromiumLauncher({ box: () => f.box, proxyHost: '172.20.0.1', keepPersonProfiles: false });
  // cdpOverPipe's 30 s timeout is too long for a test: the fake's stderr and a short wait stand in
  const started = launch({ bin: '/usr/bin/chromium', profileDir: '/tmp/nm-agent-browser-x', proxyPort: 4000, width: 800, height: 600 });
  setTimeout(() => f.execs[0]!.child.kill(), 50);
  await assert.rejects(started, /Chromium did not start in the box: chromium: cannot open display/);
  assert.deepEqual(f.waits, [['/bin/rm', '-rf', '--', '/tmp/nm-browser/nm-agent-browser-x']]);
});

test('with the box down the launch is refused with the reason, and never falls back to the supervisor', { timeout: 20_000 }, async () => {
  const launch = createBoxChromiumLauncher({ box: () => null, boxDown: () => 'the box died under exec', proxyHost: '172.20.0.1', keepPersonProfiles: false });
  await assert.rejects(launch({ bin: '/usr/bin/chromium', profileDir: '/p/person-u', proxyPort: 1, width: 800, height: 600 }), /the agent box is down \(the box died under exec\)/);
});

test('the real in-box shell line: CDP crosses on stdin and stdout through 3<&0 4>&1', { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-box-browser-'));
  let stand: ChildProcess | null = null;
  try {
    // a stand-in browser: it reads CDP on fd 3 and answers on fd 4 only, and prints noise on fd 1. It ends
    // with SIGKILL, because process.exit waits on the thread-pool read that still blocks on fd 3
    const fake = join(dir, 'fake-chromium.mjs');
    writeFileSync(fake, [
      "import { createReadStream, createWriteStream } from 'node:fs';",
      "process.stdout.write('noise that must not reach the pipe\\n');",
      "const out = createWriteStream(null, { fd: 4 }); let held = '';",
      "createReadStream(null, { fd: 3 }).on('data', (b) => { held += b; let n; while ((n = held.indexOf('\\0')) !== -1) { const m = JSON.parse(held.slice(0, n)); held = held.slice(n + 1);",
      "  out.write(JSON.stringify({ id: m.id, result: { method: m.method, argv: process.argv.slice(2) } }) + '\\0'); if (m.method === 'Browser.close') setTimeout(() => process.kill(process.pid, 'SIGKILL'), 50); } });",
    ].join('\n'));
    const bin = join(dir, 'chromium');
    writeFileSync(bin, `#!/bin/sh\nexec ${process.execPath} ${fake} "$@"\n`, { mode: 0o755 });
    const cmd = boxChromiumCommand({ bin, profileDir: join(dir, 'profile'), proxyPort: 41234, proxyHost: '172.20.0.1', width: 800, height: 600 });
    // stderr is ignored: an unread stderr pipe never ends, and the child's 'close' waits for it
    const child = spawn(cmd[0]!, cmd.slice(1), { stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: '/usr/bin:/bin' } });
    stand = child;
    const cdp = cdpOverPipe(child.stdin as Writable, child.stdout as Readable, 10_000);
    const v = await cdp.send<{ method: string; argv: string[] }>('Browser.getVersion');
    assert.equal(v.method, 'Browser.getVersion');
    assert.ok(v.argv.includes('--remote-debugging-pipe'));
    await cdp.send('Browser.close');
    // the stand-in exits on Browser.close. 'exit', not 'close': the test needs the process gone, and the
    // pipe this side still holds open is not the point. A stand-in that lingers is killed below
    const exited = await Promise.race([new Promise<boolean>((r) => child.once('exit', () => r(true))), sleep(5_000).then(() => false)]);
    cdp.close();
    assert.ok(exited, 'the stand-in browser exits on Browser.close');
  } finally {
    // a stand-in that is still alive would hold the test file open
    if (stand && stand.exitCode === null && stand.signalCode === null) stand.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('previews: refused while the browser is in the supervisor, and only loopback dev ports in the box', { timeout: 20_000 }, () => {
  setLoopbackPreview(false);
  assert.equal(checkUrl('http://localhost:5173/').ok, false);
  setLoopbackPreview(true);
  for (const ok of ['http://localhost:5173/', 'http://127.0.0.1:3000/app', 'http://[::1]:8080/', 'https://localhost:4443/']) assert.equal(checkUrl(ok).ok, true, ok);
  for (const no of ['http://localhost/', 'http://localhost:80/', 'http://127.0.0.1:22/', 'http://127.0.0.2:5173/', 'http://169.254.169.254/', 'http://172.20.0.1:4000/', 'http://user:pw@localhost:5173/', 'file:///proc/1/environ']) assert.equal(checkUrl(no).ok, false, no);
  assert.equal(isPreviewUrl(new URL('http://localhost:5173/')), true);
  setLoopbackPreview(false);
  assert.equal(isPreviewUrl(new URL('http://localhost:5173/')), false);
});

test('with the box link the browser goes through the egress proxy on the box loopback; with the link down it goes direct', { timeout: 20_000 }, async () => {
  const f = fakeBox();
  const asked: number[] = [];
  const lines: string[] = [];
  let up = true;
  const launch = createBoxChromiumLauncher({
    box: () => f.box, proxyHost: '172.20.0.1', keepPersonProfiles: false, log: (l) => lines.push(l),
    proxyVia: async (port) => { asked.push(port); if (!up) throw new Error('the box link is down'); return 45003; },
  });
  const a = await launch({ bin: '/usr/bin/chromium', profileDir: '/p/agent-a', proxyPort: 4000, width: 800, height: 600 });
  const viaLink = f.execs[0]!.cmd[2]!;
  assert.ok(viaLink.includes("'--proxy-server=http://127.0.0.1:45003'"), viaLink);
  assert.ok(!viaLink.includes('172.20.0.1'), 'never the veth IP');
  assert.deepEqual(asked, [4000], 'the link opens the supervisor proxy port');
  assert.ok(lines.some((l) => l.includes('route=proxy 127.0.0.1:45003')));
  await a.close();
  up = false;
  const b = await launch({ bin: '/usr/bin/chromium', profileDir: '/p/agent-b', proxyPort: 4000, width: 800, height: 600 });
  assert.ok(!f.execs[1]!.cmd[2]!.includes('--proxy-server'), 'direct when the link is down');
  assert.ok(lines.some((l) => l.includes('browser_box_proxy unavailable, direct: the box link is down')));
  await b.close();
});
