// THE LOGIN VAULT's crypto (machine-vault.ts, architecture §7 decision D1). Envelope encryption: each
// write gets a fresh random 32-byte data key, AES-256-GCM seals the files with it, and a KeyWrapper
// seals the data key. The wrapper is the only part that knows the server key, so moving the custody
// from a server secret (NM_VAULT_KEY) to Cloud KMS (NM_VAULT_KMS_KEY) changes no stored format: the
// row's key_ref says which wrapper reads it.
//
// WHY TWO BINDINGS. The wrap binds (workspace, machine): a wrapped key copied onto another machine's
// row does not unwrap. The GCM seal binds (workspace, machine, generation): an older ciphertext put
// back under a newer generation does not open, so a database-level rollback is caught too.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';

export const LOCAL_KEY_REF = 'local:v1';
const KMS_KEY = /^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+$/;

/** what seals the data key: a server secret today, Cloud KMS when it is configured */
export interface KeyWrapper {
  /** stored as key_ref, so a later read finds the same wrapper */
  readonly ref: string;
  wrap(dek: Buffer, aad: Buffer): Promise<Buffer>;
  unwrap(wrapped: Buffer, aad: Buffer): Promise<Buffer>;
}

/** what one row holds besides its ids and heads */
export interface SealedVault { keyRef: string; wrappedKey: Buffer; iv: Buffer; tag: Buffer; ciphertext: Buffer }

export const wrapAad = (workspaceId: string, machineId: string): Buffer => Buffer.from(`nm-vault-key:v1:${workspaceId}:${machineId}`);
export const sealAad = (workspaceId: string, machineId: string, generation: number): Buffer =>
  Buffer.from(`nm-vault:v1:${workspaceId}:${machineId}:${generation}`);

function gcmSeal(key: Buffer, plain: Buffer, aad: Buffer): { iv: Buffer; tag: Buffer; ct: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ct };
}

function gcmOpen(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer, aad: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** the server-secret wrapper: AES-256-GCM under a 32-byte key, iv | tag | wrapped key */
export function localWrapper(key: Buffer): KeyWrapper {
  if (key.length !== 32) throw new Error(`The vault key must be 32 bytes, got ${key.length}.`);
  return {
    ref: LOCAL_KEY_REF,
    async wrap(dek, aad) {
      const { iv, tag, ct } = gcmSeal(key, dek, aad);
      return Buffer.concat([iv, tag, ct]);
    },
    async unwrap(wrapped, aad) {
      if (wrapped.length < 29) throw new Error('The wrapped vault key is truncated.');
      return gcmOpen(key, wrapped.subarray(0, 12), wrapped.subarray(12, 28), wrapped.subarray(28), aad);
    },
  };
}

type Fetch = typeof fetch;

/** Cloud KMS through REST, as the runtime identity (no key file). The AAD goes to KMS too, so the
 *  wrap is bound to (workspace, machine) by KMS itself, and every unwrap is a KMS Data Access log
 *  line. Needs roles/cloudkms.cryptoKeyEncrypterDecrypter on that one key for nm-api's account. */
export function kmsWrapper(keyName: string, o: { fetchFn?: Fetch; token?: () => Promise<string> } = {}): KeyWrapper {
  if (!KMS_KEY.test(keyName)) throw new Error(`NM_VAULT_KMS_KEY=${keyName} must name a CryptoKey (projects/…/locations/…/keyRings/…/cryptoKeys/…).`);
  const fetchFn = o.fetchFn ?? fetch;
  let auth: GoogleAuth | null = null;
  const token = o.token ?? (async () => {
    auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloudkms'] });
    const t = await auth.getAccessToken();
    if (!t) throw new Error('No access token for Cloud KMS.');
    return t;
  });
  const call = async (op: 'encrypt' | 'decrypt', body: Record<string, string>): Promise<Record<string, unknown>> => {
    const res = await fetchFn(`https://cloudkms.googleapis.com/v1/${keyName}:${op}`, {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Cloud KMS ${op} failed (${res.status})`);
    return (await res.json()) as Record<string, unknown>;
  };
  return {
    ref: keyName,
    async wrap(dek, aad) {
      const out = await call('encrypt', { plaintext: dek.toString('base64'), additionalAuthenticatedData: aad.toString('base64') });
      if (typeof out['ciphertext'] !== 'string') throw new Error('Cloud KMS encrypt returned no ciphertext');
      return Buffer.from(out['ciphertext'], 'base64');
    },
    async unwrap(wrapped, aad) {
      const out = await call('decrypt', { ciphertext: wrapped.toString('base64'), additionalAuthenticatedData: aad.toString('base64') });
      if (typeof out['plaintext'] !== 'string') throw new Error('Cloud KMS decrypt returned no plaintext');
      return Buffer.from(out['plaintext'], 'base64');
    },
  };
}

/** seals the plaintext for one machine at one generation */
export async function sealVault(wrapper: KeyWrapper, plain: Buffer, workspaceId: string, machineId: string, generation: number): Promise<SealedVault> {
  const dek = randomBytes(32);
  try {
    const { iv, tag, ct } = gcmSeal(dek, plain, sealAad(workspaceId, machineId, generation));
    return { keyRef: wrapper.ref, wrappedKey: await wrapper.wrap(dek, wrapAad(workspaceId, machineId)), iv, tag, ciphertext: ct };
  } finally {
    dek.fill(0);
  }
}

/** opens a row, or throws when any binding or byte is wrong. `wrappers` finds the row's own key_ref */
export async function openVault(wrappers: ReadonlyArray<KeyWrapper>, sealed: SealedVault, workspaceId: string, machineId: string, generation: number): Promise<Buffer> {
  const wrapper = wrappers.find((w) => w.ref === sealed.keyRef);
  if (!wrapper) throw new Error(`No vault key named ${sealed.keyRef} is configured on this server.`);
  const dek = await wrapper.unwrap(sealed.wrappedKey, wrapAad(workspaceId, machineId));
  try {
    return gcmOpen(dek, sealed.iv, sealed.tag, sealed.ciphertext, sealAad(workspaceId, machineId, generation));
  } finally {
    dek.fill(0);
  }
}

/** a 32-byte key from base64 or base64url, or an error that names the variable */
export function decodeVaultKey(v: string, name = 'NM_VAULT_KEY'): Buffer {
  const trimmed = v.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) throw new Error(`${name} is not base64.`);
  const key = Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes, got ${key.length}. Make one with: openssl rand -base64 32`);
  return key;
}

export interface VaultConfig {
  /** NM_VAULT=1: the routes serve. Off, they answer 404 VAULT_OFF */
  enabled: boolean;
  /** the wrapper new writes use, or null when on with no key (the routes answer 503) */
  writer: KeyWrapper | null;
  /** every wrapper a read may need: the writer, and the server secret during a move to KMS */
  readers: KeyWrapper[];
}

/** NM_VAULT, NM_VAULT_KEY and NM_VAULT_KMS_KEY. A malformed key throws: a server that boots with a
 *  key it cannot use would refuse every machine later, with nothing in the boot log. */
export function vaultConfigOf(env: NodeJS.ProcessEnv = process.env): VaultConfig {
  if (env['NM_VAULT'] !== '1') return { enabled: false, writer: null, readers: [] };
  const local = env['NM_VAULT_KEY'] ? localWrapper(decodeVaultKey(env['NM_VAULT_KEY'])) : null;
  const kms = env['NM_VAULT_KMS_KEY'] ? kmsWrapper(env['NM_VAULT_KMS_KEY'].trim()) : null;
  const writer = kms ?? local;
  return { enabled: true, writer, readers: [kms, local].filter((w): w is KeyWrapper => w !== null) };
}
