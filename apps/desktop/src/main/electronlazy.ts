// Electron, loaded ON USE.
//
// Outside Electron, `require('electron')` returns the binary path when installed and throws
// when the binary is absent. Neither result is the main-process API. CI skips the download, so
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
    try {
      const loaded = require('electron') as ElectronMain | string;
      mod = typeof loaded === 'object' && typeof loaded?.BrowserWindow?.getAllWindows === 'function' ? loaded : null;
    } catch { mod = null; }
  }
  return mod;
}
