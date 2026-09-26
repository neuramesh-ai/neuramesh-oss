#!/usr/bin/env node
// measure-frames.mjs: the in-session journeys, measured frame by frame.
//
//   node measure-frames.mjs --url http://127.0.0.1:5341/acme --profile none|cpu4x|fast4g --runs 5 \
//        [--out results/frames-none.json] [--port 9341] [--db frames-none] [--api http://127.0.0.1:8841]
//
// One browser session per profile (a warm replica in a kept profile directory), then N iterations of:
//   1. view switch  Home → the perf-lab long thread (401 messages): click on its Home row → the
//                   thread's last message painted
//   2. scroll       that thread, steady (100 px wheel steps every 16 ms) top and back, then a
//                   fling-like pattern (decaying wheel deltas) up and down
//   3. view switch  long thread → the reply-target thread: click on its rail row → its first message painted
//   4. reply        POST a ~6 KB markdown agent reply into the open thread through the control-api
//                   (POST /v1/messages, x-nm-actor = rex) → its HEAD token painted, its TAIL token painted;
//                   clock-aligned (page performance.timeOrigin + rAF time vs the POST's Date.now())
// Frame windows (see frames-probe.mjs) cover each step. A step that cannot find its element throws.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadavg } from 'node:os';
import { launchChrome, openPage, evaluate, closeChrome, sleep, PROFILES, median, p75, round, calibrate, waitForQuietMachine, perfMetrics } from './cdp.mjs';
import { probeSource, assertProbesParse } from './probe.mjs';
import { framesProbeSource } from './frames-probe.mjs';
import { App, SEED, LONG_TITLE, REPLY_TITLE, LONG_LAST, REPLY_FIRST, replyBody } from './app.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const o = { url: 'http://127.0.0.1:5341/acme', profile: 'none', runs: 5, out: null, port: 9341, db: null, api: 'http://127.0.0.1:8841', maxLoad: null, label: 'baseline', only: null, maxCalibMs: 30, maxWaitMs: 1_800_000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') o.url = argv[++i];
    else if (a === '--profile') o.profile = argv[++i];
    else if (a === '--runs') o.runs = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--db') o.db = argv[++i];
    else if (a === '--api') o.api = argv[++i];
    else if (a === '--max-load') o.maxLoad = Number(argv[++i]);
    else if (a === '--label') o.label = argv[++i];
    else if (a === '--only') o.only = argv[++i].split(',');
    else if (a === '--no-replica-poll') o.noReplicaPoll = true;
    else if (a === '--max-calib-ms') o.maxCalibMs = argv[i + 1] === 'off' ? (i++, null) : Number(argv[++i]);
    else if (a === '--max-wait-ms') o.maxWaitMs = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  if (!PROFILES[o.profile]) throw new Error(`--profile must be one of ${Object.keys(PROFILES).join(', ')}`);
  o.db = o.db ?? `frames-${o.label}-${o.profile}`;
  return o;
}

// the PowerSync WebSocket, seen from the browser: when did the frame carrying a given message id
// arrive? (CDP frame timestamps are monotonic seconds; requestWillBeSent carries both clocks, so
// the latest one gives the monotonic → wall offset)
const wsWatch = { id: null, atWall: null, monoToWallMs: null, frames: 0, log: null };
function watchSyncSocket(cdp) {
  cdp.on((m, p) => {
    if (m === 'Network.requestWillBeSent' && typeof p.wallTime === 'number' && typeof p.timestamp === 'number') wsWatch.monoToWallMs = p.wallTime * 1000 - p.timestamp * 1000;
    if (m === 'Network.webSocketFrameReceived' && wsWatch.id) {
      wsWatch.frames++;
      const d = String(p.response?.payloadData ?? '');
      const text = p.response?.opcode === 2 ? Buffer.from(d, 'base64').toString('latin1') : d;
      const at = wsWatch.monoToWallMs != null ? p.timestamp * 1000 + wsWatch.monoToWallMs : null;
      // every frame in the reply window: when, how big, and what kind (the sync line's own key)
      const kind = /checkpoint_complete|checkpoint_diff|partial_checkpoint_complete|token_expires_in|checkpoint|data/.exec(text)?.[0] ?? 'other';
      if (wsWatch.log && wsWatch.log.length < 200) wsWatch.log.push({ at, bytes: text.length, kind, hasId: text.includes(wsWatch.id) });
      if (wsWatch.atWall == null && text.includes(wsWatch.id) && at != null) wsWatch.atWall = at;
    }
  });
}

const frames = {
  start: (app, label) => app.js(`window.__nmFrames.start(${JSON.stringify(label)})`),
  stop: (app) => app.read(`window.__nmFrames.stop()`, { awaitPromise: false }),
};

/** click an element and time it to the first frame in which `paint` holds */
async function timedSwitch(app, { finder, paint, label, settleMs = 1000 }) {
  const b = await app.boxOf(finder);
  await app.settleFrames();
  await frames.start(app, label);
  // install the watcher and let it return BEFORE the click is sent, so input can never overtake it
  await app.js(`(window.__nmWait = window.__nmFrames.waitPainted(${JSON.stringify(paint)}), true)`);
  await app.click(b);
  const w = await app.read(`window.__nmWait`, { awaitPromise: true, timeoutMs: 240_000 });
  if (w.timeout) throw new Error(`${label}: nothing painted within ${paint.timeoutMs} ms`);
  await sleep(settleMs);
  const f = await frames.stop(app);
  const down = await app.js(`window.__nmFrames.lastPointerDown`);
  return { clickAt: round(down), paintedAt: round(w.paintedAt), insertedAt: round(w.insertedAt), ms: down != null ? round(w.paintedAt - down) : null, count: w.count, frames: f, rowText: b.text };
}

/** wheel the thread from where it is to the top (dir -1) or the bottom (+1) */
async function scrollRun(app, { dir, pattern, label, maxEvents = 4000, maxWallMs = 60_000 }) {
  const s0 = await app.scrollState();
  if (s0.none) throw new Error('no scroll container for the thread (.convomsgs or a scrollable ancestor)');
  if (!s0.hitIsScroller) console.log(`[frames] note: the wheel point (${s0.x},${Math.round(s0.y)}) lands on ${s0.hit}, not the scroller itself`);
  const target = dir < 0 ? 0 : s0.height - s0.client;
  await frames.start(app, label);
  const t0 = Date.now();
  let events = 0;
  let last = s0;
  const pending = [];
  const wheel = (dy) => { events++; pending.push(app.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: s0.x, y: s0.y, deltaX: 0, deltaY: dy }, app.page, 180_000).catch(() => null)); };
  const reached = (st) => (dir < 0 ? st.top <= 0 : st.top >= st.height - st.client - 2);
  if (pattern === 'steady') {
    let stuck = 0;
    while (events < maxEvents && Date.now() - t0 < maxWallMs) {
      wheel(100 * dir);
      await sleep(16);
      if (events % 8 === 0) {
        const st = await app.scrollState();
        if (reached(st)) { last = st; break; }
        stuck = st.top === last.top ? stuck + 1 : 0;
        last = st;
        if (stuck > 30) break; // not moving: reported below as an incomplete scroll
      }
    }
  } else {
    // fling: flicks of decaying deltas (a trackpad throw), until the end is reached
    let flicks = 0;
    while (flicks < 40 && Date.now() - t0 < maxWallMs) {
      flicks++;
      let d = 900;
      while (d > 12) { wheel(Math.round(d) * dir); d *= 0.86; await sleep(16); }
      await sleep(120);
      const st = await app.scrollState();
      last = st;
      if (reached(st)) break;
    }
  }
  await Promise.all(pending);
  await sleep(400);
  const f = await frames.stop(app);
  const s1 = await app.scrollState();
  const distance = Math.abs(s1.top - s0.top);
  const wallMs = Date.now() - t0;
  return { pattern, dir: dir < 0 ? 'up' : 'down', events, wallMs, capped: wallMs >= maxWallMs, wheelAt: { x: s0.x, y: Math.round(s0.y), hit: s0.hit, hitIsScroller: s0.hitIsScroller }, from: s0.top, to: s1.top, target: Math.round(target), height: s1.height, client: s1.client, distance, pxPerSecond: Math.round(distance / (wallMs / 1000)), complete: reached(s1), frames: f };
}

async function replyArrival(app, { api, token, label, replicaPoll = true }) {
  const body = replyBody(token);
  const id = randomUUID();
  const origin = await app.read(`({ origin: location.origin, timeOrigin: performance.timeOrigin, now: performance.now() })`);
  await frames.start(app, label);
  await app.js(`(window.__nmHead = window.__nmFrames.waitPainted({ sel: '.convomsgs', text: ${JSON.stringify(`${token}-HEAD`)}, timeoutMs: 180000 }), window.__nmTail = window.__nmFrames.waitPainted({ sel: '.convomsgs', text: ${JSON.stringify(`${token}-TAIL`)}, timeoutMs: 180000 }), true)`);
  // when the row lands in the local replica (a primary-key poll every 25 ms on the dev-user
  // handle): splits POST → paint into server + sync (→ replica) and the client's render (→ paint)
  if (!replicaPoll) await app.js(`(window.__nmReplica = Promise.resolve({ origin: location.origin, skipped: true }), true)`);
  else await app.js(`(window.__nmReplica = (async () => { const t0 = performance.now(); for (;;) { const r = await window.__nmDb.getOptional('SELECT id FROM messages WHERE id = ?', [${JSON.stringify(id)}]); if (r) return { origin: location.origin, at: performance.now() }; if (performance.now() - t0 > 180000) return { origin: location.origin, timeout: true }; await new Promise((res) => setTimeout(res, 25)); } })(), true)`);
  const replica = app.read(`window.__nmReplica`, { awaitPromise: true, timeoutMs: 240_000 });
  const head = app.read(`window.__nmHead`, { awaitPromise: true, timeoutMs: 240_000 });
  const tail = app.read(`window.__nmTail`, { awaitPromise: true, timeoutMs: 240_000 });
  wsWatch.id = id; wsWatch.atWall = null; wsWatch.frames = 0; wsWatch.log = [];
  const tPost = Date.now();
  const r = await fetch(`${api}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'agent', id: 'ba49f62a-3562-4bbb-a5ba-930259b1dc8c' }) },
    body: JSON.stringify({ id, workspace: SEED.workspace, channel: SEED.channel, threadId: SEED.replyThread.id, body }),
  });
  const tResp = Date.now();
  const posted = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`reply POST failed ${r.status}: ${JSON.stringify(posted).slice(0, 200)}`);
  const [h, t, rp] = await Promise.all([head, tail, replica]);
  if (h.timeout || t.timeout) throw new Error(`${label}: the reply never painted (head ${!h.timeout}, tail ${!t.timeout})`);
  await sleep(1500);
  const f = await frames.stop(app);
  const wall = (pageMs) => (pageMs == null ? null : origin.timeOrigin + pageMs);
  const fromPost = (pageMs) => (pageMs == null ? null : round(wall(pageMs) - tPost));
  // the frame window from the POST to 1.5 s after the tail painted
  const win = await app.read(`window.__nmFrames.summary(${tPost - origin.timeOrigin}, ${t.paintedAt + 1500})`, { awaitPromise: false });
  const inReplica = rp.timeout || rp.skipped ? null : fromPost(rp.at);
  const wsMs = wsWatch.atWall == null ? null : round(wsWatch.atWall - tPost);
  const frameLog = (wsWatch.log ?? []).map((f) => ({ ...f, at: f.at == null ? null : round(f.at - tPost) }));
  wsWatch.id = null; wsWatch.log = null;
  return { token, bytes: Buffer.byteLength(body), messageId: id, syncFramesAfterPost: frameLog.filter((f) => f.at == null || f.at <= fromPost(t.paintedAt) + 500), postResponseMs: tResp - tPost, postToSocketFrameMs: wsMs, socketFrameToHeadPaintedMs: wsMs == null ? null : round(fromPost(h.paintedAt) - wsMs), postToReplicaMs: inReplica, replicaToHeadPaintedMs: inReplica == null ? null : round(fromPost(h.paintedAt) - inReplica), postToHeadInsertedMs: fromPost(h.insertedAt), postToHeadPaintedMs: fromPost(h.paintedAt), postToTailPaintedMs: fromPost(t.paintedAt), headToTailMs: round(t.paintedAt - h.paintedAt), frames: win, framesWholeWindow: f };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  assertProbesParse({ load: probeSource({ port: new URL(o.url).port }), frames: framesProbeSource({ port: new URL(o.url).port }), recents: App.railRecentsPrefSource(new URL(o.url).port) });
  const out = o.out ?? resolve(here, 'results', `frames-${o.label}-${o.profile}${o.only ? `-${o.only.join('+')}` : ''}.json`);
  mkdirSync(dirname(out), { recursive: true });
  const prof = PROFILES[o.profile];
  const u = new URL(o.url);
  u.searchParams.set('db', o.db);
  const origin = u.origin;
  const doc = { kind: 'frames', label: o.label, profile: o.profile, only: o.only, profileSpec: prof, url: u.toString(), seed: SEED, startedAt: new Date().toISOString(), runs: [], boot: null };
  const save = () => { doc.summary = summarizeFrames(doc.runs); writeFileSync(out, JSON.stringify(doc, null, 1)); };

  const gate = await waitForQuietMachine({ maxLoad: o.maxLoad, log: (m) => console.log(`[frames] ${m}`) });
  const chrome = await launchChrome({ port: o.port, userDataDir: resolve(here, 'profiles', `frames-${o.label}-${o.profile}`), fresh: false });
  const workerCpu = [];
  const { cdp, page } = await openPage(chrome, {
    profile: prof,
    onSession: async (sid, info) => { if (prof.cpu !== 1) workerCpu.push({ type: info.type, cpuThrottle: await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu }, sid).then(() => 'applied').catch((e) => `refused: ${e.message}`) }); },
  });
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, page);
    const calib = await calibrate(cdp, page);
    if (o.maxCalibMs != null && calib.medianMs / prof.cpu > o.maxCalibMs) console.log(`[frames] note: the renderer is slow at start (calibration ${calib.medianMs} ms at CPU ${prof.cpu}x); each iteration waits for a fast renderer`);
    await cdp.send('Performance.enable', { timeDomain: 'threadTicks' }, page);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: probeSource({ port: u.port }) }, page);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: framesProbeSource({ port: u.port }) }, page);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: App.railRecentsPrefSource(u.port) }, page);
    const app = new App(cdp, page, origin);
    watchSyncSocket(cdp);
    const tNav = Date.now();
    await cdp.send('Page.navigate', { url: u.toString() }, page);
    console.log(`[frames] ${o.profile}: loading ${u} (calib ${calib.medianMs} ms, load ${loadavg()[0].toFixed(1)})`);
    const homeMs = await app.waitFor(`!!(${App.homeRow(LONG_TITLE)}) && !!window.__nmDb?.currentStatus?.hasSynced`, { timeoutMs: 900_000, everyMs: 500, what: 'Home with the perf-lab row, replica synced' });
    // a kept profile catches up on everything written since it last ran: wait until the sync is
    // connected and not downloading (hasSynced alone is true from the stored state at once)
    const caughtUp = await app.waitFor(`(() => { const s = window.__nmDb?.currentStatus; return !!s?.connected && !s?.dataFlowStatus?.downloading; })()`, { timeoutMs: 300_000, everyMs: 500, what: 'the sync caught up' }).catch(() => null);
    // let the boot settle: no long task for 3 s, or 60 s at most
    const quiet = await app.waitFor(`(() => { const P = window.__nmPerf; const lt = P?.longtasks?.[P.longtasks.length - 1]; return !lt || performance.now() - (lt[0] + lt[1]) > 3000; })()`, { timeoutMs: 60_000, everyMs: 500 }).catch(() => null);
    // native or refuse: the page's own architecture, from its secure context
    const arch = await app.js(`navigator.userAgentData ? navigator.userAgentData.getHighEntropyValues(['architecture', 'bitness']).then((v) => v.architecture + '/' + v.bitness) : Promise.resolve('unknown')`, { awaitPromise: true });
    if (process.platform === 'darwin' && !String(arch).startsWith('arm')) throw new Error(`the page reports architecture ${arch}: Chrome runs under Rosetta, refusing to measure`);
    doc.boot = { syncCaughtUpWaitMs: caughtUp, pageArch: arch, chromeTranslated: chrome.translated, navToHomeMs: Date.now() - tNav, homeWaitMs: homeMs, quietWaitMs: quiet, calibration: calib, gate, loadavg: loadavg().map((x) => round(x, 2)), workerCpu, chrome: chrome.version.Browser, cpu: await perfMetrics(cdp, page) };
    doc.boot.railSwitchedToRecents = await app.ensureRailRecents();
    console.log(`[frames] booted in ${doc.boot.navToHomeMs} ms`);
    save();
    for (let i = 1; i <= o.runs; i++) {
      await app.ensureHome();
      // the renderer-speed gate, in the app page itself (quiet between iterations)
      const gateT0 = Date.now();
      const tries = [];
      for (;;) {
        const c = await calibrate(cdp, page);
        tries.push(c.medianMs);
        if (o.maxCalibMs == null || c.medianMs / prof.cpu <= o.maxCalibMs || Date.now() - gateT0 > o.maxWaitMs) break;
        console.log(`[frames] #${i}: renderer slow (calibration ${c.medianMs} ms at CPU ${prof.cpu}x): waiting 30 s`);
        await sleep(30_000);
      }
      const run = { run: i, startedAt: new Date().toISOString(), loadavg: loadavg().map((x) => round(x, 2)), calibMs: tries[tries.length - 1], gate: { tries, waitedMs: Date.now() - gateT0 } };
      await sleep(500);
      const want = (k) => !o.only || o.only.includes(k);
      // ORDER: the switches and the reply first, the scroll last. A scroll saturates the main thread
      // for tens of seconds at CPU 4x, and a reply measured right after it measured the backlog.
      if (want('switch') || want('scroll') || want('reply')) {
        run.homeToLong = await timedSwitch(app, { finder: App.homeRow(LONG_TITLE), paint: { sel: '.convomsgs', text: LONG_LAST, timeoutMs: 180_000 }, label: `home→long #${i}` });
        console.log(`[frames] #${i} home→long ${run.homeToLong.ms} ms (p95 frame ${run.homeToLong.frames.p95}, loaf blocking ${run.homeToLong.frames.loafBlockingMs} ms)`);
        await sleep(800);
      }
      if (want('switch') || want('reply')) {
        run.railPagesOpened = await app.revealRailRow(REPLY_TITLE);
        run.longToReply = await timedSwitch(app, { finder: App.railRow(REPLY_TITLE), paint: { sel: '.convomsgs', text: REPLY_FIRST, timeoutMs: 180_000 }, label: `long→reply #${i}` });
        console.log(`[frames] #${i} long→reply ${run.longToReply.ms} ms (p95 frame ${run.longToReply.frames.p95})`);
        const onReply = await app.js(App.onThread(REPLY_TITLE, REPLY_FIRST));
        if (!onReply) throw new Error('long→reply: the reply-target thread is not the open thread');
        await sleep(1000);
      }
      if (want('reply')) {
        // the sync connection must be up before a delivery can be timed; say how long that took
        const connWait = await app.waitFor(`!!window.__nmDb?.currentStatus?.connected`, { timeoutMs: 60_000, everyMs: 250, what: 'the sync connection' }).catch(() => null);
        run.replySyncConnectedWaitMs = connWait;
        try {
          run.reply = await replyArrival(app, { api: o.api, token: `PERF-${o.profile}-${Date.now().toString(36)}`, label: `reply #${i}`, replicaPoll: !o.noReplicaPoll });
          console.log(`[frames] #${i} reply: POST ${run.reply.postResponseMs} ms, socket frame +${run.reply.postToSocketFrameMs} ms, in replica +${run.reply.postToReplicaMs} ms, head painted +${run.reply.postToHeadPaintedMs} ms, tail +${run.reply.postToTailPaintedMs} ms, frames p95 ${run.reply.frames.p95}, longest ${run.reply.frames.longest}, loaf blocking ${run.reply.frames.loafBlockingMs}`);
        } catch (e) {
          // a reply that never paints is a result, not a harness crash: record it and go on
          run.reply = { failed: String(e.message ?? e), timeout: /never painted/.test(String(e.message)) };
          try { await frames.stop(app); } catch { /* not running */ }
          console.log(`[frames] #${i} reply FAILED: ${run.reply.failed}`);
        }
        await sleep(1000);
      }
      if (want('switch') || (want('scroll') && want('reply'))) {
        // back to the long thread from the rail: the second thread → thread sample, and the scroll's start
        await app.revealRailRow(LONG_TITLE);
        run.replyToLong = await timedSwitch(app, { finder: App.railRow(LONG_TITLE), paint: { sel: '.convomsgs', text: LONG_LAST, timeoutMs: 180_000 }, label: `reply→long #${i}` });
        console.log(`[frames] #${i} reply→long ${run.replyToLong.ms} ms (p95 frame ${run.replyToLong.frames.p95})`);
        await sleep(800);
      }
      if (want('scroll')) {
        const s = await app.scrollState();
        run.threadDom = { messages: s.msgs, scrollHeight: s.height, client: s.client, scroller: s.el };
        run.scrollUp = await scrollRun(app, { dir: -1, pattern: 'steady', label: `steady up #${i}` });
        run.scrollDown = await scrollRun(app, { dir: +1, pattern: 'steady', label: `steady down #${i}` });
        run.flingUp = await scrollRun(app, { dir: -1, pattern: 'fling', label: `fling up #${i}` });
        run.flingDown = await scrollRun(app, { dir: +1, pattern: 'fling', label: `fling down #${i}` });
        for (const k of ['scrollUp', 'scrollDown', 'flingUp', 'flingDown']) {
          const r = run[k];
          console.log(`[frames] #${i} ${k}: ${r.distance}px in ${r.wallMs} ms, complete ${r.complete}, frames ${r.frames.frames}, p50 ${r.frames.p50} p95 ${r.frames.p95} p99 ${r.frames.p99}, >16.7 ${r.frames.pctOver16_7}%, >33.3 ${r.frames.pctOver33_3}%, longest ${r.frames.longest}, loaf blocking ${r.frames.loafBlockingMs}`);
          if (r.distance < 100) console.log(`[frames] #${i} ${k}: WARNING the thread moved only ${r.distance}px; recorded as incomplete`);
        }
      }
      run.cpu = await perfMetrics(cdp, page);
      run.calibEndMs = (await calibrate(cdp, page).catch(() => null))?.medianMs ?? null;
      doc.runs.push(run);
      save();
    }
  } catch (e) {
    // evidence for a failed journey: what the page showed, and the error, next to the results
    try {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, page, 30_000);
      writeFileSync(out.replace(/\.json$/, '-failure.png'), Buffer.from(shot.data, 'base64'));
    } catch { /* the page is gone */ }
    doc.error = String(e?.stack ?? e);
    save();
    throw e;
  } finally {
    await closeChrome(chrome, cdp);
  }
  save();
  console.log(`[frames] wrote ${out}`);
}

export function summarizeFrames(runs) {
  const pick = (f) => runs.map(f).filter((x) => typeof x === 'number');
  const stat = (f) => { const xs = pick(f); return { median: round(median(xs)), p75: round(p75(xs)), n: xs.length, min: xs.length ? round(Math.min(...xs)) : null, max: xs.length ? round(Math.max(...xs)) : null }; };
  const out = {};
  for (const k of ['homeToLong', 'longToReply', 'replyToLong']) out[k] = { ms: stat((r) => r[k]?.ms), frameP95: stat((r) => r[k]?.frames?.p95), longestFrame: stat((r) => r[k]?.frames?.longest), loafBlockingMs: stat((r) => r[k]?.frames?.loafBlockingMs) };
  out.calibMs = stat((r) => r.calibMs);
  for (const k of ['scrollUp', 'scrollDown', 'flingUp', 'flingDown']) out[k] = { completeRuns: runs.filter((r) => r[k]?.complete).length, distancePx: stat((r) => r[k]?.distance), pxPerSecond: stat((r) => r[k]?.pxPerSecond), frameP50: stat((r) => r[k]?.frames?.p50), frameP95: stat((r) => r[k]?.frames?.p95), frameP99: stat((r) => r[k]?.frames?.p99), pctOver16_7: stat((r) => r[k]?.frames?.pctOver16_7), pctOver33_3: stat((r) => r[k]?.frames?.pctOver33_3), longestFrame: stat((r) => r[k]?.frames?.longest), droppedFrames: stat((r) => r[k]?.frames?.droppedFrames), loafBlockingMs: stat((r) => r[k]?.frames?.loafBlockingMs), wallMs: stat((r) => r[k]?.wallMs) };
  out.replyFailed = runs.filter((r) => r.reply?.failed).length;
  out.reply = { postToSocketFrameMs: stat((r) => r.reply?.postToSocketFrameMs), socketFrameToHeadPaintedMs: stat((r) => r.reply?.socketFrameToHeadPaintedMs), postResponseMs: stat((r) => r.reply?.postResponseMs), postToReplicaMs: stat((r) => r.reply?.postToReplicaMs), replicaToHeadPaintedMs: stat((r) => r.reply?.replicaToHeadPaintedMs), postToHeadPaintedMs: stat((r) => r.reply?.postToHeadPaintedMs), postToTailPaintedMs: stat((r) => r.reply?.postToTailPaintedMs), headToTailMs: stat((r) => r.reply?.headToTailMs), frameP95: stat((r) => r.reply?.frames?.p95), longestFrame: stat((r) => r.reply?.frames?.longest), loafBlockingMs: stat((r) => r.reply?.frames?.loafBlockingMs) };
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('[frames] FAILED', e); process.exit(1); });
}
