// the workspace's address, made real (web parity ledger, slice 2).
//
// the wizard has shown `hq.neuramesh.app/<slug>` as a workspace's address since the host was
// corrected — but nothing routed on it, so the path was a promise the product did not keep.
// this is the whole contract, kept deliberately small:
//
//   /                 → the stored (or first) workspace, and the url is REWRITTEN to its slug
//   /<slug>           → that workspace, when the signed-in member belongs to it
//   /<unknown-slug>   → falls back to the stored workspace and rewrites the url, because a
//                       stranger's link (or a workspace you left) should land you somewhere
//                       real rather than in an error state you cannot act on
//
// the slug is resolved against the MEMBERSHIP list bootstrap already returns, so a path can
// never select a workspace the server would not have served anyway — the url is a convenience,
// never an authorization.

const WS_KEY = 'nm:web:workspaceId';

export interface SlugWorkspace {
  id: string;
  slug: string;
}

/** the slug in the current path, or null at the root. only the FIRST segment is a workspace. */
export function slugFromPath(pathname: string): string | null {
  const first = pathname.split('/').filter(Boolean)[0];
  return first ? decodeURIComponent(first) : null;
}

/** which workspace the url is asking for, given who the member actually is. */
export function resolveWorkspace(
  pathname: string,
  memberships: readonly SlugWorkspace[],
  storedId: string | null,
): SlugWorkspace | null {
  const slug = slugFromPath(pathname);
  if (slug) {
    const hit = memberships.find((w) => w.slug === slug);
    if (hit) return hit;
  }
  // no slug, or one this member cannot open: fall back to where they were, then to their first
  return memberships.find((w) => w.id === storedId) ?? memberships[0] ?? null;
}

/** make the url agree with the workspace actually open, without adding a history entry —
 *  a boot that silently corrected the path should not leave a Back button that undoes it. */
export function syncPathTo(ws: SlugWorkspace | null): void {
  if (!ws?.slug) return;
  const want = `/${encodeURIComponent(ws.slug)}`;
  if (window.location.pathname !== want) window.history.replaceState(null, '', want + window.location.search);
}

/** apply the url at boot: pick the workspace, remember it, and normalize the address bar. */
export function applyBootRoute(memberships: readonly SlugWorkspace[]): SlugWorkspace | null {
  const ws = resolveWorkspace(window.location.pathname, memberships, localStorage.getItem(WS_KEY));
  if (ws) localStorage.setItem(WS_KEY, ws.id);
  syncPathTo(ws);
  return ws;
}

/** switching workspaces is a url change on the web, not an app relaunch (the desktop's
 *  switchWorkspace relaunches to rebind its replica; the browser reloads at the new path,
 *  which rebinds the same way and leaves a shareable address behind). */
export function switchTo(ws: SlugWorkspace): void {
  localStorage.setItem(WS_KEY, ws.id);
  window.location.assign(`/${encodeURIComponent(ws.slug)}`);
}
