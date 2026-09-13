import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { fileURLToPath } from 'node:url';

// Cloud config baked into a *packaged* (distributable) build. The desktop reads
// these from process.env at runtime, but a double-clicked .dmg inherits no shell
// env — so a `dist` build (NM_DIST=1) replaces the reads with literals via Vite
// `define`. Dev and dev-stack builds skip this and read the real shell env (the
// local stack). EVERYTHING baked here is PUBLISHABLE: the hosted API URL, the
// PowerSync endpoint, and the neuramesh.app web URL (the hosted sign-in handoff
// target — clerk-js now runs THERE, not on a desktop loopback, so the Clerk
// publishable key is no longer baked into the desktop). DATABASE_URL and
// CLERK_SECRET_KEY are NEVER baked — they live only on the hosted control-api;
// the desktop always talks to the remote (the embedded-control-api path this
// used to keep dead was deleted outright, docs/design/modularization-2026-08 §7).
// All three reads are in the main process (sync.ts, auth-clerk.ts,
// index.ts), so the define is applied to `main` only — and in dot-notation form,
// which is what Vite's text-replace `define` matches (not bracket access).
function bakedCloudConfig(): Record<string, string> {
  if (process.env['NM_DIST'] !== '1') return {};
  const apiUrl = process.env['NM_API'] || 'https://api.neuramesh.app';
  const powersync = process.env['NM_POWERSYNC'] || '';
  const webUrl = process.env['NM_WEB'] || 'https://neuramesh.app';
  // A release that points PowerSync at localhost is broken on every downloader's
  // machine — fail the build loudly, not silently.
  if (!powersync) throw new Error('dist build (NM_DIST=1): NM_POWERSYNC must be set to the cloud PowerSync endpoint');
  return {
    'process.env.NM_API': JSON.stringify(apiUrl),
    'process.env.NM_POWERSYNC': JSON.stringify(powersync),
    'process.env.NM_WEB': JSON.stringify(webUrl),
  };
}

const cloudDefine = bakedCloudConfig();

export default defineConfig({
  // Externalized: the Agent SDK and PowerSync resolve binaries/workers
  // relative to their own package dirs — bundling breaks them.
  // Workspace packages are raw TypeScript and MUST be bundled in (Node
  // can't import .ts at runtime).
  main: {
    define: cloudDefine,
    // workspace packages are BUNDLED, never packaged: electron-builder ships `dependencies` as
    // node_modules and refuses a pnpm workspace symlink ("…/packages/relay/package.json must be
    // under …/apps/desktop" — v0.122.0's second build, 2026-09-05). So a workspace package lives
    // in devDependencies and is excluded from externalization here, like @neuramesh/shared always
    // was. The relay's public surface re-exports the ws-backed hub and daemon client too; main
    // imports only the protocol helpers, and the unused modules tree-shake away (checked: the
    // built main has no `ws` import).
    // @neuramesh/relay-client joined this list on 2026-09-07. It arrived with the mobile-cloud
    // round and main imports it (relay-url.ts), but it was never excluded, so Electron externalized
    // it and tried to load its raw src/index.ts at runtime. Node's ESM loader cannot resolve that
    // file's extensionless relative imports, so `pnpm app:local` died before the window opened
    // with "Cannot find module …/packages/relay-client/src/relay-client" — the documented local dev
    // path, broken for anyone who ran it. The rule at the top of this block is the whole story: a
    // workspace package is raw TypeScript and MUST be bundled.
    plugins: [externalizeDepsPlugin({ exclude: ['@neuramesh/shared', '@neuramesh/relay', '@neuramesh/relay-client'] })],
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [
      react(),
      // Excalidraw's hand-drawn fonts, self-hosted (docs/38): the library falls back to a CDN
      // when EXCALIDRAW_ASSET_PATH is unset, and a canvas that phones esm.sh violates the
      // no-egress doctrine — so the woff2 tree ships in the renderer bundle and the lazy
      // chunk points EXCALIDRAW_ASSET_PATH here (served by this plugin in dev too).
      viteStaticCopy({
        // absolute src: the renderer's vite root is src/renderer, so a relative path here
        // resolves to nothing and the plugin "succeeds" copying zero files — which is a CDN
        // fallback waiting to happen. fileURLToPath keeps it anchored to apps/desktop.
        targets: [{ src: fileURLToPath(new URL('./node_modules/@excalidraw/excalidraw/dist/prod/fonts', import.meta.url)), dest: 'excalidraw-assets' }],
      }),
    ],
  },
});
