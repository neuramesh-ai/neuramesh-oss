// AN UNWIRED LANE MUST BE INERT, NOT FATAL.
//
// 177 of the bridge's 212 methods are still unwired on the web, so every surface that renders
// reaches one. While the fallback resolved `undefined`, that was survivable only because the
// browser had no data to render with — the moment it did, `(await nm.connectors()).connectors`
// and `rows.length` threw and took the whole app to a BLACK SCREEN, reported from live use.
//
// These pin the shape that keeps a half-built client standing. They are about resilience, not
// features: the warn-once console line is what names the gap, and a blank page names nothing.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { makeWebNm, webUploadIdentity } from './webnm';

const cfg = { apiUrl: '', powersyncUrl: '', clerkSessionId: async () => null, clerkBearer: async () => null, relayBearer: async () => null, actorId: () => 'u', workspaceId: () => 'w' };
const mk = (overrides: Record<string, unknown> = {}) =>
  makeWebNm(cfg as never, {} as never, overrides).nm as Record<string, (...a: unknown[]) => unknown>;

describe('the unwired fallback', () => {
  test('reads like an empty array — length, map, spread, iteration', async () => {
    const v = (await mk()['contentAll']!()) as unknown[];
    assert.equal((v as { length: number }).length, 0);
    assert.deepEqual((v as unknown[]).map((x) => x), []);
    assert.deepEqual([...(v as unknown[])], []);
    for (const _ of v as unknown[]) assert.fail('must not iterate');
  });

  test('an unknown property yields another empty rather than undefined', async () => {
    // the exact crash: `(await nm.connectors()).connectors` — undefined here was a TypeError
    const v = (await mk()['connectors']!()) as { connectors: { length: number; map: (f: (x: unknown) => unknown) => unknown[] } };
    assert.notEqual(v.connectors, undefined);
    assert.equal(v.connectors.length, 0);
    assert.deepEqual(v.connectors.map((x) => x), []);
    // and it keeps walking, however deep the caller reaches
    const deep = v as unknown as { a: { b: { c: { length: number } } } };
    assert.equal(deep.a.b.c.length, 0);
  });

  test('it is NOT thenable — an awaited proxy that answered `then` would never settle', async () => {
    const v = (await mk()['schedules']!()) as Record<string, unknown>;
    assert.equal(v['then'], undefined);
  });

  test('a watch returns a callable unsubscribe, so cleanup never throws', () => {
    const off = mk()['watchTasksAll']!(() => {});
    assert.equal(typeof off, 'function');
    (off as () => void)(); // must not throw
  });

  test('it COERCES like an array — numeric use must not call an object', async () => {
    // the crash this pins: footprintPctOf does `Math.max(1, p.nm.budgetBytes)`. When the proxy
    // answered Symbol.toPrimitive with another proxy, coercion tried to CALL it — "object is not
    // a function" — and blanked the page, the exact failure the fallback exists to prevent.
    // Found in the local web harness, which is the point of having one.
    const v = (await mk()['footprintGet']!()) as Record<string, { budgetBytes: number }>;
    assert.equal(Math.max(1, v['nm']!.budgetBytes), 1);
    assert.equal(Number(v['nm']!.budgetBytes), 0);
    assert.equal(`${String(v['nm']!.budgetBytes)}`, '');
    // and the array protocol still works — Symbol.iterator is the array's own
    assert.deepEqual([...(v as unknown as unknown[])], []);
  });

  test('a real override always wins over the fallback', async () => {
    const nm = mk({ channels: async () => [{ id: 'c1' }] });
    assert.deepEqual(await nm['channels']!(), [{ id: 'c1' }]);
  });

  test('electron stays a real value — copy branches on it, and the proxy must not answer', () => {
    assert.equal((mk() as unknown as { electron: string }).electron, 'web');
  });
});

test('browser uploads use the live Clerk bearer', async () => {
  const ident = await webUploadIdentity({
    ...cfg,
    clerkBearer: async () => 'clerk-session-token',
  });
  assert.equal(ident.authHeaders?.['authorization'], 'Bearer clerk-session-token');
});
