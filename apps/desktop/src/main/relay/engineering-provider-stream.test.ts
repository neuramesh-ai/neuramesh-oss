import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { engineeringProviderFetch, type EngineeringStreamReceipt } from './engineering-provider-stream';

const encoder = new TextEncoder();
const sse = (body: ReadableStream<Uint8Array>) => new Response(body, { headers: { 'content-type': 'text/event-stream' } });

test('a request that never returns headers is aborted with an actionable timeout, without replay', async () => {
  let calls = 0;
  let signal: AbortSignal | undefined;
  const receipts: EngineeringStreamReceipt[] = [];
  const call = engineeringProviderFetch(async (_input, init) => { calls++; signal = init?.signal ?? undefined; return new Promise(() => {}); }, r => receipts.push(r), 25);
  await assert.rejects(call('https://provider.test'), { name: 'TimeoutError', message: /Retry this turn or choose another model/ });
  assert.equal(signal?.aborted, true);
  assert.equal(calls, 1);
  assert.equal(receipts[0]?.phase, 'headers');
  assert.equal(receipts[0]?.outcome, 'timeout');
});

test('a stream that stalls after reasoning or a partial tool call fails without replaying it', async () => {
  for (const type of ['response.reasoning_summary_text.delta', 'response.function_call_arguments.delta']) {
    const receipts: EngineeringStreamReceipt[] = [];
    let cancelled = false;
    let calls = 0;
    const frame = `data: ${JSON.stringify({ type, delta: 'private output' })}\n\n`;
    const call = engineeringProviderFetch(async () => { calls++; return sse(new ReadableStream({
      start(c) { c.enqueue(encoder.encode(frame)); }, cancel() { cancelled = true; },
    })); }, r => receipts.push(r), 25);
    const response = await call('https://provider.test');
    await assert.rejects(response.text(), { name: 'TimeoutError' });
    assert.equal(cancelled, true);
    assert.equal(calls, 1);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]?.lastEvent, type);
    assert.equal(receipts[0]?.outcome, 'timeout');
    assert.ok(!JSON.stringify(receipts).includes('private output'));
  }
});

test('active generation may exceed the inactivity deadline and retains exact SSE bytes', async () => {
  const frames = Array.from({ length: 10 }, (_, i) => `data: ${JSON.stringify({ type: i === 9 ? 'response.completed' : 'response.output_text.delta', delta: 'héllo' })}\n\n`);
  let index = 0;
  const receipts: EngineeringStreamReceipt[] = [];
  const call = engineeringProviderFetch(async () => sse(new ReadableStream({ async pull(c) {
    await delay(10);
    if (index === frames.length) c.close(); else c.enqueue(encoder.encode(frames[index++]));
  } })), r => receipts.push(r), 60);
  assert.equal(await (await call('https://provider.test')).text(), frames.join(''));
  assert.equal(receipts[0]?.outcome, 'complete');
  assert.equal(receipts[0]?.terminalEvent, 'response.completed');
  assert.ok(receipts[0]!.elapsedMs > 60);
});

test('consumer backpressure, such as an approval pause, is not provider inactivity', async () => {
  let index = 0;
  const receipts: EngineeringStreamReceipt[] = [];
  const call = engineeringProviderFetch(async () => sse(new ReadableStream({ pull(c) {
    if (index++ === 0) c.enqueue(encoder.encode('data: {"type":"response.completed"}\n\n')); else c.close();
  } })), r => receipts.push(r), 25);
  const reader = (await call('https://provider.test')).body!.getReader();
  await reader.read();
  await delay(65);
  assert.equal(receipts.length, 0);
  assert.equal((await reader.read()).done, true);
  assert.equal(receipts[0]?.outcome, 'complete');
});

test('endless JSON padding fails even while the provider keeps sending bytes, without replay', async () => {
  let calls = 0, cancelled = false, reads = 0;
  const receipts: EngineeringStreamReceipt[] = [];
  const call = engineeringProviderFetch(async () => {
    calls++;
    return sse(new ReadableStream({ pull(c) {
      reads++;
      c.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'response.function_call_arguments.delta', item_id: 'call_1', delta: reads === 1 ? '{"query":' : ' '.repeat(1024) })}\n\n`));
    }, cancel() { cancelled = true; } }));
  }, r => receipts.push(r));
  await assert.rejects((await call('https://provider.test')).text(), /empty tool arguments/);
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
  assert.ok(reads < 15);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.timeoutKind, 'tool_arguments');
  assert.equal(receipts[0]?.outcome, 'timeout');
});

test('argument padding detection preserves string whitespace, split escapes and interleaved calls', async () => {
  const deltas = [
    ['a', '{"code":"escaped \\'], ['b', '{\n  "path": "b"}'],
    ['a', '"' + ' '.repeat(10_000)], ['a', '\\\\"}'],
    ['c', '{\n  "description": "hello world",\n  "enabled": true\n}'],
  ];
  const frames = deltas.map(([item_id, delta]) => `data: ${JSON.stringify({ type: 'response.function_call_arguments.delta', item_id, delta })}\n\n`);
  const receipts: EngineeringStreamReceipt[] = [];
  let i = 0;
  const call = engineeringProviderFetch(async () => sse(new ReadableStream({ pull(c) {
    if (i < frames.length) c.enqueue(encoder.encode(frames[i++])); else c.close();
  } })), r => receipts.push(r));
  assert.equal(await (await call('https://provider.test')).text(), frames.join(''));
  assert.equal(receipts[0]?.outcome, 'complete');
  assert.equal(receipts[0]?.timeoutKind, undefined);
});

test('an unfinished tool cannot keep the turn running forever by streaming nonempty arguments', async () => {
  const receipts: EngineeringStreamReceipt[] = [];
  let cancelled = false;
  const call = engineeringProviderFetch(async () => sse(new ReadableStream({ async pull(c) {
    await delay(10);
    c.enqueue(encoder.encode('data: {"type":"response.function_call_arguments.delta","item_id":"a","delta":"word"}\n\n'));
  }, cancel() { cancelled = true; } })), r => receipts.push(r), 500, 45);
  await assert.rejects((await call('https://provider.test')).text(), /did not finish a tool call/);
  assert.equal(receipts[0]?.timeoutKind, 'tool_arguments');
  assert.equal(cancelled, true);
});

test('keepalive frames cannot keep a silent reasoning response alive indefinitely', async () => {
  const receipts: EngineeringStreamReceipt[] = [];
  let i = 0;
  const call = engineeringProviderFetch(async () => sse(new ReadableStream({ async pull(c) {
    await delay(10);
    c.enqueue(encoder.encode(i++ === 0 ? 'data: {"type":"response.reasoning_summary_text.delta","delta":"thinking"}\n\n' : 'event: keepalive\ndata: {"type":"keepalive"}\n\n'));
  } })), r => receipts.push(r), 45);
  await assert.rejects((await call('https://provider.test')).text(), /stopped making progress/);
  assert.equal(receipts[0]?.timeoutKind, 'provider_progress');
});

test('active Anthropic and chat-completion streams are meaningful progress', async () => {
  for (const chunk of [ { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } }, { choices: [{ delta: { content: 'hello' } }] } ]) {
    let i = 0;
    const call = engineeringProviderFetch(async () => sse(new ReadableStream({ async pull(c) {
      await delay(10);
      if (i++ === 8) c.close(); else c.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
    } })), () => {}, 40);
    assert.ok((await (await call('https://provider.test')).text()).includes('hello'));
  }
});

test('tool generation budgets exclude consumer pauses and reset after completed calls', async () => {
  const receipts: EngineeringStreamReceipt[] = [];
  const frames = [
    { type: 'response.function_call_arguments.delta', item_id: 'a', delta: '{' },
    { type: 'response.function_call_arguments.done', item_id: 'a', arguments: '{}' },
    { type: 'response.function_call_arguments.delta', item_id: 'b', delta: '{}' },
    { type: 'response.function_call_arguments.done', item_id: 'b', arguments: '{}' },
  ];
  let i = 0;
  const call = engineeringProviderFetch(async () => sse(new ReadableStream({ async pull(c) {
    if (i === frames.length) { c.close(); return; }
    c.enqueue(encoder.encode(`data: ${JSON.stringify(frames[i++])}\n\n`));
  } }, { highWaterMark: 0 })), r => receipts.push(r), 200, 25);
  const reader = (await call('https://provider.test')).body!.getReader();
  await reader.read();
  await delay(65);
  while (!(await reader.read()).done) { /* consume */ }
  assert.equal(receipts[0]?.outcome, 'complete');
});

test('caller abort interrupts a pending read, including Request-carried signals', async () => {
  const controller = new AbortController();
  const receipts: EngineeringStreamReceipt[] = [];
  const call = engineeringProviderFetch(async () => sse(new ReadableStream()), r => receipts.push(r), 1000);
  const response = await call(new Request('https://provider.test', { signal: controller.signal }));
  const text = response.text();
  controller.abort();
  await assert.rejects(text, { name: 'AbortError' });
  assert.equal(receipts[0]?.outcome, 'cancelled');
});

test('cancelling the consumer closes the upstream stream and reports once', async () => {
  let cancelled = false;
  const receipts: EngineeringStreamReceipt[] = [];
  const call = engineeringProviderFetch(async () => sse(new ReadableStream({ cancel() { cancelled = true; } })), r => receipts.push(r), 25);
  await (await call('https://provider.test')).body!.cancel();
  assert.equal(cancelled, true);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.outcome, 'cancelled');
});

test('HTTP errors and nonstreaming responses retain status, headers and content; diagnostics cannot break them', async () => {
  const call = engineeringProviderFetch(async () => new Response('{"error":"rate limited"}', { status: 429, headers: { 'retry-after': '20' } }), () => { throw Error('logger down'); });
  const response = await call('https://provider.test');
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '20');
  assert.equal(await response.text(), '{"error":"rate limited"}');
});

test('split and oversized SSE lines cannot expose request or generated contents in receipts', async () => {
  const receipts: EngineeringStreamReceipt[] = [];
  const chunks = ['data: {"type":"response.output_text.delta","delta":"', 'private'.repeat(20_000), '"}\n\nevent: response.completed\n\n'];
  let index = 0;
  const call = engineeringProviderFetch(async () => sse(new ReadableStream({ pull(c) { if (index < chunks.length) c.enqueue(encoder.encode(chunks[index++])); else c.close(); } })), r => receipts.push(r));
  const response = await call('https://provider.test/private-key?token=secret', { headers: { Authorization: 'secret' }, body: 'private prompt', method: 'POST' });
  assert.equal(await response.text(), chunks.join(''));
  assert.equal(receipts[0]?.terminalEvent, 'response.completed');
  assert.doesNotMatch(JSON.stringify(receipts), /secret|private|provider\.test/);
});
