// electron-builder `beforePack` hook — regenerate the DMG background with this
// build's version + arch baked into the top-right pill, so the installer always
// reads correctly (no stale "v0.4.1 · arm64" on a v0.5 / x64 build).
//
// capturePage needs Electron, so the render runs as a child Electron process.
// On ANY failure we fall back to the clean, label-less base art — a render
// hiccup degrades the installer (no version chip) but never breaks the release.
// "Any failure" includes a HANG: the child is given 90 seconds (a render takes
// two), because an Electron process that throws before its ready handler stays
// alive with no window, and v0.122.0's first build sat on exactly that for six
// hours until GitHub killed the job (2026-09-05).
//
// Single-arch-per-invocation is assumed (the release workflow builds arm64 and
// x64 as separate matrix jobs; local `dist` is arm64-only), so the shared output
// file never races between arches.
const { execFileSync } = require('node:child_process');
const { mkdirSync, copyFileSync, existsSync } = require('node:fs');
const path = require('node:path');

exports.default = async function dmgBackground(context) {
  const appDir = path.resolve(__dirname, '..');
  const outDir = path.join(appDir, 'build', '.generated');
  const theme = 'light';

  let archName = String(context.arch);
  try {
    const { Arch } = require('electron-builder');
    archName = Arch[context.arch] || archName; // Arch enum (number) → 'arm64' | 'x64' | 'universal'
  } catch { /* fall back to the numeric arch */ }
  const version = context.packager.appInfo.version;

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // ensure the child boots as Electron, not Node

  try {
    const electron = require('electron'); // Node context → path to the electron binary
    execFileSync(
      electron,
      [path.join(appDir, 'scripts', 'dmg-render.cjs'), '--arch', archName, '--theme', theme, '--version', version, '--out', outDir],
      { stdio: 'inherit', cwd: appDir, env, timeout: 90_000, killSignal: 'SIGKILL' },
    );
  } catch (err) {
    console.warn(`[dmg-bg] render failed (${err && err.message}); using clean art without the version label`);
    mkdirSync(outDir, { recursive: true });
    for (const [src, dst] of [
      [`build/neuramesh-dmg-background-${theme}.png`, 'dmg-bg.png'],
      [`build/neuramesh-dmg-background-${theme}@2x.png`, 'dmg-bg@2x.png'],
    ]) {
      const s = path.join(appDir, src);
      if (existsSync(s)) copyFileSync(s, path.join(outDir, dst));
    }
  }
};
