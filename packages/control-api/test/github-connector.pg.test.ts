// The GitHub connector on postgres (docs/design/github-connector-2026-09): 0142's widened provider
// check, the installation's `selection`, and the two SQL reads the routes rest on (the room's primary
// repository, the installation by name or by account). Runs only against a real database
// (scripts/test-pg.sh); rls.pg.test.ts covers the tables' RLS.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const WS = 'a0000000-0000-0000-0000-00000000000a';
const REPO = 'b0000000-0000-0000-0000-000000000001'; // acme/marketing-site, from the fixtures
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const send = (actor: Actor, body: unknown) =>
  app!.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });

afterAll(async () => { await sql?.end(); await store?.close?.(); });

describe.skipIf(!DB)('the GitHub connector on postgres', () => {
  it('a github connectors row is legal (0142), keyed on the project like every connector', async () => {
    const proj = await j(await send(george, { type: 'project.create', workspace: WS, name: `GitHub pg ${Date.now()}` }));
    const chan = await j(await send(george, { type: 'channel.create', workspace: WS, project: proj.projectId, slug: `gh-${Date.now().toString(36)}` }));
    const { id } = await store!.upsertConnector({ workspace: WS, channelId: chan.channelId, provider: 'github', handle: 'acme/marketing-site', connectedBy: george.id, scopes: 'metadata:read contents:read pull_requests:read' });
    const conn = await store!.connectorWithSecret(WS, 'github', chan.channelId);
    expect(conn).toMatchObject({ id, status: 'connected', handle: 'acme/marketing-site', ciphertext: null });
    // the same room again swaps the handle in place, one row per project
    await store!.upsertConnector({ workspace: WS, channelId: chan.channelId, provider: 'github', handle: 'acme/other', connectedBy: george.id, scopes: '' });
    const [n] = await sql!`select count(*)::int as n from connectors where project_id = ${proj.projectId}::uuid and provider = 'github'`;
    expect(n!['n']).toBe(1);
    await expect(sql!`insert into connectors (workspace_id, provider) values (${WS}::uuid, 'gitlab')`).rejects.toThrow(/connectors_provider_check/);
  });
  it('the room\'s repository, through the project: the one with a GitHub address wins over a local primary (plan §7)', async () => {
    const proj = await j(await send(george, { type: 'project.create', workspace: WS, name: `GitHub repo ${Date.now()}` }));
    const chan = await j(await send(george, { type: 'channel.create', workspace: WS, project: proj.projectId, slug: `ghr-${Date.now().toString(36)}` }));
    expect(await store!.announcements.repoForChannel(chan.channelId)).toBeNull();
    // a folder attached from a desktop is the primary: it names no GitHub side
    const local = await j(await send(george, { type: 'repo.link', workspace: WS, channel: chan.channelId, localPath: `/home/george/code/site-${Date.now()}`, name: 'marketing-site' }));
    expect(await store!.announcements.repoForChannel(chan.channelId)).toMatchObject({ repoId: local.repoId, orgName: 'local', cloneUrl: null });
    await sql!`insert into project_repos (project_id, repo_id, is_primary) values (${proj.projectId}::uuid, ${REPO}::uuid, false)`;
    expect(await store!.announcements.repoForChannel(chan.channelId)).toMatchObject({ workspaceId: WS, projectId: proj.projectId, repoId: REPO, orgName: 'acme', name: 'marketing-site', cloneUrl: 'git@github.com:acme/marketing-site.git' });
    const [primary] = await sql!`select repo_id from project_repos where project_id = ${proj.projectId}::uuid and is_primary`;
    expect(primary!['repo_id']).toBe(local.repoId);
  });
  it('installations: by name, or by account on an all-repositories grant; a workspace once named is kept', async () => {
    const ann = store!.announcements;
    await ann.upsertInstallation({ installationId: 990001, account: 'acme', repos: ['acme/marketing-site'], selection: 'selected', workspaceId: WS });
    await ann.upsertInstallation({ installationId: 990002, account: 'wideorg', repos: ['wideorg/one'], selection: 'all' });
    expect(await ann.installationForRepo('ACME/Marketing-Site')).toEqual({ installationId: 990001 });
    expect(await ann.installationForRepo('wideorg/brand-new')).toEqual({ installationId: 990002 });
    expect(await ann.installationForRepo('acme/unlisted')).toBeNull();
    // the public door's callback names no workspace: the app's grant is not forgotten
    await ann.upsertInstallation({ installationId: 990001, account: 'acme', repos: ['acme/marketing-site', 'acme/two'] });
    const [row] = await sql!`select workspace_id, selection, repos from github_installations where installation_id = 990001`;
    expect(row).toMatchObject({ workspace_id: WS, selection: 'selected', repos: ['acme/marketing-site', 'acme/two'] });
    // the pick lists the workspace's own installations, never the door's
    expect((await ann.installationsForWorkspace(WS)).filter((i) => i.installationId >= 990001)).toEqual([{ installationId: 990001, account: 'acme', repos: ['acme/marketing-site', 'acme/two'], selection: 'selected' }]);
    await sql!`delete from github_installations where installation_id in (990001, 990002)`;
  });
});
