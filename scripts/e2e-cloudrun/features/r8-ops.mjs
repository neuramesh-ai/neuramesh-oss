// THE r8 OPS DECISIONS, live on the Cloud Run sandbox: the idle window (D2, NM_IDLE_STOP_MIN=15), the
// one-person runner's login vault (D14, machine-vault.ts), and the Always on switch (D2,
// machine-always-on.ts and hq's compute/AlwaysOnRow.tsx). Each scenario acts the way hq, a person or
// a machine acts (the same routes, as the same caller) and reads the state back.
//
// Order: idle-window reads only. solo-vault runs before always-on: it turns the workspace into a team
// (the first invitation), so always-on then has a shared runner and a teammate (person B) who must not
// switch it. solo-vault is opt-in for that reason: in a full run, collab's invite-join owns the invite.
//
// Machine budget: nothing here wakes a machine on purpose. The team reshape mints a runner that is
// born awake. solo-vault waits for its first boot (the vault needs a booted token) and parks it at
// once. Every machine a scenario finds awake is parked before the scenario ends.
import { api, cfg, cmd, door, gw, sleep, snap, until } from './lib.mjs';

const H = (ctx) => ctx.a.userId;
const code = (e) => e?.json?.code ?? (e?.status ? `HTTP ${e.status}` : String(e?.message ?? e).slice(0, 80));
const tryCall = (p) => p.then((r) => ({ ok: true, r }), (e) => ({ ok: false, code: code(e), status: e?.status, error: e?.json?.error }));
const WINDOW = 15; // NM_IDLE_STOP_MIN in infra/cloudrun-e2e/Pulumi.yaml (decision D2)

const usageOf = (ctx) => api('GET', `/v1/machines/usage?workspace=${ctx.ws.id}`, { as: H(ctx) });
const runnerOf = async (ctx) => (await usageOf(ctx)).machines?.find((m) => m.kind === 'runner') ?? null;
const alwaysOn = (as, ws, machineId, on) => api('POST', '/v1/machines/always-on', { as, body: { workspace: ws, machineId, on } });

/** park a machine and wait until it is asleep (desired 0, no drain). A machine that is still booting
 *  answers the drain with NOT_RUNNING only once it is asleep, so the drain is retried */
async function park(id, timeout = 300_000) {
  return until(`machine ${id.slice(0, 8)} parked`, async () => {
    const m = await door.machine(id);
    if (m.desired_replicas === 0 && m.drain_state == null) return m;
    if (m.drain_state == null) await door.idleDrain(id).catch(() => {});
    return null;
  }, { timeout, every: 5_000 });
}

/** close a modal that sits over the shell (not the settings dialog). After the first invitation hq shows
 *  the one-time compute card (compute/ComputeIntro.tsx, "No compute available yet" when the person's
 *  own machine has no provider sign-in): it is product behaviour, and its overlay takes every click
 *  (run 705da9ff). A person closes it, so the scenario does too */
async function closeShellModal(page) {
  for (let i = 0; i < 3; i++) {
    const modal = page.locator('.overlay:not(.workspace-overlay)').first();
    if (!(await modal.isVisible().catch(() => false))) return i > 0;
    const close = modal.getByRole('button', { name: /^close$/i }).first();
    if (!(await close.click({ timeout: 3_000 }).then(() => true).catch(() => false))) await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  }
  return true;
}

/** a booted machine: its token belongs to the current epoch (the vault reads only such a token) */
const booted = (m) => m.epoch >= 1 && m.token_epoch === m.epoch && !!m.token_expires_at;

/** act as the machine: a fresh nmm_ token through the fleet's token-custody door. It replaces the
 *  token hash, so it is used only on a PARKED machine: its next boot mints its own token again */
async function machineToken(id) {
  const out = await api('POST', `/internal/machines/${id}/token`, { fleet: true, body: {} });
  return out.token;
}

/** the vault routes as the machine */
async function vault(method, token, body) {
  const res = await fetch(`${cfg.api}/v1/machines/vault`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** the workspace balance in micros (the fund door with no grant only reads it) */
const balance = async (ctx) => (await door.fund(ctx.ws.id, {})).remainingMicros;
/** how long the live billing check watches the meter, awake then asleep */
const IDLE_S = 120;
const STILL_S = 60;
/** what IDLE_S awake seconds cost at the active price (rates.ts: 1,000 µUSD a minute) */
const IDLE_MICROS = Math.round((IDLE_S / 60) * 1000);

/** wake the Always on runner, wait for its beats, and check that the balance falls while it is idle.
 *  Returns false when the runner did not boot (the checks say so) */
async function alwaysOnBilling(t, ctx, runnerId, parkedEpoch) {
  if (typeof (await door.fund(ctx.ws.id, {})).remainingMicros !== 'number') {
    t.note('the fund door does not report remainingMicros on this server (before r8-004): the live billing check did not run');
    return false;
  }
  await api('POST', '/v1/machines/wake', { as: H(ctx), body: { workspace: ctx.ws.id, machineId: runnerId } });
  const up = await until('the Always on runner booted', async () => { const m = await door.machine(runnerId); return m.epoch > parkedEpoch && booted(m) ? m : null; }, { timeout: 300_000, every: 5_000 }).catch(() => null);
  t.check('the owner wakes the Always on runner (it boots a new epoch)', !!up, up ? { epoch: up.epoch } : await door.machine(runnerId));
  if (!up) return false;
  await sleep(40_000); // past the first beat, so the window runs from a beat
  const b0 = await balance(ctx);
  const m0 = await door.machine(runnerId);
  await sleep(IDLE_S * 1000);
  const b1 = await balance(ctx);
  const m1 = await door.machine(runnerId);
  const drop = b0 - b1;
  const worked = (m1.last_active_at ?? null) !== (m0.last_active_at ?? null);
  t.note({ alwaysOnBilling: { before: b0, after: b1, drop, expectedIdle: IDLE_MICROS, seconds: IDLE_S, workedMeanwhile: worked, lastSeenAt: m1.last_seen_at, billedThrough: m1.billed_through } });
  // the beats land every 30 s, so the window holds 3 or 4 of them: at least half the idle price, and
  // not much more than the full one (a turn of work in between is billed once, inside the same window)
  t.check(`the balance falls while the runner is Always on and idle (about ${IDLE_MICROS} micros in ${IDLE_S} s)`, drop >= IDLE_MICROS / 2 && drop <= IDLE_MICROS * 1.5, { drop, expected: IDLE_MICROS });
  t.check('the runner is still awake and Always on while it is charged', m1.desired_replicas === 1 && (await usageOf(ctx)).machines?.find((m) => m.id === runnerId)?.idleStopMin === null, { desired: m1.desired_replicas });
  return true;
}

export const r8Ops = [
  {
    id: 'idle-window',
    title: 'the idle window is 15 minutes on Cloud Run: GET /v1/machines/usage reports it for the runner (decision D2)',
    async run(t, ctx) {
      const usage = await usageOf(ctx);
      const runner = usage.machines?.find((m) => m.kind === 'runner');
      t.check('the workspace has a runner in /v1/machines/usage', !!runner, usage.machines?.map((m) => ({ kind: m.kind, id: m.id })));
      t.check(`the runner's effective idle window is ${WINDOW} min (NM_IDLE_STOP_MIN)`, runner?.idleStopMin === WINDOW, { idleStopMin: runner?.idleStopMin });
      const others = (usage.machines ?? []).filter((m) => m.kind !== 'runner');
      if (others.length) t.check('every other cloud machine reports the same window', others.every((m) => m.idleStopMin === WINDOW), others.map((m) => ({ kind: m.kind, idleStopMin: m.idleStopMin })));
    },
  },
  {
    id: 'solo-vault',
    optIn: true,
    title: 'D14: the runner of a one-person workspace keeps its logins in the vault, and the shared runner a team gets is refused (VAULT_SHARED_MACHINE)',
    async run(t, ctx) {
      const ws = ctx.ws.id;
      const runner = ctx.ws.runner ?? (await runnerOf(ctx))?.id;
      if (!runner) t.skip('the workspace has no runner');
      const members0 = (await api('GET', '/v1/workspaces', { as: H(ctx) })).workspaces?.find((w) => w.id === ws);
      t.check('the workspace starts with one person', members0?.memberCount === 1, { memberCount: members0?.memberCount, plan: members0?.plan });

      // the vault reads only a booted token that has not expired (15 min after its last renewal). A
      // runner that slept longer than that boots once more first, so its token is fresh
      const m0 = await door.machine(runner);
      if (m0.desired_replicas === 0 && (!m0.token_expires_at || Date.parse(m0.token_expires_at) < Date.now() + 5 * 60_000)) {
        await api('POST', '/v1/machines/wake', { as: H(ctx), body: { workspace: ws, machineId: runner } });
        await until('the runner booted a new epoch', async () => { const m = await door.machine(runner); return m.epoch > m0.epoch && booted(m) ? m : null; }, { timeout: 300_000, every: 5_000 }).catch(() => null);
        t.note('the runner slept past its token: it was woken once for a fresh token');
      }
      const up = await until('the runner booted once', async () => { const m = await door.machine(runner); return booted(m) ? m : null; }, { timeout: 300_000, every: 5_000 }).catch(() => null);
      t.check('the solo runner has booted (its token belongs to its epoch)', !!up, up ? { epoch: up.epoch, tokenEpoch: up.token_epoch } : await door.machine(runner));
      const parked = await park(runner);
      t.note({ parked: { epoch: parked.epoch, parkedAt: parked.parked_at, tokenExpiresAt: parked.token_expires_at } });

      // act as the machine
      const token = await machineToken(runner);
      const person = await tryCall(api('GET', '/v1/machines/vault', { as: H(ctx) }));
      t.check('a person cannot read the vault (MACHINE_ONLY)', !person.ok && person.code === 'MACHINE_ONLY', person);
      const read0 = await vault('GET', token);
      t.check('the solo runner may read its vault (D14, not VAULT_SHARED_MACHINE)', read0.status === 200, read0);
      if (read0.status !== 200) {
        if (read0.json?.code === 'AUTH_FAILED' || read0.json?.code === 'STALE_EPOCH') t.note('the runner\'s token had expired or belongs to an older epoch, so the machine lane could not be driven. The refusal is not D14\'s');
        return;
      }
      const marker = `NMVAULT-${ctx.tag}`; // fake, not a credential
      const hosts = Buffer.from(`github.com:\n    oauth_token: ${marker}\n`).toString('base64');
      const put = await vault('PUT', token, { epoch: parked.epoch, baseGeneration: read0.json.generation, files: [{ path: '.config/gh/hosts.yml', data: hosts }] });
      t.check('the solo runner PUTs a login file', put.status === 200 && put.json?.generation === read0.json.generation + 1, put);
      const read1 = await vault('GET', token);
      const file = read1.json?.files?.find((f) => f.path === '.config/gh/hosts.yml');
      t.check('a GET returns the file, byte for byte', read1.status === 200 && file?.data === hosts, { status: read1.status, generation: read1.json?.generation, paths: read1.json?.files?.map((f) => f.path) });

      // the first invitation turns the workspace into a team: the runner becomes A's member machine
      // (same id) and a fresh shared runner is minted (member-machines.ts ensureTeamShape, cloud plan only)
      const plan = (await api('GET', '/v1/workspaces', { as: H(ctx) })).workspaces?.find((w) => w.id === ws)?.plan;
      if (plan !== 'cloud') {
        await api('POST', `/internal/e2e/workspaces/${ws}/fund`, { fleet: true, body: { plan: 'cloud' } });
        t.note('the workspace moved to the cloud (Team) plan through the fund door, as Stripe\'s webhook would (plan-flip.ts)');
      }
      const invitee = ctx.b?.userId ? { email: ctx.b.email, userId: ctx.b.userId } : await ctx.extraUser('solo-vault');
      const inv = await cmd(H(ctx), { type: 'workspace.invite', workspace: ws, email: invitee.email, memberRole: 'member' });
      t.check('A invites a second person', !!inv?.inviteId, inv);
      const after = (await usageOf(ctx)).machines ?? [];
      const fresh = after.find((m) => m.kind === 'runner');
      const promoted = after.find((m) => m.id === runner);
      t.check('the invitation reshaped the fleet: the old runner is A\'s member machine, a new runner exists', promoted?.kind === 'member' && !!fresh && fresh.id !== runner, after.map((m) => `${m.kind}:${m.id.slice(0, 8)}`));
      if (fresh) { ctx.ws.oldRunner = runner; ctx.ws.runner = fresh.id; }
      if (ctx.b?.userId) {
        const joined = await tryCall(cmd(ctx.b.userId, { type: 'workspace.accept_invite', invite: inv.inviteId }));
        t.check('person B accepts the invitation (a team of two)', joined.ok, joined);
        ctx.r8Team = joined.ok;
      }

      // the promoted machine is still one person's: its vault holds the file (the token is the same machine's)
      const kept = await vault('GET', token);
      t.check('the promoted member machine (same id) still reads the file', kept.status === 200 && kept.json?.files?.some((f) => f.path === '.config/gh/hosts.yml' && f.data === hosts), { status: kept.status, code: kept.json?.code });
      // leave no fake login behind for its next boot
      if (kept.status === 200) {
        const clear = await vault('PUT', token, { epoch: parked.epoch, baseGeneration: kept.json.generation, files: [] });
        t.check('the fake login file is cleared again', clear.status === 200, clear);
      }

      // the new shared runner: born awake, so it boots once. Its token is then the epoch's, and the
      // refusal is the vault's own (VAULT_SHARED_MACHINE), not the token lane's
      if (!fresh) return;
      const freshUp = await until('the new runner booted once', async () => { const m = await door.machine(fresh.id); return booted(m) ? m : null; }, { timeout: 300_000, every: 5_000 }).catch(() => null);
      const freshParked = await park(fresh.id);
      t.note({ newRunner: fresh.id, bootedEpoch: freshUp?.epoch ?? null, parkedEpoch: freshParked.epoch });
      if (!freshUp) { t.check('the new runner booted once, so its token reaches the vault gate', false, await door.machine(fresh.id)); return; }
      const shared = await machineToken(fresh.id);
      const refusedGet = await vault('GET', shared);
      t.check('the shared runner\'s vault GET is refused with VAULT_SHARED_MACHINE (403)', refusedGet.status === 403 && refusedGet.json?.code === 'VAULT_SHARED_MACHINE', refusedGet);
      const refusedPut = await vault('PUT', shared, { epoch: freshParked.epoch, baseGeneration: 0, files: [{ path: '.config/gh/hosts.yml', data: hosts }] });
      t.check('the shared runner\'s vault PUT is refused the same way', refusedPut.status === 403 && refusedPut.json?.code === 'VAULT_SHARED_MACHINE', refusedPut);
    },
  },
  {
    id: 'always-on',
    title: 'the Always on switch in hq Settings › Compute: the owner keeps the runner awake, it wakes nothing, a teammate cannot switch it, and an awake idle Always on runner is billed as active (decision D2)',
    needs: ['browser', 'personB'],
    async run(t, ctx) {
      const page = ctx.a.page;
      const ws = ctx.ws.id;
      const runner = await runnerOf(ctx);
      if (!runner) t.skip('the workspace has no runner');
      t.check(`the runner starts with the ${WINDOW} min window (not Always on)`, runner.idleStopMin === WINDOW, { idleStopMin: runner.idleStopMin });
      // a parked runner, so "the switch wakes nothing" has something to prove
      const parked = await park(runner.id).catch(() => null);
      t.check('the runner is parked before the switch', parked?.desired_replicas === 0, parked ? { desired: parked.desired_replicas, epoch: parked.epoch } : null);
      let on = false;
      try {
        // hq: Settings › Compute, the runner's row
        await page.goto(`${ctx.cfg.hq}/${ctx.ws.slug}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForFunction(() => !!window.__nmDb?.currentStatus?.lastSyncedAt, null, { timeout: 60_000, polling: 500 }).catch(() => {});
        // the one-time compute card can open a moment after the first sync: give it the chance, then close it
        await page.waitForTimeout(3_000);
        if (await closeShellModal(page)) t.note('closed a modal over the shell before opening Settings (the one-time compute card after the invitation)');
        const opener = page.locator('button[aria-label="Workspace settings"]').first();
        if (!(await opener.click({ timeout: 10_000 }).then(() => true).catch(() => false))) await page.keyboard.press('Control+Shift+p');
        const compute = page.locator('button.workspace-settings-item', { hasText: /^Compute$/ }).first();
        if (!(await compute.click({ timeout: 15_000 }).then(() => true).catch(() => false))) {
          // a modal that opened after the settings dialog: close it and try once more
          await closeShellModal(page);
          await compute.click({ timeout: 15_000 });
        }
        const sw = page.locator(`button[role="switch"][aria-label="Always on for ${runner.name}"]`).first();
        const row = page.locator('.aorow', { has: sw }).first();
        const shown = await sw.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true).catch(() => false);
        const before = shown ? await row.innerText().catch(() => '') : '';
        await row.scrollIntoViewIfNeeded().catch(() => {});
        const shotBefore = await snap(page, 'always-on-before');
        t.check('the runner\'s row shows the Always on switch, off, with "Stops after 15 min idle"', shown && /Always on/.test(before) && /Stops after 15 min idle/.test(before) && (await sw.getAttribute('aria-checked')) === 'false', { text: before, screenshot: shotBefore });
        t.check('the row says what it costs', /Keeps the machine awake\. It uses credits while idle\./.test(before), before);
        t.check('the owner may switch it (the switch is enabled)', shown && (await sw.isEnabled()), null);

        // the owner switches it on
        const posted = page.waitForResponse((r) => r.url().includes('/v1/machines/always-on') && r.request().method() === 'POST', { timeout: 30_000 }).catch(() => null);
        await sw.click({ timeout: 10_000 });
        const res = await posted;
        on = !!res && res.ok();
        const flipped = await until('the switch reads on', async () => ((await sw.getAttribute('aria-checked')) === 'true' ? true : null), { timeout: 20_000, every: 500 }).catch(() => false);
        const afterText = await row.innerText().catch(() => '');
        const shotAfter = await snap(page, 'always-on-after');
        t.check('the owner switches Always on from hq (POST /v1/machines/always-on, 200)', on && flipped, { status: res?.status(), screenshot: shotAfter });
        t.check('the row now says the machine stops only when credits run out', /Stops only when credits run out/.test(afterText), afterText);
        const u1 = (await usageOf(ctx)).machines?.find((m) => m.id === runner.id);
        t.check('/v1/machines/usage reports idleStopMin null for the runner', u1?.idleStopMin === null, { idleStopMin: u1?.idleStopMin });

        // it wakes nothing
        await sleep(15_000);
        const still = await door.machine(runner.id);
        t.check('the switch did not wake the parked runner', still.desired_replicas === 0 && (!parked || still.epoch === parked.epoch), { desired: still.desired_replicas, epoch: still.epoch, lastWakeAt: still.last_wake_at });

        // a teammate (person B) may not switch the runner, through the gateway as hq would send it
        const b = ctx.b;
        const byB = await tryCall(gw(b, 'POST', '/v1/machines/always-on', { body: { workspace: ws, machineId: runner.id, on: false } }));
        t.check(`person B (${ctx.r8Team ? 'a member' : 'not a member'}) cannot switch the runner (403 NOT_PERMITTED)`, !byB.ok && byB.status === 403 && byB.code === 'NOT_PERMITTED', byB);
        const u2 = (await usageOf(ctx)).machines?.find((m) => m.id === runner.id);
        t.check('the runner is still Always on after B\'s attempt', u2?.idleStopMin === null, { idleStopMin: u2?.idleStopMin });
        if (ctx.r8Team) {
          const machines = (await usageOf(ctx)).machines ?? [];
          const aMember = machines.find((m) => m.kind === 'member' && m.ownerUserId === H(ctx));
          if (aMember) {
            const theirs = await tryCall(gw(b, 'POST', '/v1/machines/always-on', { body: { workspace: ws, machineId: aMember.id, on: true } }));
            t.check('person B cannot switch A\'s own member machine either', !theirs.ok && theirs.status === 403, theirs);
          }
          const bMember = machines.find((m) => m.kind === 'member' && m.ownerUserId === b.userId);
          if (bMember) {
            const m0 = await door.machine(bMember.id);
            const mine = await tryCall(gw(b, 'POST', '/v1/machines/always-on', { body: { workspace: ws, machineId: bMember.id, on: true } }));
            const m1 = await door.machine(bMember.id);
            const back = await tryCall(gw(b, 'POST', '/v1/machines/always-on', { body: { workspace: ws, machineId: bMember.id, on: false } }));
            t.check('person B may switch their own member machine on and off, and it stays asleep', mine.ok && mine.r?.alwaysOn === true && back.ok && back.r?.alwaysOn === false && m1.desired_replicas === m0.desired_replicas, { on: mine.r ?? mine, off: back.r ?? back, desired: [m0.desired_replicas, m1.desired_replicas] });
          } else t.note('person B has no member machine in this workspace yet, so the owner\'s positive case for B did not run');
        }

        // BILLED AS ACTIVE (George, 2026-11-06, machine-beat.ts): an awake Always on runner pays for its idle
        // seconds. Wake it, let it beat while it does nothing, and watch the balance (in micros, the fund
        // door's answer) fall by about the active price of that time
        const billing = await alwaysOnBilling(t, ctx, runner.id, parked?.epoch ?? 0);

        // back off, from hq, so the sandbox is as it was
        const postedOff = page.waitForResponse((r) => r.url().includes('/v1/machines/always-on') && r.request().method() === 'POST', { timeout: 30_000 }).catch(() => null);
        await sw.click({ timeout: 10_000 });
        const resOff = await postedOff;
        const offFlipped = await until('the switch reads off', async () => ((await sw.getAttribute('aria-checked')) === 'false' ? true : null), { timeout: 20_000, every: 500 }).catch(() => false);
        if (resOff?.ok()) on = false;
        const u3 = (await usageOf(ctx)).machines?.find((m) => m.id === runner.id);
        t.check(`the owner switches it off again, and the window is back to ${WINDOW} min`, !!resOff?.ok() && offFlipped && u3?.idleStopMin === WINDOW, { status: resOff?.status(), idleStopMin: u3?.idleStopMin });
        await snap(page, 'always-on-off-again');
        await page.keyboard.press('Escape').catch(() => {});

        // off and parked: the balance stops falling
        if (billing) {
          const asleep = await park(runner.id).catch(() => null);
          const b0 = await balance(ctx);
          await sleep(STILL_S * 1000);
          const b1 = await balance(ctx);
          t.check(`switched off and parked, the balance does not move in ${STILL_S} s`, !!asleep && b1 === b0, { parked: asleep?.desired_replicas === 0, before: b0, after: b1 });
        }
      } finally {
        // never leave the sandbox's runner Always on
        if (on) await alwaysOn(H(ctx), ws, runner.id, false).then(() => t.note('the runner was switched off through the API at the end')).catch((e) => t.note(`could not switch the runner off: ${code(e)}`));
        const m = await door.machine(runner.id).catch(() => null);
        if (m?.desired_replicas === 1) await park(runner.id).catch(() => {});
      }
    },
  },
];
