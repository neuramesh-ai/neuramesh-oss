// the browser service with a scripted launcher. what it must hold: nothing starts until someone
// asks, each member gets a browser of their own with a profile on the state volume, the agents get
// one browser on a throwaway profile that no person shares, agent calls take turns, and a browser
// nobody watches or calls stops after the idle time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createBrowserService, MAX_PERSON_BROWSERS, type ServiceOpts } from './service';
import type { Chromium, LaunchOpts } from './chromium';
import type { BrowserPage } from './page';

function harness(extra: Partial<ServiceOpts> = {}) {
  const launches: LaunchOpts[] = [];
  const closed: string[] = [];
  const opts: ServiceOpts = {
    bin: '/usr/bin/chromium',
    stateDir: '/nm/state',
    proxy: async () => ({ port: 4321, lastRefusal: () => ({ host: '10.0.0.1', reason: '10.0.0.1 is a private or local address', at: 1 }), close: async () => {} }),
    launch: async (o) => {
      launches.push(o);
      let exit: () => void = () => {};
      const exited = new Promise<void>((r) => { exit = r; });
      return { cdp: {} as Chromium['cdp'], exited, close: async () => { closed.push(o.profileDir); exit(); } } satisfies Chromium;
    },
    openPage: async (_c, tab) => ({ tab, dispose() {}, state: { url: 'about:blank' } }) as unknown as BrowserPage,
    ...extra,
  };
  return { svc: createBrowserService(opts), launches, closed };
}

test('nothing starts until someone asks, and each member gets their own browser on the state volume', async () => {
  const { svc, launches } = harness();
  assert.equal(launches.length, 0);
  const a = await svc.person('user-a', { width: 900, height: 700 });
  const again = await svc.person('user-a', { width: 900, height: 700 });
  const b = await svc.person('user-b', { width: 900, height: 700 });
  assert.equal(launches.length, 2, 'one browser for user-a, reused, and one for user-b');
  assert.equal(launches[0]!.profileDir, join('/nm/state', 'browser', 'person-user-a'));
  assert.equal(launches[1]!.profileDir, join('/nm/state', 'browser', 'person-user-b'));
  assert.equal(launches[0]!.proxyPort, 4321, 'every browser leaves through the egress proxy');
  assert.equal(a.page, again.page);
  assert.notEqual(a.page, b.page);
  a.release(); again.release(); b.release();
  await svc.close();
});

test('an actor id never escapes the browser folder', async () => {
  const { svc, launches } = harness();
  (await svc.person('../../etc/x', { width: 800, height: 600 })).release();
  assert.equal(launches[0]!.profileDir, join('/nm/state', 'browser', 'person-______etc_x'));
  await svc.close();
});

test('the agents get one browser on a throwaway profile, apart from every person, and the tab watchers see it come and go', async () => {
  const { svc, launches, closed } = harness();
  const seen: Array<[string | null, string | null]> = [];
  const stop = svc.watchAgent((p, who) => seen.push([p ? (p as unknown as { tab: string }).tab : null, who]));
  assert.deepEqual(seen, [[null, null]], 'watching never starts the agents\' browser');
  const tab = await svc.withAgentPage('rex', async (page) => page.tab);
  assert.equal(tab, 'agent');
  assert.equal(launches.length, 1);
  const profile = launches[0]!.profileDir;
  assert.ok(!profile.startsWith('/nm/state'), `the agents' profile is not on the state volume: ${profile}`);
  assert.ok(existsSync(profile));
  assert.deepEqual(seen.at(-1), ['agent', 'rex']);
  assert.equal(svc.agentPage()?.tab, 'agent');
  stop();
  await svc.close();
  assert.ok(closed.includes(profile));
  assert.equal(existsSync(profile), false, 'the throwaway profile is gone with its browser');
});

test('agent calls take turns on the one page, and a call in flight is work for the meter', async () => {
  const { svc } = harness();
  const order: string[] = [];
  let release: () => void = () => {};
  const first = svc.withAgentPage('rex', async () => { order.push('first start'); await new Promise<void>((r) => { release = r; }); order.push('first end'); });
  const second = svc.withAgentPage('patch', async () => { order.push('second'); });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(svc.busy(), true);
  assert.deepEqual(order, ['first start']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first start', 'first end', 'second']);
  assert.equal(svc.busy(), false);
  svc.touch();
  assert.equal(svc.busy(), true, 'a person\'s input in the last minute counts');
  assert.equal(svc.lastRefusal()?.host, '10.0.0.1');
  await svc.close();
});

test('a held browser stays up, and one nobody holds stops after the idle time', async () => {
  const { svc, closed } = harness({ idleMs: 40 });
  const held = await svc.person('user-a', { width: 800, height: 600 });
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(closed, [], 'a viewer holds it');
  held.release();
  await new Promise((r) => setTimeout(r, 160));
  assert.deepEqual(closed, [join('/nm/state', 'browser', 'person-user-a')]);
  await svc.withAgentPage('rex', async () => {});
  await new Promise((r) => setTimeout(r, 160));
  assert.equal(closed.length, 2, 'the agents\' browser idles out too');
  assert.equal(svc.agentPage(), null);
  await svc.close();
});

test('a machine runs a bounded number of person browsers, and says so', async () => {
  const { svc } = harness();
  for (let i = 0; i < MAX_PERSON_BROWSERS; i += 1) (await svc.person(`user-${i}`, { width: 800, height: 600 })).release();
  await assert.rejects(svc.person('one-more', { width: 800, height: 600 }), /full/);
  await svc.close();
});
