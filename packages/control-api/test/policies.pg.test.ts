// Agent permission policies (Phase 1) against the REAL schema (migration 0068) — validates
// the humans-only gate, the jsonb selector + locked round-trip, upsert-by-id, and delete
// with exactly-once NOT_FOUND. Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}
const setBody = (over: Record<string, unknown> = {}) => ({
  type: 'policy.set',
  workspace: WS,
  scope: 'workspace',
  capability: 'shell.exec',
  selector: { kind: 'shellClass', value: 'destructive' },
  verdict: 'ask',
  rationale: 'destructive needs a human',
  ...over,
});

afterAll(async () => {
  await store?.close();
});

describe.skipIf(!DB)('policies on postgres (real schema, migration 0068)', () => {
  it('a human upserts a policy; it round-trips with jsonb selector + locked', async () => {
    const res = await send(george, setBody({ locked: true }));
    expect(res.status).toBe(200);
    const { policyId } = await j(res);
    const row = (await store!.listPolicies(WS)).find((p) => p.id === policyId)!;
    expect(row).toBeTruthy();
    expect(row.capability).toBe('shell.exec');
    expect(row.verdict).toBe('ask');
    expect(row.locked).toBe(true);
    expect(row.selector).toEqual({ kind: 'shellClass', value: 'destructive' });
    expect(row.createdBy).toEqual({ kind: 'human', id: george.id });
  });

  it('agents cannot configure policy (403); nothing persists', async () => {
    expect((await send(rex, setBody())).status).toBe(403);
    // Assert on AUTHORSHIP, not on a row count. policy-flow.pg.test.ts uses this same workspace id
    // and also writes policy.set, and vitest runs the two files in parallel — so a count taken
    // before the 403 and re-read after it moved whenever that file's write landed in between,
    // failing ~1 run in 20 while the code under test was correct. No agent-authored row can exist
    // is the claim the test is actually making, and it is true regardless of who else is writing.
    const mine = (await store!.listPolicies(WS)).filter((p) => p.createdBy?.kind === 'agent');
    expect(mine).toEqual([]);
  });

  it('update by id changes the row in place; unknown id is 404', async () => {
    const { policyId } = await j(await send(george, setBody({ verdict: 'ask' })));
    expect((await send(george, setBody({ id: policyId, verdict: 'deny' }))).status).toBe(200);
    expect((await store!.listPolicies(WS)).find((p) => p.id === policyId)!.verdict).toBe('deny');
    expect((await send(george, setBody({ id: '00000000-0000-0000-0000-0000000000ff' }))).status).toBe(404);
  });

  it('an egress host allowlist rule persists its selector glob', async () => {
    const { policyId } = await j(await send(george, setBody({ capability: 'net.egress', selector: { kind: 'host', glob: '*.stripe.com' }, verdict: 'allow', rationale: 'stripe' })));
    const row = (await store!.listPolicies(WS)).find((p) => p.id === policyId)!;
    expect(row.selector).toEqual({ kind: 'host', glob: '*.stripe.com' });
  });

  it('delete removes the row; deleting again is 404', async () => {
    const { policyId } = await j(await send(george, setBody()));
    expect((await send(george, { type: 'policy.delete', workspace: WS, policyId })).status).toBe(200);
    expect((await store!.listPolicies(WS)).some((p) => p.id === policyId)).toBe(false);
    expect((await send(george, { type: 'policy.delete', workspace: WS, policyId })).status).toBe(404);
  });
});
