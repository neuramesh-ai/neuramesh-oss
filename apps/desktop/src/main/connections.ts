// THE CONNECTIONS — every backend this app talks to, and the one in the foreground.
//
// One foreground connection, every connection live (docs/design/oss-release-2026-09/review.md F2).
// The desktop used to hold ONE backend in module-level singletons: `WS`, `API_URL`, `activeDb`,
// `session`, and `AUTH_MODE` read from the environment at load. Local mode makes that a list: the
// stack on this Mac (`local`, always present outside the dev lane), the hosted cloud (`cloud`,
// present once a Clerk session is stored), and a server someone runs themselves (`custom`). Each
// opens its own replica, connects its own stream, and runs its own agent host. The 236 IPC
// handlers keep their signatures and read `connections.current()` where they read the singletons,
// so the handler wall is untouched and the swap is a pointer flip — no relaunch.
//
// No electron import: this module is reached by apiauth.ts, which the daemon and every host test
// import. The registry is process state; what boots a connection lives in sync/boot.ts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PowerSyncDatabase } from '@powersync/node';
import type { Session } from './sync/ipc/membership';

export type ConnectionKind = 'local' | 'cloud' | 'custom';
export type AuthMode = 'local' | 'clerk' | 'dev' | 'supabase';

export interface ConnectionUrls {
  apiUrl: string;
  powersyncUrl: string;
  webUrl: string;
}

export interface Connection extends ConnectionUrls {
  id: string;
  kind: ConnectionKind;
  authMode: AuthMode;
  identity: { actorId: string; display: string };
  replicaPath: string;
  /** the workspace-identity marker (wsident.ts) this connection's replica is bound to */
  markerPath: string;
  db: PowerSyncDatabase | null;
  agentHostStarted: boolean;
  /** the workspace this connection stands in, and its display identity */
  ws: string;
  wsInfo: { name: string; slug: string };
  /** true once `ws` came from a successful resolution (or the dev pin) — the sole license to wipe
   *  a mismatched replica or stamp the marker */
  wsAuthoritative: boolean;
  needsOnboarding: boolean;
  resumeWorkspaceId?: string;
  session: Session;
  thisMachineId: string | null;
  thisMachineName: string;
  machineLimit: { message: string } | null;
  clerkTokenExp?: Date;
  /** local: the `nmh_` human bearer, read from the keychain at boot. Memory only, never on disk. */
  bearer?: string;
  /**
   * Listed but not booted: no replica, no driver, no first-run card. The Local connection of a
   * person who signed in to the cloud before Local mode existed starts DORMANT — an update must
   * never walk a Pro user into installing a container runtime. `nm:local-stack-start` wakes it.
   */
  dormant?: boolean;
}

/** the dev stack's seeded workspace and human — the dev lane pins both */
export const DEV_WS = 'a0000000-0000-0000-0000-00000000000a';
export const DEV_USER_DEFAULT = '00000000-0000-0000-0000-000000000001';

export const LOCAL_PORTS = { api: 8788, powersync: 58081 } as const;

/** what a connection needs before it boots — the registry mints the runtime fields */
export interface ConnectionSpec extends ConnectionUrls {
  id: string;
  kind: ConnectionKind;
  authMode: AuthMode;
}

/**
 * URL precedence: env in dev, then the connection's own values, then the baked defaults.
 *
 * `env` is read with BRACKET access on purpose: the dist build replaces `process.env.NM_API`
 * (dot access) with a literal (electron.vite.config.ts), and that literal is the BAKED value,
 * which is the last rung here, not the first. A bracket read is the real shell environment, which
 * a double-clicked app never has. The local stack ignores the env override: its address is its
 * ports, and a stray NM_API in a shell must not point Local mode at someone else's server.
 */
export function resolveUrls(kind: ConnectionKind, env: NodeJS.ProcessEnv, own: Partial<ConnectionUrls> | null, baked: ConnectionUrls): ConnectionUrls {
  const pick = (envKey: string, ownVal: string | undefined, bakedVal: string): string => {
    const fromEnv = kind === 'local' ? undefined : env[envKey]?.trim();
    return fromEnv || ownVal?.trim() || bakedVal;
  };
  return {
    apiUrl: pick('NM_API', own?.apiUrl, baked.apiUrl),
    powersyncUrl: pick('NM_POWERSYNC', own?.powersyncUrl, baked.powersyncUrl),
    webUrl: pick('NM_WEB', own?.webUrl, baked.webUrl),
  };
}

/** The two loopback ports of the stack this app runs. `NM_LOCAL_API_PORT` and `NM_LOCAL_POWERSYNC_PORT`
 *  move them, so Local mode can boot beside a dev stack that already holds 8788 and 58081 on the
 *  same Mac (a recording, a second install). The stack's compose env and the connection's URLs read
 *  this one function, so they cannot drift. Unset or not a port number means the defaults. */
export function localPortsFor(env: NodeJS.ProcessEnv): { api: number; powersync: number } {
  const port = (v: string | undefined, fallback: number): number => {
    const n = Number(v?.trim());
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
  };
  return { api: port(env['NM_LOCAL_API_PORT'], LOCAL_PORTS.api), powersync: port(env['NM_LOCAL_POWERSYNC_PORT'], LOCAL_PORTS.powersync) };
}

export const localUrls = (ports: { api: number; powersync: number } = LOCAL_PORTS): ConnectionUrls => ({
  apiUrl: `http://127.0.0.1:${ports.api}`,
  powersyncUrl: `http://127.0.0.1:${ports.powersync}`,
  webUrl: '',
});

/** the dev lane's fallback addresses — `NM_AUTH=dev` with nothing else set means the dev stack */
const DEV_URLS: ConnectionUrls = { apiUrl: `http://127.0.0.1:${LOCAL_PORTS.api}`, powersyncUrl: `http://127.0.0.1:${LOCAL_PORTS.powersync}`, webUrl: 'http://localhost:5173' };

/** a server someone runs themselves — Settings › Connections writes these (customserver.ts). `authMode`
 *  'local' means an `nmh_` bearer in the keychain under `custom-bearer:<id>`; absent means Clerk. */
export interface CustomServer { id: string; apiUrl: string; powersyncUrl?: string; webUrl?: string; authMode?: 'local' | 'clerk' }

/**
 * Which connections exist for this launch.
 *
 * `NM_AUTH` set is the dev lane, exactly as before: one connection, the named auth, the env URLs.
 * `NM_AUTH` unset is the shipped app: Local mode on this Mac, the cloud beside it once a Clerk
 * session is stored (the upgrade adds it), and any server the person added. The Clerk lane with no
 * session still lands on sign-in, because that is what an explicit `NM_AUTH=clerk` asks for.
 */
export function planConnections(env: NodeJS.ProcessEnv, facts: { clerkSignedIn: boolean; custom: CustomServer[]; baked: ConnectionUrls }): ConnectionSpec[] {
  const lane = env['NM_AUTH'];
  if (lane === 'dev') return [{ id: 'dev', kind: 'custom', authMode: 'dev', ...resolveUrls('custom', env, null, DEV_URLS) }];
  if (lane === 'supabase' || lane === 'clerk') return [{ id: 'cloud', kind: 'cloud', authMode: lane, ...resolveUrls('cloud', env, null, facts.baked) }];
  const out: ConnectionSpec[] = [{ id: 'local', kind: 'local', authMode: 'local', ...resolveUrls('local', env, null, localUrls(localPortsFor(env))) }];
  if (facts.clerkSignedIn) out.push({ id: 'cloud', kind: 'cloud', authMode: 'clerk', ...resolveUrls('cloud', env, null, facts.baked) });
  for (const c of facts.custom) out.push({ id: `custom:${c.id}`, kind: 'custom', authMode: c.authMode ?? 'clerk', ...resolveUrls('custom', env, c, facts.baked) });
  return out;
}

/**
 * Where a connection's replica and marker live. The FIRST connection of a profile keeps the paths
 * the app always used (`state/replica.db`, `identity/workspaces.json`, both resolved by
 * harness/migrate.ts) so an existing profile boots on its own data; every other connection gets a
 * sibling file named after it. A cloud replica must never be handed to the local stack — the marker
 * mismatch would read as an account change and wipe it.
 */
export function statePathsFor(spec: Pick<ConnectionSpec, 'id' | 'kind'>, primary: { replicaPath: string; markerPath: string }): { replicaPath: string; markerPath: string } {
  if (spec.id === 'dev' || spec.id === 'cloud') return primary;
  const slug = spec.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return {
    replicaPath: join(dirname(primary.replicaPath), `replica-${slug}.db`),
    markerPath: join(dirname(primary.markerPath), `workspaces-${slug}.json`),
  };
}

/** the runtime record for a spec — every mutable field at its boot value */
export function makeConnection(spec: ConnectionSpec, paths: { replicaPath: string; markerPath: string }, devUser = DEV_USER_DEFAULT): Connection {
  const dev = spec.authMode === 'dev';
  return {
    ...spec,
    ...paths,
    identity: { actorId: dev ? devUser : '', display: '' },
    db: null,
    agentHostStarted: false,
    ws: dev ? DEV_WS : '',
    wsInfo: dev ? { name: 'Acme Robotics', slug: 'acme' } : { name: '', slug: '' },
    wsAuthoritative: dev,
    needsOnboarding: false,
    session: { wsMemberships: [], pendingInvites: [] },
    thisMachineId: null,
    thisMachineName: '',
    machineLimit: null,
  };
}

/**
 * Which connection stands in front at boot. The stored choice wins when it still exists. With no
 * choice, the cloud: a person with a Clerk session is standing where they were before this update.
 * Otherwise the first connection, which is the local stack of a fresh install.
 */
export function pickForeground(stored: string | null, ids: string[]): string | null {
  if (stored && ids.includes(stored)) return stored;
  if (ids.includes('cloud')) return 'cloud';
  return ids[0] ?? null;
}

/**
 * The Local connection boots only when it is the foreground, or when this Mac has run the stack
 * before (its `.env` exists). A cloud user who never asked for Local mode gets no driver, no
 * install and no card until they open Local from the foot or Settings.
 */
export const localIsDormant = (foregroundId: string | null, localUsedBefore: boolean): boolean =>
  foregroundId !== 'local' && !localUsedBefore;

// ── the store: which connection was in the foreground, and the servers the person added ──
export interface ConnectionsStore { foreground: string | null; custom: CustomServer[] }

export function parseConnectionsStore(raw: string | null | undefined): ConnectionsStore {
  const empty: ConnectionsStore = { foreground: null, custom: [] };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as Partial<ConnectionsStore>;
    return {
      foreground: typeof v.foreground === 'string' ? v.foreground : null,
      custom: Array.isArray(v.custom) ? v.custom.filter((c): c is CustomServer => !!c && typeof c.id === 'string' && typeof c.apiUrl === 'string') : [],
    };
  } catch {
    return empty;
  }
}

export const connectionsStorePath = (userData: string): string => join(userData, 'connections.json');

export function readConnectionsStore(userData: string): ConnectionsStore {
  try { return parseConnectionsStore(readFileSync(connectionsStorePath(userData), 'utf8')); } catch { return parseConnectionsStore(null); }
}

export function writeConnectionsStore(userData: string, store: ConnectionsStore): void {
  mkdirSync(userData, { recursive: true });
  writeFileSync(connectionsStorePath(userData), JSON.stringify(store));
}

// ── the registry ──
export type ForegroundListener = (c: Connection, prev: Connection | null) => void;

const list: Connection[] = [];
let foregroundId: string | null = null;
const listeners = new Set<ForegroundListener>();
/** the LIST changed — a connection added or removed, or one whose replica just opened (boot.ts
 *  calls `notify`). The rail's union watch re-scans on it; the foreground listeners above are a
 *  different event and stay separate. */
const changeListeners = new Set<() => void>();

export const connections = {
  all: (): Connection[] => list.slice(),
  get: (id: string): Connection | undefined => list.find((c) => c.id === id),
  byApiUrl: (apiUrl: string): Connection | undefined => list.find((c) => c.apiUrl === apiUrl),
  /** the one the shell is standing in. Throws before `add`: a read here with no connection is a
   *  boot-order bug, and returning a phantom would hide it the way the dev seed once did. */
  current: (): Connection => {
    const c = (foregroundId && list.find((x) => x.id === foregroundId)) || list[0];
    if (!c) throw new Error('no connection — connections.add() runs before any handler can read one');
    return c;
  },
  /** null instead of a throw — for the boot log and the auth-status handler, which may run first */
  peek: (): Connection | null => (foregroundId && list.find((x) => x.id === foregroundId)) || list[0] || null,
  add(c: Connection): Connection {
    if (list.some((x) => x.id === c.id)) throw new Error(`connection ${c.id} already exists`);
    list.push(c);
    if (!foregroundId) foregroundId = c.id;
    connections.notify();
    return c;
  },
  remove(id: string): void {
    const i = list.findIndex((c) => c.id === id);
    if (i < 0) return;
    list.splice(i, 1);
    if (foregroundId === id) foregroundId = list[0]?.id ?? null;
    connections.notify();
  },
  /** hear the list change (add · remove · a replica opened) */
  onChanged(cb: () => void): () => void {
    changeListeners.add(cb);
    return () => { changeListeners.delete(cb); };
  },
  /** a connection's shape changed without the list changing — boot.ts fires it when a replica opens */
  notify(): void {
    for (const l of changeListeners) l();
  },
  /**
   * Bring a connection to the foreground, optionally standing in one of its workspaces. In-process:
   * the pointer flips, the listeners (the renderer push) fire, and the handlers read the new one on
   * their next call. Returns the swap time so the caller can print it against the <100ms budget.
   */
  setForeground(id: string, workspace?: string): { ms: number; changed: boolean } {
    const t0 = performance.now();
    const next = list.find((c) => c.id === id);
    if (!next) throw new Error(`no connection ${id}`);
    const prev = (foregroundId && list.find((x) => x.id === foregroundId)) || null;
    let changed = prev?.id !== next.id;
    if (workspace && workspace !== next.ws) {
      const w = next.session.wsMemberships.find((x) => x.id === workspace);
      if (!w) throw new Error('you are not a member of that workspace');
      next.ws = w.id;
      next.wsInfo = { name: w.name, slug: w.slug };
      changed = true;
    }
    foregroundId = next.id;
    if (changed) for (const l of listeners) l(next, prev);
    return { ms: performance.now() - t0, changed };
  },
  onForeground(cb: ForegroundListener): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
  /** tests only — a fresh process state */
  reset(): void {
    list.length = 0;
    foregroundId = null;
    listeners.clear();
    changeListeners.clear();
  },
};
