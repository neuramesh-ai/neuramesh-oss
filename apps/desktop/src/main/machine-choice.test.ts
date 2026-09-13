// The composer's machine forecast and the designation a send writes (renderer/src/compute/machine-choice.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choosableMachines, cloudMachineFor, designationFor, forecastMachine, machineKindLabel } from '../renderer/src/compute/machine-choice';

const now = Date.parse('2026-09-04T12:00:00Z');
const fresh = new Date(now - 10_000).toISOString(), stale = new Date(now - 600_000).toISOString();
const mac = { id: 'mac', name: 'george-mac', kind: 'local', ownerUserId: 'u1', lastSeenAt: fresh };
const runner = { id: 'run', name: 'runner', kind: 'runner', ownerUserId: 'u1', lastSeenAt: fresh };
const member = { id: 'mem', name: 'member-u1', kind: 'member', ownerUserId: 'u1', lastSeenAt: fresh };
const mate = { id: 'mate', name: 'mate-mac', kind: 'local', ownerUserId: 'u2', lastSeenAt: stale, sharesWith: ['u1'] };
const stranger = { id: 'x', name: 'x-mac', kind: 'local', ownerUserId: 'u3', lastSeenAt: fresh };

test('choosable: own first, lent ones after, offline last, never a machine you may not use', () => {
  assert.deepEqual(choosableMachines([stranger, mate, runner, mac], 'u1', now).map((m) => m.id), ['mac', 'run', 'mate']);
});

test('the desktop default "here" designates this Mac; an explicit choice wins over everything', () => {
  const base = { origin: 'desktop' as const, prefs: { desktopSessions: 'here' as const }, machines: [mac, runner], selfUserId: 'u1', selfMachineId: 'mac', now };
  assert.deepEqual(forecastMachine({ ...base, chosen: null }), { machineId: 'mac', why: 'here' });
  assert.deepEqual(forecastMachine({ ...base, chosen: 'run' }), { machineId: 'run', why: 'chosen' });
  assert.equal(designationFor({ origin: 'desktop', chosen: null, prefs: { desktopSessions: 'here' }, selfMachineId: 'mac' }), 'mac');
  assert.equal(designationFor({ origin: 'desktop', chosen: 'run', prefs: { desktopSessions: 'here' }, selfMachineId: 'mac' }), 'run');
});

test('Auto on the desktop and every web session forecast the cloud when it is awake — the member machine before the runner', () => {
  assert.deepEqual(forecastMachine({ origin: 'desktop', chosen: null, prefs: {}, machines: [mac, runner, member], selfUserId: 'u1', selfMachineId: 'mac', now }), { machineId: 'mem', why: 'cloud' });
  assert.deepEqual(forecastMachine({ origin: 'web', chosen: null, prefs: { desktopSessions: 'here' }, machines: [mac, runner], selfUserId: 'u1', selfMachineId: null, now }), { machineId: 'run', why: 'cloud' }, 'the desktop default means nothing to a web-born session');
  assert.equal(cloudMachineFor([mac, { ...runner, lastSeenAt: stale }], 'u1', now), null, 'an asleep cloud machine is not forecast');
});

test('no cloud awake: the desktop forecasts this Mac, the web forecasts Auto — and neither writes a designation', () => {
  assert.deepEqual(forecastMachine({ origin: 'desktop', chosen: null, prefs: {}, machines: [mac], selfUserId: 'u1', selfMachineId: 'mac', now }), { machineId: 'mac', why: 'this-machine' });
  assert.deepEqual(forecastMachine({ origin: 'web', chosen: null, prefs: {}, machines: [mac], selfUserId: 'u1', selfMachineId: null, now }), { machineId: null, why: 'auto' });
  assert.equal(designationFor({ origin: 'desktop', chosen: null, prefs: {}, selfMachineId: 'mac' }), null, 'Auto writes nothing: the ladder decides live');
  assert.equal(designationFor({ origin: 'web', chosen: null, prefs: { desktopSessions: 'here' }, selfMachineId: null }), null);
});

test('the runner is choosable by every member; a laptop only with its owner’s grant', () => {
  const now = Date.now();
  const rows = [
    { id: 'run', name: 'runner', kind: 'runner', ownerUserId: null, lastSeenAt: new Date(now - 5_000).toISOString(), sharesWith: undefined },
    { id: 'mate', name: 'mate-mbp', kind: 'local', ownerUserId: 'u2', lastSeenAt: new Date(now - 5_000).toISOString(), sharesWith: [] as string[] },
    { id: 'mac', name: 'mac', kind: 'local', ownerUserId: 'u1', lastSeenAt: new Date(now - 5_000).toISOString(), sharesWith: undefined },
  ];
  assert.deepEqual(choosableMachines(rows, 'u1', now).map((m) => m.id), ['mac', 'run'], 'mine first, then the runner; the ungranted laptop is not offered');
});

test('rows say their kind', () => {
  assert.equal(machineKindLabel(mac, 'u1', 'mac', 'mac'), 'this Mac');
  assert.equal(machineKindLabel(runner, 'u1', 'mac', 'run'), 'cloud');
  assert.equal(machineKindLabel(member, 'u1', 'mac', 'mem'), 'your cloud machine');
  assert.equal(machineKindLabel({ ...member, ownerUserId: 'u2' }, 'u1', 'mac', 'mem2'), 'member machine');
  assert.equal(machineKindLabel(mate, 'u1', 'mac', 'mate'), 'desktop', 'a peer laptop says its kind; the row wears the grant badge already');
  assert.equal(machineKindLabel(mac, 'u1', null, 'mac'), 'your machine', 'in the browser your laptop is not "this Mac"');
});

test('a phone session is web-born with no self machine: the member machine when awake, else the runner, else Auto — and Auto designates nothing', () => {
  const phone = { origin: 'web' as const, chosen: null, prefs: { desktopSessions: 'here' as const }, selfUserId: 'u1', selfMachineId: null, now };
  assert.deepEqual(forecastMachine({ ...phone, machines: [runner, member] }), { machineId: 'mem', why: 'cloud' });
  assert.deepEqual(forecastMachine({ ...phone, machines: [runner, { ...member, lastSeenAt: stale }] }), { machineId: 'run', why: 'cloud' });
  assert.deepEqual(forecastMachine({ ...phone, machines: [{ ...runner, lastSeenAt: stale }] }), { machineId: null, why: 'auto' });
  assert.equal(designationFor({ origin: 'web', chosen: null, prefs: { desktopSessions: 'here' }, selfMachineId: null }), null, 'Auto on a phone writes no machine_id');
  assert.equal(designationFor({ origin: 'web', chosen: 'run', prefs: {}, selfMachineId: null }), 'run', 'an explicit pick is the designation');
});
