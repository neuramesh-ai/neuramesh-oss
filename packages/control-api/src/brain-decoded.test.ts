import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { decodedBrainSnapshot } from './brain-decoded';
const pack = (value: unknown) => ({ brainEncoding: 'neuramesh.gzip.v1', data: gzipSync(JSON.stringify(value)).toString('base64') });
const snapshot = (payload: unknown, runtimeMessages?: unknown[]) => ({ workspace: 'w', threadId: 't', revision: 1, events: [{ id: 'e', type: 'runtime.event', timestamp: '', payload }], runtimeMessages });
it('decodes complete unicode values and does not modify the archive', () => {
  const original = snapshot(pack({ text: '你好 🧠' }), [pack([{ role: 'user', content: 'continue' }])]);
  expect(decodedBrainSnapshot(original)).toMatchObject({ events: [{ payload: { text: '你好 🧠' } }], runtimeMessages: [{ role: 'user', content: 'continue' }] });
  expect(original.events[0]!.payload).toHaveProperty('brainEncoding');
});
it('bounds cumulative gzip expansion and rejects malformed data', () => {
  expect(() => decodedBrainSnapshot(snapshot(pack('a'.repeat(1000))), 100)).toThrow('restore limit');
  expect(() => decodedBrainSnapshot(snapshot(pack('a'.repeat(60)), [pack(['b'.repeat(60)])]), 100)).toThrow('restore limit');
  expect(() => decodedBrainSnapshot(snapshot({ brainEncoding: 'neuramesh.gzip.v1', data: 'corrupt' }))).toThrow('invalid compressed');
  expect(() => decodedBrainSnapshot(snapshot(null, [pack({ not: 'messages' })]))).toThrow('must contain messages');
});
it('counts uncompressed content, runtime messages and metadata toward the restore budget too', () => {
  expect(() => decodedBrainSnapshot(snapshot('a'.repeat(1000)), 500)).toThrow('restore limit');
  expect(() => decodedBrainSnapshot(snapshot(null, [{ content: 'a'.repeat(300) }, { content: 'b'.repeat(300) }]), 500)).toThrow('restore limit');
  expect(() => decodedBrainSnapshot({ ...snapshot(null), metadata: { note: 'a'.repeat(1000) } }, 500)).toThrow('restore limit');
});
