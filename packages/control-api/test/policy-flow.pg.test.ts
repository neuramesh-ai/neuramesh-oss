// The permission ask->approve loop end-to-end against the REAL schema (migrations 0061 + 0068):
// a human configures a policy, an agent hits the gate and raises a permission card (exactly what
// the daemon posts on `ask`), the card becomes an open decision transactionally with the message,
// and the human's approval flips it exactly once (what the daemon's awaitDecision polls for).
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const patch: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'developer' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
function send(actor: Actor, path: string, body: unknown) {
  return app!.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}
const permCard = (question: string) =>
  '```nmq\n' + JSON.stringify({ question, kind: 'permission', risk: 'high', options: [{ label: 'Approve' }, { label: 'Deny' }], allowOther: false }) + '\n```';

afterAll(async () => {
  await store?.close();
});

describe.skipIf(!DB)('permission enforcement flow end-to-end (real schema)', () => {
  it('set ask policy -> agent raises permission card -> human approves -> resolved exactly once', async () => {
    // 1) the human configures: destructive shell = ask
    expect((await send(george, '/v1/commands', { type: 'policy.set', workspace: WS, scope: 'workspace', capability: 'shell.exec', selector: { kind: 'shellClass', value: 'destructive' }, verdict: 'ask', rationale: 'confirm destructive commands' })).status).toBe(200);
    expect((await store!.listPolicies(WS)).find((p) => p.capability === 'shell.exec')?.verdict).toBe('ask');

    // 2) the agent hits the gate -> posts a permission card (what the daemon does on `ask`)
    const q = 'patch wants to run a shell command: `rm -rf node_modules`. Approve?';
    const r = await send(patch, '/v1/messages', { workspace: WS, channel: 'dev', body: `Requesting approval.\n\n${permCard(q)}` });
    expect(r.status).toBe(200);
    const { message } = await j(r);
    // -> a decision row is born from the card, transactional with the message (a card without a row is impossible)
    const d = (await store!.listDecisions(WS)).find((x) => x.question === q)!;
    expect(d).toBeTruthy();
    expect(d.status).toBe('open');
    expect(d.messageId).toBe(message.id);
    expect(d.asker).toEqual({ kind: 'agent', id: patch.id });

    // 3) an agent may NOT approve its own request — the human is the gate
    expect((await send(patch, '/v1/commands', { type: 'decision.answer', decisionId: d.id, answer: 'Approve' })).status).toBe(403);

    // 4) the human approves -> the row flips (what awaitDecision polls for)
    expect((await send(george, '/v1/commands', { type: 'decision.answer', decisionId: d.id, answer: 'Approve' })).status).toBe(200);
    const after = (await store!.listDecisions(WS)).find((x) => x.id === d.id)!;
    expect(after.status).toBe('answered');
    expect(after.answer).toBe('Approve');

    // 5) a second answer stands down (exactly-once — the daemon can't be double-resolved)
    expect((await send(george, '/v1/commands', { type: 'decision.answer', decisionId: d.id, answer: 'Deny' })).status).toBe(409);
  });

  it('a locked deny policy persists as an un-loosenable invariant', async () => {
    expect((await send(george, '/v1/commands', { type: 'policy.set', workspace: WS, scope: 'workspace', capability: 'shell.exec', selector: { kind: 'shellClass', value: 'pipe-to-shell' }, verdict: 'deny', rationale: 'never pipe to shell', locked: true })).status).toBe(200);
    const pol = (await store!.listPolicies(WS)).find((p) => JSON.stringify(p.selector).includes('pipe-to-shell'))!;
    expect(pol.verdict).toBe('deny');
    expect(pol.locked).toBe(true);
  });
});
