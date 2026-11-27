// The Sales tools (host/tools-sales.ts, plan S1 to S3): list_deals reads GET /v1/sales as the agent and marks a late
// next step; upsert_deal finds or adds the contact by address first; move_deal sends one command; a refusal from the
// server (no Sales grant) reaches the agent as words, never as a claim that something changed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import type { SalesContactRow, SalesDealRow } from '@neuramesh/shared';
import { salesTools } from './tools-sales';

const contact: SalesContactRow = { id: 'c1', workspace_id: 'w', name: 'Sam Reyes', email: 'sam@deltafieldworks.com', company: 'Delta Fieldworks', source: 'gmail', created_by_kind: 'human', created_by: 'george', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' };
const deal = (over: Partial<SalesDealRow>): SalesDealRow => ({
  id: 'd1', workspace_id: 'w', contact_id: 'c1', title: 'Annual plan, 8 seats', company: 'Delta Fieldworks', stage: 'trial', value_year: 9600, currency: 'USD', next_step: 'Call', next_date: '2026-11-24',
  thread_id: null, moved_by_kind: null, moved_by: null, moved_at: null, closed_at: null, created_by_kind: 'human', created_by: 'george', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...over,
});

function harness(read: () => Response, answer: (cmd: Record<string, unknown>) => Response = () => Response.json({ ok: true })) {
  const sent: Array<Record<string, unknown>> = [];
  const paths: string[] = [];
  const tools = salesTools({
    z, ch: { id: 'chan', workspace_id: 'w' }, actor: { kind: 'agent', id: 'pike', role: 'sales' },
    apiGet: async (path) => { paths.push(path); return read(); },
    post: (async (_path: string, _actor: unknown, cmd: unknown) => { sent.push(cmd as Record<string, unknown>); return answer(cmd as Record<string, unknown>); }) as never,
  });
  const run = (name: string, input: unknown) => tools.find((t) => t.name === name)!.run(input);
  return { sent, paths, run };
}

test('list_deals reads the pipeline as the agent, marks a late step and lists contacts with no deal', async () => {
  const loose = { ...contact, id: 'c2', name: 'Nadia Brooks', email: 'nadia@coastalwater.co', company: 'Coastalwater' };
  const h = harness(() => Response.json({ contacts: [contact, loose], deals: [deal({ next_date: '2020-01-02' }), deal({ id: 'd2', title: 'Pilot', next_step: '', stage: 'lead', contact_id: null })] }));
  const out = await h.run('list_deals', {});
  assert.deepEqual(h.paths, ['/v1/sales?workspace=w']);
  assert.match(out, /d1 · Annual plan, 8 seats · Delta Fieldworks · Trial · \$9,600 a year · next: Call · Thu, Jan 2 · Sam Reyes <sam@deltafieldworks.com> · LATE/);
  assert.match(out, /d2 · Pilot · .* next: no next step/);
  assert.match(out, /Contacts with no deal \(1\):\n- c2 · Nadia Brooks <nadia@coastalwater.co>/);
  assert.match(await h.run('list_deals', { stage: 'lead' }), /Deals \(1\)/);
});

test('list_deals says so plainly when the server refuses the agent', async () => {
  const h = harness(() => Response.json({ error: 'this agent has no Sales access' }, { status: 403 }));
  assert.match(await h.run('list_deals', {}), /Sales did not answer: this agent has no Sales access/);
});

test('upsert_deal adds the contact by address first, then the deal with that contact', async () => {
  const h = harness(() => Response.json({}), (cmd) => Response.json(cmd['type'] === 'sales.upsert_contact' ? { contact: 'c9', created: true } : { deal: 'd9', created: true }));
  const out = await h.run('upsert_deal', { title: 'Field team, 5 seats', contactEmail: 'Mia@OrchardLabs.io', contactName: 'Mia Chen', value: 3600 });
  assert.deepEqual(h.sent.map((c) => c['type']), ['sales.upsert_contact', 'sales.upsert_deal']);
  assert.equal(h.sent[0]!['email'], 'mia@orchardlabs.io');
  assert.equal(h.sent[0]!['workspace'], 'w');
  assert.equal(h.sent[1]!['contact'], 'c9');
  assert.equal(h.sent[1]!['value'], 3600);
  assert.match(out, /Added the deal d9/);
});

test('move_deal sends one command, and a refusal is never a claim', async () => {
  const ok = harness(() => Response.json({}));
  assert.match(await ok.run('move_deal', { deal: 'd1', stage: 'proposal' }), /Moved the deal to Proposal/);
  assert.deepEqual(ok.sent, [{ workspace: 'w', type: 'sales.move_deal', deal: 'd1', stage: 'proposal' }]);
  const no = harness(() => Response.json({}), () => Response.json({ error: 'this agent has no Sales access' }, { status: 403 }));
  assert.match(await no.run('move_deal', { deal: 'd1', stage: 'won' }), /did not move: this agent has no Sales access/);
});

// SALES SETUP (docs/design/sales-onboarding-2026-11 SO3): the three setup tools post their card into the session with
// setupCard, propose_leads has the API check the leads first, and list_deals opens with the company and the skips
test('propose_leads checks the leads on the API, then posts the review card into the session', async () => {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const tools = salesTools({
    z, ch: { id: 'chan', workspace_id: 'w' }, actor: { kind: 'agent', id: 'pike', role: 'sales' }, convoThreadId: 't1',
    apiGet: async () => Response.json({}),
    post: (async (path: string, _a: unknown, body: Record<string, unknown>) => {
      posts.push({ path, body });
      return path === '/v1/sales/leads/check' ? Response.json({ leads: (body['leads'] as object[]).map((l) => ({ ...l, check: 'ok', dup: null })) }) : Response.json({ ok: true });
    }) as never,
  });
  const out = await tools.find((t) => t.name === 'propose_leads')!.run({ note: 'I found 1 lead.', leads: [{ name: 'Dana', email: ' Dana@Kestrel.example ', title: '', company: 'Kestrel', fit: 'Hires dispatchers', source: 'web', sourceUrl: 'https://kestrel.example/jobs' }] });
  assert.deepEqual(posts.map((p) => p.path), ['/v1/sales/leads/check', '/v1/messages']);
  assert.equal((posts[0]!.body['leads'] as Array<{ email: string }>)[0]!.email, 'dana@kestrel.example');
  assert.equal(posts[1]!.body['setupCard'], true);
  assert.equal(posts[1]!.body['threadId'], 't1');
  assert.match(String(posts[1]!.body['body']), /^I found 1 lead\.\n\n```nmsetup\n\{"kind":"leads"/);
  assert.match(out, /The card is in the session/);
});

test('a setup card outside a session is refused in words, and list_deals opens with the company, the skips and the rules', async () => {
  const h = harness(() => Response.json({ contacts: [], deals: [], setup: {
    run: { skipped: ['gmail'], completed_at: null, ended_at: null }, state: { now: 'find', reachable: 1, bar: 3 },
    profile: { website: 'acme.example', offer: { sells: 'A field app.', buyers: 'Ops leads.', why: '' }, customer: { industries: ['Freight'], sizes: [], roles: ['Head of operations'], places: [], signs: [], like: [] } },
  } }));
  assert.match(await h.run('propose_company', { website: 'acme.example', sells: 'x', buyers: '', why: '', note: '' }), /belongs in the Set up Sales session/);
  assert.equal(h.sent.length, 0);
  const out = await h.run('list_deals', {});
  assert.match(out, /The company sells: A field app\. Buyers: Ops leads\. \(acme\.example\)/);
  assert.match(out, /The customer: Head of operations at Freight/);
  assert.match(out, /step now is find, 1 of 3 leads .* The person skipped: gmail\. Do not ask for those again\./);
  assert.match(out, /If this is not for you, say so and I will not write again\./);
});
