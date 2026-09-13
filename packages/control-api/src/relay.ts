// nm-relay's validation backend (docs/design/cloud-first-2026-08: plan §3.5, architecture
// §4): the relay is a stateless byte-forwarder — machines hand it nmm_ tokens, browsers
// hand it clerk bearers, and it asks these two endpoints who they are. RELAY_SECRET gates
// both (the fleet-secret idiom, verbatim); the relay holds no keys and verifies nothing.
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { verifyClerkToken } from './clerk';
import { hashMachineToken } from './machine-auth';
import type { Store } from './store';

const ValidateMachineSchema = z.object({ token: z.string().min(1) });
const ValidateClientSchema = z.object({ clerkToken: z.string().min(1), machineId: z.string().uuid() });
const DevRelayUserSchema = z.string().uuid();

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
  const verifyClerk = deps.verifyClerk ?? verifyClerkToken;
  const relaySecretOk = (auth: string | undefined): boolean => {
    const secret = process.env['RELAY_SECRET'];
    return Boolean(secret) && auth === `Bearer ${secret}`;
  };

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
    let userId = devRelayUser(body.data.clerkToken);
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
