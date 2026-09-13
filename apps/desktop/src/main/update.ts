import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { ProgressInfo, UpdateInfo } from 'electron-updater';

// The single source of truth the renderer's update card reflects. The shape is
// mirrored in preload/index.ts and the renderer's NMBridge — keep the three in
// sync. Never blocks launch: the card only appears once an update is found.
export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'available'; version: string; notes: string | null }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string };

let state: UpdateState = { phase: 'idle' };
const versionOf = (): string => ('version' in state ? state.version : '');

function set(next: UpdateState) {
  state = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('nm:update', state);
  }
}

let checking = false; // collapse overlapping checks (the periodic timer + a manual retry)
let lastCheckAt = 0;
// focus/wake fire often — collapse bursts so we never hammer the update server, while
// still catching a release shipped while the app runs. A `force` check (startup / the
// user's manual retry) bypasses the throttle.
const CHECK_THROTTLE_MS = 10 * 60 * 1000;
async function check(force = false) {
  if (checking || !autoUpdater.isUpdaterActive()) return;
  if (!force && Date.now() - lastCheckAt < CHECK_THROTTLE_MS) return;
  checking = true;
  lastCheckAt = Date.now();
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.error('update check failed:', err);
  } finally {
    checking = false;
  }
}

export function initAutoUpdate() {
  // Download is user-initiated: the card shows "Update available" and the user
  // clicks Update to start the download (the requested UX). The main process
  // hosts running agents, so we never force-relaunch — the user clicks Restart.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true; // a downloaded update still applies on the next normal quit

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    set({ phase: 'available', version: info.version, notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null });
  });
  autoUpdater.on('update-not-available', () => {
    // a periodic re-check while a download is in flight must not wipe the card
    if (state.phase !== 'downloading' && state.phase !== 'ready') set({ phase: 'idle' });
  });
  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    set({ phase: 'downloading', version: versionOf(), percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    set({ phase: 'ready', version: info.version });
  });
  autoUpdater.on('error', (err: Error) => {
    set({ phase: 'error', message: err?.message ?? String(err) });
  });

  // The card mounts after the first events may have fired, so it polls the
  // current state on mount rather than relying solely on the live broadcast.
  ipcMain.handle('nm:update-state', () => state);
  ipcMain.handle('nm:update-check', () => {
    void check(true); // the user asked — bypass the throttle
    return { ok: true };
  });
  ipcMain.handle('nm:update-download', async () => {
    if (state.phase !== 'available') return { ok: false };
    set({ phase: 'downloading', version: versionOf(), percent: 0 });
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      set({ phase: 'error', message: (err as Error)?.message ?? String(err) });
      return { ok: false };
    }
  });
  ipcMain.handle('nm:update-install', () => {
    if (state.phase !== 'ready') return { ok: false };
    // defer past this IPC reply so the renderer's call resolves before we quit
    setImmediate(() => autoUpdater.quitAndInstall());
    return { ok: true };
  });

  // Only a packaged, signed app can self-update; in dev checkForUpdates throws
  // (no dev-app-update.yml). isUpdaterActive() === app.isPackaged guards check().
  if (app.isPackaged) {
    void check(true); // check once at startup
    // A release shipped while the app is running must surface WITHOUT a restart. The old
    // path only re-checked every 6h, so in practice you only ever saw an update via the
    // startup check (you'd quit first). Re-check when you return to the app, when the
    // machine wakes from sleep, and on a 30-min backstop (for a window left focused). The
    // throttle in check() collapses focus/wake bursts so none of this hammers the server.
    app.on('browser-window-focus', () => void check());
    powerMonitor.on('resume', () => void check());
    const periodic = setInterval(() => void check(), 30 * 60 * 1000);
    periodic.unref?.();
  }
}

// Dev/evidence only: push a synthetic state so the card can be exercised and
// captured without a real signed release. Not part of the packaged update path.
export function simulateUpdate(phase: UpdateState['phase']) {
  const version = '0.4.2';
  if (phase === 'available') set({ phase, version, notes: 'Faster cold start, review-cockpit polish, and fixes.' });
  else if (phase === 'downloading') set({ phase, version, percent: 46 });
  else if (phase === 'ready') set({ phase, version });
  else if (phase === 'error') set({ phase, message: 'Could not reach the update server.' });
  else set({ phase: 'idle' });
}
