import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatGPTSubscriptionFetch, parseChatGPTCredential } from './engineering-chatgpt';

const endpoint = 'https://chatgpt.com/backend-api/codex/responses';
const token = (exp: number) => `fake.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
const auth = (access: unknown, account: unknown = 'account-1') => JSON.stringify({ tokens: { access_token: access, account_id: account } });

test('local subscription parsing rejects absent, expired, malformed and API-key credentials with a safe message', () => {
  for (const raw of ['broken secret', 'null', '{}', '{"OPENAI_API_KEY":"secret"}', auth(''), auth('secret\nvalue'), auth('secret', ''), auth('secret', 'injected\r\nheader'), auth(token(10)), JSON.stringify({ auth_mode: 'apikey', tokens: { access_token: 'secret', account_id: 'a' } })]) {
    assert.throws(() => parseChatGPTCredential(raw, 11_000), error => {
      assert.match(String(error), /Sign in again with Codex/);
      assert.doesNotMatch(String(error), /secret|signature|broken/);
      return true;
    });
  }
  assert.deepEqual(parseChatGPTCredential(auth(token(20)), 11_000), { accessToken: token(20), accountId: 'account-1' });
});

test('subscription transport reads credentials only for the exact POST endpoint and refuses redirects', async () => {
  let reads = 0, calls = 0;
  const transport = createChatGPTSubscriptionFetch(async (_input, init) => {
    calls++;
    assert.equal(init?.redirect, 'error');
    return new Response('ok');
  }, async () => { reads++; return { accessToken: 'fake-secret', accountId: 'account-1' }; });
  for (const url of ['http://chatgpt.com/backend-api/codex/responses', 'https://chatgpt.com.evil.test/backend-api/codex/responses', `${endpoint}?destination=other`, `${endpoint}#fragment`, 'https://api.openai.com/v1/responses', 'https://user@chatgpt.com/backend-api/codex/responses', `${endpoint}/`]) {
    await assert.rejects(transport(url, { method: 'POST' }), /configured OpenAI Responses endpoint/);
  }
  await assert.rejects(transport(endpoint, { method: 'GET' }), /configured OpenAI Responses endpoint/);
  assert.equal(reads, 0);
  assert.equal(calls, 0);
  await transport(endpoint, { method: 'POST' });
  assert.equal(calls, 1);
});

test('credentials rotate in memory between requests, preserving body, cancellation and caller headers', async () => {
  const controller = new AbortController();
  const headers = { authorization: 'Bearer placeholder', 'content-type': 'application/json' };
  let generation = 0;
  const transport = createChatGPTSubscriptionFetch(async (_input, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer fake-${generation}`);
    assert.equal(new Headers(init?.headers).get('ChatGPT-Account-Id'), 'account-1');
    assert.equal(new Headers(init?.headers).get('content-type'), 'application/json');
    assert.equal(init?.body, '{"store":false}');
    assert.equal(init?.signal, controller.signal);
    return new Response('ok');
  }, async () => ({ accessToken: `fake-${++generation}`, accountId: 'account-1' }));
  const init = { method: 'POST', body: '{"store":false}', headers, signal: controller.signal };
  await transport(endpoint, init);
  await transport(endpoint, init);
  assert.equal(generation, 2);
  assert.equal(headers.authorization, 'Bearer placeholder');
  controller.abort();
  await assert.rejects(transport(endpoint, init), { name: 'AbortError' });
  assert.equal(generation, 2);
});

test('Request inputs preserve content and use only the injected local credential', async () => {
  const request = new Request(endpoint, { method: 'POST', body: 'fixture', headers: { 'x-fixture': 'yes' } });
  const transport = createChatGPTSubscriptionFetch(async (input, init) => {
    assert.equal(input, request);
    assert.equal(new Headers(init?.headers).get('x-fixture'), 'yes');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fake-secret');
    assert.equal(await (input as Request).text(), 'fixture');
    return new Response('ok');
  }, async () => ({ accessToken: 'fake-secret', accountId: 'account-1' }));
  await transport(request);
  assert.equal(request.headers.has('authorization'), false);
});

test('an account switch stops the current session without sending a request under a different account', async () => {
  let account = 'one', calls = 0;
  const transport = createChatGPTSubscriptionFetch(async () => { calls++; return new Response('ok'); }, async () => ({ accessToken: 'fake-secret', accountId: account }));
  await transport(endpoint, { method: 'POST' });
  account = 'two';
  await assert.rejects(transport(endpoint, { method: 'POST' }), /account changed/);
  assert.equal(calls, 1);
});

test('authentication refusals discard upstream bodies; network errors cannot leak a request credential', async () => {
  for (const status of [401, 403]) {
    let cancelled = false, calls = 0;
    const transport = createChatGPTSubscriptionFetch(async () => {
      calls++;
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status });
    }, async () => ({ accessToken: 'fake-secret', accountId: 'account-1' }));
    const response = await transport(endpoint, { method: 'POST' });
    assert.equal(response.status, status);
    assert.match(await response.text(), /No API key was used/);
    assert.equal(cancelled, true);
    assert.equal(calls, 1);
  }
  const failed = createChatGPTSubscriptionFetch(async () => { throw new Error('request contains fake-secret'); }, async () => ({ accessToken: 'fake-secret', accountId: 'account-1' }));
  await assert.rejects(failed(endpoint, { method: 'POST' }), error => {
    assert.match(String(error), /Check your connection/);
    assert.doesNotMatch(String(error), /fake-secret/);
    assert.equal((error as Error).cause, undefined);
    return true;
  });
});
