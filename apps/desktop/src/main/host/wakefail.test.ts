// A WAKE THAT DIED BEFORE ITS TURN STARTED (the sandbox browser run, 2026-10-27): the thread's brain
// could not load its cloud checkpoint (503), the queue logged "flow … threw", and the person's message
// stayed the thread's last word, so every client read the thread as "in progress" forever. The failed
// start now answers the message with the machine's reason, from the one machine that holds it.
// Run from apps/desktop: pnpm exec tsx --test src/main/host/wakefail.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { threadStatus } from '@neuramesh/shared';
import { endFailedTurn, failedWake, sayTurnFailed, type FailedWakeDeps } from './wakefail';
import { isComputeNotice, turnFailedNotice } from '../computenotice';
import type { HostedAgent } from '../agents';
import type { RunHandle } from './runs';

const rex: HostedAgent = { id: 'a-rex', name: 'rex', model: 'gemini-3.5-flash-lite', role: 'orchestrator', runtime: 'gemini', channels: new Set(['c-build']) };
const BRAIN = 'The cloud brain could not load (503). Retry before this thread continues.';
const MSG = { id: 'm-1', body: '@rex introduce yourself in one sentence.' };

/** the replica, the wake lease and the API, each recorded */
function rig(opts: { lost?: boolean; movedTo?: string; postStatus?: number; postThrows?: boolean } = {}) {
  const posts: Array<{ path: string; actor: unknown; body: Record<string, unknown> }> = [];
  const leases: Array<{ where: unknown; prompt: string; trigger: string | null | undefined }> = [];
  const settled: Array<[string, string | undefined]> = [];
  const lines: string[] = [];
  const deps: FailedWakeDeps = {
    db: {
      get: async <T>(sql: string, params?: unknown[]): Promise<T> => {
        if (/from channels/.test(sql)) return { id: params?.[0], workspace_id: 'ws-1' } as T;
        if (/from threads/.test(sql)) return { channel_id: opts.movedTo ?? 'c-build' } as T;
        throw new Error(`unexpected query: ${sql}`);
      },
    },
    openWakeRun: async (_agent, where, prompt, trigger) => {
      leases.push({ where, prompt, trigger });
      if (opts.lost) return { id: '', lost: true, step: async () => {}, settle: async () => {} };
      return { id: 'run-1', step: async () => {}, settle: async (state, summary) => { settled.push([state, summary]); } };
    },
    post: async (path, actor, body) => {
      if (opts.postThrows) throw new Error('fetch failed');
      posts.push({ path, actor, body: body as Record<string, unknown> });
      return new Response('{}', { status: opts.postStatus ?? 200 });
    },
    log: (line) => lines.push(line),
  };
  return { deps, posts, leases, settled, lines };
}

test('a conversation wake whose brain did not load answers its message with the reason, and its run settles failed', async () => {
  const r = rig();
  assert.equal(await failedWake(r.deps, rex, MSG, { channelId: 'c-build', threadId: 'th-1' }, new Error(BRAIN)), 'said');
  assert.deepEqual(r.leases, [{ where: { workspace: 'ws-1', channelId: 'c-build', threadId: 'th-1', taskId: null }, prompt: MSG.body, trigger: 'm-1' }], 'the lease is taken on the message, like the wake itself');
  assert.deepEqual(r.settled, [['failed', BRAIN]]);
  assert.deepEqual(r.posts, [{
    path: '/v1/messages',
    actor: { kind: 'agent', id: 'a-rex' },
    body: { workspace: 'ws-1', channel: 'c-build', replyTo: 'm-1', threadId: 'th-1', body: turnFailedNotice(BRAIN) },
  }]);
});

test('the notice says the reason and the one move, in plain words, and the routine resume reads it as no answer', () => {
  const said = turnFailedNotice(BRAIN);
  assert.equal(said, "I can't reply now. The cloud brain could not load (503). Retry before this thread continues. Send your message again.");
  assert.equal(turnFailedNotice('the brain store is offline'), "I can't reply now. The brain store is offline. Send your message again.");
  assert.equal(turnFailedNotice('  '), "I can't reply now. Send your message again.");
  for (const s of [said, turnFailedNotice('x')]) assert.ok(!/[—;]/.test(s), `no em dash and no semicolon: ${s}`);
  assert.equal(isComputeNotice(said), true, 'a notice is never an answer: the routine resume asks again');
  assert.equal(isComputeNotice("I can't reply now. This workspace is out of credits. Add credits in Credits, or connect your own brain in Settings."), true);
});

test('with the notice the thread stops reading in progress: the agent spoke last', () => {
  const at = '2026-10-27T00:29:55.198Z';
  const base = { task: null, card: null, live: false, lastAt: at, settledAt: null };
  assert.equal(threadStatus({ ...base, lastAuthorKind: 'human' }), 'in_progress', 'the bug: a message nobody answered');
  assert.equal(threadStatus({ ...base, lastAuthorKind: 'agent' }), 'settled', 'the notice is the agent\'s word');
});

test('a machine that does not hold the message stays silent: the wake lease decides who speaks', async () => {
  const r = rig({ lost: true });
  assert.equal(await failedWake(r.deps, rex, MSG, { channelId: 'c-build', threadId: 'th-1' }, new Error(BRAIN)), 'elsewhere');
  assert.deepEqual(r.posts, []);
  assert.deepEqual(r.settled, []);
});

test('a task thread\'s wake answers in its task thread', async () => {
  const r = rig();
  assert.equal(await failedWake(r.deps, rex, MSG, { channelId: 'c-build', taskId: 't-12' }, new Error(BRAIN)), 'said');
  assert.deepEqual((r.leases[0]!.where as { taskId: string | null }).taskId, 't-12');
  assert.deepEqual(r.posts[0]!.body, { workspace: 'ws-1', channel: 'c-build', replyTo: 'm-1', taskId: 't-12', body: turnFailedNotice(BRAIN) });
});

test('a conversation filed into another room mid-turn gets the notice in the room it lives in now', async () => {
  const r = rig({ movedTo: 'c-general' });
  await failedWake(r.deps, rex, MSG, { channelId: 'c-build', threadId: 'th-1' }, new Error(BRAIN));
  assert.equal(r.posts[0]!.body['channel'], 'c-general');
});

test('a reply that already landed (409) leaves nothing owed, and a post that fails is logged, never thrown', async () => {
  const done = rig({ postStatus: 409 });
  assert.equal(await failedWake(done.deps, rex, MSG, { channelId: 'c-build', threadId: 'th-1' }, new Error(BRAIN)), 'unsaid');
  assert.deepEqual(done.lines, []);
  const down = rig({ postThrows: true });
  assert.equal(await failedWake(down.deps, rex, MSG, { channelId: 'c-build', threadId: 'th-1' }, new Error(BRAIN)), 'unsaid');
  assert.ok(down.lines.some((l) => l.includes('fetch failed')), down.lines.join('\n'));
});

test('a throw that is not an Error still ends the turn out loud', async () => {
  const r = rig();
  await failedWake(r.deps, rex, MSG, { channelId: 'c-build', threadId: 'th-1' }, 'boom');
  assert.equal(r.posts[0]!.body['body'], "I can't reply now. The turn could not start. Send your message again.");
});

// ── a wake that fails INSIDE its turn (the coordinator's ruling, 2026-10-28): its catch ends the turn
// the same way. Before, its run settled failed and the thread view said why, but the person's message
// stayed the last word, so the rail read "in progress" forever.

/** the run a wake holds its message with, recording how it settles */
function heldRun(settled: Array<[string, string | undefined]>, id = 'run-wake'): RunHandle {
  return { id, step: async () => {}, settle: async (state, summary) => { settled.push([state, summary]); } };
}
const STARTER = 'starter brain unavailable (503)';

test('a turn that fails past its lease answers with the run it holds, and asks for no second lease', async () => {
  const r = rig();
  const settled: Array<[string, string | undefined]> = [];
  const out = await endFailedTurn(r.deps, { agent: rex, m: MSG, at: { channelId: 'c-build', threadId: 'th-1' }, err: new Error(STARTER), run: heldRun(settled), held: true, rearmed: false });
  assert.equal(out, 'said');
  assert.deepEqual(r.leases, [], 'its own run is the lease: a second one would lose to it and say nothing');
  assert.deepEqual(settled, [['failed', STARTER]]);
  assert.deepEqual(r.posts[0]!.body, { workspace: 'ws-1', channel: 'c-build', replyTo: 'm-1', threadId: 'th-1', body: "I can't reply now. Starter brain unavailable (503). Send your message again." });
  assert.equal(isComputeNotice(r.posts[0]!.body['body'] as string), true);
});

test('with runs down (no lease row at all) the wake that went on still says why', async () => {
  const r = rig();
  const settled: Array<[string, string | undefined]> = [];
  assert.equal(await endFailedTurn(r.deps, { agent: rex, m: MSG, at: { channelId: 'c-build', taskId: 't-12' }, err: new Error('thread orchestration timed out after 4m'), run: heldRun(settled, ''), held: true, rearmed: false }), 'said');
  assert.equal(r.posts[0]!.body['body'], "I can't reply now. Thread orchestration timed out after 4m. Send your message again.");
  assert.equal(r.posts[0]!.body['taskId'], 't-12');
});

test('a turn that failed before its lease takes the lease first, and says nothing when another machine holds it', async () => {
  const won = rig();
  assert.equal(await endFailedTurn(won.deps, { agent: rex, m: MSG, at: { channelId: 'c-build', threadId: 'th-1' }, err: new Error('channel row missing'), run: heldRun([], ''), held: false, rearmed: false }), 'said');
  assert.equal(won.leases.length, 1);
  assert.equal(won.posts.length, 1);
  const lost = rig({ lost: true });
  assert.equal(await endFailedTurn(lost.deps, { agent: rex, m: MSG, at: { channelId: 'c-build', threadId: 'th-1' }, err: new Error('channel row missing'), run: heldRun([], ''), held: false, rearmed: false }), 'elsewhere');
  assert.deepEqual(lost.posts, []);
});

test('a reply the dead-letter sweep answers later keeps the message\'s one reply: no notice, and the run still settles failed', async () => {
  const r = rig();
  const settled: Array<[string, string | undefined]> = [];
  const why = 'reply post failed (network) after 6 tries';
  assert.equal(await endFailedTurn(r.deps, { agent: rex, m: MSG, at: { channelId: 'c-build', threadId: 'th-1' }, err: new Error(why), run: heldRun(settled), held: true, rearmed: true }), 'quiet');
  assert.deepEqual(r.posts, []);
  assert.deepEqual(r.leases, []);
  assert.deepEqual(settled, [['failed', why]]);
});

test('one failed wake, one notice: the reply index turns a second one away, and nothing more is owed', async () => {
  const r = rig({ postStatus: 409 });
  assert.equal(await sayTurnFailed(r.deps, rex, MSG, { channelId: 'c-build', threadId: 'th-1' }, new Error(STARTER), heldRun([])), 'unsaid');
  assert.deepEqual(r.lines, [], 'a 409 is not a failure to report');
});
