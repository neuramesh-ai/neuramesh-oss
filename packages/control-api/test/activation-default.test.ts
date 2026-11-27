// THE TRIAL ACTIVATION GATE IS OFF UNLESS TURNED ON (round 7, user decision 2026-11-03). Upstream's gate
// (activation.ts) holds machines at 0 replicas, refuses /v1/messages with 402 and refuses commands until
// payment details exist. The Cloud Run sandbox must behave as before the merge unless
// NM_REQUIRE_TRIAL_ACTIVATION=1 is set: unset, empty, '0' and 'true' all mean off.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, formatAddress } from '@neuramesh/shared';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';
import { activationEnabled, needsActivation, requireActivation, requireCommandActivation } from '../src/activation';
import { rowsToDesired, type CloudMachineRow } from '../src/fleet';

const row = (over: Partial<CloudMachineRow>): CloudMachineRow => ({
  id: 'm1', workspace_id: 'ws1', workspace_plan: 'free', kind: 'member', owner_user_id: 'u1',
  desired_replicas: 1, lifecycle: 'running', resources: {}, ...over,
});
const replicas = () => rowsToDesired([
  row({ id: 'k', substrate: 'volume' }),
  row({ id: 'c', substrate: 'cloudrun', size_class: 'S', restarts: 0, drain_state: null }),
]).workspaces[0]!.machines.map((m) => [m.id, m.replicas]);

let store: MemoryStore;
let workspace: string;
beforeEach(async () => {
  vi.stubEnv('NM_LOCAL', '0');
  vi.stubEnv('NM_ALLOW_ACTOR_HEADER', '1');
  store = new MemoryStore();
  const event = createEvent({ type: 'workspace.created', source: formatAddress({ kind: 'human', id: 'owner' }), target: 'resource/workspace/trial', workspace: 'trial', payload: {} });
  ({ workspaceId: workspace } = await store.createWorkspace({ name: 'Trial', slug: 'trial', createdBy: 'owner' }, event));
});
afterEach(() => vi.unstubAllEnvs());

const request = (path: string, body?: object) => createApp(store).request(path, {
  method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: 'owner' }) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

describe('the trial activation gate, default off', () => {
  for (const value of [undefined, '', '0', 'true', 'on']) {
    it(`is off when NM_REQUIRE_TRIAL_ACTIVATION is ${value === undefined ? 'unset' : JSON.stringify(value)}`, async () => {
      if (value === undefined) delete process.env['NM_REQUIRE_TRIAL_ACTIVATION'];
      else vi.stubEnv('NM_REQUIRE_TRIAL_ACTIVATION', value);
      expect(activationEnabled()).toBe(false);
      expect(needsActivation('free')).toBe(false);
      await expect(requireActivation(store, workspace)).resolves.toBeUndefined();
      // fleet: a free workspace's machines keep their replicas, the Cloud Run one included
      expect(replicas()).toEqual([['k', 1], ['c', 1]]);
      // /v1/workspaces says no activation is needed
      const listed = (await (await request('/v1/workspaces')).json()) as { workspaces: Array<{ id: string; activationRequired: boolean }> };
      expect(listed.workspaces.find((w) => w.id === workspace)?.activationRequired).toBe(false);
      // /v1/messages and the command path never answer 402
      const sent = await request('/v1/messages', { workspace, body: 'hello' });
      expect(sent.status).not.toBe(402);
      await expect(requireCommandActivation(store, { type: 'task.create', workspace, title: 'x' } as never)).resolves.toBeUndefined();
    });
  }

  it('turns on with NM_REQUIRE_TRIAL_ACTIVATION=1 only: free machines go to 0 and /v1/messages answers 402', async () => {
    vi.stubEnv('NM_REQUIRE_TRIAL_ACTIVATION', '1');
    expect(activationEnabled()).toBe(true);
    expect(replicas()).toEqual([['k', 0], ['c', 0]]);
    const sent = await request('/v1/messages', { workspace, body: 'hello' });
    expect(sent.status).toBe(402);
  });

  it('stays off on the Local stack even with the variable set', () => {
    vi.stubEnv('NM_REQUIRE_TRIAL_ACTIVATION', '1');
    vi.stubEnv('NM_LOCAL', '1');
    expect(activationEnabled()).toBe(false);
  });
});
