// The UGC playbook's two turns (host/ugcflow.ts): the angle card, the platforms it carries and
// reads back, and the gates that make the order a fact.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuestions } from '@neuramesh/shared';
import { angleCard, angleGate, connectedPlatforms, pickedPlatforms, unpicked } from './ugcflow';
import { newGrounding } from './grounding';

const ANGLES = { product: 'Flowe AI', angles: [{ title: 'The 2am spiral', why: 'the weekly plan from a founder\'s notes' }, { title: 'Before and after', why: 'one place instead of 14 tabs' }] };

function fakeDb(o: { kind?: string; docs?: Array<{ name: string; inline_content: string | null }>; conns?: Array<{ provider: string; handle: string | null }>; msgs?: Array<{ author_kind: string; body: string | null }> }) {
  return { getAll: async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
    if (sql.includes('from channels c')) return [{ kind: o.kind ?? 'marketing', marketing: null, website: 'https://flowe.ai', logo: null }] as T[];
    if (sql.includes('from artifacts')) return (o.docs ?? []) as T[];
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
