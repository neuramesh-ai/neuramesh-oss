// The workspace import against the REAL schema (source release 2026-09, unit U7; the protocol
// in docs/export-format.md "Import"). The two halves prove each other: one workspace is EXPORTED
// through exportEntries, the archive is parsed and planned with @neuramesh/shared, and the batches
// stream into a second, cloud workspace the way the desktop driver will. Every table lands under
// the target's workspace_id with the manifest's counts less the merges, the maps come back, a
// replay writes nothing, and every refusal refuses before a write. Run via scripts/test-pg.sh,
// skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { EXPORT_REFS, EXPORT_TABLES, IMPORT_BATCH_MAX_BYTES, parseExport, planBatches, repoint, rewriteTaskRefs, type ExportTable, type ImportBatch, type ImportBatchResult, type ParsedExport } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { exportEntries } from '../src/export';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const hdr = (actor: Actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
const GIB = 1024 ** 3;

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', { method: 'POST', headers: hdr(actor), body: JSON.stringify(body) });
}
function post(ws: string, actor: Actor, batch: unknown) {
  return app!.request(`/v1/workspaces/${ws}/import/batches`, { method: 'POST', headers: hdr(actor), body: JSON.stringify(batch) });
}
async function makeUser(clerkId: string, email: string): Promise<Actor> {
  const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${clerkId}, ${email})
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  return { kind: 'human', id: row!['id'] as string };
}
/** a deterministic mint: uuid-shaped, counted, one namespace per plan */
function counter(prefix: string): (old: string) => string {
  const seen = new Map<string, string>();
  return (old) => {
    let v = seen.get(old);
    if (!v) seen.set(old, (v = `${prefix}-0000-4000-8000-${String(seen.size + 1).padStart(12, '0')}`));
    return v;
  };
}
async function exportOf(ws: string): Promise<ParsedExport> {
  const [row] = await sql!`select name, slug from workspaces where id = ${ws}::uuid`;
  const entries: Array<{ name: string; text: string }> = [];
  for await (const e of exportEntries(sql!, { id: ws, name: row!['name'] as string, slug: row!['slug'] as string })) entries.push({ name: e.name, text: e.data.toString('utf8') });
  return parseExport(entries);
}
/** rows of one table in a workspace whose ids are among `ids` */
async function landed(ws: string, table: ExportTable, ids: string[]): Promise<number> {
  const [row] = table === 'project_repos'
    ? await sql!`select count(*)::int as c from project_repos pr join projects p on p.id = pr.project_id where p.workspace_id = ${ws}::uuid and pr.id = any(${ids}::uuid[])`
    : table === 'agent_channels'
      ? await sql!`select count(*)::int as c from agent_channels ac join agents a on a.id = ac.agent_id where a.workspace_id = ${ws}::uuid and ac.id = any(${ids}::uuid[])`
      : await sql!`select count(*)::int as c from ${sql!(table)} where workspace_id = ${ws}::uuid and id = any(${ids}::uuid[])`;
  return Number(row!['c']);
}
async function countOf(ws: string, table: ExportTable): Promise<number> {
  const [row] = await sql!`select count(*)::int as c from ${sql!(table)} where workspace_id = ${ws}::uuid`;
  return Number(row!['c']);
}
/** the desktop driver: re-point with the maps so far, send, accumulate. Every batch must answer 200. */
async function stream(ws: string, actor: Actor, batches: ImportBatch[]): Promise<{ results: ImportBatchResult[]; idMap: Record<string, string>; numberMap: Record<string, number>; slugMap: Record<string, string> }> {
  const idMap: Record<string, string> = {};
  const numberMap: Record<string, number> = {};
  const slugMap: Record<string, string> = {};
  const results: ImportBatchResult[] = [];
  for (const b of batches) {
    const rows = b.rows.map((r) => {
      const out = { ...r };
      for (const ref of EXPORT_REFS[b.table]) if (ref.column in out) out[ref.column] = repoint(out[ref.column], ref, idMap);
      if (b.table === 'messages') out['body'] = rewriteTaskRefs(String(out['body']), numberMap);
      return out;
    });
    const res = await post(ws, actor, { ...b, rows, ...(Object.keys(idMap).length ? { idMap } : {}) });
    const body = (await j(res)) as ImportBatchResult;
    expect(res.status, `${b.table} seq ${b.seq}${b.links ? ' links' : ''}: ${JSON.stringify(body)}`).toBe(200);
    Object.assign(idMap, body.idMap ?? {});
    Object.assign(numberMap, body.numberMap ?? {});
    Object.assign(slugMap, body.slugMap ?? {});
    results.push(body);
  }
  return { results, idMap, numberMap, slugMap };
}

let alice: Actor; let bob: Actor; let carol: Actor;
let SRC = ''; let TGT = ''; let FREE = ''; let THIRD = '';
let srcGeneral = ''; let srcTask = ''; let srcSubtask = ''; let srcThread = ''; let srcMessage = ''; let srcRex = ''; let srcRepo = ''; let srcOldFact = ''; let srcNewFact = '';
let tgtRex = ''; let tgtRepo = '';
const agentActor: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };

async function makeWorkspace(owner: Actor, name: string, plan: 'free' | 'cloud'): Promise<{ id: string; general: string }> {
  const made = await j(await send(owner, { type: 'workspace.create', name, slug: `u7-${name.toLowerCase().replace(/[^a-z]/g, '')}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}` }));
  await sql!`update workspaces set plan = ${plan} where id = ${made.workspaceId}::uuid`;
  return { id: made.workspaceId as string, general: made.channelId as string };
}
/** one machine per workspace (a free workspace allows one per member, 0114), then the agent on it */
const machines = new Map<string, string>();
async function crew(owner: Actor, ws: string, name: string, role: string, channels: string[]): Promise<string> {
  if (!machines.has(ws)) {
    const made = await send(owner, { type: 'machine.register', workspace: ws, name: 'the-mac', platform: 'darwin', daemonVersion: '0.0.0' });
    expect(made.status).toBe(200);
    machines.set(ws, (await j(made)).machineId as string);
  }
  const res = await send(owner, { type: 'agent.register', workspace: ws, machineId: machines.get(ws), name, role, channels });
  expect(res.status, `agent.register ${name}: ${await res.clone().text()}`).toBe(200);
  return (await j(res)).agentId as string;
}

beforeAll(async () => {
  if (!sql) return;
  alice = await makeUser('clerk_u7_alice', 'alice@import.test');
  bob = await makeUser('clerk_u7_bob', 'bob@import.test');
  carol = await makeUser('clerk_u7_carol', 'carol@import.test');

  // the SOURCE: a free (local-like) workspace with a row in every exported table and every key kind
  const src = await makeWorkspace(alice, 'Local Me', 'free');
  SRC = src.id; srcGeneral = src.general;
  srcRex = await crew(alice, SRC, 'rex', 'orchestrator', ['general']);
  await crew(alice, SRC, 'mover', 'developer', ['general', 'build']);
  srcTask = (await j(await send(alice, { type: 'task.create', workspace: SRC, channel: 'general', title: 'move this task' }))).task.id as string;
  srcSubtask = (await j(await send(alice, { type: 'task.create', workspace: SRC, channel: 'general', title: 'a step of the move' }))).task.id as string;
  await sql`update tasks set parent_task_id = ${srcTask}::uuid where id = ${srcSubtask}::uuid`;
  srcThread = crypto.randomUUID();
  const msg = await app!.request('/v1/messages', { method: 'POST', headers: hdr(alice), body: JSON.stringify({ workspace: SRC, channel: srcGeneral, body: 'the first word, about #1002', threadId: srcThread }) });
  expect(msg.status).toBe(200);
  srcMessage = (await j(msg)).message.id as string;
  const reply = await app!.request('/v1/messages', { method: 'POST', headers: hdr(alice), body: JSON.stringify({ workspace: SRC, channel: srcGeneral, body: 'a reply', threadId: srcThread }) });
  expect(reply.status).toBe(200);
  await sql`update messages set reply_to = ${srcMessage}::uuid where id = ${(await j(reply)).message.id}::uuid`;
  // the thread is the task's thread too: the forward key the link pass exists for
  await sql`update threads set task_id = ${srcTask}::uuid where id = ${srcThread}::uuid`;
  expect((await send(alice, { type: 'artifact.create', channel: srcGeneral, kind: 'doc', name: 'brand.md', inlineContent: '# Brand\nWarm and exact.' })).status).toBe(200);
  expect((await send(alice, { type: 'memory.upsert_fact', workspace: SRC, channel: 'general', content: 'The team prefers terse commit titles.' })).status).toBe(200);
  expect((await send(alice, { type: 'memory.upsert_fact', workspace: SRC, channel: 'general', content: 'The mascot is a seal named Bosun.' })).status).toBe(200);
  const facts = await sql`select id from facts where workspace_id = ${SRC}::uuid order by created_at, id`;
  srcOldFact = facts[0]!['id'] as string; srcNewFact = facts[1]!['id'] as string;
  await sql`update facts set superseded_by = ${srcNewFact}::uuid, valid_until = now() where id = ${srcOldFact}::uuid`;
  expect((await send(alice, { type: 'memory.refresh_block', workspace: SRC, channel: 'general', content: 'A summary block.' })).status).toBe(200);
  expect((await send(alice, { type: 'repo.link', workspace: SRC, channel: 'general', url: 'https://github.com/acme/moved-site' })).status).toBe(200);
  srcRepo = (await sql`select id from repos where workspace_id = ${SRC}::uuid`)[0]!['id'] as string;

  // the TARGET: cloud, same owner, a member who is not the owner, a same-name agent, the same repo, tasks of its own
  const tgt = await makeWorkspace(alice, 'Cloud Home', 'cloud');
  TGT = tgt.id;
  await sql`insert into workspace_members (workspace_id, user_id, role) values (${TGT}::uuid, ${bob.id}::uuid, 'member')`;
  tgtRex = await crew(alice, TGT, 'rex', 'orchestrator', ['general']);
  expect((await send(alice, { type: 'repo.link', workspace: TGT, channel: 'general', url: 'https://github.com/acme/moved-site' })).status).toBe(200);
  tgtRepo = (await sql`select id from repos where workspace_id = ${TGT}::uuid`)[0]!['id'] as string;
  expect((await send(alice, { type: 'task.create', workspace: TGT, channel: 'general', title: 'already here' })).status).toBe(200);

  FREE = (await makeWorkspace(alice, 'Still Free', 'free')).id;
  THIRD = (await makeWorkspace(alice, 'Third Cloud', 'cloud')).id;
});

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('POST /v1/workspaces/:id/import/batches', () => {
  let exp: ParsedExport;
  let plan: ReturnType<typeof planBatches>;
  /** the new id of a source row, once the plan exists */
  const nid = (old: string): string => plan.ids[old]!;
  let run: Awaited<ReturnType<typeof stream>>;

  it('the owner moves an export into a cloud workspace: every table lands under the target, and the maps come back', async () => {
    exp = await exportOf(SRC);
    for (const t of EXPORT_TABLES) expect(exp.manifest.counts[t], `${t} has rows to move`).toBeGreaterThan(0);
    plan = planBatches(exp, { targetWorkspaceId: TGT, importId: crypto.randomUUID(), mint: counter('aaaaaaaa') });
    expect(plan.tooLarge).toEqual([]);
    const before = await countOf(TGT, 'tasks');
    run = await stream(TGT, alice, plan.batches);

    // the opening batch: nothing written, the storage numbers said out loud
    expect(run.results[0]).toMatchObject({ ok: true, seq: 0, written: 0, skipped: 0, storage: { allocationBytes: 50 * GIB, totalBytes: plan.totalBytes } });
    expect(run.results[0]!.storage!.usedBytes).toBeGreaterThan(0);

    // every table: the manifest's count landed under the target's workspace_id, less the two merges
    const merged: Partial<Record<ExportTable, number>> = { agents: 1, repos: 1 };
    for (const t of EXPORT_TABLES) {
      const ids = exp.rows[t].map((r) => plan.ids[r.id]!);
      expect(await landed(TGT, t, ids), t).toBe(exp.manifest.counts[t] - (merged[t] ?? 0));
    }
    const written = run.results.filter((r) => r.seq > 0 && !plan.batches[r.seq]!.links).reduce((n, r) => n + r.written, 0);
    expect(written).toBe(Object.values(exp.manifest.counts).reduce((a, b) => a + b, 0) - 2);

    // agents merge by name, repos by (provider, org, name): the map names the target's own rows
    expect(run.idMap).toEqual({ [plan.ids[srcRex]!]: tgtRex, [plan.ids[srcRepo]!]: tgtRepo });
    const [mover] = await sql!`select status, machine_id from agents where workspace_id = ${TGT}::uuid and name = 'mover'`;
    expect(mover).toMatchObject({ status: 'offline', machine_id: null });
    // rex's imported registrations point at the target's rex and at the imported rooms
    const rexRooms = await sql!`select ac.channel_id from agent_channels ac join channels c on c.id = ac.channel_id where ac.agent_id = ${tgtRex}::uuid and c.workspace_id = ${TGT}::uuid`;
    expect(rexRooms.map((r) => r['channel_id'])).toContain(plan.ids[srcGeneral]);
    const linkRow = await sql!`select repo_id from project_repos where project_id = ${nid(exp.rows.projects[0]!.id)}::uuid`;
    expect(linkRow[0]!['repo_id']).toBe(tgtRepo);

    // tasks take the next numbers from the target's counter, in arrival order, and the map says which
    const srcNumbers = exp.rows.tasks.map((t) => t.number);
    expect(Object.keys(run.numberMap).map(Number).sort()).toEqual([...srcNumbers].sort());
    for (const t of exp.rows.tasks) {
      const [row] = await sql!`select number from tasks where id = ${nid(t.id)}::uuid`;
      expect(Number(row!['number'])).toBe(run.numberMap[String(t.number)]);
      expect(Number(row!['number'])).toBeGreaterThan(1000 + before);
    }
    const [firstMsg] = await sql!`select body from messages where id = ${nid(srcMessage)}::uuid`;
    const oldNumber = exp.rows.tasks.find((t) => t.id === srcTask)!.number;
    expect(firstMsg!['body']).toBe(`the first word, about #${run.numberMap[String(oldNumber)]}`);
    expect(oldNumber).toBe(1002);

    // the colliding project slug takes a suffix, and the imported project is not the default
    const [project] = await sql!`select slug, is_default from projects where id = ${nid(exp.rows.projects[0]!.id)}::uuid`;
    expect(project).toEqual({ slug: 'default-2', is_default: false });
    expect(run.slugMap).toEqual({ [plan.ids[exp.rows.projects[0]!.id]!]: 'default-2' });

    // the link pass: the forward keys landed once their rows existed
    const [thread] = await sql!`select task_id, root_message_id, schedule_id, machine_id from threads where id = ${nid(srcThread)}::uuid`;
    expect(thread).toEqual({ task_id: plan.ids[srcTask], root_message_id: plan.ids[srcMessage], schedule_id: null, machine_id: null });
    const [fact] = await sql!`select superseded_by, embedding from facts where id = ${nid(srcOldFact)}::uuid`;
    expect(fact).toEqual({ superseded_by: plan.ids[srcNewFact], embedding: null });
    const [sub] = await sql!`select parent_task_id from tasks where id = ${nid(srcSubtask)}::uuid`;
    expect(sub!['parent_task_id']).toBe(plan.ids[srcTask]);
    // nothing landed anywhere else
    expect(await landed(SRC, 'projects', [plan.ids[exp.rows.projects[0]!.id]!])).toBe(0);
  });

  it('a replayed batch writes 0 and answers the same maps', async () => {
    const again = await stream(TGT, alice, plan.batches);
    for (const r of again.results) expect(r.written, `seq ${r.seq}`).toBe(0);
    for (const [i, b] of plan.batches.entries()) expect(again.results[i]!.skipped).toBe(b.rows.length);
    expect(again.idMap).toEqual(run.idMap);
    expect(again.numberMap).toEqual(run.numberMap);
    expect(again.slugMap).toEqual(run.slugMap);
    for (const t of EXPORT_TABLES) {
      expect(await landed(TGT, t, exp.rows[t].map((r) => plan.ids[r.id]!))).toBe(exp.manifest.counts[t] - (t === 'agents' || t === 'repos' ? 1 : 0));
    }
  });

  it('a merged id the client did not re-point is re-pointed by the server from the echoed idMap', async () => {
    const id = crypto.randomUUID();
    const res = await post(TGT, alice, { importId: plan.batches[0]!.importId, seq: 99, table: 'agent_channels', idMap: run.idMap, rows: [
      { id, agent_id: plan.ids[srcRex], channel_id: plan.ids[srcGeneral], created_at: new Date().toISOString(), created_by_kind: null, created_by: null },
    ] });
    expect(res.status).toBe(200);
    expect(await j(res)).toMatchObject({ written: 0, skipped: 1 });
    const [row] = await sql!`select agent_id from agent_channels where id = ${id}::uuid`;
    expect(row).toBeUndefined();
    // written 0 because rex already reads that room from the real run: the same pair is a replay, by data
    const [pair] = await sql!`select count(*)::int as c from agent_channels where agent_id = ${tgtRex}::uuid and channel_id = ${nid(srcGeneral)}::uuid`;
    expect(Number(pair!['c'])).toBe(1);
  }, 20_000);

  it('a free target gets 402 and nothing is written', async () => {
    const p = planBatches(exp, { targetWorkspaceId: FREE, importId: crypto.randomUUID(), mint: counter('bbbbbbbb') });
    const first = await post(FREE, alice, p.batches[0]);
    expect(first.status).toBe(402);
    expect(await j(first)).toEqual({ error: 'This workspace needs Pro. Get Pro to migrate a workspace into it.', code: 'PLAN_LIMIT' });
    const projects = await post(FREE, alice, p.batches[1]);
    expect(projects.status).toBe(402);
    expect(await countOf(FREE, 'projects')).toBe(1);
  });

  it('an opening batch over the allocation gets 402 with the numbers, and nothing is written', async () => {
    const p = planBatches(exp, { targetWorkspaceId: THIRD, importId: crypto.randomUUID(), mint: counter('cccccccc') });
    const res = await post(THIRD, alice, { ...p.batches[0], first: { manifest: exp.manifest, totalBytes: 51 * GIB } });
    expect(res.status).toBe(402);
    expect(await j(res)).toMatchObject({ code: 'PLAN_LIMIT', error: expect.stringContaining('Not enough storage on this plan.'), storage: { allocationBytes: 50 * GIB, totalBytes: 51 * GIB } });
    expect(await countOf(THIRD, 'projects')).toBe(1);
    // and under it, the same batch opens the move
    const ok = await post(THIRD, alice, p.batches[0]);
    expect(ok.status).toBe(200);
    expect(await j(ok)).toMatchObject({ written: 0, skipped: 0 });
  });

  it('a member who is not the owner, an agent, and a stranger get 403', async () => {
    for (const who of [bob, agentActor, carol]) {
      const res = await post(TGT, who, plan.batches[0]);
      expect(res.status, who.kind + who.id).toBe(403);
      expect((await j(res)).code).toBe('NOT_PERMITTED');
    }
    expect((await post('not-a-uuid', alice, plan.batches[0])).status).toBe(404);
  });

  it('a child before its parent gets 409 IMPORT_ORDER with the first offending row, and the batch writes nothing', async () => {
    const p = planBatches(exp, { targetWorkspaceId: THIRD, importId: crypto.randomUUID(), mint: counter('dddddddd') });
    const channels = p.batches.find((b) => b.table === 'channels')!;
    const res = await post(THIRD, alice, channels);
    expect(res.status).toBe(409);
    expect(await j(res)).toEqual({
      error: expect.stringContaining('Send the projects rows first.'),
      code: 'IMPORT_ORDER',
      rowId: channels.rows[0]!['id'],
      column: 'project_id',
      missing: p.ids[exp.rows.projects[0]!.id],
    });
    expect(await countOf(THIRD, 'channels')).toBe(4);
    // a link pass before its rows is the same refusal
    const links = p.batches.find((b) => b.table === 'threads' && b.links)!;
    const early = await post(THIRD, alice, links);
    expect(early.status).toBe(409);
    expect(await j(early)).toMatchObject({ code: 'IMPORT_ORDER', rowId: links.rows[0]!['id'], column: 'id' });
    // the parent must be in THIS workspace: a channel naming the other cloud workspace's project is refused too
    const foreign = { ...channels, rows: [{ ...channels.rows[0]!, project_id: plan.ids[exp.rows.projects[0]!.id] }] };
    const cross = await post(THIRD, alice, foreign);
    expect(cross.status).toBe(409);
    expect((await j(cross)).code).toBe('IMPORT_ORDER');
  });

  it('a colliding channel slug gets a suffix, answered in slugMap', async () => {
    const [def] = await sql!`select id from projects where workspace_id = ${THIRD}::uuid and is_default`;
    const id = crypto.randomUUID();
    const res = await post(THIRD, alice, { importId: crypto.randomUUID(), seq: 2, table: 'channels', rows: [
      { id, workspace_id: THIRD, slug: 'general', topic: 'a second general', settings: {}, created_at: new Date().toISOString(), project_id: def!['id'], thread_mode: 'on', kind: 'build', marketing: null, created_by_kind: null, created_by: null },
    ] });
    expect(res.status).toBe(200);
    expect(await j(res)).toEqual({ ok: true, seq: 2, written: 1, skipped: 0, slugMap: { [id]: 'general-2' } });
    const [row] = await sql!`select slug from channels where id = ${id}::uuid`;
    expect(row!['slug']).toBe('general-2');
  });

  it('a row for another workspace, an unknown table, a bad shape, and a body over 4 MB are refused', async () => {
    const projects = plan.batches.find((b) => b.table === 'projects' && !b.first)!;
    const wrong = await post(TGT, alice, { ...projects, rows: [{ ...projects.rows[0]!, id: crypto.randomUUID(), workspace_id: THIRD }] });
    expect(wrong.status).toBe(400);
    expect((await j(wrong)).code).toBe('IMPORT_WORKSPACE');
    const machines = await post(TGT, alice, { ...projects, table: 'machines' });
    expect(machines.status).toBe(400);
    expect((await j(machines)).code).toBe('IMPORT_FORMAT');
    const shape = await post(TGT, alice, { ...projects, rows: 'x' });
    expect(shape.status).toBe(400);
    expect((await j(shape)).code).toBe('IMPORT_FORMAT');
    const notJson = await app!.request(`/v1/workspaces/${TGT}/import/batches`, { method: 'POST', headers: hdr(alice), body: '{' });
    expect(notJson.status).toBe(400);
    const big = await post(TGT, alice, { ...projects, rows: [{ ...projects.rows[0]!, description: 'x'.repeat(IMPORT_BATCH_MAX_BYTES) }] });
    expect(big.status).toBe(413);
    expect((await j(big)).code).toBe('IMPORT_TOO_LARGE');
    expect(await countOf(TGT, 'projects')).toBe(2);
  });
});
