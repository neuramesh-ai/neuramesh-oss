// The link seam (the link choice, 2026-09-17, George): every "open a web page" action in the
// app goes through ONE door, `openLink`, which asks where the page should open. Here, in the
// browser tab beside the sheet, or in the browser the OS uses. The asking surface is
// ui/LinkChoice.tsx; this module is the door and the decisions behind it, pure enough to test
// under node.
//
// SINGLETONS, the lib/toast.ts pattern: exactly one chooser and one external opener may be
// registered (the host mounts them). A second copy of this module would swallow every link.
//
// Two ways a link reaches the door. Code calls `openLink(url)` (a button, a markdown link's
// handler). And `watchLinks()` catches, in the capture phase, every `<a href="http…">` the app
// renders, so a card that forgets to opt in is still covered and no anchor can slip through to
// Electron's own window-open path (which the main process denies besides, main/links.ts).

export interface LinkAsk { url: string; anchor: { x: number; y: number } | null }

let _chooser: ((ask: LinkAsk) => void) | null = null;
let _external: ((url: string) => void) | null = null;

/** the host registers the asking surface; null on unmount, or on the web client, which never asks */
export function setLinkChooser(fn: ((ask: LinkAsk) => void) | null): void { _chooser = fn; }
/** the OS-browser opener (`nm.openExternal`), registered by the host */
export function setExternalOpener(fn: ((url: string) => void) | null): void { _external = fn; }

/** the door only handles the web: nm: refs, mailto and the rest keep their own handlers */
export function isWebUrl(url: string): boolean {
  try { const p = new URL(url).protocol; return p === 'http:' || p === 'https:'; } catch { return false; }
}

/** the head of the choice: the host, then the rest of the address. A bare origin has no second line. */
export function splitUrl(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    const rest = `${u.pathname}${u.search}${u.hash}`;
    return { host: u.host, path: rest === '/' ? '' : rest };
  } catch {
    return { host: url, path: '' };
  }
}

/** ⌘/Ctrl-click and middle-click skip the choice: the gesture every browser uses for "a new tab" */
export function skipsChoice(e: { metaKey?: boolean; ctrlKey?: boolean; button?: number }): boolean {
  return !!e.metaKey || !!e.ctrlKey || e.button === 1;
}

/** the modifier the kbd hint names, by platform */
export function modGlyph(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘' : 'Ctrl';
}

/**
 * Open a web page. With a chooser registered (the desktop), the choice surface asks first,
 * unless the caller says to skip it. Without one (the web client, or a surface mounted before
 * the host), the page goes to the OS browser, which on the web IS a new tab.
 */
export function openLink(url: string, opts: { skip?: boolean; anchor?: LinkAsk['anchor'] } = {}): void {
  if (!isWebUrl(url)) return;
  if (!opts.skip && _chooser) { _chooser({ url, anchor: opts.anchor ?? null }); return; }
  if (_external) _external(url);
  else if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
}

/** the anchor a click landed on, if it is a web link this seam owns */
export function webAnchorFrom(target: EventTarget | null): HTMLAnchorElement | null {
  const el = target instanceof Element ? target.closest('a[href]') : null;
  if (!(el instanceof HTMLAnchorElement)) return null;
  if (!isWebUrl(el.href) || el.hasAttribute('download')) return null;
  return el;
}

const centre = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

/**
 * Install once, at the root. Capture phase on the document, ahead of React's root listener, so
 * a card's own click handler never runs for a web anchor and never opens the page a second way.
 */
export function watchLinks(): () => void {
  const onClick = (e: MouseEvent) => {
    const a = webAnchorFrom(e.target);
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    // a keyboard activation (detail 0) has no press to grow from: the link's own box is the anchor
    const anchor = e.detail === 0 ? centre(a) : { x: e.clientX, y: e.clientY };
    openLink(a.href, { skip: skipsChoice(e), anchor });
  };
  // Chromium reports a middle click as auxclick, never as click
  const onAux = (e: MouseEvent) => {
    const a = webAnchorFrom(e.target);
    if (!a || e.button !== 1) return;
    e.preventDefault(); e.stopPropagation();
    openLink(a.href, { skip: true });
  };
  document.addEventListener('click', onClick, true);
  document.addEventListener('auxclick', onAux, true);
  return () => { document.removeEventListener('click', onClick, true); document.removeEventListener('auxclick', onAux, true); };
}
