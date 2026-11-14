// V4 signed URLs for GCS without a key file (packages/fleet/CLOUDRUN.md): the canonical request is
// built here, and the RSA signature comes from the IAM Credentials signBlob API under the runtime
// identity's own token (the signer SA holds iam.serviceAccountTokenCreator on itself, nothing more).
// The same identity reads object metadata for `exists`. No new dependency: google-auth-library is
// already how brain-objects.ts reaches GCS.
import { createHash } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';

export interface BlobSigner {
  /** the service account the signature is made as (it names the credential scope) */
  email(): Promise<string>;
  signBlob(payload: Buffer): Promise<Buffer>;
}

export interface V4Request {
  bucket: string;
  object: string;
  method: 'GET' | 'POST' | 'PUT';
  expiresSeconds: number;
  /** headers the caller MUST send as signed; host is always signed */
  headers?: Record<string, string>;
  now?: Date;
}

const HOST = 'storage.googleapis.com';
/** RFC 3986: encodeURIComponent leaves !'()* alone, the V4 canonical form does not */
const enc = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex');

/** the canonical request and string to sign (GOOG4-RSA-SHA256), pure so a test can pin it */
export function v4Canonical(r: V4Request, email: string): { path: string; query: string; stringToSign: string } {
  const datetime = (r.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const scope = `${datetime.slice(0, 8)}/auto/storage/goog4_request`;
  const path = `/${r.bucket}/${r.object.split('/').map(enc).join('/')}`;
  const headers: Record<string, string> = { host: HOST };
  for (const [k, v] of Object.entries(r.headers ?? {})) headers[k.toLowerCase()] = v.trim();
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const params: Record<string, string> = {
    'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
    'X-Goog-Credential': `${email}/${scope}`,
    'X-Goog-Date': datetime,
    'X-Goog-Expires': String(r.expiresSeconds),
    'X-Goog-SignedHeaders': signedHeaders,
  };
  const query = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k]!)}`).join('&');
  const canonicalRequest = [r.method, path, query, names.map((n) => `${n}:${headers[n]}\n`).join(''), signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  return { path, query, stringToSign: ['GOOG4-RSA-SHA256', datetime, scope, sha256hex(canonicalRequest)].join('\n') };
}

export async function signV4(r: V4Request, signer: BlobSigner): Promise<string> {
  const { path, query, stringToSign } = v4Canonical(r, await signer.email());
  const signature = (await signer.signBlob(Buffer.from(stringToSign, 'utf8'))).toString('hex');
  return `https://${HOST}${path}?${query}&X-Goog-Signature=${signature}`;
}

type Fetch = typeof fetch;

/** signBlob as the runtime identity itself: no key file, ever */
export function iamBlobSigner(auth: GoogleAuth, fetchFn: Fetch = fetch, configuredEmail = process.env['NM_SNAPSHOT_SIGNER_EMAIL']): BlobSigner {
  let email = configuredEmail;
  const getEmail = async (): Promise<string> => {
    email ??= (await auth.getCredentials()).client_email;
    if (!email) throw new Error('The snapshot signer has no service account email. Set NM_SNAPSHOT_SIGNER_EMAIL.');
    return email;
  };
  return {
    email: getEmail,
    async signBlob(payload: Buffer): Promise<Buffer> {
      const token = await auth.getAccessToken();
      const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(await getEmail())}:signBlob`;
      const res = await fetchFn(url, {
        method: 'POST', signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ payload: payload.toString('base64') }),
      });
      if (!res.ok) throw new Error(`signBlob failed (${res.status}): the signer needs iam.serviceAccountTokenCreator on itself`);
      const body = (await res.json()) as { signedBlob?: string };
      if (!body.signedBlob) throw new Error('signBlob returned no signature');
      return Buffer.from(body.signedBlob, 'base64');
    },
  };
}

/** a listing narrowed by a glob (GCS matchGlob) and resumed after a name (startOffset is inclusive) */
export interface ListOptions { matchGlob?: string; startOffset?: string }

/** where machine snapshots live and how they are reached: the route's only storage seam */
export interface SnapshotStorage {
  bucket: string;
  signer: BlobSigner;
  /** null = absent */
  stat(object: string): Promise<{ size: number } | null>;
  /** the objects under a prefix, at most `max` (paged); a storage without it cannot serve op list.
   *  `updated` (RFC 3339) lets snapshot retention spare an object that was just written */
  list?(prefix: string, max: number, opts?: ListOptions): Promise<Array<{ name: string; size: number; updated?: string; customTime?: string }>>;
  /** stamp an object as used now (its customTime): the depcache pass keeps what was used lately */
  touch?(object: string): Promise<void>;
  /** delete one object: true when it was there (snapshot retention, fleet-cloudrun-retention.ts) */
  remove?(object: string): Promise<boolean>;
}

let configured: { bucket: string; storage: SnapshotStorage } | undefined;
/** NM_SNAPSHOT_GCS_BUCKET unset = the lane is off and the route says so (503) */
export function configuredSnapshotStorage(fetchFn: Fetch = fetch): SnapshotStorage | null {
  const bucket = process.env['NM_SNAPSHOT_GCS_BUCKET'];
  if (!bucket) return null;
  if (configured?.bucket === bucket) return configured.storage;
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const storage: SnapshotStorage = {
    bucket,
    signer: iamBlobSigner(auth, fetchFn),
    async stat(object: string) {
      const token = await auth.getAccessToken();
      const res = await fetchFn(`https://${HOST}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}`, {
        headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Snapshot metadata failed (${res.status})`);
      return { size: Number(((await res.json()) as { size?: string }).size ?? 0) };
    },
    async list(prefix: string, max: number, opts: ListOptions = {}) {
      const out: Array<{ name: string; size: number; updated?: string; customTime?: string }> = [];
      let pageToken: string | undefined;
      do {
        const token = await auth.getAccessToken();
        const q = new URLSearchParams({ prefix, fields: 'items(name,size,updated,customTime),nextPageToken', maxResults: String(Math.min(1000, max - out.length)) });
        if (opts.matchGlob) q.set('matchGlob', opts.matchGlob);
        if (opts.startOffset) q.set('startOffset', opts.startOffset);
        if (pageToken) q.set('pageToken', pageToken);
        const res = await fetchFn(`https://${HOST}/storage/v1/b/${encodeURIComponent(bucket)}/o?${q.toString()}`, {
          headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`Snapshot list failed (${res.status})`);
        const body = (await res.json()) as { items?: Array<{ name?: string; size?: string; updated?: string; customTime?: string }>; nextPageToken?: string };
        for (const it of body.items ?? []) if (it.name) out.push({ name: it.name, size: Number(it.size ?? 0), ...(it.updated ? { updated: it.updated } : {}), ...(it.customTime ? { customTime: it.customTime } : {}) });
        pageToken = body.nextPageToken;
      } while (pageToken && out.length < max);
      return out;
    },
    async touch(object: string) {
      const token = await auth.getAccessToken();
      const res = await fetchFn(`https://${HOST}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?fields=customTime`, {
        method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ customTime: new Date().toISOString() }), signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok && res.status !== 404) throw new Error(`Snapshot touch failed (${res.status})`);
    },
    async remove(object: string) {
      const token = await auth.getAccessToken();
      const res = await fetchFn(`https://${HOST}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}`, {
        method: 'DELETE', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`Snapshot delete failed (${res.status})`);
      return true;
    },
  };
  configured = { bucket, storage };
  return storage;
}
