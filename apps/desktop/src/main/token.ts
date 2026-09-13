import { createHmac } from 'node:crypto';

// Dev-only HS256 token; k must match dev/stack/powersync/powersync.yaml.
// Production swaps this for Supabase-issued JWTs validated via JWKS.
const K_B64URL = 'TkVVUkFNRVNILVNQSUtFLUtFWS0wMDEtTkVVUkFNRVNILVNQSUtFLUtFWS0wMDE';
const key = Buffer.from(K_B64URL, 'base64url');

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

export function signDevToken(sub: string): string {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'HS256', typ: 'JWT', kid: 'nm-dev' })}.${b64({ sub, aud: 'powersync-dev', iat: now, exp: now + 6 * 3600 })}`;
  return `${input}.${createHmac('sha256', key).update(input).digest('base64url')}`;
}
