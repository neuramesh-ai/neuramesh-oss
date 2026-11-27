// nm-relay's validation backend (docs/design/cloud-first-2026-08: plan §3.5, architecture
// §4): the relay is a stateless byte-forwarder — machines hand it nmm_ tokens, browsers
// hand it clerk bearers, and it asks these two endpoints who they are. RELAY_SECRET gates
// both (the fleet-secret idiom, verbatim); the relay holds no keys and verifies nothing.
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { verifyClerkToken } from './clerk';
import { hashMachineToken } from './machine-auth';
import type { Store } from './store';
import { activationEnabled, needsActivation } from './activation';
import { sqlOf } from './credits';
import { releaseLease, takeLease } from './fleet-lease';

const ValidateMachineSchema = z.object({ token: z.string().min(1) });
const ValidateClientSchema = z.object({ clerkToken: z.string().min(1), machineId: z.string().uuid() });
const DevRelayUserSchema = z.string().uuid();
const RelayLeaseSchema = z.object({ shard: z.number().int().min(0).max(63), holder: z.string().uuid() });

// THE SANDBOX HQ RELAY TOKEN. The Cloud Run sandbox has no Clerk: IAP says who a person is, and the
// hq gateway (infra/images/hq/gateway.mjs) mints this token for that person's nm user, so several
// people can attach to their machines through one relay. Its shape is fixed by the gateway, the
// minter: HS256 under NM_E2E_RELAY_TOKEN_KEY (base64url, 32 bytes or more), header kid nm-hq-relay,
// payload {sub, aud: nm-relay, iat, exp}, a day at most. The lane is open only where the e2e doors
// are (NM_E2E_ROUTES=1), read on every call, and the token is never logged.
export const E2E_RELAY_KID = 'nm-hq-relay';
export const E2E_RELAY_AUD = 'nm-relay';
export const E2E_RELAY_MAX_TTL_S = 86_400;
export const E2E_RELAY_KEY_MIN_BYTES = 32;
const E2E_RELAY_SKEW_S = 60;
const B64URL = /^[A-Za-z0-9_-]+$/;
const E2eRelayClaimsSchema = z.object({ sub: z.string().uuid(), aud: z.literal(E2E_RELAY_AUD), iat: z.number().finite(), exp: z.number().finite() });

const jsonPart = (part: string): unknown => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

/** The nm user a sandbox relay token names, or null. Pure: the key and the clock come in, so the
 *  tests pin both. Every check fails closed, and the signature is checked before any claim is read. */
export function verifyE2eRelayToken(token: string, key: Buffer, now: number = Math.floor(Date.now() / 1000)): string | null {
  if (key.length < E2E_RELAY_KEY_MIN_BYTES) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((p) => B64URL.test(p))) return null;
  const [h, p, s] = parts as [string, string, string];
  const header = jsonPart(h) as { alg?: unknown; typ?: unknown; kid?: unknown } | null;
  if (!header || typeof header !== 'object' || header.alg !== 'HS256' || header.typ !== 'JWT' || header.kid !== E2E_RELAY_KID) return null;
  const want = createHmac('sha256', key).update(`${h}.${p}`).digest();
  const got = Buffer.from(s, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const claims = E2eRelayClaimsSchema.safeParse(jsonPart(p));
  if (!claims.success) return null;
  const { sub, iat, exp } = claims.data;
  if (exp <= now - E2E_RELAY_SKEW_S || iat > now + E2E_RELAY_SKEW_S || exp - iat > E2E_RELAY_MAX_TTL_S) return null;
  return sub;
}

/** the decoded sandbox key, or null while the lane is shut: no e2e doors, no key, or a short key */
function e2eRelayKey(): Buffer | null {
  if (process.env['NM_E2E_ROUTES'] !== '1') return null;
  const raw = process.env['NM_E2E_RELAY_TOKEN_KEY'];
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64url');
  return key.length >= E2E_RELAY_KEY_MIN_BYTES ? key : null;
}

function e2eRelayUser(token: string): string | null {
  const key = e2eRelayKey();
  return key ? verifyE2eRelayToken(token, key) : null;
}

/** Resolve the browser harness's identity token. This path is intentionally impossible unless
 * the local API process opts in: production never sets NM_ALLOW_DEV_RELAY, and a deployed web
 * bundle never sets VITE_NM_DEV_USER (the only caller that mints this shape). */
function devRelayUser(token: string): string | null {
  if (process.env['NM_ALLOW_DEV_RELAY'] !== '1') return null;
  const expected = process.env['NM_DEV_RELAY_TOKEN'];
  const parsed = DevRelayUserSchema.safeParse(process.env['NM_DEV_RELAY_USER']);
  if (!expected || expected.length < 32 || !parsed.success) return null;
  const actualBytes = Buffer.from(token);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  return parsed.data;
}

export interface RelayRouteDeps {
  /** test seam only — production always verifies through clerk.ts */
  verifyClerk?: typeof verifyClerkToken;
}

export function relayRoutes<E extends Env>(app: Hono<E>, store: Store, deps: RelayRouteDeps = {}): void {
  if (process.env['NODE_ENV'] === 'production' && process.env['NM_ALLOW_DEV_RELAY'] === '1') {
    throw new Error('NM_ALLOW_DEV_RELAY cannot be enabled in production');
  }
  // The sandbox key fails closed at boot unless the e2e doors are open too. NODE_ENV alone cannot be
  // the test here: the Cloud Run image (Dockerfile.cloudrun) runs every deploy as production, the
  // sandbox included. A process with the doors open is a sandbox by contract (e2e-routes.ts), so the
  // key may live only beside them.
  const e2eKey = process.env['NM_E2E_RELAY_TOKEN_KEY'];
  if (process.env['NODE_ENV'] === 'production' && e2eKey && process.env['NM_E2E_ROUTES'] !== '1') {
    throw new Error('NM_E2E_RELAY_TOKEN_KEY is set without NM_E2E_ROUTES=1: the sandbox relay token cannot be enabled in production');
  }
  if (e2eKey && process.env['NM_E2E_ROUTES'] === '1') {
    const bytes = Buffer.from(e2eKey, 'base64url').length;
    if (bytes < E2E_RELAY_KEY_MIN_BYTES) console.warn(`[e2e] NM_E2E_RELAY_TOKEN_KEY decodes to ${bytes} bytes, under ${E2E_RELAY_KEY_MIN_BYTES}: the sandbox relay token lane stays shut`);
    else console.warn('[e2e] NM_E2E_RELAY_TOKEN_KEY: validate-client accepts the sandbox hq relay token. Never on a deploy real people use.');
  }
  const verifyClerk = deps.verifyClerk ?? verifyClerkToken;
  const relaySecretOk = (auth: string | undefined): boolean => {
    const secret = process.env['RELAY_SECRET'];
    return Boolean(secret) && auth === `Bearer ${secret}`;
  };

  // Shard names are derived here. A relay can never choose the fleet writer's lease.
  for (const release of [false, true]) app.post(`/internal/relay/lease${release ? '/release' : ''}`, async (c) => {
    if (!relaySecretOk(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const body = RelayLeaseSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid relay lease request', code: 'INVALID_INPUT' }, 400);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'relay leases require PostgreSQL' }, 503);
    const { shard, holder } = body.data;
    if (release) return c.json({ released: await releaseLease(sql, `relay-${shard}`, holder) });
    return c.json(await takeLease(sql, `relay-${shard}`, holder, 30_000));
  });

  // machine edge: the daemon's nmm_ bearer, relayed verbatim in the body (it authenticated
  // the SOCKET, not this call). identity out on 200; 401 = unknown token, close the socket.
  app.post('/internal/relay/validate-machine', async (c) => {
    if (!relaySecretOk(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    if (!store.machineByTokenHash) return c.json({ error: 'fleet not served by this store' }, 501);
    const body = ValidateMachineSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body', issues: body.error.issues }, 400);
    if (!body.data.token.startsWith('nmm_')) return c.json({ error: 'unknown machine token' }, 401);
    const row = await store.machineByTokenHash(hashMachineToken(body.data.token));
    if (!row) return c.json({ error: 'unknown machine token' }, 401);
    return c.json({ machineId: row.id, workspaceId: row.workspace_id });
  });

  // client edge: clerk bearer + target machine in, a membership verdict out — the shape
  // that keeps the relay dumbest. auth and membership failures are 200 { allowed: false }
  // (the relay branches on one boolean); non-200 means the relay itself is misconfigured.
  app.post('/internal/relay/validate-client', async (c) => {
    if (!relaySecretOk(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    if (!store.machineWorkspace) return c.json({ error: 'fleet not served by this store' }, 501);
    const body = ValidateClientSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body', issues: body.error.issues }, 400);
    // the sandbox token answers with the nm user it names, and the machine and membership checks below
    // are the same for every lane. A token it refuses falls through to Clerk, which refuses HS256.
    let userId = devRelayUser(body.data.clerkToken) ?? e2eRelayUser(body.data.clerkToken);
    if (!userId) {
      let clerkId: string;
      try {
        clerkId = String((await verifyClerk(body.data.clerkToken)).sub);
      } catch {
        return c.json({ allowed: false });
      }
      userId = await store.userIdForClerkId(clerkId);
      if (!userId) return c.json({ allowed: false });
    }
    const machine = await store.machineWorkspace(body.data.machineId);
    if (!machine) return c.json({ allowed: false });
    const member = (await store.listWorkspaces(userId)).some((w) => w.id === machine.workspaceId);
    if (!member) return c.json({ allowed: false });
    // the trial gate reads the plan only when it is on (NM_REQUIRE_TRIAL_ACTIVATION=1): off, no extra read
    if (activationEnabled() && needsActivation(await store.workspacePlan(machine.workspaceId))) return c.json({ allowed: false });
    // A MEMBER MACHINE IS ITS OWNER'S SHELL AND NOBODY ELSE'S (member-machines plan §3): the vendor
    // logins live on it. The runner stays open to every member — it is where `gh` lives.
    if (machine.kind === 'member' && machine.ownerUserId !== userId) return c.json({ allowed: false });
    return c.json({ allowed: true, userId });
  });
}

export interface MachineAttachRow { workspaceId: string; kind: string; ownerUserId: string | null }

/** machine id → its workspace, kind and owner, live machines only — the client-attach check */
export async function machineWorkspace(sql: postgres.Sql, machineId: string): Promise<MachineAttachRow | null> {
  const [row] = await sql<{ workspace_id: string; kind: string; owner_user_id: string | null }[]>`
    select workspace_id, kind, owner_user_id from machines
     where id = ${machineId}::uuid and kind <> 'local' and (lifecycle is null or lifecycle <> 'destroyed')
     limit 1`;
  return row ? { workspaceId: row.workspace_id, kind: row.kind, ownerUserId: row.owner_user_id } : null;
}
