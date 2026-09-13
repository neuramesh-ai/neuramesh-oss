// The Launch step adopts the resumed workspace and never mints a second one beside it.
// Run from apps/desktop:  pnpm exec tsx --test src/main/sync/onboard-target.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onboardTarget } from './onboard-target';

const held = [{ id: 'w1', name: "Dana's workspace", slug: 'dana' }];

test('no resume id: the handler creates, as it always did', () => {
  assert.deepEqual(onboardTarget({}, held), { kind: 'create' });
  assert.deepEqual(onboardTarget({ workspaceId: undefined }, held), { kind: 'create' });
});

test('a resume id the session holds is adopted, with the name and slug the server gave it', () => {
  assert.deepEqual(onboardTarget({ workspaceId: 'w1' }, held), { kind: 'adopt', workspaceId: 'w1', info: { name: "Dana's workspace", slug: 'dana' } });
});

test('a stale resume id, one the session holds no membership for, is not adopted: the handler creates', () => {
  assert.deepEqual(onboardTarget({ workspaceId: 'gone' }, held), { kind: 'create' });
  assert.deepEqual(onboardTarget({ workspaceId: 'w1' }, []), { kind: 'create' });
});
