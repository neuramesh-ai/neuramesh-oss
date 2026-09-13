// The move driver against the REAL server (unit U7). scripts/e2e-move.sh starts Postgres and
// control-api and runs this with tsx. Two humans, as in the product: alice is the local stack's
// user and owns the SOURCE (plan free), bob is the cloud user and owns the TARGET (plan cloud).
// The driver exports as alice and imports as bob with real fetch, and every assertion reads the
// target back through the export route, so the script needs no database driver: only psql (by
// docker exec) to mint the two users and flip the target's plan.
//
//   NM_E2E_API=http://127.0.0.1:8799 NM_PG_NAME=nm-pg-u7d pnpm --filter @neuramesh/desktop exec tsx scripts/e2e-move.ts
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { EXPORT_TABLES, parseExport, type ExportTable, type ParsedExport } from '@neuramesh/shared';
import { planMove, runMove, type MoveDeps, type MoveEndpoint, type MovePush } from '../src/main/move/driver';
import { memoryMoveFiles } from '../src/main/move/files';
import { exportEntriesOf } from '../src/main/move/untar';

const API = process.env['NM_E2E_API'] ?? 'http://127.0.0.1:8799';
const PG = process.env['NM_PG_NAME'] ?? 'nm-pg-u7d';
const log = (line: string): void => console.log(`${new Date().toISOString().slice(11, 23)} ${line}`);

const psql = (sql: string): string => execFileSync('docker', ['exec', '-i', PG, 'psql', '-q', '-U', 'postgres', '-d', 'nm', '-tAc', sql], { encoding: 'utf8' }).trim();
const headersFor = (userId: string) => async () => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: userId }) });
async function command(userId: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}/v1/commands`, { method: 'POST', headers: await headersFor(userId)(), body: JSON.stringify(body) });
  const out = (await res.json()) as Record<string, unknown>;
  assert.equal(res.status, 200, `${(body as { type: string }).type}: ${JSON.stringify(out)}`);
  return out;
}
async function message(userId: string, ws: string, channel: string, body: string, threadId: string): Promise<string> {
  const res = await fetch(`${API}/v1/messages`, { method: 'POST', headers: await headersFor(userId)(), body: JSON.stringify({ workspace: ws, channel, body, threadId }) });
  const out = (await res.json()) as { message: { id: string } };
  assert.equal(res.status, 200, JSON.stringify(out));
  return out.message.id;
}
async function exportOf(userId: string, ws: string): Promise<ParsedExport> {
  const res = await fetch(`${API}/v1/workspaces/${ws}/export`, { headers: await headersFor(userId)() });
  assert.equal(res.status, 200, `export ${ws}`);
  return parseExport(exportEntriesOf(Buffer.from(await res.arrayBuffer())));
}
const stamp = Date.now().toString(36);
const user = (clerk: string, email: string): string => psql(`insert into nm_users (clerk_user_id, email) values ('${clerk}', '${email}') on conflict (clerk_user_id) do update set email = excluded.email returning id`);

async function seed(): Promise<{ alice: string; bob: string; SRC: string; TGT: string; srcTaskNumber: number; srcMessage: string }> {
  const alice = user(`e2e_u7_alice_${stamp}`, `alice-${stamp}@move.test`);
  const bob = user(`e2e_u7_bob_${stamp}`, `bob-${stamp}@move.test`);
  log(`users alice=${alice.slice(0, 8)} bob=${bob.slice(0, 8)}`);
  // the SOURCE: alice's free workspace with a row in every exported table
  const src = await command(alice, { type: 'workspace.create', name: 'Local Me', slug: `u7-local-${stamp}` });
  const SRC = src['workspaceId'] as string;
  const general = src['channelId'] as string;
  const machine = await command(alice, { type: 'machine.register', workspace: SRC, name: 'the-mac', platform: 'darwin', daemonVersion: '0.0.0' });
  await command(alice, { type: 'agent.register', workspace: SRC, machineId: machine['machineId'], name: 'rex', role: 'orchestrator', channels: ['general'] });
  await command(alice, { type: 'agent.register', workspace: SRC, machineId: machine['machineId'], name: 'mover', role: 'developer', channels: ['general', 'build'] });
  const task = (await command(alice, { type: 'task.create', workspace: SRC, channel: 'general', title: 'move this task' }))['task'] as { id: string; number: number };
  const sub = (await command(alice, { type: 'task.create', workspace: SRC, channel: 'general', title: `a step of #${task.number}` }))['task'] as { id: string };
  psql(`update tasks set parent_task_id = '${task.id}' where id = '${sub.id}'`);
  const thread = crypto.randomUUID();
  const srcMessage = await message(alice, SRC, general, `the first word, about #${task.number}`, thread);
  const reply = await message(alice, SRC, general, 'a reply', thread);
  psql(`update messages set reply_to = '${srcMessage}' where id = '${reply}'`);
  psql(`update threads set task_id = '${task.id}' where id = '${thread}'`);
  await command(alice, { type: 'artifact.create', channel: general, kind: 'doc', name: 'brand.md', inlineContent: '# Brand\nWarm and exact.' });
  await command(alice, { type: 'memory.upsert_fact', workspace: SRC, channel: 'general', content: 'The team prefers terse commit titles.' });
  await command(alice, { type: 'memory.upsert_fact', workspace: SRC, channel: 'general', content: 'The mascot is a seal named Bosun.' });
  const facts = psql(`select id from facts where workspace_id = '${SRC}' order by created_at, id`).split('\n');
  psql(`update facts set superseded_by = '${facts[1]}', valid_until = now() where id = '${facts[0]}'`);
  await command(alice, { type: 'memory.refresh_block', workspace: SRC, channel: 'general', content: 'A summary block.' });
  await command(alice, { type: 'repo.link', workspace: SRC, channel: 'general', url: 'https://github.com/acme/moved-site' });
  // the TARGET: bob's cloud workspace with a same-name agent, the same repo, and a task of its own
  const tgt = await command(bob, { type: 'workspace.create', name: 'Cloud Home', slug: `u7-cloud-${stamp}` });
  const TGT = tgt['workspaceId'] as string;
  psql(`update workspaces set plan = 'cloud' where id = '${TGT}'`);
  const bobMachine = await command(bob, { type: 'machine.register', workspace: TGT, name: 'the-cloud', platform: 'linux', daemonVersion: '0.0.0' });
  await command(bob, { type: 'agent.register', workspace: TGT, machineId: bobMachine['machineId'], name: 'rex', role: 'orchestrator', channels: ['general'] });
  await command(bob, { type: 'repo.link', workspace: TGT, channel: 'general', url: 'https://github.com/acme/moved-site' });
  await command(bob, { type: 'task.create', workspace: TGT, channel: 'general', title: 'already here' });
  log(`seeded source=${SRC.slice(0, 8)} (free) target=${TGT.slice(0, 8)} (cloud)`);
  return { alice, bob, SRC, TGT, srcTaskNumber: task.number, srcMessage };
}

async function main(): Promise<void> {
  const { alice, bob, SRC, TGT, srcTaskNumber, srcMessage } = await seed();
  const source: MoveEndpoint = { apiUrl: API, workspaceId: SRC, headers: headersFor(alice) };
  const target: MoveEndpoint = { apiUrl: API, workspaceId: TGT, headers: headersFor(bob) };
  const before = await exportOf(bob, TGT);
  const pushes: MovePush[] = [];
  const files = memoryMoveFiles();
  const deps: MoveDeps = { fetchImpl: fetch, emit: (p) => pushes.push(p), now: () => performance.now(), files, log };

  const planned = await planMove(deps, source, target, { localHumanId: alice, cloudUserId: bob });
  assert.ok(planned.storage.allocationBytes === 50 * 1024 ** 3, 'the cloud plan allocates 50 GB');
  assert.equal(planned.storage.totalBytes, planned.totalBytes);
  assert.deepEqual(planned.tooLarge, []);
  for (const t of EXPORT_TABLES) assert.ok(planned.counts[t] > 0, `${t} has rows to move`);
  log(`planned batches=${planned.batches.length - 1} bytes=${planned.totalBytes} storage_used=${planned.storage.usedBytes} agents=${planned.agents.join(',')}`);

  const out = await runMove(deps, planned, target, { connectionId: 'cloud', workspaceId: TGT, name: 'Cloud Home', slug: `u7-cloud-${stamp}` }, () => false);
  assert.equal(out.status, 'done', JSON.stringify(out));
  const after = await exportOf(bob, TGT);
  // every table: the source's count landed in the target, less rex (merged by name) and the repo (merged by key)
  const merged: Partial<Record<ExportTable, number>> = { agents: 1, repos: 1 };
  for (const t of EXPORT_TABLES) {
    const landed = after.manifest.counts[t] - before.manifest.counts[t];
    assert.equal(landed, planned.counts[t] - (merged[t] ?? 0), `${t}: ${before.manifest.counts[t]} → ${after.manifest.counts[t]}`);
    log(`table=${t} before=${before.manifest.counts[t]} after=${after.manifest.counts[t]} moved=${landed}`);
  }
  // every imported row carries the target's workspace_id, the human columns carry bob, agents never carry alice
  const imported = new Set(Object.values(planned.plan.ids));
  for (const t of EXPORT_TABLES) for (const row of after.rows[t] as Array<Record<string, unknown>>) {
    if (!imported.has(row['id'] as string)) continue;
    if ('workspace_id' in row) assert.equal(row['workspace_id'], TGT, `${t} ${row['id']} workspace`);
    for (const [k, v] of Object.entries(row)) assert.ok(v !== alice && v !== `human:${alice}`, `${t}.${k} still names the local human`);
  }
  // tasks renumbered from the target's counter, the map says so, and the branch is untouched
  const marker = out.status === 'done' ? out.marker : null;
  const numberMap = marker!.numberMap;
  const maxBefore = Math.max(...before.rows.tasks.map((t) => t.number));
  for (const t of after.rows.tasks) {
    if (!imported.has(t.id)) continue;
    assert.ok(t.number > maxBefore, `task ${t.id} renumbered past ${maxBefore}`);
  }
  assert.equal(after.rows.tasks.find((t) => t.id === planned.plan.ids[planned.parsed.rows.tasks.find((x) => x.number === srcTaskNumber)!.id])!.number, numberMap[String(srcTaskNumber)]);
  log(`numberMap=${JSON.stringify(numberMap)}`);
  // the `#n` reference in prose reads the new number
  const body = after.rows.messages.find((m) => m.id === planned.plan.ids[srcMessage])!.body;
  assert.equal(body, `the first word, about #${numberMap[String(srcTaskNumber)]}`);
  log(`message body=${JSON.stringify(body)}`);
  // the link pass landed: the thread names its task, the fact its successor, the subtask its parent
  const thread = after.rows.threads.find((t) => imported.has(t.id) && t.task_id)!;
  assert.ok(thread && imported.has(thread.task_id!) && thread.root_message_id === planned.plan.ids[srcMessage], 'thread links');
  assert.ok(after.rows.facts.some((f) => imported.has(f.id) && f.superseded_by && imported.has(f.superseded_by)), 'fact superseded_by');
  assert.ok(after.rows.tasks.some((t) => imported.has(t.id) && t.parent_task_id && imported.has(t.parent_task_id)), 'subtask parent');
  const done = pushes[pushes.length - 1]!;
  log(`done written=${done.written} skipped=${done.skipped} batches=${done.total}`);
  assert.equal(done.skipped, 2, 'rex and the repo were skipped as merges');

  // the replay: the same plan again, from nothing, writes 0
  const replay = await runMove({ ...deps, files: memoryMoveFiles(), emit: (p) => pushes.push(p) }, planned, target, marker!.target, () => false);
  assert.equal(replay.status, 'done');
  const replayDone = pushes[pushes.length - 1]!;
  assert.equal(replayDone.written, 0, `replay wrote ${replayDone.written}`);
  const again = await exportOf(bob, TGT);
  for (const t of EXPORT_TABLES) assert.equal(again.manifest.counts[t], after.manifest.counts[t], `${t} unchanged by the replay`);
  log(`replay written=${replayDone.written} skipped=${replayDone.skipped}`);
  // and the source is as it was
  const src = await exportOf(alice, SRC);
  for (const t of EXPORT_TABLES) assert.equal(src.manifest.counts[t], planned.counts[t], `${t} untouched at the source`);
  log('E2E MOVE: OK');
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
