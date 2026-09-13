// DEV-ONLY PowerSync credential for the local web harness.
//
// Without this the browser could not be tested locally at all: `fetchCredentials` mints its
// PowerSync token from a Clerk session, so a harness pointed at the dev stack (which has no Clerk)
// threw "no clerk session — sign in first", never connected, and left an empty replica. Every web
// change therefore had to be verified by deploying and asking a human to look — which is exactly
// how a black screen and an empty-looking workspace reached one.
//
// It is the SAME token main/token.ts signs for NM_AUTH=dev, rebuilt on Web Crypto because
// node:crypto does not exist in a browser. The key is the dev stack's own shared secret, already
// committed in dev/stack/powersync/powersync.yaml, and validates against nothing else — the cloud
// instance checks Clerk's RS256 JWKS.
//
// It can only fire when VITE_NM_DEV_USER is set, which is a build-time env no deployed build has.
const K_B64URL = 'TkVVUkFNRVNILVNQSUtFLUtFWS0wMDEtTkVVUkFNRVNILVNQSUtFLUtFWS0wMDE';

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (v: unknown): string => b64url(new TextEncoder().encode(JSON.stringify(v)));

/** the dev stack's HS256 PowerSync token — aud and kid must match powersync.yaml's client_auth */
export async function signDevPowerSyncToken(sub: string): Promise<string> {
  const raw = Uint8Array.from(atob(K_B64URL.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64urlJson({ alg: 'HS256', typ: 'JWT', kid: 'nm-dev' })}.${b64urlJson({ sub, aud: 'powersync-dev', iat: now, exp: now + 6 * 3600 })}`;
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}
