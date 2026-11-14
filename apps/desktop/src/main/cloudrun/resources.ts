// The container's memory and CPU, read from its cgroup (README.md, invariant 1).
//
// On Cloud Run Worker Pools /proc/meminfo shows the host (MemTotal 3914 MiB under a 2 GiB limit),
// /proc/pressure does not exist, and os.cpus() answers 5 whatever the vCPU limit is. The agent box
// is charged to this same cgroup, so this is the one number that predicts an OOM kill.
import { readFileSync } from 'node:fs';

export type CgroupVersion = 1 | 2;

export interface MemorySample {
  usedBytes: number;
  limitBytes: number;
  usedMiB: number;
  limitMiB: number;
  /** used / limit, one decimal */
  memPct: number;
  /** null = no cgroup memory files, the numbers come from /proc/meminfo */
  cgroup: CgroupVersion | null;
}

/** cumulative counters at one instant; a CPU sample is the delta of two */
export interface CpuCounters {
  atMs: number;
  usageUsec: number | null;
  periods: number;
  throttled: number;
}

export interface CpuSample {
  /** the quota in cores, null = no quota */
  limitCores: number | null;
  /** usage over the interval as a percent of the quota, null without a quota or a usage counter */
  cpuPct: number | null;
  /** throttled periods / elapsed periods over the interval, null before the second sample */
  throttleRatio: number | null;
}

const MiB = 1024 * 1024;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** a sysfs scalar: null for absent, empty, `max`, or not a number */
export function parseScalar(text: string | null): number | null {
  if (text === null) return null;
  const t = text.trim();
  if (!t || t === 'max') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** one `key value` line of a cgroup stat file. Anchored per line: v1's memory.stat carries both
 *  `inactive_file` (this cgroup) and `total_inactive_file` (with children, the box included). */
export function statValue(stat: string | null, key: string): number | null {
  if (!stat) return null;
  const hit = new RegExp(`^${key} (\\d+)$`, 'm').exec(stat);
  return hit ? Number(hit[1]) : null;
}

export function meminfoValue(meminfo: string | null, key: string): number | null {
  if (!meminfo) return null;
  const hit = new RegExp(`^${key}:\\s+(\\d+) kB$`, 'm').exec(meminfo);
  return hit ? Number(hit[1]) * 1024 : null;
}

export interface MemoryInput {
  version: CgroupVersion | null;
  limit: number | null;
  usage: number | null;
  stat: string | null;
  memTotalBytes: number;
  memAvailableBytes: number | null;
}

/** used = usage - inactive file pages (reclaimable cache), against the limit. A v1 cgroup without a
 *  limit reports a page-rounded INT64_MAX, so a limit far above the host's RAM means "no limit". */
export function memorySample(input: MemoryInput): MemorySample {
  const { version, limit, usage, stat, memTotalBytes } = input;
  const limitBytes = limit !== null && limit > 0 && (memTotalBytes === 0 || limit < memTotalBytes * 4) ? limit : memTotalBytes;
  let usedBytes: number;
  let cgroup: CgroupVersion | null = null;
  if (version !== null && usage !== null) {
    const inactive = statValue(stat, version === 1 ? 'total_inactive_file' : 'inactive_file') ?? 0;
    usedBytes = Math.max(0, usage - inactive);
    cgroup = version;
  } else {
    usedBytes = Math.max(0, memTotalBytes - (input.memAvailableBytes ?? memTotalBytes));
  }
  return {
    usedBytes, limitBytes,
    usedMiB: Math.round(usedBytes / MiB),
    limitMiB: Math.round(limitBytes / MiB),
    memPct: limitBytes > 0 ? round1((usedBytes / limitBytes) * 100) : 0,
    cgroup,
  };
}

/** v2 `cpu.max`: "<quota> <period>" or "max <period>" */
export function parseCpuMax(text: string | null): number | null {
  if (!text) return null;
  const [quota, period] = text.trim().split(/\s+/);
  const q = parseScalar(quota ?? null);
  const p = parseScalar(period ?? null);
  return q !== null && p !== null && q > 0 && p > 0 ? q / p : null;
}

/** v1 `cpu.cfs_quota_us` / `cpu.cfs_period_us`; a quota of -1 is no quota */
export function cpuLimitV1(quota: number | null, period: number | null): number | null {
  return quota !== null && period !== null && quota > 0 && period > 0 ? quota / period : null;
}

export function cpuSample(prev: CpuCounters | null, next: CpuCounters, limitCores: number | null): CpuSample {
  if (!prev) return { limitCores, cpuPct: null, throttleRatio: null };
  const periods = next.periods - prev.periods;
  const throttleRatio = periods > 0 ? Math.round(((next.throttled - prev.throttled) / periods) * 1000) / 1000 : 0;
  const elapsedUsec = (next.atMs - prev.atMs) * 1000;
  const cpuPct = limitCores !== null && next.usageUsec !== null && prev.usageUsec !== null && elapsedUsec > 0
    ? round1(((next.usageUsec - prev.usageUsec) / (elapsedUsec * limitCores)) * 100)
    : null;
  return { limitCores, cpuPct, throttleRatio };
}

export interface ResourceReaderOptions {
  /** the cgroup mount (tests point it at fixtures through `read`) */
  root?: string;
  read?: (path: string) => string | null;
  now?: () => number;
}

const readOrNull = (path: string): string | null => {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
};

/** Cheap enough for the 250 ms guard: three small sysfs reads per memory sample. */
export class ContainerResources {
  private readonly root: string;
  private readonly read: (path: string) => string | null;
  private readonly now: () => number;
  private readonly memVersion: CgroupVersion | null;
  private readonly memTotalBytes: number;
  private prevCpu: CpuCounters | null = null;

  constructor(opts: ResourceReaderOptions = {}) {
    this.root = opts.root ?? '/sys/fs/cgroup';
    this.read = opts.read ?? readOrNull;
    this.now = opts.now ?? Date.now;
    this.memVersion = this.read(`${this.root}/memory/memory.usage_in_bytes`) !== null ? 1
      : this.read(`${this.root}/memory.current`) !== null ? 2 : null;
    this.memTotalBytes = meminfoValue(this.read('/proc/meminfo'), 'MemTotal') ?? 0;
  }

  get cgroupVersion(): CgroupVersion | null { return this.memVersion; }

  memory(): MemorySample {
    const v = this.memVersion;
    const r = (leaf: string): string | null => this.read(`${this.root}/${leaf}`);
    return memorySample({
      version: v,
      limit: parseScalar(v === 1 ? r('memory/memory.limit_in_bytes') : v === 2 ? r('memory.max') : null),
      usage: parseScalar(v === 1 ? r('memory/memory.usage_in_bytes') : v === 2 ? r('memory.current') : null),
      stat: v === 1 ? r('memory/memory.stat') : v === 2 ? r('memory.stat') : null,
      memTotalBytes: this.memTotalBytes,
      memAvailableBytes: v === null ? meminfoValue(this.read('/proc/meminfo'), 'MemAvailable') : null,
    });
  }

  /** the delta since the previous call */
  cpu(): CpuSample {
    const { counters, limitCores } = this.cpuCounters();
    const sample = cpuSample(this.prevCpu, counters, limitCores);
    this.prevCpu = counters;
    return sample;
  }

  private cpuCounters(): { counters: CpuCounters; limitCores: number | null } {
    const r = (leaf: string): string | null => this.read(`${this.root}/${leaf}`);
    const atMs = this.now();
    const v2 = r('cpu.max');
    if (v2 !== null) {
      const stat = r('cpu.stat');
      return {
        limitCores: parseCpuMax(v2),
        counters: { atMs, usageUsec: statValue(stat, 'usage_usec'), periods: statValue(stat, 'nr_periods') ?? 0, throttled: statValue(stat, 'nr_throttled') ?? 0 },
      };
    }
    // v1 mounts the controller as cpu,cpuacct with cpu and cpuacct as links to it, or apart
    const first = (leaves: string[]): string | null => { for (const l of leaves) { const t = r(l); if (t !== null) return t; } return null; };
    const stat = first(['cpu,cpuacct/cpu.stat', 'cpu/cpu.stat']);
    const usageNs = parseScalar(first(['cpuacct/cpuacct.usage', 'cpu,cpuacct/cpuacct.usage']));
    return {
      limitCores: cpuLimitV1(parseScalar(first(['cpu,cpuacct/cpu.cfs_quota_us', 'cpu/cpu.cfs_quota_us'])), parseScalar(first(['cpu,cpuacct/cpu.cfs_period_us', 'cpu/cpu.cfs_period_us']))),
      counters: { atMs, usageUsec: usageNs === null ? null : usageNs / 1000, periods: statValue(stat, 'nr_periods') ?? 0, throttled: statValue(stat, 'nr_throttled') ?? 0 },
    };
  }
}
