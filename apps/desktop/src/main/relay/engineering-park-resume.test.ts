// CODE APPROVALS THAT OUTLIVE THEIR SESSION (engineering-park-resume.ts). A Code approval parks the
// moment it is asked. A drain (or a closed tab) ends the session but not the park. The person's answer
// is claimed by a later epoch, and the Code host continues the thread: with no tab it opens the session
// from the park's recorded meta, runs one continuation turn that states the answer, and closes. The
// re-issued call applies the approval without a second card. A tab that reopens the thread shows the
// open park as its approval card and continues the same way.
// Run: pnpm exec tsx --test src/main/relay/engineering-park-resume.test.ts
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ClineCore, ToolApprovalRequest } from '@cline/sdk';
import { createClineEngineeringHost } from './engineering-host';
import type { EngineeringMachineOpenMeta, EngineeringRuntimeEvent } from '../../engineering-protocol';
import { CodeParkResumer, codeParkFor, codeParkMeta, codeParkResumePrompt, isCodePark, offeredApproval, type CodeParkOutcome } from './engineering-park-resume';
import { ParkRegistry, useParks, type Park } from '../cloudrun/parks';
import { FakeServer } from '../cloudrun/parks.fake';

afterEach(() => useParks(null));

const keyFetch: typeof fetch = async () => new Response(JSON.stringify({ token: 'sk-test', authMode: 'apikey' }), { status: 200 });
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) { if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`); await tick(); }
}

const metaFor = (threadId: string): EngineeringMachineOpenMeta => ({
  threadId, actorId: 'u1', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'act',
  // commands ask: the approval goes to a person
  permissions: { read: true, edit: true, command: false, web: false, mcp: false },
  policy: { read: true, edit: true, command: true, web: true, mcp: true },
});
const COMMAND = { commands: ['pnpm test --filter api'] };
const request = (id: string): ToolApprovalRequest => ({ sessionId: 's', agentId: 'a', conversationId: 'c', iteration: 1, toolCallId: id, toolName: 'run_commands', input: COMMAND, policy: {} });

type Capability = (r: ToolApprovalRequest) => Promise<{ approved: boolean; reason?: string }> | { approved: boolean; reason?: string };

/** a Cline core that records its prompts and, when told to, re-issues the parked call inside its turn */
function fakeCore(o: { reissue?: boolean } = {}) {
  const seen = { prompts: [] as string[], disposed: 0, reissued: [] as Array<{ approved: boolean; reason?: string }> };
  let capability: Capability | undefined;
  let listener: ((event: unknown) => void) | null = null;
  const turn = (sessionId: string): void => {
    setTimeout(async () => {
      if (o.reissue && capability) seen.reissued.push(await capability(request(`again-${seen.prompts.length}`)));
      listener?.({ type: 'status', payload: { sessionId, status: 'idle' } });
    }, 5);
  };
  const core = {
    subscribe: (cb: (event: unknown) => void) => { listener = cb; return () => { listener = null; }; },
    listHistory: async () => [], readMessages: async () => [],
    start: async (input: { prompt?: string }) => { seen.prompts.push(String(input.prompt ?? '')); turn('cline-1'); return { sessionId: 'cline-1' }; },
    send: async (input: { prompt?: string }) => { seen.prompts.push(String(input.prompt ?? '')); turn('cline-1'); },
    abort: async () => {}, stop: async () => {}, dispose: async () => { seen.disposed += 1; },
    restore: async () => ({ messages: [], checkpoint: { ref: 'x', createdAt: Date.now(), runCount: 1 } }),
  } as unknown as ClineCore;
  const createCore = (async (options?: Parameters<typeof import('@cline/sdk').ClineCore.create>[0]) => {
    capability = options?.capabilities?.requestToolApproval as Capability | undefined;
    return core;
  }) as typeof import('@cline/sdk').ClineCore.create;
  return { seen, createCore, capability: () => capability! };
}

const hostWith = (createCore: typeof import('@cline/sdk').ClineCore.create) => createClineEngineeringHost({
  apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'w1', fetchImpl: keyFetch,
  resolveCwd: async () => '/work/app', resolveBrain: async () => ({ modelId: 'claude-sonnet-4-6' }), createCore, log: () => {},
});
const registry = (server: FakeServer, epoch: number) => new ParkRegistry({ api: server.apiFor(epoch), log: () => {}, now: () => server.now });

/** epoch 1: a Code session asks for a command, the approval parks, and a drain closes the session */
async function parkAtDrain(server: FakeServer, threadId: string): Promise<{ park: Park; asked: { approved: boolean; reason?: string } }> {
  useParks(registry(server, 1));
  const core = fakeCore();
  const host = hostWith(core.createCore);
  const events: EngineeringRuntimeEvent[] = [];
  await host.open(metaFor(threadId), (e) => events.push(e));
  const asked = core.capability()(request('cmd-1'));
  await until(() => events.some((e) => e.type === 'approval' && e.approvalId === 'cmd-1'), 'the approval card');
  host.hold?.();
  await host.closeAll?.();
  const result = await asked;
  const park = [...server.parks.values()].find((p) => p.status === 'open');
  assert.ok(park, 'the approval is still an open park after the drain');
  return { park: park!, asked: result };
}

test('helpers: the meta a park records, the card a tab is shown, the prompt the model reads', () => {
  const meta = metaFor(randomUUID());
  const park = { id: 'p1', kind: 'approval' as const, checkpoint: { kind: 'code-session', threadId: meta.threadId, repoId: 'r1', actorId: 'u1', meta }, request: { toolName: 'run_commands', category: 'command', input: JSON.stringify(COMMAND) }, resolution: { answer: 'Approve', approved: true } };
  assert.equal(isCodePark(park), true);
  assert.deepEqual(codeParkMeta(park), meta);
  assert.equal(codeParkFor(park, meta), true);
  assert.equal(codeParkFor(park, { ...meta, actorId: 'u2' }), false, 'another person never sees it');
  assert.equal(codeParkMeta({ ...park, checkpoint: { ...park.checkpoint, meta: undefined } }), null, 'a park from before the meta rode along');
  assert.equal(codeParkMeta({ ...park, checkpoint: { ...park.checkpoint, actorId: 'u2' } }), null, 'a meta that disagrees with its park');
  assert.equal(codeParkMeta({ ...park, checkpoint: { ...park.checkpoint, meta: { ...meta, repoName: 7 } } }), null, 'a meta that no longer validates');
  assert.equal(isCodePark({ kind: 'approval', checkpoint: { kind: 'task' } }), false);
  assert.deepEqual(offeredApproval(park), { approvalId: 'park-p1', category: 'command', toolName: 'run_commands', input: COMMAND });
  assert.equal(offeredApproval({ id: 'p2', request: { toolName: 'x', category: 'root', input: '{cut…' } }).category, 'command', 'an unknown category asks as a command');
  assert.equal(offeredApproval({ id: 'p2', request: { toolName: 'x', input: '{cut…' } }).input, '{cut…', 'a cut preview stays text');
  const approved = codeParkResumePrompt(park);
  assert.match(approved, /APPROVED/);
  assert.match(approved, /run_commands/);
  assert.match(approved, /pnpm test --filter api/);
  assert.match(codeParkResumePrompt({ ...park, resolution: { answer: 'Deny', approved: false } }), /DENIED.*Do not run it/s);
  assert.match(codeParkResumePrompt({ ...park, resolution: { answer: null, approved: false, reason: 'timeout' } }), /expired/);
});

test('a drain leaves the Code approval parked, with the session meta, and tells the model it stays parked', async () => {
  const server = new FakeServer();
  const threadId = randomUUID();
  const { park, asked } = await parkAtDrain(server, threadId);
  assert.equal(asked.approved, false);
  assert.match(asked.reason ?? '', /stays parked/);
  assert.equal(park.threadId, threadId);
  assert.equal(park.checkpoint['kind'], 'code-session');
  assert.deepEqual(codeParkMeta(park), { ...metaFor(threadId) }, 'a later boot can reopen the session from the park alone');
});

test('the answer, claimed by the next epoch with no tab open, continues the thread: the re-issued call runs without a card, and the park is done', async () => {
  const server = new FakeServer();
  const threadId = randomUUID();
  const { park } = await parkAtDrain(server, threadId);
  server.answer(park.id, 'Approve');
  // epoch 2 boots: the registry and its resumer exist before the claim, the Code host after the first sync
  server.epoch = 2;
  const reg = registry(server, 2);
  useParks(reg);
  const core = fakeCore({ reissue: true });
  let host: ReturnType<typeof hostWith> | null = null;
  const outcomes: string[] = [];
  const resumer = new CodeParkResumer({ host: () => host, log: (line) => outcomes.push(line) });
  resumer.install(reg);
  assert.equal(await reg.resumeResolved(), 1);
  await tick(20);
  assert.equal(core.seen.prompts.length, 0, 'nothing runs before the host exists');
  host = hostWith(core.createCore);
  resumer.attach();
  await until(() => server.parks.get(park.id)!.status === 'done', 'the park done');
  assert.equal(core.seen.prompts.length, 1);
  assert.match(core.seen.prompts[0]!, /APPROVED/);
  assert.deepEqual(core.seen.reissued, [{ approved: true }], 'the same call, re-issued, applies the answer');
  await until(() => core.seen.disposed === 1, 'the session with no tab closed after its turn');
  assert.ok(outcomes.some((l) => l.includes(`code park ${park.id} (approved): opened`)), outcomes.join('\n'));
  assert.deepEqual(server.calls.filter((c) => c.startsWith('claim')), [`claim ${park.id} e2`]);
});

test('a denial continues the thread with the outcome, and the park is done before the turn even ends', async () => {
  const server = new FakeServer();
  const { park } = await parkAtDrain(server, randomUUID());
  server.answer(park.id, 'Deny');
  server.epoch = 2;
  const reg = registry(server, 2);
  useParks(reg);
  const core = fakeCore();
  const host = hostWith(core.createCore);
  const resumer = new CodeParkResumer({ host: () => host, log: () => {} });
  resumer.install(reg);
  resumer.attach();
  await reg.resumeResolved();
  await until(() => core.seen.prompts.length === 1, 'the continuation prompt');
  assert.match(core.seen.prompts[0]!, /DENIED/);
  await until(() => server.parks.get(park.id)!.status === 'done', 'the park done');
  await until(() => core.seen.disposed === 1, 'the session closed');
});

test('a reopened tab is shown the open park as its card, and its answer continues the thread on this machine', async () => {
  const server = new FakeServer();
  const threadId = randomUUID();
  const { park } = await parkAtDrain(server, threadId);
  server.epoch = 2;
  const reg = registry(server, 2);
  useParks(reg);
  const core = fakeCore({ reissue: true });
  const host = hostWith(core.createCore);
  const events: EngineeringRuntimeEvent[] = [];
  const session = await host.open(metaFor(threadId), (e) => events.push(e));
  await until(() => events.some((e) => e.type === 'approval' && e.approvalId === `park-${park.id}`), 'the parked card');
  const card = events.find((e) => e.type === 'approval') as Extract<EngineeringRuntimeEvent, { type: 'approval' }>;
  assert.equal(card.toolName, 'run_commands');
  assert.deepEqual(card.input, COMMAND);
  // another person's tab on another thread is never shown it (its own host: the fake core keeps one callback)
  const other: EngineeringRuntimeEvent[] = [];
  const otherSession = await hostWith(fakeCore().createCore).open({ ...metaFor(randomUUID()), actorId: 'u2' }, (e) => other.push(e));
  await tick(30);
  assert.equal(other.some((e) => e.type === 'approval'), false);
  await otherSession.close();

  session.command({ type: 'approval', approvalId: `park-${park.id}`, approved: true });
  await until(() => server.parks.get(park.id)!.status === 'done', 'the park done');
  assert.ok(events.some((e) => e.type === 'approval_resolved' && e.approvalId === `park-${park.id}` && e.approved), 'the card resolves in the tab');
  assert.equal(server.parks.get(park.id)!.resolution?.answer, 'Approve');
  assert.equal(core.seen.prompts.length, 1);
  assert.deepEqual(core.seen.reissued, [{ approved: true }]);
  assert.equal(core.seen.disposed, 0, 'the tab keeps its session');
  await session.close();
});

test('the resumer: Code parks only, queued until attach, a busy thread is asked again, and a drain leaves the claim', async () => {
  const seen: Array<{ id: string; n: number }> = [];
  const answers: CodeParkOutcome[] = ['busy', 'continued'];
  const host = { resumeParked: async (p: Park) => { seen.push({ id: p.id, n: seen.length }); return answers.shift() ?? 'held'; } };
  const resumer = new CodeParkResumer({ host: () => host, log: () => {}, retryMs: 5 });
  const park = (id: string, kind = 'code-session'): Park => ({
    id, key: `k-${id}`, kind: 'approval', status: 'claimed', resolution: { answer: 'Approve', approved: true }, expiresAt: new Date(Date.now() + 60_000).toISOString(),
    messageId: null, question: null, taskId: null, threadId: null, request: {}, checkpoint: { kind }, claimedEpoch: 2,
  });
  resumer.onPark(park('task-park', 'task'));
  resumer.onPark(park('a'));
  assert.equal(resumer.pending, 1);
  assert.equal(seen.length, 0);
  resumer.attach();
  await until(() => seen.length === 2, 'the retry');
  assert.deepEqual(seen.map((s) => s.id), ['a', 'a']);
  await until(() => resumer.pending === 0, 'settled');
  resumer.onPark({ ...park('b'), resolution: null });
  assert.equal(resumer.pending, 0, 'a park with no answer is not resumed');
});

test('a host with no session for the thread and a draining registry answers held, so the next epoch claims it again', async () => {
  const server = new FakeServer();
  const { park } = await parkAtDrain(server, randomUUID());
  server.answer(park.id, 'Approve');
  server.epoch = 2;
  const reg = registry(server, 2);
  useParks(reg);
  const core = fakeCore();
  const host = hostWith(core.createCore);
  host.hold?.();
  const claimed = await server.apiFor(2).claim(park.id);
  assert.equal(await host.resumeParked!(claimed), 'held');
  assert.equal(server.parks.get(park.id)!.status, 'claimed');
  server.epoch = 3;
  assert.deepEqual((await server.apiFor(3).claimable()).map((p) => p.id), [park.id], 'a dead epoch\'s claim is claimable again');
  assert.equal(await host.resumeParked!({ ...claimed, checkpoint: { kind: 'code-session' } }), 'unusable', 'no meta, nothing to reopen');
});
