// Connector crypto — the sealed-at-rest credential and the media signature.
// The key never leaves this module; everything else asks it to seal or unseal.
// Split out of connectors.ts.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';


export const keyBytes = (): Buffer => createHash('sha256').update(String(process.env['NM_CONNECTOR_KEY'] ?? '')).digest();

/** HMAC capability sig for the TikTok media proxy URL — TikTok only pulls photos from
 * developer-verified domains, so the poster hands it OUR api host and this sig is what
 * makes that route non-open (per-item, unforgeable without the connector key). */
export const mediaSig = (itemId: string): string =>
  createHmac('sha256', keyBytes()).update(`media:${itemId}`).digest('base64url');

export const verifyMediaSig = (itemId: string, sig: string): boolean => {
  const want = Buffer.from(mediaSig(itemId));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
};

/** AES-256-GCM, base64url(iv | tag | ciphertext). Pure given the env key. */
export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}

export function unseal<T>(sealed: string): T {
  const raw = Buffer.from(sealed, 'base64url');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')) as T;
}
