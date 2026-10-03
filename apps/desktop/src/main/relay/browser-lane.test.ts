// the machine's half of the browser lane, against a scripted service and page. what it must hold:
// a pane opens only with the hub's verified user, the person tab is that user's own browser, the
// agent tab cannot be steered from the panel, frames are paced by acks, and a frame too big for one
// data frame lowers the page's quality instead of reaching the hub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChannelFrame } from '@neuramesh/relay';
import type { BrowserOutput } from '@neuramesh/shared';
import { createBrowserLane, MAX_BROWSER_VIEWERS } from './browser-lane';
import type { BrowserService } from '../browser/service';
import type { BrowserPage, Frame, PageState } from '../browser/page';

class FakePage {
  st: PageState = { url: 'https://example.com/', title: 'Example', canBack: false, canForward: false, loading: false };
  calls: string[] = [];
  shrinks = 0;
  frameSinks = new Set<(f: Frame) => void>();
  stateSinks = new Set<() => void>();
  get state() { return { ...this.st }; }
  watchState(fn: () => void) { this.stateSinks.add(fn); return () => { this.stateSinks.delete(fn); }; }
  watchFrames(fn: (f: Frame) => void) { this.frameSinks.add(fn); return () => { this.frameSinks.delete(fn); }; }
  onGone() { return () => {}; }
  shrink() { this.shrinks += 1; }
  frame(f: Frame) { for (const fn of this.frameSinks) fn(f); }
  async resize(w: number, h: number) { this.calls.push(`resize ${w}x${h}`); }
  async navigate(url: string) { this.calls.push(`navigate ${url}`); return { ok: true as const }; }
  async go(d: number) { this.calls.push(`go ${d}`); }
  async reload() { this.calls.push('reload'); }
  async mouse(type: string, x: number, y: number) { this.calls.push(`mouse ${type} ${x},${y}`); }
  async wheel() { this.calls.push('wheel'); }
  async key(type: string, key: string) { this.calls.push(`key ${type} ${key}`); }
  async insertText(t: string) { this.calls.push(`text ${t}`); }
}

function fakeService() {
  const people = new Map<string, FakePage>();
  const agentPage = new FakePage();
  agentPage.st = { ...agentPage.st, url: 'https://news.example/', title: 'News' };
  const held: string[] = [];
  let touched = 0;
  const svc = {
    async person(actorId: string) {
      held.push(actorId);
      if (!people.has(actorId)) people.set(actorId, new FakePage());
      return { page: people.get(actorId)! as unknown as BrowserPage, release: () => { held.splice(held.indexOf(actorId), 1); } };
    },
    watchAgent(fn: (p: BrowserPage | null, agent: string | null) => void) { fn(agentPage as unknown as BrowserPage, 'rex'); return () => {}; },
    touch() { touched += 1; },
  } as unknown as BrowserService;
  return { svc, people, agentPage, held, touched: () => touched };
}

const b64 = (m: unknown): string => Buffer.from(JSON.stringify(m)).toString('base64');
const decode = (sent: ChannelFrame[]): BrowserOutput[] => sent.filter((f) => f.t === 'data').map((f) => JSON.parse(Buffer.from(f.d!, 'base64').toString('utf8')) as BrowserOutput);
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
const open = (ch: string, meta: unknown, actorId?: string): ChannelFrame => ({ ch, t: 'open', lane: 'browser', meta: meta as Record<string, unknown>, ...(actorId ? { actorId } : {}) });

test('a pane opens only with the hub\'s verified user and a meta this wire speaks', async () => {
  const { svc } = fakeService();
  const lane = createBrowserLane(svc, () => {});
  const sent: ChannelFrame[] = [];
  lane.open(open('b1', { v: 1, tab: 'person', width: 800, height: 600 }), (m) => sent.push(m));
  lane.open(open('b2', { v: 9, tab: 'person', width: 800, height: 600 }, 'u1'), (m) => sent.push(m));
  assert.deepEqual(sent, [{ ch: 'b1', t: 'close' }, { ch: 'b2', t: 'close' }]);
  const none = createBrowserLane(undefined, () => {});
  const refused: ChannelFrame[] = [];
  none.open(open('b3', { v: 1, tab: 'agent', width: 800, height: 600 }, 'u1'), (m) => refused.push(m));
  assert.deepEqual(refused, [{ ch: 'b3', t: 'close' }], 'a machine with no browser refuses the lane');
});

test('the person tab is the verified user\'s own browser, steered by the pane, and sized to it', async () => {
  const { svc, people, held } = fakeService();
  const lane = createBrowserLane(svc, () => {});
  const sent: ChannelFrame[] = [];
  lane.open(open('b1', { v: 1, tab: 'person', width: 900, height: 700 }, 'u1'), (m) => sent.push(m));
  await tick();
  assert.deepEqual(held, ['u1']);
  const page = people.get('u1')!;
  assert.deepEqual(page.calls, ['resize 900x700']);
  assert.deepEqual(decode(sent)[0], { t: 'state', tab: 'person', url: 'https://example.com/', title: 'Example', canBack: false, canForward: false, loading: false });
  lane.frame({ ch: 'b1', t: 'data', d: b64({ t: 'navigate', url: 'https://x.com' }) });
  lane.frame({ ch: 'b1', t: 'data', d: b64({ t: 'mouse', type: 'down', x: 10, y: 20, button: 'left', clicks: 1 }) });
  lane.frame({ ch: 'b1', t: 'data', d: b64({ t: 'key', type: 'down', key: 'é', code: 'KeyE', keyCode: 69 }) });
  lane.frame({ ch: 'b1', t: 'data', d: b64({ t: 'eval', code: 'steal()' }) });
  lane.frame({ ch: 'b1', t: 'data', d: 'not base64 json' });
  await tick();
  assert.deepEqual(page.calls, ['resize 900x700', 'navigate https://x.com', 'mouse down 10,20', 'key down é']);
  lane.frame({ ch: 'b1', t: 'close' });
  assert.deepEqual(held, [], 'closing the pane releases the browser');
});

test('the agent tab is view only: the panel switches to it and watches, and nothing it sends steers the page', async () => {
  const { svc, agentPage } = fakeService();
  const lane = createBrowserLane(svc, () => {});
  const sent: ChannelFrame[] = [];
  lane.open(open('b1', { v: 1, tab: 'agent', width: 800, height: 600 }, 'u1'), (m) => sent.push(m));
  await tick();
  assert.deepEqual(decode(sent)[0], { t: 'state', tab: 'agent', url: 'https://news.example/', title: 'News', canBack: false, canForward: false, loading: false, agent: 'rex' });
  for (const m of [{ t: 'navigate', url: 'https://evil.example' }, { t: 'mouse', type: 'down', x: 1, y: 1 }, { t: 'text', text: 'hi' }, { t: 'reload' }, { t: 'resize', width: 900, height: 700 }]) {
    lane.frame({ ch: 'b1', t: 'data', d: b64(m) });
  }
  await tick();
  assert.deepEqual(agentPage.calls, []);
});

test('frames are paced by acks, and a frame too big for one data frame shrinks the page instead of reaching the hub', async () => {
  const { svc, people } = fakeService();
  const lane = createBrowserLane(svc, () => {});
  const sent: ChannelFrame[] = [];
  lane.open(open('b1', { v: 1, tab: 'person', width: 800, height: 600 }, 'u1'), (m) => sent.push(m));
  await tick();
  const page = people.get('u1')!;
  const frames = () => decode(sent).filter((m) => m.t === 'frame') as Array<Extract<BrowserOutput, { t: 'frame' }>>;
  for (let i = 0; i < 5; i += 1) page.frame({ jpeg: `AAA${i}`, w: 800, h: 600 });
  assert.deepEqual(frames().map((f) => f.jpeg), ['AAA0', 'AAA1']);
  lane.frame({ ch: 'b1', t: 'data', d: b64({ t: 'ack', n: 1 }) });
  assert.deepEqual(frames().map((f) => f.jpeg), ['AAA0', 'AAA1', 'AAA4']);
  lane.frame({ ch: 'b1', t: 'data', d: b64({ t: 'ack', n: 2 }) });
  page.frame({ jpeg: 'A'.repeat(600_000), w: 800, h: 600 });
  assert.equal(frames().length, 3, 'the oversize frame never left');
  assert.equal(page.shrinks, 1);
  for (const f of sent) assert.ok((f.d ?? '').length <= 512 * 1024);
});

test('a machine serves at most its viewer budget', async () => {
  const { svc } = fakeService();
  const lane = createBrowserLane(svc, () => {});
  const sent: ChannelFrame[] = [];
  for (let i = 0; i <= MAX_BROWSER_VIEWERS; i += 1) lane.open(open(`b${i}`, { v: 1, tab: 'agent', width: 800, height: 600 }, 'u1'), (m) => sent.push(m));
  assert.deepEqual(sent.filter((f) => f.t === 'close'), [{ ch: `b${MAX_BROWSER_VIEWERS}`, t: 'close' }]);
  lane.stopAll();
});
