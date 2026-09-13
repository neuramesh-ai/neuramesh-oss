// Electron, loaded ON USE.
//
// `require('electron')` THROWS outside a packaged/dev Electron: its entry resolves the binary
// path at require time and fails when there is none. CI sets ELECTRON_SKIP_BINARY_DOWNLOAD=1, so
// any main-process module with a top-level `import … from 'electron'` cannot be imported by a
// test — and a module that cannot be imported cannot be tested.
//
// This bit us silently: designrework.test.ts imports agents.ts, and passed only while the pnpm
// store cache happened to carry an electron dist. The cache is keyed on the lockfile, so the
// first PR to touch a dependency turned a green suite red, with a message about installing
// electron that had nothing to do with the change.
//
// Modules that BOOT the app (index.ts, sync.ts, update.ts, auth*.ts) may keep importing electron
// directly — they only ever run inside it. This is for the ones tests reach.
export type ElectronMain = typeof import('electron');

let mod: ElectronMain | null | undefined;

/** The electron main module, or null when we are not running inside Electron. */
export function electron(): ElectronMain | null {
  if (mod === undefined) {
    try { mod = require('electron') as ElectronMain; } catch { mod = null; }
  }
  return mod;
}
