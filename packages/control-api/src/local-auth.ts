// THE LOCAL STACK'S IDENTITY (source-release round U2, review F1).
//
// Under NM_LOCAL=1 the human is ONE seeded nm_users row (clerk_user_id 'local') and holds ONE
// per-install bearer, `nmh_…`, hashed at rest exactly like `nmm_` machine tokens. The desktop
// mints it and keeps it in the keychain; only its sha256 reaches the container, as
// NM_LOCAL_HUMAN_TOKEN_HASH. The bare x-nm-actor header stays closed here as everywhere: any
// local process — an agent in a worktree included — can reach 127.0.0.1, so a header that IS the
// actor would make self-approval one curl. A token proves the human; the header then only names
// the author (bearer-auth.ts), as on the Clerk lane. Agents keep speaking through `nmm_` tokens.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Actor } from '@neuramesh/shared';
import { resolveBearerActor, type BearerAuthStore } from './bearer-auth';
import { ActorSchema } from './commands';
import { localMode } from './localmode';
import { resolveMachineActor, type MachineAuthStore } from './machine-auth';

export const LOCAL_USER = { clerkUserId: 'local', email: 'local@neuramesh.local' } as const;
/** the HS256 key id and audience PowerSync's local config accepts (dev/stack/powersync/powersync.yaml) */
export const LOCAL_SYNC_KID = 'nm-local';
export const LOCAL_SYNC_AUD = 'powersync-local';
export const LOCAL_SYNC_TTL_SECONDS = 6 * 3600;

export function hashLocalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 'nmh_' + 48 hex and its hash. The desktop mints in production; this serves the manual path and tests. */
export function mintLocalToken(): { token: string; hash: string } {
  const token = `nmh_${randomBytes(24).toString('hex')}`;
  return { token, hash: hashLocalToken(token) };
}

/** what the token lanes read: the machine lane's store, the bearer lane's, and the local hash lookup */
export type LocalAuthStore = BearerAuthStore & MachineAuthStore & {
  userIdForLocalTokenHash(hash: string): Promise<string | null>;
};

export interface LocalSeedStore {
  seedLocalUser(input: { clerkUserId: string; email: string; tokenHash: string }): Promise<{ id: string }>;
}

/** the local user behind an `nmh_` bearer, or null. Refuses outside NM_LOCAL=1 before it ever reads. */
export async function localUserIdForBearer(store: Pick<LocalAuthStore, 'userIdForLocalTokenHash'>, bearer: string): Promise<string | null> {
  if (!localMode() || !bearer.startsWith('nmh_')) return null;
  return store.userIdForLocalTokenHash(hashLocalToken(bearer));
}

export type TokenLane = { actor: Actor } | { status: 401 | 403; code: 'AUTH_FAILED' | 'FORBIDDEN'; error: string };

/**
 * the two TOKEN lanes of /v1 auth, one dispatcher: `nmm_` (the machine, resolveMachineActor —
 * verbatim the lane that retired the bare header) and `nmh_` (the local human). Both read the
 * same x-nm-actor header for authorship and refuse an illegitimate claim rather than
 * re-attributing it.
 */
export async function resolveTokenLane(store: LocalAuthStore, bearer: string, rawHeader: string | undefined): Promise<TokenLane> {
  if (bearer.startsWith('nmm_')) {
    const header = ActorSchema.safeParse(safeJson(rawHeader ?? 'null'));
    const resolved = await resolveMachineActor(store, bearer, header.success ? header.data : null);
    return resolved ? { actor: resolved.actor } : { status: 401, code: 'AUTH_FAILED', error: 'unknown machine token' };
  }
  const userId = await localUserIdForBearer(store, bearer);
  if (!userId) return { status: 401, code: 'AUTH_FAILED', error: 'unknown local token' };
  const actor = await resolveBearerActor(store, userId, rawHeader);
  return actor ? { actor } : { status: 403, code: 'FORBIDDEN', error: 'this account cannot act as that agent' };
}

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

/** the PowerSync token for the local stack: HS256 under NM_SYNC_KEY (base64url bytes), kid nm-local, aud powersync-local */
export function signLocalSyncToken(sub: string, keyB64url: string, nowMs = Date.now()): string {
  const now = Math.floor(nowMs / 1000);
  const input = `${b64({ alg: 'HS256', typ: 'JWT', kid: LOCAL_SYNC_KID })}.${b64({ sub, aud: LOCAL_SYNC_AUD, iat: now, exp: now + LOCAL_SYNC_TTL_SECONDS })}`;
  return `${input}.${createHmac('sha256', Buffer.from(keyB64url, 'base64url')).update(input).digest('base64url')}`;
}

/**
 * boot under NM_LOCAL=1: one local user, its bearer hash from the env. Idempotent, and a changed
 * hash (the desktop re-minted after the keychain was lost) lands on the next boot. A missing or
 * malformed hash is a refusal to boot — a local stack nobody can sign in to is not a stack.
 */
export async function seedLocalUser(store: LocalSeedStore, tokenHash = process.env['NM_LOCAL_HUMAN_TOKEN_HASH']): Promise<{ id: string }> {
  if (!tokenHash || !/^[0-9a-f]{64}$/.test(tokenHash)) {
    throw new Error('NM_LOCAL_HUMAN_TOKEN_HASH must be the sha256 hex of the local nmh_ bearer (docs/local-mode.md)');
  }
  return store.seedLocalUser({ ...LOCAL_USER, tokenHash });
}

function safeJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}
