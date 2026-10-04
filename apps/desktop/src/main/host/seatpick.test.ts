// WHO A TURN SERVES, AND WHAT THEY PICKED (host/seatpick.ts, 0148): the trigger's human author first,
// then the conversation's starter, then the unit's maker (or the person who started the conversation
// the unit came from); the pick reads from the member row; the house-brain probe answers once per
// workspace and keeps the configured brain when it cannot tell. Run from apps/desktop:
// pnpm exec tsx --test src/main/host/seatpick.test.ts
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { forgetHouseBrain, houseBrainHere, memberPickOf, requesterOf } from './seatpick';
import { claudeEffort, codexEffort, geminiThinking } from '../runtime/thinking';

type Rows = Record<string, Record<string, unknown> | undefined>;
// a replica double: `get` THROWS on an empty result, as PowerSync's does
function replica(rows: Rows) {
  return {
    get: async <T>(sql: string, params: unknown[] = []): Promise<T> => {
      const key = `${sql.match(/from (\w+)/)?.[1]}:${params.join(',')}`;
      const r = rows[key];
      if (!r) throw new Error('empty result');
      return r as T;
    },
  };
}

test('the trigger\'s human author is the requester', async () => {
  const db = replica({ 'messages:m1': { author_kind: 'human', author_id: 'ana' }, 'threads:t1': { created_by: 'human:george' } });
  assert.equal(await requesterOf(db, { threadId: 't1', trigger: 'm1' }), 'ana');
});

test('an agent\'s trigger falls back to the person who started the conversation', async () => {
  const db = replica({ 'messages:m1': { author_kind: 'agent', author_id: 'rex' }, 'threads:t1': { created_by: 'human:george' } });
  assert.equal(await requesterOf(db, { threadId: 't1', trigger: 'm1' }), 'george');
  assert.equal(await requesterOf(replica({ 'threads:t2': { created_by: 'agent:rex' } }), { threadId: 't2' }), null);
});

test('a unit serves its human maker, else the person who started the conversation it came from', async () => {
  assert.equal(await requesterOf(replica({ 'tasks:k1': { creator_kind: 'human', creator_id: 'ana', origin_thread_id: null } }), { taskId: 'k1' }), 'ana');
  const db = replica({ 'tasks:k2': { creator_kind: 'agent', creator_id: 'rex', origin_thread_id: 't9' }, 'threads:t9': { created_by: 'human:george' } });
  assert.equal(await requesterOf(db, { taskId: 'k2' }), 'george');
  assert.equal(await requesterOf(replica({}), { taskId: 'k3' }), null);
  assert.equal(await requesterOf(replica({}), {}), null);
});

test('the pick reads off the member row, text or garbage', async () => {
  const db = replica({ 'workspace_members:ws,ana': { agent_models: JSON.stringify({ a1: { model: 'claude-opus-5', thinking: 'high' } }) } });
  assert.deepEqual(await memberPickOf(db, 'ws', 'ana', 'a1'), { model: 'claude-opus-5', thinking: 'high' });
  assert.equal(await memberPickOf(db, 'ws', 'ana', 'a2'), null);
  assert.equal(await memberPickOf(db, 'ws', 'bo', 'a1'), null);
  assert.equal(await memberPickOf(replica({ 'workspace_members:ws,ana': { agent_models: '{bad' } }), 'ws', 'ana', 'a1'), null);
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; forgetHouseBrain(); });

test('the house-brain probe asks once per workspace, and an unread answer keeps the configured brain', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response(JSON.stringify({ brain: { serves: true } }), { status: 200 }); }) as typeof fetch;
  const hdrs = async () => ({});
  assert.equal(await houseBrainHere('http://api', 'ws', hdrs), true);
  assert.equal(await houseBrainHere('http://api', 'ws', hdrs), true);
  assert.equal(calls, 1);
  globalThis.fetch = (async () => new Response(JSON.stringify({ brain: { callsToday: 3 } }), { status: 200 })) as typeof fetch;
  assert.equal(await houseBrainHere('http://api', 'ws-old-server', hdrs), false);
  globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
  assert.equal(await houseBrainHere('http://api', 'ws-offline', hdrs), false);
});

test('each vendor gets the level in its own words, and only for a model that takes one', () => {
  assert.deepEqual(claudeEffort({ model: 'claude-opus-5', thinking: 'high' }), { effort: 'high' });
  assert.deepEqual(codexEffort({ model: 'gpt-5.6-terra', thinking: 'low' }), { modelReasoningEffort: 'low' });
  assert.deepEqual(geminiThinking({ model: 'gemini-3.8-flash', thinking: 'medium' }), { thinkingConfig: { thinkingLevel: 'MEDIUM' } });
  assert.deepEqual(geminiThinking({ model: 'gemini-3.1-flash-lite', thinking: 'medium' }), {});
  assert.deepEqual(claudeEffort({ model: 'claude-opus-5', thinking: null }), {});
  assert.deepEqual(claudeEffort({ model: 'claude-opus-5' }), {});
});

// ── the whole seat (seatAgent): a replica double that answers by query shape ─────────────────────
const STARTER = 'gemini-3.5-flash-lite';
function world(o: { schedule?: string | null; override?: Record<string, string> | null; picks?: Record<string, unknown>; trigger?: { kind: string; id: string }; pack?: string | null }) {
  const answer = (sql: string, params: unknown[]): Record<string, unknown> | undefined => {
    if (/from threads where id = \?/.test(sql) && /schedule_id/.test(sql)) return { id: params[0], schedule_id: o.schedule ?? null, brain_override: o.override ? JSON.stringify(o.override) : null };
    if (/from threads where id = \?/.test(sql)) return { created_by: 'human:george' };
    if (/from channels c/.test(sql)) return { workspace_id: 'ws', model_pack: o.pack ?? null };
    if (/from messages where id = \?/.test(sql)) return o.trigger ? { author_kind: o.trigger.kind, author_id: o.trigger.id } : undefined;
    if (/from workspace_members/.test(sql)) { const who = String(params[1]); return o.picks && who in o.picks ? { agent_models: JSON.stringify(o.picks[who]) } : undefined; }
    return undefined;
  };
  return { get: async <T>(sql: string, params: unknown[] = []): Promise<T> => { const r = answer(sql, params); if (!r) throw new Error('empty result'); return r as T; } };
}
const rex = { id: 'a-rex', name: 'rex', role: 'orchestrator', model: 'claude-sonnet-5', runtime: 'claude-code', channels: new Set<string>() };
const seat = async (w: ReturnType<typeof world>, agent = rex, house = true) => {
  const { seatAgent } = await import('./seatpick');
  return seatAgent(agent, 'ch', { threadId: 't1', trigger: 'm1' }, { db: w, customPacksFor: async () => [], houseBrain: async () => house });
};

test('an automation runs on the NeuraMesh brain, whoever asked and whatever they picked', async () => {
  const w = world({ schedule: 's1', trigger: { kind: 'human', id: 'ana' }, picks: { ana: { 'a-rex': { model: 'claude-opus-5', thinking: 'high' } } } });
  const s = await seat(w);
  assert.equal(s.model, STARTER);
  assert.equal(s.runtime, 'gemini');
  assert.equal(s.thinking, null);
});

test('where the server serves no house brain, an automation keeps the configured seat', async () => {
  const s = await seat(world({ schedule: 's1' }), rex, false);
  assert.equal(s.model, 'claude-sonnet-5');
});

test('the asker\'s pick seats the agent, with the level', async () => {
  const w = world({ trigger: { kind: 'human', id: 'ana' }, picks: { ana: { 'a-rex': { model: 'gpt-5.6-terra', thinking: 'low' } }, george: { 'a-rex': { model: 'claude-opus-5' } } } });
  const s = await seat(w);
  assert.equal(s.model, 'gpt-5.6-terra');
  assert.equal(s.runtime, 'codex');
  assert.equal(s.thinking, 'low');
});

test('the pick beats a manual pin, and the conversation\'s own word beats the pick', async () => {
  const picks = { ana: { 'a-rex': { model: 'claude-opus-5', thinking: 'high' } } };
  const pinned = await seat(world({ trigger: { kind: 'human', id: 'ana' }, picks }), { ...rex, modelSource: 'manual' } as typeof rex);
  assert.equal(pinned.model, 'claude-opus-5');
  const overridden = await seat(world({ trigger: { kind: 'human', id: 'ana' }, picks, override: { orchestrator: STARTER } }));
  assert.equal(overridden.model, STARTER);
  assert.equal(overridden.thinking, null);
});

test('no pick, no override, no pack: the very same seat comes back', async () => {
  const s = await seat(world({ trigger: { kind: 'human', id: 'ana' } }));
  assert.equal(s, rex);
});
