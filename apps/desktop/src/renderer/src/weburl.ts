// THE WEB'S ADDRESSES, from the connection (the source-release round, U3a). The desktop used to
// carry the site's copy as literals — `hq.neuramesh.app/` on the wizard's workspace step, the
// downloads page on the setup tracker — which a self-hosted or renamed deployment could never
// change. They derive here from the foreground connection's `webUrl` (connections.ts: env in dev,
// then the connection, then the baked default), set once per bootstrap by App and read where the
// words render. This file is `weburl.ts` and not `brand.ts`: `brand.tsx` beside it owns the Porch
// mark, and a `brand.ts` would shadow it on every `'../brand'` import.

/** the baked default (main/baked.ts BAKED.webUrl) — the last rung, never the first */
export const WEB_URL_DEFAULT = 'https://neuramesh.app';

let current = WEB_URL_DEFAULT;

/** App calls this from the bootstrap poll with the foreground connection's web url ('' keeps the default) */
export function setConnectionWebUrl(url: string | null | undefined): void {
  current = url?.trim() || WEB_URL_DEFAULT;
}

export const webUrl = (): string => current;

/** the app's host with a trailing slash — where a workspace lives on the web (`hq.` before the apex),
 *  never the marketing apex, which would swallow a slug into its SPA catch-all */
export function workspaceHost(base: string = current): string {
  try {
    const u = new URL(base);
    const host = u.host.startsWith('hq.') || u.host.startsWith('localhost') || /^\d/.test(u.host) ? u.host : `hq.${u.host}`;
    return `${host}/`;
  } catch {
    return 'hq.neuramesh.app/';
  }
}

/** the real /downloads route on the public site (apps/web) — not a landing-page invention */
export const downloadsUrl = (base: string = current): string => `${base.replace(/\/+$/, '')}/downloads`;
