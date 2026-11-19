#!/usr/bin/env node
// Keep packages serial within each runner; parallelise the expensive workspaces across runners.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const isolated = new Map([['apps/desktop', 'desktop'], ['apps/hq', 'hq'], ['packages/control-api', 'api']]);
// A sharded lane runs on that many runners, each with its own Postgres, through vitest's --shard.
// The lane holds one workspace, because the shard flag goes to its test script.
const shards = new Map([['api', 2]]);

export function inventory(root = process.cwd()) {
  // Ask pnpm for the actual workspace membership, including the public tree's smaller set.
  return JSON.parse(execFileSync('pnpm', ['-r', 'list', '--depth', '-1', '--json'], { cwd: root, encoding: 'utf8' }))
    .filter(p => resolve(p.path) !== resolve(root))
    .map(p => ({ ...JSON.parse(readFileSync(resolve(p.path, 'package.json'), 'utf8')), path: relative(root, p.path).replaceAll('\\', '/') }));
}

export function lanes(workspaces, hqOnly = false) {
  const result = new Map(), names = new Set();
  for (const p of workspaces) {
    assert.match(p.name, /^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/);
    assert.ok(!names.has(p.name), 'Duplicate workspace name'); names.add(p.name);
    if (!p.scripts?.test || (hqOnly && p.path === 'apps/desktop')) continue;
    const lane = isolated.get(p.path) ?? 'shared';
    if (!result.has(lane)) result.set(lane, []);
    result.get(lane).push(p.name);
  }
  assert.ok(result.size, 'No test workspaces discovered');
  return Object.fromEntries([...result].sort(([a], [b]) => a.localeCompare(b)));
}

// The matrix names: a lane, or one name per shard ('api 1/2'), as the job name shows it.
export function matrixLanes(workspaces, hqOnly = false) {
  return Object.keys(lanes(workspaces, hqOnly)).flatMap(lane => {
    const total = shards.get(lane);
    return total ? Array.from({ length: total }, (_, i) => `${lane} ${i + 1}/${total}`) : [lane];
  });
}

export function command(kind, workspaces, { hqOnly = false, lane } = {}) {
  assert.ok(['test', 'typecheck', 'build'].includes(kind), 'Unknown CI command');
  const args = ['-r'], extra = [];
  if (kind === 'test') {
    const [, name, index, total] = /^([a-z]+)(?: ([1-9]\d*)\/([1-9]\d*))?$/.exec(lane ?? '') ?? [];
    const packages = lanes(workspaces, hqOnly)[name];
    assert.ok(packages?.length, 'Unknown or empty test lane');
    assert.equal(Number(total ?? 0), shards.get(name) ?? 0, 'A sharded lane needs its shard, and only a sharded lane has one');
    if (total) {
      assert.ok(Number(index) <= Number(total), 'Unknown shard');
      assert.equal(packages.length, 1, 'A sharded lane holds one workspace');
      extra.push(`--shard=${index}/${total}`);
    }
    args.push('--workspace-concurrency=1', '--fail-if-no-match');
    for (const p of packages) args.push('--filter', p);
  } else if (hqOnly) args.push('--filter=!@neuramesh/desktop');
  return ['pnpm', ...args, kind, ...extra];
}

export function validationTasks(focused, staticNeeded) {
  assert.ok(['true', 'false'].includes(focused));
  assert.ok(['true', 'false'].includes(staticNeeded));
  return focused === 'true' ? ['static'] : ['typecheck', 'static', 'build'];
}

export function gate(results, focused, staticNeeded) {
  assert.ok(['true', 'false'].includes(focused), 'Missing CI scope decision');
  assert.ok(['true', 'false'].includes(staticNeeded), 'Missing static scope decision');
  const expected = { scope: 'success', 'public-scan': 'success' };
  expected.validation = focused === 'true' && staticNeeded !== 'true' ? 'skipped' : 'success';
  expected.tests = focused === 'true' ? 'skipped' : 'success';
  for (const [name, verdict] of Object.entries(expected)) assert.equal(results[name]?.result, verdict, `${name} must be ${verdict}`);
}

function main() {
  const kind = process.argv[2];
  if (kind === 'gate') {
    gate(JSON.parse(process.env.CI_RESULTS), process.env.CI_ONLY, process.env.CI_STATIC);
    console.log('All required CI lanes passed'); return;
  }
  if (kind === 'validation-matrix') {
    console.log(JSON.stringify({ task: validationTasks(process.env.CI_ONLY, process.env.CI_STATIC) })); return;
  }
  const workspaces = inventory(), hqOnly = process.env.CI_HQ_ONLY === 'true';
  if (kind === 'matrix') {
    console.log(JSON.stringify({ include: matrixLanes(workspaces, hqOnly).map(lane => ({ lane })) })); return;
  }
  const [program, ...args] = command(kind, workspaces, { hqOnly, lane: process.env.CI_TEST_LANE });
  console.log(JSON.stringify({ program, args }));
  const r = spawnSync(program, args, { stdio: 'inherit' });
  if (r.error) throw r.error;
  process.exitCode = r.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
