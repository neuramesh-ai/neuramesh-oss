// WHAT PROVES WHO WE ARE ON A /v1 CALL.
//
// Its own module rather than a corner of sync.ts, for two reasons: sync.ts imports agents.ts, so
// putting it there and importing it back would close a cycle; and this is an auth concern, not a
// sync one — the daemon, the agent host and the IPC handlers all need the same answer.
//
// The gap this closes. Every /v1 call authenticated with a bare `x-nm-actor` header: a
// SELF-ASSERTED identity that control-api accepted without verifying anything, so any caller
// could claim to be any human or agent. The middleware has always had a bearer branch that
// verifies a real Clerk token against Clerk's JWKS — the desktop simply never used it, even
// though it already mints exactly such a token every few minutes to authenticate PowerSync. So
// this sends a credential we already had rather than inventing a new one.
//
// The actor header still rides along, and that is deliberate: it carries AUTHORSHIP for the
// lanes that post as an agent rather than as the signed-in human. The server takes the bearer as
// the identity — "Bearer always wins when both are present" — so the header stops being a
// credential and becomes what it always should have been, a claim about who wrote the row, made
// by a caller the server has already authenticated.
import type { Actor } from '@neuramesh/shared';
import { connections, type AuthMode } from './connections';

/**
 * auth-clerk is loaded ON USE, not imported. It is a boot module and imports `electron` at the
 * top level, which is legal for it (electronlazy.ts: "modules that BOOT the app … may keep
 * importing electron directly") — but this module is reached by agents.ts and host/*, which
 * TESTS import. A static import here drags electron into their graph and every one of those
 * suites dies on a message about installing electron, exactly as designrework.test.ts did before
 * the lazy seam existed. Tests inject `mint`, so this path never runs in them.
 */
const defaultMint = async (apiUrl: string): Promise<string> =>
  (await import('./auth-clerk')).clerkApiToken(apiUrl);

/** the lane the ENVIRONMENT names — the daemon's answer, and the default where no connection
 *  owns the url. dev and supabase stacks have no Clerk session, so they keep the header as their
 *  whole credential — those stacks set NM_ALLOW_ACTOR_HEADER accordingly. Anything else, unset
 *  included, is Clerk. */
export const AUTH_MODE: AuthMode = process.env['NM_AUTH'] === 'dev' ? 'dev' : process.env['NM_AUTH'] === 'supabase' ? 'supabase' : 'clerk';

/**
 * The auth mode for a call to THIS api url: the connection that owns the url decides (one
 * foreground connection, every connection live — connections.ts), and the environment answers
 * where no connection does, which is the daemon and every test.
 */
export function authModeFor(apiUrl: string): AuthMode {
  return connections.byApiUrl(apiUrl)?.authMode ?? AUTH_MODE;
}

/**
 * THE CLOUD MACHINE'S OWN CREDENTIAL.
 *
 * A daemon on a cloud machine has no Clerk session and never will — its identity is the machine
 * token it was handed at provisioning (`nmm_…`, architecture.md §3.3), which control-api's /v1
 * gate already accepts: `resolveMachineActor` verifies the token and then checks the actor header
 * against the machine's workspace (an agent must live in it; a human actor must be the owner).
 *
 * Without this the mint below was attempted, threw — there is no session to mint from — and the
 * catch sent the call with NO bearer at all. Against a production gate with the header lane
 * closed that is a flat 401 on every owner-lane call the machine makes: the memory block refresh
 * looped on it every five seconds, `/v1/credentials/resolve` returned nothing so the image
 * credential looked absent, and the draw could not even POST its own error onto the card — which
 * is why a draft asked to draw sat on "still drawing" forever (George, 2026-09-05).
 *
 * Read at call time, not at module load: `machined` reads its config from the environment during
 * boot, and a value captured at import would be a snapshot of the wrong moment.
 */
const machineBearer = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const t = env['NM_MACHINE_TOKEN'];
  return t && t.startsWith('nmm_') ? t : null;
};

/**
 * THE LOCAL HUMAN'S CREDENTIAL (review F1). Local mode has no Clerk session: the desktop minted a
 * per-install `nmh_` bearer, handed the stack its hash, and keeps the secret in the OS keychain.
 * The connection carries it in memory from boot, so the header lane stays closed on the local
 * stack exactly as it is in the cloud — an agent process on this Mac cannot forge the human.
 */
const localBearer = (apiUrl: string): string | null => connections.byApiUrl(apiUrl)?.bearer ?? null;

/** the headers themselves, given a token or none — pure, so the rules are testable without a
 *  network, a Clerk session, or module mocking. */
export function authHeadersFor(actor: Actor, token: string | null): Record<string, string> {
  const head: Record<string, string> = {
    'content-type': 'application/json',
    'x-nm-actor': JSON.stringify(actor),
  };
  if (token) head['authorization'] = `Bearer ${token}`;
  return head;
}

export async function apiAuthHeaders(
  apiUrl: string,
  actor: Actor,
  /** injectable so tests need no Clerk session; production always uses the real mint */
  mint: (url: string) => Promise<string> = defaultMint,
): Promise<Record<string, string>> {
  // the machine's own token beats the mint: it IS this caller's identity, and there is no
  // Clerk session here to mint from (the mint would throw and we would send nothing)
  const machine = machineBearer();
  if (machine) return authHeadersFor(actor, machine);
  const mode = authModeFor(apiUrl);
  if (mode === 'local') return authHeadersFor(actor, localBearer(apiUrl));
  if (mode !== 'clerk') return authHeadersFor(actor, null);
  // a mint blip must not fail the call outright: send what we have and let the server decide.
  // against a server that still accepts the header this degrades to the old behaviour; against
  // one that does not, it fails honestly as a 401 rather than pretending to be someone.
  try { return authHeadersFor(actor, await mint(apiUrl)); } catch { return authHeadersFor(actor, null); }
}

/** just the bearer, for callers that assemble their own header bag (the ps_crud uploader keeps
 *  its own so machined and the desktop can share one uploader with different credentials). */
export async function apiBearerHeader(
  apiUrl: string,
  mint: (url: string) => Promise<string> = defaultMint,
): Promise<Record<string, string>> {
  const machine = machineBearer();
  if (machine) return { authorization: `Bearer ${machine}` };
  const mode = authModeFor(apiUrl);
  if (mode === 'local') { const b = localBearer(apiUrl); return b ? { authorization: `Bearer ${b}` } : {}; }
  if (mode !== 'clerk') return {};
  try { return { authorization: `Bearer ${await mint(apiUrl)}` }; } catch { return {}; }
}
