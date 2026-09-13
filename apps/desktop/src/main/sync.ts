import { initHouseStyle } from './housestyle';
import { registerWhiteboardIpc } from './sync/ipc/whiteboards';
import { registerAccountIpc } from './sync/ipc/account';
import { registerArtifactIpc } from './sync/ipc/artifacts';
import { registerTaskIpc } from './sync/ipc/task';
import { registerRoomIpc } from './sync/ipc/rooms';
import { registerMessageIpc } from './sync/ipc/messages';
import { registerMembershipIpc, type ConnectionSummary } from './sync/ipc/membership';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';

import { createBaseLogger, LogLevel, type PowerSyncDatabase } from '@powersync/node';

if (process.env['NM_SYNC_DEBUG']) {
  const logger = createBaseLogger();
  logger.useDefaults();
  logger.setLevel(LogLevel.DEBUG);
}
import { launcherIdeas } from './agents';

import { emitProcChange } from './procbus';

import { migrateBrain, resolveStatePath, resolveIdentityPath } from './harness/migrate';
import { brainRoot } from './harness/brain';
import { initAgentLog, type AgentLog } from './agentlog';
import { getStaged, clearStaged, hasAttachment, attachmentSize } from './attachments';

import { currentUser } from './auth';
import { clearClerkApiToken, currentClerkUser } from './auth-clerk';
import type { Actor } from '@neuramesh/shared';
import { apiAuthHeaders } from './apiauth';
import { BAKED } from './baked';
import {
  connections, localIsDormant, makeConnection, pickForeground, planConnections, readConnectionsStore, statePathsFor, writeConnectionsStore,
  DEV_WS, type Connection, type ConnectionSpec,
} from './connections';
import { localDir } from './localStack/compose';
import { movedOf } from './move/files';
import { bootConnection, clearWorkspaceMarker, refreshPendingInvites, resyncWorkspace as resyncConnection, writeWorkspaceMarker, type BootDeps } from './sync/boot';
import { registerOnboardIpc } from './sync/onboard';
import { ensureMarketingSeeds } from './sync/seeds';
import { machineName } from './sync/machine';

import { registerTerminals, type PtyTerm } from './sync/ipc/terminals';
import { registerLocalEngineering } from './sync/ipc/engineering-local';
import { registerWorkspaceFiles } from './sync/ipc/workspace-files';
import { registerLogs } from './sync/ipc/logs';
import { registerContent } from './sync/ipc/content';
import { registerProjects } from './sync/ipc/projects';
import { registerSettings } from './sync/ipc/settings';
import { registerAgents } from './sync/ipc/agents';
import { registerSkills } from './sync/ipc/skills';
import { registerBoardWatches } from './sync/ipc/watch-board';
import { registerCrewWatches } from './sync/ipc/watch-crew';
import { registerRailWatch } from './sync/ipc/watch-rail';
import { registerRoomsWatches } from './sync/ipc/watch-rooms';

// ── the connections (connections.ts) ─────────────────────────────────────────────────────────
// This module used to hold ONE backend in module-level singletons — `WS`, `API_URL`,
// `POWERSYNC_URL`, `activeDb`, `session`, and `AUTH_MODE` from the environment. Local mode makes
// that a list, so every one of them is now a field on the FOREGROUND connection, read at call time
// through the getters below. The 236 handlers keep their signatures; what they read moved.
export { DEV_WS };
export { machineName };
// `NM_DEV_USER` lets a second dev instance act as a DIFFERENT member of the same workspace.
// Shared compute (0114) is defined across members — whose machine, whose keys, whose turn — so a
// single dev identity cannot exercise it at all. Dev/legacy modes only; clerk/supabase resolve a
// real signed-in user and ignore this.
export const DEV_USER = process.env['NM_DEV_USER']?.trim() || '00000000-0000-0000-0000-000000000001';

/** the connection the shell is standing in */
export const cur = (): Connection => connections.current();
/** the workspace it stands in — a LIVE read, so a handler registered at boot still reads the
 *  workspace the app switched to */
export const ws = (): string => cur().ws;
export const apiUrl = (): string => cur().apiUrl;
export const thisMachineId = (): string | null => cur().thisMachineId;
export const thisMachineName = (): string => cur().thisMachineName; // hostname-derived; used to re-register on a Free machine transfer
export const machineLimit = (): { message: string } | null => cur().machineLimit; // set when a 2nd machine hits the Free single-machine limit at boot
// a transfer clears the limit from sync/ipc/settings — the write goes through a setter
export const setMachineLimit = (v: { message: string } | null) => { cur().machineLimit = v; };
/** the foreground replica. Throws before it opens: a query then is a boot-order bug, not an empty list. */
export const activeDb = (): PowerSyncDatabase => {
  const db = cur().db;
  if (!db) throw new Error('replica not open yet');
  return db;
};

export function actorId(c: Connection | null = connections.peek()): string {
  if (!c) return DEV_USER;
  if (c.authMode === 'clerk') return currentClerkUser()?.id ?? DEV_USER;
  if (c.authMode === 'supabase') return currentUser()?.id ?? DEV_USER;
  if (c.authMode === 'local') return c.identity.actorId;
  return DEV_USER;
}

/**
 * A replica watch failed. Every one of these used to be `onError: () => {}`.
 *
 * That is indistinguishable from "no rows": a query naming a column the client schema does not
 * declare throws on every tick, the surface renders empty, and nothing anywhere says why. It cost
 * a live debugging session on 2026-08-07 — `runs.machine_id` existed in Postgres and in the sync
 * rules but not in the client `runs` table, so the Activity view and the rail's open-runs went
 * silently blank while every other signal looked healthy.
 *
 * Deliberately not thrown: a watch is descriptive, and a broken one must not take down the app.
 * But it must SAY so. Deduped per message — a failing watch re-fires on every sync tick.
 */
const watchErrorsSeen = new Set<string>();
// exported for sync/ipc/* — a watch that dies must report the same way wherever it was
// registered, or a module's failure looks like an empty list instead of an error
export function watchFailed(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (watchErrorsSeen.has(msg)) return;
  watchErrorsSeen.add(msg);
  console.error(`⚠️ replica watch failed — this surface will render EMPTY until fixed: ${msg}`);
}

// assigned by startSync once its closure exists; the kind-set IPC fires it so a room
// flipped to marketing mid-session gets its pack + marketer without waiting for a reboot
export let ensureMarketingSeedsRef: ((workspaceId: string, channelIds: string[]) => Promise<void>) | null = null;

// mime for a stored attachment — the nm-attachment:// protocol sets it as Content-Type so
// images render and files download with the right type. Reads the synced artifact row.
export async function artifactMime(id: string): Promise<string | null> {
  const db = connections.peek()?.db;
  if (!db) return null;
  try {
    const rows = await db.getAll<{ mime: string | null }>(`select mime from artifacts where id = ? limit 1`, [id]);
    return rows[0]?.mime ?? null;
  } catch {
    return null;
  }
}

// A Free-plan entitlement gate (402 PLAN_LIMIT from the control-api) must never fail blind — surface
// the human-readable reason and route to the upgrade flow. Fire-and-forget to the live window.
function emitPlanLimit(message: string): void {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (win && !win.webContents.isDestroyed()) win.webContents.send('nm:plan-limit', { message });
}

// api() failures carry the HTTP status so callers can tell definitive auth
// rejections (401 → sign out) from transient outages (retry, keep cached state).
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export const authHeaders = (actor?: Actor) => apiAuthHeaders(apiUrl(), actor ?? { kind: 'human', id: actorId() });

export const api = (path: string, body?: unknown, method?: string) => apiOn(cur(), path, body, method);

/**
 * The same call on a NAMED connection. The boot path (sync/boot.ts) and the upgrade landing run
 * against a connection that is not in the foreground yet — a cloud connection booting beside the
 * local stack must list ITS workspaces, not the stack's, or its replica binds to the wrong ones.
 */
export async function apiOn(c: Connection, path: string, body?: unknown, method = body ? 'POST' : 'GET') {
  const headers = () => apiAuthHeaders(c.apiUrl, { kind: 'human', id: actorId(c) });
  let res = await fetch(`${c.apiUrl}${path}`, {
    method,
    headers: await headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  // a rejected bearer is worth exactly one retry with a fresh one: the middleware refuses a bad
  // token rather than falling back, so a token that lapsed in flight would otherwise surface as
  // a hard failure on a call that was always going to be allowed.
  if (res.status === 401 && c.authMode === 'clerk') {
    clearClerkApiToken();
    res = await fetch(`${c.apiUrl}${path}`, {
      method,
      headers: await headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  if (!res.ok) {
    const text = await res.text();
    let parsed: { error?: string; code?: string } = {};
    try { parsed = JSON.parse(text) as { error?: string; code?: string }; } catch { /* non-JSON error body */ }
    if (parsed.code === 'PLAN_LIMIT') emitPlanLimit(parsed.error ?? 'This is a Cloud feature.');
    throw new ApiError(`${path} failed ${res.status}: ${parsed.error ?? text}`, res.status, parsed.code);
  }
  return res.json();
}

export interface SyncHandle {
  db: PowerSyncDatabase;
  agentLog: AgentLog;
}

// ── which connections exist, and which is in front ───────────────────────────────────────────
/**
 * Plan the connections for this launch and put them in the registry. Runs at `whenReady`, BEFORE
 * the auth-status handler and before sync: `nm:auth-status` answers from the foreground connection,
 * so the foreground must exist before the renderer can ask.
 */
export function initConnections(): Connection[] {
  if (connections.all().length) return connections.all();
  const userData = app.getPath('userData');
  const store = readConnectionsStore(userData);
  const specs = planConnections(process.env, { clerkSignedIn: !!currentClerkUser(), custom: store.custom, baked: BAKED });
  const brainDir = brainRoot();
  const primary = { replicaPath: resolveStatePath('replica', userData, brainDir), markerPath: resolveIdentityPath(userData, brainDir) };
  for (const spec of specs) connections.add(makeConnection(spec, statePathsFor(spec, primary), DEV_USER));
  const front = pickForeground(store.foreground, specs.map((s) => s.id));
  if (front) connections.setForeground(front);
  // the Local connection of a cloud user stays dormant until asked for (connections.ts)
  const local = connections.get('local');
  if (local) local.dormant = localIsDormant(front, existsSync(join(localDir(process.env, brainDir), '.env')));
  console.log(`connections=${specs.map((s) => `${s.id}(${s.authMode})${connections.get(s.id)?.dormant ? '[dormant]' : ''}`).join(',')} foreground=${connections.current().id}`);
  return connections.all();
}

/** a connection added after boot (the upgrade adds the cloud): register it and boot it */
export async function addConnection(spec: ConnectionSpec): Promise<Connection> {
  const userData = app.getPath('userData');
  const brainDir = brainRoot();
  const primary = { replicaPath: resolveStatePath('replica', userData, brainDir), markerPath: resolveIdentityPath(userData, brainDir) };
  const conn = connections.add(makeConnection(spec, statePathsFor(spec, primary), DEV_USER));
  if (bootDeps) await bootConnection(conn, bootDeps).catch((err) => console.error(`boot ${conn.id} failed:`, err));
  return conn;
}

/** exported for the upgrade landing (upgradeipc.ts): a swap that changed nothing still remounts the shell, so a plan that flipped under it is re-read */
export const pushForeground = (c: Connection): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('nm:foreground', { id: c.id, kind: c.kind, authMode: c.authMode, workspaceId: c.ws });
  }
};

/** a connection as the renderer reads it (U3b) — the rail's bands and the foot's menu draw from this */
export function connectionSummary(c: Connection): ConnectionSummary {
  let host = '';
  try { host = new URL(c.apiUrl).host; } catch { host = c.apiUrl; }
  const email = c.authMode === 'clerk' ? currentClerkUser()?.email ?? null : c.authMode === 'supabase' ? currentUser()?.email ?? null : null;
  return {
    id: c.id, kind: c.kind, authMode: c.authMode, host,
    workspaceId: c.ws, workspace: c.wsInfo, workspaces: c.session.wsMemberships,
    account: email ? { email } : null,
    live: !!c.db,
  };
}
const connectionSummaries = (): ConnectionSummary[] => connections.all().map(connectionSummary);
/** the registry changed (add · remove · a replica opened): every window redraws its bands and its menu */
const pushConnections = (): void => {
  const list = connectionSummaries();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('nm:connections', list);
  }
};
connections.onChanged(pushConnections);

/**
 * Bring a connection (and optionally one of its workspaces) to the foreground. IN PROCESS: the
 * pointer flips, the renderer hears `nm:foreground` and remounts its shell against the new
 * connection, and every handler reads it on the next call. This replaces `switchWorkspace`'s
 * relaunch — the ~2s restart, and the note telling the user about it, both retire. The budget is
 * the view switch's, <100ms, and the swap prints its own time so the log can hold it to that.
 */
export function setForeground(id: string, workspace?: string): { ok: true; switching: true } {
  const { ms, changed } = connections.setForeground(id, workspace);
  const c = cur();
  if (changed) {
    if (c.wsAuthoritative && c.ws) writeWorkspaceMarker(c);
    writeConnectionsStore(app.getPath('userData'), { ...readConnectionsStore(app.getPath('userData')), foreground: c.id });
    pushForeground(c);
  }
  console.log(`foreground_swap ms=${ms.toFixed(2)} budget_ms=100 ok=${ms < 100} to=${c.id}${workspace ? ` ws=${workspace.slice(0, 8)}` : ''} changed=${changed}`);
  return { ok: true, switching: true };
}

/**
 * Move to another workspace you belong to (0113) on the foreground connection. `null` means
 * "nothing left to stand in" (you left your last workspace) — clear the marker and send the shell
 * to onboarding, in place.
 */
function switchWorkspace(workspace: string | null): { ok: true; switching: true } {
  const c = cur();
  if (workspace) return setForeground(c.id, workspace);
  clearWorkspaceMarker(c);
  c.needsOnboarding = true;
  console.log('workspace_switch to=none — onboarding');
  pushForeground(c);
  return { ok: true, switching: true };
}

/** wake a dormant connection: boot it now (the caller started its driver first), then it can come to the front */
export async function bootDormant(id: string): Promise<void> {
  const c = connections.get(id);
  if (!c || !c.dormant) return;
  c.dormant = false;
  if (bootDeps) await bootConnection(c, bootDeps).catch((err) => console.error(`boot ${c.id} failed:`, err));
}

/** re-resolve the foreground connection's workspace and reconnect (post-onboarding, re-login) */
export const resyncWorkspace = (): Promise<void> => resyncConnection(cur());

let bootDeps: BootDeps | null = null;
let registered = false;

export async function startSync(deps: { waitUntilReachable?: BootDeps['waitUntilReachable'] } = {}): Promise<SyncHandle> {
  initConnections();
  // the workspace VOICE (docs/design/agent-comm-rules-2026-08): prime the house-style cache
  // from the settings lane; every prompt composer appends the block through housestyle.ts
  initHouseStyle(async () => {
    const { workspaces } = (await api('/v1/workspaces')) as { workspaces: Array<{ id: string; commRules?: unknown }> };
    return workspaces.find((w) => w.id === ws())?.commRules ?? null;
  });
  // ── Brain migration (docs/harness/01 §8) ───────────────────────────────────────────────────
  // Runs BEFORE any replica is opened: moving a live SQLite file corrupts it (the NM_USERDATA
  // lesson). Copy-then-verify-then-remove, idempotent, and NON-FATAL — a failure leaves the
  // originals in place and `resolveStatePath` keeps booting on them, so a bad disk delays the
  // consolidation instead of bricking the app.
  const brainDir = brainRoot();
  try {
    const m = migrateBrain(app.getPath('userData'), brainDir, { log: (line) => console.log(`nm_brain ${line}`) });
    if (!m.ok) console.warn(`nm_brain migration incomplete: ${m.failed.map((f) => `${f.what} (${f.error})`).join('; ')} — continuing on the old paths`);
  } catch (err) {
    console.warn(`nm_brain migration skipped: ${err instanceof Error ? err.message : 'error'} — continuing on the old paths`);
  }
  // the activity log follows the same resolve-don't-assume rule — ONE per process, every connection writes to it
  const activityPath = resolveStatePath('activity', app.getPath('userData'), brainDir);
  mkdirSync(dirname(activityPath), { recursive: true });
  const agentLog = initAgentLog(dirname(activityPath), activityPath.endsWith('activity.db') ? 'activity.db' : 'agent-logs.db');
  setInterval(() => { try { agentLog.prune(); } catch { /* best-effort */ } }, 60 * 60_000); // hourly 7-day retention sweep (also runs on boot + every 500 writes)
  // review terminals (node-pty), keyed by subId — declared here so the agent
  // host's reclaim path (started below) can close them when a task is accepted
  const ptys = new Map<string, PtyTerm>();  // handed to sync/ipc/terminals
  // accepting/closing a task reclaims its workspace dir — kill any review
  // terminals first so a live shell isn't left pointing at a deleted path
  const killTaskPtys = (taskNumber: number) => {
    let n = 0;
    for (const [subId, p] of ptys) {
      if (p.taskNumber === taskNumber) { p.kill(); ptys.delete(subId); n++; }
    }
    if (n) { console.log(`terminal_reclaimed task=${taskNumber} killed=${n}`); emitProcChange(); }
  };
  bootDeps = { agentLog, killTaskPtys, waitUntilReachable: deps.waitUntilReachable };
  // Handlers are registered ONCE and BEFORE any connect: a fast renderer (267ms cold start) must
  // never race "No handler registered". Queries pre-sync return [].
  if (!registered) {
    registered = true;
    await registerIpc({ agentLog, ptys, killTaskPtys });
  }
  // every connection boots — its own replica, its own stream, its own agent host, its own bell
  await Promise.all(connections.all().filter((c) => !c.dormant).map((c) => bootConnection(c, bootDeps!).catch((err) => console.error(`boot ${c.id} failed:`, err))));
  return { db: activeDb(), agentLog };
}

// ── the IPC wall: registered once, every handler reads the foreground connection ─────────────
async function registerIpc({ agentLog, ptys, killTaskPtys }: { agentLog: AgentLog; ptys: Map<string, PtyTerm>; killTaskPtys: (n: number) => void }): Promise<void> {
  const db = activeDb;
  const watchers = new Map<string, AbortController>();
  const procWatchers = new Map<string, () => void>(); // background-processes 'change' subscribers, by subId

  registerTerminals({ db, ptys, procWatchers }); registerLocalEngineering({ db }); // + Code on this Mac (the desktop Code bridge, slice B1)
  registerWorkspaceFiles();
  registerAgents({ db, ws });
  registerSkills({ db, ws, watchers });
  registerContent({ db, ws });
  registerProjects({ ws });
  registerSettings({ db, ws });
  registerLogs({ agentLog, watchers });

  // Persist chat attachments as artifact rows linked to their message. Bytes are already on
  // disk (staged on add); here we write only the synced metadata + thumbnail, AFTER the message
  // row so the upload order keeps the message_id FK valid on the server.
  const insertAttachments = async (
    messageId: string,
    channelId: string,
    taskId: string | null,
    attachments: Array<{ id: string; name: string; mime: string }>,
  ): Promise<void> => {
    for (const a of attachments) {
      if (!getStaged(a.id) && !hasAttachment(a.id)) continue; // bytes missing — skip silently
      const meta = getStaged(a.id);
      const kind = a.mime.startsWith('image/') ? 'screenshot' : 'file';
      const size = meta?.size ?? (await attachmentSize(a.id));
      await db().execute(
        `insert into artifacts (id, workspace_id, channel_id, task_id, message_id, kind, name, mime, inline_content, size_bytes, width, height, promoted, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [a.id, ws(), channelId, taskId, messageId, kind, a.name, a.mime, meta?.thumb ?? null, size ?? null, meta?.width ?? null, meta?.height ?? null, new Date().toISOString()],
      );
      clearStaged(a.id);
    }
  };

  // Single source of truth for the roster shape: BOTH the one-shot nm:roster and the live
  // nm:watch-roster push read this, so the two can't drift. That drift dropped channel_ids
  // (and emoji) from the live query and stranded the "+ add to channel" button — adding an
  // agent changed agent_channels, the live push fired, and overwrote every agent with
  // channel_ids=undefined, so membership could never read as "in channel".
  const loadRoster = async () => ({
    // `owner_user_id` + `runtimes` (0114): a machine belongs to a MEMBER and can serve only what
    // it has a login or key for. Both are what the Compute panel reads to answer "whose machines
    // are serving this workspace, and what can each of them actually run".
    // `kind` (0126): local | member | runner — what tells the workspace's cloud compute from a
    // desktop daemon. The setup tracker's two machine cards read it and nothing else can.
    machines: await db().getAll(`select id, name, platform, daemon_version, last_seen_at, owner_user_id, runtimes, kind from machines where workspace_id = ? order by name`, [ws()]),
    agents: await db().getAll(
      // `hosted_on` (0114) is where this agent is WORKING RIGHT NOW — the machine holding its
      // open run. Under shared compute `machine_id` is only provenance (who registered it), so it
      // cannot answer "whose laptop is burning whose subscription for this"; the live run can.
      // Null when the agent is idle, which is the honest answer: nowhere, at the moment.
      `select a.id, a.name, a.role, a.model, a.runtime, a.model_source, a.emoji, a.card, a.kind, a.status, a.machine_id, a.retired_at, a.description, a.brief,
        (select group_concat(c.slug, ', ') from agent_channels ac join channels c on c.id = ac.channel_id where ac.agent_id = a.id) as channels,
        (select group_concat(ac.channel_id, ',') from agent_channels ac where ac.agent_id = a.id) as channel_ids,
        (select m.name from runs r join machines m on m.id = r.machine_id
          where r.agent_id = a.id and r.state = 'running' order by r.started_at desc limit 1) as hosted_on
       from agents a where a.workspace_id = ? order by a.name`,
      [ws()],
    ),
    members: await db().getAll(`select user_id, role, display_name, compute from workspace_members where workspace_id = ? order by display_name`, [ws()]),
  });

  // The subscription handlers (sync/ipc/watch-*.ts). Registered HERE, with the other handlers,
  // and not after the boot path's awaits: the renderer subscribes immediately and its retry
  // budget is eight attempts, so a late registration is a watch that silently never attaches.
  const watchDeps = { db, watchers, watchFailed, loadRoster: () => loadRoster(), ws };
  registerRoomsWatches(watchDeps);
  registerBoardWatches(watchDeps);
  registerCrewWatches(watchDeps);
  // the rail's union over every OTHER live connection (U3b) — sync/ipc/watch-rail.ts
  registerRailWatch(watchDeps);

  // rooms — sync/ipc/rooms.ts
  registerRoomIpc({ ws, db, loadRoster: () => loadRoster() });

  // attachments, uploads, and the artifact lists — sync/ipc/artifacts.ts
  registerArtifactIpc({ db, api, apiUrl, actorId, ws });

  ipcMain.handle(
    'nm:send-thread',
    async (_e, { taskId, channelId, body, id: givenId, attachments }: { taskId: string; channelId: string; body: string; id?: string; attachments?: Array<{ id: string; name: string; mime: string }> }) => {
      const id = givenId ?? randomUUID();
      await db().execute(
        `insert into messages (id, workspace_id, channel_id, task_id, author_kind, author_id, body, created_at)
         values (?, ?, ?, ?, 'human', ?, ?, ?)`,
        [id, ws(), channelId, taskId, actorId(), body, new Date().toISOString()],
      );
      if (attachments?.length) await insertAttachments(id, channelId, taskId, attachments);
      return { id };
    },
  );

  ipcMain.handle(
    'nm:create-task',
    async (
      _e,
      { channelId, title, description, offerTo, project, repoId, baseRef, backlog, thread, kind, plan, originThread }: { channelId: string; title: string; description?: string; offerTo?: string; project?: string; repoId?: string; baseRef?: string; backlog?: boolean; thread?: string; kind?: string; plan?: { legs: string[]; subtasks?: string[]; approach: string }; originThread?: string },
    ) => {
      const res = await fetch(`${apiUrl()}/v1/commands`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          type: 'task.create',
          workspace: ws(),
          channel: channelId,
          title,
          // the ask itself, so nothing the human typed is lost to a title cap
          ...(description ? { description } : {}),
          thread,
          offerTo,
          project,
          ...(repoId ? { repo: { id: repoId, baseRef: baseRef ?? 'main' } } : {}),
          ...(backlog ? { backlog: true } : {}),
          ...(kind ? { kind } : {}),
          // plan-first units (2026-08-17): the proposal card's plan rides the human's create,
          // so the unit is born in plan_review with its journey declared and its conversation set
          ...(plan ? { plan: { legs: plan.legs, subtasks: plan.subtasks ?? [], approach: plan.approach } } : {}),
          ...(originThread ? { originThread } : {}),
        }),
      });
      if (!res.ok) throw new Error(`create-task failed ${res.status}: ${await res.text()}`);
      return res.json();
    },
  );

  ipcMain.handle(
    'nm:task-action',
    async (_e, { type, taskId, feedback, input }: { type: 'task.accept' | 'task.approve' | 'task.request_changes' | 'task.unblock' | 'task.cancel' | 'task.block' | 'task.revise_plan' | 'task.request_design' | 'task.select_design_provider' | 'task.revise_design' | 'task.approve_design' | 'task.approve_ship_plan' | 'task.revise_ship_plan' | 'task.approve_plan' | 'task.finish_subtask' | 'task.promote' | 'task.reopen'; taskId: string; feedback?: string; input?: { provider?: 'iris' | 'claude-design'; designer?: string; kind?: string } }) => {
      const res = await fetch(`${apiUrl()}/v1/commands`, {
        method: 'POST',
        headers: await authHeaders(),
        // block carries `reason`; request_changes carries `feedback`
        body: JSON.stringify({
          type,
          taskId,
          ...(feedback ? (type === 'task.block' ? { reason: feedback } : { feedback }) : {}),
          ...(type === 'task.request_design' || type === 'task.select_design_provider' ? input : {}),
        }),
      });
      const text = await res.text();
      let body: Record<string, unknown>;
      try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = { error: text.slice(0, 140) }; }
      if (!res.ok) throw new Error((body['error'] as string) ?? `task action failed ${res.status}`);
      return body;
    },
  );

  // task edits, the ship checklist, and shared compute — sync/ipc/task.ts
  registerTaskIpc({ ws, db, api, actorId });

  // Agent Retro (docs/14): server-side aggregation over the events log + facts —
  // events/facts are deliberately unsynced, so the view fetches on demand and the
  // renderer keeps its own last-known cache for offline honesty.
  // the launcher's "Give me ideas": the orchestrator's live read of the room
  ipcMain.handle('nm:launcher-ideas', async (_e, { channelId, mode }: { channelId: string; mode: 'task' | 'routine' }) =>
    launcherIdeas(channelId, mode === 'routine' ? 'routine' : 'task').catch(() => null));
  ipcMain.handle('nm:retro', async (_e, { range }: { range: string }) => {
    const res = await fetch(`${apiUrl()}/v1/retro?workspace=${ws()}&range=${encodeURIComponent(range)}`, {
      headers: await authHeaders(),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error((body['error'] as string) ?? `retro failed ${res.status}`);
    return body;
  });

  // invites, membership, and switching workspaces — sync/ipc/membership.ts
  registerMembershipIpc({ ws, db, api, session: () => cur().session, needsOnboarding: () => cur().needsOnboarding, apiUrl, actorId,
    refreshPendingInvites: () => refreshPendingInvites(cur()), switchWorkspace, connectionSummaries, setForeground });

  // messages — sync/ipc/messages.ts
  registerMessageIpc({ ws, db, api, actorId, insertAttachments, watchers });

  // whiteboards (docs/38): the human write lane — sync/ipc/whiteboards.ts
  registerWhiteboardIpc({ ws, db, actorId, apiUrl });

  ipcMain.handle('nm:this-machine', () => thisMachineId());

  ipcMain.handle(
    'nm:agent-register',
    async (_e, input: { name: string; role: string; model: string; runtime?: string; emoji?: string; channels: string[]; apiKey?: string; description?: string; brief?: string }) => {
      const machineId = thisMachineId();
      if (!machineId) throw new Error('machine not registered yet — try again in a moment');
      const runtime = input.runtime ?? 'claude-code';
      const { agentId } = (await api('/v1/commands', {
        type: 'agent.register',
        workspace: ws(),
        machineId,
        name: input.name,
        role: input.role,
        model: input.model,
        runtime,
        emoji: input.emoji,
        // the two strings (0110) — omitted rather than sent empty, so a create with blank
        // fields leaves them null instead of tripping the server's min(1)
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        ...(input.brief?.trim() ? { brief: input.brief.trim() } : {}),
        channels: input.channels,
      })) as { agentId: string };

      if (input.apiKey) {
        // store the per-agent key under the runtime's provider (codex→openai, gemini→gemini)
        const provider = runtime === 'codex' ? 'openai' : runtime === 'gemini' ? 'gemini' : 'anthropic';
        await api('/v1/commands', {
          type: 'credential.set', workspace: ws(), scope: 'agent', agentId, provider, token: input.apiKey,
        });
      }
      return { agentId };
    },
  );

  // marketing seeds fire from the kind-set IPC too (projects.ts) — on the foreground connection
  ensureMarketingSeedsRef = (workspaceId, channelIds) => ensureMarketingSeeds(cur(), activeDb(), workspaceId, channelIds);

  // Dev fixtures (nm:debug-seed-*) register ONLY when the harness opts in, and the module
  // is imported lazily so a signed build never carries them at all — they used to ship in
  // every release, merely unreachable. AWAITED, not fire-and-forget: a shot mode that seeds
  // once would lose its call if the import were still resolving.
  if (process.env['NM_ALLOW_DEBUG'] === '1') {
    const { registerDebugSeed } = await import('./sync/ipc/debug-seed');
    registerDebugSeed({ db, agentLog });
  }

  ipcMain.handle('nm:welcomed', async () => {
    const rows = await db().getAll(`select 1 as x from messages where workspace_id = ? and author_kind = 'human' limit 1`, [ws()]);
    return { welcomed: rows.length > 0 };
  });

  // memory recall + the two deletions — sync/ipc/account.ts
  registerAccountIpc({ ws, api, setNeedsOnboarding: (v) => { cur().needsOnboarding = v; } });

  // nm:bootstrap hands the renderer everything the boot sequence resolved for the FOREGROUND
  // connection (the workspace, the memberships, the pending invites, whether onboarding is
  // needed), plus which connection that is — the foot's glyph and the sync mark read it.
  ipcMain.handle('nm:bootstrap', () => {
    const c = cur();
    return {
      needsOnboarding: c.needsOnboarding,
      // ONLY set when a real workspace was left unfinished. A first-ever run must not receive one:
      // the wizard reads it as "the workspace step is already done" and would skip creating it.
      resumeWorkspaceId: c.resumeWorkspaceId,
      machineName: machineName(),
      workspace: c.wsInfo,
      workspaceId: c.ws,
      // The switcher renders from the first frame (offline included) rather than waiting on a
      // round trip, and `invites` is what lets the renderer put the join card in front of the
      // onboarding wizard when needsOnboarding is true.
      workspaces: c.session.wsMemberships,
      invites: c.session.pendingInvites,
      connection: { id: c.id, kind: c.kind, authMode: c.authMode, webUrl: c.webUrl || BAKED.webUrl, ...(movedOf(c) ? { moved: movedOf(c)! } : {}) },
      // a local connection between the stack's `ready` and its /v1/workspaces answer: the shell
      // must not flash for that beat, so the splash holds (a cloud boot keeps its marker fallback)
      resolving: c.kind === 'local' && !c.wsAuthoritative,
    };
  });

  registerOnboardIpc({ agentLog, killTaskPtys });
}
