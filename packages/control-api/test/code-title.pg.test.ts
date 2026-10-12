import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const db = process.env['DATABASE_URL'];
const sql = db ? postgres(db) : null;
const store = db ? new PostgresStore(db) : null;
const app = store ? createApp(store) : null;
let owner = ''; let mate = ''; let workspace = ''; let channel = '';
const command = (actor: string, body: object) => app!.request('/v1/commands', { method: 'POST', headers: {
  'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actor }),
}, body: JSON.stringify({ workspace, ...body }) });
beforeAll(async () => {
  if (!sql) return;
  for (const who of ['owner', 'mate']) {
    const [row] = await sql`insert into nm_users (clerk_user_id, email) values (${randomUUID()}, ${`${randomUUID()}@titles.test`}) returning id`;
    if (who === 'owner') owner = row!['id']; else mate = row!['id'];
  }
  const created = await command(owner, { type: 'workspace.create', name: 'Title test', slug: `titles-${randomUUID().slice(0, 12)}` });
  expect(created.status).toBe(200);
  workspace = (await created.json() as { workspaceId: string }).workspaceId;
  await sql`insert into workspace_members (workspace_id, user_id, role) values (${workspace}::uuid, ${mate}::uuid, 'member')`;
  channel = (await sql`select id from channels where workspace_id = ${workspace}::uuid limit 1`)[0]!['id'];
});
afterAll(async () => { await sql?.end(); await store?.close(); });
async function fresh() {
  const id = randomUUID();
  await store!.createThread(workspace, channel, id, 'Please can you fix the very long greeting prompt', '', `human:${owner}`);
  await sql!`update threads set kind = 'coding' where id = ${id}::uuid`;
  expect((await command(owner, { type: 'code_session.upsert', codeSessionId: id, title: 'Original prompt' })).status).toBe(200);
  return id;
}
describe.skipIf(!db)('coding titles preserve deliberate names across clients and reconnects', () => {
  it('accepts one generated title, rejects other members and preserves human renames', async () => {
    const id = await fresh();
    const name = (actor: string, title: string) => command(actor, { type: 'code_session.name', codeSessionId: id, title });
    expect((await name(mate, 'Hijack')).status).toBe(403);
    expect(await (await name(owner, '**Greeting endpoint**')).json()).toMatchObject({ title: 'Greeting endpoint' });
    expect(await (await name(owner, 'Agent rename')).json()).toMatchObject({ title: 'Greeting endpoint' });
    await store!.updateThread(workspace, id, { title: 'My chosen name' });
    expect(await (await name(owner, 'Agent retry')).json()).toMatchObject({ title: 'My chosen name' });
    await command(owner, { type: 'code_session.upsert', codeSessionId: id, title: 'Reconnected prompt' });
    expect((await sql!`select t.title, c.title as code_title from threads t join code_sessions c on c.id = t.id where t.id = ${id}::uuid`)[0])
      .toMatchObject({ title: 'My chosen name', code_title: 'My chosen name' });
  });
  it('serializes concurrent naming and a reconnect instead of losing the winning title', async () => {
    const id = await fresh();
    const results = await Promise.all(['First concise title', 'Second concise title'].map(title => command(owner, { type: 'code_session.name', codeSessionId: id, title })));
    expect(results.map(r => r.status)).toEqual([200, 200]);
    const names = await Promise.all(results.map(r => r.json() as Promise<{ title: string }>));
    expect(names[0]!.title).toBe(names[1]!.title);
    await Promise.all([
      store!.updateThread(workspace, id, { title: 'Human final title' }),
      command(owner, { type: 'code_session.upsert', codeSessionId: id, title: 'First prompt again', lastLine: 'Reconnected' }),
    ]);
    expect((await sql!`select title from code_sessions where id = ${id}::uuid`)[0]!['title']).toBe('Human final title');
  });
  it('cannot use a colliding standalone Code row to name another member’s private thread', async () => {
    const id = randomUUID();
    await store!.createThread(workspace, channel, id, 'Private title', '', `human:${mate}`);
    await sql!`update threads set kind = 'coding' where id = ${id}::uuid`;
    await command(owner, { type: 'code_session.upsert', codeSessionId: id });
    expect((await command(owner, { type: 'code_session.name', codeSessionId: id, title: 'Hijack' })).status).toBe(404);
  });
});
