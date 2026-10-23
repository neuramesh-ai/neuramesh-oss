// Local visual validation: real Postgres, object storage, access checks and image conversions.
// This creates its own fixture workspace. It never resets an existing stack.
import { serve } from '@hono/node-server';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';
import { FileBrainObjects } from '../src/brain-objects';
import { resvgModule } from '../src/releasecard';

const database = process.env['DATABASE_URL'];
if (!database || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(database).hostname)) throw new Error('Use a loopback development database.');
if (process.env['NM_ALLOW_ACTOR_HEADER'] !== '1') throw new Error('Enable local fixture authentication.');
const store = new PostgresStore(database);
const app = createApp(store, { brain: { objects: new FileBrainObjects(process.env['NM_IMAGE_OBJECTS'] ?? '/tmp/nm-image-preview-objects') } });
const [user] = await store.sql`insert into nm_users (clerk_user_id, email) values (${randomUUID()}, ${`${randomUUID()}@image-preview.test`}) returning id`;
const actor = { kind: 'human', id: user!['id'] as string };
async function post(path: string, body: unknown): Promise<any> {
  const response = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
const { workspaceId: workspace } = await post('/v1/commands', { type: 'workspace.create', name: 'Image preview validation', slug: `image-${randomUUID().slice(0, 8)}` });
process.env['NM_BRAIN_CLOUD_ONLY_WORKSPACES'] = [process.env['NM_BRAIN_CLOUD_ONLY_WORKSPACES'], workspace].filter(Boolean).join(',');
const [channel] = await store.sql`select id from channels where workspace_id = ${workspace}::uuid limit 1`;
const threadId = randomUUID(); const messageId = randomUUID();
await post('/v1/messages', { id: messageId, workspace, channel: channel!['id'], threadId, body: 'Generated image preview validation' });
const { Resvg } = await resvgModule(true);
const renderer = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#f6eddb"/><stop offset="1" stop-color="#afced0"/></linearGradient></defs><rect width="2400" height="1600" fill="url(#bg)"/><circle cx="1700" cy="500" r="260" fill="#d8996e"/>${Array.from({ length: 18 }, (_, i) => `<path d="M0 ${650 + i * 42} Q600 ${160 + i * 62} 1200 ${780 + i * 15} T2400 ${700 + i * 48} V1600 H0Z" fill="hsl(${186 + i},${24 + i}%,${68 - i * 3}%)"/>`).join('')}</svg>`);
let bytes: Buffer;
try { const img = renderer.render(); try { bytes = Buffer.from(img.asPng()); } finally { img.free(); } } finally { renderer.free(); }
const rows = [];
for (const name of ['mental-wellness-cover.png', 'offscreen-cover.png']) {
  const id = randomUUID();
  await post('/v1/brain/artifacts', { workspace, threadId, messageId, id, name, mime: 'image/png', contentBase64: bytes.toString('base64') });
  rows.push({ id, message_id: messageId, kind: 'screenshot', name, mime: 'image/png', inline_content: null, width: 2400, height: 1600, size_bytes: bytes.length, created_at: new Date().toISOString(), storage_path: `brain:${id}` });
}
serve({ fetch: request => new URL(request.url).pathname === '/image-preview-fixture'
  ? Response.json({ actor, workspace, rows, threadId }, { headers: { 'access-control-allow-origin': '*' } }) : app.fetch(request),
  hostname: '127.0.0.1', port: Number(process.env['PORT'] ?? 8916) }, () => console.log('Image fixture API ready on loopback; original bytes:', bytes.length));
