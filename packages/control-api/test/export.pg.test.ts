// The workspace export against the REAL schema (source release 2026-09, unit U1b; the format in
// docs/export-format.md). The owner gets one tar.gz whose manifest counts equal the rows in the
// database, one JSONL file per table in dependency order, and nothing that must never travel:
// no credentials or machines entry, no token-shaped string, no stripped column. A member who is
// not the owner is refused, and so is an agent. Run via scripts/test-pg.sh — skipped without
// DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { EXPORT_TABLES, type ExportManifest } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';
import { untarGz } from './untar';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const hdr = (actor: Actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', { method: 'POST', headers: hdr(actor), body: JSON.stringify(body) });
}
async function makeUser(clerkId: string, email: string): Promise<Actor> {
  const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${clerkId}, ${email})
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  return { kind: 'human', id: row!['id'] as string };
}

/** rows per table as the database counts them, through the same joins the export uses */
async function dbCounts(ws: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of EXPORT_TABLES) {
    const [row] = t === 'project_repos'
      ? await sql!`select count(*)::int as c from project_repos pr join projects p on p.id = pr.project_id where p.workspace_id = ${ws}::uuid`
      : t === 'agent_channels'
        ? await sql!`select count(*)::int as c from agent_channels ac join agents a on a.id = ac.agent_id where a.workspace_id = ${ws}::uuid`
        : await sql!`select count(*)::int as c from ${sql!(t)} where workspace_id = ${ws}::uuid`;
    out[t] = Number(row!['c']);
  }
  return out;
}

let alice: Actor; let bob: Actor; let WS = ''; let general = '';
const agentActor: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };

beforeAll(async () => {
  if (!sql) return;
  alice = await makeUser('clerk_u1b_export_alice', 'alice@export.test');
  bob = await makeUser('clerk_u1b_export_bob', 'bob@export.test');
  const made = await j(await send(alice, { type: 'workspace.create', name: 'Export Me', slug: `u1b-export-${Date.now().toString(36)}` }));
  WS = made.workspaceId as string;
  general = made.channelId as string;
  await sql`update workspaces set plan = 'free' where id = ${WS}::uuid`;
  await sql`insert into workspace_members (workspace_id, user_id, role) values (${WS}::uuid, ${bob.id}::uuid, 'member')`;
  // rows in every table the export names: a task, a message (which births a thread), an
  // artifact with inline content, a fact and a memory block; the crew and its rooms come
  // from workspace.create's defaults and agent.register
  expect((await send(alice, { type: 'task.create', workspace: WS, channel: 'general', title: 'export this task' })).status).toBe(200);
  const msg = await app!.request('/v1/messages', {
    method: 'POST', headers: hdr(alice),
    body: JSON.stringify({ workspace: WS, channel: general, body: 'a message with a secret-looking word that is not a secret', threadId: crypto.randomUUID() }),
  });
  expect(msg.status).toBe(200);
  expect((await send(alice, { type: 'artifact.create', channel: general, kind: 'doc', name: 'brand.md', inlineContent: '# Brand\nWarm and exact.' })).status).toBe(200);
  expect((await send(alice, { type: 'memory.upsert_fact', workspace: WS, channel: 'general', content: 'The export test workspace prefers terse commit titles.' })).status).toBe(200);
  expect((await send(alice, { type: 'memory.refresh_block', workspace: WS, channel: 'general', content: 'A summary block for the export test.' })).status).toBe(200);
  expect((await send(alice, { type: 'repo.link', workspace: WS, channel: 'general', url: 'https://github.com/acme/exported-site' })).status).toBe(200);
  const { machineId } = await j(await send(alice, { type: 'machine.register', workspace: WS, name: 'export-mac', platform: 'darwin', daemonVersion: '0.0.0' }));
  expect((await send(alice, { type: 'agent.register', workspace: WS, machineId, name: 'exporter', role: 'developer', channels: ['general'] })).status).toBe(200);
});

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('GET /v1/workspaces/:id/export', () => {
  it('the owner gets one tar.gz whose manifest and files match the database exactly', async () => {
    const res = await app!.request(`/v1/workspaces/${WS}/export`, { headers: hdr(alice) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/gzip');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="neuramesh-u1b-export-[a-z0-9]+-\d{4}-\d{2}-\d{2}\.tar\.gz"$/);
    const entries = untarGz(Buffer.from(await res.arrayBuffer()));

    // manifest first, then every table in dependency order, nothing else
    expect(entries.map((e) => e.name)).toEqual(['manifest.json', ...EXPORT_TABLES.map((t) => `${t}.jsonl`)]);
    const manifest = JSON.parse(entries[0]!.data.toString('utf8')) as ExportManifest;
    expect(manifest.format).toBe('neuramesh-export');
    expect(manifest.version).toBe(1);
    expect(manifest.workspace).toEqual({ id: WS, name: 'Export Me', slug: expect.stringMatching(/^u1b-export-/) });
    expect(Date.parse(manifest.exportedAt)).toBeGreaterThan(Date.now() - 60_000);

    const counts = await dbCounts(WS);
    expect(manifest.counts).toEqual(counts);
    // the fixture put a row in every table, so an empty file would mean a query missed
    for (const t of EXPORT_TABLES) expect(counts[t], `${t} has rows to export`).toBeGreaterThan(0);

    for (const t of EXPORT_TABLES) {
      const file = entries.find((e) => e.name === `${t}.jsonl`)!;
      const lines = file.data.toString('utf8').split('\n').filter(Boolean);
      expect(lines.length, `${t}.jsonl line count`).toBe(counts[t]);
      for (const line of lines) {
        const row = JSON.parse(line) as Record<string, unknown>;
        expect(typeof row['id']).toBe('string');
        if (t !== 'project_repos' && t !== 'agent_channels') expect(row['workspace_id']).toBe(WS);
        for (const k of ['embedding', 'fts', 'machine_id', 'local_path']) expect(k in row, `${t}.${k} never travels`).toBe(false);
      }
    }
    // the inline content rides the artifact row
    const artifacts = entries.find((e) => e.name === 'artifacts.jsonl')!.data.toString('utf8');
    expect(artifacts).toContain('Warm and exact.');

    // nothing that must never travel: no such entry, no token-shaped string anywhere
    expect(entries.some((e) => /credential|machine|token|invite|device|email|credit/.test(e.name))).toBe(false);
    const everything = entries.map((e) => e.data.toString('utf8')).join('\n');
    expect(everything).not.toMatch(/\bnmm_[A-Za-z0-9_-]{8,}/);
    expect(everything).not.toMatch(/\bnmh_[A-Za-z0-9_-]{8,}/);
    expect(everything).not.toMatch(/\bsk-[A-Za-z0-9_-]{16,}/);
    expect(everything).not.toMatch(/\bwhsec_[A-Za-z0-9]{8,}/);
    expect(everything).not.toMatch(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  });

  it('a member who is not the owner gets 403, and so does an agent', async () => {
    const asBob = await app!.request(`/v1/workspaces/${WS}/export`, { headers: hdr(bob) });
    expect(asBob.status).toBe(403);
    expect((await j(asBob)).code).toBe('NOT_PERMITTED');
    const asAgent = await app!.request(`/v1/workspaces/${WS}/export`, { headers: hdr(agentActor) });
    expect(asAgent.status).toBe(403);
  });

  it('a workspace the caller does not belong to, and a malformed id, are refused', async () => {
    const stranger = await makeUser('clerk_u1b_export_carol', 'carol@export.test');
    expect((await app!.request(`/v1/workspaces/${WS}/export`, { headers: hdr(stranger) })).status).toBe(403);
    expect((await app!.request('/v1/workspaces/not-a-uuid/export', { headers: hdr(alice) })).status).toBe(404);
  });
});
