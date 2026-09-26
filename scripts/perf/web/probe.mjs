// probe.mjs: the in-page instrumentation the harness injects at document start
// (Page.addScriptToEvaluateOnNewDocument). One global, window.__nmPerf, and nothing else.
//
// It refuses to run anywhere but the harness origin's port, so a probe can never measure (or
// report) some other page: every read-back carries `origin`, and the Node side checks it.
//
// Milestones are page-clock times (performance.now(), ms since the navigation's timeOrigin): the
// condition is checked in a requestAnimationFrame callback (a DOM change schedules one check; a
// 200 ms interval is the fallback for changes a MutationObserver cannot see), and the time is
// taken in a MessageChannel task right after that frame's rendering, i.e. when the frame that
// shows it has been produced. The rAF (frame begin) time is kept too, as markVsync.
//
//   shell     .shell with its .navpanel laid out (the app frame: rail + main)
//   composer  the Home composer textarea (.hcomposer textarea) laid out, enabled, writable
//   data      the first row whose text came from the synced replica: a rail row
//             (.navhistrow .navhisttitle), a rail project folder (.navgrpname), or a Home ledger
//             row (.histrow .histtitle), with non-empty text (recorded as dataWhat/dataText)
//   dbReady   window.__nmDb.ready (the wa-sqlite replica opened; dev-user builds only)
//   synced    window.__nmDb.currentStatus.hasSynced
export function probeSource({ port = '5341' } = {}) {
  return `(() => {
  if (location.port !== ${JSON.stringify(String(port))}) return;
  if (window.__nmPerf) return;
  const P = window.__nmPerf = { origin: location.origin, v: 2, marks: {}, markInfo: {}, longtasks: [], loafs: [], shifts: [], lcp: [], paints: [], events: [], errors: [], checks: 0 };
  const signal = (ev, t, extra) => { try { window.__nmPerfSignal && window.__nmPerfSignal(JSON.stringify({ ev, t, origin: location.origin, ...(extra || {}) })); } catch (e) {} };
  // a mark's time is taken AFTER the frame that shows it: the condition is checked in the rAF
  // callback (the DOM that frame paints), then a MessageChannel task runs once that frame's
  // rendering is done. The rAF timestamp itself is the frame's BEGIN time, which on a busy main
  // thread can be long before the frame is actually produced; it is kept as markVsync.
  P.markVsync = {};
  let due = [];
  const mark = (k, t, info) => {
    if (P.marks[k] != null || due.some((d) => d[0] === k)) return;
    due.push([k, t, info]);
    if (due.length > 1) return;
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { const now = performance.now(); for (const [k2, t2, i2] of due) { P.marks[k2] = now; P.markVsync[k2] = t2; if (i2) P.markInfo[k2] = i2; signal(k2, now, i2); } due = []; };
    ch.port2.postMessage(0);
  };
  try { navigator.userAgentData && navigator.userAgentData.getHighEntropyValues(['architecture', 'bitness']).then((v) => { P.arch = v.architecture + '/' + v.bitness; }); } catch (e) {}
  // the sync socket's life, from the page: who closes it, with which code, and from where
  P.ws = [];
  P.syncErrors = [];
  try {
    const NativeWS = window.WebSocket;
    const origClose = NativeWS.prototype.close;
    NativeWS.prototype.close = function (code, reason) {
      P.ws.push({ t: Math.round(performance.now()), ev: 'close() called', url: String(this.url).slice(0, 60), code: code ?? null, reason: String(reason ?? '').slice(0, 80), stack: String(new Error().stack || '').split(String.fromCharCode(10)).slice(2, 7).map((x) => x.trim().replace(location.origin, '')).join(' | ').slice(0, 400) });
      return origClose.apply(this, arguments);
    };
    const origAdd = NativeWS.prototype.addEventListener;
    const seen = new WeakSet();
    const watch = (ws) => { if (seen.has(ws)) return; seen.add(ws); origAdd.call(ws, 'close', (e) => P.ws.push({ t: Math.round(performance.now()), ev: 'closed', url: String(ws.url).slice(0, 60), code: e.code, reason: String(e.reason || '').slice(0, 80), clean: e.wasClean })); origAdd.call(ws, 'open', () => P.ws.push({ t: Math.round(performance.now()), ev: 'open', url: String(ws.url).slice(0, 60) })); };
    NativeWS.prototype.addEventListener = function () { try { watch(this); } catch (e) {} return origAdd.apply(this, arguments); };
  } catch (e) { P.errors.push('ws wrap: ' + e.message); }
  const obs = (type, fn) => { try { new PerformanceObserver((l) => { for (const e of l.getEntries()) fn(e); }).observe({ type, buffered: true }); } catch (e) { P.errors.push(type + ': ' + e.message); } };
  obs('longtask', (e) => P.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]));
  obs('long-animation-frame', (e) => {
    const scripts = (e.scripts || []).slice().sort((a, b) => b.duration - a.duration).slice(0, 3).map((s) => ({ d: Math.round(s.duration), inv: String(s.invoker || '').slice(0, 80), src: String(s.sourceURL || '').replace(location.origin, '').slice(0, 80), fn: String(s.sourceFunctionName || '').slice(0, 40), fsl: Math.round(s.forcedStyleAndLayoutDuration || 0) }));
    P.loafs.push({ t: Math.round(e.startTime), d: Math.round(e.duration), b: Math.round(e.blockingDuration || 0), rs: Math.round(e.renderStart || 0), sls: Math.round(e.styleAndLayoutStart || 0), scripts });
  });
  obs('layout-shift', (e) => P.shifts.push([Math.round(e.startTime), e.value, !!e.hadRecentInput]));
  obs('largest-contentful-paint', (e) => P.lcp.push({ t: Math.round(e.startTime), size: e.size, el: e.element ? (e.element.tagName + '.' + String(e.element.className || '').split(' ')[0]).slice(0, 60) : null, url: e.url ? e.url.replace(location.origin, '').slice(0, 80) : '' }));
  obs('paint', (e) => P.paints.push([e.name, Math.round(e.startTime)]));
  obs('event', (e) => { if (e.duration >= 40) P.events.push({ n: e.name, t: Math.round(e.startTime), d: Math.round(e.duration), pd: Math.round(e.processingStart - e.startTime) }); });
  const laidOut = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  const firstText = (sel) => { for (const el of document.querySelectorAll(sel)) { const t = (el.textContent || '').trim(); if (t && laidOut(el)) return t.slice(0, 80); } return null; };
  const check = (t) => {
    P.checks++;
    if (P.marks.shell == null) { const s = document.querySelector('.shell'); if (s && laidOut(s) && laidOut(s.querySelector('.navpanel'))) mark('shell', t); }
    if (P.marks.composer == null) { const ta = document.querySelector('.hcomposer textarea'); if (ta && !ta.disabled && !ta.readOnly && laidOut(ta)) mark('composer', t); }
    // the same two, drawn by React (not the static shell of web/index.html, which reuses its classes)
    if (P.marks.reactShell == null) { const s = document.querySelector('#root .shell'); if (s && laidOut(s) && laidOut(s.querySelector('.navpanel'))) mark('reactShell', t); }
    if (P.marks.reactComposer == null) { const ta = document.querySelector('#root .hcomposer textarea'); if (ta && !ta.disabled && !ta.readOnly && laidOut(ta)) mark('reactComposer', t); }
    if (P.marks.data == null) {
      for (const [what, sel] of [['rail-row', '.navhistrow .navhisttitle'], ['rail-project', '.navgrpname'], ['home-row', '.histrow .histtitle']]) {
        const text = firstText(sel);
        if (text) { mark('data', t, { what, text }); break; }
      }
    }
    const db = window.__nmDb;
    if (db) {
      if (P.marks.dbObject == null) mark('dbObject', t);
      if (db.ready && P.marks.dbReady == null) mark('dbReady', t);
      const s = db.currentStatus;
      if (s && s.connected && P.marks.connected == null) mark('connected', t);
      if (s && s.hasSynced && P.marks.synced == null) mark('synced', t);
      // every distinct sync error the SDK reports (a stream that dies shows up here first)
      const err = s && s.dataFlowStatus && s.dataFlowStatus.downloadError;
      if (err) { const msg = String(err.message || err).slice(0, 300); if (P.syncErrors[P.syncErrors.length - 1]?.m !== msg) P.syncErrors.push({ t: Math.round(performance.now()), m: msg }); }
    }
  };
  let pending = false;
  const schedule = () => { if (pending) return; pending = true; requestAnimationFrame((ts) => { pending = false; check(ts); }); };
  const start = () => {
    try { new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true }); } catch (e) { P.errors.push('mo: ' + e.message); }
    schedule();
  };
  if (document.documentElement) start(); else document.addEventListener('readystatechange', start, { once: true });
  P.interval = setInterval(() => { schedule(); }, 200);
})();`;
}

/** the read-back: everything the probe collected + navigation timing, as plain JSON */
export const READBACK = `(() => {
  const P = window.__nmPerf;
  if (!P) return { origin: location.origin, error: 'no probe on this page' };
  const nav = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource').map((r) => ({ n: r.name.replace(location.origin, '').slice(0, 100), i: r.initiatorType, ts: r.transferSize, eb: r.encodedBodySize, db: r.decodedBodySize, s: Math.round(r.startTime), e: Math.round(r.responseEnd) }));
  return {
    origin: location.origin, href: location.href, now: performance.now(), timeOrigin: performance.timeOrigin,
    arch: P.arch || null, ws: P.ws, syncErrors: P.syncErrors, marks: P.marks, markInfo: P.markInfo, markVsync: P.markVsync, longtasks: P.longtasks, loafs: P.loafs, shifts: P.shifts, lcp: P.lcp, paints: P.paints, events: P.events, errors: P.errors, checks: P.checks,
    nav: nav ? { ttfb: nav.responseStart, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, transferSize: nav.transferSize, type: nav.type, protocol: nav.nextHopProtocol } : null,
    domNodes: document.getElementsByTagName('*').length,
    resources: res,
  };
})()`;

/** CLS the way web-vitals computes it: the largest session window (gap < 1 s, span < 5 s) of shifts without recent input */
export function clsOf(shifts) {
  let max = 0, cur = 0, winStart = -1, prev = -1;
  for (const [t, v, input] of shifts) {
    if (input) continue;
    if (winStart >= 0 && t - prev < 1000 && t - winStart < 5000) cur += v;
    else { cur = v; winStart = t; }
    prev = t;
    max = Math.max(max, cur);
  }
  return Math.round(max * 10000) / 10000;
}

/** fail fast: an injected script with a syntax error installs nothing and every mark goes missing */
export function assertProbesParse(sources) {
  for (const [name, src] of Object.entries(sources)) {
    try { new Function(src); } catch (e) { throw new Error(`the ${name} probe does not parse (${e.message}): fix it before measuring`); }
  }
}
