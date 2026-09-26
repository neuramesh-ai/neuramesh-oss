#!/usr/bin/env node
// measure-load.mjs: cold and warm loads of the browser client, driven over CDP, N runs, median + p75.
//
//   node measure-load.mjs --url http://127.0.0.1:5341/acme --profile fast4g --runs 5 --mode both \
//        [--cap-ms 240000] [--out results/load-fast4g.json] [--port 9341] [--label baseline]
//
// --mode cold  : fresh Chrome profile + fresh ?db= per run (empty HTTP cache, empty OPFS)
// --mode warm  : each warm run is preceded by a cold run in the same profile that waits for the
//                replica to finish syncing (recorded as a cold run too, flagged primed=true)
// --mode both  : the same as warm; both halves are reported
// A warm run relaunches Chrome on the same profile directory (disk cache + OPFS replica present,
// memory cache gone) and loads the same URL with the same ?db=, which is "the member comes back".
//
// Every number is a page-clock millisecond (performance.now(), zero = the navigation's timeOrigin)
// unless the name says otherwise. See README.md for the metric definitions.
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadavg, cpus, hostname } from 'node:os';
import { execFileSync } from 'node:child_process';
import { launchChrome, openPage, evaluate, closeChrome, sleep, PROFILES, median, p75, round, calibrate, waitForQuietMachine, perfMetrics, startNetProxy } from './cdp.mjs';
import { probeSource, READBACK, clsOf, assertProbesParse } from './probe.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const o = { url: 'http://127.0.0.1:5341/acme', profile: 'none', runs: 5, mode: 'both', capMs: 240_000, out: null, port: 9341, label: 'run', quietMs: 3000, width: 1440, height: 900, keepProfiles: false, maxLoad: null, maxCalibMs: 30, maxWaitMs: 1_800_000, shaping: 'proxy' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') o.url = argv[++i];
    else if (a === '--profile') o.profile = argv[++i];
    else if (a === '--runs') o.runs = Number(argv[++i]);
    else if (a === '--mode') o.mode = argv[++i];
    else if (a === '--cap-ms') o.capMs = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--label') o.label = argv[++i];
    else if (a === '--quiet-ms') o.quietMs = Number(argv[++i]);
    else if (a === '--keep-profiles') o.keepProfiles = true;
    else if (a === '--max-load') o.maxLoad = Number(argv[++i]);
    else if (a === '--max-calib-ms') o.maxCalibMs = argv[i + 1] === 'off' ? (i++, null) : Number(argv[++i]);
    else if (a === '--max-wait-ms') o.maxWaitMs = Number(argv[++i]);
    else if (a === '--shaping') o.shaping = argv[++i];
    else if (a === '--more') o.more = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  if (!PROFILES[o.profile]) throw new Error(`--profile must be one of ${Object.keys(PROFILES).join(', ')}`);
  if (!['cold', 'warm', 'both'].includes(o.mode)) throw new Error('--mode must be cold, warm or both');
  return o;
}

/** network accounting across the page and its workers */
class NetLog {
  constructor(cdp, sessions) {
    this.reqs = new Map();
    this.ws = { created: [], framesIn: 0, bytesIn: 0, framesOut: 0, bytesOut: 0 };
    this.docTs = null;
    this.off = cdp.on((m, p, sid) => {
      const who = sessions.get(sid)?.type ?? 'browser';
      if (m === 'Network.requestWillBeSent') {
        if (p.request.url.startsWith('data:') || p.request.url.startsWith('blob:')) return;
        const prev = this.reqs.get(p.requestId);
        if (prev && prev.url === p.request.url && !p.redirectResponse) return; // same request seen from a second session
        this.reqs.set(p.requestId, { url: p.request.url, method: p.request.method, type: p.type, who, t0: p.timestamp, status: null, mime: null, proto: null, cache: null, bytes: 0, finished: false, failed: null, tEnd: null });
        if (p.type === 'Document' && this.docTs == null) this.docTs = p.timestamp;
      } else if (m === 'Network.responseReceived') {
        const r = this.reqs.get(p.requestId); if (!r) return;
        r.status = p.response.status; r.mime = p.response.mimeType; r.proto = p.response.protocol;
        r.cache = p.response.fromDiskCache ? 'disk' : p.response.fromServiceWorker ? 'sw' : p.response.fromPrefetchCache ? 'prefetch' : null;
        r.encoding = p.response.headers?.['content-encoding'] ?? p.response.headers?.['Content-Encoding'] ?? null;
      } else if (m === 'Network.requestServedFromCache') {
        const r = this.reqs.get(p.requestId); if (r) r.cache = r.cache ?? 'memory';
      } else if (m === 'Network.loadingFinished') {
        const r = this.reqs.get(p.requestId); if (!r) return;
        r.finished = true; r.bytes = p.encodedDataLength; r.tEnd = p.timestamp;
      } else if (m === 'Network.loadingFailed') {
        const r = this.reqs.get(p.requestId); if (!r) return;
        r.failed = p.errorText; r.tEnd = p.timestamp;
      } else if (m === 'Network.webSocketCreated') {
        this.ws.created.push({ url: p.url, t: p.timestamp ?? null, wall: Date.now() });
      } else if (m === 'Network.webSocketFrameReceived') {
        this.ws.framesIn++; this.ws.bytesIn += (p.response?.payloadData ?? '').length;
      } else if (m === 'Network.webSocketFrameSent') {
        this.ws.framesOut++; this.ws.bytesOut += (p.response?.payloadData ?? '').length;
      }
    });
  }
  static kind(r) {
    const u = new URL(r.url);
    if (u.port === '58081') return 'sync';
    if (/^\/(v1|auth|connect)(\/|$)/.test(u.pathname)) return 'api';
    if (r.type === 'Document') return 'doc';
    const p = u.pathname.toLowerCase();
    if (p.endsWith('.js') || p.endsWith('.mjs') || /javascript/.test(r.mime ?? '')) return 'js';
    if (p.endsWith('.css') || r.mime === 'text/css') return 'css';
    if (p.endsWith('.wasm') || r.mime === 'application/wasm') return 'wasm';
    if (/\.(woff2?|ttf|otf)$/.test(p)) return 'font';
    if (/\.(png|svg|ico|jpg|jpeg|gif|webp)$/.test(p)) return 'img';
    return 'other';
  }
  /** totals, optionally only requests that finished before page-clock ms `untilMs` */
  summary(untilMs = null, navStartOffsetMs = 0) {
    const out = { requests: 0, bytes: { js: 0, css: 0, wasm: 0, font: 0, doc: 0, img: 0, api: 0, sync: 0, other: 0 }, count: { js: 0, css: 0, wasm: 0, font: 0, doc: 0, img: 0, api: 0, sync: 0, other: 0 }, fromCache: 0, revalidated304: 0, failed: 0, protocols: {} };
    for (const r of this.reqs.values()) {
      if (untilMs != null) {
        if (this.docTs == null || r.tEnd == null) continue;
        const endMs = (r.tEnd - this.docTs) * 1000 + navStartOffsetMs;
        if (endMs > untilMs) continue;
      }
      const k = NetLog.kind(r);
      out.requests++;
      out.count[k]++;
      out.bytes[k] += r.bytes || 0;
      if (r.cache) out.fromCache++;
      if (r.status === 304) out.revalidated304++;
      if (r.failed) out.failed++;
      if (r.proto) out.protocols[r.proto] = (out.protocols[r.proto] ?? 0) + 1;
    }
    out.bytes.jsCssWasm = out.bytes.js + out.bytes.css + out.bytes.wasm;
    out.bytes.total = Object.entries(out.bytes).filter(([k]) => k !== 'jsCssWasm').reduce((s, [, v]) => s + v, 0);
    return out;
  }
  list() {
    return [...this.reqs.values()].map((r) => ({ kind: NetLog.kind(r), url: r.url.replace(/^https?:\/\/127\.0\.0\.1:\d+/, '').slice(0, 110), who: r.who, status: r.status, proto: r.proto, cache: r.cache, enc: r.encoding, bytes: r.bytes, startMs: this.docTs != null ? Math.round((r.t0 - this.docTs) * 1000) : null, endMs: this.docTs != null && r.tEnd != null ? Math.round((r.tEnd - this.docTs) * 1000) : null, failed: r.failed }));
  }
}

const machineInfo = () => {
  let brand = '';
  try { brand = execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string']).toString().trim(); } catch { /* not a mac */ }
  return { cpu: brand || cpus()[0]?.model, cores: cpus().length, host: hostname() };
};

/** click the Home composer, type one character, and wait until the textarea holds it */
async function typeTest(cdp, page, expectOrigin) {
  const attempts = [];
  for (let i = 0; i < 6; i++) {
    const box = await evaluate(cdp, page, `(() => { const ta = document.querySelector('.hcomposer textarea'); if (!ta) return { origin: location.origin, none: true }; const r = ta.getBoundingClientRect(); return { origin: location.origin, x: r.x + Math.min(r.width / 2, 200), y: r.y + Math.min(r.height / 2, 16), w: r.width, h: r.height }; })()`, { awaitPromise: false, timeoutMs: 120_000 });
    if (box.origin !== expectOrigin) throw new Error(`probe on the wrong origin: ${box.origin}`);
    if (box.none || box.w < 1) { attempts.push('no textarea'); await sleep(200); continue; }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 }, page, 120_000);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 }, page, 120_000);
    await cdp.send('Input.insertText', { text: 'x' }, page, 120_000);
    // the value after React's commit: read it in the next frame
    const v = await evaluate(cdp, page, `new Promise((res) => requestAnimationFrame(() => { const ta = document.querySelector('.hcomposer textarea'); res({ origin: location.origin, value: ta ? ta.value : null, focused: !!ta && document.activeElement === ta, t: performance.now() }); }))`, { timeoutMs: 120_000 });
    attempts.push({ value: v.value, focused: v.focused, t: Math.round(v.t) });
    if (v.value && v.value.includes('x')) {
      // clear it again so a draft never survives into the next run
      for (let k = 0; k < (v.value.length || 1); k++) {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 }, page, 120_000);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 }, page, 120_000);
      }
      const after = await evaluate(cdp, page, `new Promise((res) => requestAnimationFrame(() => { const ta = document.querySelector('.hcomposer textarea'); res(ta ? ta.value : null); }))`, { timeoutMs: 120_000 });
      return { typedAt: v.t, attempts, clearedTo: after };
    }
    await sleep(250);
  }
  return { typedAt: null, attempts };
}

/** one load: returns the run record */
export async function loadOnce(args) {
  // the network shaper lives for exactly one run, and dies with it whatever happens
  const prof = PROFILES[args.profile];
  const useProxy = (args.shaping ?? 'proxy') === 'proxy' && !!prof.net;
  const proxy = useProxy ? await startNetProxy({ port: args.proxyPort ?? 9358, net: prof.net }) : null;
  try {
    const rec = await loadOnceShaped({ ...args, proxy });
    rec.shaping = useProxy ? 'proxy' : prof.net ? 'cdp' : 'none';
    if (proxy) rec.proxyStats = await proxy.stop();
    return rec;
  } finally {
    if (proxy) await proxy.stop().catch(() => null);
  }
}

async function loadOnceShaped({ url, profile, mode, profileDir, db, port, capMs, quietMs, waitSynced, width = 1440, height = 900, maxLoad = null, maxCalibMs = 30, maxWaitMs = 1_800_000, proxy = null }) {
  const gate = await waitForQuietMachine({ maxLoad, log: (m) => console.log(`[load] ${m}`) });
  // with the proxy shaping the network, CDP shapes nothing (it would shape HTTP twice): CPU only
  const prof = proxy ? { ...PROFILES[profile], net: null } : PROFILES[profile];
  const u = new URL(url);
  u.searchParams.set('db', db);
  const expectOrigin = u.origin;
  const workerCpu = [];
  // THE RENDERER-SPEED GATE: this machine is shared, and the same renderer runs a fixed JS loop in
  // 12 ms one minute and 130 ms the next (swap + other sessions). A run only starts when a fresh
  // renderer is fast (calibration median, normalised by the CPU throttle, <= maxCalibMs); it waits
  // and relaunches otherwise, up to maxWaitMs, and the record says what it saw.
  const gateTries = [];
  const gateT0 = Date.now();
  let chrome, cdp, page, sessions, calib, attachLog;
  for (;;) {
    chrome = await launchChrome({ port, userDataDir: profileDir, fresh: mode === 'cold', width, height, extraArgs: proxy ? proxy.chromeArgs : [] });
    ({ cdp, page, sessions, attachLog } = await openPage(chrome, {
      profile: prof,
      onSession: async (sid, info) => {
        // CPU throttling is per target; say whether a worker accepted it
        if (prof.cpu !== 1) {
          const r = await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu }, sid).then(() => 'applied').catch((e) => `refused: ${e.message}`);
          workerCpu.push({ type: info.type, url: info.url.split('/').pop(), cpuThrottle: r });
        }
      },
    }));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, page);
    calib = await calibrate(cdp, page);
    const norm = calib.medianMs / prof.cpu;
    gateTries.push({ at: new Date().toISOString(), calibMs: calib.medianMs, normalisedMs: round(norm), load1: round(loadavg()[0], 2) });
    if (maxCalibMs == null || norm <= maxCalibMs) break;
    if (Date.now() - gateT0 > maxWaitMs) { gateTries.push({ gaveUp: true }); break; }
    console.log(`[load] renderer slow (calibration ${calib.medianMs} ms at CPU ${prof.cpu}x, normalised ${round(norm)} > ${maxCalibMs}): waiting 30 s`);
    await closeChrome(chrome, cdp);
    await sleep(30_000);
  }
  gate.renderer = { maxCalibMs, tries: gateTries, waitedMs: Date.now() - gateT0 };
  const la0 = loadavg();
  const net = new NetLog(cdp, sessions);
  const signals = [];
  const consoleErrors = [];
  cdp.on((m, p) => {
    if (m === 'Runtime.bindingCalled' && p.name === '__nmPerfSignal') { try { signals.push({ ...JSON.parse(p.payload), wall: Date.now() }); } catch { /* bad payload */ } }
    if (m === 'Runtime.exceptionThrown') consoleErrors.push(String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text).slice(0, 200));
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') consoleErrors.push((p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  });
  await cdp.send('Performance.enable', { timeDomain: 'threadTicks' }, page).catch(() => cdp.send('Performance.enable', {}, page));
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: probeSource({ port: u.port }) }, page);
  await cdp.send('Runtime.addBinding', { name: '__nmPerfSignal' }, page);
  const wall0 = Date.now();
  await cdp.send('Page.navigate', { url: u.toString() }, page);

  let typed = null;
  let typing = null;
  let cpuAtData = null;
  let capHit = false;
  let lastState = null;
  for (;;) {
    await sleep(250);
    const elapsed = Date.now() - wall0;
    if (!typing && signals.some((s) => s.ev === 'composer')) typing = typeTest(cdp, page, expectOrigin).then((r) => { typed = r; }).catch((e) => { typed = { typedAt: null, error: e.message }; });
    if (!cpuAtData && signals.some((s) => s.ev === 'data')) cpuAtData = perfMetrics(cdp, page);
    let st = null;
    try {
      st = await evaluate(cdp, page, `(() => { const P = window.__nmPerf; if (!P) return { origin: location.origin, none: true }; const lt = P.longtasks[P.longtasks.length - 1]; return { origin: location.origin, now: performance.now(), marks: P.marks, lastLongTaskEnd: lt ? lt[0] + lt[1] : 0 }; })()`, { awaitPromise: false, timeoutMs: Math.max(5000, capMs - elapsed) });
    } catch (e) { st = { error: e.message }; }
    if (st?.origin && st.origin !== expectOrigin) throw new Error(`probe answered from ${st.origin}, expected ${expectOrigin}`);
    lastState = st;
    const m = st?.marks ?? {};
    const reached = m.shell != null && m.data != null && typed?.typedAt != null && (!waitSynced || m.synced != null);
    const quiet = st?.now != null && st.now - (st.lastLongTaskEnd ?? 0) >= quietMs;
    // the data signal can land while this iteration's evaluate is in flight: take the CPU reading
    // before leaving, or a page that was already quiet would exit without one
    if (!cpuAtData && (m.data != null || signals.some((x) => x.ev === 'data'))) cpuAtData = perfMetrics(cdp, page);
    if (reached && quiet) break;
    if (Date.now() - wall0 > capMs) { capHit = true; break; }
  }
  if (typing) await Promise.race([typing, sleep(5000)]);
  const cpuEnd = await perfMetrics(cdp, page);
  const calibEnd = await calibrate(cdp, page).catch(() => null);
  const cpuData = cpuAtData ? await cpuAtData : null;
  const rb = await evaluate(cdp, page, READBACK, { awaitPromise: false, timeoutMs: 120_000 });
  if (rb.origin !== expectOrigin) throw new Error(`readback from ${rb.origin}, expected ${expectOrigin}`);
  const la1 = loadavg();
  const windowMs = rb.now;
  const navOffset = 0;
  const lts = rb.longtasks;
  const loafs = rb.loafs;
  const lcpFinal = rb.lcp.length ? rb.lcp[rb.lcp.length - 1] : null;
  const fcp = rb.paints.find(([n]) => n === 'first-contentful-paint')?.[1] ?? null;
  const rec = {
    mode, profile, db, url: u.toString(), origin: rb.origin,
    startedAt: new Date(wall0).toISOString(), wallMs: Date.now() - wall0, windowMs: Math.round(windowMs), capHit,
    loadavg: { start: la0.map((x) => round(x, 2)), end: la1.map((x) => round(x, 2)) },
    chrome: chrome.version.Browser, chromeTranslated: chrome.translated, pageArch: rb.arch, workerCpuThrottle: workerCpu, calibration: calib, calibrationEnd: calibEnd, gate,
    cpuAtData: cpuData, cpuAtEnd: cpuEnd,
    metrics: {
      ttfb: round(rb.nav?.ttfb), fcp, lcp: lcpFinal?.t ?? null, dcl: round(rb.nav?.dcl), load: round(rb.nav?.load),
      shell: round(rb.marks.shell), composerVisible: round(rb.marks.composer), composerTyped: round(typed?.typedAt), data: round(rb.marks.data),
      reactShell: round(rb.marks.reactShell), reactComposer: round(rb.marks.reactComposer),
      dbReady: round(rb.marks.dbReady), connected: round(rb.marks.connected), synced: round(rb.marks.synced),
      longTaskCount: lts.length, longTaskMs: lts.reduce((s, [, d]) => s + d, 0), longTaskBlockingMs: lts.reduce((s, [, d]) => s + Math.max(0, d - 50), 0),
      loafCount: loafs.length, loafMs: loafs.reduce((s, l) => s + l.d, 0), loafBlockingMs: loafs.reduce((s, l) => s + l.b, 0),
      cls: clsOf(rb.shifts),
      mainThreadCpuMsToData: cpuData?.threadCpuMs ?? null, rendererCpuMsToData: cpuData?.processCpuMs ?? null, calibMs: calib.medianMs, calibEndMs: calibEnd?.medianMs ?? null,
      requests: null, bytesJs: null, bytesCss: null, bytesWasm: null, bytesJsCssWasm: null, bytesTotal: null,
    },
    dataWhat: rb.markInfo?.data ?? null,
    lcpEntry: lcpFinal,
    network: net.summary(),
    networkBeforeShell: rb.marks.shell != null ? net.summary(rb.marks.shell, navOffset) : null,
    networkBeforeData: rb.marks.data != null ? net.summary(rb.marks.data, navOffset) : null,
    websocket: net.ws,
    socketLife: rb.ws,
    syncErrors: rb.syncErrors,
    typed,
    domNodes: rb.domNodes,
    longestTasks: [...lts].sort((a, b) => b[1] - a[1]).slice(0, 8),
    longestLoafs: [...loafs].sort((a, b) => b.d - a.d).slice(0, 6),
    slowEvents: rb.events.slice(0, 20),
    probeErrors: rb.errors,
    consoleErrors: consoleErrors.slice(0, 20),
    signals: signals.map((s) => ({ ev: s.ev, t: Math.round(s.t) })),
    requestsList: net.list(),
    // each worker target: how long the harness held it paused (attach → resume), per step, relative to navigation
    attached: attachLog.map((a) => ({ type: a.type, url: a.url.split('/').pop(), atMs: a.attachedWall - wall0, pausedMs: a.pausedMs ?? null, steps: a.steps })),
    lastState,
  };
  const n = rec.network;
  Object.assign(rec.metrics, { requests: n.requests, bytesJs: n.bytes.js, bytesCss: n.bytes.css, bytesWasm: n.bytes.wasm, bytesJsCssWasm: n.bytes.jsCssWasm, bytesTotal: n.bytes.total, syncWsBytesIn: net.ws.bytesIn, syncWsFramesIn: net.ws.framesIn, syncWsConnections: net.ws.created.length });
  net.off();
  await closeChrome(chrome, cdp);
  return rec;
}

export const METRIC_KEYS = ['calibMs', 'calibEndMs', 'mainThreadCpuMsToData', 'rendererCpuMsToData', 'ttfb', 'fcp', 'lcp', 'dcl', 'load', 'shell', 'composerVisible', 'composerTyped', 'data', 'dbReady', 'connected', 'synced', 'longTaskCount', 'longTaskMs', 'longTaskBlockingMs', 'loafCount', 'loafMs', 'loafBlockingMs', 'cls', 'requests', 'bytesJs', 'bytesCss', 'bytesWasm', 'bytesJsCssWasm', 'bytesTotal', 'syncWsBytesIn', 'syncWsFramesIn', 'syncWsConnections'];

export function summarize(runs) {
  const out = {};
  for (const k of METRIC_KEYS) {
    const xs = runs.map((r) => r.metrics[k]);
    const got = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
    out[k] = { median: round(median(xs), k === 'cls' ? 4 : 1), p75: round(p75(xs), k === 'cls' ? 4 : 1), n: got.length, of: xs.length, min: got.length ? round(Math.min(...got), k === 'cls' ? 4 : 1) : null, max: got.length ? round(Math.max(...got), k === 'cls' ? 4 : 1) : null };
  }
  return out;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  assertProbesParse({ load: probeSource({ port: new URL(o.url).port }) });
  const out = o.out ?? resolve(here, 'results', `load-${o.label}-${o.profile}-${o.mode}.json`);
  mkdirSync(dirname(out), { recursive: true });
  const prior = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
  const doc = prior ?? { kind: 'load', label: o.label, profile: o.profile, profileSpec: PROFILES[o.profile], shaping: PROFILES[o.profile].net ? o.shaping : 'none', mode: o.mode, url: o.url, capMs: o.capMs, quietMs: o.quietMs, machine: machineInfo(), runs: [] };
  const save = () => {
    const cold = doc.runs.filter((r) => r.mode === 'cold');
    const warm = doc.runs.filter((r) => r.mode === 'warm');
    doc.summary = { cold: cold.length ? summarize(cold) : null, warm: warm.length ? summarize(warm) : null };
    writeFileSync(out, JSON.stringify(doc, null, 1));
  };
  const done = (mode) => doc.runs.filter((r) => r.mode === mode).length;
  const wantWarm = o.mode !== 'cold';
  // --more N: N runs on top of what the file already holds (for interleaving two builds)
  const target = o.more != null ? done('cold') + o.more : o.runs;
  for (let i = done('cold'); i < target; i++) {
    const stamp = `${o.label}-${o.profile}-${i + 1}-${Date.now()}`;
    const profileDir = resolve(here, 'profiles', `load-${stamp}`);
    const db = `perf-${stamp}`;
    console.log(`[load] ${o.profile} run ${i + 1}/${target}: cold`);
    const cold = await loadOnce({ url: o.url, profile: o.profile, mode: 'cold', profileDir, db, port: o.port, capMs: o.capMs, quietMs: o.quietMs, waitSynced: wantWarm, width: o.width, height: o.height, maxLoad: o.maxLoad, maxCalibMs: o.maxCalibMs, maxWaitMs: o.maxWaitMs, shaping: o.shaping });
    cold.run = i + 1; cold.primed = wantWarm;
    doc.runs.push(cold); save();
    console.log(`[load]   cold: shell ${cold.metrics.shell} composerTyped ${cold.metrics.composerTyped} data ${cold.metrics.data} synced ${cold.metrics.synced} lcp ${cold.metrics.lcp} longtasks ${cold.metrics.longTaskCount}/${cold.metrics.longTaskMs}ms bytes ${cold.metrics.bytesJsCssWasm} cap ${cold.capHit} load ${cold.loadavg.start[0]} calib ${cold.calibration.medianMs}ms cpu→data ${cold.metrics.mainThreadCpuMsToData}ms`);
    if (wantWarm) {
      if (cold.metrics.synced == null) console.log('[load]   WARNING: the cold run never finished syncing; the warm run starts from a partial replica');
      console.log(`[load] ${o.profile} run ${i + 1}/${target}: warm`);
      const warm = await loadOnce({ url: o.url, profile: o.profile, mode: 'warm', profileDir, db, port: o.port, capMs: o.capMs, quietMs: o.quietMs, waitSynced: false, width: o.width, height: o.height, maxLoad: o.maxLoad, maxCalibMs: o.maxCalibMs, maxWaitMs: o.maxWaitMs, shaping: o.shaping });
      warm.run = i + 1; warm.primedBySynced = cold.metrics.synced != null;
      doc.runs.push(warm); save();
      console.log(`[load]   warm: shell ${warm.metrics.shell} composerTyped ${warm.metrics.composerTyped} data ${warm.metrics.data} lcp ${warm.metrics.lcp} longtasks ${warm.metrics.longTaskCount}/${warm.metrics.longTaskMs}ms bytes ${warm.metrics.bytesJsCssWasm} cap ${warm.capHit} load ${warm.loadavg.start[0]} calib ${warm.calibration.medianMs}ms cpu→data ${warm.metrics.mainThreadCpuMsToData}ms`);
    }
    if (!o.keepProfiles) rmSync(profileDir, { recursive: true, force: true });
  }
  save();
  console.log(`[load] wrote ${out}`);
  console.log(JSON.stringify(doc.summary, null, 0).slice(0, 4000));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('[load] FAILED', e); process.exit(1); });
}
