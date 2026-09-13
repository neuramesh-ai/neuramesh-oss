// CONNECTIONS IPC — Settings › Connections (artboard D) and the hosted shell's export (artboard E).
//
//   invoke  nm:connections-list           → ConnectionCard[]   every connection: account, plan, workspaces
//   invoke  nm:connection-add-custom      { apiUrl, powersyncUrl?, bearer } → { ok: true, id } | the validator's verdict
//   invoke  nm:connection-remove          { id } → { ok }   cloud: sign out, the local one stays · custom: forget the server and its bearer
//   invoke  nm:connection-billing-portal  { id } → { ok }   the existing Stripe portal, on THAT connection's workspace
//   invoke  nm:show-in-folder             { path }
//   invoke  nm:workspace-export           → { ok: true, path } | { ok: false, code: 'NOT_AVAILABLE' | 'CANCELLED' | 'FAILED', message? }
//
// Every read here names its connection (sync.ts apiOn): the settings sheet describes connections
// that are NOT in the foreground, so a handler that read `cur()` would print the wrong card.
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { app, dialog, ipcMain, shell } from 'electron';
import { apiAuthHeaders } from './apiauth';
import { clerkLogout, currentClerkUser } from './auth-clerk';
import { BAKED } from './baked';
import { connections, readConnectionsStore, resolveUrls, writeConnectionsStore, type AuthMode, type Connection, type ConnectionKind, type CustomServer } from './connections';
import { customBearerAccount, customServerId, validateCustomServer, type CustomServerInput } from './customserver';
import { systemKeychain } from './keychain';
import { movedOf, type MovedMarker } from './move/files';
import { clearWorkspaceMarker } from './sync/boot';
import { actorId, addConnection, apiOn, cur, pushForeground } from './sync';

export interface ConnectionWorkspace { id: string; name: string; slug: string; plan: string | null; seats: number | null; subscriptionStatus: string | null; currentPeriodEnd: string | null }
export interface ConnectionCard {
  id: string; kind: ConnectionKind; authMode: AuthMode; foreground: boolean;
  apiUrl: string; powersyncUrl: string; webUrl: string;
  account: { email: string } | null;
  /** the workspace this connection stands in */
  workspaceId: string;
  workspaces: ConnectionWorkspace[];
  /** a local workspace that moved to Cloud (move/files.ts moved.json): the card says so and offers Open */
  moved?: MovedMarker;
}

type WsRow = { id: string; name: string; slug: string; plan?: string; seats?: number; subscriptionStatus?: string | null; currentPeriodEnd?: string | null };

/** the live list when the server answers within a beat, else what the boot cached — never a spinner in a settings row */
async function workspacesOf(c: Connection): Promise<ConnectionWorkspace[]> {
  const cached = c.session.wsMemberships.map((w) => ({ id: w.id, name: w.name, slug: w.slug, plan: w.plan ?? null, seats: null, subscriptionStatus: null, currentPeriodEnd: null }));
  if (!c.apiUrl) return cached;
  const live = apiOn(c, '/v1/workspaces').then((r) => (r as { workspaces: WsRow[] }).workspaces);
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 4000).unref?.());
  const rows = await Promise.race([live, timeout]).catch(() => null);
  if (!rows) return cached;
  return rows.map((w) => ({ id: w.id, name: w.name, slug: w.slug, plan: w.plan ?? null, seats: w.seats ?? null, subscriptionStatus: w.subscriptionStatus ?? null, currentPeriodEnd: w.currentPeriodEnd ?? null }));
}

function accountOf(c: Connection): { email: string } | null {
  if (c.authMode === 'clerk') { const u = currentClerkUser(); return u ? { email: u.email } : null; }
  if (c.authMode === 'local') return c.identity.actorId ? { email: c.identity.display || 'you@this-mac' } : null;
  if (c.authMode === 'dev') return { email: 'dev@localhost' };
  return null;
}

export function registerConnectionsIpc(): void {
  ipcMain.handle('nm:connections-list', async (): Promise<ConnectionCard[]> => {
    const fg = connections.current().id;
    return Promise.all(connections.all().map(async (c) => ({
      id: c.id, kind: c.kind, authMode: c.authMode, foreground: c.id === fg,
      apiUrl: c.apiUrl, powersyncUrl: c.powersyncUrl, webUrl: c.webUrl || BAKED.webUrl,
      account: accountOf(c), workspaceId: c.ws, workspaces: await workspacesOf(c),
      ...(movedOf(c) ? { moved: movedOf(c)! } : {}),
    })));
  });

  ipcMain.handle('nm:connection-add-custom', async (_e, input: CustomServerInput) => {
    const v = await validateCustomServer(input, fetch);
    if (!v.ok) return v;
    const sid = customServerId(v.apiUrl);
    if (connections.get(`custom:${sid}`)) return { ok: false as const, code: 'ADDRESS' as const, message: 'This server is already connected.' };
    // the bearer goes to the keychain FIRST: the boot hook (customserver.ts customReachable) reads it back
    await systemKeychain().set(customBearerAccount(sid), input.bearer.trim());
    const userData = app.getPath('userData');
    const store = readConnectionsStore(userData);
    const rec: CustomServer = { id: sid, apiUrl: v.apiUrl, powersyncUrl: v.powersyncUrl, authMode: 'local' };
    writeConnectionsStore(userData, { ...store, custom: [...store.custom.filter((x) => x.id !== sid), rec] });
    const conn = await addConnection({ id: `custom:${sid}`, kind: 'custom', authMode: 'local', ...resolveUrls('custom', process.env, rec, BAKED) });
    console.log(`connection_added id=${conn.id} mode=${v.mode} version=${v.version ?? 'unknown'} workspaces=${v.workspaces.length}`);
    return { ok: true as const, id: conn.id };
  });

  ipcMain.handle('nm:connection-remove', async (_e, { id }: { id: string }) => {
    const c = connections.get(id);
    if (!c || c.kind === 'local') throw new Error('This connection cannot be removed.');
    const wasForeground = connections.current().id === id;
    // the replica belongs to the identity that is leaving — never left for a later sign-in to read
    try { await c.db?.disconnectAndClear(); } catch (err) { console.error(`connection_remove clear failed for ${id}:`, err instanceof Error ? err.message : err); }
    connections.remove(id);
    clearWorkspaceMarker(c);
    const userData = app.getPath('userData');
    const store = readConnectionsStore(userData);
    if (c.kind === 'cloud') clerkLogout();
    else {
      const sid = id.replace(/^custom:/, '');
      store.custom = store.custom.filter((x) => x.id !== sid);
      await systemKeychain().delete(customBearerAccount(sid)).catch(() => {});
    }
    writeConnectionsStore(userData, { ...store, foreground: connections.current().id });
    if (wasForeground) pushForeground(cur());
    console.log(`connection_removed id=${id} kind=${c.kind} foreground=${connections.current().id}`);
    return { ok: true };
  });

  ipcMain.handle('nm:connection-billing-portal', async (_e, { id }: { id: string }) => {
    const c = connections.get(id);
    if (!c) throw new Error(`no connection ${id}`);
    const { url } = (await apiOn(c, '/v1/billing/portal', { workspace: c.ws })) as { url?: string };
    if (url) await shell.openExternal(url);
    return { ok: !!url };
  });

  ipcMain.handle('nm:show-in-folder', (_e, { path }: { path: string }) => {
    if (typeof path === 'string' && path.startsWith('/')) shell.showItemInFolder(path);
  });

  // the hosted shell's Export workspace (artboard E): the server's tar.gz streamed to a place the person picks.
  // The server route lands with U1b — a 404 is "not available yet", said once, and nothing else.
  ipcMain.handle('nm:workspace-export', async () => {
    const c = cur();
    const res = await fetch(`${c.apiUrl}/v1/workspaces/${encodeURIComponent(c.ws)}/export`, { headers: await apiAuthHeaders(c.apiUrl, { kind: 'human', id: actorId(c) }) }).catch(() => null);
    if (!res) return { ok: false as const, code: 'FAILED' as const, message: 'The server did not answer.' };
    if (res.status === 404) return { ok: false as const, code: 'NOT_AVAILABLE' as const };
    if (!res.ok || !res.body) return { ok: false as const, code: 'FAILED' as const, message: `The export failed (${res.status}).` };
    // the server names the file (export.ts: neuramesh-<slug>-<stamp>.tar.gz); the dialog offers that name
    const named = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];
    const pick = await dialog.showSaveDialog({
      title: 'Export workspace',
      defaultPath: join(app.getPath('downloads'), named ?? `neuramesh-${c.wsInfo.slug || 'workspace'}.tar.gz`),
      filters: [{ name: 'Archive', extensions: ['tar.gz', 'gz'] }],
    });
    if (pick.canceled || !pick.filePath) return { ok: false as const, code: 'CANCELLED' as const };
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(pick.filePath));
    console.log(`workspace_export ws=${c.ws.slice(0, 8)} path=${pick.filePath}`);
    return { ok: true as const, path: pick.filePath };
  });
}
