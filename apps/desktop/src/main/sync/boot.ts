// THE REPLICA'S BOOT, per connection: open the replica, resolve the workspace, connect the
// stream, register this machine, start the agent host, arm the watches. Linear and ordered, and
// it must READ that way — moving a step past an await is how a whole layer once silently never
// attached with every test green. sync.ts registers the IPC wall ONCE and calls this for every
// connection (connections.ts: one foreground connection, every connection live).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { app, BrowserWindow, Notification } from 'electron';
import { PowerSyncDatabase, SyncStreamConnectionMethod } from '@powersync/node';
import { startAgentHost } from '../agents';
import type { AgentLog } from '../agentlog';
import { sessionExpiresAt } from '../auth';
import { clerkLogout } from '../auth-clerk';
import { connections, type Connection } from '../connections';
import { startNotifications } from '../notify';
import { membershipChanged, parseWorkspaceIdent, pickBootWorkspace, shouldWipeReplica } from '../wsident';
import { ApiError, actorId, apiOn } from '../sync';
import { Connector } from './connector';
import { registerThisMachine } from './machine';
import { AppSchema } from './schema';
import { backfillSeeds } from './seeds';

export interface BootDeps {
  agentLog: AgentLog;
  killTaskPtys: (taskNumber: number) => void;
  /** Local mode: resolves once the stack answers — the replica opens before it, the API waits on it */
  waitUntilReachable?: (conn: Connection) => Promise<void>;
}

type WsRow = { id: string; name: string; slug: string; onboarded?: boolean };
// on THIS connection, never the foreground's: two connections boot side by side (sync.ts apiOn)
const listWorkspaces = async (conn: Connection): Promise<WsRow[]> => ((await apiOn(conn, '/v1/workspaces')) as { workspaces: WsRow[] }).workspaces;

// The connection's marker — the workspace identity this replica last synced as (id + display
// name/slug, see wsident.ts). The name/slug make offline-first boots honest: a boot that can't
// reach the API acts (and renders) as the last-synced workspace instead of the dev seed's
// "Acme Robotics".
export function readWorkspaceMarker(conn: Connection) {
  try { return parseWorkspaceIdent(readFileSync(conn.markerPath, 'utf8')); } catch { return null; }
}

export function writeWorkspaceMarker(conn: Connection): void {
  mkdirSync(dirname(conn.markerPath), { recursive: true });
  writeFileSync(conn.markerPath, JSON.stringify({ workspaceId: conn.ws, name: conn.wsInfo.name, slug: conn.wsInfo.slug }));
}

/** clear the marker when nothing is left to stand in (you left your last workspace) — the next
 *  boot then resolves honestly into onboarding instead of a workspace you are not in */
export function clearWorkspaceMarker(conn: Connection): void {
  try { rmSync(conn.markerPath, { force: true }); } catch { /* a stale marker is better than a failed exit */ }
}

/** Invitations waiting on this identity. Never throws — an offline boot keeps the last answer
 *  rather than pretending nobody invited you. */
export async function refreshPendingInvites(conn: Connection): Promise<void> {
  try {
    const r = (await apiOn(conn, '/v1/invites/mine')) as { invites?: Connection['session']['pendingInvites'] };
    conn.session.pendingInvites = r.invites ?? [];
    if (conn.session.pendingInvites.length) console.log(`invites_pending n=${conn.session.pendingInvites.length}`);
  } catch (err) {
    console.error('pending invite check failed:', err instanceof Error ? err.message : err);
  }
}

// The stored session is definitively dead (401 from the control-api) — land on
// sign-in instead of a phantom workspace. Same relaunch contract as the token-mint
// path in auth-clerk.ts; clearing the session first means the relaunch can't loop.
function signOutDeadSession(where: string): void {
  console.error(`session_dead at=${where} — signing out to the login screen`);
  clerkLogout();
  app.relaunch();
  app.exit(0);
}

// Bind the replica to the resolved workspace and (re)connect the stream. Wipes a replica still
// bound to a DIFFERENT workspace generation first — a stale checkpoint from another workspace
// wedges the stream (2026-06-12 lesson). Shared by the boot connect and the post-onboarding /
// re-login resync. Both the wipe and the marker stamp require an AUTHORITATIVE identity: an
// unresolved boot (API unreachable) must never destroy offline data or rebind the marker.
export async function connectStream(conn: Connection): Promise<void> {
  const target = conn.db;
  if (!target) return;
  const lastWs = readWorkspaceMarker(conn)?.workspaceId ?? null;
  // The membership set is what keeps a workspace SWITCH from being read as an account change:
  // both workspaces already live in this replica, so switching must not cost a re-download.
  const memberOf = conn.session.wsMemberships.length ? conn.session.wsMemberships.map((w) => w.id) : undefined;
  if (shouldWipeReplica(lastWs, conn.ws, conn.wsAuthoritative, memberOf)) {
    console.log(`replica_wipe last=${lastWs!.slice(0, 8)} now=${conn.ws.slice(0, 8)} — fresh first sync`);
    await target.disconnectAndClear();
  }
  // a resolved EMPTY list is authoritative too (onboarding) — but there is no workspace to stamp
  if (conn.wsAuthoritative && conn.ws) writeWorkspaceMarker(conn);
  await target.connect(new Connector(conn, actorId), { connectionMethod: SyncStreamConnectionMethod.HTTP });
}

// Re-resolve the active workspace and reconnect — for when a workspace appears or changes AFTER
// the boot connect: a brand-new user (whose workspace is created during onboarding) or a
// sign-out→sign-in in the same session. No-ops until the replica exists.
export async function resyncWorkspace(conn: Connection): Promise<void> {
  if (!conn.db || conn.authMode === 'dev') return;
  try {
    const workspaces = await listWorkspaces(conn);
    conn.session.wsMemberships = workspaces;
    if (workspaces.length) {
      // Same rule as the boot pick: honour the marker's workspace while it is still yours. A
      // re-login must not relocate someone just because another workspace is older.
      const pick = pickBootWorkspace({ resolved: workspaces, marker: readWorkspaceMarker(conn), current: { ws: conn.ws, info: conn.wsInfo } });
      conn.ws = pick.ws;
      conn.wsInfo = pick.info;
      conn.needsOnboarding = false;
      conn.resumeWorkspaceId = undefined;
      conn.wsAuthoritative = true;
    }
  } catch (err) {
    console.error('resyncWorkspace: workspace resolution failed:', err);
  }
  await refreshPendingInvites(conn);
  console.log('sync_resync: re-establishing stream for the active workspace');
  await connectStream(conn).catch((err) => console.error('resyncWorkspace connect failed:', err));
}

/** open the connection's replica — CREATE the directory first: neither better-sqlite3 nor PowerSync
 *  will mkdir for you, and a throw here before the IPC wall registers is a HANG behind the splash,
 *  not an error (2026-08-01). */
export function openReplica(conn: Connection): PowerSyncDatabase {
  mkdirSync(dirname(conn.replicaPath), { recursive: true });
  const db = new PowerSyncDatabase({
    schema: AppSchema,
    // better-sqlite3 (electron-rebuilt): the node:sqlite implementation wedges
    // checkpoint application after the first upload (probe-isolated 2026-06-11).
    database: { dbFilename: conn.replicaPath.split('/').pop()!, dbLocation: conn.replicaPath.slice(0, conn.replicaPath.lastIndexOf('/')) },
  });
  conn.db = db;
  // the registry's list did not change, its SHAPE did: the rail's union (watch-rail.ts) has
  // nothing to read on this connection until now
  connections.notify();
  return db;
}

function startHost(conn: Connection, db: PowerSyncDatabase, machineId: string, deps: BootDeps): void {
  startAgentHost({ db, machineId, workspace: conn.ws, apiUrl: conn.apiUrl, ownerActorId: actorId(conn), agentLog: deps.agentLog, killTaskPtys: deps.killTaskPtys });
  conn.agentHostStarted = true;
}

// Resolution FAILURE is not a license to do anything destructive: keep the marker identity
// (cached data stays readable offline), retry in the background, and only a definitive 401 sends
// the user back to sign-in.
async function lateResolveWorkspace(conn: Connection, db: PowerSyncDatabase, deps: BootDeps): Promise<void> {
  for (let delay = 5_000; !conn.wsAuthoritative; delay = Math.min(delay * 2, 60_000)) {
    await new Promise((r) => setTimeout(r, delay));
    if (conn.wsAuthoritative) return; // a login/onboard resolved it meanwhile
    try {
      const workspaces = await listWorkspaces(conn);
      conn.session.wsMemberships = workspaces;
      // marker, not null: this runs after an offline boot already bound us to the marker's
      // workspace, and re-resolving must confirm that choice rather than relocate us to [0].
      const pick = pickBootWorkspace({ resolved: workspaces, marker: readWorkspaceMarker(conn), current: { ws: conn.ws, info: conn.wsInfo } });
      const changed = pick.ws !== conn.ws;
      conn.ws = pick.ws;
      conn.wsInfo = pick.info;
      conn.needsOnboarding = pick.needsOnboarding;
      conn.resumeWorkspaceId = pick.resumeWorkspaceId;
      conn.wsAuthoritative = true;
      console.log(`workspace_resolved late ws=${conn.ws.slice(0, 8)} changed=${changed} onboarding=${conn.needsOnboarding}`);
      if (conn.needsOnboarding) return; // the wizard takes over via the bootstrap poll
      writeWorkspaceMarker(conn);
      // the workspace really changed while we were unreachable (deleted/recreated,
      // different account server-side) — rebind the replica + fresh first sync
      if (changed) await connectStream(conn);
      // the boot-time machine registration ran against an unreachable API — the
      // agent host never started; bring this machine online now that we can.
      if (!conn.thisMachineId) {
        const machineId = await registerThisMachine(conn, actorId);
        if (machineId) startHost(conn, db, machineId, deps);
      }
      return;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && conn.authMode === 'clerk') return signOutDeadSession('workspace-reresolve');
      console.error('workspace re-resolution failed (will retry):', err instanceof Error ? err.message : err);
    }
  }
}

/** which workspace this connection stands in — the dev pin, or the signed-in identity's list */
async function resolveWorkspace(conn: Connection, db: PowerSyncDatabase, deps: BootDeps): Promise<'ok' | 'dead'> {
  // The dev stack resolves too (0113). It used to hard-pin DEV_WS and skip every path below,
  // which meant the local stack could not exercise multi-workspace membership AT ALL — no
  // switcher, no boot pick, no way to dogfood the thing we just built (CLAUDE.md: this repo is
  // user zero). Dev keeps its safety net: any failure, or an empty list, leaves DEV_WS in place
  // and dev never routes to onboarding.
  if (conn.authMode === 'dev') {
    try {
      const workspaces = await listWorkspaces(conn);
      if (workspaces?.length) {
        conn.session.wsMemberships = workspaces;
        const pick = pickBootWorkspace({ resolved: workspaces, marker: readWorkspaceMarker(conn), current: { ws: conn.ws, info: conn.wsInfo } });
        conn.ws = pick.ws;
        conn.wsInfo = pick.info;
      }
    } catch (err) {
      console.log('dev workspace resolution failed — staying on the seeded workspace:', err instanceof Error ? err.message : err);
    }
    return 'ok';
  }
  if (process.env['NM_FORCE_ONBOARDING'] === '1') return 'ok';
  const marker = readWorkspaceMarker(conn);
  let resolved: WsRow[] | null = null;
  try {
    resolved = await listWorkspaces(conn);
    conn.session.wsMemberships = resolved;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && conn.authMode === 'clerk') {
      signOutDeadSession('workspace-resolve');
      return 'dead'; // unreachable in practice (app.exit)
    }
    console.error('workspace resolution failed (offline-first: acting as the last-synced workspace):', err instanceof Error ? err.message : err);
  }
  const pick = pickBootWorkspace({ resolved, marker, current: { ws: conn.ws, info: conn.wsInfo } });
  conn.ws = pick.ws;
  conn.wsInfo = pick.info;
  conn.needsOnboarding = pick.needsOnboarding;
  conn.wsAuthoritative = pick.authoritative;
  // BEFORE the wizard can claim the screen (0113). An invited newcomer has zero memberships,
  // which is exactly the onboarding signal — so without this check the wizard walks someone
  // who was invited to a team into creating their own empty second workspace instead. The
  // renderer shows the join card while `needsOnboarding && session.pendingInvites.length`.
  if (conn.needsOnboarding) await refreshPendingInvites(conn);
  else void refreshPendingInvites(conn);
  if (!conn.wsAuthoritative) void lateResolveWorkspace(conn, db, deps);
  return 'ok';
}

/** the hourly-rotation reconnector and the membership watch — the two timers a cloud stream needs */
function armCloudWatches(conn: Connection, db: PowerSyncDatabase): void {
  if (conn.authMode !== 'supabase' && conn.authMode !== 'clerk') return;
  // ── membership watch (2026-08-13) ──────────────────────────────────────────────────────────
  // PowerSync fixes a connection's buckets at connect time from `my_workspaces`, so a workspace
  // you are added to WHILE THE APP RUNS streams nothing: the replica keeps whatever it had, the
  // pill reads Local, and only a relaunch fixes it. Cheap by construction: one GET a minute, and
  // it only reconnects when the membership SET actually differs.
  const memberWatch = setInterval(() => {
    void (async () => {
      try {
        const workspaces = await listWorkspaces(conn);
        if (!membershipChanged(conn.session.wsMemberships.map((w) => w.id), workspaces.map((w) => w.id))) return;
        console.log(`sync_membership: changed (${conn.session.wsMemberships.length} → ${workspaces.length}) — re-resolving and reconnecting`);
        conn.session.wsMemberships = workspaces;
        if (workspaces.length) {
          const pick = pickBootWorkspace({ resolved: workspaces, marker: readWorkspaceMarker(conn), current: { ws: conn.ws, info: conn.wsInfo } });
          conn.ws = pick.ws;
          conn.wsInfo = pick.info;
          conn.wsAuthoritative = true;
        }
        await refreshPendingInvites(conn);
        // reconnect, not just re-pick: the new membership's buckets only exist on a fresh stream
        await connectStream(conn).catch((err) => console.error('sync_membership connect failed:', err));
      } catch { /* offline — the next tick retries */ }
    })();
  }, 60_000);
  memberWatch.unref?.();
  // HTTP streams have not been observed surviving the hourly token rotation: live updates stop
  // while the pill stays "connected". Reconnect proactively just before each expiry — connect()
  // re-runs fetchCredentials, which refreshes the session.
  const reconnector = setInterval(() => {
    const exp = conn.authMode === 'clerk' ? conn.clerkTokenExp?.getTime() : sessionExpiresAt();
    const window = conn.authMode === 'clerk' ? 120_000 : 240_000;
    if (exp && exp - Date.now() < window) {
      console.log('sync_reconnect: token nearing expiry — re-establishing stream');
      db.connect(new Connector(conn, actorId), { connectionMethod: SyncStreamConnectionMethod.HTTP }).catch((err) => console.error('sync_reconnect failed:', err));
    }
  }, 60_000);
  reconnector.unref?.();
}

/** desktop push notifications for this connection: ping the human when something needs them and
 *  the app is unfocused — click deep-links back in. Every connection rings its own bell. */
function armNotifications(db: PowerSyncDatabase): void {
  const mainWin = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  startNotifications(db, {
    supported: () => Notification.isSupported(),
    // NM_NOTIFY_ALWAYS=1 forces the unfocused path (a test/debug hook so the live e2e can observe
    // a notification fire without juggling window focus); normally we suppress when focused.
    isFocused: () => process.env['NM_NOTIFY_ALWAYS'] === '1' ? false : !!mainWin()?.isFocused(),
    notifier: ({ title, body, nav }) => {
      const w = mainWin();
      if (!w) return;
      console.log(`notify_fired "${title}" channel=${nav.channelId.slice(0, 8)}${nav.taskId ? ` task=${nav.taskId.slice(0, 8)}` : ''}`);
      const n = new Notification({ title, body, silent: false });
      n.on('click', () => { if (w.isMinimized()) w.restore(); w.show(); w.focus(); if (!w.webContents.isDestroyed()) w.webContents.send('nm:open-thread', nav); });
      n.show();
    },
  });
}

/**
 * Boot one connection. The replica opens FIRST so the shell renders from it while the backend is
 * still coming up (Local mode's stack, an offline cloud); everything after `waitUntilReachable`
 * needs the API.
 */
export async function bootConnection(conn: Connection, deps: BootDeps): Promise<void> {
  // Cloud modes act as the last-synced identity from the very first frame — the renderer's 1.5s
  // bootstrap poll starts before resolution finishes, and the dev-seed identity must never flash
  // (or stick) for a signed-in user.
  if (conn.authMode !== 'dev') {
    const marker = readWorkspaceMarker(conn);
    if (marker) conn.ws = marker.workspaceId;
    conn.wsInfo = { name: marker?.name ?? '', slug: marker?.slug ?? '' };
  }
  if (!conn.apiUrl) console.error(`api_unconfigured conn=${conn.id} — set NM_API; writes queue offline until it is set`);
  else console.log(`api conn=${conn.id} mode=${conn.authMode} url=${conn.apiUrl}`);
  const db = openReplica(conn);
  if (deps.waitUntilReachable) await deps.waitUntilReachable(conn);
  if ((await resolveWorkspace(conn, db, deps)) === 'dead') return;
  await connectStream(conn);
  let lastStatusLine = '';
  db.registerListener({
    statusChanged: (s) => {
      // log transitions only — uploading flaps every retry tick and the spam
      // buries the diagnostics that matter (the 2026-06-12 wedge lesson)
      const line = `connected=${s.connected} synced=${!!s.lastSyncedAt} downloading=${s.dataFlowStatus?.downloading ?? '?'} uploading=${s.dataFlowStatus?.uploading ?? '?'} last=${s.lastSyncedAt?.toISOString() ?? 'never'}`;
      if (line !== lastStatusLine) {
        lastStatusLine = line;
        console.log(`sync_status conn=${conn.id} ${line}`);
      }
    },
  });
  armCloudWatches(conn, db);
  // presence v0: this machine registers itself and heartbeats (docs/03 §4); the AgentHost starts
  // once the machine id is known. A workspace still to be created means the wizard runs first.
  if (process.env['NM_FORCE_ONBOARDING'] === '1') { conn.needsOnboarding = true; return; }
  if (conn.needsOnboarding) { console.log(`bootstrap: no workspace on ${conn.id} — onboarding required`); return; }
  const machineId = await registerThisMachine(conn, actorId);
  if (machineId) startHost(conn, db, machineId, deps);
  armNotifications(db);
  if (!process.argv.some((a) => a.startsWith('--smoke'))) void backfillSeeds(conn, db, machineId);
}
