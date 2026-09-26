#!/usr/bin/env node
// report.mjs: fold every results/*.json of one label into <label>.json (all raw runs + summaries +
// build/machine/browser metadata) and print the markdown tables for BASELINE.md.
//
//   node report.mjs --label baseline --build ../perf/baseline-web [--out baseline.json] [--tables tables.md]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { cpus, totalmem, loadavg } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const LABEL = arg('--label', 'baseline');
const BUILD = resolve(here, arg('--build', '../perf/baseline-web'));
const OUT = resolve(here, arg('--out', `${LABEL}.json`));
const TABLES = resolve(here, arg('--tables', `${LABEL}-tables.md`));
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const sh = (cmd, args) => { try { return execFileSync(cmd, args).toString().trim(); } catch { return null; } };

// derived per-run metrics (added to every load run's metrics before summarising)
const derive = (r) => {
  const m = r.metrics;
  m.syncMs = m.synced != null && m.connected != null && r.mode === 'cold' ? Math.round(m.synced - m.connected) : null;
  m.dataAfterSyncMs = m.data != null && m.synced != null && r.mode === 'cold' ? Math.round(m.data - m.synced) : null;
  m.wireBytesDown = r.proxyStats?.bytesDown ?? null;
  m.syncErrorCount = Array.isArray(r.syncErrors) ? r.syncErrors.length : null;
  return r;
};
const resultsDir = resolve(here, 'results');
const files = existsSync(resultsDir) ? readdirSync(resultsDir).filter((f) => f.endsWith('.json')) : [];
const load = {};
const frames = {};
for (const f of files) {
  const d = read(join(resultsDir, f));
  if (d.label !== LABEL && !String(d.label).startsWith(`${LABEL}-`)) continue;
  if (d.kind === 'load') {
    d.runs.forEach(derive);
    const { summarize } = await import('./measure-load.mjs');
    const extra = ['syncMs', 'dataAfterSyncMs', 'wireBytesDown', 'syncErrorCount'];
    for (const mode of ['cold', 'warm']) {
      const runs = d.runs.filter((r) => r.mode === mode);
      if (!runs.length || !d.summary?.[mode]) continue;
      const s2 = summarize(runs.map((r) => ({ metrics: Object.fromEntries(Object.entries(r.metrics).map(([k, v]) => [k, v])) })));
      d.summary[mode] = { ...s2 };
      for (const k of extra) {
        const xs = runs.map((r) => r.metrics[k]).filter((x) => typeof x === 'number');
        const sorted = [...xs].sort((a, b) => a - b);
        const med = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
        const q = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(0.75 * sorted.length) - 1)] : null;
        d.summary[mode][k] = { median: med, p75: q, n: xs.length, of: runs.length, min: sorted[0] ?? null, max: sorted[sorted.length - 1] ?? null };
      }
    }
    const key = `${d.label}:${d.profile}`;
    load[key] = { file: `results/${f}`, label: d.label, profile: d.profile, profileSpec: d.profileSpec, mode: d.mode, url: d.url, capMs: d.capMs, server: d.server ?? null, summary: d.summary, runs: d.runs };
  } else if (d.kind === 'frames') {
    frames[`${d.label}:${d.profile}${d.only ? `:${d.only.join('+')}` : ''}`] = { file: `results/${f}`, label: d.label, profile: d.profile, profileSpec: d.profileSpec, url: d.url, boot: d.boot, summary: d.summary, runs: d.runs };
  }
}
const videosFile = resolve(here, 'videos', `${LABEL}-videos.json`);
const traceDir = resolve(here, 'traces');
const traces = existsSync(traceDir) ? readdirSync(traceDir).filter((f) => f.startsWith(LABEL) && f.endsWith('.summary.json')).map((f) => ({ file: `traces/${f}`, ...read(join(traceDir, f)) })) : [];
// the sampled JS profiles: the cold load (jsprofile.mjs) and each journey (profile-journey.mjs), top functions only
const profiles = existsSync(traceDir) ? readdirSync(traceDir).filter((f) => f.startsWith(LABEL) && (f.endsWith('.journey.json') || f.endsWith('.jsprofile.json'))).map((f) => {
  const d = read(join(traceDir, f));
  return { file: `traces/${f}`, journey: d.journey ?? 'cold load', what: d.what ?? null, profile: d.profile, wallMs: d.wallMs ?? null, calibration: d.calibration?.medianMs ?? null, targets: (d.targets ?? []).map((t) => ({ name: t.name, cpuprofile: t.file, sampledMs: t.sampledMs, topFunctions: t.topFunctions?.slice(0, 15), topUrls: t.topUrls?.slice(0, 8) })) };
}) : [];
const chromeVersion = Object.values(load)[0]?.runs?.[0]?.chrome ?? Object.values(frames)[0]?.boot?.chrome ?? null;

const doc = {
  label: LABEL,
  generatedAt: new Date().toISOString(),
  build: { dir: BUILD, sha: existsSync(join(BUILD, '.sha')) ? readFileSync(join(BUILD, '.sha'), 'utf8').trim() : null, env: 'VITE_NM_POWERSYNC_URL=http://127.0.0.1:58081 VITE_NM_DEV_USER=00000000-0000-0000-0000-000000000001' },
  machine: { cpu: sh('sysctl', ['-n', 'machdep.cpu.brand_string']), cores: cpus().length, memGB: Math.round(totalmem() / 2 ** 30), os: `${sh('sw_vers', ['-productName'])} ${sh('sw_vers', ['-productVersion'])}`, loadavgAtReport: loadavg().map((x) => Math.round(x * 100) / 100), swapAtReport: sh('sysctl', ['-n', 'vm.swapusage']) },
  chrome: chromeVersion,
  load, frames,
  videos: existsSync(videosFile) ? read(videosFile) : null,
  traces,
  profiles,
};
writeFileSync(OUT, JSON.stringify(doc, null, 1));

// ── tables ─────────────────────────────────────────────────────────────────────────────────
const cell = (s, unit = '', d = 0) => {
  if (!s || s.median == null) return 'n/a';
  const f = (x) => (x == null ? 'n/a' : `${Number(x).toFixed(d)}${unit}`);
  return `${f(s.median)} / ${f(s.p75)}${s.n < (s.of ?? s.n) ? ` (${s.n}/${s.of})` : ''}`;
};
const kb = (s) => (s && s.median != null ? { ...s, median: s.median / 1024, p75: s.p75 / 1024 } : s);
const lines = [];
const loadRows = [
  ['TTFB', 'ttfb', 'ms'], ['FCP', 'fcp', 'ms'], ['LCP (last candidate before the first input)', 'lcp', 'ms'], ['DOMContentLoaded', 'dcl', 'ms'], ['load event', 'load', 'ms'],
  ['time to shell', 'shell', 'ms'], ['time to composer (visible)', 'composerVisible', 'ms'], ['time to composer (typed char verified)', 'composerTyped', 'ms'], ['time to React shell', 'reactShell', 'ms'], ['time to React composer', 'reactComposer', 'ms'],
  ['time to data (first synced row painted)', 'data', 'ms'], ['replica open (db.ready)', 'dbReady', 'ms'], ['initial sync complete (hasSynced)', 'synced', 'ms'],
  ['long tasks (count)', 'longTaskCount', ''], ['long tasks (total ms)', 'longTaskMs', 'ms'], ['LoAF blocking (ms)', 'loafBlockingMs', 'ms'], ['CLS', 'cls', '', 3],
  ['requests', 'requests', ''], ['JS over the wire', 'bytesJs', ' KB', 0, kb], ['CSS over the wire', 'bytesCss', ' KB', 0, kb], ['WASM over the wire', 'bytesWasm', ' KB', 0, kb], ['JS+CSS+WASM', 'bytesJsCssWasm', ' KB', 0, kb], ['all bytes (incl. API)', 'bytesTotal', ' KB', 0, kb], ['sync WebSocket payload in (decompressed)', 'syncWsBytesIn', ' KB', 0, kb], ['sync WebSocket connections opened (1 = no reconnect)', 'syncWsConnections', ''], ['sync errors reported by the client', 'syncErrorCount', ''],
  ['· sync: connected → hasSynced (cold)', 'syncMs', 'ms'], ['· data painted after hasSynced (cold)', 'dataAfterSyncMs', 'ms'], ['bytes down on the wire, all (proxy count)', 'wireBytesDown', ' KB', 0, kb],
  ['main-thread CPU until data', 'mainThreadCpuMsToData', 'ms'], ['renderer-process CPU until data', 'rendererCpuMsToData', 'ms'], ['renderer calibration at start (1e7 loop)', 'calibMs', 'ms', 1], ['renderer calibration at end', 'calibEndMs', 'ms', 1],
];
for (const label of [...new Set(Object.values(load).map((l) => l.label))]) {
  for (const mode of ['cold', 'warm']) {
    const cols = ['none', 'broadband', 'fast4g'].map((p) => load[`${label}:${p}`]).filter((x) => x?.summary?.[mode]);
    if (!cols.length) continue;
    lines.push(`### Load, ${mode} (${label}): median / p75, ms unless marked`, '');
    lines.push(`| metric | ${cols.map((c) => `${c.profile} (n=${c.runs.filter((r) => r.mode === mode).length})`).join(' | ')} |`);
    lines.push(`|---|${cols.map(() => '---:').join('|')}|`);
    for (const [name, key, unit, d = 0, tf = (x) => x] of loadRows) lines.push(`| ${name} | ${cols.map((c) => cell(tf(c.summary[mode][key]), unit, d)).join(' | ')} |`);
    lines.push('');
  }
}
for (const label of [...new Set(Object.values(frames).map((f) => f.label))]) {
  const cols = ['none', 'cpu4x', 'fast4g'].map((p) => frames[`${label}:${p}`]).filter(Boolean);
  if (!cols.length) continue;
  const S = (c) => c.summary;
  lines.push(`### View switch (${label}): click → content painted, median / p75`, '');
  lines.push(`| journey | ${cols.map((c) => `${c.profile} (n=${c.runs.length})`).join(' | ')} |`, `|---|${cols.map(() => '---:').join('|')}|`);
  lines.push(`| Home → long thread (401 msgs), ms | ${cols.map((c) => cell(S(c).homeToLong?.ms, '')).join(' | ')} |`);
  lines.push(`| … p95 frame during it, ms | ${cols.map((c) => cell(S(c).homeToLong?.frameP95, '', 1)).join(' | ')} |`);
  lines.push(`| … LoAF blocking, ms | ${cols.map((c) => cell(S(c).homeToLong?.loafBlockingMs, '')).join(' | ')} |`);
  lines.push(`| long thread → reply thread (rail click), ms | ${cols.map((c) => cell(S(c).longToReply?.ms, '')).join(' | ')} |`);
  lines.push(`| … p95 frame during it, ms | ${cols.map((c) => cell(S(c).longToReply?.frameP95, '', 1)).join(' | ')} |`);
  lines.push(`| reply thread → long thread (rail click), ms | ${cols.map((c) => cell(S(c).replyToLong?.ms, '')).join(' | ')} |`);
  lines.push(`| … p95 frame during it, ms | ${cols.map((c) => cell(S(c).replyToLong?.frameP95, '', 1)).join(' | ')} |`, '');
  lines.push(`### Scroll the long thread (${label}): frame deltas of the main thread rAF, median / p75 across runs`, '');
  lines.push(`| pattern · metric | ${cols.map((c) => c.profile).join(' | ')} |`, `|---|${cols.map(() => '---:').join('|')}|`);
  for (const [k, name] of [['scrollUp', 'steady up'], ['scrollDown', 'steady down'], ['flingUp', 'fling up'], ['flingDown', 'fling down']]) {
    lines.push(`| ${name} · runs reaching the end | ${cols.map((c) => `${S(c)[k]?.completeRuns ?? 'n/a'}/${c.runs.length}`).join(' | ')} |`);
    lines.push(`| ${name} · px/s | ${cols.map((c) => cell(S(c)[k]?.pxPerSecond, '')).join(' | ')} |`);
    lines.push(`| ${name} · p50 / p95 / p99 frame (medians) | ${cols.map((c) => `${S(c)[k]?.frameP50?.median ?? 'n/a'} / ${S(c)[k]?.frameP95?.median ?? 'n/a'} / ${S(c)[k]?.frameP99?.median ?? 'n/a'}`).join(' | ')} |`);
    lines.push(`| ${name} · % frames > 16.7 ms | ${cols.map((c) => cell(S(c)[k]?.pctOver16_7, '%', 1)).join(' | ')} |`);
    lines.push(`| ${name} · % frames > 33.3 ms | ${cols.map((c) => cell(S(c)[k]?.pctOver33_3, '%', 1)).join(' | ')} |`);
    lines.push(`| ${name} · longest frame | ${cols.map((c) => cell(S(c)[k]?.longestFrame, '', 1)).join(' | ')} |`);
    lines.push(`| ${name} · LoAF blocking | ${cols.map((c) => cell(S(c)[k]?.loafBlockingMs, '')).join(' | ')} |`);
  }
  lines.push('');
  lines.push(`### Reply arrival (${label}): a ~6 KB markdown agent reply posted into the open thread, median / p75`, '');
  lines.push(`| metric | ${cols.map((c) => c.profile).join(' | ')} |`, `|---|${cols.map(() => '---:').join('|')}|`);
  lines.push(`| runs where the reply never painted (180 s) | ${cols.map((c) => `${S(c).replyFailed ?? 0}/${c.runs.length}`).join(' | ')} |`);
  lines.push(`| POST /v1/messages response, ms | ${cols.map((c) => cell(S(c).reply?.postResponseMs, '')).join(' | ')} |`);
  lines.push(`| POST sent → sync WebSocket frame carrying it, ms | ${cols.map((c) => cell(S(c).reply?.postToSocketFrameMs, '')).join(' | ')} |`);
  lines.push(`| sync frame → first line painted (the client's part), ms | ${cols.map((c) => cell(S(c).reply?.socketFrameToHeadPaintedMs, '')).join(' | ')} |`);
  lines.push(`| POST sent → row in the local replica (25 ms poll, upper bound), ms | ${cols.map((c) => cell(S(c).reply?.postToReplicaMs, '')).join(' | ')} |`);
  lines.push(`| row in the replica → first line painted, ms | ${cols.map((c) => cell(S(c).reply?.replicaToHeadPaintedMs, '')).join(' | ')} |`);
  lines.push(`| POST sent → first line painted, ms | ${cols.map((c) => cell(S(c).reply?.postToHeadPaintedMs, '')).join(' | ')} |`);
  lines.push(`| POST sent → last line painted, ms | ${cols.map((c) => cell(S(c).reply?.postToTailPaintedMs, '')).join(' | ')} |`);
  lines.push(`| first → last line painted, ms | ${cols.map((c) => cell(S(c).reply?.headToTailMs, '')).join(' | ')} |`);
  lines.push(`| p95 frame (POST → +1.5 s after painted), ms | ${cols.map((c) => cell(S(c).reply?.frameP95, '', 1)).join(' | ')} |`);
  lines.push(`| longest frame, ms | ${cols.map((c) => cell(S(c).reply?.longestFrame, '', 1)).join(' | ')} |`);
  lines.push(`| LoAF blocking, ms | ${cols.map((c) => cell(S(c).reply?.loafBlockingMs, '')).join(' | ')} |`, '');
}
writeFileSync(TABLES, lines.join('\n'));
console.log(lines.join('\n'));
console.error(`[report] wrote ${OUT} and ${TABLES}`);
