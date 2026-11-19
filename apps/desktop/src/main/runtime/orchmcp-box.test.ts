import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearerOk, boxBridgePort, closeBridge, ensureBoxBridge, ensureBridge, registerTurn } from './orchmcp';

// The agent box on a Cloud Run machine reaches the bus on the host veth IP (cloudrun/README.md). Tests
// cannot bind that IP, so the box listener binds loopback here; the bearer rule is what is under test.

test('bearerOk: an exact Bearer match only', () => {
  assert.ok(bearerOk('Bearer abc', 'abc'));
  assert.ok(!bearerOk('Bearer abcd', 'abc'));
  assert.ok(!bearerOk('bearer abc', 'abc'));
  assert.ok(!bearerOk(undefined, 'abc'));
  assert.ok(!bearerOk('Bearer ', ''));
});

test('the box bridge demands the per-box bearer on top of the turn secret; the loopback bridge does not', async () => {
  try {
    const loop = await ensureBridge();
    const box = await ensureBoxBridge('127.0.0.1', 'b'.repeat(64));
    assert.notEqual(loop, box);
    assert.equal(boxBridgePort(), box);
    assert.equal(await ensureBoxBridge('127.0.0.1', 'b'.repeat(64)), box, 'one per process');
    registerTurn('t1', 's1', [{ name: 'record_lesson', description: 'd', inputSchema: {}, run: async () => 'ok' }]);
    const q = '/tools?turn=t1&secret=s1';
    assert.equal((await fetch(`http://127.0.0.1:${box}${q}`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${box}${q}`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    const ok = await fetch(`http://127.0.0.1:${box}${q}`, { headers: { authorization: `Bearer ${'b'.repeat(64)}` } });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { tools: Array<{ name: string }> }).tools[0]!.name, 'record_lesson');
    assert.equal((await fetch(`http://127.0.0.1:${box}/tools?turn=t1&secret=nope`, { headers: { authorization: `Bearer ${'b'.repeat(64)}` } })).status, 403, 'the bearer does not replace the turn secret');
    const call = await fetch(`http://127.0.0.1:${box}/call?turn=t1&secret=s1`, { method: 'POST', headers: { authorization: `Bearer ${'b'.repeat(64)}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'record_lesson', args: {} }) });
    assert.deepEqual(await call.json(), { result: 'ok' });
    assert.equal((await fetch(`http://127.0.0.1:${loop}${q}`)).status, 200, 'host-side callers are unchanged');
  } finally {
    await closeBridge();
  }
  assert.equal(boxBridgePort(), 0);
});

test('the box bridge never binds every interface, and needs a bearer', async () => {
  await assert.rejects(ensureBoxBridge('0.0.0.0', 'x'), /never every interface/);
  await assert.rejects(ensureBoxBridge('::', 'x'), /never every interface/);
  await assert.rejects(ensureBoxBridge('127.0.0.1', ''), /needs a bearer/);
});
