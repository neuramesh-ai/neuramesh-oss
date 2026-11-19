// Default destination grants and the Finance agent (George, 2026-11-17; finance-agent.pg.test.ts holds
// the Finance chat check, which stays private): the orchestrator works in
// Marketing and Finance from its birth, the workspace's Finance agent (ledger) arrives with it and
// works in Finance, an owner's removal holds across re-registers, and an agent's Marketing snapshot
// streams compressed, so a room full of drafted pictures never passes Cloud Run's response limit.
// Run via scripts/test-pg.sh, skipped without DATABASE_URL.
import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const owner: Actor = { kind: 'human', id: randomUUID() };
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB, { max: 1 }) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const send = (actor: Actor, body: unknown) => app!.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
const access = (destination: string) => app!.request('/v1/destinations/access', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(owner) }, body: JSON.stringify({ workspace: WS, destination }) });
const grants = async (id: string) => (await sql!`select destination from workspace_destination_members where workspace_id=${WS}::uuid and principal_kind='agent' and principal_id=${id}::uuid order by destination`).map(r => r['destination'] as string);

let WS = '', MACHINE = '', REX = '';
beforeAll(async () => {
  if (!DB) return;
  await sql!`insert into nm_users(id,email) values(${owner.id}::uuid,${`${owner.id}@defaults.test`})`;
  WS = (await j(await send(owner, { type: 'workspace.create', name: 'Defaults', slug: `defaults-${Date.now().toString(36)}` }))).workspaceId;
  // a workspace may get its cloud runner at sign-up (it depends on the environment); else register one
  const [runner] = await sql!`select id from machines where workspace_id=${WS}::uuid`;
  MACHINE = runner ? runner['id'] as string : (await j(await send(owner, { type: 'machine.register', workspace: WS, name: 'rig', platform: 'darwin', daemonVersion: '0.1.0' }))).machineId;
  const rex = await send(owner, { type: 'agent.register', workspace: WS, machineId: MACHINE, name: 'rex', role: 'orchestrator', model: 'gemini-3.8-flash', runtime: 'gemini', channels: ['general'] });
  expect(rex.status, await rex.clone().text()).toBe(200);
  REX = (await j(rex)).agentId;
});
afterAll(async () => { await sql?.end(); await store?.close(); });

describe.skipIf(!DB)('default destination agents', () => {
  it('grants the orchestrator Marketing and Finance at birth', async () => {
    expect(await grants(REX)).toEqual(['finance', 'marketing']);
    const people = (await j(await access('marketing'))).people as Array<{ id: string; hasAccess: boolean }>;
    expect(people.find(p => p.id === REX)?.hasAccess).toBe(true);
  });

  it('seeds one Finance agent with the orchestrator, in Finance and in no room', async () => {
    const [ledger] = await sql!`select id,role::text,machine_id,model,emoji from agents where workspace_id=${WS}::uuid and name='ledger'`;
    expect(ledger).toMatchObject({ role: 'finance', machine_id: MACHINE, model: 'gemini-3.8-flash' });
    expect(await grants(ledger!['id'] as string)).toEqual(['finance']);
    expect((await sql!`select 1 from agent_channels where agent_id=${ledger!['id'] as string}::uuid`).length).toBe(0);
    // a second register and a Finance visit never make a second one
    await send(owner, { type: 'agent.register', workspace: WS, machineId: MACHINE, name: 'rex', role: 'orchestrator', channels: ['general'] });
    expect((await access('finance')).status).toBe(200);
    expect((await sql!`select count(*)::int as n from agents where workspace_id=${WS}::uuid and role='finance'`)[0]!['n']).toBe(1);
  });

  it("keeps an owner's removal when the orchestrator registers again", async () => {
    const off = await app!.request('/v1/destinations/member', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(owner) }, body: JSON.stringify({ workspace: WS, destination: 'marketing', kind: 'agent', id: REX, on: false }) });
    expect(off.status).toBe(200);
    await send(owner, { type: 'agent.register', workspace: WS, machineId: MACHINE, name: 'rex', role: 'orchestrator', channels: ['general'] });
    expect(await grants(REX)).toEqual(['finance']);
    await app!.request('/v1/destinations/member', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(owner) }, body: JSON.stringify({ workspace: WS, destination: 'marketing', kind: 'agent', id: REX, on: true }) });
  });

  it('seeds the Finance agent for a workspace made before it existed, when Finance opens', async () => {
    const [ledger] = await sql!`select id from agents where workspace_id=${WS}::uuid and name='ledger'`;
    await sql!`delete from agents where id=${ledger!['id'] as string}::uuid`;
    const people = (await j(await access('finance'))).people as Array<{ name: string; kind: string; hasAccess: boolean }>;
    expect(people.find(p => p.kind === 'agent' && p.name === 'ledger')?.hasAccess).toBe(true);
  });

  it("streams an agent's Marketing snapshot compressed, past Cloud Run's 32 MiB limit", async () => {
    const [room] = await sql!`select id,project_id from channels where workspace_id=${WS}::uuid and kind='marketing' limit 1`;
    const [thread] = await sql!`insert into threads(workspace_id,project_id,channel_id,title,created_by) values(${WS}::uuid,${room!['project_id'] as string}::uuid,${room!['id'] as string}::uuid,'Posts',${owner.id}) returning id`;
    // 250 drafts, each with a preview at the 140,000-character budget (imagegen.ts THUMB_MAX)
    const thumb = 'data:image/jpeg;base64,' + Buffer.from(Array.from({ length: 105_000 }, () => Math.random() * 256 | 0)).toString('base64').slice(0, 139_970);
    await sql!`insert into content_items(workspace_id,channel_id,thread_id,body,media) select ${WS}::uuid,${room!['id'] as string}::uuid,${thread!['id'] as string}::uuid,'post',${sql!.json({ thumb })} from generate_series(1,250)`;
    const server = serve({ fetch: app!.fetch, port: 0, hostname: '127.0.0.1' });
    try {
      await new Promise(r => server.once('listening', r));
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/agent-replica/bootstrap?workspace=${WS}&thread=${thread!['id'] as string}`;
      const response = await fetch(url, { headers: { 'x-nm-actor': JSON.stringify({ kind: 'agent', id: REX }) } });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-encoding')).toBe('gzip');
      expect(response.headers.get('content-length')).toBeNull();
      const body = await response.text();
      expect(body.length).toBeGreaterThan(32 * 1024 * 1024);
      const batch = JSON.parse(body) as { workspaces: string[]; changes: Array<{ table: string }> };
      expect(batch.workspaces).toEqual([WS]);
      expect(batch.changes.filter(c => c.table === 'content_items')).toHaveLength(250);
    } finally { server.close(); }
  }, 120_000);
});
