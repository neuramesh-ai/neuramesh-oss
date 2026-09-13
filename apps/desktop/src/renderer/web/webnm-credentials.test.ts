// The tab minted its sync credential from a SNAPSHOT of the Clerk session id while authenticating
// everything else from the live client, so a session that changed under a long-lived tab left it
// looking signed in with sync quietly dead — and retrying ten times a minute, forever (George,
// 2026-09-05, from the production API logs).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mintSyncToken, type MintDeps } from './webnm-credentials';

const ok = (token: string) => new Response(JSON.stringify({ token }), { status: 200 });
const dead = () => new Response(JSON.stringify({ error: 'expired', code: 'SESSION_EXPIRED' }), { status: 401 });
const wobble = () => new Response(JSON.stringify({ code: 'AUTH_UNAVAILABLE' }), { status: 503 });

/** a mint harness: records what was posted, and what the policy decided about the session */
function harness(over: Partial<MintDeps> & { replies: Response[] }) {
  const posted: string[] = [];
  const remembered: string[] = [];
  let deadCalls = 0;
  const replies = [...over.replies];
  const deps: MintDeps = {
    apiUrl: 'https://api.test',
    liveSessionId: async () => null,
    storedSessionId: async () => null,
    remember: (s) => remembered.push(s),
    onSessionDead: () => { deadCalls++; },
    fetch: (async (_url: string, init?: RequestInit) => {
      posted.push(JSON.parse(String(init?.body ?? '{}')).sessionId);
      return replies.shift() ?? dead();
    }) as unknown as typeof fetch,
    ...over,
  };
  return { deps, posted, remembered, dead: () => deadCalls };
}

describe('which session the browser mints from', () => {
  test('the LIVE clerk session wins over the stored snapshot', async () => {
    // the whole bug in one case: the snapshot names a session Clerk has already replaced
    const h = harness({ liveSessionId: async () => 'sess_live', storedSessionId: async () => 'sess_stale', replies: [ok('jwt')] });
    assert.equal(await mintSyncToken(h.deps), 'jwt');
    assert.deepEqual(h.posted, ['sess_live'], 'the stale id must never reach the server');
    assert.deepEqual(h.remembered, ['sess_live'], 'and the snapshot is corrected for the next boot');
    assert.equal(h.dead(), 0);
  });

  test('with no clerk client to ask, the stored id is still used — that is the harness lane', async () => {
    const h = harness({ liveSessionId: async () => null, storedSessionId: async () => 'sess_stored', replies: [ok('jwt')] });
    assert.equal(await mintSyncToken(h.deps), 'jwt');
    assert.deepEqual(h.posted, ['sess_stored']);
    assert.deepEqual(h.remembered, [], 'nothing to correct — it is already what is stored');
  });
});

describe('what a rejection means', () => {
  test('a verified-dead session lands on sign-in instead of retrying a corpse', async () => {
    const h = harness({ liveSessionId: async () => 'sess_live', storedSessionId: async () => 'sess_live', replies: [dead()] });
    await assert.rejects(() => mintSyncToken(h.deps), /expired or revoked/);
    assert.equal(h.dead(), 1);
    assert.equal(h.posted.length, 1, 'no point asking twice about the same live id');
  });

  test('a 401 on a stale id retries once with the live one, and never signs anyone out', async () => {
    // clerk-js re-established the session after this page booted: the right answer is the new id,
    // not the login screen
    const h = harness({ liveSessionId: async () => 'sess_new', storedSessionId: async () => 'sess_old', replies: [dead(), ok('jwt')] });
    let calls = 0;
    h.deps.liveSessionId = async () => (calls++ === 0 ? 'sess_old' : 'sess_new');
    assert.equal(await mintSyncToken(h.deps), 'jwt');
    assert.deepEqual(h.posted, ['sess_old', 'sess_new']);
    assert.deepEqual(h.remembered, ['sess_new']);
    assert.equal(h.dead(), 0, 'the session was alive all along — signing out would have been the bug');
  });

  test('a transient failure retries forever and NEVER signs anyone out', async () => {
    // the server returns 503 precisely because it could not confirm the session is dead —
    // a Clerk outage must not log the workspace out
    const h = harness({ liveSessionId: async () => 'sess_live', storedSessionId: async () => 'sess_live', replies: [wobble()] });
    await assert.rejects(() => mintSyncToken(h.deps), /mint failed: 503/);
    assert.equal(h.dead(), 0);
  });

  test('signed out with no session anywhere throws for the SDK to back off, posts nothing, and never declares a session dead', async () => {
    // declaring it dead reloaded the page, and a visitor with no Clerk cookie reloaded forever
    // (hq.neuramesh.app blinking, George, 2026-09-12): there is no session to be dead
    const h = harness({ replies: [] });
    await assert.rejects(() => mintSyncToken(h.deps), /sign in first/);
    assert.equal(h.dead(), 0, 'signed out is not a dead session');
    assert.deepEqual(h.posted, []);
  });

  test('a 200 with no token in it is a failure, not a silent empty credential', async () => {
    const h = harness({
      liveSessionId: async () => 'sess_live', storedSessionId: async () => 'sess_live',
      replies: [new Response('{}', { status: 200 })],
    });
    await assert.rejects(() => mintSyncToken(h.deps), /no token/);
    assert.equal(h.dead(), 0, 'a malformed reply is not evidence the session died');
  });
});
