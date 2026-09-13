// the WEB nm bridge (W2, plan §3.1): the same NMBridge surface the preload serves on
// desktop, implemented over the four lanes — L1 PowerSync Web (local reads/writes),
// L2 control-api HTTP, L3 nm-relay (later), L4 flagged off with graceful absence.
//
// the shape mirrors the preview harness deliberately: window.nm is installed BEFORE
// App's module evaluates, so the bridge object exists synchronously and boots its
// data layer behind a ready promise every L1 call awaits.
//
// methods not yet wired return a per-shape safe empty and warn ONCE — the parity
// ledger (docs/design/cloud-first-2026-08/web-parity-ledger.md) is the list of what
// remains; a silent lie here would hide exactly the gap the ledger exists to name.

import { PowerSyncDatabase, WASQLiteOpenFactory, WASQLiteVFS } from '@powersync/web';
import type { PowerSyncBackendConnector } from '@powersync/common';
import { AppSchema } from '../../main/sync/schema';
import { mintSyncToken } from './webnm-credentials';
import { uploadCrudEntry, type UploadIdentity } from '../../main/sync/upload';

export interface WebNmConfig {
  apiUrl: string;
  powersyncUrl: string;
  /** the STORED clerk session id — a snapshot from sign-in, and only a fallback now. See
   *  webnm-credentials.ts for why reading it as the truth broke sync under a long-lived tab. */
  clerkSessionId(): Promise<string | null>;
  /** the id the live clerk-js client holds right now; absent in builds with no Clerk */
  liveClerkSessionId?(): Promise<string | null>;
  /** persist an id the mint had to re-derive */
  rememberClerkSessionId?(sessionId: string): void;
  /** the session is verifiably dead — land on sign-in instead of retrying it forever */
  onSessionDead?(): void;
  /** LOCAL HARNESS ONLY: a self-signed dev PowerSync token, when there is no Clerk to mint one.
   *  set solely by a build with VITE_NM_DEV_USER, so a deployed bundle never has it. */
  devPowerSyncToken?(): Promise<string>;
  /** LOCAL HARNESS ONLY: name the replica file. OPFS handle-pool locks are held by a live
   *  document, so a previous harness page still holding them makes `init()` hang forever with no
   *  error — a fresh name sidesteps it instead of fighting for the lock. */
  dbFilename?: string;
  /** a live clerk session token for /v1 bearers — null when signed out */
  clerkBearer(): Promise<string | null>;
  /** relay attach credential. Normally the Clerk bearer; local harnesses may use a separate,
   *  dev-only identity so API calls keep using x-nm-actor instead of a fake Bearer. */
  relayBearer(): Promise<string | null>;
  /** the signed-in user's internal uuid — the actor every command posts as */
  actorId(): string;
  workspaceId(): string;
}

/** /v1 auth headers: the clerk bearer (the middleware resolves the actor server-side);
 *  the legacy x-nm-actor rides only when no session exists (dev lanes). */
export async function authHeaders(cfg: WebNmConfig): Promise<Record<string, string>> {
  const bearer = await cfg.clerkBearer();
  if (bearer) return { authorization: `Bearer ${bearer}` };
  // signed out and no dev identity: send nothing rather than a forged header with an empty actor
  const actor = cfg.actorId();
  return actor ? { 'x-nm-actor': JSON.stringify({ kind: 'human', id: actor }) } : {};
}

export async function webUploadIdentity(cfg: WebNmConfig): Promise<UploadIdentity> {
  return {
    apiUrl: cfg.apiUrl,
    workspaceFallback: cfg.workspaceId(),
    defaultActor: { kind: 'human', id: cfg.actorId() },
    authHeaders: await authHeaders(cfg),
    logPrefix: '[webnm] ',
  };
}

/** L1: the web replica — wa-sqlite on OPFS, the same AppSchema as every other client */
export function openWebDb(cfg: WebNmConfig): PowerSyncDatabase {
  const connector: PowerSyncBackendConnector = {
    async fetchCredentials() {
      // the dev stack has no Clerk, so the harness signs the token the local PowerSync accepts.
      // checked FIRST and only present in a local build — see webnm-devtoken.ts.
      if (cfg.devPowerSyncToken) return { endpoint: cfg.powersyncUrl, token: await cfg.devPowerSyncToken() };
      // which session to mint from, and what a rejection means, both live in webnm-credentials.ts
      const token = await mintSyncToken({
        apiUrl: cfg.apiUrl,
        liveSessionId: () => cfg.liveClerkSessionId?.() ?? Promise.resolve(null),
        storedSessionId: () => cfg.clerkSessionId(),
        remember: (s) => cfg.rememberClerkSessionId?.(s),
        onSessionDead: () => cfg.onSessionDead?.(),
      });
      return { endpoint: cfg.powersyncUrl, token };
    },
    async uploadData(db) {
      const ident = await webUploadIdentity(cfg);
      let tx;
      while ((tx = await db.getNextCrudTransaction()) != null) {
        for (const op of tx.crud) {
          if ((await uploadCrudEntry(ident, op)) === 'unhandled') {
            console.error(`[webnm] upload_unhandled table=${op.table} op=${op.op} id=${op.id} — dropped`);
          }
        }
        await tx.complete();
      }
    },
  };
  const db = new PowerSyncDatabase({
    /**
     * MULTI-TAB OFF, and this is what makes the browser sync at all.
     *
     * The web SDK defaults `enableMultiTabs` true wherever SharedWorker exists, routing the sync
     * stream through a SharedWorker. In this app that worker never comes up: `connect()` is
     * reached, never calls `fetchCredentials`, never rejects, and leaves the client idle at
     * connected:false / connecting:false with no stream subscriptions — so the replica stays
     * empty and every room reads as "nothing here yet". Silent, which is why it went unnoticed.
     *
     * Established by controlled comparison in the local harness, same bundle each time:
     *   dev server + isolation, multi-tab ON    → no sync
     *   dev server + isolation, multi-tab OFF   → syncs: 14 channels, 6 members, 9 projects
     *   PRODUCTION BUILD + isolation, ON        → no sync
     *   production build, isolation REMOVED, ON → still no sync
     * So it is the shared worker, not COOP/COEP, and it fails in a built bundle too — which is
     * why hq has been showing empty workspaces.
     *
     * The cost is real and small: each tab syncs for itself rather than sharing one stream. That
     * is the trade PowerSync's own guidance points at (configure this flag on SharedWorker
     * availability), and a second tab costing some bandwidth beats no tab syncing at all.
     */
    flags: { enableMultiTabs: false },
    schema: AppSchema,
    database: new WASQLiteOpenFactory({ dbFilename: cfg.dbFilename ?? 'nm-web.db', vfs: WASQLiteVFS.OPFSCoopSyncVFS }),
  });
  // A SILENT CONNECT FAILURE IS THE WORST FAILURE THIS CLIENT HAS: the replica stays empty, every
  // room list reads as "nothing here yet", and the app looks like a workspace with no content
  // instead of one it cannot reach. `void` swallowed exactly that. Say it, loudly, once.
  // INIT BEFORE CONNECT. Connecting an uninitialised database left the client silently IDLE —
  // status reported connected:false, connecting:false, no error and no stream subscriptions, so
  // the replica stayed empty and every room read as "nothing here yet". The node SDK the desktop
  // uses opens on first access; the web SDK wants init() first, and skipping it fails quietly
  // rather than loudly, which is why it went unnoticed.
  // NO SESSION, NO CONNECT. A signed-out page has no credential to mint, and a connect that
  // cannot mint retries against the sign-in screen for nothing. Sign-in ends in a reload
  // (webnm-auth.ts), and the reloaded page connects.
  void db
    .init()
    .then(async () => {
      if (cfg.devPowerSyncToken || (await cfg.clerkBearer())) return db.connect(connector);
      console.log('[webnm] signed out: the replica waits for sign-in');
    })
    .catch((e: unknown) => {
      console.error('[webnm] PowerSync connect FAILED — the replica will stay empty:', e);
    });
  return db;
}

/** L2: the command lane — the same POST /v1/commands every client speaks */
export async function postCommand(cfg: WebNmConfig, command: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${cfg.apiUrl}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders(cfg)) },
    body: JSON.stringify(command),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(body['error'] ?? `command failed ${res.status}`));
  return body;
}

const warned = new Set<string>();
function notYet(name: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`[webnm] ${name} not wired yet — see the web parity ledger`);
}

/**
 * An unwired lane must be INERT, not fatal.
 *
 * This used to resolve `undefined`, on the reasoning that "a crash here is a parity gap
 * surfacing, which is the point". It stopped being the point the moment the browser had real
 * data: with 177 of 212 methods still unwired, every surface that rendered reached one, and
 * `(await nm.connectors()).connectors` or `rows.length` took the WHOLE APP down to a black
 * screen — reported from live use. A blank page names no gap at all; the console line does.
 *
 * So the default is an empty value that survives being read like anything: it IS an array (so
 * `.length`, `.map`, spread and iteration all behave), and any other property yields the same
 * empty again, so `result.connectors.map(...)` walks instead of throwing.
 *
 * The trade-off, stated plainly: `if (result.thing)` is TRUTHY here where a real absent value
 * would be falsy, so an unwired surface can render an empty shell rather than its "nothing yet"
 * state. That is a strictly better failure than a black screen, and it is temporary — every one
 * of these is a lane waiting to be wired, and the warn-once line names it.
 */
const EMPTY: unknown = new Proxy([] as unknown[], {
  get(target, prop, receiver): unknown {
    // SYMBOLS ARE PROTOCOL, NOT DATA — they must answer exactly as the array would, never with
    // another empty. Returning one for `Symbol.toPrimitive` made every numeric coercion CALL an
    // object: `Math.max(1, p.nm.budgetBytes)` threw "object is not a function" and blanked the
    // page, which is the same black screen this proxy was written to prevent. Caught in the local
    // web harness. Symbol.iterator still works because arrays own it.
    if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
    // real array behaviour next: length, map/filter/forEach, JSON
    if (prop in target) return Reflect.get(target, prop, receiver);
    // never look thenable — an awaited proxy that answers `then` would never settle
    if (prop === 'then') return undefined;
    return EMPTY;
  },
});

/** default shapes for unwired methods: watches get a no-op unsubscribe, everything else resolves
 *  the inert empty above. */
function fallbackFor(name: string): unknown {
  return (..._args: unknown[]) => {
    notYet(name);
    if (name.startsWith('on') || name.startsWith('watch')) return () => {};
    return Promise.resolve(EMPTY);
  };
}

export interface WebNmHandles {
  db: PowerSyncDatabase;
}

/** build the bridge: live overrides over a warn-once fallback proxy. the override map
 *  grows slice by slice; the ledger names what's left. */
export function makeWebNm(cfg: WebNmConfig, db: PowerSyncDatabase, overrides: Record<string, unknown>): { nm: unknown; handles: WebNmHandles } {
  const base: Record<string, unknown> = {
    // the platform marker the renderer reads (lib/platform.ts) — desktop carries the
    // electron version here, the screenshot harness 'preview'. copy that says "this Mac"
    // branches off this, so it must be a real value, never the warn-once proxy fallback.
    electron: 'web',
    ...overrides,
  };
  const nm = new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return fallbackFor(prop);
    },
  });
  return { nm, handles: { db } };
}
