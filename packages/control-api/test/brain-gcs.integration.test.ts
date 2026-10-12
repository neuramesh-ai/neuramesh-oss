// Explicit opt-in. This test writes a labeled storage fixture through the running local API,
// then independently downloads its generation-pinned objects from the real private bucket.
// It does not simulate a model call or claim to test model quality.
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GcsBrainObjects, brainHash, type BrainObjectRef } from '../src/brain-objects';

const enabled = process.env['NM_BRAIN_GCS_INTEGRATION'] === '1';
const api = process.env['NM_BRAIN_TEST_API'] ?? 'http://127.0.0.1:8898';
const dbUrl = process.env['NM_BRAIN_TEST_DB'] ?? 'postgresql://postgres:nm@127.0.0.1:56435/nm';
const workspace = process.env['NM_BRAIN_TEST_WORKSPACE'] ?? 'a0000000-0000-0000-0000-00000000000a';
const owner = { kind: 'human', id: process.env['NM_BRAIN_TEST_USER'] ?? '00000000-0000-0000-0000-000000000001' };
const bucket = process.env['NM_BRAIN_GCS_BUCKET'] ?? '';
let sql: postgres.Sql;
let channel: string;
const data = async (response: Response): Promise<any> => response.json();
const request = (path: string, body?: unknown, actor = owner) => fetch(`${api}${path}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90_000),
});

beforeAll(async () => {
  if (!enabled) return;
  if (!bucket) throw new Error('Set NM_BRAIN_GCS_BUCKET to the private bucket explicitly provisioned for this test.');
  for (const url of [api, dbUrl]) if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw new Error('The live brain test accepts only a local API and database.');
  sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  const rows = await sql`select id from channels where workspace_id = ${workspace}::uuid order by (slug = 'dev') desc, created_at limit 1`;
  channel = rows[0]?.['id'] as string;
  expect(channel).toBeTruthy();
});
afterAll(async () => { await sql?.end(); });

describe.skipIf(!enabled)('running local API with real GCS', () => {
  it('archives complete events, verifies object bytes, protects revisions and tenants, and stores generated media outside Postgres', async () => {
    const threadId = randomUUID();
    const messageId = randomUUID();
    const born = await request('/v1/messages', { id: messageId, workspace, channel, threadId, threadKind: 'coding', body: 'Storage API verification fixture. No model call occurs in this test.' });
    expect(born.status, JSON.stringify(await data(born))).toBe(200);
    const events = [{ id: randomUUID(), type: 'tool.result', timestamp: new Date().toISOString(), payload: { tool: 'fixture', output: 'complete output\n'.repeat(30_000) } }];
    const first = { workspace, commitId: randomUUID(), expectedRevision: 0, deviceId: 'integration-device-a', events, runtimeMessages: [{ role: 'user', content: 'Storage fixture marker: indigo-47.' }], metadata: { provider: 'fixture-a' } };
    const path = `/v1/brain/threads/${threadId}`;
    const saved = await request(`${path}/commits`, first);
    expect(saved.status, JSON.stringify(await data(saved))).toBe(200);
    expect(await data(await request(`${path}/commits`, first))).toMatchObject({ revision: 1, duplicate: true });
    expect((await request(`${path}/commits`, { ...first, deviceId: 'different-content' })).status).toBe(409);
    expect((await request(`${path}/commits`, { ...first, commitId: randomUUID() })).status).toBe(409);

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=', 'base64');
    const artifactId = randomUUID();
    const image = await request('/v1/brain/artifacts', { workspace, threadId, id: artifactId, messageId, name: 'storage-verification.png', mime: 'image/png', contentBase64: png.toString('base64'), sha256: brainHash(png) });
    const imageMeta = await data(image);
    expect(image.status, JSON.stringify(imageMeta)).toBe(200);
    const imageRead = await request(imageMeta.url);
    expect(imageRead.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await imageRead.arrayBuffer())).toEqual(png);
    const secondEvent = { id: randomUUID(), type: 'handoff', timestamp: new Date().toISOString(), payload: { artifactId } };
    expect((await request(`${path}/commits`, { ...first, commitId: randomUUID(), expectedRevision: 1, deviceId: 'integration-device-b', events: [secondEvent], metadata: { provider: 'fixture-b' }, artifactIds: [artifactId] })).status).toBe(200);
    const restored = await data(await request(`${path}?workspace=${workspace}`));
    expect(restored).toMatchObject({ revision: 2, events: [...events, secondEvent], runtimeMessages: first.runtimeMessages, metadata: { provider: 'fixture-b' } });
    const rows = await sql`select segment, snapshot from brain_commits where thread_id = ${threadId}::uuid order by revision`;
    expect(rows).toHaveLength(2);
    const objects = new GcsBrainObjects(bucket);
    for (const row of rows) {
      for (const ref of [row['segment'], row['snapshot']] as BrainObjectRef[]) {
        expect(ref).toMatchObject({ backend: 'gcs', bucket });
        expect(ref.generation).toMatch(/^\d+$/);
        expect(brainHash(await objects.get(ref))).toBe(ref.sha256);
      }
    }
    const stranger = { kind: 'human', id: randomUUID() };
    expect((await request(`${path}?workspace=${workspace}`, undefined, stranger)).status).toBe(404);
    expect((await request(imageMeta.url, undefined, stranger)).status).toBe(404);
    const preflight = await fetch(`${api}${imageMeta.url}`, { method: 'OPTIONS', headers: { origin: 'https://hq.neuramesh.app', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://hq.neuramesh.app');

    const content = await data(await request('/v1/commands', { type: 'content.create', channel, thread: threadId, platform: 'linkedin', body: 'Storage verification media fixture.' }));
    expect(content.itemId).toBeTruthy();
    const attached = await request('/v1/commands', { type: 'content.attach_media', item: content.itemId, dataUrl: `data:image/png;base64,${png.toString('base64')}` });
    const media = await data(attached);
    expect(attached.status, JSON.stringify(media)).toBe(200);
    const [mediaRow] = await sql`select bytes, object_ref from content_media where id = ${media.mediaId}::uuid`;
    expect(mediaRow!['bytes']).toBeNull();
    expect(mediaRow!['object_ref']).toMatchObject({ backend: 'gcs', bucket, sha256: brainHash(png) });
    expect(await objects.get(mediaRow!['object_ref'] as BrainObjectRef)).toEqual(png);
    const mediaRead = await request(`/v1/content/media/${media.mediaId}`);
    expect(mediaRead.status).toBe(200);
    expect(Buffer.from(await mediaRead.arrayBuffer())).toEqual(png);
    expect((await request(`/media/${media.mediaId}?s=invalid`)).status).toBe(403);
    console.log(JSON.stringify({ threadId, artifactId, mediaId: media.mediaId, bucket, revisions: 2, eventBytes: Buffer.byteLength(JSON.stringify(events)), verified: true }));
  }, 120_000);
});
