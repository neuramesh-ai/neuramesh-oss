import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { ControlApiClient } from '../src/api';
import { hydrateArtifact } from '../src/brain-artifacts';

const bytes = new TextEncoder().encode('complete artifact\n');
const checksum = createHash('sha256').update(bytes).digest('hex');
afterEach(() => vi.unstubAllGlobals());

it('refreshes authentication once for a private artifact and preserves verified metadata', async () => {
  const getToken = vi.fn(async (force?: boolean) => force ? 'new-token' : 'old-token');
  const fetch = vi.fn().mockResolvedValueOnce(new Response('expired', { status: 401 }))
    .mockResolvedValueOnce(new Response(bytes, { headers: { 'content-type': 'text/plain', etag: `"${checksum}"` } }));
  vi.stubGlobal('fetch', fetch);
  const client = new ControlApiClient({ baseUrl: 'https://api.test', getToken });
  expect(await client.getBytes('/v1/brain/artifacts/example')).toEqual({ bytes, mime: 'text/plain', sha256: checksum });
  expect(getToken.mock.calls).toEqual([[false], [true]]);
  expect(fetch.mock.calls[1]![1].headers.authorization).toBe('Bearer new-token');
});

it('does not retry a permission refusal', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'NOT_PERMITTED', error: 'No access' }), { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  const client = new ControlApiClient({ baseUrl: 'https://api.test', getToken: async () => 'token' });
  await expect(client.getBytes('/v1/brain/artifacts/example')).rejects.toMatchObject({ status: 403, code: 'NOT_PERMITTED' });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('refreshes host-provided authentication headers without a token callback', async () => {
  const getAuthHeaders = vi.fn(async (force: boolean) => ({ authorization: force ? 'Bearer refreshed' : 'Bearer expired' }));
  const fetch = vi.fn().mockResolvedValueOnce(new Response('expired', { status: 401 })).mockResolvedValueOnce(new Response(bytes));
  vi.stubGlobal('fetch', fetch);
  const client = new ControlApiClient({ baseUrl: 'https://api.test', getAuthHeaders });
  expect((await client.getBytes('/artifact')).bytes).toEqual(bytes);
  expect(getAuthHeaders.mock.calls).toEqual([[false], [true]]);
});

it('enforces download bounds from headers and streaming bytes', async () => {
  const client = new ControlApiClient({ baseUrl: 'https://api.test' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(bytes, { headers: { 'content-length': '100' } }))
    .mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4)); controller.enqueue(new Uint8Array(8)); controller.close(); } }))));
  await expect(client.getBytes('/artifact', 10)).rejects.toThrow('download limit');
  await expect(client.getBytes('/artifact', 10)).rejects.toThrow('download limit');
});

it('hydrates full text only after its bytes match the replicated checksum', async () => {
  const row = { id: 'artifact', mime: 'text/plain', storage_path: 'brain:artifact', content_hash: checksum };
  const load = vi.fn(async () => ({ bytes, mime: 'text/plain', sha256: checksum }));
  expect(await hydrateArtifact(row, load)).toMatchObject({ inline_content: 'complete artifact\n' });
  await expect(hydrateArtifact({ ...row, content_hash: '0'.repeat(64) }, load)).rejects.toThrow('checksum');
  await expect(hydrateArtifact({ ...row, content_hash: null }, async () => ({ bytes, mime: 'text/plain', sha256: null }))).rejects.toThrow('valid checksum');
  const inline = { id: 'old', mime: 'text/plain', inline_content: 'legacy' };
  expect(await hydrateArtifact(inline, load)).toBe(inline);
  expect(load).toHaveBeenCalledTimes(2);
});

it('uses a native streaming fetch and native digest without WebCrypto', async () => {
  const nativeFetch = vi.fn(async () => new Response(bytes, { headers: { etag: `"${checksum}"`, 'content-type': 'text/plain' } }));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Native default fetch has no streams'); }));
  vi.stubGlobal('crypto', {});
  const nativeDigest = vi.fn(async (input: Uint8Array) => new Uint8Array(createHash('sha256').update(input).digest()).buffer);
  const client = new ControlApiClient({ baseUrl: 'https://api.test', fetchBytes: nativeFetch });
  const row = { id: 'native', storage_path: 'brain:native', content_hash: checksum };
  expect(await hydrateArtifact(row, () => client.getBytes('/artifact'), nativeDigest)).toMatchObject({ inline_content: 'complete artifact\n' });
  expect(nativeDigest).toHaveBeenCalledWith(bytes);
  await expect(hydrateArtifact({ ...row, content_hash: '0'.repeat(64) }, () => client.getBytes('/artifact'), nativeDigest)).rejects.toThrow('checksum');
});
