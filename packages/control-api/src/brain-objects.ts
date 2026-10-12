import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GoogleAuth } from 'google-auth-library';

export interface BrainObjectRef {
  backend: 'file' | 'gcs';
  bucket?: string;
  key: string;
  generation?: string;
  sha256: string;
  sizeBytes: number;
  mime: string;
}
export interface BrainObjectStore {
  put(key: string, bytes: Buffer, mime: string): Promise<BrainObjectRef>;
  get(ref: BrainObjectRef): Promise<Buffer>;
}
export const brainHash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

function verified(bytes: Buffer, ref: BrainObjectRef): Buffer {
  if (bytes.length !== ref.sizeBytes || brainHash(bytes) !== ref.sha256) throw new Error('Brain object checksum does not match');
  return bytes;
}

export class FileBrainObjects implements BrainObjectStore {
  constructor(private readonly root: string) {}
  private path(key: string): string {
    const root = resolve(this.root);
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error('Invalid brain object path');
    return path;
  }
  async put(key: string, bytes: Buffer, mime: string): Promise<BrainObjectRef> {
    const ref: BrainObjectRef = { backend: 'file', key, sha256: brainHash(bytes), sizeBytes: bytes.length, mime };
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, bytes, { mode: 0o600, flag: 'wx', flush: true });
      try { await link(temp, path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    } finally { await rm(temp, { force: true }); }
    verified(await readFile(path), ref);
    return ref;
  }
  async get(ref: BrainObjectRef): Promise<Buffer> {
    if (ref.backend !== 'file') throw new Error('Brain object backend does not match');
    return verified(await readFile(this.path(ref.key)), ref);
  }
}

export class GcsBrainObjects implements BrainObjectStore {
  private readonly auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/devstorage.read_write'] });
  private localToken: { token: string; expiresAt: number } | undefined;
  constructor(private readonly bucket: string) {}
  private async request(url: string, init?: RequestInit): Promise<Response> {
    let token: string | null | undefined;
    const localHarness = process.env['NM_ALLOW_ACTOR_HEADER'] === '1' && ['127.0.0.1', '::1', 'localhost'].includes(process.env['HOST'] ?? '');
    if (process.env['NM_BRAIN_GCS_AUTH'] === 'gcloud' && process.env['NODE_ENV'] !== 'production' && (process.env['NM_LOCAL'] === '1' || localHarness)) {
      if (!this.localToken || this.localToken.expiresAt < Date.now()) {
        const configuration = process.env['NM_BRAIN_GCS_GCLOUD_CONFIGURATION'];
        const { stdout } = await promisify(execFile)('gcloud', [...(configuration ? [`--configuration=${configuration}`] : []), 'auth', 'print-access-token'], { timeout: 30_000, maxBuffer: 64_000 })
          .catch(() => { throw new Error('The local Google Cloud sign-in is unavailable. Sign in to the selected gcloud configuration, then retry.'); });
        this.localToken = { token: stdout.trim(), expiresAt: Date.now() + 5 * 60_000 };
      }
      token = this.localToken.token;
    } else token = await this.auth.getAccessToken();
    if (!token) throw new Error('Google Application Default Credentials are unavailable');
    return fetch(url, { ...init, signal: AbortSignal.timeout(60_000), headers: { ...init?.headers, authorization: `Bearer ${token}` } });
  }
  async put(key: string, bytes: Buffer, mime: string): Promise<BrainObjectRef> {
    const ref: BrainObjectRef = { backend: 'gcs', bucket: this.bucket, key, sha256: brainHash(bytes), sizeBytes: bytes.length, mime };
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(key)}`;
    const response = await this.request(url, { method: 'POST', headers: { 'content-type': mime }, body: new Uint8Array(bytes) });
    if (response.status === 412) {
      const metadata = await this.request(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(key)}`);
      if (!metadata.ok) throw new Error(`Brain object metadata failed (${metadata.status})`);
      ref.generation = (await metadata.json() as { generation: string }).generation;
    } else {
      if (!response.ok) throw new Error(`Brain object upload failed (${response.status})`);
      ref.generation = (await response.json() as { generation: string }).generation;
    }
    // Read-after-write verifies the exact immutable generation before the DB may publish it.
    await this.get(ref);
    return ref;
  }
  async get(ref: BrainObjectRef): Promise<Buffer> {
    if (ref.backend !== 'gcs' || ref.bucket !== this.bucket || !ref.generation) throw new Error('Brain object backend does not match');
    const response = await this.request(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(ref.key)}?alt=media&generation=${encodeURIComponent(ref.generation)}`);
    if (!response.ok) throw new Error(`Brain object download failed (${response.status})`);
    return verified(Buffer.from(await response.arrayBuffer()), ref);
  }
}

let configured: { key: string; store: BrainObjectStore } | undefined;
export function configuredBrainObjects(): BrainObjectStore | null {
  const bucket = process.env['NM_BRAIN_GCS_BUCKET'];
  const root = process.env['NM_BRAIN_STORAGE_DIR'];
  const key = JSON.stringify([bucket, root, process.env['NM_LOCAL'], process.env['NM_BRAIN_GCS_AUTH'], process.env['NM_BRAIN_GCS_GCLOUD_CONFIGURATION'], process.env['HOST'], process.env['NODE_ENV'], process.env['NM_ALLOW_ACTOR_HEADER']]);
  if (configured?.key === key) return configured.store;
  const local = root && process.env['NM_LOCAL'] === '1' ? new FileBrainObjects(root) : null;
  const gcs = bucket ? new GcsBrainObjects(bucket) : null;
  // Enabling GCS changes the writer. References recorded before that switch must remain readable.
  const store = gcs && local ? {
    put: (key: string, bytes: Buffer, mime: string) => gcs.put(key, bytes, mime),
    get: (ref: BrainObjectRef) => ref.backend === 'file' ? local.get(ref) : gcs.get(ref),
  } : gcs ?? local;
  configured = store ? { key, store } : undefined;
  return store;
}
