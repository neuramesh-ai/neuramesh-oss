// the agents' browser tools against a scripted service and page. what every answer must do: exist
// only where a browser does, refuse a private or non-web address before any navigation, say plainly
// when a site blocked the visit, never hand back an unbounded page, and save a screenshot through
// the turn's own artifact path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webToolsFor, WEB_TEXT_BUDGET } from './agent-tools';
import { resolveAllowed } from './address-guard';
import type { BrowserService } from './service';
import type { BrowserPage, PageState } from './page';

class ScriptedPage {
  st: PageState = { url: 'about:blank', title: '', canBack: false, canForward: false, loading: false };
  doc: { status: number; refused: string | null } | null = null;
  calls: string[] = [];
  body = 'Hello world';
  status = 200;
  hit: unknown = { x: 40, y: 50, label: 'Sign in' };
  get state() { return { ...this.st }; }
  async navigate(url: string) {
    this.calls.push(`navigate ${url}`);
    if (url.includes('unreachable')) return { ok: false as const, reason: 'the address was refused, or the site cannot be reached' };
    this.st = { ...this.st, url, title: 'A page' };
    this.doc = { status: this.status, refused: null };
    return { ok: true as const };
  }
  async loadingWithin() { return false; }
  async settled() {}
  async evaluate(expression: string) {
    if (expression.includes('innerText : \'\'')) return { title: this.st.title, url: this.st.url, text: this.body };
    if (expression.includes('querySelectorAll')) return this.hit;
    if (expression.includes('activeElement')) return expression.includes('"#missing"') ? 'missing' : 'ok';
    return undefined;
  }
  async mouse(type: string, x: number, y: number) { this.calls.push(`mouse ${type} ${x},${y}`); }
  async key(type: string, key: string) { this.calls.push(`key ${type} ${key}`); }
  async insertText(text: string) { this.calls.push(`text ${text}`); }
  async screenshot() { return { data: Buffer.from('png-bytes'), mime: 'image/png' as const }; }
}

function service(page: ScriptedPage, opened = true) {
  let started = opened;
  const names: string[] = [];
  const svc = {
    agentPage: () => (started ? (page as unknown as BrowserPage) : null),
    async withAgentPage<T>(name: string, fn: (p: BrowserPage) => Promise<T>) { started = true; names.push(name); return fn(page as unknown as BrowserPage); },
    lastRefusal: () => null,
    allowed: (host: string) => resolveAllowed(host),
  } as unknown as BrowserService;
  return { svc, names };
}

const logs: string[] = [];
const ctx = (attach: (image: Buffer, name: string, mime: string) => Promise<string | null> = async (_image, name) => name) => ({ agentName: 'rex', log: (r: { summary: string }) => logs.push(r.summary), attach, savedWhere: 'The person sees it in this thread.' });

test('no browser on this machine, no tools: the registries offer nothing that could only refuse', () => {
  assert.equal(webToolsFor(ctx(), null), undefined);
});

test('web_open refuses a private or non-web address before any navigation, and says why', async () => {
  const page = new ScriptedPage();
  const web = webToolsFor(ctx(), service(page).svc)!;
  for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://localhost:3000', 'file:///etc/passwd', 'http://metadata.google.internal/', 'https://10.0.0.5/']) {
    assert.match(await web.open({ url }), /^The address was refused: .+ NeuraMesh opens only public web addresses/, url);
  }
  assert.deepEqual(page.calls, [], 'no refused address reached the browser');
  assert.ok(logs.some((l) => l.startsWith('web_open refused:')));
});

test('web_open returns the title, the final address and the text cut to a budget, and logs the call', async () => {
  const page = new ScriptedPage();
  page.body = `${'word '.repeat(WEB_TEXT_BUDGET)}tail`;
  const { svc, names } = service(page, false);
  const web = webToolsFor(ctx(), svc)!;
  const out = await web.open({ url: '93.184.216.34/docs' });
  assert.deepEqual(page.calls, ['navigate https://93.184.216.34/docs']);
  assert.match(out, /^Title: A page\nAddress: https:\/\/93\.184\.216\.34\/docs\n\n/);
  assert.ok(out.length < WEB_TEXT_BUDGET + 200);
  assert.match(out, /The text stops at character 12,000 of 60,004\. Call web_read with from 12000 for more\./);
  const page2 = await web.read({ from: 60_000 });
  assert.match(page2, /\n\ntail$/, 'the second read starts where the first stopped');
  assert.deepEqual(names, ['rex', 'rex'], 'both calls ran on the agents\' browser, as rex');
  assert.ok(logs.includes('web_open 93.184.216.34/docs'));
});

test('a site that blocks the visit is said plainly, and a failed load says it did not open', async () => {
  const page = new ScriptedPage();
  page.status = 403;
  const web = webToolsFor(ctx(), service(page).svc)!;
  assert.match(await web.open({ url: 'https://93.184.216.34/' }), /^The site blocked the visit \(HTTP 403\)\. Tell the person/);
  assert.equal(await web.open({ url: 'https://93.184.216.34/unreachable' }), 'The page did not open: the address was refused, or the site cannot be reached.');
});

test('read, click and type need an open page, and each says what it did', async () => {
  const page = new ScriptedPage();
  const closed = webToolsFor(ctx(), service(page, false).svc)!;
  assert.equal(await closed.read(), 'No page is open. Open one with web_open first.');
  page.st = { ...page.st, url: 'https://93.184.216.34/', title: 'Home' };
  const web = webToolsFor(ctx(), service(page).svc)!;
  assert.match(await web.read(), /^Title: Home\nAddress: https:\/\/93\.184\.216\.34\/\n\nHello world/);
  assert.match(await web.click({ text: 'Sign in' }), /^Clicked "Sign in"\. The page is now "Home"/);
  assert.deepEqual(page.calls.slice(-3), ['mouse move 40,50', 'mouse down 40,50', 'mouse up 40,50']);
  page.hit = null;
  assert.match(await web.click({ text: 'Nothing like this' }), /^No element matches the text "Nothing like this"/);
  assert.match(await web.click({}), /visible text of the element, or a CSS selector/);
  assert.match(await web.type({ selector: '#q', text: 'naïve query', submit: true }), /^Typed into #q and pressed Enter/);
  assert.deepEqual(page.calls.slice(-3), ['text naïve query', 'key down Enter', 'key up Enter']);
  assert.match(await web.type({ selector: '#missing', text: 'x' }), /^No field matches the selector #missing/);
  assert.equal(logs.some((l) => l.includes('naïve query')), false, 'typed text never reaches the log');
});

test('web_screenshot saves through the turn\'s artifact path and returns the name', async () => {
  const page = new ScriptedPage();
  page.st = { ...page.st, url: 'https://93.184.216.34/' };
  const saved: Array<[string, string]> = [];
  const web = webToolsFor(ctx(async (image, name) => { saved.push([image.toString(), name]); return name; }), service(page).svc)!;
  assert.equal(await web.screenshot({ name: '../pricing page.png' }), 'Saved the screenshot as pricing-page.png. The person sees it in this thread.');
  assert.deepEqual(saved, [['png-bytes', 'pricing-page.png']]);
  const failing = webToolsFor(ctx(async () => null), service(page).svc)!;
  assert.match(await failing.screenshot({}), /did not save/);
});
