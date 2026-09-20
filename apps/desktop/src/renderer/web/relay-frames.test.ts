// the encoding half of the browser relay client. These are the failures that do not throw:
// they render as speckle in somebody's `git log` weeks later, so they get real assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeReason, encodeB64, makeDecoder, notice } from '@neuramesh/relay-client';

const b64 = (bytes: number[]): string => Buffer.from(bytes).toString('base64');

test('decodes a multi-byte character SPLIT across two frames', () => {
  // "é" is 0xC3 0xA9. A pty writes bytes; the socket chops them wherever it likes, so this
  // split is routine rather than exotic. Decoding each frame on its own yields two
  // replacement characters and the corruption is load-dependent — the worst kind to chase.
  const dec = makeDecoder();
  assert.equal(dec(b64([0xc3])), '', 'a lone lead byte must emit nothing, not U+FFFD');
  assert.equal(dec(b64([0xa9])), 'é', 'the continuation byte completes the character');
});

test('decodes a 4-byte emoji split three ways', () => {
  const dec = makeDecoder();
  const bytes = [...Buffer.from('🚀', 'utf8')];
  assert.equal(bytes.length, 4);
  assert.equal(dec(b64(bytes.slice(0, 1))), '');
  assert.equal(dec(b64(bytes.slice(1, 3))), '');
  assert.equal(dec(b64(bytes.slice(3))), '🚀');
});

test('a fresh decoder per channel does not inherit another channel’s partial byte', () => {
  const a = makeDecoder();
  const b = makeDecoder();
  a(b64([0xc3])); // channel A is mid-character
  assert.equal(b(b64([0x68, 0x69])), 'hi', 'channel B is unaffected');
});

test('encodes non-ASCII input — btoa alone would throw here', () => {
  // typing an accented character into a terminal must reach the shell, not raise
  // InvalidCharacterError. Round-trip through the same decoder the machine edge uses.
  for (const s of ['é', '🚀', 'naïve café', 'ls -la\r']) {
    assert.equal(Buffer.from(encodeB64(s), 'base64').toString('utf8'), s);
  }
});

test('control bytes survive the round trip', () => {
  // ^C is what makes a terminal a terminal
  const s = '\x03\x1b[A\r\n\x00';
  assert.equal(Buffer.from(encodeB64(s), 'base64').toString('utf8'), s);
});

test('every relay close code says something a person can act on', () => {
  for (const code of [4401, 4403, 4404, 4409, 4410, 1013, 1008]) {
    const r = closeReason(code);
    assert.ok(r.length > 10 && /[.!]$/.test(r), `code ${code} needs a real sentence, got ${r}`);
  }
  // 4404 is the one people will actually hit, so it must name what is true and what to do: the
  // machine is online (ensureMachine ran) and not on the relay, and it comes back on its own
  assert.match(closeReason(4404), /not on the relay yet/i);
  assert.doesNotMatch(closeReason(4404), /asleep/i);
  assert.match(closeReason(4404), /again/i);
  assert.match(closeReason(1013), /again/i);
  // AN UNKNOWN CODE CARRIES ITS NUMBER. Without it the fallback read exactly like the four named
  // refusals above, so a report of "the connection closed" ruled nothing in or out — 1006 (a
  // handshake that never completed) was indistinguishable from an ordinary 1000.
  assert.match(closeReason(1006), /\(1006\)/);
  assert.notEqual(closeReason(1006), closeReason(1000));
});

test('notice is CRLF-framed so a pty emulator renders it on its own line', () => {
  const n = notice('hello');
  assert.ok(n.startsWith('\r\n') && n.endsWith('\r\n'));
  assert.match(n, /hello/);
});
