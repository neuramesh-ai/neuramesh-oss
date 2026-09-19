// The film lane (videogen.ts): the script's first beat, the prompt Veo films, the client against
// a faked Gemini API, and the draft lane's three outcomes (no key, refused, filmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filmPrompt, firstBeat, makeFilm, veoFilm } from './videogen';

const SCRIPT = `[0:00-0:03] HOOK — handheld, walking, no laptop bag
Spoken: "My laptop's in my bag. My code isn't waiting for me."
CAPTION ON SCREEN: no laptop, still shipping

[0:03-0:15] Open the app to Home.
Spoken: "This is Home."
CAPTION: queue + sessions, synced`;

test('the first beat is the hook block: direction, the spoken line, the caption', () => {
  assert.deepEqual(firstBeat(SCRIPT), { direction: 'handheld, walking, no laptop bag', spoken: "My laptop's in my bag. My code isn't waiting for me.", caption: 'no laptop, still shipping' });
  // a body without timestamps: its first lines
  assert.deepEqual(firstBeat('Meet the shared inbox.\nSpoken: "One thread per customer."'), { direction: 'Meet the shared inbox.', spoken: 'One thread per customer.', caption: '' });
  // a script written as the creator's bare quoted lines (plume, live, 2026-09-19): the first line is spoken
  assert.deepEqual(firstBeat('"I started a coding session from my couch. No laptop opened."\n"This is Home. My queue and every session, one list."'), { direction: '', spoken: 'I started a coding session from my couch. No laptop opened.', caption: '' });
});

test('the prompt is a vertical phone clip of the hook, with the caption and the brief, under the cap', () => {
  const p = filmPrompt(SCRIPT, '9:16 vertical. Real screen recording cut with handheld shots.');
  assert.match(p, /9:16/);
  assert.match(p, /Opening shot: handheld, walking, no laptop bag\./);
  assert.match(p, /The creator says to camera, casually: "My laptop's in my bag/);
  assert.match(p, /Leave the bottom third of the frame clear for a caption\. Render no text/);
  assert.doesNotMatch(p, /no laptop, still shipping/); // the caption is never asked of the model (it misspells)
  assert.match(p, /Visual direction: 9:16 vertical\. Real screen recording/);
  assert.ok(p.length <= 1_400);
});

const MP4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 1, 2, 3, 4]);
/** Gemini's video API, faked. Omni (the Interactions API) answers in one call unless `omniMissing`
 *  sends the key down to Veo, where the operation starts, polls twice, then hands a download link. */
function fakeGemini(opts: { omniMissing?: boolean; firstRungMissing?: boolean; refuse?: boolean; omniUri?: boolean } = {}) {
  const calls: string[] = [];
  let polls = 0;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url.replace('https://generativelanguage.googleapis.com/v1beta/', '')}`);
    if (url.endsWith('/interactions')) {
      if (opts.omniMissing) return json({ error: { message: 'model gemini-omni-1.1-flash is not found for API version v1beta' } }, 404);
      const body = JSON.parse(String(init?.body)) as { model: string; input: string; response_format: { type: string; aspect_ratio: string; resolution: string }; background: boolean };
      assert.equal(body.model, 'gemini-omni-1.1-flash');
      assert.deepEqual(body.response_format, { type: 'video', aspect_ratio: '9:16', resolution: '720p' });
      assert.equal(body.background, false);
      if (opts.refuse) return json({ id: 'v1_1', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'I cannot make this video.' }] }] });
      const part = opts.omniUri ? { type: 'video', mime_type: 'video/mp4', uri: 'https://generativelanguage.googleapis.com/v1beta/files/f1:download?alt=media' } : { type: 'video', mime_type: 'video/mp4', data: MP4.toString('base64') };
      // the LIVE shape (2026-09-19): `steps`, a thought first, then the model_output; the docs say `outputs`
      const body2 = opts.omniUri ? { outputs: [{ type: 'model_output', content: [part] }] } : { steps: [{ type: 'thought', signature: 'x' }, { type: 'model_output', content: [part] }] };
      return json({ id: 'v1_1', status: 'completed', model: 'gemini-omni-1.1-flash', ...body2 });
    }
    if (url.includes(':predictLongRunning')) {
      if (opts.firstRungMissing && url.includes('veo-3.1-fast')) return json({ error: { message: 'model not found' } }, 404);
      const body = JSON.parse(String(init?.body)) as { parameters: { aspectRatio: string; durationSeconds: number } };
      assert.equal(body.parameters.aspectRatio, '9:16');
      assert.equal(body.parameters.durationSeconds, 8);
      return json({ name: 'models/veo/operations/op-1' });
    }
    if (url.endsWith('/operations/op-1')) {
      polls += 1;
      if (polls < 2) return json({ done: false });
      if (opts.refuse) return json({ done: true, response: { generateVideoResponse: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ['a real person was named'] } } });
      return json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/f1:download?alt=media' } }] } } });
    }
    if (url.includes('files/f1:download')) return new Response(new Uint8Array(MP4), { status: 200, headers: { 'content-type': 'video/mp4' } });
    return json({ error: { message: 'unexpected call' } }, 500);
  };
  return { fetchFn, calls };
}
const quick = { sleep: async () => {}, now: () => 0 };

test('the first rung is Gemini Omni Flash: one Interactions call, the clip inline, the model named', async () => {
  const g = fakeGemini();
  const r = await veoFilm('key', 'a clip', { fetchFn: g.fetchFn, ...quick });
  assert.equal(r.error, undefined);
  assert.equal(r.mime, 'video/mp4');
  assert.equal(r.model, 'gemini-omni-1.1-flash');
  assert.equal(r.bytes!.length, MP4.length);
  assert.deepEqual(g.calls, ['POST interactions']);
  // a clip delivered at a URI downloads with the key
  const u = fakeGemini({ omniUri: true });
  const ru = await veoFilm('key', 'a clip', { fetchFn: u.fetchFn, ...quick });
  assert.equal(ru.bytes!.length, MP4.length);
  assert.deepEqual(u.calls, ['POST interactions', 'GET files/f1:download?alt=media']);
});

test('a key that cannot see Omni falls to Veo: the operation starts, polls until done, downloads the clip', async () => {
  const g = fakeGemini({ omniMissing: true });
  const r = await veoFilm('key', 'a clip', { fetchFn: g.fetchFn, ...quick });
  assert.equal(r.error, undefined);
  assert.equal(r.model, 'veo-3.1-fast-generate-preview');
  assert.equal(r.bytes!.length, MP4.length);
  assert.ok(g.calls[1]!.startsWith('POST models/veo-3.1-fast-generate-preview:predictLongRunning'));
});

test('a key that cannot see the fast Veo rung falls to the next; a refusal on any rung is the answer', async () => {
  const g = fakeGemini({ omniMissing: true, firstRungMissing: true });
  const r = await veoFilm('key', 'a clip', { fetchFn: g.fetchFn, ...quick });
  assert.equal(r.model, 'veo-3.1-generate-preview');
  const refused = await veoFilm('key', 'a clip', { fetchFn: fakeGemini({ omniMissing: true, refuse: true }).fetchFn, ...quick });
  assert.match(refused.error!, /declined the prompt: a real person was named/);
  const omniRefused = await veoFilm('key', 'a clip', { fetchFn: fakeGemini({ refuse: true }).fetchFn, ...quick });
  assert.match(omniRefused.error!, /declined the prompt/);
});

/** the draft lane against a fake db and a fake command post */
function lane(media: string | null, film: Parameters<typeof makeFilm>[0]['film']) {
  const posted: Array<Record<string, unknown>> = [];
  const db = { getAll: async () => [{ body: SCRIPT, media }] } as never;
  const post = async (_path: string, _actor: unknown, body: unknown) => { posted.push(body as Record<string, unknown>); return new Response('{"ok":true}', { status: 200 }); };
  const { filmDraft } = makeFilm({ db, apiUrl: 'http://api', ownerActorId: 'u1', post: post as never, agents: new Map(), film });
  const agent = { id: 'a1', name: 'plume', role: 'marketer', channels: new Set(['c1']) } as never;
  return { posted, run: () => filmDraft(agent, { id: 'c1', slug: 'marketing', workspace_id: 'w1' }, 'item-1') };
}

test('the draft lane: filmed → the bytes attach as video/mp4; refused → the reason lands on the card', async () => {
  process.env['GEMINI_API_KEY'] = 'env-key';
  try {
    const ok = lane(JSON.stringify({ brief: 'handheld' }), async (key, prompt) => { assert.equal(key, 'env-key'); assert.match(prompt, /handheld/); return { bytes: MP4, mime: 'video/mp4', model: 'gemini-omni-1.1-flash' }; });
    const reply = await ok.run();
    assert.match(reply, /Filmed the hook on gemini-omni-1.1-flash\. An eight-second cut/);
    assert.equal(ok.posted[0]!['type'], 'content.attach_media');
    assert.ok(String(ok.posted[0]!['dataUrl']).startsWith('data:video/mp4;base64,'));
    const bad = lane(null, async () => ({ error: 'the model declined the prompt' }));
    assert.match(await bad.run(), /The film did not come: the model declined the prompt\. The reason is on the card/);
    assert.deepEqual(bad.posted[0], { type: 'content.revise', item: 'item-1', videoError: 'the model declined the prompt' });
  } finally { delete process.env['GEMINI_API_KEY']; }
});

test('the draft lane films the SCRIPT beside the caption (media.script), not the caption', async () => {
  process.env['GEMINI_API_KEY'] = 'env-key';
  try {
    const posted: Array<Record<string, unknown>> = [];
    const db = { getAll: async () => [{ body: 'Three things in the new update I did not expect. #neuramesh', media: JSON.stringify({ brief: 'phone in hand', script: SCRIPT }) }] } as never;
    const post = async (_p: string, _a: unknown, body: unknown) => { posted.push(body as Record<string, unknown>); return new Response('{"ok":true}', { status: 200 }); };
    let seen = '';
    const { filmDraft } = makeFilm({ db, apiUrl: 'http://api', ownerActorId: 'u1', post: post as never, agents: new Map(), film: async (_k, prompt) => { seen = prompt; return { bytes: MP4, mime: 'video/mp4', model: 'gemini-omni-1.1-flash' }; } });
    await filmDraft({ id: 'a1', name: 'plume', role: 'marketer', channels: new Set(['c1']) } as never, { id: 'c1', slug: 'marketing', workspace_id: 'w1' }, 'item-1');
    assert.match(seen, /Opening shot: handheld, walking, no laptop bag/);
    assert.doesNotMatch(seen, /Three things in the new update/);
    assert.equal(posted[0]!['type'], 'content.attach_media');
  } finally { delete process.env['GEMINI_API_KEY']; }
});

