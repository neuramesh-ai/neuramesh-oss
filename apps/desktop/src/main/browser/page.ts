// one browser's front page (models-and-replies round, board C3): what the panel watches and steers,
// and what the agent tools drive.
//
// a browser here shows one front page. a new tab or a popup (a sign-in window) becomes the front
// page while it lives, and the page under it comes back when it closes, so a sign-in that needs its
// opener still works. navigation runs the address guard first (checkUrl), and the egress proxy then
// holds every request the page makes, redirects and subresources included.
import { BROWSER_QUALITY_STEPS, type BrowserTab } from '@neuramesh/shared';
import { checkUrl } from './address-guard';
import { REFUSED_HEADER } from './egress-proxy';
import type { Cdp, CdpEvent } from './cdp';

export interface Frame { jpeg: string; w: number; h: number }
export interface PageState { url: string; title: string; canBack: boolean; canForward: boolean; loading: boolean }
type Size = { width: number; height: number };
interface Target { targetId: string; sessionId: string }
interface History { currentIndex: number; entries: Array<{ id: number; url: string; title: string }> }

const SCALE_FLOOR = 0.4;
const BUTTONS: Record<string, number> = { left: 1, right: 2, middle: 4 };

/** a failed navigation, said the way a person reads it */
export function netErrorText(errorText: string): string {
  if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY/.test(errorText)) return 'the address was refused, or the site cannot be reached';
  if (/ERR_NAME_NOT_RESOLVED/.test(errorText)) return 'the name does not resolve';
  if (/TIMED_OUT/.test(errorText)) return 'the site did not answer in time';
  if (/ERR_ABORTED/.test(errorText)) return 'the page stopped loading';
  return `the page did not load (${errorText})`;
}

/** the text a key types: one printable character with no ctrl or meta, enter as a return, else none */
export function keyText(key: string, mods = 0): string | undefined {
  if (key === 'Enter') return '\r';
  if (mods & 6) return undefined;
  return [...key].length === 1 && key >= ' ' ? key : undefined;
}

export class BrowserPage {
  private stack: Target[] = [];
  private adopting = new Set<string>();
  private ready = false;
  private st: PageState = { url: 'about:blank', title: '', canBack: false, canForward: false, loading: false };
  private quality: number = BROWSER_QUALITY_STEPS[0];
  private scale = 1;
  private shrunkAt = 0;
  private readonly frames = new Set<(f: Frame) => void>();
  private readonly states = new Set<() => void>();
  private readonly gone = new Set<() => void>();
  private readonly loads = new Set<() => void>();
  private readonly off: () => void;
  last: Frame | null = null;
  /** the newest main document: its HTTP status, and the egress proxy's refusal when it wrote one */
  doc: { status: number; refused: string | null } | null = null;

  private constructor(private readonly cdp: Cdp, readonly tab: BrowserTab, private size: Size) {
    this.off = cdp.on((e) => this.onEvent(e));
    void cdp.closed.then(() => { for (const fn of this.gone) fn(); });
  }

  static async open(cdp: Cdp, tab: BrowserTab, size: Size): Promise<BrowserPage> {
    const page = new BrowserPage(cdp, tab, size);
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {}); // a page never writes a file onto the machine
    const { targetInfos } = await cdp.send<{ targetInfos: Array<{ targetId: string; type: string }> }>('Target.getTargets');
    const first = targetInfos.find((t) => t.type === 'page')?.targetId ?? (await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })).targetId;
    await page.adopt(first);
    page.ready = true;
    return page;
  }

  private get front(): Target | undefined { return this.stack[this.stack.length - 1]; }
  get state(): PageState { return { ...this.st }; }
  get viewport(): Size { return { ...this.size }; }
  private sendFront<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const front = this.front;
    return front ? this.cdp.send<T>(method, params, front.sessionId) : Promise.reject(new Error('the browser has no page'));
  }

  private async adopt(targetId: string): Promise<void> {
    if (this.adopting.has(targetId) || this.stack.some((t) => t.targetId === targetId)) return;
    this.adopting.add(targetId);
    try {
      const { sessionId } = await this.cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
      await Promise.all([
        this.cdp.send('Page.enable', {}, sessionId), this.cdp.send('Network.enable', {}, sessionId),
        this.cdp.send('Emulation.setDeviceMetricsOverride', { ...this.size, deviceScaleFactor: 1, mobile: false }, sessionId),
      ]);
      if (this.front && this.frames.size) await this.sendFront('Page.stopScreencast').catch(() => {});
      this.stack.push({ targetId, sessionId });
      await this.refresh();
      if (this.frames.size) await this.cast();
    } finally { this.adopting.delete(targetId); }
  }

  private drop(targetId: string): void {
    const wasFront = this.front?.targetId === targetId;
    this.stack = this.stack.filter((t) => t.targetId !== targetId);
    if (!wasFront) return;
    // the last page closed itself: a blank one takes its place, so the panel never goes dark
    if (!this.front) { void this.cdp.send('Target.createTarget', { url: 'about:blank' }).catch(() => {}); return; }
    void this.refresh().then(() => (this.frames.size ? this.cast() : undefined)).catch(() => {});
  }

  private onEvent(e: CdpEvent): void {
    const p = e.params;
    if (e.method === 'Target.targetCreated') { if (this.ready && p.targetInfo.type === 'page') void this.adopt(p.targetInfo.targetId).catch(() => {}); return; }
    if (e.method === 'Target.targetDestroyed') { this.drop(p.targetId); return; }
    const front = this.front;
    if (!front) return;
    if (e.method === 'Target.targetInfoChanged') {
      if (p.targetInfo.targetId === front.targetId) { this.st = { ...this.st, url: p.targetInfo.url, title: p.targetInfo.title }; this.emit(); }
      return;
    }
    if (e.sessionId === front.sessionId) this.onPageEvent(e.method, p, front);
  }

  /** an event from the front page's own session */
  private onPageEvent(method: string, p: any, front: Target): void {
    const main = p.frameId === front.targetId; // a page target's main frame shares its id
    switch (method) {
      case 'Page.screencastFrame': {
        void this.cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }, front.sessionId).catch(() => {});
        const frame = { jpeg: String(p.data), w: Math.round(p.metadata.deviceWidth), h: Math.round(p.metadata.deviceHeight) };
        this.last = frame;
        for (const fn of this.frames) fn(frame);
        return;
      }
      case 'Page.frameStartedLoading': if (main) { this.st = { ...this.st, loading: true }; this.emit(); } return;
      case 'Page.frameStoppedLoading':
        if (!main) return;
        this.st = { ...this.st, loading: false };
        // a waiter reads the title and the address, so it hears of the load after the refresh
        void this.refresh().finally(() => { for (const fn of [...this.loads]) fn(); });
        return;
      case 'Page.frameNavigated': if (!p.frame.parentId) void this.refresh(); return;
      case 'Page.navigatedWithinDocument': void this.refresh(); return;
      // a dialog blocks its page until answered, and nobody answers one here
      case 'Page.javascriptDialogOpening': void this.sendFront('Page.handleJavaScriptDialog', { accept: p.type === 'alert' || p.type === 'beforeunload' }).catch(() => {}); return;
      case 'Network.responseReceived':
        if (p.type === 'Document' && main) {
          const mark = p.response.headers?.[REFUSED_HEADER] as string | undefined;
          this.doc = { status: Number(p.response.status), refused: mark ? decodeURIComponent(mark) : null };
        }
    }
  }

  private async history(): Promise<History | null> { return this.sendFront<History>('Page.getNavigationHistory').catch(() => null); }

  private async refresh(): Promise<void> {
    const front = this.front;
    const h = await this.history();
    if (!h || front !== this.front) return;
    const cur = h.entries[h.currentIndex];
    this.st = { ...this.st, url: cur?.url ?? this.st.url, title: cur?.title ?? this.st.title, canBack: h.currentIndex > 0, canForward: h.currentIndex < h.entries.length - 1 };
    this.emit();
  }

  private emit(): void { for (const fn of this.states) fn(); }

  /** go to an address the guard allows. with `waitMs`, resolve once the new page has loaded (or
   *  the time is up): the waiter is set before the command goes out, so a fast load is never missed */
  async navigate(raw: string, waitMs = 0): Promise<{ ok: true } | { ok: false; reason: string }> {
    const v = checkUrl(raw);
    if (!v.ok) return v;
    this.doc = null;
    // a heavy page may have pushed the quality down, and a new one starts again at the top
    if (this.quality !== BROWSER_QUALITY_STEPS[0] || this.scale !== 1) { this.quality = BROWSER_QUALITY_STEPS[0]; this.scale = 1; if (this.frames.size) await this.cast().catch(() => {}); }
    let stop: () => void = () => {};
    const loaded = waitMs ? new Promise<void>((resolve) => { const t = setTimeout(done, waitMs); function done(): void { clearTimeout(t); resolve(); } stop = done; this.loads.add(done); }) : null;
    try {
      const r = await this.sendFront<{ errorText?: string; loaderId?: string }>('Page.navigate', { url: v.url.href });
      if (r.errorText) return { ok: false, reason: netErrorText(r.errorText) };
      if (loaded && r.loaderId) await loaded; // no loaderId: the same document, which never loads again
      return { ok: true };
    } finally { stop(); this.loads.delete(stop); }
  }

  async go(delta: -1 | 1): Promise<void> {
    const h = await this.history();
    const entry = h?.entries[h.currentIndex + delta];
    if (entry) await this.sendFront('Page.navigateToHistoryEntry', { entryId: entry.id });
  }

  reload(): Promise<unknown> { return this.sendFront('Page.reload'); }

  mouse(type: 'down' | 'up' | 'move', x: number, y: number, button?: string, clicks?: number, mods = 0): Promise<unknown> {
    const move = type === 'move';
    return this.sendFront('Input.dispatchMouseEvent', {
      type: move ? 'mouseMoved' : type === 'down' ? 'mousePressed' : 'mouseReleased', x, y, modifiers: mods,
      button: button ?? (move ? 'none' : 'left'), buttons: BUTTONS[button ?? ''] ?? 0, clickCount: move ? 0 : clicks ?? 1,
    });
  }

  wheel(x: number, y: number, dx: number, dy: number, mods = 0): Promise<unknown> {
    return this.sendFront('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy, modifiers: mods });
  }

  key(type: 'down' | 'up', key: string, code: string, keyCode: number, mods = 0): Promise<unknown> {
    const text = type === 'down' ? keyText(key, mods) : undefined;
    return this.sendFront('Input.dispatchKeyEvent', {
      type: type === 'up' ? 'keyUp' : text ? 'keyDown' : 'rawKeyDown', key, code, modifiers: mods,
      windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, ...(text ? { text, unmodifiedText: text } : {}),
    });
  }

  insertText(text: string): Promise<unknown> { return this.sendFront('Input.insertText', { text }); }

  async resize(width: number, height: number): Promise<void> {
    if (width === this.size.width && height === this.size.height) return;
    this.size = { width, height };
    await this.sendFront('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    if (this.frames.size) await this.cast();
  }

  private async cast(): Promise<void> {
    await this.sendFront('Page.stopScreencast').catch(() => {});
    await this.sendFront('Page.startScreencast', {
      format: 'jpeg', quality: this.quality, everyNthFrame: 1,
      maxWidth: Math.round(this.size.width * this.scale), maxHeight: Math.round(this.size.height * this.scale),
    });
  }

  /** a frame did not fit one relay data frame: the next ones go out at a lower quality, then smaller */
  shrink(): void {
    if (Date.now() - this.shrunkAt < 500) return; // every viewer reports the same frame once
    this.shrunkAt = Date.now();
    const next = BROWSER_QUALITY_STEPS.find((q) => q < this.quality);
    if (next) this.quality = next;
    else this.scale = Math.max(SCALE_FLOOR, this.scale * 0.75);
    if (this.frames.size) void this.cast().catch(() => {});
  }

  /** frames for one viewer. the first viewer starts the screencast, a later one gets the newest
   *  frame at once (a still page sends none), and the last one to leave stops it */
  watchFrames(fn: (f: Frame) => void): () => void {
    this.frames.add(fn);
    if (this.frames.size === 1) void this.cast().catch(() => {});
    else if (this.last) fn(this.last);
    return () => { if (this.frames.delete(fn) && !this.frames.size) void this.sendFront('Page.stopScreencast').catch(() => {}); };
  }

  watchState(fn: () => void): () => void { this.states.add(fn); return () => { this.states.delete(fn); }; }
  onGone(fn: () => void): () => void { this.gone.add(fn); return () => { this.gone.delete(fn); }; }

  async evaluate<T>(expression: string): Promise<T | undefined> {
    const r = await this.sendFront<{ result?: { value?: T }; exceptionDetails?: unknown }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? undefined : r.result?.value;
  }

  /** a picture of the page within `maxBytes`: a PNG when it fits, else a JPEG at a lower quality,
   *  then at half size. a thread attachment rides an inline artifact, which has a size cap */
  async screenshot(maxBytes = 290_000): Promise<{ data: Buffer; mime: 'image/png' | 'image/jpeg' }> {
    const shot = async (params: Record<string, unknown>): Promise<Buffer> => Buffer.from((await this.sendFront<{ data: string }>('Page.captureScreenshot', params)).data, 'base64');
    const png = await shot({ format: 'png' });
    if (png.length <= maxBytes) return { data: png, mime: 'image/png' };
    for (const quality of [80, 60, 40]) {
      const jpeg = await shot({ format: 'jpeg', quality });
      if (jpeg.length <= maxBytes) return { data: jpeg, mime: 'image/jpeg' };
    }
    return { data: await shot({ format: 'jpeg', quality: 40, clip: { x: 0, y: 0, ...this.size, scale: 0.5 } }), mime: 'image/jpeg' };
  }

  /** true when the front page is loading now, or starts within `ms` */
  loadingWithin(ms: number): Promise<boolean> {
    if (this.st.loading) return Promise.resolve(true);
    return new Promise((resolve) => {
      const stop = this.watchState(() => { if (this.st.loading) { clearTimeout(timer); stop(); resolve(true); } });
      const timer = setTimeout(() => { stop(); resolve(false); }, ms);
    });
  }

  /** resolves when the front page stops loading, or after `ms` */
  settled(ms: number): Promise<void> {
    if (!this.st.loading) return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => { clearTimeout(timer); this.loads.delete(done); resolve(); };
      const timer = setTimeout(done, ms);
      this.loads.add(done);
    });
  }

  dispose(): void { this.off(); }
}
