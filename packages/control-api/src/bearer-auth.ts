// AUTHORSHIP ON THE BEARER LANE (2026-09-09). The desktop host has sent a Clerk bearer since
// #360, with x-nm-actor carrying WHO WROTE THE ROW on the lanes that post as an agent — and the
// bearer branch of the /v1 gate discarded the claim, so every agent-authored message and command
// a desktop hosted landed under the signed-in human. rex's replies then read as George's own
// words, each one woke rex again, and #marketing looped on itself (485 rows in one evening, 300
// of them in three minutes once an add-agent card kept re-triggering its own offer).
//
// The rule mirrors the machine lane's machineMayClaim: a member may author rows for an agent of
// a workspace they belong to, and an illegitimate claim is REFUSED (null here, 403 at the gate —
// never 401, which makes the desktop sign itself out), never quietly re-attributed. A human claim
// never overrides the verified bearer: the token says who is here.
import type { Actor } from '@neuramesh/shared';
import { timingSafeEqual } from 'node:crypto';
import { ActorSchema } from './commands';
import { DomainError } from './errors';

/** THE BARE-HEADER LANE'S SECRET (the /v1 gate's lane 2). NM_ALLOW_ACTOR_HEADER=1 opens a lane where
 *  the header alone names the actor: fine on a laptop, anyone-as-anyone on a public URL. A deploy
 *  that sets NM_ACTOR_HEADER_SECRET also demands it in x-nm-actor-secret (the Cloud Run sandbox: its
 *  hq gateway and its e2e driver hold it). Unset, the lane behaves as it always did. */
export function actorSecretOk(presented: string | undefined, secret: string | undefined = process.env['NM_ACTOR_HEADER_SECRET'], env: NodeJS.ProcessEnv = process.env): boolean {
  // AN EMPTY SECRET NO LONGER OPENS THE LANE IN A PRODUCTION IMAGE (R10 lane A, NM-107). Both nm-api
  // images set NODE_ENV=production, and the Cloud Run sandbox runs the lane on a public URL: a secret
  // version gap or a config typo there made anyone any actor. Laptops and the test suites (no
  // NODE_ENV, or vitest's 'test') keep the open lane; a deliberate open production lane says so.
  if (!secret) return env['NODE_ENV'] !== 'production' || env['NM_ACTOR_HEADER_INSECURE'] === '1';
  if (typeof presented !== 'string') return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface BearerAuthStore {
  agentWorkspace(agentId: string): Promise<string | null>;
  humanMemberIds(workspace: string): Promise<string[]>;
}

/** the acting identity for the verified member `userId` and the raw x-nm-actor header; null = refuse */
export async function resolveBearerActor(store: BearerAuthStore, userId: string, rawHeader: string | undefined): Promise<Actor | null> {
  let claim: Actor | null = null;
  try { const parsed = ActorSchema.safeParse(JSON.parse(rawHeader ?? 'null')); claim = parsed.success ? parsed.data : null; } catch { claim = null; }
  if (!claim || claim.kind !== 'agent') return { kind: 'human', id: userId };
  const workspace = await store.agentWorkspace(claim.id).catch(() => null);
  if (!workspace) return null;
  return (await store.humanMemberIds(workspace)).includes(userId) ? claim : null;
}

/** THE ROLE IS THE ROW'S, NEVER THE HEADER'S (R10 lane A, NM-106). x-nm-actor may name an agent;
 *  the role it claims was believed verbatim, so a worker agent (or anything holding a machine token)
 *  could say 'orchestrator' and curate memory, link repos and offer tasks. Every lane of the /v1 gate
 *  now replaces a claimed role with the agent row's own. An agent with no row keeps no role (its
 *  writes are refused by the scope guard anyway). A LOOKUP THAT FAILS IS A 503, never a silent
 *  demotion: with no role the agent's next command got a 403, and a client reads a 403 as final.
 *  Stores without agent rows (the in-memory one) keep the claim. */
export async function withServerRole(store: { agentHome?(agentId: string): Promise<{ workspace: string; role: string | null } | null> }, actor: Actor, headerLane = false): Promise<Actor> {
  if (actor.kind !== 'agent' || !store.agentHome) return actor;
  const bare: Actor = { kind: actor.kind, id: actor.id };
  const home = await store.agentHome(actor.id).catch((e: unknown) => {
    console.error('agent role lookup failed', e);
    throw new DomainError('AUTH_UNAVAILABLE', 'the role check is unavailable, try again');
  });
  // the bare header lane is anyone-as-anyone by design (its holders may name any person): a claim
  // there with no agent row keeps its role, exactly as it keeps its identity (handler/scope.ts)
  if (home === null && headerLane) return actor;
  const role = ActorSchema.shape.role.safeParse(home?.role ?? undefined);
  return role.success && role.data ? { ...bare, role: role.data } : bare;
}

/** `Authorization: Bearer <secret>` against a shared secret, in constant time; false when the secret is
 *  unset (R10 NM-107: the e2e doors compared with ===, a timing oracle on a public URL) */
export function bearerIs(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** the e2e doors' secret: NM_E2E_SECRET when the deploy splits it out, else FLEET_SECRET (as before) */
export const e2eSecret = (env: NodeJS.ProcessEnv = process.env): string | undefined => env['NM_E2E_SECRET'] || env['FLEET_SECRET'];
