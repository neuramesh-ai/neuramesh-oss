// Real app screenshots only, on the REAL schema (0150, George 2026-10-06): the shelf lookup that a film
// and a draft read returns an image a person created, or the platform's copy of a repository file,
// never an agent's capture or drawing. `any` still finds such an image, so a refusal can say why.
// Run via CI's pg lane or scripts/test-pg.sh; skipped without DATABASE_URL.
import { createEvent, formatAddress, type Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';
import { libraryImage, setArtifactSource } from '../src/store/frames';

const DB = process.env['DATABASE_URL'];
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const AGENT = '00000000-0000-0000-0000-0000000000a1';
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const send = (actor: Actor, body: unknown) => app!.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

afterAll(async () => { await sql?.end(); await store?.close(); });

describe.skipIf(!DB)('real app screenshots on postgres', () => {
  it('a person\'s image counts, an agent\'s does not until the repository mark, and the command names why', async () => {
    const { workspaceId: ws } = await j(await send(george, { type: 'workspace.create', name: 'Shot Lab', slug: 'shot-lab' }));
    const proj = await j(await send(george, { type: 'project.create', workspace: ws, name: 'App' }));
    const { channelId } = await j(await send(george, { type: 'channel.create', workspace: ws, project: proj.projectId, slug: 'marketing' }));
    // a person's upload to Files: a real screenshot
    expect((await send(george, { type: 'artifact.create', channel: channelId, kind: 'file', name: 'home.png', mime: 'image/png', inlineContent: PNG })).status).toBe(200);
    expect(await libraryImage(store!, channelId, 'home.png')).toMatchObject({ name: 'home.png', mime: 'image/png' });
    // an agent's capture of the X profile, as George's room held
    const { id } = await store!.createChannelArtifact(
      { channelId, kind: 'file', name: 'x-profile-capture.png', inlineContent: PNG, mime: 'image/png', createdByKind: 'agent', createdBy: AGENT },
      (w) => createEvent({ type: 'artifact.created', source: formatAddress({ kind: 'agent', id: AGENT }), target: formatAddress({ kind: 'channel', slug: channelId }), workspace: w, payload: {} }),
    );
    expect(await libraryImage(store!, channelId, 'x-profile-capture.png')).toBeNull();
    expect(await libraryImage(store!, channelId, 'x-profile-capture.png', { any: true })).toMatchObject({ name: 'x-profile-capture.png' });
    const refused = await send(george, { type: 'content.create', channel: channelId, platform: 'x', body: 'caption', script: '[0:00-0:03] hook\n[0:03-0:07] the app home screen. SHOW: x-profile-capture.png' });
    expect(refused.status).toBe(404);
    expect((await j(refused)).error).toMatch(/"x-profile-capture.png" is not an app screenshot: an agent made it/);
    // positive control: the platform's copy of a repository file counts, and the column keeps the file's address
    await setArtifactSource(store!, id, 'repo:acme/app/screens/home.png@3f2a9c1');
    expect(await libraryImage(store!, channelId, 'x-profile-capture.png')).toMatchObject({ name: 'x-profile-capture.png' });
    const [row] = await sql!`select source, created_by_kind from artifacts where id = ${id}::uuid`;
    expect(row).toMatchObject({ source: 'repo:acme/app/screens/home.png@3f2a9c1', created_by_kind: 'agent' });
    expect((await send(george, { type: 'content.create', channel: channelId, platform: 'x', body: 'caption', script: '[0:00-0:03] hook\n[0:03-0:07] the app home screen. SHOW: x-profile-capture.png' })).status).toBe(200);
  });
});
