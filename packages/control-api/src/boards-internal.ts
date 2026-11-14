// CORE → nm-boards, THE SERVICE-TO-SERVICE CALL (docs/design/message-boards-2026-11/plan.md §7.3,
// "/internal keeps Google OIDC from the API's service account").
//
// nm-boards' `/internal/*` routes accept exactly one caller: nm-api's service account, proved by a
// Google-signed OIDC ID token whose audience is the address of nm-boards. On Cloud Run the metadata
// server mints that token for the service's own identity, so no secret is stored anywhere;
// google-auth-library (already a dependency, gcs-sign.ts) does the minting and caches the client per
// audience. Main verifies Google ID tokens (cron-auth.ts) and mints access tokens (gcs-sign.ts), and
// this is the one place that mints an ID token.
//
// ONE setting switches the feature on: NM_BOARDS_URL (boards-guard.ts boardsUrl). It is the base of
// every call here AND the audience nm-boards checks. With it unset Message boards is OFF for this
// deployment, and every caller here says so with `null` rather than an error: core must keep working
// on a stack that never deployed nm-boards.
//
// The fetch and the token provider are injectable, so tests prove the contract with no network.
import { boardsUrl } from './boards-guard';

/** mints an ID token for an audience; the default asks the metadata server via google-auth-library */
export type IdTokenProvider = (audience: string) => Promise<string>;

export interface BoardsInternalDeps {
  fetch?: typeof fetch;
  idToken?: IdTokenProvider;
  env?: Record<string, string | undefined>;
  /** per call, so one slow nm-boards never holds a core request for long */
  timeoutMs?: number;
}

const idTokenClients = new Map<string, Promise<{ idTokenProvider: { fetchIdToken: (a: string) => Promise<string> } }>>();

export const googleIdToken: IdTokenProvider = async (audience) => {
  let client = idTokenClients.get(audience);
  if (!client) {
    client = import('google-auth-library').then(({ GoogleAuth }) => new GoogleAuth().getIdTokenClient(audience));
    idTokenClients.set(audience, client);
    // a failed client build (no credentials yet) must not be cached forever
    client.catch(() => idTokenClients.delete(audience));
  }
  return (await client).idTokenProvider.fetchIdToken(audience);
};

export class BoardsUpstreamError extends Error {
  constructor(readonly detail: string) { super('nm-boards call failed'); }
}

/**
 * POST a JSON body to nm-boards `/internal/<path>` as nm-api. Resolves to the Response (any status —
 * the caller decides what each means), or null when Message boards is off. Throws BoardsUpstreamError
 * on a transport failure, a timeout or a token-mint failure; its `detail` is for OUR logs only.
 */
export async function postBoardsInternal(path: string, body: unknown, deps: BoardsInternalDeps = {}): Promise<Response | null> {
  const url = boardsUrl(deps.env ?? process.env);
  if (!url) return null;
  const doFetch = deps.fetch ?? fetch;
  let token: string;
  try {
    token = await (deps.idToken ?? googleIdToken)(url);
  } catch (e) {
    throw new BoardsUpstreamError(`id token: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    return await doFetch(`${url}/internal/${path.replace(/^\/+/, '')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 5_000),
    });
  } catch (e) {
    throw new BoardsUpstreamError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  }
}
