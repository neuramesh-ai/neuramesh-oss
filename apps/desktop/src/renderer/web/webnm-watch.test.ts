import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { keepIdentity, sameRows, shareWatch, shareWatches, watchRows } from './webnm-watch';

/** a replica stand-in: `change()` fires every registered onChange, the way a synced write does */
function fakeDb() {
  const listeners = new Set<() => void>();
  return {
    db: {
      onChangeWithCallback: (h: { onChange: () => void }) => {
        listeners.add(h.onChange);
        return () => listeners.delete(h.onChange);
      },
    } as never,
    change: () => { for (const l of [...listeners]) l(); },
    listeners,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('sameRows', () => {
  test('equal rows compare equal, any changed value does not', () => {
    assert.equal(sameRows([{ a: 1, b: 'x' }], [{ a: 1, b: 'x' }]), true);
    assert.equal(sameRows([{ a: 1, b: 'x' }], [{ a: 1, b: 'y' }]), false);
    assert.equal(sameRows([{ a: 1 }], [{ a: 1 }, { a: 2 }]), false);
    assert.equal(sameRows([{ a: null }], [{ a: 0 }]), false);
    assert.equal(sameRows([{ a: 1 }], [{ a: 1, b: undefined }]), false);
  });
});

describe('watchRows', () => {
  test('delivers the first result, then only results that changed', async () => {
    const { db, change } = fakeDb();
    let rows: Array<{ id: string; n: number }> = [{ id: 'a', n: 1 }];
    const got: unknown[] = [];
    const stop = watchRows(db, ['t'], async () => rows.map((r) => ({ ...r })), (r) => got.push(r));
    await tick();
    change(); await tick(); // same rows: a new array, but not a new result
    rows = [{ id: 'a', n: 2 }];
    change(); await tick();
    stop();
    assert.equal(got.length, 2);
    assert.deepEqual(got[1], [{ id: 'a', n: 2 }]);
  });

  test('a changed result keeps every unchanged row as the same object', async () => {
    const { db, change } = fakeDb();
    let rows = [{ id: 'm1', body: 'a' }, { id: 'm2', body: 'b' }];
    const got: Array<Array<{ id: string; body: string }>> = [];
    watchRows(db, ['t'], async () => rows.map((r) => ({ ...r })), (r) => got.push(r));
    await tick();
    rows = [...rows.slice(0, 1), { id: 'm2', body: 'b!' }, { id: 'm3', body: 'c' }];
    change(); await tick();
    assert.equal(got.length, 2);
    assert.equal(got[1]![0], got[0]![0], 'm1 did not change: the same object');
    assert.notEqual(got[1]![1], got[0]![1], 'm2 changed: a new object');
    assert.deepEqual(got[1]!.map((r) => r.body), ['a', 'b!', 'c']);
  });

  test('delivers an empty first result — "nothing here" is an answer', async () => {
    const { db } = fakeDb();
    const got: unknown[] = [];
    watchRows(db, ['t'], async () => [], (r) => got.push(r));
    await tick();
    assert.deepEqual(got, [[]]);
  });

  test('one run in flight: a burst of changes mid-run makes exactly one more run', async () => {
    const { db, change } = fakeDb();
    let runs = 0;
    let release: () => void = () => {};
    const run = () => { runs++; return new Promise<Array<{ n: number }>>((r) => { release = () => r([{ n: runs }]); }); };
    const got: unknown[] = [];
    watchRows(db, ['t'], run, (r) => got.push(r));
    change(); change(); change(); // all land while the first run is still out
    assert.equal(runs, 1);
    release(); await tick(); await tick();
    assert.equal(runs, 2);
    release(); await tick(); await tick();
    assert.equal(runs, 2);
    assert.equal(got.length, 2);
  });

  test('a failed read leaves the last good rows standing and reports it', async () => {
    const { db, change } = fakeDb();
    let fail = false;
    const got: unknown[] = [];
    const errors: unknown[] = [];
    watchRows(db, ['t'], async () => { if (fail) throw new Error('replica busy'); return [{ n: 1 }]; }, (r) => got.push(r), (e) => errors.push(e));
    await tick();
    fail = true;
    change(); await tick(); await tick();
    assert.equal(got.length, 1);
    assert.equal(errors.length, 1);
  });

  test('nothing is delivered after unsubscribe', async () => {
    const { db, change, listeners } = fakeDb();
    const got: unknown[] = [];
    let n = 0;
    const stop = watchRows(db, ['t'], async () => [{ n: ++n }], (r) => got.push(r));
    stop();
    change(); await tick();
    assert.equal(got.length, 0);
    assert.equal(listeners.size, 0);
  });
});

describe('shareWatch', () => {
  test('one underlying query per argument set, however many subscribe', async () => {
    const { db, change } = fakeDb();
    let runs = 0;
    const watch = shareWatch(((key: unknown, cb: (r: unknown[]) => void) =>
      watchRows(db, ['t'], async () => { runs++; return [{ key, n: runs }]; }, cb)) as never);
    const a: unknown[] = [];
    const b: unknown[] = [];
    const c: unknown[] = [];
    const stopA = watch('k1', (r: unknown) => a.push(r));
    await tick();
    const stopB = watch('k1', (r: unknown) => b.push(r)); // late: handed the live value
    const stopC = watch('k2', (r: unknown) => c.push(r)); // another key: its own query
    await tick();
    assert.equal(runs, 2);
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.equal(a[0], b[0]);
    change(); await tick();
    assert.equal(runs, 4); // one re-run per key, not per subscriber
    assert.equal(a.length, 2);
    assert.equal(b.length, 2);
    stopA(); stopB(); stopC();
  });

  test('the query stops when the last subscriber leaves, and restarts for the next', async () => {
    const { db, listeners } = fakeDb();
    const watch = shareWatch(((cb: (r: unknown[]) => void) => watchRows(db, ['t'], async () => [], cb)) as never);
    const s1 = watch(() => {});
    const s2 = watch(() => {});
    assert.equal(listeners.size, 1);
    s1();
    assert.equal(listeners.size, 1);
    s2();
    assert.equal(listeners.size, 0);
    const s3 = watch(() => {});
    assert.equal(listeners.size, 1);
    s3();
  });

  test('shareWatches wraps only watch lanes', () => {
    const lanes = { watchA: () => () => {}, channels: async () => [] as unknown[], electron: 'web' };
    const out = shareWatches(lanes);
    assert.notEqual(out.watchA, lanes.watchA);
    assert.equal(out.channels, lanes.channels);
    assert.equal(out.electron, 'web');
  });
});

describe('keepIdentity', () => {
  test('an unchanged answer comes back as the same object', async () => {
    let v = { projects: [{ id: 'p1' }] };
    const read = keepIdentity(async () => JSON.parse(JSON.stringify(v)) as typeof v);
    const a = await read();
    const b = await read();
    v = { projects: [{ id: 'p2' }] };
    const c = await read();
    assert.equal(a, b);
    assert.notEqual(b, c);
    assert.deepEqual(c, { projects: [{ id: 'p2' }] });
  });
});
