// aggregate.mjs: fold the interleaved before/after runs of run-compare.sh into one JSON (medians, p75, n).
//   node aggregate.mjs [--before final-before] [--after final-after] > final.json
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const R = resolve(here, 'results');
const q = (xs, p) => { const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const i = (v.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return +(v[lo] + (v[hi] - v[lo]) * (i - lo)).toFixed(1); };
const stat = (xs) => ({ median: q(xs, 0.5), p75: q(xs, 0.75), min: q(xs, 0), max: q(xs, 1), n: xs.filter((x) => typeof x === 'number').length });
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LABELS = { before: arg('--before', 'final-before'), after: arg('--after', 'final-after') };
const out = { generatedAt: new Date().toISOString(), labels: LABELS, load: {}, frames: {} };
const LOAD_FIELDS = ['ttfb', 'fcp', 'lcp', 'shell', 'composerVisible', 'composerTyped', 'reactShell', 'reactComposer', 'dbReady', 'connected', 'synced', 'data', 'longTaskMs', 'loafBlockingMs', 'cls', 'requests', 'bytesJs', 'bytesCss', 'bytesWasm', 'bytesJsCssWasm', 'bytesTotal', 'mainThreadCpuMsToData'];
for (const side of ['before', 'after']) {
  for (const profile of ['broadband', 'fast4g']) {
    const f = resolve(R, `load-${LABELS[side]}-${profile}-both.json`);
    if (!existsSync(f)) continue;
    const d = JSON.parse(readFileSync(f, 'utf8'));
    for (const mode of ['cold', 'warm']) {
      const runs = d.runs.filter((r) => r.mode === mode);
      const o = { n: runs.length, archs: [...new Set(runs.map((r) => r.pageArch))], translated: runs.some((r) => r.chromeTranslated), syncErrors: runs.reduce((a, r) => a + (r.syncErrors?.length ?? 0), 0), loadavg: stat(runs.map((r) => r.loadavg?.start?.[0] ?? r.loadavg?.[0])) };
      for (const k of LOAD_FIELDS) o[k] = stat(runs.map((r) => r.metrics?.[k]));
      o.wireBytesDown = stat(runs.map((r) => r.proxyStats?.bytesDown));
      (out.load[`${side}.${profile}.${mode}`] = o);
    }
  }
  const files = readdirSync(R).filter((n) => n.startsWith(`frames-${LABELS[side]}-cpu4x-r`) && n.endsWith('.json')).sort();
  const runs = files.flatMap((n) => JSON.parse(readFileSync(resolve(R, n), 'utf8')).runs ?? []);
  const pick = (fn) => stat(runs.map((r) => { try { return fn(r); } catch { return null; } }));
  out.frames[side] = {
    n: runs.length, files,
    homeToLongMs: pick((r) => r.homeToLong.ms), homeToLongFrameP95: pick((r) => r.homeToLong.frameP95),
    longToReplyMs: pick((r) => r.longToReply.ms), replyToLongMs: pick((r) => r.replyToLong.ms),
    replyPostToPaintMs: pick((r) => r.reply.postToHeadPaintedMs), replyPostToReplicaMs: pick((r) => r.reply.postToReplicaMs),
    replyFramesP95: pick((r) => r.reply.frames.p95), replyLoafBlockingMs: pick((r) => r.reply.frames.loafBlockingMs),
    scrollUpFrameP95: pick((r) => r.scrollUp.frames.p95), scrollUpPctOver16: pick((r) => r.scrollUp.frames.pctOver16_7), scrollUpDropped: pick((r) => r.scrollUp.frames.droppedFrames), scrollUpLoafBlockingMs: pick((r) => r.scrollUp.frames.loafBlockingMs), scrollUpPxPerS: pick((r) => r.scrollUp.pxPerSecond),
    scrollDownFrameP95: pick((r) => r.scrollDown.frames.p95), scrollDownPctOver16: pick((r) => r.scrollDown.frames.pctOver16_7),
    flingUpFrameP95: pick((r) => r.flingUp.frames.p95), flingUpPctOver16: pick((r) => r.flingUp.frames.pctOver16_7), flingUpLongest: pick((r) => r.flingUp.frames.longest),
    threadDomNodes: pick((r) => r.threadDom?.nodes ?? r.threadDom?.domNodes),
    loadavg: pick((r) => r.loadavg?.[0]),
  };
}
console.log(JSON.stringify(out, null, 1));
