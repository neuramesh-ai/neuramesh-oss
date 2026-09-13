import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Standalone build of the offscreen screenshot harness (src/renderer/preview) — the real
// renderer + App, driven by a mock nm bridge. Output feeds scripts/shoot.cjs. Not part of
// the packaged app; used ad-hoc for UI captures.
const here = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: resolve(here, 'src/renderer/preview'),
  base: './', // shoot.cjs loads via file:// — assets must resolve relatively, not from /
  plugins: [react(), viteStaticCopy({ targets: [{ src: resolve(here, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts'), dest: 'excalidraw-assets' }] })],
  build: { outDir: resolve(here, 'out/preview'), emptyOutDir: true, chunkSizeWarningLimit: 6000 },
});
