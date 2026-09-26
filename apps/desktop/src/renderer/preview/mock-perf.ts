// THE PERF FIXTURES — a long thread and a long streamed reply, for the render-smoothness round.
//
// Gated behind `?perf=1` so the default harness is unchanged. Two worlds splice in:
//
//   th-perf-long    `Perf long thread` · PERF_LONG messages (default 200, `?perflong=N`) of real
//                   markdown: code fences, tables, lists, long prose. The scroll + open fixture.
//   th-perf-stream  `Perf stream thread` · a short history the streamed reply lands under.
//
// `window.__nmPerfStream(opts)` plays one reply the way the daemon does (host/wake.ts): presence
// first (an empty stream), then the GROWING text on both the room key and the thread key (the
// daemon's emitChat sends both), then `done`, then — `landgap` ms later, the sync hop — the synced
// message, then — `settlegap` ms after that — the wake run settles and the agent goes idle. Every
// emit is timestamped into `window.__nmPerf` so a probe can measure the reveal's lag behind it.
import { agents, allTasks, baseThreadRows, channels, convoMsgs, emitMockStream, machines, members, mockThreads, mockWorkRuns, pingConvo, pingOpenRuns, pingThreads, rosterWatchers, taskThreadExtra, taskThreadWatchers } from './mock-fixtures';

const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const PERF = qs.get('perf') === '1';
const PERF_LONG = Math.max(2, parseInt(qs.get('perflong') || '200', 10));

// mulberry32 — deterministic, so every run and both builds see the same text
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const SENTENCES = [
  'The sync layer replays the upload queue in order, so a write made offline lands exactly once when the socket comes back.',
  'I checked the watcher against `watchConvo` and it re-queries on every row change, which is fine at this size but not at ten thousand rows.',
  'The review cockpit renders the diff from the artifact, never from the working tree, so a reviewer on another machine sees the same bytes.',
  'Most of the cost is not the query itself. It is the render that follows it, because every row re-parses its markdown.',
  'We keep the plan gate human-only by construction: the server refuses an agent approval before the command reaches the reducer.',
  'The berth sweep evicts warm worktrees newest-kept, and a leased berth is never touched while its task is active.',
  'If the machine is offline, the wait ghost says so after the deadline instead of spinning forever.',
  'I measured the cold path twice and the numbers held within five percent, so I am confident the regression is real.',
  'The fix is small: hoist the subscription out of the parent so a delta re-renders the bubble and nothing else.',
  'Tables and code fences are the expensive blocks, because the parser has to see the whole block before it knows what it is.',
  'The orchestrator reads the thread transcript at wake time, trims it to the budget, and then decides whether this is work or talk.',
  'A subtask rides its parent, so the parent cannot submit while any subtask is still open.',
  'The relay is stateless and keyless. Both sides dial out, and control-api validates the two credentials.',
  'Scroll anchoring keeps the reader in place when content grows above the viewport, which is the case that used to jump.',
  'The migration is additive, so it applies cleanly on a replica that is one version behind.',
  'I would not ship this without the failing test first; the old path passed every suite and still broke at boot.',
  'The phase dial is derived from the FSM state and the routing evidence, never stored, so it cannot disagree with the board.',
  'Every stream update used to cost a full pass over the thread, which is why long conversations felt heavy while an agent typed.',
];
const HUMAN_ASKS = [
  'can you check why the thread feels slow once it gets long?',
  'what does the upload queue do when the socket drops mid-write?',
  'ok, and does `watchConvo` re-query on every change or only on new rows?',
  'ship it behind the flag first, then we can flip it for everyone',
  'is the berth sweep safe to run while a task is in review?',
  'show me the numbers before and after, both themes please',
  'why is the landing jumpy when the reply finishes?',
  'nice. what is left on the list?',
  'can you draft the migration and a test for it?',
  'does the relay keep any state between two sessions?',
];
const CODE_LINES = [
  'export function pinToBottom(el: HTMLElement): void {',
  '  const gap = el.scrollHeight - el.scrollTop - el.clientHeight;',
  '  if (gap > 4) el.scrollTop = el.scrollHeight;',
  '}',
  'const rows = await db.getAll<MessageRow>(`select * from messages where thread_id = ? order by created_at`, [threadId]);',
  'for (const row of rows) {',
  '  if (row.author_kind !== \'agent\') continue;',
  '  seen.set(row.id, { at: Date.parse(row.created_at), body: row.body });',
  '}',
  'const watcher = db.watch(sql, params, { throttleMs: 30 });',
  'return () => { live = false; watcher.close(); };',
  'type Delta = { key: string; agent: string; text: string; done: boolean };',
  'if (!nm) return undefined;',
  'const blocks = splitBlocks(text); // top level, outside fences',
  'await post(\'/v1/messages\', actor, { workspace, channel, threadId, body: reply, replyTo: m.id });',
  'console.log(`agent_wake agent=${agent.name} replied=ok ms=${Date.now() - started}`);',
];
const SQL_LINES = [
  'select t.id, t.number, t.state, count(s.id) as open_subtasks',
  '  from tasks t',
  '  left join tasks s on s.parent_task_id = t.id and s.state not in (\'done\', \'closed\')',
  ' where t.channel_id = $1',
  ' group by t.id',
  ' order by t.updated_at desc',
  ' limit 50;',
];
const TABLE_ROWS = [
  ['send', '38 ms', '61 ms', 'local insert, then the upload drains'],
  ['view switch', '12 ms', '19 ms', 'watches already open'],
  ['recall', '67 ms', '113 ms', 'semantic leg, embedder warm'],
  ['cold start', '1.6 s', '2.1 s', 'one checkpoint, logged'],
  ['open thread', '140 ms', '410 ms', '200 messages, full render'],
  ['stream update', '9 ms', '31 ms', 'the whole thread re-renders'],
  ['landing', '22 ms', '64 ms', 'bubble swapped for the row'],
  ['scroll frame', '4 ms', '11 ms', 'compositor, no main-thread work'],
];

function sentences(r: () => number, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(SENTENCES[Math.floor(r() * SENTENCES.length)]!);
  return out.join(' ');
}
function list(r: () => number, n: number, ordered: boolean): string {
  return Array.from({ length: n }, (_, i) => `${ordered ? `${i + 1}.` : '-'} ${i % 3 === 0 ? '**' + SENTENCES[Math.floor(r() * SENTENCES.length)]!.split(' ').slice(0, 3).join(' ') + '**: ' : ''}${SENTENCES[Math.floor(r() * SENTENCES.length)]!}`).join('\n');
}
function code(r: () => number, lines: number): string {
  const sql = r() < 0.25;
  const src = sql ? SQL_LINES : CODE_LINES;
  const body = Array.from({ length: lines }, (_, i) => src[(i + Math.floor(r() * 3)) % src.length]!).join('\n');
  return '```' + (sql ? 'sql' : 'ts') + '\n' + body + '\n```';
}
function table(r: () => number, rows: number): string {
  const head = '| Surface | p50 | p95 | Notes |\n|---|---|---|---|';
  const body = Array.from({ length: rows }, (_, i) => `| ${TABLE_ROWS[(i + Math.floor(r() * 4)) % TABLE_ROWS.length]!.join(' | ')} |`).join('\n');
  return `${head}\n${body}`;
}
function agentBody(r: () => number): string {
  const blocks: string[] = [sentences(r, 1 + Math.floor(r() * 3))];
  const n = 1 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const k = r();
    if (k < 0.3) blocks.push(sentences(r, 2 + Math.floor(r() * 4)));
    else if (k < 0.48) blocks.push(list(r, 3 + Math.floor(r() * 4), r() < 0.4));
    else if (k < 0.66) blocks.push(code(r, 5 + Math.floor(r() * 24)));
    else if (k < 0.8) blocks.push(table(r, 3 + Math.floor(r() * 5)));
    else if (k < 0.92) blocks.push(`### ${SENTENCES[Math.floor(r() * SENTENCES.length)]!.split(' ').slice(0, 4).join(' ')}\n\n${sentences(r, 2)}`);
    else blocks.push(`> ${sentences(r, 1)}`);
  }
  return blocks.join('\n\n');
}

/** the streamed reply: ~8 KB with a 40-line fence and a table, the shape the round is about */
export function perfReply(): string {
  const r = rng(7);
  const fence = '```ts\n' + Array.from({ length: 40 }, (_, i) => CODE_LINES[i % CODE_LINES.length]!).join('\n') + '\n```';
  return [
    sentences(r, 4),
    '### What changed',
    list(r, 6, false),
    sentences(r, 5),
    fence,
    sentences(r, 3),
    table(r, 8),
    '### Next steps',
    list(r, 5, true),
    sentences(r, 6),
    sentences(r, 5),
    'That is the whole change. Say the word and I will open the pull request.',
  ].join('\n\n');
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
function spliceThread(id: string, title: string, rows: any[]): void {
  const list = (mockThreads['c-dev'] ??= []);
  const last = rows[rows.length - 1];
  list.unshift({ id, title, description: '', created_by: 'human:u-george', task_id: null, mode: 'chat', created_at: rows[0]?.created_at ?? iso(0), updated_at: last?.created_at ?? iso(0), msg_count: rows.length, last_body: last?.body ?? null, last_author_kind: last?.author_kind ?? 'agent' } as any);
  convoMsgs[id] = rows;
}

if (PERF) {
  const r = rng(42);
  const long = Array.from({ length: PERF_LONG }, (_, i) => {
    const human = i % 2 === 0;
    const body = i === PERF_LONG - 1 ? `Perf tail marker ${PERF_LONG}. ${sentences(r, 2)}` : human ? HUMAN_ASKS[Math.floor(r() * HUMAN_ASKS.length)]! : agentBody(r);
    return { id: `pl${i}`, author_kind: human && i !== PERF_LONG - 1 ? 'human' : 'agent', author_id: human && i !== PERF_LONG - 1 ? 'u-george' : 'a-rex', created_at: iso((PERF_LONG - i) * 120_000 + 60_000), body };
  });
  const r2 = rng(9);
  const short = Array.from({ length: 12 }, (_, i) => ({ id: `ps${i}`, author_kind: i % 2 === 0 ? 'human' : 'agent', author_id: i % 2 === 0 ? 'u-george' : 'a-rex', created_at: iso((13 - i) * 90_000 + 120_000), body: i % 2 === 0 ? HUMAN_ASKS[i % HUMAN_ASKS.length]! : agentBody(r2) }));
  spliceThread('th-perf-long', 'Perf long thread', long);
  spliceThread('th-perf-stream', 'Perf stream thread', short);
}

export type PerfStreamOpts = {
  thread?: string; agent?: string;
  /** a TASK thread instead: the task wake emits on `${channel}:${taskId}` only */
  task?: string;
  /** stream updates per second (the SDK's token deltas arrive at ~20–60/s) */
  rate?: number;
  /** characters per second of received text */
  cps?: number;
  /** 'tokens' = small deltas at `rate` · 'blocks' = a few big bursts (the Agent SDK's per-block onDelta) */
  mode?: 'tokens' | 'blocks';
  /** ms between `done` and the synced message (the PowerSync hop) */
  landgap?: number;
  /** ms between the synced message and the run settling (the second sync hop) */
  settlegap?: number;
  seed?: number;
};

type PerfLog = { emits: Array<{ t: number; len: number }>; startAt: number; doneAt: number; landAt: number; settleAt: number; textLen: number; landedId: string | null };

/** play one streamed reply into a perf thread; resolves once the run has settled */
export function perfStream(opts: PerfStreamOpts = {}): Promise<PerfLog> {
  const th = opts.thread ?? 'th-perf-stream';
  const agentName = opts.agent ?? 'rex';
  const agent = agents.find((a) => a.name === agentName)!;
  const task = opts.task ? allTasks.find((x: any) => x.id === opts.task) : null;
  const ch = task ? task.channel_id : Object.entries(mockThreads).find(([, l]) => l.some((x) => x.id === th))?.[0] ?? 'c-dev';
  const rate = opts.rate ?? 40;
  const cps = opts.cps ?? 700;
  const landgap = opts.landgap ?? 350;
  const settlegap = opts.settlegap ?? 150;
  const r = rng(opts.seed ?? 3);
  const text = perfReply();
  const log: PerfLog = { emits: [], startAt: performance.now(), doneAt: 0, landAt: 0, settleAt: 0, textLen: text.length, landedId: null };
  (window as any).__nmPerf = log;
  const emit = (t: string, done: boolean) => {
    if (task) emitMockStream(`${ch}:${task.id}`, agentName, t, done); // the task wake: one key
    else { emitMockStream(`${ch}:`, agentName, t, done); emitMockStream(`${ch}:${th}`, agentName, t, done); } // emitChat: the room key AND the thread's
    if (!done) log.emits.push({ t: performance.now(), len: t.length });
  };
  const roster = () => rosterWatchers.forEach((w) => w({ machines, agents, members }));
  // the wake: status + an open wake run on this thread (docs/29 — the ghost's synced twin)
  const run: any = { id: `run-perf-${Date.now()}`, channel_id: ch, thread_id: task ? null : th, task_id: task ? task.id : null, agent_id: agent.id, parent_run_id: null, kind: 'wake', title: 'reply', state: 'running', step: null, done: 0, total: 0, machine_id: 'm1', machine_name: "george's MacBook Pro", summary: null, started_at: new Date().toISOString(), ended_at: null, updated_at: new Date().toISOString() };
  mockWorkRuns.push(run); pingOpenRuns();
  agent.status = 'thinking'; roster();
  emit('', false);
  return new Promise((resolve) => {
    let len = 0;
    const bursts = [0.18, 0.41, 0.7, 1];
    let burst = 0;
    const step = () => {
      if (opts.mode === 'blocks') {
        len = Math.round(text.length * bursts[burst++]!);
      } else {
        const want = Math.max(1, Math.round((cps / rate) * (0.6 + r() * 0.8)));
        len = Math.min(text.length, len + want);
      }
      emit(text.slice(0, len), false);
      if (len < text.length) {
        const gap = opts.mode === 'blocks' ? 1500 : (1000 / rate) * (0.7 + r() * 0.6) + (r() < 0.04 ? 250 : 0);
        setTimeout(step, gap);
        return;
      }
      setTimeout(() => {
        emit('', true);
        log.doneAt = performance.now();
        setTimeout(() => {
          const id = `perf-reply-${Date.now()}`;
          const now = new Date().toISOString();
          const row = { id, author_kind: 'agent', author_id: agent.id, created_at: now, body: text };
          if (task) {
            (taskThreadExtra[task.id] ??= []).push(row);
            for (const w of taskThreadWatchers) if (w.id === task.id) w.cb([...baseThreadRows(w.id), ...taskThreadExtra[task.id]!]);
          } else {
            convoMsgs[th]!.push(row);
            const tr = mockThreads[ch]!.find((x) => x.id === th) as any;
            if (tr) { tr.updated_at = now; tr.msg_count += 1; tr.last_body = text; tr.last_author_kind = 'agent'; }
            pingConvo(th); pingThreads(ch);
          }
          log.landAt = performance.now(); log.landedId = id;
          setTimeout(() => {
            run.state = 'done'; run.ended_at = new Date().toISOString(); pingOpenRuns();
            agent.status = 'idle'; roster();
            log.settleAt = performance.now();
            resolve(log);
          }, settlegap);
        }, landgap);
      }, 120);
    };
    setTimeout(step, 400); // the ghost's beat: presence before the first token
  });
}

if (PERF && typeof window !== 'undefined') Object.assign(window, { __nmPerfStream: perfStream, __nmPerfReply: perfReply, __nmPerfChannels: channels });
