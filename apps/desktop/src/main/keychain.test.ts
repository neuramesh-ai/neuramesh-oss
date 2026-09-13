// The keychain writer: the exact `security` arguments, so the bearer lands under one service,
// updates in place, and a refused write is named.   pnpm exec tsx --test src/main/keychain.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { KEYCHAIN_SERVICE, macKeychain, memoryKeychain, type Spawn } from './keychain';

/** a `security` that answers from a table: [args joined] → { code, out } */
function fakeSecurity(table: Record<string, { code: number; out?: string; err?: string }>): { spawn: Spawn; calls: string[][] } {
  const calls: string[][] = [];
  const spawn: Spawn = (bin, args) => {
    assert.equal(bin, 'security');
    calls.push(args);
    const ans = table[args.join(' ')] ?? { code: 44 };
    const p = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    setTimeout(() => { if (ans.out) p.stdout.emit('data', Buffer.from(ans.out)); if (ans.err) p.stderr.emit('data', Buffer.from(ans.err)); p.emit('close', ans.code); }, 0);
    return p as unknown as ReturnType<Spawn>;
  };
  return { spawn, calls };
}

test('get reads the password of one account under the NeuraMesh service, and a missing item is null', async () => {
  const sec = fakeSecurity({ [`find-generic-password -s ${KEYCHAIN_SERVICE} -a local-human-bearer -w`]: { code: 0, out: 'nmh_abc\n' } });
  const k = macKeychain(sec.spawn);
  assert.equal(await k.get('local-human-bearer'), 'nmh_abc');
  assert.equal(await k.get('other'), null);
  assert.deepEqual(sec.calls[0], ['find-generic-password', '-s', 'NeuraMesh', '-a', 'local-human-bearer', '-w']);
});

test('set writes with -U so a re-mint updates in place, and a refusal is an error with the code', async () => {
  const sec = fakeSecurity({ [`add-generic-password -U -s ${KEYCHAIN_SERVICE} -a local-human-bearer -w nmh_x`]: { code: 0 } });
  await macKeychain(sec.spawn).set('local-human-bearer', 'nmh_x');
  assert.deepEqual(sec.calls[0], ['add-generic-password', '-U', '-s', 'NeuraMesh', '-a', 'local-human-bearer', '-w', 'nmh_x']);
  const refused = fakeSecurity({});
  await assert.rejects(macKeychain(refused.spawn).set('a', 'b'), /keychain write failed \(44\)/);
});

test('delete names the same service and account', async () => {
  const sec = fakeSecurity({ [`delete-generic-password -s ${KEYCHAIN_SERVICE} -a x`]: { code: 0 } });
  await macKeychain(sec.spawn).delete('x');
  assert.deepEqual(sec.calls[0], ['delete-generic-password', '-s', 'NeuraMesh', '-a', 'x']);
});

test('a missing security binary reads as absent, never as a throw', async () => {
  const spawn: Spawn = () => { const p = new EventEmitter() as EventEmitter & { stdout: null; stderr: null }; p.stdout = null; p.stderr = null; setTimeout(() => p.emit('error', new Error('ENOENT')), 0); return p as unknown as ReturnType<Spawn>; };
  assert.equal(await macKeychain(spawn).get('x'), null);
});

test('the memory keychain round-trips', async () => {
  const k = memoryKeychain({ seeded: 'v' });
  assert.equal(await k.get('seeded'), 'v');
  await k.set('a', 'b');
  assert.equal(await k.get('a'), 'b');
  await k.delete('a');
  assert.equal(await k.get('a'), null);
});
