#!/usr/bin/env node
// videos.mjs: the baseline videos (MP4, constant 30 fps, timing from the screencast's own frame
// timestamps; see record.mjs) and the cold-load filmstrip.
//
//   node videos.mjs --url http://127.0.0.1:5341/acme [--only cold,scroll,reply,warm] [--label baseline] [--port 9353]
//
//   cold    cold load under fast4g, from the blank tab to the Home screen with data (+2 s), and a
//           filmstrip PNG every 100 ms of it (videos/<label>-cold-fast4g-filmstrip/ + a contact sheet)
//   warm    warm reload under broadband (same profile as `cold`, Chrome relaunched), blank → data
//   scroll  open the perf-lab long thread from Home (click) and scroll it to the top and back
//   reply   a ~6 KB agent reply arriving in the open reply-target thread (POST → painted, +2 s)
// These runs are for looking at, not for numbers: the screencast costs the page some CPU.
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadavg } from 'node:os';
import { launchChrome, openPage, evaluate, closeChrome, sleep, PROFILES, round, startNetProxy } from './cdp.mjs';
import { probeSource } from './probe.mjs';
import { framesProbeSource } from './frames-probe.mjs';
import { Recorder, encodeMp4, filmstrip } from './record.mjs';
import { App, SEED, LONG_TITLE, REPLY_TITLE, LONG_LAST, REPLY_FIRST, replyBody } from './app.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const URL0 = arg('--url', 'http://127.0.0.1:5341/acme');
const LABEL = arg('--label', 'baseline');
const PORT = Number(arg('--port', 9353));
const API = arg('--api', 'http://127.0.0.1:8841');
const ONLY = arg('--only', 'cold,warm,scroll,reply').split(',');
const OUT = resolve(here, 'videos');
mkdirSync(OUT, { recursive: true });
const log = (m) => console.log(`[videos] ${m}`);
const manifest = existsSync(join(OUT, `${LABEL}-videos.json`)) ? JSON.parse((await import('node:fs')).readFileSync(join(OUT, `${LABEL}-videos.json`), 'utf8')) : {};
const saveManifest = () => writeFileSync(join(OUT, `${LABEL}-videos.json`), JSON.stringify(manifest, null, 1));

async function session({ profile, profileDir, fresh }) {
  // the network profile is shaped by netproxy (HTTP AND the sync WebSocket), CPU by CDP; see measure-load.mjs
  const full = PROFILES[profile];
  const proxy = full.net ? await startNetProxy({ port: 9357, net: full.net }) : null;
  const chrome = await launchChrome({ port: PORT, userDataDir: profileDir, fresh, extraArgs: proxy ? proxy.chromeArgs : [] });
  const prof = { ...full, net: null };
  const { cdp, page } = await openPage(chrome, { profile: prof, onSession: async (sid) => { if (prof.cpu !== 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu }, sid).catch(() => null); } });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, page);
  const u = new URL(URL0);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: probeSource({ port: u.port }) }, page);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: framesProbeSource({ port: u.port }) }, page);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: App.railRecentsPrefSource(u.port) }, page);
  return { chrome, cdp, page, app: new App(cdp, page, u.origin), u, proxy };
}
const endSession = async (s) => { await closeChrome(s.chrome, s.cdp); if (s.proxy) await s.proxy.stop(); };

/** blank → Home with data, recorded */
async function loadVideo({ name, profile, profileDir, fresh, db, waitSynced }) {
  const s = await session({ profile, profileDir, fresh });
  try {
    const u = new URL(s.u); u.searchParams.set('db', db);
    const rec = new Recorder(s.cdp, s.page, { dir: join(OUT, `${name}.frames`) });
    await rec.start();
    await sleep(300);
    const t0 = Date.now();
    await s.cdp.send('Page.navigate', { url: u.toString() }, s.page);
    const dataMs = await s.app.waitFor(`window.__nmPerf?.marks?.data != null`, { timeoutMs: 900_000, everyMs: 200, what: 'first synced row' });
    const marks = await s.app.read(`({ origin: location.origin, arch: window.__nmPerf.arch || null, marks: window.__nmPerf.marks, info: window.__nmPerf.markInfo })`, { awaitPromise: false });
    if (process.platform === 'darwin' && marks.arch && !String(marks.arch).startsWith('arm')) throw new Error(`the page reports architecture ${marks.arch}: Rosetta, refusing`);
    await sleep(2000);
    const frames = await rec.stop();
    const t1 = Date.now();
    const mp4 = encodeMp4(frames, join(OUT, `${name}.mp4`), { t0Wall: t0, t1Wall: t1 });
    rmSync(join(OUT, `${name}.frames`), { recursive: true, force: true });
    log(`${name}: ${mp4.seconds?.toFixed(1)} s, ${frames.length} screencast frames, data at ${round(marks.marks.data)} ms (${dataMs} ms wall)`);
    if (waitSynced) await s.app.waitFor(`!!window.__nmDb?.currentStatus?.hasSynced`, { timeoutMs: 900_000, everyMs: 500 });
    return { mp4: mp4.out, seconds: mp4.seconds, screencastFrames: frames.length, marks: marks.marks, data: marks.info?.data ?? null, profile, pageArch: marks.arch, chromeTranslated: s.chrome.translated, proxyStats: null, loadavg: loadavg().map((x) => round(x, 2)) };
  } finally { await endSession(s); }
}

async function main() {
  const coldDir = resolve(here, 'profiles', `videos-${LABEL}-cold`);
  const db = `videos-${LABEL}-${Date.now().toString(36)}`;
  if (ONLY.includes('cold') || ONLY.includes('warm')) {
    if (ONLY.includes('cold') || !existsSync(coldDir)) {
      manifest.coldFast4g = await loadVideo({ name: `${LABEL}-cold-fast4g`, profile: 'fast4g', profileDir: coldDir, fresh: true, db, waitSynced: true });
      manifest.coldFast4g.db = db;
      manifest.coldFast4g.filmstrip = filmstrip(manifest.coldFast4g.mp4, join(OUT, `${LABEL}-cold-fast4g-filmstrip`), { everyMs: 100 });
      saveManifest();
    }
    if (ONLY.includes('warm')) {
      manifest.warmBroadband = await loadVideo({ name: `${LABEL}-warm-broadband`, profile: 'broadband', profileDir: coldDir, fresh: false, db: manifest.coldFast4g?.db ?? db, waitSynced: false });
      saveManifest();
    }
  }
  if (ONLY.includes('scroll') || ONLY.includes('reply')) {
    // a warm, synced session in its own profile (the same one measure-frames keeps for `none`, when present)
    const dir = resolve(here, 'profiles', `frames-${LABEL}-none`);
    const s = await session({ profile: 'none', profileDir: dir, fresh: false });
    try {
      const u = new URL(s.u); u.searchParams.set('db', `frames-${LABEL}-none`);
      await s.cdp.send('Page.navigate', { url: u.toString() }, s.page);
      await s.app.waitFor(`!!(${App.homeRow(LONG_TITLE)}) && !!window.__nmDb?.currentStatus?.hasSynced`, { timeoutMs: 900_000, everyMs: 500, what: 'Home with the perf-lab row' });
      await sleep(3000);
      if (ONLY.includes('scroll')) {
        await s.app.ensureHome();
        const row = await s.app.boxOf(App.homeRow(LONG_TITLE));
        await s.app.settleFrames();
        const rec = new Recorder(s.cdp, s.page, { dir: join(OUT, `${LABEL}-thread-scroll.frames`) });
        await rec.start();
        await sleep(500);
        const t0 = Date.now();
        await s.app.click(row);
        await s.app.waitFor(App.onThread(LONG_TITLE, LONG_LAST), { timeoutMs: 180_000, everyMs: 100 });
        const opened = Date.now() - t0;
        await sleep(800);
        const st = await s.app.scrollState();
        // steady wheel to the top, then back down
        for (const dir of [-1, 1]) {
          for (let i = 0; i < 2000; i++) {
            await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: st.x, y: st.y, deltaX: 0, deltaY: 100 * dir }, s.page).catch(() => null);
            await sleep(16);
            if (i % 8 === 7) { const now = await s.app.scrollState(); if (dir < 0 ? now.top <= 0 : now.top >= now.height - now.client - 2) break; }
          }
          await sleep(600);
        }
        const frames = await rec.stop();
        const mp4 = encodeMp4(frames, join(OUT, `${LABEL}-thread-scroll.mp4`), { t0Wall: t0 - 500, t1Wall: Date.now() });
        rmSync(join(OUT, `${LABEL}-thread-scroll.frames`), { recursive: true, force: true });
        manifest.threadScroll = { mp4: mp4.out, seconds: mp4.seconds, screencastFrames: frames.length, openMs: opened, messages: st.msgs, scrollHeight: st.height };
        saveManifest();
        log(`thread-scroll: ${mp4.seconds?.toFixed(1)} s, opened in ${opened} ms, ${st.msgs} rows, ${st.height}px`);
      }
      if (ONLY.includes('reply')) {
        if (!(await s.app.js(App.onThread(REPLY_TITLE, REPLY_FIRST)))) {
          await s.app.ensureRailRecents();
          await s.app.revealRailRow(REPLY_TITLE);
          const b = await s.app.boxOf(App.railRow(REPLY_TITLE));
          await s.app.click(b);
          await s.app.waitFor(App.onThread(REPLY_TITLE, REPLY_FIRST), { timeoutMs: 180_000 });
        }
        await sleep(1500);
        const token = `PERF-video-${Date.now().toString(36)}`;
        await s.app.js(`(window.__nmTail = window.__nmFrames.waitPainted({ sel: '.convomsgs', text: ${JSON.stringify(`${token}-TAIL`)}, timeoutMs: 120000 }), true)`);
        const rec = new Recorder(s.cdp, s.page, { dir: join(OUT, `${LABEL}-reply-arrival.frames`) });
        await rec.start();
        await sleep(1000);
        const tPost = Date.now();
        const r = await fetch(`${API}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'agent', id: 'ba49f62a-3562-4bbb-a5ba-930259b1dc8c' }) }, body: JSON.stringify({ workspace: SEED.workspace, channel: SEED.channel, threadId: SEED.replyThread.id, body: replyBody(token) }) });
        if (!r.ok) throw new Error(`reply POST ${r.status}`);
        const t = await s.app.read(`window.__nmTail`, { awaitPromise: true, timeoutMs: 240_000 });
        const origin = await s.app.read(`({ origin: location.origin, timeOrigin: performance.timeOrigin })`);
        await sleep(2500);
        const frames = await rec.stop();
        const mp4 = encodeMp4(frames, join(OUT, `${LABEL}-reply-arrival.mp4`), { t0Wall: tPost - 1000, t1Wall: Date.now() });
        rmSync(join(OUT, `${LABEL}-reply-arrival.frames`), { recursive: true, force: true });
        manifest.replyArrival = { mp4: mp4.out, seconds: mp4.seconds, screencastFrames: frames.length, postToTailPaintedMs: t.timeout ? null : round(origin.timeOrigin + t.paintedAt - tPost), videoPostAtS: 1.0 };
        saveManifest();
        log(`reply-arrival: ${mp4.seconds?.toFixed(1)} s, POST at 1.0 s in the video, painted +${manifest.replyArrival.postToTailPaintedMs} ms`);
      }
    } finally { await endSession(s); }
  }
  saveManifest();
  log(`wrote ${join(OUT, `${LABEL}-videos.json`)}`);
}

main().catch((e) => { console.error('[videos] FAILED', e); process.exit(1); });
