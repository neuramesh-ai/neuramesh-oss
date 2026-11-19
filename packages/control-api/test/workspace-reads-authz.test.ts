// WORKSPACE READS ANSWER MEMBERS ONLY (the Cloud Run feature suite, 2026-10-30). Six /v1 reads took
// a workspace (or a board) id and answered any authenticated caller: a stranger read the invitees'
// email addresses, the rooms' facts, full-text recall over every message, the retro, the custom
// brains and the whiteboards. Ids are not secrets (credentials-authz.ts says why), so membership is
// the gate: a human member or an agent of the workspace reads, anyone else is refused.
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let owner: string;
let stranger: string;
let ws: string;
let channel: string;

const as = (id: string) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id }) });
const get = async (path: string, id: string): Promise<Response> => app.request(path, { headers: as(id) });
const post = async (path: string, id: string, body: unknown): Promise<Response> => app.request(path, { method: 'POST', headers: as(id), body: JSON.stringify(body) });

beforeEach(async () => {
  process.env['NM_ALLOW_ACTOR_HEADER'] = '1';
  store = new MemoryStore();
  app = createApp(store);
  ({ id: owner } = await store.resolveClerkUser('clerk_owner', 'owner@example.com'));
  ({ id: stranger } = await store.resolveClerkUser('clerk_stranger', 'stranger@example.com'));
  const made = await post('/v1/commands', owner, { type: 'workspace.create', name: 'Acme', slug: 'acme-reads' });
  const body = (await made.json()) as { workspaceId: string; channelId: string };
  ws = body.workspaceId;
  channel = body.channelId;
});

describe('workspace reads: members only', () => {
  const reads = (): Array<[string, (id: string) => Promise<Response>]> => [
    ['GET /v1/invites', (id) => get(`/v1/invites?workspace=${ws}`, id)],
    ['GET /v1/memory', (id) => get(`/v1/memory?workspace=${ws}&channel=${channel}`, id)],
    ['POST /v1/recall', (id) => post('/v1/recall', id, { workspace: ws, query: 'launch' })],
    ['GET /v1/retro', (id) => get(`/v1/retro?workspace=${ws}&range=week`, id)],
    ['GET /v1/model-packs', (id) => get(`/v1/model-packs?workspace=${ws}`, id)],
    ['GET /v1/whiteboards', (id) => get(`/v1/whiteboards?workspace=${ws}`, id)],
  ];

  it('refuses a signed-in stranger who holds the workspace id', async () => {
    for (const [name, call] of reads()) {
      const res = await call(stranger);
      expect(res.status, name).toBe(403);
      expect(((await res.json()) as { code?: string }).code, name).toBe('NOT_PERMITTED');
    }
  });

  it('still answers the workspace\'s own member', async () => {
    for (const [name, call] of reads()) {
      const res = await call(owner);
      // the memory store serves no retro (501): the point is that the gate let the member through
      expect([200, 501], name).toContain(res.status);
    }
  });
  // a board by id and by channel, and a stranger's patch: test/whiteboards.pg.test.ts (the memory
  // store files boards under seed channels, so a board here would not sit in this file's workspace)
});

describe('workspace writes: a person writes only where they are a member (handler/scope.ts)', () => {
  const writes = (): Array<[string, (id: string) => Promise<Response>]> => [
    ['POST /v1/messages', (id) => post('/v1/messages', id, { workspace: ws, channel, body: 'hello' })],
    ['task.create', (id) => post('/v1/commands', id, { type: 'task.create', workspace: ws, channel, title: 'a task' })],
    ['memory.upsert_fact', (id) => post('/v1/commands', id, { type: 'memory.upsert_fact', workspace: ws, channel, content: 'a fact worth keeping' })],
    ['skill.create', (id) => post('/v1/commands', id, { type: 'skill.create', workspace: ws, name: 'a-skill', description: 'x', scope: 'global', body: 'x' })],
    ['POST /v1/artifacts', (id) => post('/v1/artifacts', id, { id: '11111111-2222-4333-8444-555555555556', workspace: ws, channel, messageId: '11111111-2222-4333-8444-555555555557', kind: 'file', name: 'x.txt', inlineContent: 'x' })],
    ['POST /v1/whiteboards', (id) => post('/v1/whiteboards', id, { id: '11111111-2222-4333-8444-555555555558', workspace: ws, channel, title: 'plan', rev: 1 })],
  ];

  it('refuses a signed-in stranger who holds the workspace and room ids', async () => {
    for (const [name, call] of writes()) {
      const res = await call(stranger);
      expect(res.status, name).toBe(403);
      expect(((await res.json()) as { code?: string }).code, name).toBe('NOT_PERMITTED');
    }
  });

  it('never refuses the workspace\'s own member on membership', async () => {
    for (const [name, call] of writes()) {
      const res = await call(owner);
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      expect(body.error, name).not.toBe('not your workspace');
    }
  });

  it('an invitation is answered by someone who is not a member yet', async () => {
    const res = await post('/v1/commands', stranger, { type: 'workspace.accept_invite', invite: '11111111-2222-4333-8444-555555555559' });
    expect(((await res.json()) as { error?: string }).error).not.toBe('not your workspace');
  });
});
