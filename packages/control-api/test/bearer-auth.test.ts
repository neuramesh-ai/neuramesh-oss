import { createEvent, formatAddress } from '@neuramesh/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { DomainError } from '../src/errors';
import { MemoryStore } from '../src/store';

// Verify a Clerk Bearer token without touching Clerk's JWKS: the real verifier
// hits the network, so we stub it to map known tokens → a Clerk `sub` and reject
// everything else. All other clerk.ts exports stay real (createApp imports several).
vi.mock('../src/clerk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/clerk')>();
  return {
    ...actual,
    verifyClerkToken: vi.fn(async (token: string) => {
      if (token === 'good') return { sub: 'clerk_abc' };
      if (token === 'unknown-user') return { sub: 'clerk_nobody' };
      // the real verifier raises a TYPED error for every verdict it reaches, and the type is what
      // carries the status. A plain Error here made the stub kinder than the thing it stands for:
      // it read as "we could not check", which is a 503, and the test then held the gate to a
      // behaviour production never had.
      if (token === 'unreachable') throw new Error('fetch failed');
      throw new DomainError('AUTH_FAILED', 'bad token signature');
    }),
  };
});

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let userId: string;

function postMessage(headers: Record<string, string>) {
  return app.request('/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ workspace: 'ws_acme', channel: 'dev', body: 'hi from the phone' }),
  });
}

// The header lane is CLOSED by default (review F1, 2026-09-12); the package's test script opens it
// for the suites. This file is the one that holds the gate itself to account, so it starts every
// test with the variable UNSET and puts the script's value back afterwards — vitest reuses a worker
// across files, and a deletion left behind would close the lane for whichever suite ran next.
const scriptHeaderEnv = process.env['NM_ALLOW_ACTOR_HEADER'];
beforeEach(async () => {
  delete process.env['NM_ALLOW_ACTOR_HEADER'];
  store = new MemoryStore();
  app = createApp(store);
  // link the Clerk id the stub returns for 'good' to a real internal user id
  ({ id: userId } = await store.resolveClerkUser('clerk_abc', 'george@example.com'));
});
afterEach(() => {
  if (scriptHeaderEnv === undefined) delete process.env['NM_ALLOW_ACTOR_HEADER'];
  else process.env['NM_ALLOW_ACTOR_HEADER'] = scriptHeaderEnv;
});

describe('/v1 auth: Bearer (human) + x-nm-actor (daemon) dual-accept', () => {
  it('a valid Clerk Bearer token resolves to the mapped human actor', async () => {
    const res = await postMessage({ authorization: 'Bearer good' });
    expect(res.status).toBe(200);
    const { message } = (await res.json()) as { message: { author: unknown } };
    expect(message.author).toEqual({ kind: 'human', id: userId });
  });

  it('a Clerk identity with no linked NeuraMesh account is rejected', async () => {
    const res = await postMessage({ authorization: 'Bearer unknown-user' });
    expect(res.status).toBe(401);
  });

  it('a forged Bearer token is rejected', async () => {
    const res = await postMessage({ authorization: 'Bearer garbage' });
    expect(res.status).toBe(401);
  });

  // 401 IS A VERDICT ON THE TOKEN, NEVER ON OUR LUCK (George, 2026-09-06: "authentication failed"
  // on a phone whose session was fine). clerkJwks() throws raw on a network failure, on its
  // 8-second timeout and on unreadable JSON, and every one of those used to leave here as a 401 —
  // which the desktop answers by signing the person out. A check we could not run is a 503.
  it('a check we could not run is a 503, not a sign-out', async () => {
    const res = await postMessage({ authorization: 'Bearer unreachable' });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'AUTH_UNAVAILABLE' });
  });

  // THE CLOSED DEFAULT (review F1, 2026-09-12). Until this round the lane opened unless the variable
  // said '0', and production had accepted bare claims until Vercel was set by hand (#395). Now
  // nothing but an explicit '1' opens it — a stack that forgets the variable is a stack that
  // refuses, not one that trusts whoever reaches its port.
  it('with NM_ALLOW_ACTOR_HEADER unset, a bare x-nm-actor header is 401 AUTH_REQUIRED', async () => {
    const res = await postMessage({ 'x-nm-actor': JSON.stringify({ kind: 'human', id: userId }) });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(store.messages).toHaveLength(0);
  });

  it("with NM_ALLOW_ACTOR_HEADER='1' the legacy x-nm-actor header authenticates a daemon", async () => {
    process.env['NM_ALLOW_ACTOR_HEADER'] = '1';
    const res = await postMessage({ 'x-nm-actor': JSON.stringify({ kind: 'agent', id: 'rex', role: 'orchestrator' }) });
    expect(res.status).toBe(200);
    const { message } = (await res.json()) as { message: { author: unknown } };
    expect(message.author).toEqual({ kind: 'agent', id: 'rex' });
  });

  // The desktop host's lane since #360: the bearer proves the member, the header names the author.
  // Until 2026-09-09 the header was discarded here, so every agent row a desktop hosted landed under
  // the signed-in human (rex's replies read as George's, woke rex again, and the room looped).
  const ev = (by: string) => createEvent({ type: 'workspace.created', source: formatAddress({ kind: 'human', id: by }), target: 'resource/workspace/acme', workspace: 'acme', payload: {} });
  const agentIn = async (workspace: string) =>
    (await store.registerAgent({ workspace, machineId: 'm1', name: 'rex', role: 'orchestrator', model: 'claude-opus-5', runtime: 'claude-code', channels: [] }, ev('x'))).id;

  it('Bearer + an agent claim: a member authors the row AS an agent of their workspace', async () => {
    const { workspaceId } = await store.createWorkspace({ name: 'Acme', slug: 'acme', createdBy: userId }, ev(userId));
    const rex = await agentIn(workspaceId);
    const res = await postMessage({ authorization: 'Bearer good', 'x-nm-actor': JSON.stringify({ kind: 'agent', id: rex, role: 'orchestrator' }) });
    expect(res.status).toBe(200);
    const { message } = (await res.json()) as { message: { author: { kind: string; id: string } } };
    expect(message.author).toEqual({ kind: 'agent', id: rex });
  });

  it('Bearer + a claim on an agent outside the member\'s workspaces is REFUSED, never re-attributed', async () => {
    const { workspaceId } = await store.createWorkspace({ name: 'Other', slug: 'other', createdBy: 'someone-else' }, ev('someone-else'));
    const theirs = await agentIn(workspaceId);
    const res = await postMessage({ authorization: 'Bearer good', 'x-nm-actor': JSON.stringify({ kind: 'agent', id: theirs, role: 'orchestrator' }) });
    expect(res.status).toBe(403);
    const ghost = await postMessage({ authorization: 'Bearer good', 'x-nm-actor': JSON.stringify({ kind: 'agent', id: 'ghost', role: 'worker' }) });
    expect(ghost.status).toBe(403);
    expect(store.messages.filter((m) => m.author.kind === 'human')).toHaveLength(0);
  });

  it('Bearer + a human claim: the verified bearer wins over the header', async () => {
    const res = await postMessage({ authorization: 'Bearer good', 'x-nm-actor': JSON.stringify({ kind: 'human', id: 'someone-else' }) });
    expect(res.status).toBe(200);
    const { message } = (await res.json()) as { message: { author: { kind: string; id: string } } };
    expect(message.author).toEqual({ kind: 'human', id: userId });
  });

  it('no credentials at all → 401', async () => {
    const res = await postMessage({});
    expect(res.status).toBe(401);
  });

  it('a malformed x-nm-actor header → 401, even on the open lane', async () => {
    process.env['NM_ALLOW_ACTOR_HEADER'] = '1';
    const res = await postMessage({ 'x-nm-actor': 'not json' });
    expect(res.status).toBe(401);
  });

  it("NM_ALLOW_ACTOR_HEADER='0' disables the header path but Bearer still works", async () => {
    process.env['NM_ALLOW_ACTOR_HEADER'] = '0';
    const withHeader = await postMessage({ 'x-nm-actor': JSON.stringify({ kind: 'agent', id: 'rex', role: 'orchestrator' }) });
    expect(withHeader.status).toBe(401);
    const withBearer = await postMessage({ authorization: 'Bearer good' });
    expect(withBearer.status).toBe(200);
  });
});
