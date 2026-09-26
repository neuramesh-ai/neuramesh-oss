// frames-probe.mjs: the in-page frame probe (window.__nmFrames). Inject with
// Page.addScriptToEvaluateOnNewDocument (or Runtime.evaluate on a loaded page).
//
//   __nmFrames.start(label)         begin a window: a rAF loop records every frame delta, and a
//                                   long-animation-frame observer collects LoAFs inside the window
//   __nmFrames.stop()               end the window, return the summary (below)
//   __nmFrames.waitPainted(opts)    resolve with the page-clock time just after the first frame in
//                                   which a condition holds (MutationObserver schedules one rAF check
//                                   per DOM change; the check runs in rAF, the time is taken in a
//                                   MessageChannel task after that frame's rendering; the frame's
//                                   begin time is returned too). opts: { sel, text, minCount, timeoutMs }
//   __nmFrames.lastPointerDown      page-clock timeStamp of the latest pointerdown (capturing
//                                   listener), so a click's start time is the browser's own
//
// Summary: frames, p50/p95/p99 frame ms, % > 16.7 ms, % > 33.3 ms, longest frame, the dropped
// frame estimate (sum of round(delta / 16.67) - 1), LoAF count / total / blocking ms, and the top
// LoAF scripts. Frame deltas are the main thread's rAF cadence: a compositor-only scroll can stay
// smooth while these jank, so this is the main-thread view of smoothness (what a list render costs).
export function framesProbeSource({ port = '5341' } = {}) {
  return `(() => {
  if (location.port !== ${JSON.stringify(String(port))}) return;
  if (window.__nmFrames) return;
  const F = window.__nmFrames = { origin: location.origin, running: false, deltas: [], stamps: [], loafs: [], t0: 0, t1: 0, label: '', lastPointerDown: null };
  addEventListener('pointerdown', (e) => { F.lastPointerDown = e.timeStamp; }, { capture: true, passive: true });
  // one rAF chain per window: a callback queued by the previous window's chain must not run on
  // into this one (two chains stamp the same frame twice and invent 0 ms frames)
  let last = 0, gen = 0;
  const loop = (g) => { const tick = (ts) => { if (!F.running || g !== gen) return; if (last) F.deltas.push(ts - last); F.stamps.push(ts); last = ts; requestAnimationFrame(tick); }; return tick; };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const scripts = (e.scripts || []).slice().sort((a, b) => b.duration - a.duration).slice(0, 3).map((s) => ({ d: Math.round(s.duration), inv: String(s.invoker || '').slice(0, 70), src: String(s.sourceURL || '').replace(location.origin, '').slice(0, 70), fn: String(s.sourceFunctionName || '').slice(0, 40), fsl: Math.round(s.forcedStyleAndLayoutDuration || 0) }));
        F.loafs.push({ t: e.startTime, d: e.duration, b: e.blockingDuration || 0, rs: e.renderStart, scripts });
        if (F.loafs.length > 5000) F.loafs.splice(0, 1000);
      }
    }).observe({ type: 'long-animation-frame', buffered: false });
  } catch (e) { F.loafError = String(e); }
  F.start = (label) => { gen++; F.label = label || ''; F.deltas = []; F.stamps = []; F.t0 = performance.now(); F.t1 = 0; F.running = true; last = 0; requestAnimationFrame(loop(gen)); return F.t0; };
  F.summary = (from, to) => {
    const t0 = from ?? F.t0, t1 = to ?? (F.t1 || performance.now());
    const ds = [];
    for (let i = 1; i < F.stamps.length; i++) if (F.stamps[i] >= t0 && F.stamps[i] <= t1) ds.push(F.stamps[i] - F.stamps[i - 1]);
    const d = ds.slice().sort((a, b) => a - b);
    const q = (p) => (d.length ? d[Math.min(d.length - 1, Math.ceil(p * d.length) - 1)] : null);
    const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
    const win = F.loafs.filter((l) => l.t + l.d >= t0 && l.t <= t1);
    const top = win.slice().sort((a, b) => b.d - a.d).slice(0, 3).map((l) => ({ at: Math.round(l.t - t0), d: Math.round(l.d), b: Math.round(l.b), scripts: l.scripts }));
    return {
      origin: location.origin, label: F.label, durationMs: Math.round(t1 - t0), frames: d.length,
      p50: r1(q(0.5)), p95: r1(q(0.95)), p99: r1(q(0.99)), longest: r1(d[d.length - 1] ?? null),
      pctOver16_7: d.length ? r1((100 * d.filter((x) => x > 16.7).length) / d.length) : null,
      pctOver33_3: d.length ? r1((100 * d.filter((x) => x > 33.3).length) / d.length) : null,
      droppedFrames: d.reduce((s, x) => s + Math.max(0, Math.round(x / (1000 / 60)) - 1), 0),
      loafCount: win.length, loafMs: Math.round(win.reduce((s, l) => s + l.d, 0)), loafBlockingMs: Math.round(win.reduce((s, l) => s + l.b, 0)), topLoafs: top,
    };
  };
  F.stop = () => { F.running = false; F.t1 = performance.now(); return F.summary(); };
  F.waitPainted = ({ sel, text = null, minCount = 1, timeoutMs = 60000 }) => new Promise((resolve) => {
    const started = performance.now();
    let firstInserted = null;
    const laidOut = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const test = () => {
      const els = document.querySelectorAll(sel);
      if (els.length < minCount) return null;
      if (text == null) return [...els].some(laidOut) ? els.length : null;
      for (const el of els) if ((el.textContent || '').includes(text)) return laidOut(el) ? els.length : null;
      return null;
    };
    let done = false, pending = false;
    const finish = (v) => { if (done) return; done = true; mo.disconnect(); clearTimeout(to); resolve(v); };
    // the check runs in rAF (the DOM this frame paints); the time is taken after that frame's
    // rendering (a MessageChannel task), because a rAF timestamp is the frame's BEGIN time
    const check = (ts) => {
      pending = false;
      if (done) return;
      const n = test();
      if (n == null) return;
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { const now = performance.now(); finish({ origin: location.origin, paintedAt: now, frameBeginAt: ts, insertedAt: firstInserted, count: n, waitedMs: now - started }); };
      ch.port2.postMessage(0);
    };
    const schedule = () => { if (pending || done) return; pending = true; requestAnimationFrame(check); };
    // "inserted" = the DOM change that first carries the text (only the added subtrees are read,
    // never the whole body: a probe must not cost the frames it measures)
    const mo = new MutationObserver((records) => {
      if (firstInserted == null && text != null) {
        outer: for (const r of records) {
          if (r.type === 'characterData' && String(r.target.data || '').includes(text)) { firstInserted = performance.now(); break; }
          for (const n of r.addedNodes) if ((n.textContent || '').includes(text)) { firstInserted = performance.now(); break outer; }
        }
      }
      schedule();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const to = setTimeout(() => finish({ origin: location.origin, timeout: true, insertedAt: firstInserted, waitedMs: performance.now() - started }), timeoutMs);
    schedule();
  });
})();`;
}
