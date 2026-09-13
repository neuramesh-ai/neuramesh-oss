// channel.set_thread_mode (docs/20): a room-wide view lens, gated exactly like channel.rename —
// humans + the orchestrator manage it, workers can't; the mode is enum-bounded to on|off.
// Enforced in the server, not prompted. (The SQL round-trip is the pg leg / preview e2e.)
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

// a real room to flip: project → channel, returning the channel id
async function makeRoom(): Promise<string> {
  const proj = await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Room Home' }));
  const chan = await j(await send(george, { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'lounge' }));
  return chan.channelId as string;
}

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('channel.set_thread_mode — a room-wide view lens, gated like rename', () => {
  it('a worker can NOT set it (channels are managed by humans or the orchestrator)', async () => {
    const res = await send(patch, { type: 'channel.set_thread_mode', channel: 'c1', mode: 'off' });
    expect(res.status).toBe(403);
  });

  it('rejects a mode outside on|off (the enum boundary)', async () => {
    const res = await send(george, { type: 'channel.set_thread_mode', channel: 'c1', mode: 'sideways' });
    expect(res.status).toBe(400);
  });

  it('a human flips a real room off, then back on (both enum values round-trip the store)', async () => {
    const channel = await makeRoom();
    expect((await send(george, { type: 'channel.set_thread_mode', channel, mode: 'off' })).status).toBe(200);
    expect((await send(george, { type: 'channel.set_thread_mode', channel, mode: 'on' })).status).toBe(200);
  });

  it('the orchestrator may set it too (parity with channel.rename)', async () => {
    const channel = await makeRoom();
    expect((await send(rex, { type: 'channel.set_thread_mode', channel, mode: 'off' })).status).toBe(200);
  });

  it('an unknown channel is NOT_FOUND, not a silent no-op', async () => {
    const res = await send(george, { type: 'channel.set_thread_mode', channel: 'ffffffff-0000-0000-0000-000000000000', mode: 'off' });
    expect(res.status).toBe(404);
  });
});
