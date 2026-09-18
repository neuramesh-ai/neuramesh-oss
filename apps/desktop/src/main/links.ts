// The main window's link floor, and the default browser's identity (the link choice, 2026-09-17).
//
// The renderer asks where a web link should open (ui/LinkChoice.tsx) and every anchor the app
// renders goes through that one seam. This is the floor under it (doctrine #4): the main window
// itself refuses to spawn a popup or leave its own document, so a stray `target=_blank` or a
// same-window navigation to the web hands the URL to the OS browser instead of opening a bare
// Electron window, whatever the renderer did or forgot to do. The policies are pure and tested
// in browser-guard.ts; this file only wires them.
import { app, ipcMain, shell, type WebContents } from 'electron';
import { mainNavPolicy, mainPopupPolicy } from './browser-guard';

export function guardMainWindow(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (mainPopupPolicy(url) === 'external') void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    const policy = mainNavPolicy(contents.getURL(), url);
    if (policy === 'allow') return;
    event.preventDefault();
    if (policy === 'external') void shell.openExternal(url);
  });
}

export interface DefaultBrowser { name: string; icon: string | null }

// any https URL names the handler; the OS answers with the app, never with the page
const PROBE = 'https://neuramesh.app/';
let cached: Promise<DefaultBrowser | null> | null = null;

/** the app the OS opens https links with: its name, and on macOS/Windows its icon as a data URL */
export async function defaultBrowser(): Promise<DefaultBrowser | null> {
  try {
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const info = await app.getApplicationInfoForProtocol(PROBE);
      const icon = info.icon.isEmpty() ? null : info.icon.resize({ width: 32, height: 32 }).toDataURL();
      return info.name ? { name: info.name, icon } : null;
    }
    const name = app.getApplicationNameForProtocol(PROBE);
    return name ? { name, icon: null } : null;
  } catch {
    return null; // no handler registered: the row falls back to "Open in your browser"
  }
}

/** `nm:default-browser`: asked once per launch, the answer is kept (a default browser rarely changes mid-session) */
export function registerLinkIpc(): void {
  ipcMain.handle('nm:default-browser', () => (cached ??= defaultBrowser()));
}
