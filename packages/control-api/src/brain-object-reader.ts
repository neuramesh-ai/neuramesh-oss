import { createHmac, timingSafeEqual } from 'node:crypto';
import { brainHash, configuredBrainObjects, type BrainObjectRef, type BrainObjectStore } from './brain-objects';

export const OBJECT_READ_PATH = '/v1/brain/internal/objects/read';
const MAX_BYTES = 64 * 1024 * 1024;
const signature = (key: string, expires: string, body: string) => createHmac('sha256', key).update(`${expires}\n${body}`).digest('hex');
const readerKey = () => process.env['NM_BRAIN_OBJECT_READ_KEY'] ?? '';

function validRef(value: unknown): value is BrainObjectRef {
  if (!value || typeof value !== 'object') return false;
  const r = value as BrainObjectRef;
  return r.backend === 'gcs' && typeof r.bucket === 'string' && !!r.bucket
    && typeof r.key === 'string' && /^v1\/workspaces\/[a-f0-9-]{36}\//.test(r.key) && !r.key.split('/').includes('..')
    && typeof r.generation === 'string' && /^\d+$/.test(r.generation)
    && typeof r.sha256 === 'string' && /^[a-f0-9]{64}$/.test(r.sha256)
    && Number.isSafeInteger(r.sizeBytes) && r.sizeBytes >= 0 && r.sizeBytes <= MAX_BYTES
    && typeof r.mime === 'string' && r.mime.length <= 200;
}

/** Only called with a database reference after the caller's task/workspace authorization.
 * The control API needs no GCS credentials and cannot write through this reader. */
export async function readBrainObject(ref: BrainObjectRef): Promise<Buffer> {
  const local = configuredBrainObjects();
  if (local) return local.get(ref);
  const url = process.env['NM_BRAIN_OBJECT_READ_URL'];
  const key = readerKey();
  if (!url || key.length < 32) throw new Error('Configure brain object storage to read this artifact.');
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.pathname !== OBJECT_READ_PATH || target.username || target.password || target.search || target.hash) throw new Error('Invalid private brain reader endpoint.');
  if (!validRef(ref)) throw new Error('Invalid cloud artifact reference.');
  const body = JSON.stringify(ref);
  const expires = String(Math.floor(Date.now() / 1000) + 60);
  const response = await fetch(url, { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(60_000), headers: {
    'content-type': 'application/json', 'x-nm-object-expires': expires, 'x-nm-object-signature': signature(key, expires, body),
  } });
  if (!response.ok) throw new Error(`The private artifact reader failed (${response.status}).`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The private artifact reader returned no content.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > ref.sizeBytes) throw new Error('The private artifact reader exceeded the expected size.');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (size !== ref.sizeBytes || brainHash(bytes) !== ref.sha256) throw new Error('Brain object checksum does not match');
  return bytes;
}

/** Short-lived, exact-object capability from the trusted control API. No client bearer,
 * arbitrary URL, bucket listing, mutation, or CORS access is accepted here. */
export async function serveBrainObjectRead(request: Request, objects: BrainObjectStore | null = configuredBrainObjects()): Promise<Response> {
  const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  const reject = (status: number) => Response.json({ error: 'Private artifact read unavailable.' }, { status, headers });
  const key = readerKey();
  const expires = request.headers.get('x-nm-object-expires') ?? '';
  const supplied = request.headers.get('x-nm-object-signature') ?? '';
  const now = Math.floor(Date.now() / 1000);
  if (request.method !== 'POST' || key.length < 32 || !/^\d+$/.test(expires) || Number(expires) < now || Number(expires) > now + 60 || !/^[a-f0-9]{64}$/.test(supplied)) return reject(401);
  if (Number(request.headers.get('content-length') ?? 0) > 4096) return reject(413);
  const stream = request.body?.getReader();
  if (!stream) return reject(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await stream.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 4096) return reject(413);
      chunks.push(chunk.value);
    }
  } finally { await stream.cancel().catch(() => {}); stream.releaseLock(); }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!timingSafeEqual(Buffer.from(signature(key, expires, body)), Buffer.from(supplied))) return reject(401);
  let ref: unknown;
  try { ref = JSON.parse(body); } catch { return reject(400); }
  if (!validRef(ref)) return reject(400);
  if (!objects) return reject(503);
  try {
    const bytes = await objects.get(ref);
    if (bytes.length !== ref.sizeBytes || brainHash(bytes) !== ref.sha256) return reject(502);
    return new Response(new Uint8Array(bytes), { headers: { ...headers, 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) } });
  } catch { return reject(502); }
}
