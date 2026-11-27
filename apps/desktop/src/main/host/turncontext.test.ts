// threadTranscript — the newest-kept contract (2026-08-18 audit defect A2).
//
// The regression this pins: `order by created_at asc limit 40` took the OLDEST 40 rows, so a
// thread past 40 messages silently dropped its newest ones — including the human message that
// triggered the wake — and the agent answered an old conversation. The fix reads newest-first,
// renders chronologically, and caps older bodies while the live exchange stays whole.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeTurnContext } from './turncontext';
import { defaultBaselineRules, type PermissionMode } from '@neuramesh/shared';
import { makeThreadPermissionGate } from '../thread-permission-gate';
import { chatPermissionAction } from '../chat-permission-action';
import type { PermissionGate } from '../runtime/adapter';

type Row = { author_kind: string; author_id: string; body: string; created_at: string };

function harness(messages: Row[]) {
  // a db stub honoring the query's own ORDER/LIMIT semantics, so the assertion is about what the
  // SQL ASKS FOR, not about a mock's fixed answer
  const db = {
    getAll: async (sql: string) => {
      const desc = /order by created_at desc/i.test(sql);
      const limit = Number(/limit (\d+)/i.exec(sql)?.[1] ?? messages.length);
      const sorted = [...messages].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      if (desc) sorted.reverse();
      return sorted.slice(0, limit);
    },
  };
  const tc = makeTurnContext({ db, blockFor: async () => '', alog: () => () => {} } as never);
  return tc.threadTranscript(
    { id: 'agent-1', name: 'pat' } as never,
    { id: 'task-1', number: 7, title: 'long thread', state: 'in_progress', channel_id: 'ch-1', description: null } as never,
  );
}

const row = (i: number, body: string, author = 'human'): Row => ({
  author_kind: author === 'human' ? 'human' : 'agent',
  author_id: author === 'human' ? 'u-1' : author,
  body,
  created_at: `2026-08-18T10:${String(i).padStart(2, '0')}:00Z`,
});

test('a thread past 40 messages keeps its NEWEST rows — the trigger is always present', async () => {
  const messages = Array.from({ length: 45 }, (_, i) => row(i, `message ${i}`));
  messages.push(row(46, 'THE TRIGGERING MESSAGE'));
  const out = await harness(messages);
  assert.match(out, /THE TRIGGERING MESSAGE/, 'the newest message fell out of the transcript');
  assert.ok(!out.includes('message 0'), 'the oldest rows should be the ones trimmed');
  // still rendered oldest→newest for the model
  assert.ok(out.indexOf('message 44') < out.indexOf('THE TRIGGERING MESSAGE'), 'transcript lost chronological order');
});

test('older bodies are capped; the recent exchange stays whole', async () => {
  const long = 'x'.repeat(5_000);
  const messages = [
    ...Array.from({ length: 30 }, (_, i) => row(i, i === 0 ? long : `old ${i}`)),
    row(58, long, 'agent-2'),
  ];
  const out = await harness(messages);
  // the old long body is truncated with a visible mark…
  assert.match(out, /x{600} \[…\]/, 'an older long body was not capped');
  // …and the newest long body is untouched
  assert.ok(out.includes(`agent: ${long}`), 'a recent body was truncated — the live exchange must stay whole');
});

test('short threads are unchanged: everything present, in order, uncapped', async () => {
  const out = await harness([row(1, 'first'), row(2, 'second', 'agent-1'), row(3, 'third')]);
  assert.ok(out.indexOf('human: first') < out.indexOf('you: second'), 'order or authorship broke');
  assert.ok(out.indexOf('you: second') < out.indexOf('human: third'));
});

// The subagent floor (George, 2026-11-18): spawn is safe, so no card stands in front of the leg.
// The leg therefore runs behind the conversation's own gate, for its seated agent, and each of its
// actions is decided on its own. A safe spawn hands down no approval.

async function spawnLeg(mode: PermissionMode | null) {
  const rules = defaultBaselineRules();
  const gateFor = (seated: { name: string }, run: { id: string }): PermissionGate => {
    const modeGate = makeThreadPermissionGate(async () => mode, async () => ({ verdict: 'ask', reason: 'reviewer' }));
    return async (name, input) => {
      const mapped = chatPermissionAction(name, input);
      if (!mapped) return { decision: 'allow' };
      const decision = await modeGate.decide(mapped.kind, mapped.actions, rules);
      // a card would post here, as the seated agent on the leg's run: the test records the ask
      return decision?.verdict === 'allow' ? { decision: 'allow' } : { decision: 'deny', reason: `${decision?.verdict} · ${seated.name} · ${run.id}` };
    };
  };
  let legGate: PermissionGate | undefined;
  const tc = makeTurnContext({
    apiUrl: 'https://unreachable.invalid', ownerActorId: 'owner', db: { getAll: async () => [] }, blockFor: async () => '',
    alog: () => () => {}, narrate: () => () => {}, legSummary: (out: string) => out, recordLegResult: () => {}, brainBriefing: () => '',
    ensureChatWorkspace: () => '/tmp/nm-leg', taskOf: async () => null, seatLabel: () => 'designer', repoFor: () => ({}),
    resolveSeat: async () => ({ agent: { id: 'ivy', name: 'ivy', runtime: 'claude', role: 'marketer' }, from: null }),
    openRun: async () => ({ id: 'leg-run', step: async () => {}, settle: async () => {} }),
    resolveToken: async () => ({ token: 'token' }),
    runtimeFor: () => ({ runQuery: async (...args: unknown[]) => { legGate = args[17] as PermissionGate | undefined; return 'done'; } }),
  } as never);
  const rex = { id: 'rex', name: 'rex', role: 'orchestrator' } as never;
  const parent = { id: 'parent-run', step: async () => {}, settle: async () => {} };
  const spawn = tc.orchSpawnFor(rex, { id: 'room', slug: 'marketing', workspace_id: 'ws' }, 'thread', parent, undefined, 'triage', mode ? gateFor as never : undefined);
  assert.deepEqual(await spawn({ role: 'marketer', prompt: 'draft the launch schedule for next week', label: 'schedule' }), { ok: true, summary: 'done' });
  return legGate;
}

// the leg's wall budget is a real setTimeout that outlives the leg (turnkit withTimeout): fake it
test('a safe spawn hands the leg the thread gate, never a blanket approval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const parentGate = makeThreadPermissionGate(async () => 'default', async () => assert.fail('spawn reached the reviewer'));
  const spawn = chatPermissionAction('mcp__nm__spawn', {})!;
  assert.equal((await parentGate.decide(spawn.kind, spawn.actions, defaultBaselineRules()))?.verdict, 'allow');

  const leg = (await spawnLeg('default'))!;
  assert.ok(leg, 'the leg runs behind a gate');
  assert.deepEqual(await leg('Bash', { command: 'rm -rf dist' }), { decision: 'deny', reason: 'ask · ivy · leg-run' });
  assert.deepEqual(await leg('WebFetch', { url: 'https://example.com' }), { decision: 'deny', reason: 'ask · ivy · leg-run' });
  assert.deepEqual(await leg('mcp__connector__send_email', {}), { decision: 'deny', reason: 'ask · ivy · leg-run' });
  assert.deepEqual(await leg('Write', { file_path: 'schedule.md' }), { decision: 'allow' }); // Default edits files
  assert.deepEqual(await leg('mcp__nm__record_lesson', {}), { decision: 'allow' });
  assert.deepEqual(await leg('Read', { file_path: '/home/me/.ssh/id_rsa' }), { decision: 'deny', reason: 'deny · ivy · leg-run' });

  const careful = (await spawnLeg('request-review'))!;
  assert.deepEqual(await careful('Write', { file_path: 'schedule.md' }), { decision: 'deny', reason: 'ask · ivy · leg-run' });
});

test('a fan-out with no conversation gate runs its leg as before', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(await spawnLeg(null), undefined);
});
