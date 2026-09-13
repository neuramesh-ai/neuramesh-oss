import { createPublicKey, generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MACHINE_ISSUER, MACHINE_KEY_ID, hashMachineToken, machinePublicJwk, mintMachineToken, signMachineSyncJwt } from './machine-auth.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());

describe('machine tokens', () => {
  it('mints nmm_ tokens whose hash is deterministic and never the token', () => {
    const { token, hash } = mintMachineToken();
    expect(token).toMatch(/^nmm_[0-9a-f]{48}$/);
    expect(hash).toBe(hashMachineToken(token));
    expect(hash).not.toContain(token);
  });
});

describe('signMachineSyncJwt', () => {
  it('produces an RS256 JWT that verifies against the exported JWK, with the right claims', () => {
    const jwt = signMachineSyncJwt({ sub: 'user-1', machineId: 'm-1', workspaceId: 'ws-1' }, pem, 900);
    const [h, p, s] = jwt.split('.');
    expect(decode(h!)).toMatchObject({ alg: 'RS256', typ: 'JWT', kid: MACHINE_KEY_ID });
    const payload = decode(p!);
    expect(payload).toMatchObject({ sub: 'user-1', iss: MACHINE_ISSUER, machine_id: 'm-1', workspace_id: 'ws-1' });
    expect(payload.exp - payload.iat).toBe(900);

    // verify signature with the public key rebuilt from the served JWK — the exact path
    // PowerSync takes through /v1/sync-jwks
    const jwk = machinePublicJwk(pem);
    const pub = createPublicKey({ key: jwk as never, format: 'jwk' });
    const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), pub, Buffer.from(s!, 'base64url'));
    expect(ok).toBe(true);
  });

  it('exports the public JWK with kid/alg/use and no private material', () => {
    const jwk = machinePublicJwk(pem);
    expect(jwk).toMatchObject({ kid: MACHINE_KEY_ID, alg: 'RS256', use: 'sig', kty: 'RSA' });
    expect(jwk['d']).toBeUndefined();
    expect(jwk['p']).toBeUndefined();
  });
});
