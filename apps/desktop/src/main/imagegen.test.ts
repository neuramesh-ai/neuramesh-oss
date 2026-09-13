import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickImageProvider, generateImage, reviewImage } from './imagegen';

const SPEC = { prompt: 'a warm gold lamp in a dark room', size: '1536x1024' };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');

const fakeFetch = (status: number, body: unknown, seen?: { url?: string; init?: RequestInit }): typeof fetch =>
  (async (url: string, init: RequestInit) => {
    if (seen) { seen.url = String(url); seen.init = init; }
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;

test('pickImageProvider: openai wins, gemini backs it up, neither means no generation', () => {
  assert.deepEqual(pickImageProvider({ OPENAI_API_KEY: 'sk-a', GEMINI_API_KEY: 'g' }), { provider: 'openai', key: 'sk-a' });
  assert.deepEqual(pickImageProvider({ CODEX_API_KEY: 'sk-c' }), { provider: 'openai', key: 'sk-c' });
  assert.deepEqual(pickImageProvider({ GEMINI_API_KEY: 'g' }), { provider: 'gemini', key: 'g' });
  assert.deepEqual(pickImageProvider({ GOOGLE_API_KEY: 'g2' }), { provider: 'gemini', key: 'g2' });
  assert.equal(pickImageProvider({}), null);
});

test('generateImage: openai — sends the spec on the newest model, decodes b64 to bytes', async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const r = await generateImage(SPEC, { provider: 'openai', key: 'sk-x' }, fakeFetch(200, { data: [{ b64_json: PNG }] }, seen));
  assert.equal(seen.url, 'https://api.openai.com/v1/images/generations');
  const sent = JSON.parse(String(seen.init?.body)) as { model: string; prompt: string; size: string };
  assert.equal(sent.model, 'gpt-image-2', 'best-first: the current default model');
  assert.equal(r.model, 'gpt-image-2', 'the caller learns which model drew it');
  assert.equal(sent.size, '1536x1024');
  assert.equal(sent.prompt, SPEC.prompt);
  assert.equal(r.image?.mime, 'image/png');
  assert.ok((r.image?.bytes.length ?? 0) > 0);
  assert.equal(r.error, undefined);
});

test('generateImage: gemini — newest model, key in a HEADER, image modality requested', async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const r = await generateImage(SPEC, { provider: 'gemini', key: 'g-key' }, fakeFetch(200, {
    candidates: [{ content: { parts: [{ text: 'here you go' }, { inlineData: { mimeType: 'image/jpeg', data: PNG } }] } }],
  }, seen));
  assert.ok(seen.url?.includes('gemini-3.1-flash-image:generateContent'), `got ${seen.url}`);
  assert.ok(!seen.url?.includes('g-key'), 'the key must never ride the query string');
  assert.equal((seen.init?.headers as Record<string, string>)['x-goog-api-key'], 'g-key');
  const sent = JSON.parse(String(seen.init?.body)) as { generationConfig?: { responseModalities?: string[] } };
  assert.deepEqual(sent.generationConfig?.responseModalities, ['TEXT', 'IMAGE'], 'without this the model answers with TEXT and no image comes back');
  // the fixture DECLARES jpeg but its bytes are a PNG — the sniffed truth wins (2026-08-20:
  // a declared-vs-actual drift is exactly what died at X's finalize as "media type unrecognized")
  assert.equal(r.image?.mime, 'image/png');
});

test('generateImage: an account without the newest model falls to the next rung', async () => {
  const tried: string[] = [];
  const fake = (async (_url: string, init: RequestInit) => {
    const model = (JSON.parse(String(init.body)) as { model: string }).model;
    tried.push(model);
    return model === 'gpt-image-2'
      ? { ok: false, status: 404, json: async () => ({ error: { message: 'The model `gpt-image-2` does not exist or you do not have access to it.' } }) } as Response
      : { ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG }] }) } as Response;
  }) as unknown as typeof fetch;
  const r = await generateImage(SPEC, { provider: 'openai', key: 'sk-x' }, fake);
  assert.deepEqual(tried, ['gpt-image-2', 'gpt-image-1.5']);
  assert.equal(r.model, 'gpt-image-1.5');
  assert.ok(r.image);
});

test('generateImage: a refusal or rate limit is the ANSWER — it never walks the ladder burning money', async () => {
  let calls = 0;
  const refuse = (async () => { calls++; return { ok: false, status: 400, json: async () => ({ error: { message: 'Your request was rejected by the safety system.' } }) } as Response; }) as unknown as typeof fetch;
  const r = await generateImage(SPEC, { provider: 'openai', key: 'sk-x' }, refuse);
  assert.equal(calls, 1);
  assert.match(r.error ?? '', /safety system/);

  calls = 0;
  const limited = (async () => { calls++; return { ok: false, status: 429, json: async () => ({ error: { message: 'rate limit reached' } }) } as Response; }) as unknown as typeof fetch;
  await generateImage(SPEC, { provider: 'gemini', key: 'g' }, limited);
  assert.equal(calls, 1);
});

test("generateImage: a provider error is reported, not thrown — the draft degrades to 'needs image'", async () => {
  const bad = await generateImage(SPEC, { provider: 'openai', key: 'sk-x' }, fakeFetch(429, { error: { message: 'rate limit reached' } }));
  assert.equal(bad.error, 'rate limit reached');
  assert.equal(bad.image, undefined);

  const empty = await generateImage(SPEC, { provider: 'openai', key: 'sk-x' }, fakeFetch(200, { data: [] }));
  assert.equal(empty.error, 'openai returned no image data');

  const blank = await generateImage(SPEC, { provider: 'gemini', key: 'g' }, fakeFetch(200, { candidates: [{ content: { parts: [] } }] }));
  assert.equal(blank.error, 'gemini returned no image data');
});

const IMG = { mime: 'image/png', bytes: Buffer.from('PNG') };
const chat = (text: string): unknown => ({ choices: [{ message: { content: text } }] });

test('reviewImage: a plain OK passes, and the image ships', async () => {
  for (const answer of ['OK', 'ok.', '  OK  ', '"OK"']) {
    const r = await reviewImage({ provider: 'openai', key: 'k' }, 'gpt-5.5', 'a warm lamp', IMG, fakeFetch(200, chat(answer)));
    assert.deepEqual(r, { ok: true }, `expected OK for ${JSON.stringify(answer)}`);
  }
});

test('reviewImage: a real objection comes back as the one fix to make', async () => {
  const r = await reviewImage({ provider: 'openai', key: 'k' }, 'gpt-5.5', 'a warm lamp', IMG, fakeFetch(200, chat('The lettering across the top is garbled.')));
  assert.equal(r.ok, false);
  assert.equal(r.fix, 'The lettering across the top is garbled.');
});

test('reviewImage: gemini — the image rides as inlineData and the verdict is read back', async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const r = await reviewImage({ provider: 'gemini', key: 'g' }, 'gemini-3.5-flash', 'a warm lamp', IMG, fakeFetch(200, {
    candidates: [{ content: { parts: [{ text: 'OK' }] } }],
  }, seen));
  assert.ok(seen.url?.includes('gemini-3.5-flash:generateContent'));
  const sent = JSON.parse(String(seen.init?.body)) as { contents: Array<{ parts: Array<{ inlineData?: { data?: string } }> }> };
  assert.equal(sent.contents[0]!.parts[1]!.inlineData?.data, IMG.bytes.toString('base64'));
  assert.deepEqual(r, { ok: true });
});

test('reviewImage: a BROKEN check never blocks the draft — it passes', async () => {
  assert.deepEqual(await reviewImage({ provider: 'openai', key: 'k' }, 'gpt-5.5', 'a lamp', IMG, fakeFetch(500, {})), { ok: true });
  assert.deepEqual(await reviewImage({ provider: 'openai', key: 'k' }, 'gpt-5.5', 'a lamp', IMG, fakeFetch(200, chat(''))), { ok: true });
  const boom = (async () => { throw new Error('socket hang up'); }) as unknown as typeof fetch;
  assert.deepEqual(await reviewImage({ provider: 'openai', key: 'k' }, 'gpt-5.5', 'a lamp', IMG, boom), { ok: true });
  // no seat to ask, or nothing to check against
  assert.deepEqual(await reviewImage({ provider: 'openai', key: 'k' }, '', 'a lamp', IMG, fakeFetch(200, chat('bad'))), { ok: true });
  assert.deepEqual(await reviewImage({ provider: 'openai', key: 'k' }, 'gpt-5.5', '   ', IMG, fakeFetch(200, chat('bad'))), { ok: true });
});

test('generateImage: a thrown fetch becomes an error string', async () => {
  const boom = (async () => { throw new Error('socket hang up'); }) as unknown as typeof fetch;
  assert.equal((await generateImage(SPEC, { provider: 'openai', key: 'k' }, boom)).error, 'socket hang up');
});
