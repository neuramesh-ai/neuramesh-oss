// The image floor's pure contract (docs/design/calendar-image-gen-2026-08).
// Run from apps/desktop: pnpm exec tsx --test src/main/draftbrief.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRIEF_SYSTEM, REWRITE_SYSTEM, briefAsk, parseRewrite, rewriteAsk } from './host/draftbrief';
import { textComplete, type ImageCred } from './imagegen';

const BRAND = { palette: ['#f5d64a', '#1a1a1a'], fonts: ['Geist'], product: 'flowe' };

test('the brief ask carries the post, the platform, and the brand — and only asks for a subject', () => {
  const ask = briefAsk('Tired but wired. flowe fixes the gap.', 'x', BRAND);
  assert.match(ask, /The x post:/);
  assert.match(ask, /Tired but wired/);
  assert.match(ask, /product: flowe/);
  assert.match(ask, /#f5d64a/);
  // the system prompt owns the rules — no text-in-image, one line
  assert.match(BRIEF_SYSTEM, /Never ask for words, logos/);
  assert.match(BRIEF_SYSTEM, /under 220 characters/);
});

test('the rewrite ask forwards the human’s angle verbatim, or asks for a fresh one', () => {
  assert.match(rewriteAsk('old post', 'x', BRAND, 'make it about the 2am spiral'), /Rewrite it from this angle: make it about the 2am spiral/);
  assert.match(rewriteAsk('old post', 'x', BRAND), /noticeably different creative angle/);
  assert.match(REWRITE_SYSTEM, /STRICT JSON/);
  assert.match(REWRITE_SYSTEM, /under 270 characters/);
});

test('parseRewrite: fenced, bare, and prefixed JSON all land; garbage and half-answers refuse', () => {
  const want = { body: 'new post', brief: 'a calm desk at dusk' };
  assert.deepEqual(parseRewrite('```json\n{"body":"new post","brief":"a calm desk at dusk"}\n```'), want);
  assert.deepEqual(parseRewrite('{"body":"new post","brief":"a calm desk at dusk"}'), want);
  assert.deepEqual(parseRewrite('Sure! Here it is: {"body":"new post","brief":"a calm desk at dusk"} — enjoy'), want);
  assert.equal(parseRewrite('not json at all'), null);
  assert.equal(parseRewrite('{"body":"only half"}'), null);
  assert.equal(parseRewrite('{"body":"","brief":"x"}'), null);
});

test('textComplete speaks each provider’s own wire shape and returns the text', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fakeFor = (reply: unknown) => (async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true, json: async () => reply } as unknown as Response;
  }) as unknown as typeof fetch;

  const oa = await textComplete({ provider: 'openai', key: 'k' } as ImageCred, 'gpt-x', 'sys', 'user words',
    fakeFor({ choices: [{ message: { content: 'a brief' } }] }));
  assert.equal(oa, 'a brief');
  assert.match(calls[0]!.url, /api\.openai\.com\/v1\/chat\/completions/);
  const oaBody = calls[0]!.body as { model: string; messages: Array<{ role: string; content: string }> };
  assert.equal(oaBody.model, 'gpt-x');
  assert.deepEqual(oaBody.messages.map((m) => m.role), ['system', 'user']);

  const gm = await textComplete({ provider: 'gemini', key: 'k' } as ImageCred, 'gemini-x', 'sys', 'user words',
    fakeFor({ candidates: [{ content: { parts: [{ text: 'gem brief' }] } }] }));
  assert.equal(gm, 'gem brief');
  assert.match(calls[1]!.url, /generativelanguage\.googleapis\.com/);
  const gmBody = calls[1]!.body as { systemInstruction: { parts: Array<{ text: string }> } };
  assert.equal(gmBody.systemInstruction.parts[0]!.text, 'sys');
});

test('textComplete throws on a non-2xx — the button surfaces it, never a silent empty brief', async () => {
  const fake = (async () => ({ ok: false, status: 429 }) as unknown as Response) as unknown as typeof fetch;
  await assert.rejects(
    () => textComplete({ provider: 'openai', key: 'k' } as ImageCred, 'm', 's', 'u', fake),
    /completion failed 429/,
  );
});
