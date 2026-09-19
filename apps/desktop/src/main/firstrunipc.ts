// THE FIRST-RUN DOORS' IPC — the electron half of firstrun.ts (docs/design/first-run-doors-2026-09).
//
//   invoke  nm:first-run-state            → the door's state ({ phase: 'done' } on every profile but a fresh one)
//   push    nm:first-run                  (the same, on every change)
//   invoke  nm:first-run-choose { door }  → 'local' | 'cloud' | 'signin'
//   invoke  nm:first-run-reopen           → the wait card's "Open the page again"
//   invoke  nm:first-run-cancel           → back to the door
//
// The renderer draws the state and never decides. This Mac hands the boot to the stack driver
// (index.ts startLocal) and the dormant Local; the cloud doors land the way Get Pro lands
// (upgradeipc.ts): the session first, then the cloud connection, then the swap. No plan wait: the
// workspace is free, and the wizard resumes on it.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { currentClerkUser, saveClerkSession } from './auth-clerk';
import { readConnectionsStore, type Connection } from './connections';
import { FirstRun, isFreshProfile, type FirstRunDoor, type FirstRunState } from './firstrun';
import { brainRoot } from './harness/brain';
import { localDir } from './localStack/compose';
import { addConnection, bootDormant, setForeground } from './sync';
import { cloudSpec } from './upgradeipc';

let door: FirstRun | null = null;

const push = (s: FirstRunState): void => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('nm:first-run', s);
};

/** the state the renderer reads at boot; `done` when no door was ever needed */
export const firstRunState = (): FirstRunState => door?.state ?? { phase: 'done', door: null };

/**
 * Register the door for this launch. A fresh profile (firstrun.ts isFreshProfile) gets the door and
 * its Local goes dormant until the door says This Mac; the cloud doors land a session and the cloud
 * in front, Local still dormant. Every other profile, and a launch with no Local at all, starts done.
 */
export function registerFirstRunIpc(o: { local: Connection | undefined; startLocal: () => void }): void {
  const store = readConnectionsStore(app.getPath('userData'));
  const fresh = !!o.local && isFreshProfile({ clerkSignedIn: !!currentClerkUser(), storedForeground: store.foreground, localUsedBefore: existsSync(join(localDir(process.env, brainRoot()), '.env')), custom: store.custom.length });
  if (o.local && fresh) o.local.dormant = true;
  console.log(`first_run fresh=${fresh}`);
  const spec = cloudSpec();
  door = new FirstRun({
    fetchImpl: fetch,
    apiUrl: spec.apiUrl,
    webUrl: spec.webUrl,
    openExternal: (url) => shell.openExternal(url),
    startLocal: async () => {
      o.startLocal();
      await bootDormant('local');
      setForeground('local');
    },
    land: async (session) => {
      saveClerkSession({ ...session, savedAt: Date.now() });
      const c = await addConnection(spec);
      setForeground(c.id);
    },
    onState: push,
    log: (line) => console.log(line),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
  }, fresh);
  ipcMain.handle('nm:first-run-state', () => firstRunState());
  ipcMain.handle('nm:first-run-choose', (_e, { door: which }: { door: FirstRunDoor }) => { void door!.choose(which); return firstRunState(); });
  ipcMain.handle('nm:first-run-reopen', async () => { await door!.reopen(); return firstRunState(); });
  ipcMain.handle('nm:first-run-cancel', () => { door!.cancel(); return firstRunState(); });
}
