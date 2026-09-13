// channel.set_kind (docs/design/marketing-channel-2026-07 §4.1): what a room is for —
// 'build' runs today's chat + board, 'marketing' runs the growth HQ. A lens plus a
// toolbelt, never a silo. HUMAN-ONLY (stricter than thread_mode: rooms change trade by
// the settings Kind row or the one-time #marketing upgrade prompt, never by an agent);
// enum-bounded to build|marketing. Enforced in the server, not prompted.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: 'patch', role: 'developer' };

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function send(actor: Actor, body: unknown) {
  return app.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

// a real room to convert: project → channel, returning the channel id
async function makeRoom(): Promise<string> {
  const proj = await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Room Home' }));
  const chan = await j(await send(george, { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'marketing' }));
  return chan.channelId as string;
}

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('channel.set_kind — a room changes trade only by a human', () => {
  it('a worker can NOT set it', async () => {
    const res = await send(patch, { type: 'channel.set_kind', channel: 'c1', kind: 'marketing' });
    expect(res.status).toBe(403);
  });

  it('even the orchestrator can NOT set it (stricter than thread_mode — the prompt and the settings row are human surfaces)', async () => {
    const channel = await makeRoom();
    const res = await send(rex, { type: 'channel.set_kind', channel, kind: 'marketing' });
    expect(res.status).toBe(403);
  });

  it('rejects a kind outside build|marketing (the enum boundary)', async () => {
    const res = await send(george, { type: 'channel.set_kind', channel: 'c1', kind: 'sales' });
    expect(res.status).toBe(400);
  });

  it('a human converts a real room to marketing, then back to build (both enum values round-trip the store)', async () => {
    const channel = await makeRoom();
    expect((await send(george, { type: 'channel.set_kind', channel, kind: 'marketing' })).status).toBe(200);
    expect((await send(george, { type: 'channel.set_kind', channel, kind: 'build' })).status).toBe(200);
  });

  it('an unknown channel is NOT_FOUND, not a silent no-op', async () => {
    const res = await send(george, { type: 'channel.set_kind', channel: 'ffffffff-0000-0000-0000-000000000000', kind: 'marketing' });
    expect(res.status).toBe(404);
  });
});
