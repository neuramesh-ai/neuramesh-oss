import { createHmac } from 'node:crypto';

// Dev-only HS256 PowerSync token. The key + claims mirror apps/desktop/src/main/token.ts
// and dev/stack/powersync/powersync.yaml (kid nm-dev, aud powersync-dev). Used ONLY by
// the /auth/dev/token route, which is gated behind NM_ALLOW_DEV_TOKENS so it can never
// mint a token in production. This lets a non-Clerk client (the mobile app in dev mode)
// obtain a sync token against the local dev stack.
const key = Buffer.from('TkVVUkFNRVNILVNQSUtFLUtFWS0wMDEtTkVVUkFNRVNILVNQSUtFLUtFWS0wMDE', 'base64url');
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

export function signDevToken(sub: string): string {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'HS256', typ: 'JWT', kid: 'nm-dev' })}.${b64({ sub, aud: 'powersync-dev', iat: now, exp: now + 6 * 3600 })}`;
  return `${input}.${createHmac('sha256', key).update(input).digest('base64url')}`;
}
