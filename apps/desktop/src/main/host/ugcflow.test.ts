// The UGC playbook's two turns (host/ugcflow.ts): the angle card, the platforms it carries and
// reads back, and the gates that make the order a fact.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuestions } from '@neuramesh/shared';
import { angleAnswer, angleCard, angleGate, connectedPlatforms, draftSeconds, pickedLength, pickedPlatforms, unpicked, videoLengths } from './ugcflow';
import { newGrounding } from './grounding';

const ANGLES = { product: 'Flowe AI', angles: [{ title: 'The 2am spiral', why: 'the weekly plan from a founder\'s notes' }, { title: 'Before and after', why: 'one place instead of 14 tabs' }] };

function fakeDb(o: { kind?: string; docs?: Array<{ name: string; inline_content: string | null }>; conns?: Array<{ provider: string; handle: string | null }>; msgs?: Array<{ author_kind: string; body: string | null }> }) {
  return { getAll: async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
    if (sql.includes('from channels c')) return [{ kind: o.kind ?? 'marketing', marketing: null, website: 'https://flowe.ai', logo: null }] as T[];
    if (sql.includes('from artifacts')) return (o.docs ?? []).map((d) => ({ kind: 'doc', ...d })) as T[]; // a real row always has a kind
    if (sql.includes('from connectors')) return (o.conns ?? []) as T[];
    if (sql.includes('from messages')) return (o.msgs ?? []) as T[];
    return [];
  } };
}

test('the angle card: the angles as options, "type your own", and every platform with the connected ones marked', () => {
  const body = angleCard(ANGLES, ['x', 'linkedin']);
  assert.match(body, /^```nmq\n[\s\S]*\n```$/);
  const q = parseQuestions(body)[0]!; // the shared parser the renderer, the push fan-out and the phone all use
  assert.equal(q.question, 'Which angle should the UGC scripts take for Flowe AI?');
  assert.deepEqual(q.options?.map((o) => o.label), ['The 2am spiral', 'Before and after']);
  assert.equal(q.allowOther, true);
  const ugc = (q as unknown as { ugc: { platforms: Array<{ id: string; connected: boolean }> } }).ugc;
  assert.deepEqual(ugc.platforms.map((p) => `${p.id}${p.connected ? '*' : ''}`), ['x*', 'linkedin*', 'instagram', 'tiktok']);
});

test('the pick reads back its platforms, and only known ones', () => {
  assert.deepEqual(pickedPlatforms('**Which angle…** → The 2am spiral · platforms: x, linkedin'), ['x', 'linkedin']);
  assert.deepEqual(pickedPlatforms('Before and after · platforms: none picked'), []);
  assert.deepEqual(pickedPlatforms('Before and after · platforms: x, myspace'), ['x']);
  assert.deepEqual(pickedPlatforms('just an angle typed by hand'), []);
  // the length rides after the platforms (video-rung plan §8) and neither reader trips on the other
  assert.deepEqual(pickedPlatforms('The 2am spiral · platforms: x, linkedin · length: 15 s'), ['x', 'linkedin']);
  assert.equal(pickedLength('**Which angle…** → The 2am spiral · platforms: x, linkedin · length: 15 s'), 15);
  assert.equal(pickedLength('The 2am spiral · platforms: x'), null);
  assert.equal(pickedLength(null), null);
});

test('the length row: the lengths the door serves, priced; no row for one length or an unserved lane', async () => {
  const served = async () => ({ served: true, tier: 'starter', tiers: [{ tier: 'starter', lengths: [5, 8, 10, 15], perSecondMicros: 241_900 }, { tier: 'premium', lengths: [5, 8, 10, 15, 20, 30], perSecondMicros: 473_000 }] });
  const lengths = await videoLengths(served, { kind: 'agent', id: 'a' }, 'w');
  assert.deepEqual(lengths, [{ seconds: 5, credits: 121 }, { seconds: 8, credits: 194 }, { seconds: 10, credits: 242 }, { seconds: 15, credits: 363 }]);
  assert.deepEqual(await videoLengths(async () => ({ served: false, tier: null, tiers: [] }), { kind: 'agent', id: 'a' }, 'w'), []);
  // the daemon's apiGet answers a Response (found live: the first card read "lengths default" off an unread body)
  const asResponse = async () => new Response(JSON.stringify(await served()), { status: 200, headers: { 'content-type': 'application/json' } });
  assert.deepEqual((await videoLengths(asResponse, { kind: 'agent', id: 'a' }, 'w')).map((l) => l.seconds), [5, 8, 10, 15]);
  assert.deepEqual(await videoLengths(async () => new Response('nope', { status: 403 }), { kind: 'agent', id: 'a' }, 'w'), []);
  assert.deepEqual(await videoLengths(async () => { throw new Error('down'); }, { kind: 'agent', id: 'a' }, 'w'), []);
  const q = parseQuestions(angleCard(ANGLES, ['x'], lengths))[0] as unknown as { ugc: { lengths?: unknown } };
  assert.deepEqual(q.ugc.lengths, lengths);
  assert.equal((parseQuestions(angleCard(ANGLES, ['x'], [{ seconds: 8, credits: 194 }]))[0] as unknown as { ugc: { lengths?: unknown } }).ugc.lengths, undefined);
  assert.equal((parseQuestions(angleCard(ANGLES, ['x']))[0] as unknown as { ugc: { lengths?: unknown } }).ugc.lengths, undefined);
});

test('a video draft waits for the card, then for the pick, then goes', async () => {
  const card = { author_kind: 'agent', body: angleCard(ANGLES, ['x']) };
  assert.match((await unpicked(fakeDb({ msgs: [{ author_kind: 'human', body: 'Run the ugc scripts playbook.' }] }), { threadId: 't' })) ?? '', /propose_angles/);
  assert.match((await unpicked(fakeDb({ msgs: [{ author_kind: 'human', body: 'run it' }, card] }), { threadId: 't' })) ?? '', /has not picked yet/);
  assert.equal(await unpicked(fakeDb({ msgs: [{ author_kind: 'human', body: 'run it' }, card, { author_kind: 'human', body: '**Which angle…** → The 2am spiral · platforms: x' }] }), { threadId: 't' }), null);
  // a later card without a later pick asks again: the pick answers the CARD above it, not one below
  assert.match((await unpicked(fakeDb({ msgs: [card, { author_kind: 'human', body: 'pick' }, card] }), { threadId: 't' })) ?? '', /has not picked yet/);
  // a task thread reads by the task
  assert.equal(await unpicked(fakeDb({ msgs: [card, { author_kind: 'human', body: 'pick' }] }), { taskId: 'task-1' }), null);
  // the answer is the human's first message after the last card, so the picked length is read by code
  assert.equal(await angleAnswer(fakeDb({ msgs: [card, { author_kind: 'human', body: 'The 2am spiral · platforms: x · length: 15 s' }, { author_kind: 'human', body: 'thanks' }] }), { threadId: 't' }), 'The 2am spiral · platforms: x · length: 15 s');
  assert.equal(await angleAnswer(fakeDb({ msgs: [{ author_kind: 'human', body: 'run it' }] }), { threadId: 't' }), null);
  // every video draft carries the pick; the tool's own number (the human's word in prose) wins; a text post carries none
  const picked = fakeDb({ msgs: [card, { author_kind: 'human', body: 'The 2am spiral · platforms: x · length: 15 s' }] });
  assert.deepEqual(await draftSeconds(picked, { threadId: 't' }, [{ script: 'a' }, { script: 'b', seconds: 10 }, { }]), [15, 10, undefined]);
  assert.deepEqual(await draftSeconds(fakeDb({ msgs: [] }), { threadId: 't' }, [{ script: 'a' }]), [undefined]);
});

test('propose_angles is refused before the research, and with a choice of one', async () => {
  const db = fakeDb({ docs: [{ name: 'business-profile.md', inline_content: '# Flowe' }], conns: [{ provider: 'x', handle: '@joinflowe' }, { provider: 'posthog', handle: null }] });
  const g = newGrounding();
  assert.match((await angleGate(db, 'ch', g, ANGLES)) ?? '', /^Research first: /);
  g.read.add('business-profile.md');
  assert.match((await angleGate(db, 'ch', g, { ...ANGLES, angles: ANGLES.angles.slice(0, 1) })) ?? '', /two to five angles/);
  assert.equal(await angleGate(db, 'ch', g, ANGLES), null);
  assert.deepEqual(await connectedPlatforms(db, 'ch'), ['x']);
});
