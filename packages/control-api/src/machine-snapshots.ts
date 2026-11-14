// MACHINE SNAPSHOT URLS (packages/fleet/CLOUDRUN.md): a Cloud Run machine keeps its work in RAM, so a
// drain writes its worktree and box overlay to GCS and the next instance reads them back. The bytes
// never pass through here: this route mints a 30-minute V4 URL for ONE object, and the machine moves
// the bytes itself. The machine holds no bucket IAM.
//
// Scope is the token's, never the body's: the workspace and machine come from the nmm_ bearer, so a
// machine can only ever name objects under its own prefix (or its workspace's dependency cache).
// An upload is a machine write, so it is fenced by epoch (fleet-cloudrun.ts): the instance a resize
// is replacing cannot overwrite the snapshot the new one restores from. A replaced token is 409 too
// (machineFromBearer), which machined reads as EpochFencedError.
import type { Env, Hono } from 'hono';
import { z } from 'zod';
import { sqlOf } from './credits';
import { DomainError } from './errors';
import { assertEpoch, refuse } from './fleet-cloudrun';
import { machineFromBearer } from './fleet-cloudrun-boot';
import { configuredSnapshotStorage, signV4, type SnapshotStorage } from './gcs-sign';
import { bundleObject, repoBundlesOn } from './repo-bundles';
import type { Store } from './store';

export const SIGNED_URL_SECONDS = 30 * 60;
/** a key is one path segment: no slash, no leading dot, so it can never climb out of its prefix */
export const SNAPSHOT_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** op list: the start of the keys to list, or empty for all of the machine's */
export const SNAPSHOT_PREFIX = /^[A-Za-z0-9._-]{0,64}$/;
/** op list answers at most this many keys (a 30-day bucket rule keeps a machine far below it) */
export const LIST_MAX = 2000;
/** what a resumable upload start must send, exactly: both are signed */
export const UPLOAD_HEADERS = { 'content-type': 'application/zstd', 'x-goog-resumable': 'start' } as const;

const SignSchema = z.object({
  /** bundle: a repository a person uploaded (repo-bundles.ts), read only */
  kind: z.enum(['snapshot', 'depcache', 'bundle']),
  key: z.string().regex(SNAPSHOT_KEY).optional(),
  prefix: z.string().regex(SNAPSHOT_PREFIX).optional(),
  op: z.enum(['upload', 'download', 'exists', 'list']),
  /** required on an upload from a cloudrun machine (the fence) */
  epoch: z.number().int().min(0).optional(),
}).refine((b) => (b.op === 'list' ? b.kind === 'snapshot' : b.key !== undefined));

const SNAPSHOT_SUFFIX = '.tar.zst';

/** where one machine's snapshots live: the list op reads exactly this prefix */
export function snapshotPrefix(workspaceId: string, machineId: string): string {
  return `v1/workspaces/${workspaceId}/machines/${machineId}/snapshots/`;
}

export function snapshotObject(kind: 'snapshot' | 'depcache' | 'bundle', workspaceId: string, machineId: string, key: string): string {
  if (!SNAPSHOT_KEY.test(key)) throw new DomainError('INVALID_INPUT', 'invalid snapshot key');
  if (kind === 'bundle') return bundleObject(workspaceId, key);
  return kind === 'snapshot'
    ? `${snapshotPrefix(workspaceId, machineId)}${key}${SNAPSHOT_SUFFIX}`
    : `v1/workspaces/${workspaceId}/depcache/${key}${SNAPSHOT_SUFFIX}`;
}

/** the key an object under `prefix` names, or null when it is not one of ours */
export function snapshotKeyOf(prefix: string, object: string): string | null {
  if (!object.startsWith(prefix) || !object.endsWith(SNAPSHOT_SUFFIX)) return null;
  const key = object.slice(prefix.length, -SNAPSHOT_SUFFIX.length);
  return SNAPSHOT_KEY.test(key) ? key : null;
}

/** the upload fence: a cloudrun machine must name its epoch, and only the current one may write */
export type UploadFence = (machineId: string, epoch: number | undefined) => Promise<void>;

function sqlFence(store: Store): UploadFence {
  return async (machineId, epoch) => {
    const sql = sqlOf(store);
    if (!sql) throw new DomainError('NOT_FOUND', 'fleet not served by this store');
    const [row] = await sql<{ substrate: string }[]>`select substrate from machines where id = ${machineId}::uuid`;
    if (row?.substrate !== 'cloudrun' && epoch === undefined) return;
    if (epoch === undefined) throw new DomainError('INVALID_INPUT', 'a cloudrun machine names its epoch on every upload');
    await assertEpoch(sql, machineId, epoch);
  };
}

export interface SnapshotRouteDeps {
  /** test seam; production reads NM_SNAPSHOT_GCS_BUCKET */
  storage?: SnapshotStorage | null;
  fence?: UploadFence;
  now?: () => Date;
}

/** registered ABOVE the /v1 gate (app.ts): the bearer check is this route's own, and it must tell a
 *  replaced Cloud Run token (409, machined fences) from an unknown one (401) */
export function machineSnapshotRoutes<E extends Env>(app: Hono<E>, store: Store, deps: SnapshotRouteDeps = {}): void {
  const fence = deps.fence ?? sqlFence(store);
  app.post('/v1/machines/snapshots/sign', async (c) => {
    const machine = await machineFromBearer(store, c.req.header('authorization'));
    if ('error' in machine) return c.json({ error: machine.error, code: machine.code }, machine.status);
    const parsed = SignSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Supply a kind, a key of letters, digits, dot, dash or underscore, and an op.', code: 'INVALID_INPUT' }, 400);
    const storage = deps.storage === undefined ? configuredSnapshotStorage() : deps.storage;
    if (!storage) return c.json({ error: 'Snapshot storage is not configured on this server.', code: 'SNAPSHOTS_UNAVAILABLE' }, 503);
    const { kind, op, epoch } = parsed.data;
    // THE RESTORE FALLBACK's read (lifecycle.ts restoreWork): the keys under the token's own machine
    // prefix, with sizes. A listing mints nothing and moves no bytes, so it is not fenced.
    if (op === 'list') {
      if (!storage.list) return c.json({ error: 'This server cannot list snapshots.', code: 'SNAPSHOTS_UNAVAILABLE' }, 501);
      const base = snapshotPrefix(machine.workspace_id, machine.id);
      try {
        const objects = await storage.list(`${base}${parsed.data.prefix ?? ''}`, LIST_MAX);
        const keys = objects.flatMap((o) => {
          const key = snapshotKeyOf(base, o.name);
          return key ? [{ key, size: o.size }] : [];
        });
        return c.json({ keys, truncated: objects.length >= LIST_MAX });
      } catch (e) {
        return refuse(c, e);
      }
    }
    // a bundle is a person's upload (repo-bundles.ts). A machine only reads it: a machine that could
    // write one could change the code every other machine of the workspace clones.
    if (kind === 'bundle') {
      if (!repoBundlesOn()) return c.json({ error: 'Repository bundles are off on this server.', code: 'NOT_CONFIGURED' }, 501);
      if (op === 'upload') return c.json({ error: 'A machine cannot write a repository bundle.', code: 'NOT_PERMITTED' }, 403);
    }
    const key = parsed.data.key!;
    const object = snapshotObject(kind, machine.workspace_id, machine.id, key);
    const sign = (method: 'GET' | 'POST', headers?: Record<string, string>) =>
      signV4({ bucket: storage.bucket, object, method, expiresSeconds: SIGNED_URL_SECONDS, ...(headers ? { headers } : {}), ...(deps.now ? { now: deps.now() } : {}) }, storage.signer);
    try {
      if (op === 'upload') {
        await fence(machine.id, epoch);
        const url = await sign('POST', { ...UPLOAD_HEADERS });
        console.log(`snapshot_sign machine=${machine.id} op=upload object=${object}`);
        return c.json({ url, object, method: 'POST', headers: UPLOAD_HEADERS, expiresInSeconds: SIGNED_URL_SECONDS });
      }
      const stat = await storage.stat(object);
      if (op === 'exists') return c.json({ exists: stat !== null, size: stat?.size ?? null, object });
      if (!stat) return c.json({ error: 'No snapshot has that key.', code: 'NOT_FOUND', object }, 404);
      // a depcache hit is a use: stamp it, so the depcache pass (fleet-cloudrun-retention.ts) keeps it.
      // Not awaited and never fatal: a missed stamp only makes the object look older
      if (kind === 'depcache' && storage.touch) void storage.touch(object).catch((e: unknown) => console.warn(`depcache_touch_failed object=${object}: ${e instanceof Error ? e.message : String(e)}`));
      return c.json({ url: await sign('GET'), object, method: 'GET', size: stat.size, expiresInSeconds: SIGNED_URL_SECONDS });
    } catch (e) {
      return refuse(c, e);
    }
  });
}
