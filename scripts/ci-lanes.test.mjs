import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { command, gate, lanes, matrixLanes, validationTasks } from './ci-lanes.mjs';

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
  assert.deepEqual(matrixLanes(all), ['api 1/2', 'api 2/2', 'desktop', 'hq', 'shared']);
  for (const lane of matrixLanes(all)) {
    const args = command('test', all, { lane });
    assert.ok(args.includes('--workspace-concurrency=1'));
    assert.deepEqual(args.filter((_, i) => args[i - 1] === '--filter'), matrix[lane.split(' ')[0]]);
  }
});
test('the api lane runs as two shards, and each shard reaches its test script', () => {
  assert.deepEqual(command('test', fixture, { lane: 'api 1/2' }).slice(-2), ['test', '--shard=1/2']);
  assert.deepEqual(command('test', fixture, { lane: 'api 2/2' }).slice(-2), ['test', '--shard=2/2']);
  assert.equal(command('test', fixture, { lane: 'shared' }).at(-1), 'test');
  for (const lane of ['api', 'api 3/2', 'api 0/2', 'api 1/3', 'shared 1/2', 'api 1/2 ', 'api1/2']) {
    assert.throws(() => command('test', fixture, { lane }), lane);
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
test('the test step shell runs a step as GitHub bash does, so a failure still fails the lane', () => {
  // the desktop lane on a self-hosted runner goes to a container; every other case runs bash here
  const dir = mkdtempSync(join(tmpdir(), 'nm-lane-shell-'));
  const run = (body, env) => {
    const script = join(dir, 'step.sh');
    writeFileSync(script, body);
    return spawnSync('bash', ['scripts/ci-lane-shell.sh', script], { encoding: 'utf8', env: { ...process.env, ...env } });
  };
  try {
    for (const env of [{ CI_TEST_LANE: 'hq', RUNNER_ENVIRONMENT: 'self-hosted' }, { CI_TEST_LANE: 'desktop', RUNNER_ENVIRONMENT: 'github-hosted' }, { CI_TEST_LANE: 'api 1/2' }]) {
      const ok = run('echo "lane $CI_TEST_LANE ran"\n', env);
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(ok.stdout, `lane ${env.CI_TEST_LANE} ran\n`);
      assert.equal(run('exit 3\n', env).status, 3);
      const stopped = run('false\necho after\n', env);
      assert.equal(stopped.status, 1);
      assert.equal(stopped.stdout, '');
      assert.equal(run('false | true\n', env).status, 1);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
