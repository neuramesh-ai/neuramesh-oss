// The move driver against a scripted server. Run from apps/desktop:
//   pnpm exec tsx --test src/main/move/driver.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_TABLES, type ImportBatch } from '@neuramesh/shared';
import { memoryMoveFiles, type MoveTarget } from './files';
import { MoveRefusal, planMove, runMove, type MoveDeps, type MoveEndpoint, type MovePush } from './driver';
import { moveGate } from './movegate';
import { archiveOf, CLOUD_USER, fakeServer, IDS, LOCAL_HUMAN, ROWS, SRC_WS, TGT_REX, TGT_WS } from './testworld';

const headers = async () => ({ 'content-type': 'application/json' });
const source: MoveEndpoint = { apiUrl: 'http://local.test', workspaceId: SRC_WS, headers };
const cloud: MoveEndpoint = { apiUrl: 'http://cloud.test', workspaceId: TGT_WS, headers };
const target: MoveTarget = { connectionId: 'cloud', workspaceId: TGT_WS, name: 'Flowe', slug: 'flowe' };
const actors = { localHumanId: LOCAL_HUMAN, cloudUserId: CLOUD_USER };
const IMPORT_ID = '0f0f0f0f-0000-4000-8000-000000000001';

function deps(files = memoryMoveFiles(), importId = IMPORT_ID): { d: MoveDeps; pushes: MovePush[]; log: string[]; server: Promise<ReturnType<typeof fakeServer>> } {
  const pushes: MovePush[] = [];
  const log: string[] = [];
  let t = 1000;
  const server = archiveOf().then((a) => fakeServer(a));
  const d: MoveDeps = {
    fetchImpl: (async (...args: Parameters<typeof fetch>) => (await server).fetchImpl(...args)) as typeof fetch,
    emit: (p) => pushes.push(p), now: () => (t += 7), files, log: (l) => log.push(l), importId: () => importId,
  };
  return { d, pushes, log, server };
}
const rowsOf = (posts: ImportBatch[], table: string, links = false) => posts.filter((b) => b.table === table && !b.first && !!b.links === links).flatMap((b) => b.rows);

test('happy path: the opening batch answers the numbers and writes nothing, then every batch lands with the maps accumulating', async () => {
  const { d, pushes, log, server } = deps();
  const planned = await planMove(d, source, cloud, actors);
  const s = await server;
  // the opening batch: nothing written, storage said out loud, the counts and the crew for the sheet
  assert.equal(s.posts.length, 1);
  assert.ok(s.posts[0]!.first && s.posts[0]!.rows.length === 0);
  assert.deepEqual(planned.storage, { allocationBytes: 50 * 1024 ** 3, usedBytes: 12345, totalBytes: planned.totalBytes });
  assert.ok(planned.totalBytes > 0);
  for (const t of EXPORT_TABLES) assert.equal(planned.counts[t], ROWS[t].length, t);
  assert.deepEqual(planned.agents, ['rex', 'iris']);
  assert.deepEqual(planned.tooLarge, []);
  assert.equal(planned.resumeSeq, 1);
  assert.equal(s.held.size, 0);
  assert.deepEqual(pushes, [{ phase: 'planning' }]);

  const out = await runMove(d, planned, cloud, target, () => false);
  assert.equal(out.status, 'done');
  const total = planned.batches.length - 1;
  // every row landed once: the manifest's rows less the merged rex, plus the two link passes
  const rowBatches = planned.batches.filter((b) => !b.first && !b.links);
  assert.equal(s.held.size, rowBatches.reduce((n, b) => n + b.rows.length, 0) - 1);
  // the maps: rex merged onto the target's rex, and the registration that named him was re-pointed before it was sent
  const rex = planned.plan.ids[IDS.rex]!;
  assert.equal(rowsOf(s.posts, 'agent_channels')[0]!['agent_id'], TGT_REX, 'agent_channels.agent_id re-pointed from the echoed idMap');
  assert.equal(rowsOf(s.posts, 'tasks')[0]!['assignee_id'], TGT_REX, 'tasks.assignee_id (an agent) re-pointed');
  const agentsSeq = planned.batches.findIndex((b) => b.table === 'agents' && !b.first);
  for (const b of s.posts.filter((b) => b.seq > agentsSeq)) assert.deepEqual(b.idMap, { [rex]: TGT_REX }, `seq ${b.seq} echoes the idMap`);
  for (const b of s.posts.filter((b) => b.seq <= agentsSeq)) assert.equal(b.idMap, undefined, `seq ${b.seq} has no map to echo yet`);
  // the local human became the cloud user in every human column, and agents stayed
  assert.equal(rowsOf(s.posts, 'channels')[0]!['created_by'], CLOUD_USER);
  assert.equal(rowsOf(s.posts, 'threads')[0]!['created_by'], `human:${CLOUD_USER}`);
  const [t12, t13] = rowsOf(s.posts, 'tasks');
  assert.equal(t12!['creator_id'], CLOUD_USER);
  assert.equal(t13!['assignee_id'], CLOUD_USER);
  assert.equal(t13!['creator_id'], TGT_REX);
  assert.equal(rowsOf(s.posts, 'messages')[0]!['author_id'], CLOUD_USER);
  assert.equal(rowsOf(s.posts, 'messages')[1]!['author_id'], TGT_REX);
  assert.equal(rowsOf(s.posts, 'artifacts')[0]!['created_by'], CLOUD_USER);
  // `#12` in prose after the tasks landed: the message body reads the new numbers, an unknown number stays
  const marker = out.status === 'done' ? out.marker : null;
  assert.deepEqual(marker!.numberMap, { '12': 1001, '13': 1002 });
  assert.equal(rowsOf(s.posts, 'messages')[0]!['body'], 'see #1001 and #1002, not #99');
  // the tasks table itself is sent before its numbers exist, so its own prose keeps the old numbers
  assert.equal(t13!['title'], 'follows #12');
  // the link passes rode last, threads before facts, with the late keys re-pointed
  const links = s.posts.filter((b) => b.links);
  assert.deepEqual(links.map((b) => b.table), ['threads']);
  assert.deepEqual(links[0]!.rows[0], { id: planned.plan.ids[IDS.thread], workspace_id: TGT_WS, task_id: planned.plan.ids[IDS.task12], root_message_id: planned.plan.ids[IDS.msg] });
  assert.ok(s.posts[s.posts.length - 1]!.last);
  // the marker beside the replica, the progress gone, the log and the pushes per batch
  assert.deepEqual({ ...marker, movedAt: 'x' }, { importId: IMPORT_ID, movedAt: 'x', target, counts: planned.counts, totalBytes: planned.totalBytes, numberMap: { '12': 1001, '13': 1002 } });
  assert.equal(d.files.readProgress(), null);
  assert.deepEqual(pushes.filter((p) => p.phase === 'moving').map((p) => p.seq), Array.from({ length: total }, (_, i) => i + 1));
  assert.deepEqual(pushes[pushes.length - 1], { phase: 'done', seq: total, total, written: s.held.size + links.length, skipped: 1 });
  assert.match(log[0]!, /^move_plan /);
  assert.equal(log.filter((l) => l.startsWith('move_batch ')).length, total);
  assert.match(log[log.length - 1]!, /^move_done ms=\d+ rows=/);
});

test('a 409 IMPORT_ORDER surfaces the table, leaves nextSeq at the failed batch, and keeps the maps so far', async () => {
  const { d, pushes, server } = deps();
  const planned = await planMove(d, source, cloud, actors);
  const s = await server;
  s.refuse = (b) => (b.table === 'tasks' && !b.first ? { status: 409, body: { error: 'Row x names channel_id y, which is not in the workspace yet.', code: 'IMPORT_ORDER', rowId: 'x', column: 'channel_id', missing: 'y' } } : null);
  const out = await runMove(d, planned, cloud, target, () => false);
  assert.equal(out.status, 'error');
  const seq = planned.batches.findIndex((b) => b.table === 'tasks' && !b.first);
  assert.equal(out.status === 'error' && out.nextSeq, seq);
  assert.equal(out.status === 'error' && out.refusal.code, 'IMPORT_ORDER');
  const last = pushes[pushes.length - 1]!;
  assert.equal(last.phase, 'error');
  assert.equal(last.table, 'tasks');
  assert.equal(last.code, 'IMPORT_ORDER');
  const progress = d.files.readProgress()!;
  assert.equal(progress.nextSeq, seq);
  assert.equal(progress.importId, IMPORT_ID);
  assert.deepEqual(progress.idMap, { [planned.plan.ids[IDS.rex]!]: TGT_REX });
  assert.equal(d.files.readMarker(), null);
});

test('a PLAN_LIMIT on the opening batch surfaces the storage numbers, and nothing is written', async () => {
  const { d, server } = deps();
  const storage = { allocationBytes: 50 * 1024 ** 3, usedBytes: 49 * 1024 ** 3, totalBytes: 2 * 1024 ** 3 };
  const s = await server;
  s.refuse = (b) => (b.first ? { status: 402, body: { error: 'Not enough storage on this plan.', code: 'PLAN_LIMIT', storage } } : null);
  await assert.rejects(planMove(d, source, cloud, actors), (e: unknown) => e instanceof MoveRefusal && e.code === 'PLAN_LIMIT' && e.details.status === 402 && e.details.storage!.usedBytes === storage.usedBytes);
  assert.equal(s.posts.length, 1);
  assert.equal(s.held.size, 0);
  assert.equal(d.files.readProgress(), null);
});

test('a cancel between batches persists the progress, and a second start resumes with the same importId from nextSeq', async () => {
  const files = memoryMoveFiles();
  const { d, pushes, server } = deps(files);
  const planned = await planMove(d, source, cloud, actors);
  const s = await server;
  let sent = 0;
  const out = await runMove(d, planned, cloud, target, () => sent++ >= 2);
  assert.equal(out.status, 'cancelled');
  assert.equal(out.status === 'cancelled' && out.nextSeq, 3);
  assert.deepEqual(pushes[pushes.length - 1], { phase: 'ready', seq: 3, total: planned.batches.length - 1, written: 2, skipped: 0 });
  assert.equal(files.progress!.nextSeq, 3);
  assert.equal(files.progress!.importId, IMPORT_ID);
  assert.equal(files.progress!.targetWorkspaceId, TGT_WS);
  // the retry: a fresh importId is offered, the progress file wins, the plan mints the same ids
  const again = deps(files, '99999999-0000-4000-8000-000000000009');
  again.d.fetchImpl = d.fetchImpl;
  const replanned = await planMove(again.d, source, cloud, actors);
  assert.equal(replanned.importId, IMPORT_ID);
  assert.equal(replanned.resumeSeq, 3);
  assert.deepEqual(replanned.plan.ids, planned.plan.ids);
  // the resumed opening batch declares only the bytes still to send, never the whole export again
  const openings = s.posts.filter((b) => b.first);
  assert.equal(openings.length, 2);
  assert.equal(openings[0]!.first!.totalBytes, planned.totalBytes);
  assert.ok(openings[1]!.first!.totalBytes > 0 && openings[1]!.first!.totalBytes < planned.totalBytes, `resume declares less: ${openings[1]!.first!.totalBytes} < ${planned.totalBytes}`);
  const before = s.posts.length;
  const done = await runMove(again.d, replanned, cloud, target, () => false);
  assert.equal(done.status, 'done');
  assert.deepEqual(s.posts.slice(before).map((b) => b.seq), planned.batches.slice(3).map((b) => b.seq), 'resumed at 3, nothing before it re-sent');
  assert.ok(files.marker);
  assert.equal(files.progress, null);
});

test('a progress file for another target does not resume: a new importId, a fresh plan', async () => {
  const files = memoryMoveFiles({ progress: { importId: '77777777-0000-4000-8000-000000000007', targetWorkspaceId: 'other', nextSeq: 4, idMap: {}, numberMap: {}, slugMap: {} } });
  const { d } = deps(files);
  const planned = await planMove(d, source, cloud, actors);
  assert.equal(planned.importId, IMPORT_ID);
  assert.equal(planned.resumeSeq, 1);
});

test('a re-run over a completed move is not an error: the server answers written 0 and the marker is written again', async () => {
  const { d, server } = deps();
  const planned = await planMove(d, source, cloud, actors);
  assert.equal((await runMove(d, planned, cloud, target, () => false)).status, 'done');
  const s = await server;
  const held = s.held.size;
  const again = await runMove(d, planned, cloud, target, () => false);
  assert.equal(again.status, 'done');
  assert.equal(s.held.size, held);
  const replayed = s.posts.slice(planned.batches.length);
  assert.ok(replayed.length > 0);
  assert.equal(again.status === 'done' && again.marker.importId, IMPORT_ID);
});

test('an export that does not download, and a server that answers no JSON, are FAILED with a sentence', async () => {
  const { d } = deps();
  d.fetchImpl = (async () => new Response('nope', { status: 503 })) as typeof fetch;
  await assert.rejects(planMove(d, source, cloud, actors), (e: unknown) => e instanceof MoveRefusal && e.code === 'FAILED' && /503/.test(e.message));
});

// ── the gate: which move these connections allow ──
const local = { workspaceId: SRC_WS, name: 'Acme Robotics', slug: 'acme', marker: null };
const flowe = { id: TGT_WS, name: 'Flowe', slug: 'flowe', role: 'owner', plan: 'cloud' };

test('moveGate: no local workspace, no cloud, no Pro workspace, none owned', () => {
  assert.equal(moveGate(null, null).ok, false);
  assert.deepEqual(moveGate({ ...local, workspaceId: '' }, null), { ok: false, code: 'NO_LOCAL', message: 'This Mac has no workspace to migrate.' });
  assert.equal((moveGate(local, null) as { code: string }).code, 'NO_CLOUD');
  assert.equal((moveGate(local, { connectionId: 'cloud', standingIn: 'x', workspaces: [{ ...flowe, plan: 'free' }] }) as { code: string }).code, 'NOT_PRO');
  assert.equal((moveGate(local, { connectionId: 'cloud', standingIn: 'x', workspaces: [{ ...flowe, role: 'member' }] }) as { code: string }).code, 'NOT_OWNER');
});

test('moveGate: the owned Pro workspaces are the targets, the one the cloud stands in is the default, and a wanted one wins', () => {
  const other = { id: 'ws-other', name: 'Other', slug: 'other', role: 'owner', plan: 'cloud' };
  const g = moveGate(local, { connectionId: 'cloud', standingIn: 'ws-other', workspaces: [flowe, other, { ...flowe, id: 'ws-free', plan: 'free' }] });
  assert.ok(g.ok);
  if (!g.ok) return;
  assert.deepEqual(g.targets.map((t) => t.workspaceId), [TGT_WS, 'ws-other']);
  assert.equal(g.target.workspaceId, 'ws-other');
  assert.deepEqual(g.source, { workspaceId: SRC_WS, name: 'Acme Robotics', slug: 'acme' });
  const wanted = moveGate(local, { connectionId: 'cloud', standingIn: 'ws-other', workspaces: [flowe, other] }, TGT_WS);
  assert.equal(wanted.ok && wanted.target.name, 'Flowe');
});

test('moveGate: a moved.json beside the replica answers the marker, and no second move', () => {
  const marker = { importId: IMPORT_ID, movedAt: '2026-09-12T10:00:00.000Z', target, counts: {} as never, totalBytes: 0, numberMap: {} };
  const g = moveGate({ ...local, marker }, null);
  assert.ok(g.ok && g.alreadyMoved === marker && g.target === target && g.targets.length === 0);
});
