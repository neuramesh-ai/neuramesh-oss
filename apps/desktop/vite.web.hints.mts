import type { HtmlTagDescriptor, Plugin } from 'vite';

// THE BOOT HINTS: what the browser can start fetching while the entry chunk is still on the wire.
//
// Measured on a cold load (fast4g, the boot harness): the page asked for the App chunk only after the
// entry chunk had downloaded AND evaluated (~1.1 s in). The names are content-hashed, so only the
// build knows them; this plugin reads the finished bundle and writes the hints into index.html.
//
//   App chunk + its static imports  -> modulepreload (fetched and parsed, never evaluated: App reads
//                                      window.nm at evaluation, and main.tsx installs it first)
//   App CSS                         -> preload as style (vite's import helper adds the stylesheet)
//   clerk-js (a build with a key)   -> modulepreload (a signed-in boot asks for it at once)
//   the PowerSync and Clerk origins -> preconnect (DNS, TCP and TLS before the first request)
//
// NOT the replica's worker chain (worker, VFS, glue, wasm). Tried and measured: the worker fetched
// every file again instead of taking the preloaded copy, so the wasm crossed the link twice, and the
// 590 KB of early preloads pushed the entry chunk from 1.0 s to 1.9 s on a 9 Mbps link.

/** the Clerk Frontend API origin a publishable key names: pk_<env>_<base64 of "host$"> */
export function clerkOrigin(pk: string | undefined): string | null {
  const b64 = pk?.split('_')[2];
  if (!b64) return null;
  try {
    const host = Buffer.from(b64, 'base64').toString('utf8').replace(/\$$/, '');
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}

/** the two origins a boot talks to before it renders: the sync stream (a CORS fetch without
 *  credentials, so `crossorigin`) and Clerk's Frontend API (its calls carry cookies, so not) */
function preconnects(env: Record<string, string | undefined>): Record<string, string | boolean>[] {
  const out: Record<string, string | boolean>[] = [];
  const at = (url: string | null | undefined, cors: boolean): void => {
    if (!url) return;
    try { out.push(cors ? { rel: 'preconnect', href: new URL(url).origin, crossorigin: true } : { rel: 'preconnect', href: new URL(url).origin }); } catch { /* not a url: no hint */ }
  };
  at(env['VITE_NM_POWERSYNC_URL'], true);
  at(clerkOrigin(env['VITE_NM_CLERK_PK']), false);
  return out;
}

export function bootHints(env: Record<string, string | undefined>): Plugin {
  return {
    name: 'nm-boot-hints',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return [];
        const tags: HtmlTagDescriptor[] = [];
        const link = (attrs: Record<string, string | boolean>): void => { tags.push({ tag: 'link', attrs, injectTo: 'head' }); };
        for (const p of preconnects(env)) link(p);
        const chunks = Object.values(bundle);
        // the dynamic entry that holds App.tsx (rollup leaves its facadeModuleId null)
        const app = chunks.find((c) => c.type === 'chunk' && c.isDynamicEntry && c.moduleIds.some((id) => id.replace(/\\/g, '/').endsWith('/src/renderer/src/App.tsx')));
        if (app && app.type === 'chunk') {
          // its static imports too, except the entry chunk the page already loads
          const entries = new Set(chunks.filter((c) => c.type === 'chunk' && c.isEntry).map((c) => c.fileName));
          for (const f of [app.fileName, ...app.imports.filter((f) => !entries.has(f))]) link({ rel: 'modulepreload', crossorigin: true, href: `/${f}` });
          for (const css of app.viteMetadata?.importedCss ?? []) link({ rel: 'preload', as: 'style', href: `/${css}` });
        }
        // clerk-js is its own chunk now (webnm-auth.ts imports it on first use), and a build with a
        // Clerk key asks for it at boot: restoreSession, or the sign-in screen. Fetch it with the page.
        if (env['VITE_NM_CLERK_PK']) {
          const clerk = chunks.find((c) => c.type === 'chunk' && c.isDynamicEntry && c.moduleIds.some((id) => id.replace(/\\/g, '/').includes('/@clerk/clerk-js/')));
          if (clerk) link({ rel: 'modulepreload', crossorigin: true, href: `/${clerk.fileName}` });
        }
        return tags;
      },
    },
  };
}
