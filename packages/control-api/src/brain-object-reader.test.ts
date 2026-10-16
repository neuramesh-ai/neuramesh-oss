import { createHmac } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { brainHash, type BrainObjectRef } from './brain-objects';
import { OBJECT_READ_PATH, readBrainObject, serveBrainObjectRead } from './brain-object-reader';
import { artifactContent } from './store/artifact-content';

const key = 'test-only-exact-object-capability-key';
const bytes = Buffer.from('private cloud-only deliverable');
const ref: BrainObjectRef = { backend: 'gcs', bucket: 'test-private-bucket', key: 'v1/workspaces/00000000-0000-0000-0000-000000000001/threads/thread/artifacts/file/hash', generation: '12', sha256: brainHash(bytes), sizeBytes: bytes.length, mime: 'text/plain' };
const url = `https://relay.neuramesh.app${OBJECT_READ_PATH}`;
function configure() {
  vi.stubEnv('NM_BRAIN_GCS_BUCKET', ''); vi.stubEnv('NM_BRAIN_STORAGE_DIR', '');
  vi.stubEnv('NM_BRAIN_OBJECT_READ_KEY', key); vi.stubEnv('NM_BRAIN_OBJECT_READ_URL', url);
}
function request(body = JSON.stringify(ref), expires = String(Math.floor(Date.now() / 1000) + 60), signingKey = key) {
  return new Request(url, { method: 'POST', body, headers: { 'x-nm-object-expires': expires, 'x-nm-object-signature': createHmac('sha256', signingKey).update(`${expires}\n${body}`).digest('hex') } });
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('reads a cloud-only task artifact through the private service without GCS credentials on the caller', async () => {
  configure();
  const get = vi.fn().mockResolvedValue(bytes);
  vi.stubGlobal('fetch', vi.fn(async (target, init) => {
    expect(target).toBe(url); expect(init.redirect).toBe('error');
    const response = await serveBrainObjectRead(new Request(target, init), { get, put: vi.fn() });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    return response;
  }));
  expect(await artifactContent(null, ref)).toBe(bytes.toString());
  expect(get).toHaveBeenCalledWith(ref);
});

it('rejects unauthenticated, tampered, expired and overlong capabilities before accessing storage', async () => {
  configure();
  const get = vi.fn();
  const objects = { get, put: vi.fn() };
  const now = Math.floor(Date.now() / 1000);
  for (const r of [new Request(url), request(undefined, undefined, 'wrong'), request(undefined, String(now - 1)), request(undefined, String(now + 120))]) {
    expect((await serveBrainObjectRead(r, objects)).status).toBe(401);
  }
  const signed = request();
  expect((await serveBrainObjectRead(new Request(url, { method: 'POST', headers: signed.headers, body: JSON.stringify({ ...ref, key: ref.key + 'other' }) }), objects)).status).toBe(401);
  expect((await serveBrainObjectRead(request('x'.repeat(4097)), objects)).status).toBe(413);
  expect(get).not.toHaveBeenCalled();
});

it('refuses local paths, unbounded objects and invalid object references', async () => {
  configure(); const get = vi.fn();
  for (const change of [{ backend: 'file' }, { key: '../private' }, { key: ref.key + '/../private' }, { generation: '' }, { sha256: '' }, { sizeBytes: 100_000_000 }]) {
    expect((await serveBrainObjectRead(request(JSON.stringify({ ...ref, ...change })), { get, put: vi.fn() })).status).toBe(400);
  }
  expect(get).not.toHaveBeenCalled();
});

it('verifies the bytes on both sides and bounds responses to the database reference', async () => {
  configure();
  expect((await serveBrainObjectRead(request(), { get: vi.fn().mockResolvedValue(Buffer.from('corrupt')), put: vi.fn() })).status).toBe(502);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes.toString().replace('private', 'changed'))));
  await expect(readBrainObject(ref)).rejects.toThrow('checksum');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(Buffer.alloc(bytes.length + 1))));
  await expect(readBrainObject(ref)).rejects.toThrow('expected size');
});

it('keeps legacy inline reads and fails closed when private reader configuration is absent', async () => {
  configure();
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect(await artifactContent(bytes.toString(), ref)).toBe(bytes.toString());
  expect(fetch).not.toHaveBeenCalled();
  vi.stubEnv('NM_BRAIN_OBJECT_READ_KEY', '');
  expect(await artifactContent(bytes.toString(), ref)).toBe(bytes.toString());
  await expect(artifactContent(null, ref)).rejects.toThrow('Configure brain object storage');
  vi.stubEnv('NM_BRAIN_OBJECT_READ_KEY', key); vi.stubEnv('NM_BRAIN_OBJECT_READ_URL', 'http://example.com/read');
  await expect(readBrainObject(ref)).rejects.toThrow('endpoint');
});
