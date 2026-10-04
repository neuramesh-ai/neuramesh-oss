// the machine's browser service (models-and-replies round, board C3): Chromium on a cloud machine,
// for two kinds of user that never share a browser.
//
//   · the person: one browser per member who opens the panel, keyed by the actor the relay verified
//     (never a name the client sends), with a profile on the state volume. their sign-ins stay on
//     their machine and survive its next wake. a teammate who opens the panel on the same machine
//     gets a browser of their own, never this one.
//   · the agents: one browser, a fresh profile in a temporary folder, no cookies from anyone. the
//     web_* tools drive it one call at a time, and the panel can only watch it.
//
// started lazily (a machine that nobody browses runs no Chromium) and stopped after IDLE_MS with no
// viewer and no agent call. machined.ts creates it on a cloud machine only. nothing here imports
// Electron: the desktop app never constructs this module.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserTab } from '@neuramesh/shared';
import { resolveAllowed, type Resolved } from './address-guard';
import { launchChromium, type Chromium, type LaunchOpts } from './chromium';
import { startEgressProxy, type EgressProxy } from './egress-proxy';
import { BrowserPage } from './page';

export const IDLE_MS = 5 * 60_000;
export const MAX_PERSON_BROWSERS = 3;
const AGENT_VIEWPORT = { width: 1280, height: 800 };
const BUSY_MS = 60_000;

export interface BrowserService {
  /** the person's own browser, started on first use and held until release */
  person(actorId: string, size: { width: number; height: number }): Promise<{ page: BrowserPage; release(): void }>;
  /** the agents' browser as it comes and goes, and who drove it last. it never starts one */
  watchAgent(fn: (page: BrowserPage | null, agent: string | null) => void): () => void;
  /** the agents' browser if one runs, for a read that must not start it */
  agentPage(): BrowserPage | null;
  /** run one agent call on the agents' browser, starting it when none runs. calls take turns */
  withAgentPage<T>(agentName: string, fn: (page: BrowserPage) => Promise<T>): Promise<T>;
  /** the guard the egress proxy runs, for a tool to check an address before it navigates */
  allowed(host: string): Promise<Resolved>;
  /** the egress proxy's newest refusal, so a tool can say why a page failed */
  lastRefusal(): { host: string; reason: string; at: number } | null;
  /** a person's input in the last minute or an agent call in flight: the activity meter counts it */
  busy(): boolean;
  touch(): void;
  close(): Promise<void>;
}

interface Entry { ready: Promise<{ chromium: Chromium; page: BrowserPage }>; holds: number; lastUse: number; temp: string | null }

export interface ServiceOpts {
  bin: string;
  stateDir: string;
  log?: (line: string) => void;
  idleMs?: number;
  /** the address check (address-guard.ts resolveAllowed). a test points a name at its own server */
  resolve?: (host: string) => Promise<Resolved>;
  /** seams for the tests: a fake launcher and a fake proxy */
  launch?: (o: LaunchOpts) => Promise<Chromium>;
  proxy?: () => Promise<EgressProxy>;
  openPage?: (chromium: Chromium, tab: BrowserTab, size: { width: number; height: number }) => Promise<BrowserPage>;
}

const safe = (actorId: string): string => actorId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'person';

export function createBrowserService(o: ServiceOpts): BrowserService {
  const log = o.log ?? (() => {});
  const launch = o.launch ?? launchChromium;
  const openPage = o.openPage ?? ((c, tab, size) => BrowserPage.open(c.cdp, tab, size));
  const idleMs = o.idleMs ?? IDLE_MS;
  const resolve = o.resolve ?? ((host: string) => resolveAllowed(host));
  const people = new Map<string, Entry>();
  let agent: Entry | null = null;
  let agentLive: BrowserPage | null = null;
  let agentName: string | null = null;
  let agentQueue: Promise<unknown> = Promise.resolve();
  let agentCalls = 0;
  let lastInput = 0;
  let proxy: Promise<EgressProxy> | null = null;
  let proxyLive: EgressProxy | null = null;
  const watchers = new Set<(page: BrowserPage | null, agent: string | null) => void>();

  const ensureProxy = (): Promise<EgressProxy> => (proxy ??= (o.proxy ?? (() => startEgressProxy({ resolve, log: (l) => log(`egress ${l}`) })))().then((p) => (proxyLive = p)));

  const start = (tab: BrowserTab, profileDir: string, size: { width: number; height: number }, temp: string | null): Entry => {
    const entry: Entry = { holds: 0, lastUse: Date.now(), temp, ready: (async () => {
      const p = await ensureProxy();
      const chromium = await launch({ bin: o.bin, profileDir, proxyPort: p.port, ...size });
      const page = await openPage(chromium, tab, size).catch(async (e: unknown) => { await chromium.close(); throw e; });
      log(`browser_start tab=${tab}`);
      return { chromium, page };
    })() };
    return entry;
  };

  const stop = async (entry: Entry, why: string): Promise<void> => {
    const live = await entry.ready.catch(() => null);
    if (live) { live.page.dispose(); await live.chromium.close().catch(() => {}); }
    if (entry.temp) rmSync(entry.temp, { recursive: true, force: true });
    log(`browser_stop ${why}`);
  };

  const forgetAgent = (): void => { agent = null; agentLive = null; for (const fn of watchers) fn(null, agentName); };

  const startAgent = (): Entry => {
    const temp = mkdtempSync(join(tmpdir(), 'nm-agent-browser-'));
    const entry = start('agent', temp, AGENT_VIEWPORT, temp);
    agent = entry;
    void entry.ready.then(({ chromium, page }) => {
      if (agent !== entry) return;
      agentLive = page;
      for (const fn of watchers) fn(page, agentName);
      void chromium.exited.then(() => { if (agent === entry) { forgetAgent(); void stop(entry, 'tab=agent exited'); } });
    }, () => { if (agent === entry) forgetAgent(); void stop(entry, 'tab=agent failed'); });
    return entry;
  };

  // the idle sweep: a browser nobody watches and nobody called for IDLE_MS stops
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [actor, entry] of people) {
      if (entry.holds === 0 && now - entry.lastUse > idleMs) { people.delete(actor); void stop(entry, 'tab=person idle'); }
    }
    // the agent tab's viewers hold the agents' browser, whichever process is the current one
    if (agent && watchers.size === 0 && agentCalls === 0 && now - agent.lastUse > idleMs) { const entry = agent; forgetAgent(); void stop(entry, 'tab=agent idle'); }
  }, Math.min(30_000, idleMs));
  sweep.unref?.();

  return {
    async person(actorId, size) {
      let entry = people.get(actorId);
      if (!entry) {
        if (people.size >= MAX_PERSON_BROWSERS) throw new Error('The browser on this cloud machine is full. Try again in a few minutes.');
        entry = start('person', join(o.stateDir, 'browser', `person-${safe(actorId)}`), size, null);
        people.set(actorId, entry);
        const mine = entry;
        void mine.ready.then(({ chromium }) => chromium.exited.then(() => { if (people.get(actorId) === mine) { people.delete(actorId); void stop(mine, 'tab=person exited'); } }),
          () => { if (people.get(actorId) === mine) people.delete(actorId); });
      }
      entry.holds += 1;
      entry.lastUse = Date.now();
      const held = entry;
      try {
        const { page } = await held.ready;
        let released = false;
        return { page, release: () => { if (released) return; released = true; held.holds -= 1; held.lastUse = Date.now(); } };
      } catch (e) {
        held.holds -= 1;
        throw new Error(`The browser did not start on your cloud machine: ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    watchAgent(fn) {
      watchers.add(fn);
      fn(agentLive, agentName);
      return () => { if (watchers.delete(fn) && agent) agent.lastUse = Date.now(); };
    },

    agentPage: () => agentLive,

    withAgentPage(name, fn) {
      const run = async () => {
        agentCalls += 1;
        try {
          agentName = name;
          const entry = agent ?? startAgent();
          entry.lastUse = Date.now();
          const { page } = await entry.ready;
          return await fn(page);
        } finally { agentCalls -= 1; if (agent) agent.lastUse = Date.now(); }
      };
      const next = agentQueue.then(run, run);
      agentQueue = next.catch(() => {});
      return next;
    },

    allowed: resolve,
    lastRefusal: () => proxyLive?.lastRefusal() ?? null,
    busy: () => agentCalls > 0 || Date.now() - lastInput < BUSY_MS,
    touch: () => { lastInput = Date.now(); },

    async close() {
      clearInterval(sweep);
      const all = [...people.values(), ...(agent ? [agent] : [])];
      people.clear();
      agent = null;
      await Promise.all(all.map((e) => stop(e, 'closing')));
      const p = await proxy?.catch(() => null);
      await p?.close();
    },
  };
}
