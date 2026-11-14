#!/usr/bin/env node
// THE SYNC FEED UNDER LOAD (gate A1, design §10.2 and R18). K simulated feed clients across M fresh
// workspaces read GET /v1/sync/changes against the live nm-api while one writer changes a synced row
// at a steady rate. It measures what a person sees: the time from a write to its delivery on every
// client of that workspace, and what the server pays: the request rate and the errors.
//
// The clients behave like hq's FeedReplica and the desktop's LocalReplica. Against a server that
// answers with the `wait` capability field they long-poll (`&wait=25`) and re-ask at once. Against an
// older server they poll every second, as the shipped clients do. So one script gives the baseline on
// the current deploy and the after numbers on a deploy of the long-poll branch.
//
// Setup, with no machine boots (a first workspace is born with an AWAKE runner, workspace-birth.ts):
//   · one owner account, the same on every run (`<prefix>-owner@e2e.invalid`). Its first workspace,
//     the anchor, is made once and its runner is parked at once. Every later workspace is a second
//     one, so it gets no runner.
//   · M workspaces per run, on the cloud plan so that the owner may invite (FREE_SEAT_CAP is 1).
//   · one reader account per workspace, invited by the owner and accepting. A join provisions a
//     member machine that is born ASLEEP (member-machines.ts), so nothing boots.
//   · the K clients are the readers' tabs: K/M per workspace, each reader bootstraps once and its
//     tabs start from that cursor.
// The writes are `channel.rename` topics on the general channel of the first W workspaces: one
// synced row per write, and no message, so no machine wakes. The topic carries a write number.
//
// Node 24, no dependencies. Environment:
//   NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET    as for run.mjs
//   NM_LOAD_CLIENTS (200)  NM_LOAD_WORKSPACES (20)  NM_LOAD_WRITE_WORKSPACES (M/2)
//   NM_LOAD_WRITES_PER_S (2)  NM_LOAD_SECONDS (180)  NM_LOAD_MODE (auto | poll | wait)
//   NM_LOAD_SYNC_PATH (/v1/sync, or /v1/brain/replica)
//   NM_LOAD_PREFIX (r6feed-load)  NM_LOAD_KEEP=1 keeps the run's workspaces
//   NM_LOAD_CLEANUP=<tag> only removes the workspaces an earlier run of that tag kept
//   NM_LOAD_REPORT (a path for the JSON report, beside stdout)
import { writeFileSync } from 'node:fs';

const env = (k, d) => process.env[k] ?? d;
const num = (k, d) => { const n = Number(env(k, d)); return Number.isFinite(n) && n > 0 ? n : d; };
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`${k} is required`); process.exit(2); } return v.replace(/\/+$/, ''); };
const API = need('NM_API_URL');
const SECRET = need('FLEET_SECRET');
const ACTOR_SECRET = env('NM_ACTOR_SECRET', '');
const K = num('NM_LOAD_CLIENTS', 200);
const M = num('NM_LOAD_WORKSPACES', 20);
const W = Math.min(M, num('NM_LOAD_WRITE_WORKSPACES', Math.ceil(M / 2)));
const RATE = num('NM_LOAD_WRITES_PER_S', 2);
const SECONDS = num('NM_LOAD_SECONDS', 180);
const MODE = env('NM_LOAD_MODE', 'auto');
const PREFIX = env('NM_LOAD_PREFIX', 'r6feed-load');
// the feed's route: /v1/sync (round 6) or /v1/brain/replica (the client-core SQLiteReplica's alias, r7)
const SYNC = env('NM_LOAD_SYNC_PATH', '/v1/sync').replace(/\/+$/, '');
const POLL_MS = 1000;
const WAIT_S = 25;
const GRACE_MS = 30_000;
const tag = `${PREFIX}-${Date.now().toString(36)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = {
  tag, api: API, startedAt: new Date().toISOString(), config: { K, M, W, RATE, SECONDS, MODE, SYNC },
  mode: null, window: null, writes: {}, latency: {}, requests: {}, setup: {}, failures: [],
};

async function call(method, path, { body, fleet = false, as = null } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (fleet) headers.authorization = `Bearer ${SECRET}`;
  if (as) headers['x-nm-actor'] = JSON.stringify(as);
  if (as && ACTOR_SECRET) headers['x-nm-actor-secret'] = ACTOR_SECRET;
  const res = await fetch(`${API}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`), { status: res.status, json });
  return json;
}
const user = async (email) => ({ kind: 'human', id: (await call('POST', '/internal/e2e/users', { fleet: true, body: { email } })).userId });
const cmd = (as, c) => call('POST', '/v1/commands', { as, body: c });

/** a small pool, so setup does not open hundreds of requests at once */
async function each(items, width, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function setup() {
  const t0 = Date.now();
  const owner = await user(`${PREFIX}-owner@e2e.invalid`);
  report.setup.owner = owner.id;
  const mine = (await call('GET', '/v1/workspaces', { as: owner })).workspaces ?? [];
  if (!mine.length) {
    // the anchor: the owner's first workspace, born with an awake runner. Park it now (brief: park what you wake)
    const anchor = await cmd(owner, { type: 'workspace.create', name: `${PREFIX} anchor`, slug: `${PREFIX}-anchor` });
    const usage = await call('GET', `/v1/machines/usage?workspace=${anchor.workspaceId}`, { as: owner });
    const runner = usage?.machines?.find((m) => m.kind === 'runner')?.id;
    if (runner) await call('POST', `/internal/machines/${runner}/idle-drain`, { fleet: true, body: {} }).catch((e) => report.failures.push(`anchor park: ${e.message}`));
    report.setup.anchor = { workspace: anchor.workspaceId, runner: runner ?? null };
  }
  const spaces = await each(Array.from({ length: M }, (_, i) => i), 4, async (i) => {
    const made = await cmd(owner, { type: 'workspace.create', name: `${tag} ${i}`, slug: `${tag}-w${i}` });
    await call('POST', `/internal/e2e/workspaces/${made.workspaceId}/fund`, { fleet: true, body: { plan: 'cloud' } });
    const email = `${tag}-r${i}@e2e.invalid`;
    const reader = await user(email);
    const invite = await cmd(owner, { type: 'workspace.invite', workspace: made.workspaceId, email });
    await cmd(reader, { type: 'workspace.accept_invite', invite: invite.inviteId });
    return { workspace: made.workspaceId, channel: made.channelId, reader };
  });
  // one bootstrap per reader; its tabs share the cursor (a cursor names the principal, not the tab)
  await each(spaces, 4, async (s) => {
    const res = await fetch(`${API}${SYNC}/bootstrap`, { headers: syncHeaders(s.reader), signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`bootstrap for ${s.workspace} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const batch = await res.json();
    if (!batch.workspaces?.includes(s.workspace)) throw new Error(`the reader's bootstrap does not include ${s.workspace}: ${JSON.stringify(batch.workspaces)}`);
    s.cursor = batch.cursor;
    s.wait = typeof batch.wait === 'number' && batch.wait > 0 ? batch.wait : 0;
  });
  report.setup.ms = Date.now() - t0;
  report.setup.workspaces = spaces.map((s) => s.workspace);
  return { owner, spaces };
}

function syncHeaders(as) {
  const h = { 'x-nm-actor': JSON.stringify(as), 'accept-encoding': 'gzip' };
  if (ACTOR_SECRET) h['x-nm-actor-secret'] = ACTOR_SECRET;
  return h;
}

/** the writes: write number → { ws, startedAt, doneAt } */
const writes = new Map();
/** deliveries: write number → Map(client → deliveredAt) */
const seen = new Map();
const counts = { requests: 0, ok: 0, empty: 0, waited: 0, retryHints: 0, resets: 0, byStatus: {}, errors: {}, bytes: 0 };
const latencyOfRequests = [];

function noteDelivery(client, batch) {
  for (const ch of batch.changes ?? []) {
    if (ch.table !== 'channels' || !ch.row) continue;
    const m = /^load:(\d+)$/.exec(String(ch.row.topic ?? ''));
    if (!m) continue;
    const n = Number(m[1]);
    let by = seen.get(n);
    if (!by) seen.set(n, (by = new Map()));
    if (!by.has(client.id)) by.set(client.id, Date.now());
  }
}

async function runClient(client, stop) {
  let failures = 0;
  while (!stop.signal.aborted) {
    const longPoll = MODE === 'wait' || (MODE === 'auto' && client.space.wait > 0);
    const url = `${API}${SYNC}/changes?cursor=${encodeURIComponent(client.cursor)}${longPoll ? `&wait=${WAIT_S}` : ''}`;
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(url, { headers: syncHeaders(client.space.reader), signal: AbortSignal.any([stop.signal, AbortSignal.timeout((WAIT_S + 15) * 1000)]) });
    } catch (e) {
      if (stop.signal.aborted) return;
      counts.requests++;
      const k = e?.name ?? 'Error';
      counts.errors[k] = (counts.errors[k] ?? 0) + 1;
      failures++;
      await sleep(Math.min(30_000, POLL_MS * 2 ** Math.min(failures, 5)));
      continue;
    }
    counts.requests++;
    counts.byStatus[res.status] = (counts.byStatus[res.status] ?? 0) + 1;
    if (res.status === 409) {
      // a reset: the shipped clients bootstrap again. Here the reader's tabs share a cursor, so take the
      // one the next bootstrap gives (rare: only a membership or retention change)
      counts.resets++;
      const b = await fetch(`${API}${SYNC}/bootstrap`, { headers: syncHeaders(client.space.reader), signal: stop.signal }).then((r) => r.json()).catch(() => null);
      if (b?.cursor) client.cursor = b.cursor;
      continue;
    }
    if (!res.ok) {
      await res.text().catch(() => '');
      failures++;
      await sleep(Math.min(30_000, POLL_MS * 2 ** Math.min(failures, 5)));
      continue;
    }
    failures = 0;
    const text = await res.text();
    counts.bytes += text.length;
    const batch = JSON.parse(text);
    const took = Date.now() - t0;
    latencyOfRequests.push(took);
    counts.ok++;
    noteDelivery(client, batch);
    const news = batch.cursor !== client.cursor;
    if (!news) counts.empty++;
    if (longPoll && !news && took >= 1000) counts.waited++;
    client.cursor = batch.cursor;
    if (typeof batch.wait === 'number') client.space.wait = batch.wait;
    if (batch.hasMore) continue;
    if (typeof batch.retryMs === 'number' && batch.retryMs > 0) {
      counts.retryHints++;
      await sleep(batch.retryMs);
    } else if (!longPoll) {
      await sleep(POLL_MS);
    } else if (!news && took < 1000) {
      // a long-poll that came back empty at once is no long-poll: never spin
      await sleep(POLL_MS);
    }
  }
}

async function writer(owner, spaces, stop) {
  const targets = spaces.slice(0, W);
  const every = 1000 / RATE;
  let n = 0;
  const started = Date.now();
  const inflight = new Set();
  while (!stop.signal.aborted && Date.now() - started < SECONDS * 1000) {
    const due = started + n * every;
    if (due > Date.now()) await sleep(due - Date.now());
    const id = ++n;
    const s = targets[id % targets.length];
    const w = { ws: s.workspace, startedAt: Date.now(), doneAt: null, error: null };
    writes.set(id, w);
    const p = cmd(owner, { type: 'channel.rename', channel: s.channel, topic: `load:${id}` })
      .then(() => { w.doneAt = Date.now(); })
      .catch((e) => { w.error = e.message.slice(0, 200); })
      .finally(() => inflight.delete(p));
    inflight.add(p);
  }
  await Promise.all(inflight);
}

const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

function summarize(clients, spaces, window) {
  const fromStart = [];
  const fromDone = [];
  let expected = 0;
  let delivered = 0;
  const perWs = new Map(spaces.map((s) => [s.workspace, clients.filter((c) => c.space === s).map((c) => c.id)]));
  for (const [id, w] of writes) {
    if (w.error || !w.doneAt) continue;
    const audience = perWs.get(w.ws) ?? [];
    expected += audience.length;
    const by = seen.get(id) ?? new Map();
    for (const c of audience) {
      const at = by.get(c);
      if (at === undefined) continue;
      delivered++;
      fromStart.push(at - w.startedAt);
      fromDone.push(Math.max(0, at - w.doneAt));
    }
  }
  const writeMs = [...writes.values()].filter((w) => w.doneAt).map((w) => w.doneAt - w.startedAt);
  const secs = (window.end - window.start) / 1000;
  report.writes = { count: writes.size, failed: [...writes.values()].filter((w) => w.error).length, firstErrors: [...writes.values()].filter((w) => w.error).slice(0, 3).map((w) => w.error), p50Ms: pct(writeMs, 50), p95Ms: pct(writeMs, 95) };
  report.latency = {
    expectedDeliveries: expected, delivered, missing: expected - delivered,
    fromWriteStart: { p50: pct(fromStart, 50), p95: pct(fromStart, 95), p99: pct(fromStart, 99), max: pct(fromStart, 100) },
    fromWriteAck: { p50: pct(fromDone, 50), p95: pct(fromDone, 95), p99: pct(fromDone, 99), max: pct(fromDone, 100) },
  };
  report.requests = { ...counts, perSecond: Math.round((counts.requests / secs) * 10) / 10, seconds: Math.round(secs), requestMs: { p50: pct(latencyOfRequests, 50), p95: pct(latencyOfRequests, 95) } };
}

/** a workspace with other members cannot be deleted: each reader leaves first, then the owner deletes */
async function cleanup(owner, spaces) {
  if (env('NM_LOAD_KEEP', '') === '1') return;
  await each(spaces, 4, async (s) => {
    try {
      await cmd(s.reader, { type: 'workspace.leave', workspace: s.workspace });
      await cmd(owner, { type: 'workspace.delete', workspace: s.workspace });
    } catch (e) { report.failures.push(`cleanup ${s.workspace}: ${e.message.slice(0, 160)}`); }
  });
}

/** NM_LOAD_CLEANUP=<tag>: remove the workspaces an earlier run of that tag left behind, and stop */
async function cleanupTag(old) {
  const owner = await user(`${PREFIX}-owner@e2e.invalid`);
  const mine = (await call('GET', '/v1/workspaces', { as: owner })).workspaces ?? [];
  const spaces = [];
  for (const w of mine) {
    const m = new RegExp(`^${old}-w(\\d+)$`).exec(String(w.slug ?? ''));
    if (m) spaces.push({ workspace: w.id, reader: await user(`${old}-r${m[1]}@e2e.invalid`) });
  }
  await cleanup(owner, spaces);
  report.cleanup = { tag: old, workspaces: spaces.length };
}

async function main() {
  if (env('NM_LOAD_CLEANUP', '')) return cleanupTag(env('NM_LOAD_CLEANUP', ''));
  const { owner, spaces } = await setup();
  report.mode = MODE === 'auto' ? (spaces.every((s) => s.wait > 0) ? 'wait' : 'poll') : MODE;
  console.log(`[feed-load] ${tag}: ${M} workspaces ready in ${report.setup.ms} ms, server long-poll ${spaces[0]?.wait ? `yes (wait ${spaces[0].wait} s)` : 'no'}, clients ${report.mode}`);
  const clients = Array.from({ length: K }, (_, i) => ({ id: i, space: spaces[i % spaces.length], cursor: null }));
  for (const c of clients) c.cursor = c.space.cursor;
  const stop = new AbortController();
  const loops = clients.map((c, i) => sleep((i * 1000) / K).then(() => runClient(c, stop)));
  await sleep(10_000); // the clients settle into their rhythm before the first write
  const window = { start: Date.now(), end: 0 };
  // the request counters cover the measured window only
  Object.assign(counts, { requests: 0, ok: 0, empty: 0, waited: 0, retryHints: 0, resets: 0, byStatus: {}, errors: {}, bytes: 0 });
  latencyOfRequests.length = 0;
  await writer(owner, spaces, stop);
  await sleep(GRACE_MS);
  window.end = Date.now();
  stop.abort();
  await Promise.allSettled(loops);
  report.window = { start: new Date(window.start).toISOString(), end: new Date(window.end).toISOString() };
  summarize(clients, spaces, window);
  await cleanup(owner, spaces);
}

main().then(() => {
  report.ok = report.cleanup ? !report.failures.length : report.writes.failed === 0 && report.latency.missing === 0;
}, (e) => {
  report.ok = false;
  report.failures.push(e.stack ?? String(e));
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  const json = JSON.stringify(report, null, 2);
  console.log(json);
  if (process.env.NM_LOAD_REPORT) writeFileSync(process.env.NM_LOAD_REPORT, json);
  console.log(`FEED_LOAD_WINDOW=${report.window?.start ?? ''},${report.window?.end ?? ''}`);
  process.exit(report.ok ? 0 : 1);
});
