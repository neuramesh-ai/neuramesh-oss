// machine identity, from scratch (architecture.md §3.3, §4): mint/hash the machine token,
// and sign the short-lived PowerSync JWT with the machine issuer's RS256 key. no jwt
// library — a signed JWT is three base64url parts and one crypto.sign call, and owning it
// keeps the surface auditable. the public half serves from /v1/sync-jwks merged with
// clerk's keys (PowerSync accepts exactly one jwks source).
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign as cryptoSign } from 'node:crypto';
import type { Actor } from '@neuramesh/shared';

export const MACHINE_KEY_ID = 'nm-machine-1';
export const MACHINE_ISSUER = 'neuramesh-machines';

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');

/** the once-returned secret ('nmm_' + 48 hex) and the hash that lands on the row */
export function mintMachineToken(): { token: string; hash: string } {
  const token = `nmm_${randomBytes(24).toString('hex')}`;
  return { token, hash: hashMachineToken(token) };
}

export function hashMachineToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface MachineSyncClaims {
  /** the sync principal — the member for member machines, the owner for runners */
  sub: string;
  machineId: string;
  workspaceId: string;
}

/** RS256-sign a short-lived PowerSync JWT from the machine issuer key (PEM via env) */
export function signMachineSyncJwt(claims: MachineSyncClaims, privatePem: string, ttlSeconds = 900): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: MACHINE_KEY_ID }));
  const payload = b64url(
    JSON.stringify({
      sub: claims.sub,
      iss: MACHINE_ISSUER,
      aud: process.env['FLEET_JWT_AUD'] ?? 'powersync',
      iat: now,
      exp: now + ttlSeconds,
      machine_id: claims.machineId,
      workspace_id: claims.workspaceId,
    }),
  );
  const input = `${header}.${payload}`;
  const signature = cryptoSign('RSA-SHA256', Buffer.from(input), createPrivateKey(privatePem));
  return `${input}.${b64url(signature)}`;
}

/** what the /v1 middleware needs to resolve a machine bearer into an acting identity */
export interface MachineAuthStore {
  machineByTokenHash?(hash: string): Promise<{ id: string; workspace_id: string; owner_user_id: string; kind: string } | null>;
  /** which workspace an agent belongs to — the check that keeps a machine inside its own */
  agentWorkspace?(agentId: string): Promise<string | null>;
}

export interface ResolvedMachineActor {
  actor: Actor;
  machine: { id: string; workspaceId: string; kind: string };
}

/**
 * the machine lane of /v1 auth (the middleware's own roadmap: retire the bare x-nm-actor
 * header "once machine tokens exist" — they do now). the TOKEN authenticates; an
 * accompanying x-nm-actor header sets authorship (the machine is trusted for its own
 * workspace's agent-authored rows — the legacy lane's semantic, now credentialed).
 * absent a header, the machine acts as its owner (the compute.ts semantic).
 */
export async function resolveMachineActor(
  store: MachineAuthStore,
  bearer: string,
  actorHeader: Actor | null,
): Promise<ResolvedMachineActor | null> {
  if (!bearer.startsWith('nmm_') || !store.machineByTokenHash) return null;
  const row = await store.machineByTokenHash(hashMachineToken(bearer));
  if (!row) return null;
  // absent a header the machine acts as its owner — the compute.ts semantic, unchanged
  if (!actorHeader) {
    return { actor: { kind: 'human', id: row.owner_user_id }, machine: { id: row.id, workspaceId: row.workspace_id, kind: row.kind } };
  }
  if (!(await machineMayClaim(store, row, actorHeader))) return null;
  return { actor: actorHeader, machine: { id: row.id, workspaceId: row.workspace_id, kind: row.kind } };
}

/**
 * MAY THIS MACHINE CLAIM TO BE THIS ACTOR? The constraint this file's own comment always
 * described — "the machine is trusted for ITS OWN WORKSPACE's agent-authored rows" — and never
 * enforced: the workspace id was resolved, handed back on `.machine`, and then dropped by the
 * middleware, so a machine token authenticated the machine and then believed whatever identity
 * it asserted, in any workspace.
 *
 * Fails CLOSED, and refuses rather than downgrading to the owner. A machine asking to be someone
 * it is not is a bug or an attack; quietly reinterpreting it as the owner would hide both, and
 * would attribute rows to a human who did not write them.
 */
async function machineMayClaim(
  store: MachineAuthStore,
  machine: { workspace_id: string; owner_user_id: string },
  actor: Actor,
): Promise<boolean> {
  // an agent must live in this machine's workspace. shared compute means the agent need NOT
  // belong to the machine's owner — someone else's agent legitimately runs here — but it can
  // never be an agent from another workspace.
  if (actor.kind === 'agent') {
    if (!store.agentWorkspace) return false;
    return (await store.agentWorkspace(actor.id)) === machine.workspace_id;
  }
  // a human actor is the machine's OWNER and nobody else. a daemon speaks for the person whose
  // machine it is; work done for other members is agent-authored, which the branch above covers.
  if (actor.kind === 'human') return actor.id === machine.owner_user_id;
  return false;
}

/** the public JWK for the merged /v1/sync-jwks document, derived from the same PEM */
export function machinePublicJwk(privatePem: string): Record<string, unknown> {
  const jwk = createPublicKey(createPrivateKey(privatePem)).export({ format: 'jwk' }) as Record<string, unknown>;
  return { ...jwk, kid: MACHINE_KEY_ID, alg: 'RS256', use: 'sig' };
}
