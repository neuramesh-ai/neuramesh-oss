// The Sales pipeline on the real schema (0200, 0201): the store's SQL writes contacts and deals, a move says who moved
// the deal, an outreach email keeps its deal, every column the client schema names exists with its sync triggers,
// the sales agent and its room are seeded once with the Sales grant, and the replica gives the pipeline only to a
// person with Sales access. Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import { randomUUID } from 'node:crypto';
import { TABLE_COLUMNS } from '@neuramesh/client-core/schema';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { authorization, salesHidden } from '../src/local-sync-scope';
import { PostgresStore } from '../src/pgstore';
import { emailDraftsOf } from '../src/store/email-drafts';
import { salesOf } from '../src/store/sales';
import { ensureSalesAgentSql } from '../src/store/sales-agent';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const DEV = 'c0000000-0000-0000-0000-00000000000b';
const GEORGE = '00000000-0000-0000-0000-000000000001';
const store = DB ? new PostgresStore(DB) : null;
const george = { kind: 'human' as const, id: GEORGE };

afterAll(async () => { await store?.close(); });

describe.skipIf(!DB)('the Sales pipeline on postgres (0200, 0201)', () => {
  it('writes contacts and deals, moves a deal with who moved it, and keeps an outreach email\'s deal', async () => {
    const sales = salesOf(store!);
    const tag = randomUUID().slice(0, 8);
    const c = await sales.upsertContact(WS, { name: 'Sam Reyes', email: `sam-${tag}@deltafieldworks.com`, company: 'Delta Fieldworks' }, 'human', george);
    expect(c.created).toBe(true);
    expect((await sales.upsertContact(WS, { email: `sam-${tag}@deltafieldworks.com`, name: 'Sam R.' }, 'agent', { kind: 'agent', id: 'pike' })).contact).toBe(c.contact);
    const added = await sales.addContacts(WS, [{ name: '', email: `sam-${tag}@deltafieldworks.com`, company: '' }, { name: 'Nadia', email: `nadia-${tag}@coastalwater.co`, company: 'Coastalwater' }], george);
    expect([added.added.length, added.skipped]).toEqual([1, 1]);

    const d = await sales.upsertDeal(WS, { title: `Annual plan ${tag}`, contact: c.contact, value: 9600, nextStep: 'Call', nextDate: '2026-11-24' }, george);
    let row = (await sales.deals(WS)).find((x) => x.id === d.deal)!;
    expect(row).toMatchObject({ company: 'Delta Fieldworks', stage: 'lead', value_year: 9600, next_date: '2026-11-24', moved_by: null, closed_at: null });
    await sales.moveDeal(WS, d.deal, 'won', { kind: 'agent', id: 'pike' });
    row = (await sales.deals(WS)).find((x) => x.id === d.deal)!;
    expect(row).toMatchObject({ stage: 'won', moved_by_kind: 'agent', moved_by: 'pike' });
    expect(row.closed_at).not.toBeNull();
    await sales.upsertDeal(WS, { deal: d.deal, stage: 'proposal', nextDate: null }, george);
    row = (await sales.deals(WS)).find((x) => x.id === d.deal)!;
    expect(row).toMatchObject({ stage: 'proposal', closed_at: null, next_date: null, moved_by_kind: 'human' });

    const thread = randomUUID();
    await store!.createThread(WS, DEV, thread, 'Delta Fieldworks', '', GEORGE);
    const card = await emailDraftsOf(store!).draft({ workspaceId: WS, channelId: DEV, threadId: thread, by: { kind: 'agent', id: 'pike' },
      emails: [{ toName: 'Sam', toEmail: `sam-${tag}@deltafieldworks.com`, subject: 'Before your trial ends', body: 'Hi Sam', reason: '', deal: d.deal }] });
    await sales.linkSession(d.deal, thread);
    expect((await emailDraftsOf(store!).get(card.emails[0]!.id))!.dealId).toBe(d.deal);
    expect((await sales.deals(WS)).find((x) => x.id === d.deal)!.thread_id).toBe(thread);
    expect((await emailDraftsOf(store!).drop(card.emails[0]!.id)).status).toBe('dropped');
  });

  it('has every column the client schema names, and the sync triggers', async () => {
    for (const table of ['sales_contacts', 'sales_deals', 'email_drafts']) {
      const cols = await store!.sql<Array<{ column_name: string }>>`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table}`;
      const have = new Set(cols.map((x) => x.column_name));
      expect(Object.keys(TABLE_COLUMNS[table]!).filter((x) => !have.has(x))).toEqual([]);
      const triggers = await store!.sql`select tgname from pg_trigger where tgrelid = ${`public.${table}`}::regclass and tgname in ('sync_note', 'sync_change')`;
      expect(triggers.length).toBe(2);
    }
  });

  it('seeds the sales agent and its room once, with the Sales grant, and the replica serves the pipeline to Sales access only', async () => {
    const sql = postgres(DB!, { max: 1 }), rollback = new Error('rollback');
    try {
      await sql.begin(async (tx) => {
        const owner = randomUUID(), member = randomUUID(), workspace = randomUUID(), machine = randomUUID(), project = randomUUID();
        await tx`insert into nm_users(id,email) values(${owner},'owner@sales.test'),(${member},'member@sales.test')`;
        await tx`insert into workspaces(id,name,slug,created_by) values(${workspace},'Sales test',${'sales-' + workspace},${owner})`;
        await tx`insert into workspace_members(workspace_id,user_id,role) values(${workspace},${owner},'owner'),(${workspace},${member},'member')`;
        await tx`insert into projects(id,workspace_id,name,slug,is_default) values(${project},${workspace},'Acme','acme',true)`;
        await tx`insert into machines(id,workspace_id,owner_user_id,name) values(${machine},${workspace},${owner},'Desk')`;
        await tx`insert into agents(workspace_id,machine_id,name,role,model,runtime) values(${workspace},${machine},'rex','orchestrator','claude-sonnet-5-5','claude-code')`;
        await ensureSalesAgentSql(tx as unknown as postgres.Sql, workspace);
        await ensureSalesAgentSql(tx as unknown as postgres.Sql, workspace);
        const agents = await tx`select id, name, role from agents where workspace_id = ${workspace} and role = 'sales'`;
        expect(agents.map((a) => a['name'])).toEqual(['pike']);
        const grant = await tx`select 1 from workspace_destination_members where workspace_id = ${workspace} and destination = 'sales' and principal_id = ${agents[0]!['id'] as string}`;
        expect(grant.length).toBe(1);
        const rooms = await tx`select c.id, (select count(*)::int from agent_channels ac where ac.channel_id = c.id) as crew from channels c where c.workspace_id = ${workspace} and c.slug = 'sales'`;
        expect(rooms.map((r) => r['crew'])).toEqual([2]);

        expect((await authorization(tx, { kind: 'human', id: owner })).sales).toEqual([workspace]);
        const before = await authorization(tx, { kind: 'human', id: member });
        expect(before.sales).toEqual([]);
        expect((await authorization(tx, { kind: 'machine', id: machine, workspaceId: workspace, agentScopes: true })).sales).toEqual([]);
        expect(salesHidden('sales_deals', workspace, before.sales)).toBe(true);
        expect(salesHidden('email_drafts', workspace, before.sales)).toBe(false);
        await tx`insert into workspace_destination_members(workspace_id,destination,principal_kind,principal_id,added_by) values(${workspace},'sales','human',${member},${owner})`;
        await tx`insert into workspace_destination_revisions(workspace_id,destination,revision) values(${workspace},'sales',1) on conflict(workspace_id,destination) do update set revision=workspace_destination_revisions.revision+1`;
        const after = await authorization(tx, { kind: 'human', id: member });
        expect(after.sales).toEqual([workspace]);
        expect(after.scope).not.toBe(before.scope);
        throw rollback;
      });
    } catch (e) { if (e !== rollback) throw e; } finally { await sql.end(); }
  });
});
