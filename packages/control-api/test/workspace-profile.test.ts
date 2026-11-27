// The first run's company answers (docs/design/onboarding-2026-11 O2, O7) at the command layer:
// a person answers card 1 for their own workspace, the answer can rename it, an agent can never
// answer, and a workspace with a profile gets no marketing setup task from the boot backfill.
// The owner-or-admin check and the no-agents half of the backfill rule live in pgstore; the pg lane
// covers them (workspace-profile.pg.test.ts).
import type { Actor, Task } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const maya: Actor = { kind: 'human', id: 'maya' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const send = (actor: Actor, body: unknown) => app.request('/v1/commands', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
  body: JSON.stringify(body),
});
const tasksOf = (s: MemoryStore): Task[] => [...(s as unknown as { tasks: Map<string, Task> }).tasks.values()];

let ws = '';
beforeEach(async () => {
  store = new MemoryStore();
  app = createApp(store);
  ws = (await j(await send(maya, { type: 'workspace.create', name: "Maya's workspace", slug: 'maya-ws' }))).workspaceId;
});

describe('workspace.set_profile', () => {
  it('stores the answers and renames the workspace', async () => {
    const r = await send(maya, { type: 'workspace.set_profile', workspace: ws, name: 'Fieldnote', profile: { sells: 'software', size: '2-5', help: ['product', 'mail'], website: ' fieldnote.app ' } });
    expect(r.status).toBe(200);
    const [w] = await store.listWorkspaces('maya');
    expect(w!.name).toBe('Fieldnote');
    expect(w!.profile).toEqual({ sells: 'software', size: '2-5', help: ['product', 'mail'], website: 'fieldnote.app' });
  });

  it('keeps the name when the card sends none, and reads a skip as an answer', async () => {
    await send(maya, { type: 'workspace.set_profile', workspace: ws, profile: { skipped: true } });
    const [w] = await store.listWorkspaces('maya');
    expect(w!.name).toBe("Maya's workspace");
    expect(w!.profile).toEqual({ help: [], skipped: true });
  });

  it('refuses an agent', async () => {
    const r = await send(rex, { type: 'workspace.set_profile', workspace: ws, profile: { help: [] } });
    expect(r.status).toBe(403);
    expect((await store.listWorkspaces('maya'))[0]!.profile).toBeNull();
  });

  it('refuses an answer outside the lists', async () => {
    const r = await send(maya, { type: 'workspace.set_profile', workspace: ws, profile: { sells: 'rockets', help: [] } });
    expect(r.status).toBe(400);
  });
});

describe('the boot backfill after the new first run', () => {
  // a bare marketing room with no setup task, the way the old birth left one before a backfill ran
  const bareRoom = async () => {
    const proj = await j(await send(maya, { type: 'project.create', workspace: ws, name: 'Growth' }));
    const chan = await j(await send(maya, { type: 'channel.create', workspace: ws, project: proj.projectId, slug: 'growth' }));
    const rooms = (store as unknown as { channels: Array<{ id: string; kind?: string }> }).channels;
    rooms.find((c) => c.id === chan.channelId)!.kind = 'marketing';
  };

  it('plants the setup task in a workspace with no profile, as before', async () => {
    await bareRoom();
    expect((await j(await send(rex, { type: 'setup.backfill', workspace: ws }))).created).toBe(1);
  });

  it('plants nothing in a workspace whose first run answered card 1', async () => {
    await bareRoom();
    await send(maya, { type: 'workspace.set_profile', workspace: ws, profile: { help: ['customers'] } });
    expect((await j(await send(rex, { type: 'setup.backfill', workspace: ws }))).created).toBe(0);
    expect(tasksOf(store).filter((t) => t.kind === 'setup')).toHaveLength(0);
  });
});
