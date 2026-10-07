// accept_task reads the person's words (host/acceptgate.ts, 2026-10-05): every reply on a done unit wakes
// the orchestrator now, so a question there reaches the turn that holds the merge. the tool merges only on
// an instruction in the person's newest typed message, and a card's click or a marker is no typing.
// Run from apps/desktop: pnpm exec tsx --test src/main/host/acceptgate.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptRefusal, newestTypedWord } from './acceptgate';

/** the replica, newest first, the way the query orders it */
const replica = (bodies: string[]) => ({
  getAll: async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
    assert.match(sql, /author_kind = 'human'/);
    assert.deepEqual(params, ['t-1', 't-1']);
    return bodies.map((body) => ({ body })) as T[];
  },
});
const unit = { id: 't-1', number: 1064 };

test('"merge it" lets the tool through, and so does a polite ask', async () => {
  assert.equal(await acceptRefusal(replica(['merge it']), unit), null);
  assert.equal(await acceptRefusal(replica(['rex, can you merge it?']), unit), null);
});

test('a question, a "not yet" and silence are refused, with what the person wrote', async () => {
  const q = await acceptRefusal(replica(['does this include the mobile fix?', 'merge it']), unit);
  assert.match(q ?? '', /^refused: .*#1064.*"does this include the mobile fix\?"/);
  assert.ok(await acceptRefusal(replica(['wait, do not merge yet']), unit));
  assert.match((await acceptRefusal(replica([]), unit)) ?? '', /they typed nothing there/);
});

test('a card\'s click and a marker are no typing: the word under them counts, and none at all is refused', async () => {
  const card = '**Approve #1064 — Add an annual price toggle?** → Approve #1064';
  assert.equal(await newestTypedWord(replica([card, '‹gen-image:d-1›', 'merge it']), 't-1'), 'merge it');
  assert.equal(await acceptRefusal(replica([card, 'merge it']), unit), null);
  assert.ok(await acceptRefusal(replica([card]), unit));
});

test('a replica that fails reads as no word, never as consent', async () => {
  const broken = { getAll: async (): Promise<never> => { throw new Error('replica closed'); } };
  assert.equal(await newestTypedWord(broken, 't-1'), null);
  assert.ok(await acceptRefusal(broken, unit));
});
