// REPOSITORY BUNDLES (NM_REPO_BUNDLES=1): a repository that is not on GitHub reaches a cloud machine
// as a `git bundle` file in the workspace's own GCS prefix. A person (the desktop, a CLI, a test
// harness) makes the bundle, asks here for a signed PUT URL, uploads the file to GCS directly, and
// links it with `repo.link {url: 'nm-bundle:<key>'}`. A machine reads it back through its own sign
// route (machine-snapshots.ts, kind 'bundle', download only) and clones from the file. No GitHub,
// no App, no internet: the bytes go between GCS and the two ends, never through this process.
//
// Scope: the object lives under v1/workspaces/<ws>/repos/. On this route the workspace is the
// body's, and the caller must be a human member of it (the credit routes' check). On the machine
// route the workspace is the bearer's, so a machine can only read its own workspace's bundles.
import type { Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import { z } from 'zod';
import { configuredSnapshotStorage, signV4, type SnapshotStorage } from './gcs-sign';
import type { Store } from './store';

export const repoBundlesOn = (env: NodeJS.ProcessEnv = process.env): boolean => env['NM_REPO_BUNDLES'] === '1';

/** the clone_url a bundle row holds. It is not a URL git can fetch: only a machine that knows the
 *  scheme resolves it, and every GitHub check reads it as "not GitHub". */
export const BUNDLE_URL_PREFIX = 'nm-bundle:';
/** a key is one path segment (machine-snapshots.ts SNAPSHOT_KEY): no slash, no leading dot. Kept
 *  here, not imported, because machine-snapshots.ts imports this module. */
export const BUNDLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BUNDLE_URL = /^nm-bundle:([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;
/** the life of an upload URL: the machine sign route's 30 minutes */
export const BUNDLE_URL_SECONDS = 30 * 60;

/** the key a `nm-bundle:<key>` clone URL names, or null for any other URL */
export function bundleKeyOf(url: string | null | undefined): string | null {
  return BUNDLE_URL.exec(url ?? '')?.[1] ?? null;
}

export const BUNDLE_SUFFIX = '.bundle';
export function bundleObject(workspaceId: string, key: string): string {
  if (!BUNDLE_KEY.test(key)) throw new Error('invalid bundle key');
  return `v1/workspaces/${workspaceId}/repos/${key}${BUNDLE_SUFFIX}`;
}

/** the one content type an upload may send: it is signed, so GCS refuses any other */
export const BUNDLE_UPLOAD_HEADERS = { 'content-type': 'application/x-git-bundle' } as const;

// The storage the bundle lane reads. Tests set it, because repo.link checks that the object exists
// and the command handler takes no route deps. Production reads NM_SNAPSHOT_GCS_BUCKET.
let storageOverride: SnapshotStorage | null | undefined;
export function useRepoBundleStorage(s: SnapshotStorage | null | undefined): void { storageOverride = s; }
export function repoBundleStorage(): SnapshotStorage | null {
  return storageOverride === undefined ? configuredSnapshotStorage() : storageOverride;
}

/** a member of the workspace: a person in it, or one of its agents (credits.ts actorInWorkspace).
 *  Kept here, not imported, because credits.ts pulls in the fleet and the billing graph, and
 *  machine-snapshots.ts imports this module. */
export async function memberOf(store: Store, actor: Actor, workspace: string): Promise<boolean> {
  if (actor.kind === 'human') return (await store.humanMemberIds(workspace)).includes(actor.id);
  if (actor.kind === 'agent') return (await store.agentWorkspace(actor.id)) === workspace;
  return false;
}

/** a display name as a key stem: lower case, safe characters, short */
function keyStem(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'repo';
}

const SignSchema = z.object({
  workspace: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
});

export interface RepoBundleRouteDeps {
  /** test seam; production reads NM_SNAPSHOT_GCS_BUCKET */
  storage?: SnapshotStorage | null;
  now?: () => Date;
  /** test seam for the random part of the key */
  suffix?: () => string;
}

/** registered AFTER the /v1 gate (app.ts): it reads the actor the gate sets */
export function repoBundleRoutes<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store, deps: RepoBundleRouteDeps = {}): void {
  app.post('/v1/repos/bundles/sign', async (c) => {
    if (!repoBundlesOn()) return c.json({ error: 'Repository bundles are off on this server.', code: 'NOT_CONFIGURED' }, 501);
    const actor = c.get('actor');
    // a machine or an agent never uploads a repository: a person chooses what code a workspace holds
    if (actor.kind !== 'human') return c.json({ error: 'A person uploads a repository.', code: 'HUMAN_ONLY' }, 403);
    const body = SignSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Supply a workspace id and a repository name.', code: 'INVALID_INPUT' }, 400);
    if (!(await memberOf(store, actor, body.data.workspace))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    const storage = deps.storage === undefined ? repoBundleStorage() : deps.storage;
    if (!storage) return c.json({ error: 'Bundle storage is not configured on this server.', code: 'SNAPSHOTS_UNAVAILABLE' }, 503);
    // a fresh key for every upload: a key never names two contents, so a machine that cloned it once
    // never needs to fetch it again, and a second upload never changes what an earlier row points at
    const key = `${keyStem(body.data.name)}-${(deps.suffix ?? (() => crypto.randomUUID().slice(0, 8)))()}`;
    const object = bundleObject(body.data.workspace, key);
    const url = await signV4({ bucket: storage.bucket, object, method: 'PUT', headers: { ...BUNDLE_UPLOAD_HEADERS }, expiresSeconds: BUNDLE_URL_SECONDS, ...(deps.now ? { now: deps.now() } : {}) }, storage.signer);
    console.log(`repo_bundle_sign actor=${actor.id} workspace=${body.data.workspace} object=${object}`);
    return c.json({ key, cloneUrl: `${BUNDLE_URL_PREFIX}${key}`, url, method: 'PUT', headers: BUNDLE_UPLOAD_HEADERS, expiresInSeconds: BUNDLE_URL_SECONDS });
  });
}
