#!/usr/bin/env node
// profile-journey.mjs: a sampled JS CPU profile of the page (and its workers) during ONE journey,
// to say what the main thread is busy with while the frames suffer.
//
//   node profile-journey.mjs --journey scroll|open|reply [--profile none|cpu4x] [--label baseline] [--port 9355]
//
// Uses the frames profile directory of the label (warm replica). Writes
// traces/<label>-<journey>-<profile>.<target>.cpuprofile (loadable in DevTools) and a
// .journey.json with self time by function and by script for each target.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { launchChrome, openPage, closeChrome, sleep, PROFILES, calibrate } from './cdp.mjs';
import { selfTimes } from './jsprofile.mjs';
import { probeSource } from './probe.mjs';
import { framesProbeSource } from './frames-probe.mjs';
import { App, SEED, LONG_TITLE, LONG_LAST, REPLY_TITLE, REPLY_FIRST, replyBody } from './app.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const JOURNEY = arg('--journey', 'scroll');
const PROFILE = arg('--profile', 'none');
const LABEL = arg('--label', 'baseline');
const PORT = Number(arg('--port', 9355));
const API = arg('--api', 'http://127.0.0.1:8841');
const URL0 = new URL(arg('--url', 'http://127.0.0.1:5341/acme'));
URL0.searchParams.set('db', `frames-${LABEL}-${PROFILE}`);

const prof = PROFILES[PROFILE];
const chrome = await launchChrome({ port: PORT, userDataDir: resolve(here, 'profiles', `frames-${LABEL}-${PROFILE}`), fresh: false });
const workers = [];
const { cdp, page } = await openPage(chrome, { profile: prof, onSession: async (sid, info) => { if (info.type === 'worker') workers.push({ sid, name: info.url.split('/').pop() }); if (prof.cpu !== 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu }, sid).catch(() => null); } });
const out = resolve(here, 'traces', `${LABEL}-${JOURNEY}-${PROFILE}`);
mkdirSync(dirname(out), { recursive: true });
try {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, page);
  const calib = await calibrate(cdp, page);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: probeSource({ port: URL0.port }) }, page);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: framesProbeSource({ port: URL0.port }) }, page);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: App.railRecentsPrefSource(URL0.port) }, page);
  const app = new App(cdp, page, URL0.origin);
  await cdp.send('Page.navigate', { url: URL0.toString() }, page);
  await app.waitFor(`!!(${App.homeRow(LONG_TITLE)}) && !!window.__nmDb?.currentStatus?.hasSynced`, { timeoutMs: 600_000, everyMs: 500 });
  await sleep(4000);
  await app.ensureHome();
  if (JOURNEY !== 'open') {
    await app.click(await app.boxOf(App.homeRow(LONG_TITLE)));
    await app.waitFor(App.onThread(LONG_TITLE, LONG_LAST), { timeoutMs: 120_000 });
    await sleep(1500);
  }
  if (JOURNEY === 'reply') {
    await app.revealRailRow(REPLY_TITLE);
    await app.click(await app.boxOf(App.railRow(REPLY_TITLE)));
    await app.waitFor(App.onThread(REPLY_TITLE, REPLY_FIRST), { timeoutMs: 120_000 });
    await sleep(1500);
  }
  // start the profilers, run the journey, stop
  const targets = [{ sid: page, name: 'page' }, ...workers];
  for (const t of targets) { await cdp.send('Profiler.enable', {}, t.sid); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }, t.sid); await cdp.send('Profiler.start', {}, t.sid); }
  const t0 = Date.now();
  let what = null;
  if (JOURNEY === 'open') {
    await app.click(await app.boxOf(App.homeRow(LONG_TITLE)));
    await app.waitFor(App.onThread(LONG_TITLE, LONG_LAST), { timeoutMs: 120_000, everyMs: 50 });
    await sleep(1000);
    what = 'Home → long thread (click → last message painted + 1 s)';
  } else if (JOURNEY === 'scroll') {
    const st = await app.scrollState();
    let n = 0;
    for (; n < 3000; n++) {
      cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: st.x, y: st.y, deltaX: 0, deltaY: -100 }, page).catch(() => null);
      await sleep(16);
      if (n % 8 === 7 && (await app.scrollState()).top <= 0) break;
      if (Date.now() - t0 > 60_000) break;
    }
    what = `steady wheel up from the bottom, ${n + 1} events of 100 px`;
  } else if (JOURNEY === 'reply') {
    const token = `PERF-prof-${Date.now().toString(36)}`;
    await app.js(`(window.__nmTail = window.__nmFrames.waitPainted({ sel: '.convomsgs', text: ${JSON.stringify(`${token}-TAIL`)}, timeoutMs: 120000 }), true)`);
    const r = await fetch(`${API}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'agent', id: 'ba49f62a-3562-4bbb-a5ba-930259b1dc8c' }) }, body: JSON.stringify({ id: randomUUID(), workspace: SEED.workspace, channel: SEED.channel, threadId: SEED.replyThread.id, body: replyBody(token) }) });
    if (!r.ok) throw new Error(`reply POST ${r.status}`);
    await app.read(`window.__nmTail`, { awaitPromise: true, timeoutMs: 180_000 });
    await sleep(1500);
    what = 'reply POST → tail painted + 1.5 s';
  }
  const wallMs = Date.now() - t0;
  const result = { journey: JOURNEY, what, profile: PROFILE, label: LABEL, calibration: calib, wallMs, targets: [] };
  for (const t of targets) {
    const { profile: p } = await cdp.send('Profiler.stop', {}, t.sid, 120_000);
    const file = `${out}.${t.name.replace(/[^A-Za-z0-9_.-]/g, '_')}.cpuprofile`;
    writeFileSync(file, JSON.stringify(p));
    result.targets.push({ name: t.name, file: file.replace(`${here}/`, ''), ...selfTimes(p, 20) });
  }
  writeFileSync(`${out}.journey.json`, JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ ...result, targets: result.targets.map((t) => ({ name: t.name, sampledMs: t.sampledMs, top: t.topFunctions.slice(0, 12), urls: t.topUrls.slice(0, 6) })) }, null, 1));
} finally {
  await closeChrome(chrome, cdp);
}
