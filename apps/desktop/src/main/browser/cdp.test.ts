// the CDP pipe client and the Chromium flags. the flags are the security half of the browser: a
// missing --remote-debugging-pipe means a port an agent's shell can reach, and a missing proxy flag
// means pages reach the cluster directly. neither breaks a single page, so both are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { cdpOverPipe } from './cdp';
import { chromiumArgs } from './chromium';

/** a scripted browser on the far side of two pipes */
function pipes() {
  const toBrowser = new PassThrough();
  const fromBrowser = new PassThrough();
  const seen: Array<{ id: number; method: string; sessionId?: string }> = [];
  let held = '';
  toBrowser.on('data', (d: Buffer) => {
    held += d.toString('utf8');
    for (let nul = held.indexOf('\0'); nul !== -1; nul = held.indexOf('\0')) {
      seen.push(JSON.parse(held.slice(0, nul)));
      held = held.slice(nul + 1);
    }
  });
  return { toBrowser, fromBrowser, seen };
}

test('commands carry ids and sessions, answers resolve them, and events reach every listener', async () => {
  const { toBrowser, fromBrowser, seen } = pipes();
  const cdp = cdpOverPipe(toBrowser, fromBrowser);
  const events: unknown[] = [];
  cdp.on((e) => events.push(e));
  const version = cdp.send('Browser.getVersion');
  const nav = cdp.send('Page.navigate', { url: 'https://x.com' }, 'S1');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(seen.map((m) => [m.id, m.method, m.sessionId]), [[1, 'Browser.getVersion', undefined], [2, 'Page.navigate', 'S1']]);
  fromBrowser.write(`${JSON.stringify({ id: 2, result: { frameId: 'F' } })}\0${JSON.stringify({ method: 'Page.loadEventFired', params: { timestamp: 1 }, sessionId: 'S1' })}\0`);
  fromBrowser.write(`${JSON.stringify({ id: 1, error: { message: 'nope' } })}\0`);
  assert.deepEqual(await nav, { frameId: 'F' });
  await assert.rejects(version, /nope/);
  assert.deepEqual(events, [{ method: 'Page.loadEventFired', params: { timestamp: 1 }, sessionId: 'S1' }]);
  cdp.close();
});

test('a message is cut at its NUL in the byte stream, so a character split across chunks arrives whole', async () => {
  const { toBrowser, fromBrowser } = pipes();
  const cdp = cdpOverPipe(toBrowser, fromBrowser);
  const titles: string[] = [];
  cdp.on((e) => titles.push(e.params.title));
  const bytes = Buffer.from(`${JSON.stringify({ method: 'Target.targetInfoChanged', params: { title: 'Café 日本 🙂' } })}\0`, 'utf8');
  const split = bytes.indexOf(Buffer.from('日')) + 1; // inside the three bytes of 日
  fromBrowser.write(bytes.subarray(0, split));
  fromBrowser.write(bytes.subarray(split));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(titles, ['Café 日本 🙂']);
  cdp.close();
});

test('a closed pipe rejects every pending command and every later one, and a silent browser times out', async () => {
  const { toBrowser, fromBrowser } = pipes();
  const cdp = cdpOverPipe(toBrowser, fromBrowser, 50);
  const slow = cdp.send('Page.reload');
  await assert.rejects(slow, /timed out/);
  const pending = cdp.send('Page.navigate', { url: 'https://a.com' });
  fromBrowser.destroy();
  await assert.rejects(pending, /closed/);
  await cdp.closed;
  await assert.rejects(cdp.send('Browser.getVersion'), /closed/);
});

test('Chromium runs headless with no sandbox, no port, every connection through the proxy, and no UDP', () => {
  const args = chromiumArgs({ profileDir: '/nm/state/browser/person-u1', proxyPort: 41234, width: 1280, height: 800 });
  for (const flag of ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-pipe', '--user-data-dir=/nm/state/browser/person-u1',
    '--proxy-server=http://127.0.0.1:41234', '--proxy-bypass-list=<-loopback>', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp']) {
    assert.ok(args.includes(flag), flag);
  }
  assert.equal(args.some((a) => a.startsWith('--remote-debugging-port')), false, 'a debugging port is reachable from every shell on the machine');
  assert.equal(args.some((a) => a.startsWith('--remote-debugging-address')), false);
});
