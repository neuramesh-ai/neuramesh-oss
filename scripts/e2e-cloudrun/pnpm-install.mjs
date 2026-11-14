#!/usr/bin/env node
// PHASE 0.6: A REAL REPO'S `pnpm install` ON A CLOUD RUN MACHINE, AT S, M AND L. It takes a fresh e2e
// runner (born at S), and at each size: clones a public pnpm repo into the agent box through a box
// terminal, runs a cold `pnpm install` (no store, no node_modules), and samples the machine's memory from
// its status heartbeats (the container cgroup, which the box is charged to) every 2 s. Then it removes
// the clone (so the grow drain stays small) and grows the machine one size through the resize door.
// It parks the machine at the end.
//
//   NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET, NM_RELAY_URL, NM_RELAY_TOKEN_KEY  (cloudbuild-pnpm-install.yaml)
//   PNPM_REPO    default https://github.com/vuejs/core (pnpm, about 1,000 packages)
//   PNPM_SIZES   default S,M,L
//   OUT          default ./pnpm-install-out
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RelayConnection } from './lib/relay.mjs';
import { Api } from './lib/api.mjs';

const env = (k, d) => process.env[k] ?? d;
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`pnpm-install: set ${k}`); process.exit(2); } return v; };
const API = new Api({ url: need('NM_API_URL'), fleetSecret: need('FLEET_SECRET'), actorSecret: env('NM_ACTOR_SECRET', '') });
const RELAY = need('NM_RELAY_URL');
const KEY = need('NM_RELAY_TOKEN_KEY');
const REPO = env('PNPM_REPO', 'https://github.com/vuejs/core');
const SIZES = env('PNPM_SIZES', 'S,M,L').split(',');
const OUT = resolve(env('OUT', 'pnpm-install-out'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = `r6mach-pnpm-${Date.now().toString(36)}`;
const results = [];
const report = { tag, repo: REPO, results };
let ids = null;

/** sample the machine row while `work` runs: the peak used MiB and memPct the heartbeats reported */
async function sampled(machine, work) {
  let peak = { usedMiB: 0, memPct: 0 }; let limit = null; let done = false; let samples = 0;
  const loop = (async () => {
    while (!done) {
      const m = await API.machine(machine).catch(() => null);
      if (m) { samples += 1; limit = m.limit_mib; if ((m.used_mib ?? 0) > peak.usedMiB) peak = { usedMiB: m.used_mib, memPct: m.mem_pct }; }
      await sleep(2_000);
    }
  })();
  try { return { out: await work(), peak, limit, samples }; } finally { done = true; await loop; }
}

try {
  ids = await API.freshWorkspace(tag);
  let m = await API.running(ids.machineId);
  for (const [i, size] of SIZES.entries()) {
    if (i > 0) {
      const before = m.epoch;
      const asked = await API.door('POST', `/internal/machines/${ids.machineId}/resize`, {});
      m = await API.running(ids.machineId, (r) => r.epoch > before && r.drain_state === null && r.size_class === asked.to, 600_000);
    }
    const relay = await RelayConnection.open({ url: RELAY, key: KEY, user: ids.userId, machine: ids.machineId });
    const term = await relay.terminal();
    const idle = await API.machine(ids.machineId);
    const clone = await term.run(`export COREPACK_ENABLE_DOWNLOAD_PROMPT=0; rm -rf /root/bench /root/.local/share/pnpm /root/.cache/pnpm; mkdir -p /root/bench && cd /root/bench && s=$(date +%s%N); git clone -q --depth 1 ${REPO} repo && echo "CLONE_MS=$(( ($(date +%s%N)-s)/1000000 ))"`, 300_000);
    const install = await sampled(ids.machineId, () => term.run(`cd /root/bench/repo && s=$(date +%s%N); corepack pnpm install --frozen-lockfile --reporter=silent >/tmp/pnpm.log 2>&1; rc=$?; echo "INSTALL_MS=$(( ($(date +%s%N)-s)/1000000 )) RC=$rc"; tail -3 /tmp/pnpm.log; du -sm node_modules 2>/dev/null | cut -f1 | sed 's/^/NODE_MODULES_MB=/'; ls node_modules/.pnpm 2>/dev/null | wc -l | sed 's/^/PACKAGES=/'`, 1_500_000));
    const num = (re, s) => { const x = re.exec(s); return x ? Number(x[1]) : null; };
    const row = {
      size, epoch: m.epoch, limitMiB: install.limit ?? m.limit_mib, idleUsedMiB: idle.used_mib,
      cloneMs: num(/CLONE_MS=(\d+)/, clone.out), installMs: num(/INSTALL_MS=(\d+)/, install.out.out), rc: num(/RC=(\d+)/, install.out.out),
      nodeModulesMB: num(/NODE_MODULES_MB=(\d+)/, install.out.out), packages: num(/PACKAGES=(\d+)/, install.out.out),
      peakUsedMiB: install.peak.usedMiB, peakMemPct: install.peak.memPct, samples: install.samples, tail: install.out.out.slice(-300),
    };
    results.push(row);
    console.log(`  ${size}: install ${row.installMs} ms rc=${row.rc}, peak ${row.peakUsedMiB} MiB of ${row.limitMiB} (${row.peakMemPct}%), node_modules ${row.nodeModulesMB} MB, ${row.packages} packages`);
    // the clone and the store go before the grow drain, so the snapshot stays small
    await term.run('rm -rf /root/bench /root/.local/share/pnpm /root/.cache/pnpm /root/.cache/node/corepack', 120_000);
    term.close(); relay.close();
  }
} catch (e) {
  report.error = String(e?.stack ?? e).slice(0, 800);
  console.log(`  FAIL ${report.error}`);
} finally {
  if (ids) { try { const p = await API.park(ids.machineId); report.parked = { epoch: p.epoch }; } catch (e) { report.parked = { error: e.message }; } }
}
report.ids = ids && { user: ids.userId, workspace: ids.workspaceId, machine: ids.machineId };
writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(report.error || results.some((r) => r.rc !== 0) ? 1 : 0);
