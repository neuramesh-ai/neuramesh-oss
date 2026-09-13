import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Standalone Vite build of the renderer-only PREVIEW harness (src/renderer/preview):
// mounts the real <App/> against a mock window.nm for screenshot evidence. Not part of
// the shipped Electron build. base:'./' → relative asset paths so the output opens over
// file:// in headless Chrome. Output lands under out/ (gitignored). .mjs so Vite's CLI
// loads it as native ESM (a .ts config trips ERR_REQUIRE_ESM on this Node).
export default defineConfig({
  root: 'src/renderer/preview',
  base: './',
  plugins: [react(), viteStaticCopy({ targets: [{ src: resolve(here, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts'), dest: 'excalidraw-assets' }] })],
  build: {
    outDir: '../../../out/preview',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
});
