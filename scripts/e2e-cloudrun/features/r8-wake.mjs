// THE SPECULATIVE WAKE, live (decision D13, option W1; control-api fleet-prewake.ts, hq compute/prewake.ts).
// A person who starts to type in a thread composer starts the runner before the send, so the 15 to
// 22 s cold wake overlaps with the typing. This scenario proves it on the sandbox and records timings:
//   1. cold: the runner is parked, a message is sent with no typing first. The wait is message to run
//      open (the run is the ghost hq draws for a cloud machine).
//   2. prewake: the runner is parked, the person types two characters in hq's thread composer. hq
//      calls POST /v1/machines/prewake one time, the runner gets desired_replicas 1 and a new
//      started_at, and last_wake_at does not move (the start is speculative, migration 0175).
//   3. more typing, a blur and a new focus inside 30 s make no second call, and a direct call is a
//      no-op (rate limit, or the machine is awake).
//   4. the send: the wait is measured the same way and compared with the cold one. nm-api also logs
//      machine_wake_wait start=prewoken for it.
//   5. a prewake that no message follows: the sweep drains the runner after NM_PREWAKE_IDLE_MIN (5)
//      plus the sweep cadence, before the 15 min idle window of the sandbox.
import { randomUUID } from 'node:crypto';
import { api, door, feedRows, sleep, snap, until } from './lib.mjs';

const H = (ctx) => ctx.a.userId;
const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const secs = (n) => Math.round(n / 100) / 10;

/** nm-fleet's loop (FLEET_INTERVAL_MS 10 s) plus the scale-down: after this the pool has no instance */
const POOL_SETTLE_MS = 25_000;

/** park the runner, wait until it is asleep (desired 0, no drain), then let nm-fleet scale the pool
 *  to 0. Without the settle, a wake right after the park meets the drained instance that is still
 *  alive (run 31c910a8), which is not the cold path this scenario measures */
async function park(ctx) {
  const t0 = Date.now();
  await door.idleDrain(ctx.ws.runner).catch(() => {});
  const m = await until('the runner parked', async () => {
    const r = await door.machine(ctx.ws.runner).catch(() => null);
    return r && Number(r.desired_replicas) === 0 && !r.drain_state ? r : null;
  }, { timeout: 240_000, every: 2_000 }).catch(() => null);
  if (m) await sleep(POOL_SETTLE_MS);
  return { m, ms: Date.now() - t0 };
}

/** the person's message as the feed has it, and the run the machine opened for it */
async function waitFor(ctx, messageId, { timeout = 180_000 } = {}) {
  const msg = await until('the message row', async () => (await feedRows(H(ctx), 'messages', ctx.ws.id)).find((m) => m.id === messageId) ?? null, { timeout: 30_000, every: 1_500 }).catch(() => null);
  const run = await until('the run for the message', async () => (await feedRows(H(ctx), 'runs', ctx.ws.id)).find((r) => r.trigger_message_id === messageId) ?? null, { timeout, every: 2_000 }).catch(() => null);
  const waitMs = msg && run ? ms(run.started_at) - ms(msg.created_at) : null;
  return { msg, run, waitMs };
}

/** the compute pill's state class (shell/computepill.tsx: `cpill <status>`), or null */
async function pillState(page) {
  const cls = await page.locator('button.cpill').first().getAttribute('class', { timeout: 5_000 }).catch(() => null);
  return cls ? (cls.split(/\s+/).find((c) => c !== 'cpill') ?? null) : null;
}

/** the run for a message settles, so the runner can be parked without a reply in flight */
async function settled(ctx, runId) {
  await until('the run settled', async () => {
    const r = (await feedRows(H(ctx), 'runs', ctx.ws.id)).find((x) => x.id === runId);
    return r && r.state !== 'running' ? r : null;
  }, { timeout: 180_000, every: 4_000 }).catch(() => null);
}

export const r8Wake = [
  {
    id: 'prewake',
    title: 'the speculative wake: typing in a thread composer starts the parked runner before the send (D13 W1, 0175)',
    needs: ['browser'],
    async run(t, ctx) {
      const page = ctx.a.page;
      const runner = ctx.ws.runner;
      if (!runner) t.skip('the workspace has no runner');
      if (!page) t.skip('needs the browser');
      const ws = ctx.ws.id;
      const timings = {};

      // ── 1. the cold send ───────────────────────────────────────────────────────────────────
      const p1 = await park(ctx);
      t.check('the runner parks before the cold send', !!p1.m, { parkMs: p1.ms });
      const threadId = randomUUID();
      const coldId = randomUUID();
      await api('POST', '/v1/messages', { as: H(ctx), body: { workspace: ws, channel: ctx.ws.channelId, threadId, id: coldId, body: `R8 wake ${ctx.tag}: the cold send. Reply with one word.` } });
      const cold = await waitFor(ctx, coldId);
      timings.coldMs = cold.waitMs;
      t.check('cold: the parked runner wakes for the message and opens its run', cold.waitMs !== null && cold.waitMs > 0, { waitMs: cold.waitMs, run: cold.run?.id?.slice(0, 8) ?? null, machine: cold.run?.machine_id?.slice(0, 8) ?? null });
      if (cold.run) await settled(ctx, cold.run.id);

      // ── 2. the prewake from hq's thread composer ───────────────────────────────────────────
      const p2 = await park(ctx);
      t.check('the runner parks again before the typing', !!p2.m, { parkMs: p2.ms });
      const before = p2.m ?? await door.machine(runner);
      const calls = [];
      const onResponse = async (r) => {
        if (!r.url().includes('/v1/machines/prewake') || r.request().method() !== 'POST') return;
        calls.push({ at: Date.now(), status: r.status(), body: await r.json().catch(() => null) });
      };
      page.on('response', onResponse);
      try {
        await page.goto(`${ctx.cfg.hq}/${ctx.ws.slug}/c/${threadId}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        const box = page.locator('.tcompose textarea:visible').last();
        await box.waitFor({ state: 'visible', timeout: 45_000 });
        // the compute snapshot must read the runner as asleep, or hq skips the call (prewake.ts):
        // a fresh page reads /v1/machines/usage on mount
        await sleep(3_000);
        // a runner parked seconds ago was seen seconds ago (it just drained): it must read ASLEEP,
        // never "Awake and ready" (live build 25f8d8dd, shared machineState)
        const parkedPill = await until('the pill reads asleep', async () => (await pillState(page)) === 'asleep' ? 'asleep' : null, { timeout: 20_000, every: 1_000 }).catch(() => pillState(page));
        await snap(page, 'prewake-pill-asleep');
        t.check('the compute pill reads Asleep for the parked runner, not Awake', parkedPill === 'asleep', { pill: parkedPill });
        await box.click();
        const typedAt = Date.now();
        await page.keyboard.type('Pl', { delay: 120 });
        const first = await until('the prewake call', async () => calls[0] ?? null, { timeout: 15_000, every: 250 }).catch(() => null);
        timings.keystrokeToCallMs = first ? first.at - typedAt : null;
        t.check('two characters in the thread composer make hq call POST /v1/machines/prewake, and it starts the runner', first?.status === 200 && first.body?.outcome === 'woken' && (first.body?.woken ?? []).includes(runner), { status: first?.status, body: first?.body, keystrokeToCallMs: timings.keystrokeToCallMs });
        const woke = await until('desired_replicas 1', async () => {
          const m = await door.machine(runner);
          return Number(m.desired_replicas) === 1 ? m : null;
        }, { timeout: 15_000, every: 500 }).catch(() => null);
        timings.keystrokeToDesiredMs = woke ? Date.now() - typedAt : null;
        const startedNew = !!woke && ms(woke.started_at) >= typedAt - 5_000;
        const wakeUntouched = (woke?.last_wake_at ?? null) === (before.last_wake_at ?? null);
        t.check('the runner gets desired_replicas 1 and a new started_at within a few seconds', !!woke && !!startedNew, { keystrokeToDesiredMs: timings.keystrokeToDesiredMs, startedAt: woke?.started_at });
        t.check('the start is speculative: last_wake_at does not move (only a message moves it)', !!woke && wakeUntouched, { before: before.last_wake_at, after: woke?.last_wake_at });
        await sleep(1_500);
        const wokenPill = await until('the pill reads waking or awake', async () => { const p = await pillState(page); return p === 'waking' || p === 'online' ? p : null; }, { timeout: 15_000, every: 1_000 }).catch(() => pillState(page));
        await snap(page, 'prewake-compute-pill');
        t.check('after the prewake the compute pill reads Waking or Awake', wokenPill === 'waking' || wokenPill === 'online', { pill: wokenPill });

        // ── 3. no second call inside the window ──────────────────────────────────────────────
        await page.keyboard.type('ease reply', { delay: 60 });
        await box.evaluate((el) => el.blur()).catch(() => {});
        await box.click();
        await page.keyboard.type(' with', { delay: 60 });
        await sleep(2_000);
        t.check('more typing, a blur and a new focus inside 30 s make no second call', calls.length === 1, { calls: calls.length });
        const direct = await api('POST', '/v1/machines/prewake', { as: H(ctx), body: { workspace: ws, surface: 'thread' } }).catch((e) => ({ error: e?.status ?? String(e) }));
        const still = await door.machine(runner);
        t.check('a direct call inside the window is a no-op (rate_limited, or awake on another instance)', ['rate_limited', 'awake'].includes(direct?.outcome) && still.started_at === woke?.started_at, { outcome: direct?.outcome ?? direct, startedAt: still.started_at });

        // ── 4. the send after typing ─────────────────────────────────────────────────────────
        // a person types for a while: send 12 s after the first keystroke
        await page.keyboard.type(` one word. R8 wake ${ctx.tag} prewoken.`, { delay: 40 });
        const left = 12_000 - (Date.now() - typedAt);
        if (left > 0) await sleep(left);
        timings.leadMs = Date.now() - typedAt;
        const sentAt = Date.now();
        await page.keyboard.press('Enter');
        const msg = await until('the prewoken message row', async () => (await feedRows(H(ctx), 'messages', ws)).find((m) => m.thread_id === threadId && m.author_kind === 'human' && (m.body ?? '').includes(`R8 wake ${ctx.tag} prewoken`)) ?? null, { timeout: 30_000, every: 1_000 }).catch(() => null);
        t.check('the message is sent from the composer', !!msg, { sendToRowMs: msg ? Date.now() - sentAt : null });
        const warm = msg ? await waitFor(ctx, msg.id) : { waitMs: null };
        timings.prewokenMs = warm.waitMs;
        t.check('prewoken: the run opens for the message', warm.waitMs !== null, { waitMs: warm.waitMs, run: warm.run?.id?.slice(0, 8) ?? null });
        t.check('the prewoken wait is shorter than the cold wait', warm.waitMs !== null && cold.waitMs !== null && warm.waitMs < cold.waitMs, { coldMs: cold.waitMs, prewokenMs: warm.waitMs, savedMs: cold.waitMs !== null && warm.waitMs !== null ? cold.waitMs - warm.waitMs : null });
        await snap(page, 'prewake-sent');
        if (warm.run) await settled(ctx, warm.run.id);
        ctx.r8WakeIds = { cold: coldId, prewoken: msg?.id ?? null, coldRun: cold.run?.id ?? null, prewokenRun: warm.run?.id ?? null };
      } finally {
        page.off('response', onResponse);
      }

      // ── 5. a prewake with no message stops on the short timeout ────────────────────────────
      const p3 = await park(ctx);
      t.check('the runner parks before the unanswered prewake', !!p3.m, { parkMs: p3.ms });
      const quiet = p3.m ?? await door.machine(runner);
      const lone = await api('POST', '/v1/machines/prewake', { as: H(ctx), body: { workspace: ws, surface: 'thread' } }).catch((e) => ({ error: e?.status ?? String(e) }));
      const loneAt = Date.now();
      t.check('a prewake with no message starts the runner', lone?.outcome === 'woken', lone);
      // the sandbox: NM_PREWAKE_IDLE_MIN 5, the in-process sweep every 300 s, the idle window 15 min.
      // A drain that begins before 15 min can only be the speculative stop
      const drained = await until('the speculative stop', async () => {
        const m = await door.machine(runner);
        if (m.last_wake_at !== quiet.last_wake_at) return { m, moved: true };
        return m.drain_state === 'draining' || Number(m.desired_replicas) === 0 ? { m, moved: false } : null;
      }, { timeout: 15 * 60_000, every: 15_000 }).catch(() => null);
      timings.speculativeStopMin = drained ? secs(Date.now() - loneAt) / 60 : null;
      t.check('the runner drains after the speculative timeout, before the 15 min idle window, with no message', !!drained && !drained.moved && Date.now() - loneAt < 14.5 * 60_000 && Date.now() - loneAt >= 4.5 * 60_000,
        { minutes: timings.speculativeStopMin && Math.round(timings.speculativeStopMin * 10) / 10, drain: drained?.m?.drain_state ?? null, reason: drained?.m?.drain_reason ?? null, desired: drained?.m?.desired_replicas, lastWakeMoved: drained?.moved ?? null });
      await park(ctx);
      t.note({ timings, ids: ctx.r8WakeIds ?? null, runner: runner.slice(0, 8) });
    },
  },
];
