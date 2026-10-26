// Exercise the real cold-boot handoff to the wizard. Pure workspace selection tests did not
// catch the missing resume ID assignment that made a signed release propose a duplicate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeConnection } from '../connections';
import { onboardTarget } from './onboard-target';
import { onboardOrderFor } from '../../renderer/src/views/onboard-order';

const root = mkdtempSync(join(tmpdir(), 'nm-boot-resume-'));
let memberships: Array<{ id: string; name: string; slug: string; onboarded: boolean }> = [];
let registrations = 0;
class Replica {
  async connect() {}
  async activate() {}
  async disconnectAndClear() { throw new Error('a held workspace must not erase its replica'); }
  registerListener() {}
}
const fakeSync = {
  ApiError: class extends Error {}, actorId: () => 'owner',
  apiOn: async (_conn: unknown, path: string) => {
    if (path === '/v1/workspaces') return { workspaces: memberships };
    if (path === '/v1/invites/mine') return { invites: [] };
    throw new Error(`unexpected API call ${path}`);
  },
};
const mocks: Record<string, unknown> = {
  electron: { app: {}, BrowserWindow: { getAllWindows: () => [] }, Notification: {} },
  '@neuramesh/client-core/sqlite-replica': { SQLiteReplica: Replica },
  '../apiauth': {}, '../auth': {}, '../auth-clerk': {},
  '../agents': { startAgentHost: () => {} }, '../notify': { startNotifications: () => {} },
  '../sync': fakeSync,
  './sqlite-driver': { sqliteDriver: () => ({}), upgradeReplica: async () => {} },
  './machine': { registerThisMachine: async () => { registrations++; return 'machine'; } },
  './seeds': { backfillSeeds: async () => {} },
};
type Loader = { _load: (request: string, parent: { filename?: string }, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const realLoad = loader._load;
let bootConnection: typeof import('./boot')['bootConnection'];
before(async () => {
  loader._load = function (request, parent, ...rest) {
    if (parent?.filename?.endsWith('/sync/boot.ts') && request in mocks) return mocks[request];
    return realLoad.call(this, request, parent, ...rest);
  };
  try { ({ bootConnection } = await import('./boot')); } finally { loader._load = realLoad; }
});
after(() => rmSync(root, { recursive: true, force: true }));
const fixture = (name: string, workspace?: string) => {
  const conn = makeConnection({ id: name, kind: 'cloud', authMode: 'clerk', apiUrl: 'https://api.example', webUrl: '' },
    { replicaPath: join(root, `${name}.db`), markerPath: join(root, `${name}.json`) }, 'owner');
  if (workspace) writeFileSync(conn.markerPath, JSON.stringify({ workspaceId: workspace }));
  return conn;
};
const deps = { agentLog: {} as never, killTaskPtys: () => {} };

test('cold boot resumes the selected unfinished workspace and Launch adopts it without another create', async () => {
  memberships = [{ id: 'older', name: 'Existing', slug: 'existing', onboarded: true },
    { id: 'canary', name: 'Rollout canary', slug: 'rollout-canary', onboarded: false }];
  const conn = fixture('unfinished', 'canary');
  registrations = 0;
  await bootConnection(conn, deps);
  assert.equal(conn.needsOnboarding, true);
  assert.equal(conn.resumeWorkspaceId, 'canary');
  assert.deepEqual(conn.wsInfo, { name: 'Rollout canary', slug: 'rollout-canary' });
  assert.equal(onboardOrderFor({ web: false, resume: !!conn.resumeWorkspaceId }).includes('workspace'), false);
  assert.deepEqual(onboardTarget({ workspaceId: conn.resumeWorkspaceId }, conn.session.wsMemberships),
    { kind: 'adopt', workspaceId: 'canary', info: conn.wsInfo });
  assert.equal(registrations, 0, 'the wizard owns machine and crew registration until setup finishes');
});

test('a completed workspace clears a stale resume target and starts its normal host', async () => {
  memberships = [{ id: 'ready', name: 'Ready', slug: 'ready', onboarded: true }];
  const conn = fixture('finished', 'ready');
  conn.resumeWorkspaceId = 'old-unfinished';
  registrations = 0;
  await bootConnection(conn, deps);
  assert.equal(conn.needsOnboarding, false);
  assert.equal(conn.resumeWorkspaceId, undefined);
  assert.equal(registrations, 1);
  assert.equal(conn.agentHostStarted, true);
});

test('an account with no workspace still gets the create step and no invented resume target', async () => {
  memberships = [];
  const conn = fixture('new-account');
  registrations = 0;
  await bootConnection(conn, deps);
  assert.equal(conn.needsOnboarding, true);
  assert.equal(conn.resumeWorkspaceId, undefined);
  assert.equal(onboardOrderFor({ web: false, resume: !!conn.resumeWorkspaceId }).includes('workspace'), true);
  assert.deepEqual(onboardTarget({ workspaceId: conn.resumeWorkspaceId }, conn.session.wsMemberships), { kind: 'create' });
  assert.equal(registrations, 0);
});
