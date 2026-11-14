import assert from 'node:assert/strict';
import { test } from 'node:test';
import { command, gate, lanes, validationTasks } from './ci-lanes.mjs';

const fixture = [
  { name: '@nm/desktop', path: 'apps/desktop', scripts: { test: 'test' } },
  { name: '@nm/hq', path: 'apps/hq', scripts: { test: 'test' } },
  { name: '@nm/api', path: 'packages/control-api', scripts: { test: 'test' } },
  { name: '@nm/shared', path: 'packages/shared', scripts: { test: 'test' } },
  { name: '@nm/mobile', path: 'apps/mobile', scripts: { test: 'test' } },
  { name: '@nm/no-tests', path: 'packages/no-tests', scripts: { typecheck: 'tsc' } },
];
test('every test workspace is selected exactly once, including future workspaces', () => {
  const all = [...fixture, { name: '@nm/new', path: 'packages/new', scripts: { test: 'test' } }];
  const matrix = lanes(all);
  const selected = Object.values(matrix).flat();
  assert.deepEqual([...selected].sort(), all.filter(p => p.scripts.test).map(p => p.name).sort());
  assert.equal(new Set(selected).size, selected.length);
  assert.equal(Object.keys(matrix).length, 4);
  for (const [lane, packages] of Object.entries(matrix)) {
    const args = command('test', all, { lane });
    assert.ok(args.includes('--workspace-concurrency=1'));
    assert.deepEqual(args.filter((_, i) => args[i - 1] === '--filter'), packages);
  }
});
test('HQ-only skips only desktop and the public tree needs no absent workspaces', () => {
  assert.deepEqual(Object.values(lanes(fixture, true)).flat().sort(), fixture.filter(p => p.scripts.test && p.path !== 'apps/desktop').map(p => p.name).sort());
  const publicTree = fixture.filter(p => !['apps/hq', 'apps/mobile'].includes(p.path));
  assert.equal(lanes(publicTree).hq, undefined);
  assert.ok(lanes(publicTree).desktop);
  assert.ok(command('build', fixture, { hqOnly: true }).includes('--filter=!@neuramesh/desktop'));
  assert.ok(!command('typecheck', fixture).some(s => s.startsWith('--filter')));
});
test('empty, ambiguous and invalid lane selections fail before pnpm', () => {
  assert.throws(() => lanes([]));
  assert.throws(() => lanes([...fixture, fixture[0]]));
  assert.throws(() => lanes([{ ...fixture[0], name: '--filter=*' }]));
  assert.throws(() => command('test', fixture, { lane: 'typo' }));
  assert.throws(() => command('deploy', fixture));
});
test('aggregate rejects failed, cancelled, missing or unexpectedly skipped lanes', () => {
  const full = Object.fromEntries(['scope', 'public-scan', 'validation', 'tests'].map(k => [k, { result: 'success' }]));
  gate(full, 'false', 'false');
  for (const name of Object.keys(full)) for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.throws(() => gate({ ...full, [name]: { result } }, 'false', 'false'), `${name}:${result}`);
  }
  const focused = { ...full, ...Object.fromEntries(['validation', 'tests'].map(k => [k, { result: 'skipped' }])) };
  gate(focused, 'true', 'false');
  assert.throws(() => gate(focused, 'false', 'false'));
  assert.throws(() => gate(full, 'true', 'false'));
  assert.throws(() => gate(full, '', 'false'));
  assert.throws(() => gate({ ...focused, scope: { result: 'failure' } }, 'true', 'false'));
  const staticOnly = { ...focused, validation: { result: 'success' } };
  gate(staticOnly, 'true', 'true');
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.throws(() => gate({ ...staticOnly, validation: { result } }, 'true', 'true'));
  }
  assert.throws(() => gate(staticOnly, 'true', ''));
});
test('scheduler-only fixes select static checks; application changes select all validation tasks', () => {
  assert.deepEqual(validationTasks('true', 'true'), ['static']);
  assert.deepEqual(validationTasks('true', 'false'), ['static']); // the whole job is skipped by its scoped condition
  for (const needed of ['true', 'false']) assert.deepEqual(validationTasks('false', needed), ['typecheck', 'static', 'build']);
  assert.throws(() => validationTasks('', 'false'));
  assert.throws(() => validationTasks('true', ''));
});
