// Sales setup on the real schema (0210, docs/design/sales-onboarding-2026-11/plan.md SO1 to SO17): one run for each
// workspace with pike's first line and the first step card, a step card posted once for each move, answers merged on
// the company profile, skips, the bar of 3 reachable leads, the dedupe of sales.add_leads, the finish, the end, and
// the HUMAN_ONLY refusals. Run via scripts/test-pg.sh: skipped without DATABASE_URL.
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseSetupMarker, type CheckedLead } from '@neuramesh/shared';
import { useResolver } from '../src/address-check';
import { executeCommand } from '../src/handler';
import { PostgresStore } from '../src/pgstore';
import { salesSetupView } from '../src/sales-setup-run';
import { ensureSalesAgentSql } from '../src/store/sales-agent';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;

// every domain takes mail but one that has no mail server
beforeAll(() => useResolver({
  mx: async (d) => { if (d === 'nomail.example') throw Object.assign(new Error('none'), { code: 'ENOTFOUND' }); return [{ exchange: `mx.${d}`, priority: 10 }]; },
  a: async (d) => { if (d === 'nomail.example') throw Object.assign(new Error('none'), { code: 'ENOTFOUND' }); return ['192.0.2.1']; },
}));
afterAll(async () => { useResolver(null); await store?.close(); });

async function seed() {
  const sql = store!.sql as postgres.Sql;
  const ws = randomUUID(), owner = randomUUID(), member = randomUUID(), project = randomUUID(), machine = randomUUID();
  await sql`insert into nm_users (id, email) values (${owner}, ${`owner-${ws}@setup.test`}), (${member}, ${`member-${ws}@setup.test`})`;
  await sql`insert into workspaces (id, name, slug, created_by, plan) values (${ws}, 'Acme', ${`acme-${ws}`}, ${owner}, 'cloud')`;
  await sql`insert into workspace_members (workspace_id, user_id, role) values (${ws}, ${owner}, 'owner'), (${ws}, ${member}, 'member')`;
  await sql`insert into projects (id, workspace_id, name, slug, is_default) values (${project}, ${ws}, 'Acme', 'acme', true)`;
  await sql`insert into machines (id, workspace_id, owner_user_id, name) values (${machine}, ${ws}, ${owner}, 'Cloud')`;
  await sql`insert into agents (workspace_id, machine_id, name, role, model, runtime) values (${ws}, ${machine}, 'rex', 'orchestrator', 'claude-sonnet-5', 'claude-code')`;
  await sql.begin(async (tx) => ensureSalesAgentSql(tx as unknown as postgres.Sql, ws));
  return { ws, owner: { kind: 'human' as const, id: owner }, member: { kind: 'human' as const, id: member }, sql };
}
const messages = async (sql: postgres.Sql, thread: string) => (await sql`select author_kind, body from messages where thread_id = ${thread}::uuid order by created_at, id`).map((r) => ({ kind: String(r['author_kind']), body: String(r['body']) }));
const markers = async (sql: postgres.Sql, thread: string) => (await messages(sql, thread)).map((m) => parseSetupMarker(m.body)?.step).filter(Boolean);
const lead = (company: string, email?: string, source: CheckedLead['source'] = 'list') => ({ name: company.split(' ')[0]!, email, title: '', company, fit: '', source });

describe.skipIf(!DB)('Sales setup on postgres (0210)', () => {
  it('starts one run with pike\'s first line and the first card, and posts each next card once', async () => {
    const { ws, owner, sql } = await seed();
    const a = await executeCommand(store!, owner, { type: 'setup.start', workspace: ws, flow: 'sales.v1' }) as unknown as { run: string; thread: string; created: boolean };
    expect(a.created).toBe(true);
    const b = await executeCommand(store!, owner, { type: 'setup.start', workspace: ws, flow: 'sales.v1' }) as unknown as { run: string; created: boolean };
    expect([b.run, b.created]).toEqual([a.run, false]);
    const [t] = await sql`select title, mode, channel_id from threads where id = ${a.thread}::uuid`;
    expect([t!['title'], t!['mode']]).toEqual(['Set up Sales', 'chat']);
    const first = await messages(sql, a.thread);
    expect(first).toHaveLength(1);
    expect(first[0]!.kind).toBe('agent');
    expect(first[0]!.body).toContain('six steps');
    expect(await markers(sql, a.thread)).toEqual(['company']);

    await executeCommand(store!, owner, { type: 'setup.answer', workspace: ws, flow: 'sales.v1', step: 'company', website: 'acme.example', offer: { sells: 'A field app', buyers: 'Ops leads', why: 'Offline jobs' } });
    // the same answer again moves nothing, so no second card
    await executeCommand(store!, owner, { type: 'setup.answer', workspace: ws, flow: 'sales.v1', step: 'company', offer: { sells: 'A field app for crews', buyers: '', why: '' } });
    expect(await markers(sql, a.thread)).toEqual(['company', 'customer']);
    const [w] = await sql`select profile from workspaces where id = ${ws}::uuid`;
    expect(w!['profile']).toMatchObject({ website: 'acme.example', offer: { sells: 'A field app for crews' } });

    await executeCommand(store!, owner, { type: 'setup.answer', workspace: ws, flow: 'sales.v1', step: 'customer', customer: { industries: ['Freight'], sizes: [], roles: ['Head of operations'], places: [], signs: [], like: [] } });
    // no mail link: Gmail asks, and a skip moves on to Find leads
    expect(await markers(sql, a.thread)).toEqual(['company', 'customer', 'gmail']);
    await executeCommand(store!, owner, { type: 'setup.skip', workspace: ws, flow: 'sales.v1', step: 'gmail' });
    expect(await markers(sql, a.thread)).toEqual(['company', 'customer', 'gmail', 'find']);
    const view = await salesSetupView(store!, ws);
    expect(view.state!.steps.map((s) => s.status)).toEqual(['done', 'done', 'skipped', 'now', 'next', 'next']);
  });

  it('adds leads with the dedupe and the address check, goes back to Find leads under the bar, and finishes at 3', async () => {
    const { ws, owner, sql } = await seed();
    const { thread } = await executeCommand(store!, owner, { type: 'setup.start', workspace: ws, flow: 'sales.v1' }) as unknown as { thread: string };
    for (const step of ['company', 'customer', 'gmail']) await executeCommand(store!, owner, { type: 'setup.skip', workspace: ws, flow: 'sales.v1', step });
    const one = await executeCommand(store!, owner, { type: 'sales.add_leads', workspace: ws, leads: [
      lead('Kestrel Freight', 'dana@kestrel.example'), lead('Kestrel Freight LLC', 'ana@other.example'), lead('Bad Mail', 'x@nomail.example'), lead('Northgate Rail'),
    ] }) as unknown as { results: Array<{ company: string; outcome: string }>; added: number };
    expect(one.results.map((r) => r.outcome)).toEqual(['added', 'already', 'bad', 'added']);
    // a company with no person yet is a lead, but no note reaches it: 1 of 3
    expect((await salesSetupView(store!, ws)).state).toMatchObject({ reachable: 1, now: 'note' });
    await executeCommand(store!, owner, { type: 'setup.skip', workspace: ws, flow: 'sales.v1', step: 'note' });
    // every step done or skipped, and the bar fails: back to Find leads, with the count in words
    const back = (await messages(sql, thread)).at(-1)!;
    expect(parseSetupMarker(back.body)?.step).toBe('find');
    expect(back.body).toContain('You have 1 lead that a note can reach');
    const [deal] = await sql`select fit, source, setup_run, next_step from sales_deals where workspace_id = ${ws}::uuid and company = 'Kestrel Freight'`;
    expect(deal).toMatchObject({ source: 'list', next_step: 'First note' });
    expect(deal!['setup_run']).not.toBeNull();
    const [c] = await sql`select address_check, source from sales_contacts where workspace_id = ${ws}::uuid and email = 'dana@kestrel.example'`;
    expect(c).toMatchObject({ address_check: 'ok', source: 'list' });

    await executeCommand(store!, owner, { type: 'sales.add_leads', workspace: ws, leads: [lead('Orchard Labs', 'mia@orchard.example', 'web'), lead('Halden Water', 'info@halden.example')] });
    const view = await salesSetupView(store!, ws);
    expect(view.run!.completed_at).not.toBeNull();
    expect(view.state).toMatchObject({ complete: true, reachable: 3, now: null });
    const last = (await messages(sql, thread)).at(-1)!;
    expect(parseSetupMarker(last.body)?.step).toBe('done');
    // the run is over: a later add posts nothing more
    const count = (await messages(sql, thread)).length;
    await executeCommand(store!, owner, { type: 'sales.add_leads', workspace: ws, leads: [lead('Pinecrest', 'raj@pinecrest.example')] });
    expect((await messages(sql, thread)).length).toBe(count);
    await executeCommand(store!, owner, { type: 'setup.hide', workspace: ws, flow: 'sales.v1' });
    expect((await salesSetupView(store!, ws)).run!.hidden_at).not.toBeNull();
  });

  it('ends a run once, and refuses an agent and a machine', async () => {
    const { ws, owner, sql } = await seed();
    const { thread } = await executeCommand(store!, owner, { type: 'setup.start', workspace: ws, flow: 'sales.v1' }) as unknown as { thread: string };
    const [pike] = await sql`select id from agents where workspace_id = ${ws}::uuid and role = 'sales'`;
    const agent = { kind: 'agent' as const, id: String(pike!['id']), role: 'sales' as const };
    await expect(executeCommand(store!, agent, { type: 'sales.add_leads', workspace: ws, leads: [lead('X Co', 'x@x.example')] })).rejects.toMatchObject({ code: 'HUMAN_ONLY' });
    await expect(executeCommand(store!, agent, { type: 'setup.skip', workspace: ws, flow: 'sales.v1', step: 'company' })).rejects.toMatchObject({ code: 'HUMAN_ONLY' });
    await expect(executeCommand(store!, owner, { type: 'sales.add_leads', workspace: ws, leads: [lead('X Co', 'x@x.example')] }, { id: randomUUID(), workspaceId: ws })).rejects.toMatchObject({ code: 'HUMAN_ONLY' });
    await executeCommand(store!, owner, { type: 'setup.end', workspace: ws, flow: 'sales.v1' });
    await executeCommand(store!, owner, { type: 'setup.end', workspace: ws, flow: 'sales.v1' });
    expect((await markers(sql, thread)).filter((m) => m === 'ended')).toHaveLength(1);
    expect((await salesSetupView(store!, ws)).state).toMatchObject({ ended: true, now: null });
  });

  it('starts no run where 3 reachable leads exist already, and card 1 keeps the Sales answers', async () => {
    const { ws, owner, sql } = await seed();
    await executeCommand(store!, owner, { type: 'setup.start', workspace: ws, flow: 'sales.v1' });
    await executeCommand(store!, owner, { type: 'setup.answer', workspace: ws, flow: 'sales.v1', step: 'company', offer: { sells: 'Boats', buyers: '', why: '' } });
    await executeCommand(store!, owner, { type: 'workspace.set_profile', workspace: ws, profile: { sells: 'store', help: ['customers'] } });
    const [w] = await sql`select profile from workspaces where id = ${ws}::uuid`;
    expect(w!['profile']).toMatchObject({ sells: 'store', offer: { sells: 'Boats' } });

    const other = await seed();
    await executeCommand(store!, other.owner, { type: 'sales.add_leads', workspace: other.ws, leads: [lead('A Co', 'a@a.example'), lead('B Co', 'b@b.example'), lead('C Co', 'c@c.example')] });
    const out = await executeCommand(store!, other.owner, { type: 'setup.start', workspace: other.ws, flow: 'sales.v1' }) as unknown as { run: string | null };
    expect(out.run).toBeNull();
  });
});
