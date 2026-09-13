// Agent permission policies (Phase 1): humans upsert/delete allow/ask/deny rules that the
// daemon gates tool calls against. The server enforces humans-only + schema validity +
// upsert-by-id semantics; the pure engine (shared/policy.ts) is tested separately.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const patch: Actor = { kind: 'agent', id: 'patch', role: 'developer' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };

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

const setBody = (over: Record<string, unknown> = {}) => ({
  type: 'policy.set',
  workspace: 'ws_acme',
  scope: 'workspace',
  capability: 'shell.exec',
  selector: { kind: 'shellClass', value: 'destructive' },
  verdict: 'ask',
  rationale: 'destructive commands need a human OK',
  ...over,
});

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('policy.set / policy.delete', () => {
  it('a human sets a workspace policy and it persists', async () => {
    const res = await send(george, setBody());
    expect(res.status).toBe(200);
    const { policyId } = await j(res);
    const rows = await store.listPolicies('ws_acme');
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ id: policyId, scope: 'workspace', capability: 'shell.exec', verdict: 'ask' });
  });

  it('agents cannot configure policy — humans only (enforced, not prompted)', async () => {
    expect((await send(patch, setBody())).status).toBe(403);
    expect((await send(rex, setBody())).status).toBe(403);
    expect((await store.listPolicies('ws_acme')).length).toBe(0);
  });

  it('setting with an id updates the existing rule in place', async () => {
    const { policyId } = await j(await send(george, setBody()));
    expect((await send(george, setBody({ id: policyId, verdict: 'deny' }))).status).toBe(200);
    const rows = await store.listPolicies('ws_acme');
    expect(rows.length).toBe(1);
    expect(rows[0]!.verdict).toBe('deny');
  });

  it('updating an unknown id is NOT_FOUND', async () => {
    expect((await send(george, setBody({ id: '00000000-0000-0000-0000-000000000000' }))).status).toBe(404);
  });

  it('delete removes the rule; deleting again is NOT_FOUND', async () => {
    const { policyId } = await j(await send(george, setBody()));
    expect((await send(george, { type: 'policy.delete', workspace: 'ws_acme', policyId })).status).toBe(200);
    expect((await store.listPolicies('ws_acme')).length).toBe(0);
    expect((await send(george, { type: 'policy.delete', workspace: 'ws_acme', policyId })).status).toBe(404);
  });

  it('rejects an invalid verdict at the schema boundary', async () => {
    expect((await send(george, setBody({ verdict: 'maybe' }))).status).toBe(400);
  });

  it('accepts a net.egress host allowlist rule', async () => {
    const res = await send(george, setBody({ capability: 'net.egress', selector: { kind: 'host', glob: 'api.stripe.com' }, verdict: 'allow', rationale: 'stripe webhooks' }));
    expect(res.status).toBe(200);
    expect((await store.listPolicies('ws_acme'))[0]).toMatchObject({ capability: 'net.egress', verdict: 'allow' });
  });

  it('accepts a project-scoped override', async () => {
    const res = await send(george, setBody({ scope: 'project', projectId: 'proj_web', verdict: 'deny' }));
    expect(res.status).toBe(200);
    expect((await store.listPolicies('ws_acme'))[0]).toMatchObject({ scope: 'project', projectId: 'proj_web' });
  });
});
