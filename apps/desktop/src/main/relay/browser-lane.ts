// the machine's half of the `browser` lane (models-and-replies round, board C3): a web panel's view
// of this machine's Chromium (browser/service.ts).
//
// one channel is one pane. its open names the tab and the pane's size, and the hub stamps the user
// it verified as `actorId`. that user picks the person's browser, so a pane only ever opens its own
// person's browser, whatever the client claims. the agent tab is view only, enforced here, whatever
// the pane sends. a viewer is not a session: it never counts toward sessionCount, so a tab left open
// does not keep a machine awake. a person who types does (service.busy, read by the heartbeat).
import { fromB64, MAX_CHANNEL_DATA_B64_CHARS, type ChannelFrame } from '@neuramesh/relay';
import { agentTabAllows, browserOpenMeta, parseBrowserInput, BROWSER_FRAME_WINDOW, type BrowserInput, type BrowserOutput, type BrowserTab } from '@neuramesh/shared';
import type { BrowserService } from '../browser/service';
import type { BrowserPage, Frame } from '../browser/page';
import { encodeLine, FramePacer } from './browser-frames';

export const MAX_BROWSER_VIEWERS = 4;
const MAX_INPUT_B64 = 8 * 1024;
type Send = (m: ChannelFrame) => void;

function createViewer(svc: BrowserService, ch: string, actorId: string, open: { tab: BrowserTab; width: number; height: number }, send: Send, log: (line: string) => void) {
  let tab = open.tab;
  let size = { width: open.width, height: open.height };
  let page: BrowserPage | null = null;
  let agent: string | null = null;
  let n = 0;
  let generation = 0;
  const holds: Array<() => void> = []; // what the current tab holds
  const binds: Array<() => void> = []; // what the current page holds

  const emit = (m: BrowserOutput): boolean => {
    const d = encodeLine(m, MAX_CHANNEL_DATA_B64_CHARS);
    if (d === null) return false;
    send({ ch, t: 'data', d });
    return true;
  };
  const pacer = new FramePacer<Frame>(BROWSER_FRAME_WINDOW, (f) => {
    if (emit({ t: 'frame', n: ++n, w: f.w, h: f.h, jpeg: f.jpeg })) return true;
    page?.shrink(); // too big for one data frame: the next frames go out smaller
    return false;
  });
  const state = (): void => {
    const who = tab === 'agent' && agent ? { agent } : {};
    if (!page) emit({ t: 'state', tab, url: '', title: '', canBack: false, canForward: false, loading: false, idle: true, ...who });
    else emit({ t: 'state', tab, ...page.state, ...who });
  };
  const unbind = (): void => { for (const fn of binds.splice(0)) fn(); page = null; pacer.reset(); };
  const bind = (p: BrowserPage): void => {
    unbind();
    page = p;
    binds.push(p.watchState(state), p.watchFrames((f) => pacer.push(f)), p.onGone(() => {
      if (page !== p) return;
      unbind();
      emit({ t: 'notice', text: 'The browser on your cloud machine stopped.' });
      state();
    }));
    state();
  };

  const attach = async (): Promise<void> => {
    const mine = ++generation;
    for (const fn of holds.splice(0)) fn();
    unbind();
    if (tab === 'agent') {
      holds.push(svc.watchAgent((p, who) => { agent = who; if (p) bind(p); else { unbind(); state(); } }));
      return;
    }
    try {
      const held = await svc.person(actorId, size);
      if (mine !== generation) { held.release(); return; }
      holds.push(held.release);
      bind(held.page);
      await held.page.resize(size.width, size.height).catch(() => {});
    } catch (e) {
      if (mine === generation) { emit({ t: 'notice', text: e instanceof Error ? e.message : String(e) }); state(); }
    }
  };
  const run = (work: Promise<unknown>): void => { void work.catch((e: unknown) => log(`browser_input_failed ch=${ch}: ${String(e)}`)); };

  return {
    start: attach,
    input(m: BrowserInput): void {
      if (m.t === 'ack') { pacer.ack(); return; }
      if (m.t === 'tab') { if (m.tab !== tab) { tab = m.tab; void attach(); } return; }
      if (tab === 'agent' && !agentTabAllows(m)) return; // the panel watches what an agent does, it never steers it
      const p = page;
      if (!p) return;
      svc.touch();
      switch (m.t) {
        case 'navigate': run(p.navigate(m.url).then((r) => { if (!r.ok) emit({ t: 'notice', text: `That page did not open: ${r.reason}.` }); })); return;
        case 'back': run(p.go(-1)); return;
        case 'forward': run(p.go(1)); return;
        case 'reload': run(p.reload()); return;
        case 'mouse': run(p.mouse(m.type, m.x, m.y, m.button, m.clicks, m.mods)); return;
        case 'wheel': run(p.wheel(m.x, m.y, m.dx, m.dy, m.mods)); return;
        case 'key': run(p.key(m.type, m.key, m.code, m.keyCode, m.mods)); return;
        case 'text': run(p.insertText(m.text)); return;
        case 'resize': size = { width: m.width, height: m.height }; run(p.resize(m.width, m.height));
      }
    },
    close(): void { generation += 1; for (const fn of holds.splice(0)) fn(); unbind(); },
  };
}

export function createBrowserLane(svc: BrowserService | undefined, log: (line: string) => void) {
  const viewers = new Map<string, ReturnType<typeof createViewer>>();
  return {
    has: (ch: string): boolean => viewers.has(ch),

    open(frame: ChannelFrame, send: Send): void {
      if (viewers.has(frame.ch)) return;
      const meta = browserOpenMeta(frame.meta);
      // the hub injects the attach verdict's user: without one there is no person to pick a browser for
      if (!svc || !meta || typeof frame.actorId !== 'string' || !frame.actorId || viewers.size >= MAX_BROWSER_VIEWERS) {
        send({ ch: frame.ch, t: 'close' });
        return;
      }
      const v = createViewer(svc, frame.ch, frame.actorId, meta, send, log);
      viewers.set(frame.ch, v);
      void v.start();
      log(`browser_open ch=${frame.ch} tab=${meta.tab} viewers=${viewers.size}`);
    },

    /** a data or close frame on a browser channel: one JSON message per data frame, and anything
     *  this wire does not speak is contained to its channel */
    frame(m: ChannelFrame): void {
      const v = viewers.get(m.ch);
      if (!v) return;
      if (m.t === 'close') { v.close(); viewers.delete(m.ch); return; }
      if (m.t !== 'data' || typeof m.d !== 'string' || m.d.length > MAX_INPUT_B64) return;
      let input: BrowserInput | null = null;
      try { input = parseBrowserInput(JSON.parse(fromB64(m.d).toString('utf8'))); } catch { /* malformed lane data stays in its channel */ }
      if (input) v.input(input);
    },

    /** the relay socket died: every viewer died with it (the panes redial) */
    stopAll(): void { for (const v of viewers.values()) v.close(); viewers.clear(); },
  };
}
