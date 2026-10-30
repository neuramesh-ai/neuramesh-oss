import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, formatAddress } from '@neuramesh/shared';
import { createApp } from '../src/app';
import { executeCommand } from '../src/handler';
import { MemoryStore } from '../src/store';
import { activationEnabled, requireActivation } from '../src/activation';
import { rowsToDesired } from '../src/fleet';

let store: MemoryStore;
let workspace: string;
beforeEach(async () => {
  vi.stubEnv('NM_REQUIRE_TRIAL_ACTIVATION', '1');
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

describe('hosted activation', () => {
  it('keeps existing workspaces readable and exposes their activation requirement', async () => {
    const res = await request('/v1/workspaces');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { workspaces: unknown[] }).workspaces[0]).toMatchObject({ id: workspace, activationRequired: true });
  });
  it('refuses direct messages, starter calls and wakes before they consume resources', async () => {
    for (const path of ['/v1/messages', '/v1/starter/generate', '/v1/machines/wake']) {
      const res = await request(path, { workspace, body: 'hello' });
      expect(res.status).toBe(402);
      expect(((await res.json()) as { code: string }).code).toBe('ACTIVATION_REQUIRED');
    }
  });
  it('refuses the command path even when an older client skips the payment screen', async () => {
    await expect(executeCommand(store, { kind: 'human', id: 'owner' }, {
      type: 'thread.unsettle', workspace, threadId: '00000000-0000-4000-8000-000000000001',
    })).rejects.toMatchObject({ code: 'ACTIVATION_REQUIRED', status: 402 });
  });
  it('allows setup before activation', async () => {
    await expect(executeCommand(store, { kind: 'human', id: 'owner' }, {
      type: 'workspace.update', workspace, activeModelPack: 'starter',
    })).resolves.toBeDefined();
  });
  it('does not bypass billing when Stripe is unconfigured', async () => {
    expect((await request('/v1/billing/trial', { workspace })).status).toBe(404);
    await expect(requireActivation(store, workspace)).rejects.toMatchObject({ code: 'ACTIVATION_REQUIRED' });
  });
  it('allows a verified trial and gates it again after cancellation', async () => {
    await store.setWorkspacePlan(workspace, { plan: 'cloud', subscriptionStatus: 'trialing' });
    await expect(requireActivation(store, workspace)).resolves.toBeUndefined();
    await store.setWorkspacePlan(workspace, { plan: 'free', subscriptionStatus: 'canceled' });
    await expect(requireActivation(store, workspace)).rejects.toMatchObject({ code: 'ACTIVATION_REQUIRED' });
  });
  it('leaves local-only installations and the staged rollout unchanged', () => {
    vi.stubEnv('NM_LOCAL', '1');
    expect(activationEnabled()).toBe(false);
    vi.stubEnv('NM_LOCAL', '0');
    vi.stubEnv('NM_REQUIRE_TRIAL_ACTIVATION', '0');
    expect(activationEnabled()).toBe(false);
  });
  it('parks free cloud machines without deleting their volumes', () => {
    const machine = { id: 'machine', workspace_id: workspace, workspace_plan: 'free', kind: 'runner', owner_user_id: 'owner', desired_replicas: 1, lifecycle: 'active', resources: {}, substrate: 'volume' };
    const desired = rowsToDesired([machine]);
    expect(desired.workspaces[0]?.machines[0]).toMatchObject({ id: 'machine', replicas: 0 });
    expect(rowsToDesired([{ ...machine, workspace_plan: 'cloud' }]).workspaces[0]?.machines[0]?.replicas).toBe(1);
  });
});
