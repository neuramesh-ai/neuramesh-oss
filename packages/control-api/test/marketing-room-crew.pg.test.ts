// a marketing room gets its marketers (plume for browser workspaces, design item 6, 2026-10-04): a room
// that BECOMES a marketing room links every active marketer of the workspace, in the same transaction
// as its setup task. it is the one exception to the isolation rule beside the orchestrator's, so every
// other role still joins a room only through the "+" or rex's add card. the memory store does not model
// room membership, so only this lane proves it. run via scripts/test-pg.sh, skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
}

let WS = '';
// the names of every agent linked to a room, retired ones included
const crew = async (channelId: string): Promise<string[]> =>
  (await sql!`select a.name from agent_channels ac join agents a on a.id = ac.agent_id where ac.channel_id = ${channelId}::uuid order by a.name`).map((r) => r['name'] as string);
const roomOf = async (projectId: string, slug: string) =>
  (await sql!`select id, kind from channels where project_id = ${projectId}::uuid and slug = ${slug}`)[0]!;

beforeAll(async () => {
  if (!DB) return;
  // an ISOLATED workspace: the database is live for every other pg suite
  const ws = await j(await send(george, { type: 'workspace.create', name: 'Marketing Crew', slug: `marketing-crew-${Date.now().toString(36)}` }));
  WS = ws.workspaceId;
  const mach = await j(await send(george, { type: 'machine.register', workspace: WS, name: 'crew-rig', platform: 'darwin', daemonVersion: '0.1.0' }));
  const register = (name: string, role: string, channels: string[]) =>
    send(george, { type: 'agent.register', workspace: WS, machineId: mach.machineId, name, role, channels });
  expect((await register('rex', 'orchestrator', ['general'])).status).toBe(200);
  expect((await register('plume', 'marketer', ['marketing'])).status).toBe(200);
  expect((await register('patch', 'developer', ['general', 'build'])).status).toBe(200);
  // a person let this marketer go, so no new room may bring it back
  const quill = await j(await register('quill', 'marketer', ['marketing']));
  expect((await send(george, { type: 'agent.retire', agent: quill.agentId })).status).toBe(200);
});

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('a marketing room gets the workspace marketers', () => {
  it("a new project's marketing room gets the active marketer and not a retired one", async () => {
    const proj = await j(await send(george, { type: 'project.create', workspace: WS, name: 'Launch', newChannels: ['general', 'build', 'marketing'] }));
    const marketing = await roomOf(proj.projectId, 'marketing');
    expect(marketing['kind']).toBe('marketing');
    expect(await crew(marketing['id'] as string)).toEqual(['plume', 'rex']);
    // the other new rooms keep the isolation rule: the orchestrator only
    expect(await crew((await roomOf(proj.projectId, 'general'))['id'] as string)).toEqual(['rex']);
    expect(await crew((await roomOf(proj.projectId, 'build'))['id'] as string)).toEqual(['rex']);
  });

  it('a room flipped to marketing gets the active marketer once', async () => {
    const [row] = await sql!`select c.id from channels c join projects p on p.id = c.project_id
      where c.workspace_id = ${WS}::uuid and p.is_default and c.slug = 'research'`;
    const research = row!['id'] as string;
    expect(await crew(research)).toEqual(['rex']);
    expect((await send(george, { type: 'channel.set_kind', channel: research, kind: 'marketing' })).status).toBe(200);
    expect(await crew(research)).toEqual(['plume', 'rex']);
    // a person takes plume out of the room, and a second flip to marketing leaves that choice standing
    expect((await send(george, { type: 'channel.remove_agent', workspace: WS, channel: research, agent: 'plume' })).status).toBe(200);
    expect((await send(george, { type: 'channel.set_kind', channel: research, kind: 'marketing' })).status).toBe(200);
    expect(await crew(research)).toEqual(['rex']);
  });
});
