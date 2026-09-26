#!/usr/bin/env node
// trace.mjs: record one Chrome performance trace of a load, and summarize the main thread.
//
//   node trace.mjs --url http://127.0.0.1:5341/acme --profile fast4g --seconds 30 --out traces/fast4g-cold.json
//   node trace.mjs --summarize traces/fast4g-cold.json            # summary only, from a saved trace
//
// Categories (the performance panel's core set): devtools.timeline, v8.execute,
// disabled-by-default-devtools.timeline, blink.user_timing, loading. Add --cpu-profile to include
// disabled-by-default-v8.cpu_profiler (sampled stacks: self time per JS function).
//
// The summary finds the page's renderer main thread (CrRendererMain of the process that loaded
// the url), builds the nesting of its complete events, and reports:
//   - top-level task time, long tasks (>50 ms) count + total, and the longest ones with what ran
//   - self time by event kind (scripting, compile, style, layout, paint, GC, parse)
//   - the top 10 costs by URL + function (FunctionCall / EvaluateScript / module evaluate / compile)
//   - the same for every worker thread that did real work (the wa-sqlite worker)
import { writeFileSync, readFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, openPage, closeChrome, sleep, PROFILES, evaluate, calibrate, startNetProxy } from './cdp.mjs';
import { probeSource } from './probe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CATS = ['devtools.timeline', 'v8.execute', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'loading'];

function args(argv) {
  const o = { url: 'http://127.0.0.1:5341/acme', profile: 'fast4g', seconds: 30, out: null, summarize: null, cpuProfile: false, port: 9351, width: 1440, height: 900 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') o.url = argv[++i];
    else if (a === '--profile') o.profile = argv[++i];
    else if (a === '--seconds') o.seconds = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--summarize') o.summarize = argv[++i];
    else if (a === '--cpu-profile') o.cpuProfile = true;
    else if (a === '--port') o.port = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

/** record a trace of a cold load; returns the path written */
export async function recordTrace({ url, profile = 'fast4g', seconds = 30, out, cpuProfile = false, port = 9351, width = 1440, height = 900, maxCalibMs = 30 }) {
  const full = PROFILES[profile];
  if (!full) throw new Error(`unknown profile ${profile}`);
  // the network is shaped by netproxy (HTTP and the sync WebSocket), the CPU by CDP (see measure-load.mjs)
  const proxy = full.net ? await startNetProxy({ port: 9356, net: full.net }) : null;
  const prof = { ...full, net: null };
  // the renderer-speed gate (see measure-load.mjs): relaunch until a fresh renderer is fast
  let chrome, cdp, page, calib;
  const gate = [];
  const g0 = Date.now();
  for (;;) {
    chrome = await launchChrome({ port, userDataDir: resolve(here, 'profiles', `trace-${Date.now()}`), fresh: true, width, height, extraArgs: proxy ? proxy.chromeArgs : [] });
    ({ cdp, page } = await openPage(chrome, { profile: prof, onSession: async (sid) => { if (prof.cpu !== 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu }, sid).catch(() => null); } }));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, page);
    calib = await calibrate(cdp, page);
    gate.push(calib.medianMs);
    if (maxCalibMs == null || calib.medianMs / prof.cpu <= maxCalibMs || Date.now() - g0 > 1_800_000) break;
    console.log(`[trace] renderer slow (calibration ${calib.medianMs} ms at CPU ${prof.cpu}x): waiting 30 s`);
    await closeChrome(chrome, cdp);
    await sleep(30_000);
  }
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: probeSource({ port: new URL(url).port }) }, page);
  const cats = [...CATS, ...(cpuProfile ? ['disabled-by-default-v8.cpu_profiler'] : [])];
  await cdp.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: cats, excludedCategories: ['*'] } });
  const u = new URL(url);
  if (!u.searchParams.has('db')) u.searchParams.set('db', `trace${Date.now()}`);
  const t0 = Date.now();
  await cdp.send('Page.navigate', { url: u.toString() }, page);
  // stop 3 s after the first synced row is painted, or at the cap
  let marks = null;
  while (Date.now() - t0 < seconds * 1000) {
    await sleep(500);
    marks = await evaluate(cdp, page, `(() => ({ origin: location.origin, arch: window.__nmPerf?.arch ?? null, marks: window.__nmPerf?.marks ?? null }))()`, { awaitPromise: false, timeoutMs: seconds * 1000 }).catch(() => null);
    if (marks?.marks?.data != null) { await sleep(3000); break; }
  }
  const done = cdp.waitFor((m) => m === 'Tracing.tracingComplete', 120_000);
  await cdp.send('Tracing.end');
  const { params } = await done;
  mkdirSync(dirname(out), { recursive: true });
  const ws = createWriteStream(out);
  for (;;) {
    const chunk = await cdp.send('IO.read', { handle: params.stream, size: 4 << 20 });
    ws.write(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data);
    if (chunk.eof) break;
  }
  await new Promise((r) => ws.end(r));
  await cdp.send('IO.close', { handle: params.stream }).catch(() => null);
  await closeChrome(chrome, cdp);
  const proxyStats = proxy ? await proxy.stop() : null;
  return { out, url: u.toString(), profile, shaping: proxy ? 'proxy' : 'none', proxyStats, seconds, wallMs: Date.now() - t0, categories: cats, calibration: calib, gate, marks: marks?.marks ?? null, origin: marks?.origin ?? null, pageArch: marks?.arch ?? null, chromeTranslated: chrome.translated, loadavg: (await import('node:os')).loadavg() };
}

const SCRIPT_EVENTS = new Set(['FunctionCall', 'EvaluateScript', 'v8.evaluateModule', 'v8.compile', 'v8.compileModule', 'v8.produceModuleCache', 'v8.produceCache', 'CacheScript', 'TimerFire', 'FireAnimationFrame', 'EventDispatch', 'RunMicrotasks', 'V8.Execute', 'v8.run', 'v8.callFunction', 'XHRReadyStateChange', 'XHRLoad', 'FireIdleCallback', 'v8.newInstance']);
const KIND = (name) => {
  if (/^(v8\.compile|v8\.compileModule|V8\.CompileCode|v8\.parseOnBackground|V8\.ScriptCompiler|v8\.produceModuleCache|v8\.produceCache|CacheScript)/.test(name)) return 'compile';
  if (/GC|Scavenge|Mark|Sweep|MinorGC|MajorGC|BlinkGC/.test(name)) return 'gc';
  if (SCRIPT_EVENTS.has(name) || /^v8\./.test(name)) return 'scripting';
  if (name === 'UpdateLayoutTree' || name === 'RecalculateStyles' || name === 'ParseAuthorStyleSheet' || name === 'ScheduleStyleRecalculation') return 'style';
  if (name === 'Layout' || name === 'UpdateLayerTree' || name === 'IntersectionObserverController::computeIntersections') return 'layout';
  if (/Paint|Layerize|Composite|Rasterize|Commit|Decode|PrePaint|UpdateLayer/.test(name)) return 'paint';
  if (name === 'ParseHTML' || name === 'ResourceSendRequest' || name === 'ResourceReceiveResponse' || name === 'ResourceFinish' || name === 'ResourceReceivedData') return 'loading';
  if (name === 'RunTask' || name === 'ThreadControllerImpl::RunTask' || name === 'ThreadPool_RunTask') return 'task';
  return 'other';
};

function attributionOf(ev) {
  const d = ev.args?.data ?? ev.args?.beginData ?? {};
  const url = d.url || d.scriptName || d.fileName || ev.args?.fileName || '';
  const fn = d.functionName || '';
  const line = d.lineNumber ?? d.startLine;
  const short = url ? url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '') : '';
  if (ev.name === 'EvaluateScript' || ev.name === 'v8.evaluateModule') return `${ev.name} ${short || '(inline)'}`;
  if (ev.name === 'v8.compile' || ev.name === 'v8.compileModule') return `${ev.name} ${short || '(inline)'}`;
  if (ev.name === 'FunctionCall') return `FunctionCall ${fn || '(anonymous)'} @ ${short || '?'}${line != null ? `:${line}` : ''}`;
  if (ev.name === 'TimerFire' || ev.name === 'FireAnimationFrame' || ev.name === 'EventDispatch' || ev.name === 'FireIdleCallback') return `${ev.name}${d.type ? ` ${d.type}` : ''}`;
  return ev.name;
}

/** nest the complete events of one thread and compute self time */
function nest(events) {
  const evs = events.filter((e) => e.ph === 'X' && typeof e.dur === 'number').sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const stack = [];
  for (const e of evs) {
    e._children = 0;
    e._depth = 0;
    while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) { e._parent = parent; e._depth = parent._depth + 1; }
    stack.push(e);
  }
  for (const e of evs) { if (e._parent && e.ts + e.dur <= e._parent.ts + e._parent.dur + 1) e._parent._children += e.dur; }
  for (const e of evs) e._self = Math.max(0, e.dur - e._children);
  return evs;
}

function summarizeThread(events, t0) {
  const evs = nest(events);
  const top = evs.filter((e) => e._depth === 0 && (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask'));
  const longTasks = top.filter((e) => e.dur >= 50_000);
  const selfByKind = {};
  const selfByName = {};
  for (const e of evs) {
    if (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') continue;
    const k = KIND(e.name);
    selfByKind[k] = (selfByKind[k] ?? 0) + e._self;
    selfByName[e.name] = (selfByName[e.name] ?? 0) + e._self;
  }
  // attribution: every script-entry event (outermost of its kind) owns its total duration
  const attr = new Map();
  for (const e of evs) {
    if (!['FunctionCall', 'EvaluateScript', 'v8.evaluateModule', 'v8.compile', 'v8.compileModule', 'TimerFire', 'FireAnimationFrame', 'EventDispatch', 'FireIdleCallback'].includes(e.name)) continue;
    // skip a FunctionCall nested in another FunctionCall/EvaluateScript: the outer one owns it
    let p = e._parent; let nested = false;
    while (p) { if (['FunctionCall', 'EvaluateScript', 'v8.evaluateModule'].includes(p.name) && ['FunctionCall', 'EvaluateScript', 'v8.evaluateModule'].includes(e.name)) { nested = true; break; } p = p._parent; }
    if (nested) continue;
    if ((e.name === 'TimerFire' || e.name === 'FireAnimationFrame' || e.name === 'EventDispatch') ) {
      // attribute to the function it called, when there is one
      continue;
    }
    const key = attributionOf(e);
    const a = attr.get(key) ?? { key, totalMs: 0, count: 0, maxMs: 0, firstAtMs: null };
    a.totalMs += e.dur / 1000; a.count++; a.maxMs = Math.max(a.maxMs, e.dur / 1000);
    if (a.firstAtMs == null) a.firstAtMs = (e.ts - t0) / 1000;
    attr.set(key, a);
  }
  const whatRan = (task) => {
    // the heaviest script entry inside a long task
    const inside = evs.filter((e) => e.ts >= task.ts && e.ts + e.dur <= task.ts + task.dur + 1 && e !== task && ['FunctionCall', 'EvaluateScript', 'v8.evaluateModule', 'v8.compile', 'v8.compileModule', 'UpdateLayoutTree', 'Layout', 'MajorGC', 'MinorGC', 'ParseHTML', 'Paint'].includes(e.name));
    inside.sort((a, b) => b.dur - a.dur);
    return inside.slice(0, 3).map((e) => `${attributionOf(e)} ${(e.dur / 1000).toFixed(0)}ms`);
  };
  const ms = (us) => Math.round(us / 100) / 10;
  return {
    topLevelTasks: top.length,
    busyMs: ms(top.reduce((s, e) => s + e.dur, 0)),
    longTasks: { count: longTasks.length, totalMs: ms(longTasks.reduce((s, e) => s + e.dur, 0)), blockingMs: ms(longTasks.reduce((s, e) => s + e.dur - 50_000, 0)) },
    longest: [...longTasks].sort((a, b) => b.dur - a.dur).slice(0, 12).map((t) => ({ atMs: ms(t.ts - t0), durMs: ms(t.dur), ran: whatRan(t) })),
    selfByKindMs: Object.fromEntries(Object.entries(selfByKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, ms(v)])),
    selfByEventMs: Object.fromEntries(Object.entries(selfByName).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => [k, ms(v)])),
    top10ByUrlFunction: [...attr.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, 10).map((a) => ({ what: a.key, totalMs: Math.round(a.totalMs * 10) / 10, count: a.count, maxMs: Math.round(a.maxMs * 10) / 10, firstAtMs: Math.round(a.firstAtMs) })),
    top10ByUrl: (() => {
      const byUrl = new Map();
      for (const a of attr.values()) { const m = /@ ([^:]+)|(?:EvaluateScript|v8\.evaluateModule|v8\.compile|v8\.compileModule) (\S+)/.exec(a.key); const url = (m && (m[1] || m[2])) || a.key; const v = byUrl.get(url) ?? { url, totalMs: 0, count: 0 }; v.totalMs += a.totalMs; v.count += a.count; byUrl.set(url, v); }
      return [...byUrl.values()].sort((x, y) => y.totalMs - x.totalMs).slice(0, 10).map((v) => ({ ...v, totalMs: Math.round(v.totalMs * 10) / 10 }));
    })(),
  };
}

export function summarizeTrace(path, { urlHint = '5341' } = {}) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const events = Array.isArray(raw) ? raw : raw.traceEvents;
  // thread names
  const threadName = new Map();
  const processName = new Map();
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name') threadName.set(`${e.pid}:${e.tid}`, e.args?.name);
    if (e.ph === 'M' && e.name === 'process_name') processName.set(e.pid, e.args?.name);
  }
  // the renderer that navigated to our url: TracingStartedInBrowser frames, or the first ParseHTML/navigation with the url
  let pagePid = null;
  for (const e of events) {
    if (e.name === 'TracingStartedInBrowser' || e.name === 'FrameCommittedInBrowser' || e.name === 'CommitLoad') {
      const frames = e.args?.data?.frames ?? (e.args?.data ? [e.args.data] : []);
      for (const f of frames) if (String(f.url ?? '').includes(urlHint) && (f.processId || e.pid)) pagePid = f.processId ?? e.pid;
    }
    if (!pagePid && e.name === 'ParseHTML' && String(e.args?.beginData?.url ?? '').includes(urlHint)) pagePid = e.pid;
  }
  if (!pagePid) {
    // fall back: the renderer with the most EvaluateScript time
    const byPid = new Map();
    for (const e of events) if (e.name === 'EvaluateScript' && e.dur) byPid.set(e.pid, (byPid.get(e.pid) ?? 0) + e.dur);
    pagePid = [...byPid.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  const mainKey = [...threadName.entries()].find(([k, n]) => k.startsWith(`${pagePid}:`) && n === 'CrRendererMain')?.[0];
  if (!mainKey) throw new Error(`no CrRendererMain for pid ${pagePid}`);
  const mainTid = Number(mainKey.split(':')[1]);
  // time zero: the navigation start of our document
  const nav = events.find((e) => e.pid === pagePid && (e.name === 'navigationStart' || e.name === 'NavigationStart') && String(e.args?.data?.documentLoaderURL ?? e.args?.data?.url ?? '').includes(urlHint));
  const t0 = nav?.ts ?? Math.min(...events.filter((e) => e.pid === pagePid && e.ts > 0).map((e) => e.ts));
  const byThread = new Map();
  for (const e of events) {
    if (e.pid !== pagePid) continue;
    const k = e.tid;
    if (!byThread.has(k)) byThread.set(k, []);
    byThread.get(k).push(e);
  }
  const main = summarizeThread(byThread.get(mainTid) ?? [], t0);
  const workers = [];
  for (const [tid, evs] of byThread) {
    const name = threadName.get(`${pagePid}:${tid}`) ?? '';
    if (tid === mainTid || !/Worker/i.test(name)) continue;
    const s = summarizeThread(evs, t0);
    if (s.busyMs > 20 || Object.values(s.selfByKindMs).reduce((a, b) => a + b, 0) > 20) workers.push({ thread: name, tid, ...s });
  }
  // user timing marks, paint milestones
  const marks = events.filter((e) => e.pid === pagePid && (e.cat?.includes('blink.user_timing') || ['firstContentfulPaint', 'largestContentfulPaint::Candidate', 'domContentLoadedEventEnd', 'loadEventEnd', 'firstPaint'].includes(e.name)))
    .map((e) => ({ name: e.name, atMs: Math.round((e.ts - t0) / 100) / 10 })).slice(0, 60);
  return { trace: path, pagePid, mainThread: mainKey, t0, main, workers, marks, events: events.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  let path = o.summarize;
  let meta = null;
  if (!path) {
    path = o.out ?? resolve(here, 'traces', `${o.profile}-cold-${Date.now()}.json`);
    meta = await recordTrace({ ...o, out: path });
    console.log(`[trace] wrote ${path} (${meta.wallMs} ms wall)`);
  }
  const s = summarizeTrace(path);
  const outSummary = path.replace(/\.json$/, '.summary.json');
  writeFileSync(outSummary, JSON.stringify({ meta, ...s }, null, 2));
  console.log(JSON.stringify({ meta, ...s }, null, 2).slice(0, 12000));
  console.log(`[trace] summary → ${outSummary}`);
}
