import { expect, it } from 'vitest';
import { readBrainEvents } from './brain-read-events';
import type { BrainObjectRef } from './brain-objects';

const ref = (index: number): BrainObjectRef => ({ backend: 'file', key: String(index), sizeBytes: 0, sha256: '', mime: 'application/x-ndjson' });
const commits = (count: number) => Array.from({ length: count }, (_, index) => ({ segment: ref(index), event_count: 1 }));
const deferred = () => {
  let resolve!: (bytes: Buffer) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Buffer>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

it('restores every event in revision order with bounded concurrent object reads', async () => {
  const pending = new Map<number, ReturnType<typeof deferred>>();
  let active = 0;
  let peak = 0;
  const reading = readBrainEvents({ get: object => {
    const item = deferred(); pending.set(Number(object.key), item);
    peak = Math.max(peak, ++active);
    return item.promise.finally(() => { active--; });
  } }, commits(21));
  expect(pending.size).toBeGreaterThan(1);
  expect(pending.size).toBeLessThanOrEqual(8);
  while (pending.size) {
    // Reverse completion order within every batch must not reorder the conversation.
    for (const [index, item] of [...pending].reverse()) {
      pending.delete(index); item.resolve(Buffer.from(JSON.stringify({ id: index, text: `full event ${index}` }) + '\n'));
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  expect(await reading).toEqual(Array.from({ length: 21 }, (_, id) => ({ id, text: `full event ${id}` })));
  expect(peak).toBeLessThanOrEqual(8);
  expect(active).toBe(0);
});

it('does not return partial history or start more downloads after an object fails verification', async () => {
  const pending: ReturnType<typeof deferred>[] = [];
  let settled = false;
  const reading = readBrainEvents({ get: () => { const item = deferred(); pending.push(item); return item.promise; } }, commits(20));
  const rejected = expect(reading).rejects.toThrow('checksum');
  void reading.then(() => { settled = true; }, () => { settled = true; });
  const started = pending.length;
  pending[0]!.reject(new Error('Brain object checksum does not match'));
  await new Promise(resolve => setImmediate(resolve));
  expect(settled).toBe(false);
  expect(pending).toHaveLength(started);
  for (const item of pending.slice(1)) item.resolve(Buffer.from('{"id":"verified"}\n'));
  await rejected;
  expect(pending).toHaveLength(started);
});

it('rejects malformed JSON and missing events instead of silently truncating a segment', async () => {
  await expect(readBrainEvents({ get: async () => Buffer.from('{') }, commits(1))).rejects.toThrow();
  await expect(readBrainEvents({ get: async () => Buffer.from('') }, commits(1))).rejects.toThrow('event count');
  await expect(readBrainEvents({ get: async () => { throw new Error('unexpected read'); } }, [])).resolves.toEqual([]);
});

it('rejects an oversized legacy restore before downloading objects', async () => {
  const history = [{ segment: { ...ref(0), sizeBytes: 65 * 1024 * 1024 }, event_count: 1 }];
  await expect(readBrainEvents({ get: async () => { throw new Error('unexpected download'); } }, history)).rejects.toMatchObject({ code: 'BRAIN_RESTORE_TOO_LARGE' });
});
