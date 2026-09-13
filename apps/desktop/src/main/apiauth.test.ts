// WHAT THE DESKTOP SENDS TO PROVE WHO IT IS.
//
// The bug being closed is not subtle: every /v1 call authenticated with a bare `x-nm-actor`
// header, which control-api accepted WITHOUT VERIFYING ANYTHING. Any caller could assert any
// identity. These tests pin that a clerk-mode call now carries a real bearer, that the actor
// header has been demoted from credential to authorship, and that a mint failure degrades
// honestly rather than silently going back to pretending.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AUTH_MODE, apiAuthHeaders, apiBearerHeader, authHeadersFor } from './apiauth';

const TOKEN = 'header.payload.signature';
const ACTOR = { kind: 'human', id: 'u-me' } as const;
const AGENT = { kind: 'agent', id: 'a-rex' } as const;

describe('the headers themselves', () => {
  test('a token becomes a bearer; no token means no authorization header at all', () => {
    assert.equal(authHeadersFor(ACTOR, TOKEN)['authorization'], `Bearer ${TOKEN}`);
    // NOT an empty or placeholder bearer: the middleware refuses a bad one outright rather than
    // falling back, so a malformed token is worse than none
    assert.equal(authHeadersFor(ACTOR, null)['authorization'], undefined);
  });

  test('the actor header survives as AUTHORSHIP, and carries the agent it names', () => {
    // the daemon posts rows written by an agent, not by the signed-in human. the bearer says who
    // is calling; this says who wrote it — which is all it was ever entitled to say.
    assert.deepEqual(JSON.parse(authHeadersFor(AGENT, TOKEN)['x-nm-actor'] ?? '{}'), AGENT);
    assert.deepEqual(JSON.parse(authHeadersFor(ACTOR, TOKEN)['x-nm-actor'] ?? '{}'), ACTOR);
  });

  test('every call is still JSON — the content type is not lost to the auth rewrite', () => {
    assert.equal(authHeadersFor(ACTOR, TOKEN)['content-type'], 'application/json');
    assert.equal(authHeadersFor(ACTOR, null)['content-type'], 'application/json');
  });
});

describe('minting, and what happens when it fails', () => {
  test('clerk mode sends a VERIFIED bearer, not just a claim about itself', async () => {
    const h = await apiAuthHeaders('https://api.test', ACTOR, async () => TOKEN);
    assert.equal(h['authorization'], `Bearer ${TOKEN}`);
  });

  test('the mint is asked for THIS api url, not a baked-in one', async () => {
    const seen: string[] = [];
    await apiAuthHeaders('https://api.test', ACTOR, async (u) => { seen.push(u); return TOKEN; });
    assert.deepEqual(seen, ['https://api.test']);
  });

  test('a mint failure sends NO bearer rather than a broken one', async () => {
    // a transient Clerk or control-api blip must not become a hard 401 on every call: send what
    // we have, and let the server decide whether the header alone is still acceptable
    const h = await apiAuthHeaders('https://api.test', ACTOR, async () => { throw new Error('clerk down'); });
    assert.equal(h['authorization'], undefined);
    assert.ok(h['x-nm-actor'], 'the call still identifies itself');
  });
});

describe('a cloud machine signs with the token it was given', () => {
  // A daemon on a cloud machine has no Clerk session and never will. Before this the mint was
  // attempted, threw, and the catch above sent NO bearer — a flat 401 on every owner-lane call
  // against a production gate with the header lane closed: the memory block refresh looped every
  // 5s, the image credential looked absent, and a draft asked to draw could not even be told why
  // (George, 2026-09-05).
  const withToken = async <T>(token: string | undefined, run: () => Promise<T>): Promise<T> => {
    const had = process.env['NM_MACHINE_TOKEN'];
    if (token === undefined) delete process.env['NM_MACHINE_TOKEN'];
    else process.env['NM_MACHINE_TOKEN'] = token;
    try { return await run(); } finally {
      if (had === undefined) delete process.env['NM_MACHINE_TOKEN'];
      else process.env['NM_MACHINE_TOKEN'] = had;
    }
  };

  test('the machine token becomes the bearer, and the mint is never asked', async () => {
    await withToken('nmm_secret', async () => {
      let minted = 0;
      const h = await apiAuthHeaders('https://api.test', AGENT, async () => { minted++; return TOKEN; });
      assert.equal(h['authorization'], 'Bearer nmm_secret');
      assert.equal(minted, 0, 'there is no Clerk session on a machine to mint from');
    });
  });

  test('the actor header still rides along — the server checks it against the machine', async () => {
    // resolveMachineActor: an agent must live in this machine's workspace, a human actor must be
    // the owner. The header is what it verifies, so dropping it would break authorship.
    await withToken('nmm_secret', async () => {
      const h = await apiAuthHeaders('https://api.test', AGENT, async () => TOKEN);
      assert.deepEqual(JSON.parse(h['x-nm-actor'] ?? '{}'), AGENT);
    });
  });

  test('a bare bearer for the uploader carries the machine token too', async () => {
    await withToken('nmm_secret', async () => {
      assert.deepEqual(await apiBearerHeader('https://api.test', async () => TOKEN), { authorization: 'Bearer nmm_secret' });
    });
  });

  test('only a real machine token counts — a stray value never becomes a credential', async () => {
    await withToken('not-a-machine-token', async () => {
      const h = await apiAuthHeaders('https://api.test', ACTOR, async () => TOKEN);
      assert.notEqual(h['authorization'], 'Bearer not-a-machine-token');
    });
  });

  test('a desktop (no machine token) is untouched — it still mints its Clerk bearer', async () => {
    await withToken(undefined, async () => {
      const h = await apiAuthHeaders('https://api.test', ACTOR, async () => TOKEN);
      assert.equal(h['authorization'], AUTH_MODE === 'clerk' ? `Bearer ${TOKEN}` : undefined);
    });
  });
});

describe('the auth mode', () => {
  test('defaults to clerk — production is the default, never a fallback', () => {
    // NM_AUTH is unset in a packaged build, and the mode that unset resolves to is the one that
    // sends a real credential. a default of 'dev' would ship the unverified lane to users.
    assert.equal(AUTH_MODE, process.env['NM_AUTH'] === 'dev' ? 'dev' : process.env['NM_AUTH'] === 'supabase' ? 'supabase' : 'clerk');
    assert.ok(['clerk', 'dev', 'supabase'].includes(AUTH_MODE));
  });

  test('a non-clerk stack never mints — it has no Clerk session to mint from', async () => {
    // asserted through the real mode: in clerk mode the mint runs, otherwise it must not be
    // touched at all. either way the call must never invent a bearer it did not obtain.
    let minted = 0;
    const h = await apiAuthHeaders('https://api.test', ACTOR, async () => { minted++; return TOKEN; });
    if (AUTH_MODE === 'clerk') {
      assert.equal(minted, 1);
      assert.equal(h['authorization'], `Bearer ${TOKEN}`);
    } else {
      assert.equal(minted, 0, `${AUTH_MODE} must not request a token`);
      assert.equal(h['authorization'], undefined);
    }
  });
});
