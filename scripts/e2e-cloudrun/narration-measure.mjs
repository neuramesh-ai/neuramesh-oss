#!/usr/bin/env node
// LIVE NARRATION MEASURE (round 9). After a deploy, the coordinator sends one message in a fresh
// session and runs this script. It reads the machine's own log lines and prints, per turn:
//
//   firstVisibleMs   message wake to the first frame a person can read (words or a progress line)
//   firstWordsMs     wake to the first reply words
//   firstProgressMs  wake to the first progress line
//   progressLines    progress lines the person saw
//   tools, batches   tool calls, and the groups they came in (from narration_stats)
//   progressPerBatch progressLines / batches (the goal is 1 or more)
//   totalMs          wake to the end of the live stream
//
// Two sources, both on the machine's worker pool log:
//   · `[livestream] <ms> open|flush|end k=<key> ...` lines. They print only when the machine runs with
//     NM_STREAM_TRACE=1 (add it to FLEET_CLOUDRUN_MACHINE_ENV for the measured run).
//   · `narration_stats lane=... key=<thread> tools=N batches=N progress=N ...`, one per turn, always on
//     (apps/desktop/src/main/host/narration-stats.ts).
//
// Usage (read only, it changes nothing):
//   node scripts/e2e-cloudrun/narration-measure.mjs --project galonge-sandbox-04 --since 2026-11-06T18:00:00Z \
//     [--until 2026-11-06T18:30:00Z] [--thread <threadId>] [--json]
// No dependencies. `measureNarration` is pure and unit tested (narration-measure.test.mjs).
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const TRACE = /\[livestream\]\s+(\d+)\s+(open|flush|end|publish)\s+k=(\S+)(.*)$/;
const STATS = /narration_stats\s+(.*)$/;
const fields = (rest) => Object.fromEntries([...rest.matchAll(/(\w+)=(\S+)/g)].map(([, k, v]) => [k, v]));
const num = (v) => (v === undefined || v === '-' ? undefined : Number(v));

/**
 * Turns from raw log lines (`{ text }`, in any order). A turn is one stream epoch on a thread key
 * (`<channel>:<thread>`), from its `open` to its `end`. A room key (`<channel>:`) mirrors the thread
 * key and is skipped. `thread` keeps only that thread.
 */
export function measureNarration(lines, opts = {}) {
  const traces = [];
  const stats = [];
  for (const { text } of lines) {
    const t = TRACE.exec(text ?? '');
    if (t) { traces.push({ at: Number(t[1]), kind: t[2], key: t[3], ...fields(t[4]) }); continue; }
    const s = STATS.exec(text ?? '');
    if (s) stats.push(fields(s[1]));
  }
  traces.sort((a, b) => a.at - b.at);
  const turns = [];
  const open = new Map();
  for (const tr of traces) {
    const thread = tr.key.slice(tr.key.indexOf(':') + 1);
    if (!thread || (opts.thread && thread !== opts.thread)) continue;
    if (tr.kind === 'open') {
      const turn = { key: tr.key, thread, agent: tr.a, openAt: tr.at, firstWordsMs: undefined, firstProgressMs: undefined, firstThoughtMs: undefined, progressLines: 0, frames: 0, totalMs: undefined };
      open.set(tr.key, turn); turns.push(turn); continue;
    }
    const turn = open.get(tr.key);
    if (!turn) continue;
    const since = tr.at - turn.openAt;
    if (tr.kind === 'flush') {
      turn.frames += 1;
      if (num(tr.len) > 0 && turn.firstWordsMs === undefined) turn.firstWordsMs = since;
      if (num(tr.pg) > 0) { turn.progressLines = Math.max(turn.progressLines, num(tr.pg)); if (turn.firstProgressMs === undefined) turn.firstProgressMs = since; }
      if (num(tr.th) > 0 && turn.firstThoughtMs === undefined) turn.firstThoughtMs = since;
    }
    if (tr.kind === 'end') { turn.totalMs = since; open.delete(tr.key); }
  }
  // narration_stats name the conversation thread (traceKey); a retry prints a second line, so sum them
  const byThread = new Map();
  for (const s of stats) {
    if (!s.key || s.key === '-') continue;
    const held = byThread.get(s.key) ?? { tools: 0, batches: 0, lanes: new Set(), lines: 0 };
    held.tools += num(s.tools) ?? 0; held.batches += num(s.batches) ?? 0; held.lanes.add(s.lane); held.lines += 1;
    byThread.set(s.key, held);
  }
  return turns.map((turn) => {
    const visible = [turn.firstWordsMs, turn.firstProgressMs].filter((v) => v !== undefined);
    const s = byThread.get(turn.thread);
    // one turn per thread is the measured case; several turns on one thread share the stats sum
    return {
      ...turn,
      firstVisibleMs: visible.length ? Math.min(...visible) : undefined,
      lane: s ? [...s.lanes].join('+') : undefined,
      tools: s?.tools, batches: s?.batches,
      progressPerBatch: s?.batches ? Number((turn.progressLines / s.batches).toFixed(2)) : undefined,
    };
  });
}

function readLogs({ project, since, until, thread }) {
  const filter = [
    'resource.type="cloud_run_worker_pool"',
    `timestamp>="${since}"`,
    ...(until ? [`timestamp<="${until}"`] : []),
    thread ? `(textPayload:"${thread}")` : '(textPayload:"[livestream]" OR textPayload:"narration_stats")',
  ].join(' AND ');
  const out = execFileSync('gcloud', ['logging', 'read', filter, `--project=${project}`, '--format=json', '--limit=20000'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(out || '[]').map((e) => ({ text: e.textPayload ?? '' }));
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const project = arg('project');
  const since = arg('since');
  if (!project || !since) {
    console.error('usage: narration-measure.mjs --project <id> --since <iso> [--until <iso>] [--thread <id>] [--json]');
    process.exit(2);
  }
  const turns = measureNarration(readLogs({ project, since, until: arg('until'), thread: arg('thread') }), { thread: arg('thread') });
  if (argv.includes('--json')) { console.log(JSON.stringify(turns, null, 2)); return; }
  if (!turns.length) { console.log('No traced turns. Check that the machine runs with NM_STREAM_TRACE=1 and the window holds a reply.'); return; }
  for (const t of turns) {
    console.log(`${t.thread} (${t.agent ?? '?'}, ${t.lane ?? 'lane ?'}): firstVisible=${t.firstVisibleMs ?? '-'}ms firstWords=${t.firstWordsMs ?? '-'}ms firstProgress=${t.firstProgressMs ?? '-'}ms progress=${t.progressLines} tools=${t.tools ?? '-'} batches=${t.batches ?? '-'} perBatch=${t.progressPerBatch ?? '-'} total=${t.totalMs ?? '-'}ms`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
