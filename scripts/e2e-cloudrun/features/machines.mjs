// MACHINE-SIDE FACTS THE PAGE READS (r6). Opt-in scenarios: features.mjs runs one only when FEATURES
// names it, because each changes the workspace in a way the rest of the suite must not inherit.
import { cmd, door, feedRows, sleep, until } from './lib.mjs';

const H = (ctx) => ctx.a.userId;

export const machines = [
  {
    id: 'runner-runtimes',
    optIn: true,
    title: 'a Cloud Run runner publishes its runtimes at boot, and hq\'s feed row carries them within seconds (5ec537d)',
    async run(t, ctx) {
      // A stored workspace API key makes a runtime available to a cloud machine
      // (localruntimes.ts workspaceKeyProbe). It is not a real key: this scenario reads what the
      // machine PUBLISHES, never a model answer. Run it on its own workspace (SETUP=api): the
      // starter crew of a shared one would try the fake key.
      const runner = ctx.ws.runner;
      if (!runner) t.skip('the workspace has no runner');
      const rowOf = async () => (await feedRows(H(ctx), 'machines', ctx.ws.id)).find((m) => m.id === runner);
      const settled = async (label) => until(label, async () => { const m = await door.machine(runner); return m.epoch >= 1 && m.drain_state !== 'draining' && !(await door.idleDrain(runner).then(() => true).catch(() => false)) ? m : null; }, { timeout: 180_000, every: 3_000 }).catch(() => door.machine(runner));
      // the signup runner boots once on its own: let it boot and park with NO key, so its row says []
      const first = await settled('the signup boot parked');
      await sleep(10_000);
      const before = await rowOf();
      t.check('after a boot with no key the row says [] (the starting point)', String(before?.runtimes ?? '[]') === '[]', { runtimes: before?.runtimes, epoch: first.epoch });
      const set = await cmd(H(ctx), { type: 'credential.set', workspace: ctx.ws.id, provider: 'gemini', scope: 'workspace', authMode: 'apikey', token: `r6-not-a-real-key-${ctx.tag}` }).then(() => 'ok', (e) => e.message);
      t.check('a workspace Gemini key is stored (provider gemini, the one localruntimes.ts probes)', set === 'ok', set);
      await sleep(20_000); // a wake while the pool still settles from the drain waits for the next sweep
      const woke = await cmd(H(ctx), { type: 'machine.wake', workspace: ctx.ws.id, machineId: runner }).then(() => 'ok', (e) => e.message);
      t.check('machine.wake is accepted', woke === 'ok', woke);
      const booted = await until('the runner booted', async () => { const m = await door.machine(runner); return m.epoch > first.epoch && m.started_at ? m : null; }, { timeout: 300_000, every: 1_000 }).catch(() => null);
      t.check('the runner boots a new epoch', !!booted, booted ? { epoch: booted.epoch, startedAt: booted.started_at } : null);
      if (!booted) return;
      const bootSeen = Date.now();
      const seen = await until('gemini in the feed row', async () => { const r = await rowOf(); return String(r?.runtimes ?? '').includes('gemini') ? r : null; }, { timeout: 60_000, every: 1_000 }).catch(() => null);
      const after = seen ? Math.round((Date.now() - bootSeen) / 1000) : null;
      t.check('the feed row (what hq reads) carries gemini within 20 s of the boot', seen != null && after <= 20, { runtimes: seen?.runtimes ?? (await rowOf())?.runtimes, secondsAfterBootSeen: after });
      // the e2e controller parks a runner a few seconds after its boot: an epoch that short never
      // reached the 30 s beat, so before 5ec537d the row kept [] (c4ed4777, 2026-11-02)
      const parked = await settled('the new epoch parked');
      const lived = parked.started_at && parked.parked_at ? Math.round((Date.parse(parked.parked_at) - Date.parse(parked.started_at)) / 1000) : null;
      t.note({ epoch: parked.epoch, startedAt: parked.started_at, parkedAt: parked.parked_at, livedSeconds: lived });
      await door.idleDrain(runner).catch(() => {});
    },
  },
];
