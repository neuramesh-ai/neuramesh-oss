import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContainerResources, cpuLimitV1, cpuSample, memorySample, parseCpuMax, parseScalar, statValue } from './resources';

// Measured on a Cloud Run Worker Pool, 2026-10-19: MemTotal shows the host, not the 2 GiB limit
const MEMINFO = 'MemTotal:        4007936 kB\nMemFree:         1000000 kB\nMemAvailable:    3500000 kB\n';
const GiB = 1024 * 1024 * 1024;

const V1: Record<string, string> = {
  '/proc/meminfo': MEMINFO,
  '/cg/memory/memory.usage_in_bytes': '1610612736\n',
  '/cg/memory/memory.limit_in_bytes': '2147483648\n',
  // both keys exist on v1: total_ includes child cgroups (the box)
  '/cg/memory/memory.stat': 'cache 300000000\ninactive_file 5242880\ntotal_cache 300000000\ntotal_inactive_file 104857600\n',
  '/cg/cpu,cpuacct/cpu.cfs_quota_us': '200000\n',
  '/cg/cpu,cpuacct/cpu.cfs_period_us': '100000\n',
  '/cg/cpu,cpuacct/cpu.stat': 'nr_periods 100\nnr_throttled 10\nthrottled_time 5000000\n',
  '/cg/cpuacct/cpuacct.usage': '0\n',
};

const V2: Record<string, string> = {
  '/proc/meminfo': MEMINFO,
  '/cg/memory.current': '1073741824\n',
  '/cg/memory.max': '2147483648\n',
  '/cg/memory.stat': 'anon 700000000\nfile 300000000\nactive_file 1000\ninactive_file 268435456\n',
  '/cg/cpu.max': '100000 100000\n',
  '/cg/cpu.stat': 'usage_usec 1000000\nuser_usec 800000\nsystem_usec 200000\nnr_periods 50\nnr_throttled 0\nthrottled_usec 0\n',
};

const reader = (files: Record<string, string>) => (path: string): string | null => files[path] ?? null;

test('parseScalar: max, empty and garbage are null', () => {
  assert.equal(parseScalar('2147483648\n'), 2147483648);
  assert.equal(parseScalar('max\n'), null);
  assert.equal(parseScalar(''), null);
  assert.equal(parseScalar('x'), null);
  assert.equal(parseScalar(null), null);
});

test('statValue: anchored per line, so inactive_file never reads total_inactive_file', () => {
  const stat = V1['/cg/memory/memory.stat']!;
  assert.equal(statValue(stat, 'inactive_file'), 5242880);
  assert.equal(statValue(stat, 'total_inactive_file'), 104857600);
  assert.equal(statValue(stat, 'missing'), null);
});

test('memorySample v1: used = usage - total_inactive_file, against the cgroup limit, not MemTotal', () => {
  const m = memorySample({ version: 1, limit: 2 * GiB, usage: 1610612736, stat: V1['/cg/memory/memory.stat']!, memTotalBytes: 4007936 * 1024, memAvailableBytes: null });
  assert.equal(m.usedBytes, 1505755136);
  assert.equal(m.usedMiB, 1436);
  assert.equal(m.limitMiB, 2048);
  assert.equal(m.memPct, 70.1);
  assert.equal(m.cgroup, 1);
});

test('memorySample: a v1 "no limit" (page-rounded INT64_MAX) falls back to MemTotal', () => {
  const m = memorySample({ version: 1, limit: 9223372036854771712, usage: GiB, stat: '', memTotalBytes: 4 * GiB, memAvailableBytes: null });
  assert.equal(m.limitMiB, 4096);
  assert.equal(m.memPct, 25);
});

test('memorySample v2: inactive_file, and memory.max "max" means MemTotal', () => {
  const m = memorySample({ version: 2, limit: 2 * GiB, usage: GiB, stat: V2['/cg/memory.stat']!, memTotalBytes: 4007936 * 1024, memAvailableBytes: null });
  assert.equal(m.usedMiB, 768);
  assert.equal(m.memPct, 37.5);
  const unlimited = memorySample({ version: 2, limit: parseScalar('max'), usage: GiB, stat: '', memTotalBytes: 4 * GiB, memAvailableBytes: null });
  assert.equal(unlimited.limitMiB, 4096);
});

test('memorySample: usage never goes negative when the cache exceeds the charge', () => {
  assert.equal(memorySample({ version: 2, limit: GiB, usage: 10, stat: 'inactive_file 999\n', memTotalBytes: 4 * GiB, memAvailableBytes: null }).usedBytes, 0);
});

test('memorySample: no cgroup files falls back to /proc/meminfo', () => {
  const m = memorySample({ version: null, limit: null, usage: null, stat: null, memTotalBytes: 4 * GiB, memAvailableBytes: 3 * GiB });
  assert.equal(m.usedMiB, 1024);
  assert.equal(m.cgroup, null);
});

test('CPU limit: the quota, not os.cpus()', () => {
  assert.equal(parseCpuMax('200000 100000\n'), 2);
  assert.equal(parseCpuMax('max 100000\n'), null);
  assert.equal(parseCpuMax(null), null);
  assert.equal(cpuLimitV1(100000, 100000), 1);
  assert.equal(cpuLimitV1(-1, 100000), null);
});

test('cpuSample: usage against the quota and the throttled share of elapsed periods', () => {
  const s = cpuSample({ atMs: 0, usageUsec: 0, periods: 100, throttled: 10 }, { atMs: 1000, usageUsec: 1_500_000, periods: 110, throttled: 15 }, 2);
  assert.deepEqual(s, { limitCores: 2, cpuPct: 75, throttleRatio: 0.5 });
  assert.deepEqual(cpuSample(null, { atMs: 0, usageUsec: 0, periods: 0, throttled: 0 }, 2), { limitCores: 2, cpuPct: null, throttleRatio: null });
  assert.equal(cpuSample({ atMs: 0, usageUsec: 0, periods: 5, throttled: 0 }, { atMs: 1000, usageUsec: 10, periods: 5, throttled: 0 }, null).throttleRatio, 0);
});

test('ContainerResources v1: detects v1 and reads memory and CPU deltas', () => {
  const files = { ...V1 };
  let now = 0;
  const r = new ContainerResources({ root: '/cg', read: reader(files), now: () => now });
  assert.equal(r.cgroupVersion, 1);
  const m = r.memory();
  assert.equal(m.limitMiB, 2048);
  assert.equal(m.memPct, 70.1);
  assert.equal(r.cpu().throttleRatio, null);
  now = 1000;
  files['/cg/cpu,cpuacct/cpu.stat'] = 'nr_periods 110\nnr_throttled 15\nthrottled_time 9000000\n';
  files['/cg/cpuacct/cpuacct.usage'] = '1500000000\n';
  assert.deepEqual(r.cpu(), { limitCores: 2, cpuPct: 75, throttleRatio: 0.5 });
});

test('ContainerResources v2: falls back to the unified hierarchy', () => {
  const files = { ...V2 };
  let now = 0;
  const r = new ContainerResources({ root: '/cg', read: reader(files), now: () => now });
  assert.equal(r.cgroupVersion, 2);
  assert.equal(r.memory().usedMiB, 768);
  r.cpu();
  now = 2000;
  files['/cg/cpu.stat'] = 'usage_usec 2000000\nnr_periods 70\nnr_throttled 5\nthrottled_usec 1000\n';
  assert.deepEqual(r.cpu(), { limitCores: 1, cpuPct: 50, throttleRatio: 0.25 });
});
