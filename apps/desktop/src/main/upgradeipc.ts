// THE UPGRADE IPC — the electron half of upgrade.ts (artboards C1, C2).
//
//   invoke  nm:upgrade-state            → the last pushed phase
//   invoke  nm:upgrade-start            → { url }  opens neuramesh.app/pro in the browser, starts the poll
//   invoke  nm:upgrade-reopen           → opens the same page again (the C2 button)
//   invoke  nm:upgrade-cancel           → stops the poll, back to idle
//   push    nm:upgrade                  { phase, url?, message? }
//
// One attempt at a time: a second Get Pro while one waits re-opens the page it already has, so
// two nonces never race for the same session. The sheet draws the phase and never decides.
import { BrowserWindow, ipcMain, shell } from 'electron';
import { BAKED } from './baked';
import { saveClerkSession } from './auth-clerk';
import { apiAuthHeaders } from './apiauth';
import { connections, resolveUrls, type Connection, type ConnectionSpec } from './connections';
import { resyncWorkspace as resyncConnection } from './sync/boot';
import { actorId, addConnection, cur, pushForeground, setForeground } from './sync';
import { finishUpgrade, pollDesktopAuth, proPageUrl, startDesktopAuth, type DesktopAuthStart } from './upgrade';

export type UpgradePhase = 'idle' | 'waiting' | 'landing' | 'done' | 'expired' | 'error';
export interface UpgradePush { phase: UpgradePhase; url?: string; message?: string }

let current: { nonce: string; url: string; cancelled: boolean } | null = null;
let last: UpgradePush = { phase: 'idle' };

const push = (p: UpgradePush): void => {
  last = p;
  console.log(`upgrade phase=${p.phase}${p.message ? ` message=${JSON.stringify(p.message)}` : ''}`);
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('nm:upgrade', p);
};

/** the cloud the upgrade adds: env in dev, then the baked defaults (connections.ts resolveUrls) */
export const cloudSpec = (): ConnectionSpec => ({ id: 'cloud', kind: 'cloud', authMode: 'clerk', ...resolveUrls('cloud', process.env, null, BAKED) });

/** the connection's own workspace row, read on ITS credential — the webhook's `cloud` is what the landing waits for */
async function planOf(c: Connection): Promise<string | null> {
  const res = await fetch(`${c.apiUrl}/v1/workspaces`, { headers: await apiAuthHeaders(c.apiUrl, { kind: 'human', id: actorId(c) }) });
  if (!res.ok) return null;
  const { workspaces } = (await res.json()) as { workspaces: Array<{ id: string; plan?: string }> };
  return (workspaces.find((w) => w.id === c.ws) ?? workspaces[0])?.plan ?? null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function run(start: DesktopAuthStart, spec: ConnectionSpec): Promise<void> {
  const mine = () => current?.nonce === start.nonce && !current.cancelled;
  const out = await pollDesktopAuth({ fetchImpl: fetch, apiUrl: spec.apiUrl, start, sleep, now: Date.now, cancelled: () => !mine() });
  if (out.status === 'cancelled') return;
  current = null;
  if (out.status === 'expired' || out.status === 'timeout') { push({ phase: 'expired', message: 'The browser did not finish in 15 minutes. Choose Get Pro to start again.' }); return; }
  push({ phase: 'landing' });
  try {
    const t0 = performance.now();
    const r = await finishUpgrade(out.session, {
      saveSession: (s) => saveClerkSession({ ...s, savedAt: Date.now() }),
      existing: () => connections.get('cloud'),
      addConnection,
      resync: (c) => resyncConnection(c),
      planOf,
      setForeground: (id) => { setForeground(id); },
      cloudSpec: spec, sleep, now: Date.now,
    });
    console.log(`upgrade_landed conn=${r.connection.id} added=${r.added} plan_ready=${r.planReady} ws=${r.connection.ws.slice(0, 8)} ms=${(performance.now() - t0).toFixed(0)}`);
    // a Free hosted workspace upgrading stood on the cloud already: the swap changed nothing, so
    // remount the shell by hand, or the composer stays gated until the next window focus
    if (!r.added) pushForeground(cur());
    push({ phase: 'done' });
  } catch (err) {
    push({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

export function registerUpgradeIpc(): void {
  ipcMain.handle('nm:upgrade-state', () => last);
  ipcMain.handle('nm:upgrade-start', async () => {
    if (current && !current.cancelled) { await shell.openExternal(current.url); return { url: current.url }; }
    const spec = cloudSpec();
    if (!spec.apiUrl) throw new Error('The cloud address is not set. This build cannot open Pro.');
    const start = await startDesktopAuth(fetch, spec.apiUrl);
    const url = proPageUrl(spec.webUrl, start.nonce);
    current = { nonce: start.nonce, url, cancelled: false };
    await shell.openExternal(url);
    push({ phase: 'waiting', url });
    void run(start, spec);
    return { url };
  });
  ipcMain.handle('nm:upgrade-reopen', async () => { if (current) await shell.openExternal(current.url); });
  ipcMain.handle('nm:upgrade-cancel', () => {
    if (current) current.cancelled = true;
    current = null;
    push({ phase: 'idle' });
  });
}
