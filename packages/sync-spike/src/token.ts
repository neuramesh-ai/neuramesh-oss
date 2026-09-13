import { createHmac } from 'node:crypto';

// Must match client_auth.jwks.keys[0].k in spike/powersync/config/powersync.yaml —
// both sides decode the same base64url literal, so they cannot drift.
const K_B64URL = 'TkVVUkFNRVNILVNQSUtFLUtFWS0wMDEtTkVVUkFNRVNILVNQSUtFLUtFWS0wMDE';
const key = Buffer.from(K_B64URL, 'base64url');

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function signSpikeToken(sub = 'spike-user'): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT', kid: 'nm-dev' };
  const payload = { sub, aud: 'powersync-dev', iat: now, exp: now + 3600 };
  const input = `${b64url(header)}.${b64url(payload)}`;
  const sig = createHmac('sha256', key).update(input).digest('base64url');
  return `${input}.${sig}`;
}
