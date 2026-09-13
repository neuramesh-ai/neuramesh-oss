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
