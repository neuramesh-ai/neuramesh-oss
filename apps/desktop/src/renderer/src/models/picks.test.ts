// THE MODEL CHIP AND THE AGENT CHIP, AS RULES (models/picks.ts): the seat a person sees is the daemon's
// seat, a provider is ready only on a machine the person may use, the default answerer follows the
// thread's rule, and Send names a picked agent once. Run: pnpm -C apps/hq exec tsx --test src/models/picks.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STARTER_MODEL } from '@neuramesh/shared';
import { addressTo, chipLabel, defaultAnswerer, markOf, picksOf, providerStates, seatView, withoutRole } from './picks';

const rex = { id: 'a-rex', role: 'orchestrator', model: 'claude-sonnet-5' };
const iris = { id: 'a-iris', role: 'designer', model: 'claude-opus-5' };

test('the seat: automation, then the conversation, then the pick, then the agent', () => {
  const picks = { 'a-rex': { model: 'gpt-5.6-terra', thinking: 'low' as const } };
  assert.deepEqual(seatView(rex, picks, { automation: true }), { model: STARTER_MODEL, thinking: null, source: 'automation' });
  assert.deepEqual(seatView(rex, picks, { override: JSON.stringify({ orchestrator: STARTER_MODEL }) }), { model: STARTER_MODEL, thinking: null, source: 'thread' });
  assert.deepEqual(seatView(rex, picks), { model: 'gpt-5.6-terra', thinking: 'low', source: 'pick' });
  assert.deepEqual(seatView(iris, picks), { model: 'claude-opus-5', thinking: null, source: 'agent' });
  // a pick beats a hand pin, as on the daemon
  assert.equal(seatView({ ...rex, model_source: 'manual' }, picks).model, 'gpt-5.6-terra');
});

test('the picks read off the viewer\'s own member row', () => {
  const members = [{ user_id: 'u-ana', agent_models: JSON.stringify({ 'a-rex': { model: 'claude-opus-5' } }) }, { user_id: 'u-bo', agent_models: null }];
  assert.deepEqual(picksOf(members, 'u-ana'), { 'a-rex': { model: 'claude-opus-5' } });
  assert.deepEqual(picksOf(members, 'u-bo'), {});
  assert.deepEqual(picksOf(members, null), {});
});

test('a provider is ready on a machine the viewer may use, set up but unsigned is a sign-in, else connect', () => {
  const beat = new Date().toISOString();
  const machines = [
    { id: 'm1', owner_user_id: 'u-ana', runtimes: '["claude-code"]', last_seen_at: beat },
    { id: 'm2', owner_user_id: 'u-sam', runtimes: '["codex"]', last_seen_at: beat },
    { id: 'm3', owner_user_id: 'u-max', runtimes: '["gemini"]', last_seen_at: beat },
  ];
  const members = [{ user_id: 'u-sam', compute: JSON.stringify({ shares: ['u-ana'] }) }, { user_id: 'u-max', compute: JSON.stringify({ shares: [] }) }];
  assert.deepEqual(providerStates(machines, members, 'u-ana', new Set(['gemini'])), { anthropic: 'ready', openai: 'ready', gemini: 'signin' });
  assert.deepEqual(providerStates(machines, members, 'u-max', new Set()), { anthropic: 'connect', openai: 'connect', gemini: 'ready' });
  assert.deepEqual(providerStates([{ id: 'm9', owner_user_id: 'u-ana', runtimes: 'not json' }], [], 'u-ana', new Set()), { anthropic: 'connect', openai: 'connect', gemini: 'connect' });
  // a laptop counts only while it beats; a cloud machine counts asleep, because a message wakes it
  const now = Date.parse('2026-10-02T12:00:00Z');
  const week = new Date(now - 7 * 86_400_000).toISOString();
  const fresh = new Date(now - 5_000).toISOString();
  const box = (kind: string, seen: string) => [{ id: 'mx', owner_user_id: 'u-ana', runtimes: '["claude-code"]', kind, last_seen_at: seen }];
  assert.equal(providerStates(box('local', week), [], 'u-ana', new Set(['anthropic']), now).anthropic, 'signin');
  assert.equal(providerStates(box('local', fresh), [], 'u-ana', new Set(), now).anthropic, 'ready');
  assert.equal(providerStates(box('runner', week), [], 'u-ana', new Set(), now).anthropic, 'ready');
});

test('the default answerer: a conversation\'s coordinator, a task\'s state rule, or nobody', () => {
  const room = [rex, iris];
  assert.equal(defaultAnswerer(room)?.id, 'a-rex');
  assert.equal(defaultAnswerer(room, { state: 'plan_review' })?.id, 'a-rex');
  assert.equal(defaultAnswerer(room, { state: 'designing', assigneeKind: 'agent', assigneeId: 'a-iris' })?.id, 'a-iris');
  assert.equal(defaultAnswerer(room, { state: 'in_review', kind: 'build' }), null);
  assert.equal(defaultAnswerer([iris]), null);
  // an old chat-mode thread keeps the last agent who spoke, the daemon's rule
  const said = [{ author_kind: 'agent', author_id: 'a-rex' }, { author_kind: 'agent', author_id: 'a-iris' }, { author_kind: 'human', author_id: 'u' }];
  assert.equal(defaultAnswerer(room, null, { mode: 'chat', messages: said })?.id, 'a-iris');
  assert.equal(defaultAnswerer(room, null, { mode: 'tasks', messages: said })?.id, 'a-rex');
});

test('Send names a picked agent once, and never the one who answers anyway', () => {
  assert.equal(addressTo('Sketch it.', 'iris', 'rex'), '@iris Sketch it.');
  assert.equal(addressTo('Sketch it.', 'rex', 'rex'), 'Sketch it.');
  assert.equal(addressTo('Sketch it.', null, 'rex'), 'Sketch it.');
  assert.equal(addressTo('@iris sketch it.', 'iris', 'rex'), '@iris sketch it.');
  assert.equal(addressTo('iris, sketch it.', 'iris', 'rex'), 'iris, sketch it.');
});

test('a pick clears the conversation\'s override for that role, and only that role', () => {
  assert.deepEqual(withoutRole(JSON.stringify({ orchestrator: STARTER_MODEL, designer: 'claude-opus-5' }), 'orchestrator'), { designer: 'claude-opus-5' });
  assert.equal(withoutRole({ orchestrator: STARTER_MODEL }, 'orchestrator'), null);
  assert.equal(withoutRole({ designer: 'claude-opus-5' }, 'orchestrator'), undefined);
  assert.equal(withoutRole(null, 'orchestrator'), undefined);
});

test('the chip\'s name and mark', () => {
  assert.equal(chipLabel('NeuraMesh brain (Starter v1)'), 'NeuraMesh brain');
  assert.equal(chipLabel('Claude Sonnet 5'), 'Claude Sonnet 5');
  assert.equal(markOf(STARTER_MODEL), 'neuramesh');
  assert.equal(markOf('claude-opus-4-8'), 'anthropic'); // retired, still its vendor's
  assert.equal(markOf('gemini-2.5-pro'), 'gemini');
  assert.equal(markOf('gpt-5.6-terra'), 'openai');
  assert.equal(markOf('mystery-model'), 'neuramesh');
});
