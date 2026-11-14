// The login vault's crypto (vault-crypto.ts): a sealed row opens only for the machine, the workspace
// and the generation it was sealed for, any tampered byte fails, and the KMS wrapper sends the AAD.
import { describe, expect, it } from 'vitest';
import { decodeVaultKey, kmsWrapper, localWrapper, openVault, sealVault, vaultConfigOf, LOCAL_KEY_REF } from './vault-crypto';

const KEY = Buffer.alloc(32, 9);
const WS = '0f0f0f0f-0000-4000-8000-000000000001';
const M = '1a1a1a1a-0000-4000-8000-000000000001';
const plain = Buffer.from(JSON.stringify({ v: 1, files: [{ path: '.config/gh/hosts.yml', data: 'Z2l0aHViLmNvbTo=' }] }));

describe('vault crypto: envelope bound to one machine', () => {
  it('round-trips, and the ciphertext holds no plaintext', async () => {
    const w = localWrapper(KEY);
    const sealed = await sealVault(w, plain, WS, M, 3);
    expect(sealed.keyRef).toBe(LOCAL_KEY_REF);
    expect(sealed.iv).toHaveLength(12);
    expect(sealed.tag).toHaveLength(16);
    expect(sealed.ciphertext.includes(Buffer.from('hosts.yml'))).toBe(false);
    expect((await openVault([w], sealed, WS, M, 3)).equals(plain)).toBe(true);
  });

  it('refuses another machine, another workspace, another generation, and another key', async () => {
    const w = localWrapper(KEY);
    const sealed = await sealVault(w, plain, WS, M, 3);
    await expect(openVault([w], sealed, WS, '1a1a1a1a-0000-4000-8000-000000000002', 3)).rejects.toThrow();
    await expect(openVault([w], sealed, '0f0f0f0f-0000-4000-8000-000000000002', M, 3)).rejects.toThrow();
    await expect(openVault([w], sealed, WS, M, 4)).rejects.toThrow();
    await expect(openVault([localWrapper(Buffer.alloc(32, 8))], sealed, WS, M, 3)).rejects.toThrow();
    await expect(openVault([], sealed, WS, M, 3)).rejects.toThrow(/No vault key named local:v1/);
  });

  it('refuses a tampered iv, tag, ciphertext or wrapped key', async () => {
    const w = localWrapper(KEY);
    const sealed = await sealVault(w, plain, WS, M, 1);
    const flip = (b: Buffer): Buffer => { const c = Buffer.from(b); c[0] = c[0]! ^ 1; return c; };
    for (const field of ['iv', 'tag', 'ciphertext', 'wrappedKey'] as const) {
      await expect(openVault([w], { ...sealed, [field]: flip(sealed[field]) }, WS, M, 1), field).rejects.toThrow();
    }
  });

  it('a fresh data key per seal: the same files never give the same bytes', async () => {
    const w = localWrapper(KEY);
    const a = await sealVault(w, plain, WS, M, 1);
    const b = await sealVault(w, plain, WS, M, 1);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedKey.equals(b.wrappedKey)).toBe(false);
  });
});

describe('vault config', () => {
  it('is off unless NM_VAULT=1, and on with no key it has no writer', () => {
    expect(vaultConfigOf({}).enabled).toBe(false);
    expect(vaultConfigOf({ NM_VAULT_KEY: KEY.toString('base64') }).enabled).toBe(false);
    expect(vaultConfigOf({ NM_VAULT: '1' })).toMatchObject({ enabled: true, writer: null, readers: [] });
    expect(vaultConfigOf({ NM_VAULT: '1', NM_VAULT_KEY: KEY.toString('base64') }).writer?.ref).toBe(LOCAL_KEY_REF);
  });

  it('takes base64 and base64url, and refuses a key that is not 32 bytes', () => {
    expect(decodeVaultKey(KEY.toString('base64')).equals(KEY)).toBe(true);
    expect(decodeVaultKey(Buffer.alloc(32, 0xfb).toString('base64url')).equals(Buffer.alloc(32, 0xfb))).toBe(true);
    expect(() => decodeVaultKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => vaultConfigOf({ NM_VAULT: '1', NM_VAULT_KEY: 'not base64!' })).toThrow(/not base64/);
  });

  it('a KMS key writes, and the server secret stays a reader while rows move', () => {
    const cfg = vaultConfigOf({ NM_VAULT: '1', NM_VAULT_KEY: KEY.toString('base64'), NM_VAULT_KMS_KEY: 'projects/p/locations/us-east4/keyRings/nm/cryptoKeys/vault' });
    expect(cfg.writer?.ref).toBe('projects/p/locations/us-east4/keyRings/nm/cryptoKeys/vault');
    expect(cfg.readers.map((r) => r.ref)).toEqual(['projects/p/locations/us-east4/keyRings/nm/cryptoKeys/vault', LOCAL_KEY_REF]);
    expect(() => kmsWrapper('projects/p/keyRings/x')).toThrow(/CryptoKey/);
  });
});

describe('vault crypto: the KMS wrapper', () => {
  it('sends the AAD to KMS on both calls, and a refusal is an error', async () => {
    const calls: Array<{ url: string; body: Record<string, string> }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      calls.push({ url, body });
      // a stand-in KMS: "ciphertext" is the plaintext reversed, and the AAD must match
      if (url.endsWith(':encrypt')) return new Response(JSON.stringify({ ciphertext: Buffer.from(Buffer.from(body['plaintext']!, 'base64').reverse()).toString('base64'), aad: body['additionalAuthenticatedData'] }));
      if (body['additionalAuthenticatedData'] !== calls[0]!.body['additionalAuthenticatedData']) return new Response('{}', { status: 400 });
      return new Response(JSON.stringify({ plaintext: Buffer.from(Buffer.from(body['ciphertext']!, 'base64').reverse()).toString('base64') }));
    }) as unknown as typeof fetch;
    const w = kmsWrapper('projects/p/locations/us-east4/keyRings/nm/cryptoKeys/vault', { fetchFn: fake, token: async () => 't' });
    const sealed = await sealVault(w, plain, WS, M, 2);
    expect((await openVault([w], sealed, WS, M, 2)).equals(plain)).toBe(true);
    expect(calls[0]!.url).toBe('https://cloudkms.googleapis.com/v1/projects/p/locations/us-east4/keyRings/nm/cryptoKeys/vault:encrypt');
    expect(Buffer.from(calls[0]!.body['additionalAuthenticatedData']!, 'base64').toString()).toBe(`nm-vault-key:v1:${WS}:${M}`);
    await expect(openVault([w], sealed, WS, '1a1a1a1a-0000-4000-8000-000000000002', 2)).rejects.toThrow(/Cloud KMS decrypt failed \(400\)/);
  });
});
