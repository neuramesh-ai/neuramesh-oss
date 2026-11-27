// THE SALES PIPELINE (docs/design/inbox-sales-2026-11/plan.md S1 to S3, round 5). What must hold: a person with Sales
// access and an agent with the Sales grant write contacts and deals, and nobody else does; a move says who moved
// the deal; Bring in contacts adds contacts only, and only a person sends it; an outreach email names its deal, and
// the deal's session becomes the card's; only a person drops an email; and a Local server serves no Sales.
import { randomUUID } from 'node:crypto';
import type { Actor, DestinationPerson } from '@neuramesh/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';
import { emailDraftsOf, type MemEmailDraftStore } from '../src/store/email-drafts';
import { salesOf, type MemSalesStore } from '../src/store/sales';

const workspace = randomUUID();
const george: Actor = { kind: 'human', id: 'george' };
const lena: Actor = { kind: 'human', id: 'lena' };
const pike: Actor = { kind: 'agent', id: 'pike', role: 'sales' };
const sol: Actor = { kind: 'agent', id: 'sol', role: 'worker' };

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const hdr = (actor: Actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
const send = (actor: Actor, body: Record<string, unknown>) => app.request('/v1/commands', { method: 'POST', headers: hdr(actor), body: JSON.stringify({ workspace, ...body }) });
const mem = () => salesOf(store) as MemSalesStore;
const person = (id: string, kind: 'human' | 'agent', owner = false): Omit<DestinationPerson, 'hasAccess'> => ({ id, kind, name: id, role: owner ? 'owner' : kind === 'agent' ? 'sales' : 'member', description: null, owner });
const original = process.env['NM_LOCAL'];

beforeEach(async () => {
  store = new MemoryStore();
  app = createApp(store);
  const add = store as unknown as { addMember(w: string, u: string): void };
  add.addMember(workspace, 'george'); add.addMember(workspace, 'lena');
  store.destinations.directory = async (w) => (w === workspace ? [person('george', 'human', true), person('lena', 'human'), person('pike', 'agent'), person('sol', 'agent')] : []);
  await store.destinations.set(workspace, 'sales', 'agent', 'pike', true);
});
afterEach(() => { if (original === undefined) delete process.env['NM_LOCAL']; else process.env['NM_LOCAL'] = original; });

describe('the pipeline commands', () => {
  it('a person and the sales agent write contacts and deals, and the address finds the contact', async () => {
    const c = await j(await send(george, { type: 'sales.upsert_contact', name: 'Sam Reyes', email: 'Sam@DeltaFieldworks.com', company: 'Delta Fieldworks' }));
    expect(c).toMatchObject({ ok: true, created: true });
    const again = await j(await send(pike, { type: 'sales.upsert_contact', email: 'sam@deltafieldworks.com', name: 'Sam R.' }));
    expect(again).toMatchObject({ contact: c.contact, created: false });
    expect(mem().contactRows.map((r) => [r.email, r.name, r.company, r.source])).toEqual([['sam@deltafieldworks.com', 'Sam R.', 'Delta Fieldworks', 'human']]);
    const d = await j(await send(pike, { type: 'sales.upsert_deal', title: 'Annual plan, 8 seats', contact: c.contact, value: 9600, nextStep: 'Call', nextDate: '2026-11-24' }));
    expect(d).toMatchObject({ ok: true, created: true });
    expect(mem().dealRows[0]).toMatchObject({ title: 'Annual plan, 8 seats', company: 'Delta Fieldworks', stage: 'lead', value_year: 9600, next_date: '2026-11-24', created_by_kind: 'agent', moved_by: null });
  });

  it('a move says who moved the deal, and Won and Lost close it', async () => {
    const d = await j(await send(george, { type: 'sales.upsert_deal', title: 'Pilot, 5 seats', stage: 'trial' }));
    expect((await send(pike, { type: 'sales.move_deal', deal: d.deal, stage: 'proposal' })).status).toBe(200);
    expect(mem().dealRows[0]).toMatchObject({ stage: 'proposal', moved_by_kind: 'agent', moved_by: 'pike', closed_at: null });
    await send(george, { type: 'sales.move_deal', deal: d.deal, stage: 'won' });
    expect(mem().dealRows[0]).toMatchObject({ stage: 'won', moved_by_kind: 'human', moved_by: 'george' });
    expect(mem().dealRows[0]!.closed_at).not.toBeNull();
    await send(george, { type: 'sales.upsert_deal', deal: d.deal, stage: 'trial', nextStep: 'Ask again in May' });
    expect(mem().dealRows[0]).toMatchObject({ stage: 'trial', closed_at: null, next_step: 'Ask again in May' });
  });

  it('refuses an agent without the Sales grant and a member the owner did not add, until the owner adds them', async () => {
    const byAgent = await send(sol, { type: 'sales.upsert_deal', title: 'Field team' });
    expect(byAgent.status).toBe(403);
    expect((await j(byAgent)).error).toMatch(/no Sales access/);
    expect((await send(lena, { type: 'sales.upsert_deal', title: 'Field team' })).status).toBe(403);
    await store.destinations.set(workspace, 'sales', 'human', 'lena', true);
    expect((await send(lena, { type: 'sales.upsert_deal', title: 'Field team' })).status).toBe(200);
    expect(mem().dealRows).toHaveLength(1);
  });

  it('Bring in contacts adds contacts only, skips an address in Sales, and only a person sends it', async () => {
    await send(george, { type: 'sales.upsert_contact', email: 'victor@ironbarkmining.com' });
    const people = [{ name: 'Victor Hale', email: 'victor@ironbarkmining.com', company: 'Ironbarkmining' }, { name: 'Nadia Brooks', email: 'nadia@coastalwater.co', company: 'Coastalwater' }];
    expect((await send(pike, { type: 'sales.add_contacts', contacts: people })).status).toBe(403);
    const out = await j(await send(george, { type: 'sales.add_contacts', contacts: people }));
    expect(out).toMatchObject({ ok: true, skipped: 1 });
    expect(out.added).toHaveLength(1);
    expect(mem().contactRows.map((r) => [r.email, r.source]).sort()).toEqual([['nadia@coastalwater.co', 'gmail'], ['victor@ironbarkmining.com', 'human']]);
    expect(mem().dealRows).toHaveLength(0);
  });

  it('a Local server serves no Sales', async () => {
    process.env['NM_LOCAL'] = '1';
    const r = await send(george, { type: 'sales.upsert_deal', title: 'Pilot' });
    expect(r.status).toBe(403);
    expect((await j(r)).error).toMatch(/hosted plans/);
  });
});

describe('outreach is an email card', () => {
  async function session(): Promise<{ channel: string; thread: string }> {
    const proj = await j(await send(george, { type: 'project.create', name: 'Sales' }));
    const chan = await j(await send(george, { type: 'channel.create', project: proj.projectId, slug: 'sales' }));
    const thread = crypto.randomUUID();
    await store.createThread(workspace, chan.channelId, thread, 'Delta Fieldworks', '', 'george');
    return { channel: chan.channelId as string, thread };
  }
  const rows = () => (emailDraftsOf(store) as MemEmailDraftStore).rows;
  const email = (deal?: string) => ({ toName: 'Sam Reyes', toEmail: 'sam@deltafieldworks.com', subject: 'Before your trial ends', body: 'Hi Sam,\n\nCan we talk on Tuesday?\n\nGeorge', ...(deal ? { deal } : {}) });

  it('names its deal, and the deal\'s session becomes the card\'s session', async () => {
    const s = await session();
    const d = await j(await send(george, { type: 'sales.upsert_deal', title: 'Annual plan, 8 seats' }));
    const r = await send(pike, { type: 'email.draft', ...s, emails: [email(d.deal)] });
    expect(r.status).toBe(200);
    expect(rows()[0]).toMatchObject({ dealId: d.deal, status: 'draft' });
    expect(mem().dealRows[0]!.thread_id).toBe(s.thread);
  });

  it('refuses outreach from an agent without the Sales grant, and a plain card needs no grant', async () => {
    const s = await session();
    const d = await j(await send(george, { type: 'sales.upsert_deal', title: 'Annual plan, 8 seats' }));
    expect((await send(sol, { type: 'email.draft', ...s, emails: [email(d.deal)] })).status).toBe(403);
    expect((await send(sol, { type: 'email.draft', ...s, emails: [email()] })).status).toBe(200);
  });

  it('only a person drops an email (Do not send), and a dropped email no longer waits', async () => {
    const s = await session();
    await send(pike, { type: 'email.draft', ...s, emails: [email()] });
    const id = rows()[0]!.id;
    expect((await send(pike, { type: 'email.drop', email: id })).status).toBe(403);
    const r = await j(await send(george, { type: 'email.drop', email: id }));
    expect(r).toMatchObject({ ok: true, status: 'dropped' });
    expect((await send(pike, { type: 'email.revise', email: id, version: 1, body: 'Hi again' })).status).toBe(409);
    expect((await send(george, { type: 'email.drop', email: id })).status).toBe(409);
  });
});

describe('GET /v1/sales', () => {
  const read = (actor: Actor) => app.request(`/v1/sales?workspace=${workspace}`, { headers: hdr(actor) });
  it('answers the sales agent and a person with access, and refuses an agent without the grant', async () => {
    await send(george, { type: 'sales.upsert_deal', title: 'Pilot, 5 seats' });
    const r = await read(pike);
    expect(r.status).toBe(200);
    expect((await j(r)).deals.map((d: { title: string }) => d.title)).toEqual(['Pilot, 5 seats']);
    expect((await read(george)).status).toBe(200);
    expect((await read(sol)).status).toBe(403);
    expect((await read(lena)).status).toBe(403);
  });
});
