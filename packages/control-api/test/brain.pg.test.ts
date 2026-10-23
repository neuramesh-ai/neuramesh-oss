import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { FileBrainObjects, brainHash, type BrainObjectStore } from '../src/brain-objects';
import { PostgresStore } from '../src/pgstore';
import { mediaSig } from '../src/connector-crypto';
import { libraryImage } from '../src/store/frames';

const DB = process.env['DATABASE_URL'];
const sql = DB ? postgres(DB, { onnotice: () => {} }) : null;
const store = DB ? new PostgresStore(DB) : null;
let app: ReturnType<typeof createApp>;
let root: string;
let objects: FileBrainObjects;
let owner: Actor;
let stranger: Actor;
let mate: Actor;
let workspace: string;
let channel: string;
const json = async (response: Response): Promise<any> => response.json();
function request(actor: Actor, path: string, body?: unknown) {
  return app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function thread(kind: 'chat' | 'coding' = 'chat') {
  const id = randomUUID();
  const messageId = randomUUID();
  const result = await request(owner, '/v1/messages', { id: messageId, workspace, channel, threadId: id, body: 'Portable brain test' });
  expect(result.status).toBe(200);
  if (kind === 'coding') await sql!`update threads set kind = 'coding' where id = ${id}::uuid`;
  return { id, messageId };
}
const event = (payload: unknown = 'hello') => ({ id: randomUUID(), type: 'runtime.event', timestamp: new Date().toISOString(), payload });
const commit = (events = [event()], expectedRevision = 0) => ({ workspace, commitId: randomUUID(), expectedRevision, deviceId: 'device-a', events });
const read = (threadId: string, actor = owner) => request(actor, `/v1/brain/threads/${threadId}?workspace=${workspace}`);
const put = (threadId: string, body: unknown, actor = owner) => request(actor, `/v1/brain/threads/${threadId}/commits`, body);

beforeAll(async () => {
  if (!sql || !store) return;
  root = await mkdtemp(join(tmpdir(), 'nm-brain-pg-'));
  objects = new FileBrainObjects(root);
  app = createApp(store, { brain: { objects } });
  const user = async (): Promise<Actor> => {
    const [row] = await sql`insert into nm_users (clerk_user_id, email) values (${randomUUID()}, ${`${randomUUID()}@brain.test`}) returning id`;
    return { kind: 'human', id: row!['id'] as string };
  };
  owner = await user(); stranger = await user(); mate = await user();
  const created = await json(await request(owner, '/v1/commands', { type: 'workspace.create', name: 'Portable Brain', slug: `brain-${randomUUID().slice(0, 12)}` }));
  workspace = created.workspaceId;
  expect(workspace).toBeTruthy();
  await sql`insert into workspace_members (workspace_id, user_id, role) values (${workspace}::uuid, ${mate.id}::uuid, 'member')`;
  channel = (await sql`select id from channels where workspace_id = ${workspace}::uuid limit 1`)[0]!['id'] as string;
});
afterAll(async () => { await sql?.end(); await store?.close(); if (root) await rm(root, { recursive: true, force: true }); });

describe.skipIf(!DB)('portable brain against real Postgres and durable filesystem objects', () => {
  it('restores full turns and runtime state on another device, then accepts a different model', async () => {
    const { id } = await thread('coding');
    const text = 'complete-tool-output\n'.repeat(20_000);
    const first = { ...commit([event({ tool: 'read_file', result: text })]), runtimeMessages: [{ role: 'user', content: 'Remember the token blue-orchid-41.' }, { role: 'assistant', content: [{ type: 'text', text }] }], metadata: { provider: 'anthropic', model: 'claude-sonnet' } };
    expect(await json(await put(id, first))).toMatchObject({ revision: 1, duplicate: false });
    const recovered = await json(await read(id));
    expect(recovered.events).toEqual(first.events);
    expect(recovered.runtimeMessages).toEqual(first.runtimeMessages);
    const compressed = await app.request(`/v1/brain/threads/${id}?workspace=${workspace}`, {
      headers: { 'x-nm-actor': JSON.stringify(owner), 'accept-encoding': 'gzip' },
    });
    expect(compressed.headers.get('content-encoding')).toBe('gzip');
    expect(compressed.headers.get('cache-control')).toBe('no-store');
    expect(compressed.headers.get('vary')).toContain('Accept-Encoding');
    const wire = Buffer.from(await compressed.arrayBuffer());
    expect(wire.length).toBeLessThan(Buffer.byteLength(JSON.stringify(recovered)) / 4);
    expect(JSON.parse(gunzipSync(wire).toString('utf8'))).toEqual(recovered);
    const second = { ...commit([event({ role: 'assistant', text: 'blue-orchid-41' })], 1), deviceId: 'device-b', metadata: { provider: 'openai', model: 'gpt-5' } };
    expect((await put(id, second)).status).toBe(200);
    const final = await json(await read(id));
    expect(final).toMatchObject({ revision: 2, metadata: second.metadata, runtimeMessages: first.runtimeMessages });
    expect(final.events).toHaveLength(2);
    expect((await sql!`select count(*)::int as count from events where type = 'brain.committed' and target = ${`resource/thread/${id}`}`)[0]!['count']).toBe(2);
  });

  it('writes no inline bytes only after the explicit reader compatibility gate', async () => {
    const { id } = await thread('coding');
    vi.stubEnv('NM_BRAIN_CLOUD_ONLY_WORKSPACES', workspace);
    try {
      const content = Buffer.from('large portable text\n'.repeat(30_000));
      const artifact = { workspace, threadId: id, id: randomUUID(), name: 'report.txt', mime: 'text/plain', contentBase64: content.toString('base64') };
      vi.stubEnv('NM_BRAIN_CLOUD_ONLY_WORKSPACES', '');
      expect(await json(await request(owner, '/v1/brain/artifacts', artifact))).toMatchObject({ code: 'BRAIN_READER_UPGRADE_REQUIRED' });
      expect(await sql!`select id from artifacts where id = ${artifact.id}::uuid`).toHaveLength(0);
      vi.stubEnv('NM_BRAIN_CLOUD_ONLY_WORKSPACES', workspace);
      const result = await request(owner, '/v1/brain/artifacts', artifact);
      expect(result.status).toBe(200);
      expect((await sql!`select inline_content from artifacts where id = ${artifact.id}::uuid`)[0]!['inline_content']).toBeNull();
      const download = await request(owner, (await json(result)).url);
      expect(Buffer.from(await download.arrayBuffer())).toEqual(content);
      expect((await request(mate, (await json(await request(owner, '/v1/brain/artifacts', artifact))).url)).status).toBe(404);
    } finally { vi.unstubAllEnvs(); }
  });

  it('uploads and retries a 16 MiB private artifact with exact authenticated downloads', async () => {
    const { id } = await thread('coding');
    vi.stubEnv('NM_BRAIN_CLOUD_ONLY_WORKSPACES', workspace);
    try {
      const bytes = Buffer.alloc(16 * 1024 * 1024, 0xfb);
      const artifact = { workspace, threadId: id, id: randomUUID(), name: 'large-deliverable.bin', mime: 'application/octet-stream', contentBase64: bytes.toString('base64'), sha256: brainHash(bytes) };
      const response = await request(owner, '/v1/brain/artifacts', artifact);
      expect(response.status).toBe(200);
      const receipt = await json(response);
      expect(await json(await request(owner, '/v1/brain/artifacts', artifact))).toEqual(receipt);
      const restored = await request(owner, receipt.url);
      expect(restored.status).toBe(200);
      expect(brainHash(Buffer.from(await restored.arrayBuffer()))).toBe(artifact.sha256);
      expect((await request(mate, receipt.url)).status).toBe(404);
      const rows = await sql!`select inline_content, size_bytes from artifacts where id=${artifact.id}::uuid`;
      expect(rows).toHaveLength(1);
      expect(rows[0]!['inline_content']).toBeNull();
      expect(Number(rows[0]!['size_bytes'])).toBe(bytes.length);
      expect((await request(owner, '/v1/brain/artifacts', { ...artifact, id: randomUUID(), contentBase64: Buffer.alloc(bytes.length + 1).toString('base64') })).status).toBe(413);
      expect((await request(owner, '/v1/brain/artifacts', { ...artifact, id: randomUUID(), contentBase64: artifact.contentBase64.slice(0, -4) + '?AAA' })).status).toBe(400);
    } finally { vi.unstubAllEnvs(); }
  });

  it('decodes compressed snapshots for phones while preserving the archive and access rules', async () => {
    const { id } = await thread('coding');
    const pack = (value: unknown) => ({ brainEncoding: 'neuramesh.gzip.v1', data: gzipSync(JSON.stringify(value)).toString('base64') });
    const payload = { text: 'complete '.repeat(150_000) };
    const messages = [{ role: 'assistant', content: [{ type: 'text', text: 'Full answer' }] }];
    expect((await put(id, { ...commit([event(pack(payload))]), runtimeMessages: [pack(messages)] })).status).toBe(200);
    expect((await json(await read(id))).events[0].payload.brainEncoding).toBe('neuramesh.gzip.v1');
    const path = `/v1/brain/threads/${id}?workspace=${workspace}&format=decoded`;
    const decoded = await json(await request(owner, path));
    expect(decoded.events[0].payload).toEqual(payload);
    expect(decoded.runtimeMessages).toEqual(messages);
    expect(await json(await request(owner, path.replace('format=decoded', 'format=compact-decoded')))).toEqual(decoded);
    const delta = { type: 'content_start', contentType: 'text', text: 'Full answer', accumulated: 'Full answer' };
    const streamed = { type: 'agent_event', payload: { sessionId: id, event: delta } };
    const next = event(pack(streamed));
    expect((await put(id, commit([next], 1))).status).toBe(200);
    for (const format of ['compact', 'compact-decoded']) {
      const compactPath = path.replace('format=decoded', `format=${format}`);
      const restored = await json(await request(owner, compactPath));
      expect(restored.events[1]).toEqual({ ...next, payload: { ...streamed, payload: { sessionId: id, event: { type: 'content_start', contentType: 'text', text: 'Full answer' } } } });
      expect((await request(stranger, compactPath)).status).toBe(404);
      expect((await request(mate, compactPath)).status).toBe(404);
    }
    expect((await json(await read(id))).events[1]).toEqual(next);
    expect((await json(await request(owner, path))).events[1].payload).toEqual(streamed);
    expect((await request(stranger, path)).status).toBe(404);
    expect((await request(mate, path)).status).toBe(404);
  });

  // a phone reads the recording again on each focus, and a long one takes many seconds: a reader that holds the head
  // names it with since, and the API answers unchanged without reading a segment or a snapshot
  it('a reader at the head reads nothing more, a newer head reads in full, and access still holds', async () => {
    const { id } = await thread();
    expect((await put(id, commit())).status).toBe(200);
    const at = (since: string, actor = owner) => request(actor, `/v1/brain/threads/${id}?workspace=${workspace}&format=compact-decoded&since=${since}`);
    const gets = vi.spyOn(objects, 'get');
    expect(await json(await at('1'))).toMatchObject({ workspace, threadId: id, revision: 1, events: [], unchanged: true });
    expect(gets).not.toHaveBeenCalled();
    expect((await put(id, commit([event('next')], 1))).status).toBe(200);
    const newer = await json(await at('1'));
    expect(newer.unchanged).toBeUndefined();
    expect(newer.revision).toBe(2);
    expect(newer.events).toHaveLength(2);
    expect(gets).toHaveBeenCalled();
    for (const odd of ['-1', 'two', '1.5']) expect((await json(await at(odd))).events).toHaveLength(2);
    expect((await at('2', stranger)).status).toBe(404);
    gets.mockRestore();
  });

  it('makes a lost-response retry idempotent and refuses changed content or reused event IDs', async () => {
    const { id } = await thread();
    const body = commit();
    expect((await put(id, body)).status).toBe(200);
    expect(await json(await put(id, body))).toMatchObject({ revision: 1, duplicate: true });
    expect(await json(await put(id, { ...body, deviceId: 'changed' }))).toMatchObject({ code: 'BRAIN_COMMIT_REUSED' });
    expect(await json(await put(id, { ...commit(body.events, 1) }))).toMatchObject({ code: 'BRAIN_EVENT_REUSED' });
    expect((await json(await read(id))).events).toHaveLength(1);
  });

  it('serializes two device writers and preserves the winner without silent replacement', async () => {
    const { id } = await thread();
    const results = await Promise.all([put(id, commit()), put(id, { ...commit(), deviceId: 'device-b' })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await json(await read(id))).revision).toBe(1);
  });

  it('retains a legacy image copy while GCS-style objects provide authenticated exact bytes', async () => {
    const { id, messageId } = await thread();
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=', 'base64');
    const artifact = { workspace, threadId: id, id: randomUUID(), name: 'pixel.png', mime: 'image/png', contentBase64: bytes.toString('base64'), sha256: brainHash(bytes), messageId };
    const saved = await json(await request(owner, '/v1/brain/artifacts', artifact));
    expect(saved).toMatchObject({ ok: true, sha256: brainHash(bytes) });
    const row = (await sql!`select inline_content, storage_path, content_hash, message_id from artifacts where id = ${artifact.id}::uuid`)[0];
    expect(row).toMatchObject({ inline_content: `data:image/png;base64,${artifact.contentBase64}`, storage_path: `brain:${artifact.id}`, content_hash: saved.sha256, message_id: messageId });
    const download = await request(owner, saved.url);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    expect(download.headers.get('content-security-policy')).toContain('sandbox');
    expect((await request(stranger, saved.url)).status).toBe(404);
    const previewUrl = `/v1/brain/artifacts/${artifact.id}/preview?workspace=${workspace}`;
    const preview = await request(owner, previewUrl);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('cache-control')).toBe('private, no-store');
    expect(preview.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(bytes);
    // Warm cache still requires workspace/channel access on every request.
    expect((await request(stranger, previewUrl)).status).toBe(404);
    const reads = vi.spyOn(objects, 'get');
    expect((await request(owner, previewUrl)).status).toBe(200);
    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();
    expect((await request(mate, previewUrl)).status).toBe(200);
    await sql!`update threads set kind = 'coding' where id = ${id}::uuid`;
    expect((await request(mate, previewUrl)).status).toBe(404);
    expect((await request(owner, previewUrl)).status).toBe(200);
    await sql!`update threads set kind = 'chat' where id = ${id}::uuid`;
    const metadataUrl = `/v1/brain/artifacts/${artifact.id}/metadata?workspace=${workspace}`;
    const get = vi.spyOn(objects, 'get');
    get.mockClear();
    expect(await json(await request(owner, metadataUrl))).toMatchObject({ id: artifact.id, name: 'pixel.png', storagePath: `brain:${artifact.id}`, sha256: saved.sha256, mime: 'image/png' });
    expect(get).not.toHaveBeenCalled();
    get.mockRestore();
    expect((await request(stranger, metadataUrl)).status).toBe(404);
    expect((await request(owner, `/v1/brain/artifacts/${randomUUID()}/metadata?workspace=${workspace}`)).status).toBe(404);
    expect((await request(owner, '/v1/brain/artifacts', artifact)).status).toBe(200);
    expect(await json(await request(owner, '/v1/brain/artifacts', { ...artifact, name: 'changed.png' }))).toMatchObject({ code: 'BRAIN_ARTIFACT_REUSED' });
    expect((await put(id, { ...commit(), artifactIds: [artifact.id] })).status).toBe(200);
    expect((await json(await read(id))).artifacts).toHaveLength(1);
  });

  it('resolves object-backed task documents and frame images through legacy readers without bypassing scope or source checks', async () => {
    const { id } = await thread();
    const { task } = await json(await request(owner, '/v1/commands', { type: 'task.create', workspace, channel, title: 'Artifact reader fixture', kind: 'bug' }));
    expect(task.id).toBeTruthy();
    await sql!`update threads set task_id = ${task.id}::uuid where id = ${id}::uuid`;
    const text = 'Full review document from object storage.';
    const image = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    const doc = { workspace, threadId: id, id: randomUUID(), name: 'review.md', kind: 'doc', mime: 'text/markdown', contentBase64: Buffer.from(text).toString('base64') };
    const shot = { workspace, threadId: id, id: randomUUID(), name: 'app-frame.gif', mime: 'image/gif', contentBase64: image.toString('base64') };
    expect((await request(owner, '/v1/brain/artifacts', doc)).status).toBe(200);
    expect((await request(owner, '/v1/brain/artifacts', shot)).status).toBe(200);
    vi.stubEnv('NM_LOCAL', '1'); vi.stubEnv('NM_BRAIN_STORAGE_DIR', root); vi.stubEnv('NM_BRAIN_GCS_BUCKET', '');
    try {
      const detail = await json(await request(mate, `/v1/tasks/${task.id}`));
      expect(detail.artifacts.find((a: { id: string }) => a.id === doc.id)?.content).toBe(text);
      expect((await request(stranger, `/v1/tasks/${task.id}`)).status).toBe(404);
      expect((await libraryImage(store!, channel, shot.name))?.dataUrl).toBe(`data:image/gif;base64,${shot.contentBase64}`);
      await sql!`update artifacts set created_by_kind = 'agent' where id = ${shot.id}::uuid`;
      expect(await libraryImage(store!, channel, shot.name)).toBeNull();
      expect(await libraryImage(store!, channel, shot.name, { any: true })).not.toBeNull();
      await sql!`update artifacts set source = 'repo:trusted-fixture' where id = ${shot.id}::uuid`;
      expect(await libraryImage(store!, channel, shot.name)).not.toBeNull();
      await sql!`update threads set kind = 'coding' where id = ${id}::uuid`;
      expect((await store!.listArtifacts(task.id))).toEqual([]);
      expect(await libraryImage(store!, channel, shot.name, { any: true })).toBeNull();
      expect((await request(mate, `/v1/brain/artifacts/${shot.id}/metadata?workspace=${workspace}`)).status).toBe(404);
      expect((await request(owner, `/v1/brain/artifacts/${shot.id}/metadata?workspace=${workspace}`)).status).toBe(200);
    } finally { vi.unstubAllEnvs(); }
  });

  it('rejects wrong checksums, missing artifact references, cross-thread attachment, and unauthorized scope', async () => {
    const { id } = await thread('coding');
    expect((await read(id, stranger)).status).toBe(404);
    expect((await read(id, mate)).status).toBe(404);
    expect((await put(id, commit(), stranger)).status).toBe(404);
    expect(await json(await put(id, { ...commit(), artifactIds: [randomUUID()] }))).toMatchObject({ code: 'BRAIN_ARTIFACT_MISSING' });
    const artifact = { workspace, threadId: id, id: randomUUID(), name: 'hello.txt', mime: 'text/plain', contentBase64: Buffer.from('hello').toString('base64') };
    expect(await json(await request(owner, '/v1/brain/artifacts', { ...artifact, sha256: '0'.repeat(64) }))).toMatchObject({ code: 'BRAIN_CHECKSUM_MISMATCH' });
    const other = await thread();
    expect((await request(owner, '/v1/brain/artifacts', { ...artifact, threadId: other.id, messageId: (await thread()).messageId })).status).toBe(404);
    expect((await json(await read(id))).revision).toBe(0);
  });

  it('does not publish a checkpoint when object durability fails', async () => {
    const { id } = await thread();
    const failed: BrainObjectStore = { put: async () => { throw new Error('simulated object-store outage'); }, get: (ref) => objects.get(ref) };
    const offline = createApp(store!, { brain: { objects: failed } });
    const result = await offline.request(`/v1/brain/threads/${id}/commits`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(owner) }, body: JSON.stringify(commit()) });
    expect(result.status).toBe(500);
    expect((await json(await read(id))).revision).toBe(0);
  });

  it('stores original draft images through the large-body ingress with workspace and channel authorization', async () => {
    const { id } = await thread();
    const item = await json(await request(owner, '/v1/commands', { type: 'content.create', channel, thread: id, platform: 'x', body: 'Full quality draft' }));
    const bytes = Buffer.concat([Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), Buffer.alloc(9_000_000, 23)]);
    const body = { type: 'content.attach_media', item: item.itemId, dataUrl: `data:image/gif;base64,${bytes.toString('base64')}` };
    expect((await request(stranger, '/v1/brain/content-media', body)).status).toBe(403);
    const [registered] = await sql!`insert into agents (workspace_id, name, role, model) values (${workspace}::uuid, 'original-image-agent', 'orchestrator', 'gpt-5.6-sol') returning id`;
    const agent: Actor = { kind: 'agent', id: registered!['id'], role: 'orchestrator' };
    expect((await request(agent, '/v1/brain/content-media', body)).status).toBe(403);
    await sql!`insert into agent_channels (agent_id, channel_id) values (${agent.id}::uuid, ${channel}::uuid)`;
    vi.stubEnv('NM_LOCAL', '1'); vi.stubEnv('NM_BRAIN_STORAGE_DIR', root); vi.stubEnv('NM_BRAIN_GCS_BUCKET', '');
    vi.stubEnv('NM_BRAIN_CLOUD_ONLY_WORKSPACES', workspace);
    try {
      const result = await request(agent, '/v1/brain/content-media', body);
      expect(result.status).toBe(200);
      const { mediaId } = await json(result);
      const [row] = await sql!`select bytes, object_ref, size_bytes from content_media where id = ${mediaId}::uuid`;
      expect(row!['bytes']).toBeNull();
      expect(row!['object_ref']).toMatchObject({ sha256: brainHash(bytes), sizeBytes: bytes.length });
      const download = await request(owner, `/v1/content/media/${mediaId}`);
      expect(download.status).toBe(200);
      expect(brainHash(Buffer.from(await download.arrayBuffer()))).toBe(brainHash(bytes));
      expect((await request(stranger, `/v1/content/media/${mediaId}`)).status).toBe(403);
      await sql!`update agents set retired_at = now() where id = ${agent.id}::uuid`;
      expect((await request(agent, '/v1/brain/content-media', body)).status).toBe(403);
    } finally { vi.unstubAllEnvs(); }
  });

  it('moves full generated media to objects and preserves signed publication URLs and legacy reads', async () => {
    const { id } = await thread();
    const item = await json(await request(owner, '/v1/commands', { type: 'content.create', channel, thread: id, platform: 'instagram', body: 'Object media test', imageBrief: 'small blue square', thumb: 'data:image/png;base64,preview' }));
    expect(item.itemId).toBeTruthy();
    const bytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    const attach = () => request(owner, '/v1/commands', { type: 'content.attach_media', item: item.itemId, dataUrl: `data:image/gif;base64,${bytes.toString('base64')}` });
    const legacy = await json(await attach());
    expect((await store!.contentMediaBytes(legacy.mediaId))?.bytes).toEqual(bytes);
    vi.stubEnv('NM_LOCAL', '1');
    vi.stubEnv('NM_BRAIN_STORAGE_DIR', root);
    vi.stubEnv('NM_BRAIN_GCS_BUCKET', '');
    vi.stubEnv('NM_CONNECTOR_KEY', 'brain-media-test-key');
    try {
      // A configured object store must still read an old inline row.
      expect((await store!.contentMediaBytes(legacy.mediaId))?.bytes).toEqual(bytes);
      const media = await json(await attach());
      const [row] = await sql!`select bytes, object_ref from content_media where id = ${media.mediaId}::uuid`;
      expect(Buffer.from(row!['bytes'])).toEqual(bytes);
      expect(row!['object_ref']).toMatchObject({ backend: 'file', sha256: brainHash(bytes) });
      const signed = await app.request(`/media/${media.mediaId}?s=${mediaSig(media.mediaId)}`);
      expect(signed.status).toBe(200);
      expect(Buffer.from(await signed.arrayBuffer())).toEqual(bytes);
      expect((await app.request(`/media/${media.mediaId}?s=wrong`)).status).toBe(403);
      const [draft] = await sql!`select media from content_items where id = ${item.itemId}::uuid`;
      expect(draft!['media']).toMatchObject({ image_id: media.mediaId, thumb: 'data:image/png;base64,preview', brief: 'small blue square' });
      const replacement = await json(await attach());
      expect(replacement.mediaId).not.toBe(media.mediaId);
      const [updated] = await sql!`select media from content_items where id = ${item.itemId}::uuid`;
      expect(updated!['media']).toMatchObject({ image_id: replacement.mediaId });
      // A recorded turn's original IDs and signed URLs survive a newer generated image.
      expect((await store!.contentMediaBytes(legacy.mediaId))?.bytes).toEqual(bytes);
      const original = await app.request(`/media/${media.mediaId}?s=${mediaSig(media.mediaId)}`);
      expect(original.status).toBe(200);
      expect(Buffer.from(await original.arrayBuffer())).toEqual(bytes);
      // An unauthorized read is denied before an object download, even with storage absent.
      vi.stubEnv('NM_BRAIN_STORAGE_DIR', '');
      expect((await request(stranger, `/v1/content/media/${media.mediaId}`)).status).toBe(403);
      expect((await store!.contentMediaBytes(media.mediaId))?.bytes).toEqual(bytes);
    } finally { vi.unstubAllEnvs(); }
  });
});
