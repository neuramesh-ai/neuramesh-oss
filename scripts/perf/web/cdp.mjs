// cdp.mjs: the harness's Chrome + DevTools-protocol plumbing. Plain Node 22 (global WebSocket,
// global fetch), no npm dependencies, in the style of scripts/web-boot-e2e.mjs.
//
// One BROWSER-level socket in flat mode: the page and every worker the page starts are sessions on
// it, so throttling, network accounting and CPU emulation reach the workers too (a page-level
// socket never sees a dedicated worker's requests, such as the wa-sqlite .wasm fetch).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';

export const CHROME = process.env['CHROME_BIN'] || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** the network + CPU profiles (bytes per second, SI megabits: 20 Mbps = 2,500,000 B/s) */
export const PROFILES = {
  none: { label: 'none', net: null, cpu: 1 },
  broadband: { label: 'broadband (20/5 Mbps, 40 ms RTT, CPU 1x)', net: { latency: 40, downloadThroughput: 20e6 / 8, uploadThroughput: 5e6 / 8, connectionType: 'ethernet' }, cpu: 1 },
  fast4g: { label: 'fast4g (9/1.5 Mbps, 85 ms RTT, CPU 4x)', net: { latency: 85, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8, connectionType: 'cellular4g' }, cpu: 4 },
  // frames-only profile: no network shaping, CPU 4x (for the frame journeys against a local API)
  cpu4x: { label: 'cpu4x (no network shaping, CPU 4x)', net: null, cpu: 4 },
};

// every Chrome this process launched dies with it (a killed harness must not leave browsers behind)
const LIVE = new Set();
const killAll = () => { for (const p of LIVE) { try { p.kill('SIGKILL'); } catch { /* gone */ } } LIVE.clear(); };
process.once('exit', killAll);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { killAll(); process.exit(130); });

/** launch Chrome with a DevTools port; resolves when the browser endpoint answers */
export async function launchChrome({ port, userDataDir, width = 1440, height = 900, headless = true, extraArgs = [], fresh = false, wrap = null }) {
  if (fresh && existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  const args = [
    ...(headless ? ['--headless=new'] : []),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
    '--disable-default-apps', '--metrics-recording-only', '--password-store=basic', '--use-mock-keychain',
    // keep a backgrounded/occluded page rendering at full rate (rAF, timers)
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--hide-scrollbars=false',
    ...extraArgs,
    ...(process.env['NM_CHROME_EXTRA'] ? process.env['NM_CHROME_EXTRA'].split(' ').filter(Boolean) : []),
    'about:blank',
  ];
  // a launch sometimes never opens its port (seen twice in ~20 launches on this machine, stderr
  // empty, process alive): kill it and try again, up to three attempts, and say what happened
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    // NATIVE ARM64, ALWAYS. Chrome is a universal binary, and a process tree that passes through an
    // x86_64 program (Intel Homebrew's /usr/local/bin/timeout did, 2026-09-25) launches it under
    // Rosetta: the renderer then ran a fixed JS loop 10x slower and a cold load took 60 to 100 s
    // instead of 3 to 6 s. `arch -arm64` pins the slice whatever the parent is; assertNative() checks it.
    const w = wrap ?? (process.env['NM_CHROME_WRAP'] ? process.env['NM_CHROME_WRAP'].split(' ') : null);
    const pin = process.platform === 'darwin' && (process.arch === 'arm64' || isTranslated()) ? ['/usr/bin/arch', '-arm64'] : [];
    const cmd = [...(w ?? []), ...pin, CHROME, ...args];
    const proc = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'ignore', 'pipe'] });
    LIVE.add(proc);
    proc.once('exit', () => LIVE.delete(proc));
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 20000) stderr = stderr.slice(-10000); });
    const deadline = Date.now() + 45_000;
    let version = null;
    while (Date.now() < deadline) {
      try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })).json(); break; } catch { await sleep(150); }
      if (proc.exitCode != null || proc.signalCode != null) break;
    }
    if (version) {
      const translated = process.platform === 'darwin' ? pidTranslated(proc.pid) : false;
      if (translated) { try { proc.kill('SIGKILL'); } catch { /* gone */ } throw new Error('Chrome started under Rosetta (x86_64 translation): refusing to measure'); }
      return { proc, version, port, userDataDir, stderr: () => stderr, launchMs: Date.now() - t0, attempts, translated };
    }
    attempts.push({ attempt, ms: Date.now() - t0, exitCode: proc.exitCode, signal: proc.signalCode, stderr: stderr.slice(-300) });
    try { proc.kill('SIGKILL'); } catch { /* gone */ }
    await sleep(1000);
  }
  throw new Error(`chrome did not open its debugging port ${port} after 3 attempts (under the Bash sandbox it never does): ${JSON.stringify(attempts)}`);
}

/** true when this very process runs translated (an x86_64 node under Rosetta) */
export function isTranslated() {
  try { return execFileSync('/usr/sbin/sysctl', ['-n', 'sysctl.proc_translated']).toString().trim() === '1'; } catch { return false; }
}

/** is this pid running translated (Rosetta)? XNU's P_TRANSLATED flag, 0x20000, from ps */
export function pidTranslated(pid) {
  try { return (parseInt(execFileSync('/bin/ps', ['-o', 'flags=', '-p', String(pid)]).toString().trim(), 16) & 0x20000) !== 0; } catch { return null; }
}

/** a flat-mode CDP connection on the browser endpoint */
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
    if (m.id != null) {
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); m.error ? p.rej(Object.assign(new Error(`${p.method}: ${m.error.message}`), { cdp: m.error })) : p.res(m.result); }
      return;
    }
    for (const l of listeners) { try { l(m.method, m.params ?? {}, m.sessionId ?? null); } catch (e) { console.error('[cdp listener]', e); } }
  });
  const closed = new Promise((r) => ws.addEventListener('close', r, { once: true }));
  const send = (method, params = {}, sessionId = undefined, timeoutMs = 60_000) => new Promise((res, rej) => {
    const id = ++nextId;
    const t = setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(`${method}: timed out after ${timeoutMs} ms`)); } }, timeoutMs);
    pending.set(id, { method, res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const waitFor = (pred, timeoutMs = 30_000) => new Promise((res, rej) => {
    const off = on((method, params, sessionId) => { if (pred(method, params, sessionId)) { off(); clearTimeout(t); res({ method, params, sessionId }); } });
    const t = setTimeout(() => { off(); rej(new Error(`waitFor timed out after ${timeoutMs} ms`)); }, timeoutMs);
  });
  return { ws, send, on, waitFor, close: () => { try { ws.close(); } catch { /* closed */ } return closed; } };
}

/**
 * open the page target and wire every worker it starts: throttling, CPU rate, network events.
 * returns { cdp, page (sessionId), sessions (Map sessionId → {type,url}), setProfile(profile) }.
 */
export async function openPage(chrome, { profile = PROFILES.none, onSession = null } = {}) {
  const cdp = await connect(chrome.version.webSocketDebuggerUrl);
  const sessions = new Map();
  const attachLog = [];
  let current = profile;
  const applyProfile = async (sessionId, type) => {
    const tasks = [];
    if (type === 'page' || type === 'worker' || type === 'shared_worker' || type === 'service_worker') {
      tasks.push(cdp.send('Network.enable', { maxTotalBufferSize: 50_000_000, maxResourceBufferSize: 20_000_000 }, sessionId).catch(() => null));
      if (current.net) tasks.push(cdp.send('Network.emulateNetworkConditions', { offline: false, ...current.net }, sessionId).catch((e) => ({ error: e.message })));
      else tasks.push(cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId).catch(() => null));
    }
    if (type === 'page') tasks.push(cdp.send('Emulation.setCPUThrottlingRate', { rate: current.cpu }, sessionId).catch((e) => ({ error: e.message })));
    return Promise.all(tasks);
  };
  cdp.on((method, params, sessionId) => {
    if (method === 'Target.attachedToTarget') {
      const { sessionId: sid, targetInfo, waitingForDebugger } = params;
      const rec = { type: targetInfo.type, url: targetInfo.url, parent: sessionId, attachedWall: Date.now(), steps: {} };
      sessions.set(sid, rec);
      attachLog.push(rec);
      (async () => {
        // the worker is PAUSED until runIfWaitingForDebugger: every step here delays its start, so
        // each is timed and capped at 5 s (a step that hangs must not hold the worker for a minute)
        const t = async (name, fn) => { const a = Date.now(); const r = await fn().catch((e) => ({ error: e.message })); rec.steps[name] = Date.now() - a; return r; };
        await t('autoAttach', () => cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sid, 5000));
        await t('profile', () => Promise.race([applyProfile(sid, targetInfo.type), sleep(5000).then(() => { throw new Error('profile step over 5 s'); })]));
        if (onSession) await t('onSession', () => Promise.race([onSession(sid, targetInfo), sleep(5000)]));
        if (waitingForDebugger) await t('resume', () => cdp.send('Runtime.runIfWaitingForDebugger', {}, sid, 5000));
        rec.resumedWall = Date.now();
        rec.pausedMs = rec.resumedWall - rec.attachedWall;
      })();
    } else if (method === 'Target.detachedFromTarget') {
      sessions.delete(params.sessionId);
    }
  });
  const targets = await cdp.send('Target.getTargets');
  const pageInfo = targets.targetInfos.find((t) => t.type === 'page');
  if (!pageInfo) throw new Error('no page target');
  const { sessionId: page } = await cdp.send('Target.attachToTarget', { targetId: pageInfo.targetId, flatten: true });
  sessions.set(page, { type: 'page', url: pageInfo.url, parent: null });
  await Promise.all([
    cdp.send('Page.enable', {}, page),
    cdp.send('Runtime.enable', {}, page),
    cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, page),
  ]);
  await applyProfile(page, 'page');
  const setProfile = async (p) => {
    current = p;
    await Promise.all([...sessions.entries()].map(([sid, s]) => applyProfile(sid, s.type)));
  };
  return { cdp, page, sessions, setProfile, targetId: pageInfo.targetId, attachLog };
}

/** evaluate in the page and return by value; throws on an exception in the page */
export async function evaluate(cdp, page, expression, { awaitPromise = true, timeoutMs = 60_000 } = {}) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true }, page, timeoutMs);
  if (r.exceptionDetails) throw new Error(`page exception: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result?.value;
}

/** close the browser gracefully (flushes the disk cache), then make sure the process is gone */
export async function closeChrome(chrome, cdp) {
  try { if (cdp) await cdp.send('Browser.close', {}, undefined, 5000); } catch { /* already closing */ }
  const exited = new Promise((r) => { if (chrome.proc.exitCode != null) r(); else chrome.proc.once('exit', r); });
  await Promise.race([exited, sleep(8000)]);
  if (chrome.proc.exitCode == null) { try { chrome.proc.kill('SIGKILL'); } catch { /* gone */ } await Promise.race([exited, sleep(2000)]); }
  try { cdp?.close(); } catch { /* closed */ }
}

export const median = (xs) => { const a = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((p, q) => p - q); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
/** p75 by the nearest-rank method (with 5 runs: the 4th smallest) */
export const p75 = (xs) => { const a = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((p, q) => p - q); if (!a.length) return null; return a[Math.min(a.length - 1, Math.ceil(0.75 * a.length) - 1)]; };
export const round = (x, d = 1) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

/** start netproxy.mjs as its own process (its timers must not share an event loop with a CDP client
 *  that parses megabytes of WebSocket frame events) and resolve once it listens */
export async function startNetProxy({ port = 9358, net }) {
  const { spawn: sp } = await import('node:child_process');
  const { fileURLToPath: f } = await import('node:url');
  const script = f(new URL('./netproxy.mjs', import.meta.url));
  const proc = sp(process.execPath, [script, '--port', String(port), '--down', String(Math.round(net.downloadThroughput)), '--up', String(Math.round(net.uploadThroughput)), '--rtt', String(net.latency)], { stdio: ['ignore', 'pipe', 'pipe'] });
  LIVE.add(proc);
  proc.once('exit', () => LIVE.delete(proc));
  let out = '';
  proc.stdout.on('data', (d) => { out += d.toString(); });
  const t0 = Date.now();
  while (!out.includes('listening') && Date.now() - t0 < 10_000) await sleep(50);
  if (!out.includes('listening')) { proc.kill('SIGKILL'); throw new Error(`netproxy did not start: ${out}`); }
  let stopping = null;
  const stop = () => {
    stopping ??= (async () => {
      if (proc.exitCode == null && proc.signalCode == null) {
        const exited = new Promise((r) => proc.once('exit', r));
        proc.kill('SIGTERM');
        await Promise.race([exited, sleep(3000)]);
      }
      const m = /\[netproxy\] stats (\{.*\})/.exec(out);
      return m ? JSON.parse(m[1]) : null;
    })();
    return stopping;
  };
  return { proc, port, stop, chromeArgs: [`--proxy-server=http://127.0.0.1:${port}`, '--proxy-bypass-list=<-loopback>'] };
}

/** a fixed JS workload in the current page, before the app loads: how fast is THIS renderer right now?
 *  (the machine is shared; this is the per-run contention gauge. Node runs the same loop in ~70 ms.) */
export const CALIBRATE_JS = `(() => { const out = []; for (let k = 0; k < 5; k++) { const t = performance.now(); let x = 0; for (let i = 0; i < 1e7; i++) x += i % 7; out.push(Math.round((performance.now() - t) * 10) / 10); if (x < 0) out.push(-1); } return out; })()`;
export async function calibrate(cdp, page) {
  const runs = await evaluate(cdp, page, CALIBRATE_JS, { awaitPromise: false, timeoutMs: 60_000 });
  const warm = runs.slice(1);
  return { runsMs: runs, minMs: Math.min(...warm), medianMs: median(warm) };
}

/** wait (up to maxWaitMs) until the 1-minute load average is at or below maxLoad; returns what it saw */
export async function waitForQuietMachine({ maxLoad = null, maxWaitMs = 600_000, log = () => {} } = {}) {
  const { loadavg } = await import('node:os');
  const t0 = Date.now();
  if (maxLoad == null) return { waitedMs: 0, load1: loadavg()[0], gated: false };
  let said = 0;
  while (loadavg()[0] > maxLoad && Date.now() - t0 < maxWaitMs) {
    if (Date.now() - said > 30_000) { log(`machine load ${loadavg()[0].toFixed(1)} > ${maxLoad}: waiting`); said = Date.now(); }
    await sleep(5000);
  }
  return { waitedMs: Date.now() - t0, load1: Math.round(loadavg()[0] * 100) / 100, gated: true, timedOut: loadavg()[0] > maxLoad };
}

/** Performance.getMetrics as a plain object (ThreadTime/ProcessTime are CPU seconds; *Duration are seconds) */
export async function perfMetrics(cdp, sessionId) {
  const r = await cdp.send('Performance.getMetrics', {}, sessionId, 120_000).catch(() => null);
  if (!r) return null;
  const m = Object.fromEntries(r.metrics.map((x) => [x.name, x.value]));
  const ms = (s) => (typeof s === 'number' ? Math.round(s * 10000) / 10 : null);
  return { threadCpuMs: ms(m.ThreadTime), processCpuMs: ms(m.ProcessTime), taskMs: ms(m.TaskDuration), scriptMs: ms(m.ScriptDuration), layoutMs: ms(m.LayoutDuration), styleMs: ms(m.RecalcStyleDuration), compileMs: ms(m.V8CompileDuration), layoutCount: m.LayoutCount, styleCount: m.RecalcStyleCount, nodes: m.Nodes, jsHeapMB: m.JSHeapUsedSize ? Math.round(m.JSHeapUsedSize / 1e5) / 10 : null, listeners: m.JSEventListeners };
}
