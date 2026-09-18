// Dock mini-browser guest policy (docs/21). The renderer's address bar already funnels
// input to http(s) (@neuramesh/shared normalizeUrlInput); these are the ENFORCED limits
// on what an attached <webview> can do regardless of what a page inside it tries —
// doctrine #4: invariants live in the process that owns them, not in UI etiquette.

/** every dock-browser webview rides one dedicated persistent session, isolated from the app's */
export const BROWSER_PARTITION = 'persist:nm-browser';

const WEB_RE = /^https?:$/;

function proto(url: string): string | null {
  try { return new URL(url).protocol; } catch { return null; }
}

/** which src attributes may attach at all — empty/blank first renders, then the web */
export function allowedWebviewSrc(src: string | undefined): boolean {
  if (!src || src === 'about:blank') return true;
  return WEB_RE.test(proto(src) ?? '');
}

/** in-guest navigation: the web (and blank), nothing else — no file:, chrome:, ws:, custom schemes */
export function navPolicy(url: string): 'allow' | 'deny' {
  if (url === 'about:blank') return 'allow';
  return WEB_RE.test(proto(url) ?? '') ? 'allow' : 'deny';
}

/** window.open / target=_blank: web URLs replace the pane's page (a mini browser has one
 * page per tab), mailto hands off to the user's mail app, anything else is dropped */
export function popupPolicy(url: string): 'same-pane' | 'external' | 'deny' {
  const p = proto(url);
  if (p && WEB_RE.test(p)) return 'same-pane';
  if (p === 'mailto:') return 'external';
  return 'deny';
}

// ── the MAIN window's floor (the link choice, 2026-09-17) ──────────────────────────────────
// The renderer asks where a web link opens (ui/LinkChoice.tsx). Whatever it decides or forgets,
// the app's own window never spawns a popup and never leaves its own document: a stray
// `target=_blank` or a same-window web navigation hands the URL to the OS browser and is denied,
// so a bare Electron window cannot appear. Wired in main/links.ts.

/** window.open / target=_blank from the app itself: the web and mailto go to the OS, the rest die */
export function mainPopupPolicy(url: string): 'external' | 'deny' {
  return popupPolicy(url) === 'deny' ? 'deny' : 'external';
}

/** a navigation of the app's own document: its own origin (a dev reload) stays, the web goes to
 * the OS browser, and nothing else may replace the app */
export function mainNavPolicy(current: string, target: string): 'allow' | 'external' | 'deny' {
  const t = proto(target);
  const c = proto(current);
  if (!t) return 'deny';
  if (WEB_RE.test(t)) {
    try { if (c && WEB_RE.test(c) && new URL(current).origin === new URL(target).origin) return 'allow'; } catch { /* not a url: falls through to external */ }
    return 'external';
  }
  if (t === 'file:') return c === 'file:' ? 'allow' : 'deny';
  if (t === 'mailto:') return 'external';
  return 'deny';
}
