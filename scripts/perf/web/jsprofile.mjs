#!/usr/bin/env node
// jsprofile.mjs: sampled JS CPU profiles of a cold load, for the page AND its workers (the V8
// sampling profiler over CDP's Profiler domain, one per target). Self time per function.
//
//   node jsprofile.mjs --url http://127.0.0.1:5341/acme --profile none --seconds 70 --out traces/none-cold
//
// writes <out>.<target>.cpuprofile (loadable in DevTools' Performance panel) + <out>.jsprofile.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, openPage, closeChrome, sleep, PROFILES } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export function selfTimes(profile, top = 15) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const deltas = profile.timeDeltas ?? [];
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = deltas[i + 1] ?? 0; // the time until the next sample is spent in this sample's node
    self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + dt);
  }
  const byFn = new Map();
  const byUrl = new Map();
  let total = 0;
  for (const [id, us] of self) {
    const n = byId.get(id);
    const cf = n.callFrame;
    const url = (cf.url || '').replace(/^https?:\/\/[^/]+/, '');
    const key = `${cf.functionName || '(anonymous)'} @ ${url || cf.url || '(native)'}${url ? `:${cf.lineNumber + 1}:${cf.columnNumber + 1}` : ''}`;
    byFn.set(key, (byFn.get(key) ?? 0) + us);
    const ukey = url || `(${cf.functionName || 'native'})`;
    byUrl.set(ukey, (byUrl.get(ukey) ?? 0) + us);
    total += us;
  }
  const fmt = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, us]) => ({ what: k, selfMs: Math.round(us / 100) / 10, pct: Math.round((us / total) * 1000) / 10 }));
  return { sampledMs: Math.round(total / 100) / 10, topFunctions: fmt(byFn), topUrls: fmt(byUrl) };
}

export async function profileLoad({ url, profile = 'none', seconds = 60, out, port = 9352 }) {
  const prof = PROFILES[profile];
  const chrome = await launchChrome({ port, userDataDir: resolve(here, 'profiles', `jsprof-${Date.now()}`), fresh: true });
  const started = [];
  const { cdp, page, sessions } = await openPage(chrome, {
    profile: prof,
    onSession: async (sid, info) => {
      if (info.type !== 'worker') return;
      await cdp.send('Profiler.enable', {}, sid);
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 }, sid);
      await cdp.send('Profiler.start', {}, sid);
      started.push({ sid, name: info.url.split('/').pop() });
    },
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, page);
  await cdp.send('Profiler.enable', {}, page);
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 }, page);
  await cdp.send('Profiler.start', {}, page);
  started.unshift({ sid: page, name: 'page' });
  const u = new URL(url);
  if (!u.searchParams.has('db')) u.searchParams.set('db', `jsprof${Date.now()}`);
  await cdp.send('Page.navigate', { url: u.toString() }, page);
  await sleep(seconds * 1000);
  mkdirSync(dirname(out), { recursive: true });
  const result = { url: u.toString(), profile, seconds, targets: [] };
  for (const s of started) {
    if (!sessions.has(s.sid)) { result.targets.push({ name: s.name, error: 'target gone' }); continue; }
    const { profile: p } = await cdp.send('Profiler.stop', {}, s.sid, 120_000);
    const file = `${out}.${s.name.replace(/[^A-Za-z0-9_.-]/g, '_')}.cpuprofile`;
    writeFileSync(file, JSON.stringify(p));
    result.targets.push({ name: s.name, file, ...selfTimes(p) });
  }
  await closeChrome(chrome, cdp);
  writeFileSync(`${out}.jsprofile.json`, JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const r = await profileLoad({ url: get('--url', 'http://127.0.0.1:5341/acme'), profile: get('--profile', 'none'), seconds: Number(get('--seconds', 60)), out: get('--out', resolve(here, 'traces', `jsprof-${Date.now()}`)), port: Number(get('--port', 9352)) });
  console.log(JSON.stringify(r, null, 1).slice(0, 15000));
}
