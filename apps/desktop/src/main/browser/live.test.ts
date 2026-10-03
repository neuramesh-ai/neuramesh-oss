// the browser service against a real chromium, end to end: the pipe, the screencast, the address
// guard, the egress proxy, the two profiles and the agent tools. it runs where a browser binary is
// named (NM_CHROMIUM, or Debian's /usr/bin/chromium in the machine image) and skips elsewhere, so a
// CI runner with no Chromium stays green and a laptop proves it with one variable:
//
//   NM_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm exec tsx --test src/main/browser/live.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromiumBin } from './chromium';
import { resolveAllowed } from './address-guard';
import { createBrowserService, type BrowserService } from './service';
import { webToolsFor } from './agent-tools';
import type { Frame } from './page';

const bin = chromiumBin();
const skip = bin ? false : 'no Chromium on this machine (set NM_CHROMIUM to run it)';
const state = mkdtempSync(join(tmpdir(), 'nm-browser-live-'));
let site: Server | null = null;
let svc: BrowserService | null = null;
after(async () => { await svc?.close(); site?.close(); rmSync(state, { recursive: true, force: true }); });

// the "site": a cookie it sets, a cookie it echoes, a link, a form, and a redirect to loopback
async function startSite(): Promise<number> {
  site = createServer((req, res) => {
    const page = (title: string, body: string, extra: Record<string, string> = {}) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...extra }); res.end(`<!doctype html><title>${title}</title><body style="background:#e8f0ff"><main>${body}</main></body>`); };
    if (req.url === '/login') return page('Signed in', '<h1>Welcome back</h1>', { 'set-cookie': 'session=person-secret; Path=/' });
    if (req.url === '/whoami') return page('Who', `<p id="who">cookie=${req.headers.cookie ?? 'none'}</p>`);
    if (req.url === '/next') return page('Next page', '<h1>The second page</h1>');
    if (req.url?.startsWith('/search')) return page('Results', `<h1>Results for ${new URL(req.url, 'http://x').searchParams.get('q')}</h1>`);
    if (req.url === '/to-loopback') { res.writeHead(302, { location: `http://localhost:${(site!.address() as AddressInfo).port}/secret` }); return res.end(); }
    if (req.url === '/popup') return page('Popup home', '<a href="/next" target="_blank" rel="noopener">Open the next page in a new tab</a>');
    return page('Docs home', '<h1>Routines</h1><p>A routine is a prompt that runs on a schedule.</p><a href="/next">Next</a><form action="/search"><input id="q" name="q"></form>');
  });
  await new Promise<void>((r) => site!.listen(0, '127.0.0.1', () => r()));
  return (site.address() as AddressInfo).port;
}

const nextFrame = (watch: (fn: (f: Frame) => void) => () => void, ms = 15_000): Promise<Frame> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { stop(); reject(new Error('no screencast frame')); }, ms);
  const stop = watch((f) => { clearTimeout(timer); stop(); resolve(f); });
});

test('a real Chromium: frames, navigation, the address guard, two profiles, and the agent tools', { skip, timeout: 120_000 }, async () => {
  const port = await startSite();
  const base = `http://site.test:${port}`;
  // site.test stands for a public site: the test resolver points it at loopback, every other name
  // goes through the real guard, so the redirect to localhost below meets the real refusal
  svc = createBrowserService({ bin: bin!, stateDir: state, resolve: async (h) => (h === 'site.test' ? { ok: true, address: '127.0.0.1', family: 4 } : resolveAllowed(h)) });

  const person = await svc.person('user-a', { width: 800, height: 600 });
  // a viewer that stays, as the panel does: the last viewer to leave stops the screencast
  const frames: Frame[] = [];
  const stopWatch = person.page.watchFrames((f) => frames.push(f));
  const first = await nextFrame((fn) => person.page.watchFrames(fn));
  assert.match(first.jpeg, /^\/9j\//, 'a JPEG screencast frame');
  assert.deepEqual([first.w, first.h], [800, 600]);

  const before = frames.length;
  assert.deepEqual(await person.page.navigate(`${base}/login`, 10_000), { ok: true });
  assert.equal(person.page.state.title, 'Signed in');
  // the screencast follows the page across the navigation to another site's process
  for (let i = 0; i < 100 && frames.length === before; i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.ok(frames.length > before, 'a frame of the new page arrived after the navigation');
  stopWatch();
  assert.deepEqual(await person.page.navigate('http://169.254.169.254/latest/meta-data/'), { ok: false, reason: '169.254.169.254 is a private or local address' });
  await person.page.navigate(`${base}/to-loopback`, 10_000);
  assert.match(person.page.doc?.refused ?? '', /localhost is a private or local name/, 'the redirect to loopback met the proxy');

  const web = webToolsFor({ agentName: 'rex', attach: async (_image, name) => name, savedWhere: 'The person sees it in this thread.' }, svc)!;
  const opened = await web.open({ url: `${base}/` });
  assert.match(opened, /^Title: Docs home\nAddress: http:\/\/site\.test:\d+\/\n\nRoutines/);
  // the agents' browser is another process on another profile: the person's cookie is not there
  assert.match(await web.open({ url: `${base}/whoami` }), /cookie=none/);
  await person.page.navigate(`${base}/whoami`, 10_000);
  assert.match(String(await person.page.evaluate('document.body.innerText')), /cookie=session=person-secret/);
  await web.open({ url: `${base}/` });
  assert.match(await web.click({ text: 'Next' }), /^Clicked "Next"\. The page is now "Next page"/);
  // a link to a new tab: the new tab becomes the front page, so the agent (and the panel) see it
  await web.open({ url: `${base}/popup` });
  await web.click({ text: 'Open the next page in a new tab' });
  for (let i = 0; i < 100 && svc.agentPage()?.state.title !== 'Next page'; i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.equal(svc.agentPage()?.state.title, 'Next page', 'the new tab is the front page');
  assert.match(await web.read(), /^Title: Next page/);
  await web.open({ url: `${base}/` });
  assert.match(await web.type({ selector: '#q', text: 'café', submit: true }), /pressed Enter\. The page is now "Results"/);
  assert.match(await web.read(), /Results for café/);
  assert.equal(await web.screenshot({ name: 'results' }), 'Saved the screenshot as results.png. The person sees it in this thread.');
  assert.match(await web.open({ url: 'http://localhost:9/' }), /^The address was refused/);
  person.release();
});
