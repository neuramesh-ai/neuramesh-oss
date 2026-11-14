// Repository bundles (repo-bundles.ts, NM_REPO_BUNDLES=1): a repository that is not on GitHub reaches a
// cloud machine as a `git bundle` in GCS. These tests hold the fences of the three doors. The upload
// sign route is for a person who is a member of the workspace. repo.link records a bundle row only
// for an object that exists in that workspace. The machine sign route reads a bundle of the TOKEN's
// workspace and never writes one. They also pin that a bundle row never reads as GitHub, so a bundle
// never asks for the GitHub App.
import type { Actor } from '@neuramesh/shared';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from './commands';
import type { SnapshotStorage } from './gcs-sign';
import { parseRepoUrl } from './handler/guards';
import { repoCommands } from './handler/repo';
import { hashMachineToken } from './machine-auth';
import { machineSnapshotRoutes } from './machine-snapshots';
import { BUNDLE_URL_SECONDS, bundleKeyOf, bundleObject, repoBundleRoutes, useRepoBundleStorage } from './repo-bundles';
import type { Store } from './store';
import { hasGitHubAddress } from './store/announce';

const WS = '0f0f0f0f-0000-4000-8000-000000000001';
const OTHER_WS = '0f0f0f0f-0000-4000-8000-000000000999';
const MACHINE = '1a1a1a1a-0000-4000-8000-000000000001';
const TOKEN = `nmm_${'ab'.repeat(24)}`;
const NOW = new Date('2026-10-30T12:00:00.000Z');
const EMAIL = 'nm-api@p.iam.gserviceaccount.com';
const MEMBER: Actor = { kind: 'human', id: 'u-member' };
const STRANGER: Actor = { kind: 'human', id: 'u-stranger' };

const signer = { email: async () => EMAIL, signBlob: async (p: Buffer) => createHash('sha256').update(p).digest() };
function storageWith(objects: Record<string, number> = {}): SnapshotStorage & { stats: string[] } {
  const stats: string[] = [];
  return { bucket: 'nm-snapshots', signer, stats, stat: async (object) => { stats.push(object); return object in objects ? { size: objects[object]! } : null; } };
}

const linkRepo = vi.fn(async (_input: Record<string, unknown>, _event: unknown) => ({ id: 'repo-1', inserted: true }));
const store = {
  humanMemberIds: async (ws: string) => (ws === WS ? [MEMBER.id] : []),
  agentWorkspace: async () => null,
  machineByTokenHash: async (hash: string) =>
    hash === hashMachineToken(TOKEN) ? { id: MACHINE, workspace_id: WS, owner_user_id: 'u1', kind: 'member', owner_clerk_id: null } : null,
  linkRepo,
} as unknown as Store;

let saved: string | undefined;
beforeEach(() => {
  saved = process.env['NM_REPO_BUNDLES'];
  process.env['NM_REPO_BUNDLES'] = '1';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  linkRepo.mockClear();
});
afterEach(() => {
  if (saved === undefined) delete process.env['NM_REPO_BUNDLES']; else process.env['NM_REPO_BUNDLES'] = saved;
  useRepoBundleStorage(undefined);
  vi.restoreAllMocks();
});

function humanApp(actor: Actor, storage: SnapshotStorage | null = storageWith()) {
  const app = new Hono<{ Variables: { actor: Actor } }>();
  // stand-in for app.ts's /v1 gate, which sets the actor from the session
  app.use('/v1/*', async (c, next) => { c.set('actor', actor); await next(); });
  repoBundleRoutes(app, store, { storage, now: () => NOW, suffix: () => 'a1b2c3d4' });
  return (body: unknown) => app.request('/v1/repos/bundles/sign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /v1/repos/bundles/sign', () => {
  it('signs a PUT of exactly one object under the workspace\'s repos/ prefix, for a member', async () => {
    const res = await humanApp(MEMBER)({ workspace: WS, name: 'Eval Fixture!' });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { key: string; cloneUrl: string; url: string; method: string; headers: Record<string, string>; expiresInSeconds: number };
    expect(out.key).toBe('eval-fixture-a1b2c3d4');
    expect(out.cloneUrl).toBe('nm-bundle:eval-fixture-a1b2c3d4');
    expect(out.method).toBe('PUT');
    expect(out.headers).toEqual({ 'content-type': 'application/x-git-bundle' });
    expect(out.expiresInSeconds).toBe(BUNDLE_URL_SECONDS);
    const url = new URL(out.url);
    expect(url.origin + url.pathname).toBe(`https://storage.googleapis.com/nm-snapshots/v1/workspaces/${WS}/repos/eval-fixture-a1b2c3d4.bundle`);
    // the content type is signed, so GCS refuses an upload of anything that does not claim to be a bundle
    expect(url.searchParams.get('X-Goog-SignedHeaders')).toBe('content-type;host');
    expect(url.searchParams.get('X-Goog-Date')).toBe('20261030T120000Z');
  });

  it('is off without NM_REPO_BUNDLES=1', async () => {
    delete process.env['NM_REPO_BUNDLES'];
    const res = await humanApp(MEMBER)({ workspace: WS, name: 'x' });
    expect(res.status).toBe(501);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_CONFIGURED');
  });

  it('refuses a machine or an agent, a stranger to the workspace, a bad body and a missing bucket', async () => {
    expect((await humanApp({ kind: 'agent', id: 'a1' } as Actor)({ workspace: WS, name: 'x' })).status).toBe(403);
    const stranger = await humanApp(STRANGER)({ workspace: WS, name: 'x' });
    expect(stranger.status).toBe(403);
    expect(((await stranger.json()) as { code: string }).code).toBe('NOT_PERMITTED');
    expect((await humanApp(MEMBER)({ workspace: OTHER_WS, name: 'x' })).status).toBe(403);
    expect((await humanApp(MEMBER)({ workspace: 'not-a-uuid', name: 'x' })).status).toBe(400);
    expect((await humanApp(MEMBER)({ workspace: WS, name: '' })).status).toBe(400);
    expect((await humanApp(MEMBER, null)({ workspace: WS, name: 'x' })).status).toBe(503);
  });
});

describe('repo.link with nm-bundle:<key>', () => {
  const key = 'fixture-a1b2c3d4';
  const link = (actor: Actor, over: Record<string, unknown> = {}) =>
    repoCommands(store, actor, { type: 'repo.link', workspace: WS, url: `nm-bundle:${key}`, name: 'fixture', defaultBranch: 'main', ...over } as unknown as Command);

  it('records provider bundle, org bundle, the person\'s name and the nm-bundle clone URL', async () => {
    const storage = storageWith({ [bundleObject(WS, key)]: 2048 });
    useRepoBundleStorage(storage);
    expect(await link(MEMBER)).toMatchObject({ ok: true, repoId: 'repo-1' });
    expect(storage.stats).toEqual([`v1/workspaces/${WS}/repos/${key}.bundle`]);
    expect(linkRepo).toHaveBeenCalledTimes(1);
    expect(linkRepo.mock.calls[0]![0]).toMatchObject({ workspace: WS, provider: 'bundle', orgName: 'bundle', name: 'fixture', cloneUrl: `nm-bundle:${key}`, localPath: null, defaultBranch: 'main' });
  });

  it('names the row by its key when the person gave no name', async () => {
    useRepoBundleStorage(storageWith({ [bundleObject(WS, key)]: 2048 }));
    await link(MEMBER, { name: undefined });
    expect(linkRepo.mock.calls[0]![0]).toMatchObject({ name: key });
  });

  it('refuses a stranger, an object that does not exist, a bad key, and the flag off, and writes nothing', async () => {
    useRepoBundleStorage(storageWith({ [bundleObject(WS, key)]: 2048 }));
    await expect(link(STRANGER)).rejects.toMatchObject({ code: 'NOT_PERMITTED' });
    await expect(link(MEMBER, { url: 'nm-bundle:other-key' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(link(MEMBER, { url: 'nm-bundle:../escape' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    useRepoBundleStorage(null);
    await expect(link(MEMBER)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    delete process.env['NM_REPO_BUNDLES'];
    useRepoBundleStorage(storageWith({ [bundleObject(WS, key)]: 2048 }));
    await expect(link(MEMBER)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(linkRepo).not.toHaveBeenCalled();
  });
});

describe('POST /v1/machines/snapshots/sign, kind bundle', () => {
  function machineApp(objects: Record<string, number> = {}) {
    const app = new Hono<{ Variables: { actor: Actor } }>();
    machineSnapshotRoutes(app, store, { storage: storageWith(objects), fence: async () => {}, now: () => NOW });
    return (body: unknown) => app.request('/v1/machines/snapshots/sign', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });
  }

  it('downloads a bundle of the token\'s workspace, whatever workspace the body names', async () => {
    const sign = machineApp({ [bundleObject(WS, 'fixture-1')]: 2048 });
    const res = await sign({ kind: 'bundle', key: 'fixture-1', op: 'download', workspace: OTHER_WS });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { url: string; object: string; method: string };
    expect(out.method).toBe('GET');
    expect(out.object).toBe(`v1/workspaces/${WS}/repos/fixture-1.bundle`);
    expect(new URL(out.url).pathname).toBe(`/nm-snapshots/v1/workspaces/${WS}/repos/fixture-1.bundle`);
    expect((await sign({ kind: 'bundle', key: 'absent', op: 'download' })).status).toBe(404);
    expect(await (await sign({ kind: 'bundle', key: 'fixture-1', op: 'exists' })).json()).toMatchObject({ exists: true });
  });

  it('never signs a machine upload of a bundle, and is off without the flag', async () => {
    const sign = machineApp();
    const up = await sign({ kind: 'bundle', key: 'fixture-1', op: 'upload', epoch: 1 });
    expect(up.status).toBe(403);
    expect(((await up.json()) as { url?: string }).url).toBeUndefined();
    expect((await sign({ kind: 'bundle', prefix: '', op: 'list' })).status).toBe(400);
    delete process.env['NM_REPO_BUNDLES'];
    expect((await sign({ kind: 'bundle', key: 'fixture-1', op: 'download' })).status).toBe(501);
  });
});

describe('a bundle is not GitHub', () => {
  it('parseRepoUrl reads nm-bundle:<key> only under the flag, and leaves GitHub URLs as they were', () => {
    expect(parseRepoUrl('nm-bundle:fixture-1', { NM_REPO_BUNDLES: '1' })).toEqual({ provider: 'bundle', orgName: 'bundle', name: 'fixture-1', cloneUrl: 'nm-bundle:fixture-1' });
    expect(() => parseRepoUrl('nm-bundle:fixture-1', {})).toThrow(/off on this server/);
    expect(() => parseRepoUrl('nm-bundle:a/b', { NM_REPO_BUNDLES: '1' })).toThrow(/nm-bundle:<key>/);
    expect(parseRepoUrl('https://github.com/acme/app', {})).toEqual({ provider: 'github', orgName: 'acme', name: 'app', cloneUrl: 'https://github.com/acme/app.git' });
    expect(bundleKeyOf('nm-bundle:fixture-1')).toBe('fixture-1');
    expect(bundleKeyOf('https://github.com/acme/app.git')).toBeNull();
  });

  it('hasGitHubAddress: a GitHub provider or URL, or a legacy org/name row, and never a bundle, a folder or another host', () => {
    expect(hasGitHubAddress({ provider: 'bundle', orgName: 'bundle', cloneUrl: 'nm-bundle:fixture-1' })).toBe(false);
    expect(hasGitHubAddress({ provider: 'git', orgName: 'evals', cloneUrl: 'file:///nm/work/evals/x.git' })).toBe(false);
    expect(hasGitHubAddress({ provider: 'local', orgName: 'local', cloneUrl: null })).toBe(false);
    expect(hasGitHubAddress({ provider: 'github', orgName: 'acme', cloneUrl: 'https://github.com/acme/app.git' })).toBe(true);
    expect(hasGitHubAddress({ provider: null, orgName: 'acme', cloneUrl: 'git@github.com:acme/app.git' })).toBe(true);
    expect(hasGitHubAddress({ provider: 'github', orgName: 'acme', cloneUrl: null })).toBe(true);
    expect(hasGitHubAddress({ provider: null, orgName: 'acme', cloneUrl: null })).toBe(true);
  });
});
