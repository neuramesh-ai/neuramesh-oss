// THE LOCAL STACK'S IPC — the card's state as a push, its four actions, and the one setting.
//
//   invoke  nm:local-stack-state           → { state, blocking, aboutMb }
//   push    nm:local-stack                 (the same payload, on every change)
//   invoke  nm:local-stack-pick { runtime } · nm:local-stack-install · nm:local-stack-rescan · nm:local-stack-quit
//   invoke  nm:local-keep-running-get → { keep } · nm:local-keep-running-set { keep }
//   invoke  nm:local-stack-info             → { dir, ports, engine, engineVersion, stackVersion, appVersion }  (Settings › Connections)
//   invoke  nm:local-stack-restart          → the payload, after compose stop → up → health → nm-config
//
// The renderer draws and never decides: `blocking` (driver.ts blocks) and `aboutMb` ride the
// payload so the card has no rule of its own to drift.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import type { Connection } from '../connections';
import { brainRoot } from '../harness/brain';
import { systemKeychain } from '../keychain';
import { which } from '../runtime/cli';
import { localDir } from './compose';
import { aboutMb, blocks, type StackState } from './driver';
import { LocalStack } from './index';
import { nodeSpawnFn } from './proc';
import type { Runtime } from './install';

export interface LocalStackPayload { state: StackState; blocking: boolean; aboutMb: number | null }
export interface LocalStackInfo { dir: string; ports: { api: number; powersync: number }; engine: string | null; engineVersion: string | null; stackVersion: string | null; appVersion: string }

/** the one machine-local setting this half adds: keep the containers up after quit (review F9, default off) */
const settingFile = (userData: string) => join(userData, 'local.json');
export function readKeepRunning(userData: string): boolean {
  try { return (JSON.parse(readFileSync(settingFile(userData), 'utf8')) as { keepRunning?: boolean }).keepRunning === true; } catch { return false; }
}
export function writeKeepRunning(userData: string, keep: boolean): void {
  mkdirSync(userData, { recursive: true });
  writeFileSync(settingFile(userData), JSON.stringify({ keepRunning: keep }), 'utf8');
}

/** the shipped compose file: beside the app's resources when packaged, in the source tree in dev */
export function composeSourcePath(): string {
  const packaged = join(process.resourcesPath ?? '', 'local', 'docker-compose.yaml');
  const dev = join(app.getAppPath(), 'resources', 'local', 'docker-compose.yaml');
  return app.isPackaged ? packaged : dev;
}

let stack: LocalStack | null = null;

/**
 * Start the driver for the local connection and register its IPC. Returns the `waitUntilReachable`
 * hook sync/boot.ts runs before it touches the API: it waits for `ready`, then learns the actor
 * from /v1/me under the bearer (F1: nm-config carries no ids).
 */
export function startLocalStack(conn: Connection, opts: { warm: () => boolean }): (c: Connection) => Promise<void> {
  const payload = (): LocalStackPayload => {
    const s = stack!.state;
    return { state: s, blocking: blocks(s, opts.warm()), aboutMb: 'items' in s ? aboutMb(s.items) : null };
  };
  const push = () => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('nm:local-stack', payload()); };
  const root = brainRoot();
  stack = new LocalStack({
    home: homedir(),
    root,
    env: process.env,
    version: app.getVersion(),
    dir: localDir(process.env, root),
    composeSource: composeSourcePath(),
    keychain: systemKeychain(),
    spawn: nodeSpawnFn,
    fetchImpl: fetch,
    which,
    onState: (s) => { console.log(`local_stack phase=${s.phase}${s.phase === 'error' ? ` message=${JSON.stringify(s.message)}` : ''}`); push(); },
    log: (line) => console.log(`local_stack ${line}`),
  });
  ipcMain.handle('nm:local-stack-state', () => payload());
  ipcMain.handle('nm:local-stack-pick', (_e, { runtime }: { runtime: Runtime }) => { stack!.pick(runtime); return payload(); });
  ipcMain.handle('nm:local-stack-install', () => { stack!.install(); return payload(); });
  ipcMain.handle('nm:local-stack-rescan', () => { stack!.rescan(); return payload(); });
  ipcMain.handle('nm:local-stack-quit', () => { app.quit(); });
  ipcMain.handle('nm:local-keep-running-get', () => ({ keep: readKeepRunning(app.getPath('userData')) }));
  ipcMain.handle('nm:local-keep-running-set', (_e, { keep }: { keep: boolean }) => { writeKeepRunning(app.getPath('userData'), !!keep); return { keep: !!keep }; });
  // Settings › Connections, This Mac (artboard D): the facts a person can act on, and Restart
  let engineVersion: { key: string; value: string | null } | null = null;
  ipcMain.handle('nm:local-stack-info', async (): Promise<LocalStackInfo> => {
    const s = stack!;
    const { dir, ports, engine } = s.info();
    const key = `${engine ?? ''}|${s.state.phase}`;
    if (!engineVersion || engineVersion.key !== key) engineVersion = { key, value: await s.engineVersion().catch(() => null) };
    return { dir, ports, engine, engineVersion: engineVersion.value, stackVersion: s.state.phase === 'ready' ? s.state.version : null, appVersion: app.getVersion() };
  });
  ipcMain.handle('nm:local-stack-restart', async () => { await stack!.restart(); return payload(); });
  // `compose stop` on quit unless the setting says keep — the containers and the data folder stay,
  // and never `down -v` (F8, F9)
  let stopping: Promise<void> | null = null;
  app.on('before-quit', (e) => {
    if (stopping || readKeepRunning(app.getPath('userData')) || stack!.state.phase !== 'ready') return;
    e.preventDefault();
    stopping = stack!.stop().catch(() => {}).then(() => app.quit());
  });
  void stack.boot();
  return async (c: Connection) => {
    await stack!.ready();
    c.bearer = stack!.bearer;
    const res = await fetch(`${c.apiUrl}/v1/me`, { headers: { authorization: `Bearer ${c.bearer}` } });
    const me = (await res.json().catch(() => ({}))) as { actor?: { id: string; kind: string } };
    if (!res.ok || !me.actor?.id) throw new Error(`/v1/me failed (${res.status}) — the local bearer was not accepted`);
    c.identity = { actorId: me.actor.id, display: 'you@this-mac' };
    console.log(`local_identity actor=${me.actor.id.slice(0, 8)} kind=${me.actor.kind}`);
  };
}

export const localStackState = (): StackState | null => stack?.state ?? null;
