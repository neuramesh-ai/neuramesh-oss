import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

// the browser client (W2): the real renderer + App on the web bridge (src/renderer/web).
// serves over http (unlike the preview harness's file:// build). @powersync/web is
// excluded from prebundling so its worker urls stay intact (the SDK's own guidance);
// COOP/COEP headers make the page crossOriginIsolated for OPFS + SharedArrayBuffer.
const here = dirname(fileURLToPath(import.meta.url));
const API_TARGET = process.env['NM_DEV_API_TARGET'] ?? 'https://api.neuramesh.app';

export default defineConfig(({ command, mode }) => {
  // A production build with no PowerSync endpoint would throw at boot for every visitor
  // (src/renderer/web/main.tsx refuses the literal fallback the public source cannot carry). So
  // the BUILD fails instead, loudly, and the deploy that would have replaced the live site never
  // lands: set VITE_NM_POWERSYNC_URL on the site's deployment. The desktop's dist build has the same
  // rule for NM_POWERSYNC (electron.vite.config.ts). Dev serves are exempt: they proxy a stack.
  const env = { ...loadEnv(mode, here, 'VITE_'), ...process.env };
  if (command === 'build' && mode === 'production' && !env['VITE_NM_POWERSYNC_URL']) {
    throw new Error('web build: VITE_NM_POWERSYNC_URL is not set. The browser build has no PowerSync endpoint. Set it on the site\'s deployment (Vercel neuramesh-hq) and build again.');
  }
  return {
  root: resolve(here, 'src/renderer/web'),
  // env files live at the package root (apps/desktop/.env.local carries VITE_NM_CLERK_PK),
  // not at the vite root — without this the key silently never loads
  envDir: here,
  base: '/',
  plugins: [react()],
  optimizeDeps: { exclude: ['@powersync/web'] },
  worker: { format: 'es' },
  server: {
    port: 5202,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    // dev-only CORS bridge: the page calls same-origin /v1 + /auth and the dev server
    // forwards to control-api. production needs real CORS middleware in control-api
    // (or same-origin rewrites at hq.neuramesh.app) — named in the parity ledger.
    //
    // NM_DEV_API_TARGET points this at the LOCAL stack (http://127.0.0.1:8788) so the real web
    // client can be driven against docker'd postgres + powersync instead of prod. It defaults to
    // prod, so nothing changes for anyone who does not set it. Without this the harness could
    // only ever talk to production, which is why web changes were being verified by deploying.
    proxy: {
      '/v1': { target: API_TARGET, changeOrigin: true },
      '/auth': { target: API_TARGET, changeOrigin: true },
      // the connectors' door (the GitHub grant, the social authorizations): the API answers a
      // redirect to the provider, and the browser follows it from the tab the click opened
      '/connect': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: { outDir: resolve(here, 'out/web'), emptyOutDir: true, chunkSizeWarningLimit: 6000 },
  };
});
