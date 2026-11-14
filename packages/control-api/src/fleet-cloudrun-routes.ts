// The Cloud Run machine lane's routes (fleet-cloudrun*.ts hold the rules). Registered from
// fleetRoutes, i.e. ABOVE the /v1 gate, the claimRoutes idiom: the boot's credential is the pool's
// boot credential, the operator's routes take the fleet secret, and the machine routes prove the
// machine bearer themselves (fleet-cloudrun-boot.ts machineFromBearer, which knows the epoch).
import type { Env, Hono } from 'hono';
import { z } from 'zod';
import { sqlOf } from './credits';
import { StatusSchema, applyMachineStatus, machineControl, refuse } from './fleet-cloudrun';
import { bootMachine, machineFromBearer, mintBootCredential, renewMachineToken } from './fleet-cloudrun-boot';
import { postBootLoopNotice } from './fleet-cloudrun-breaker';
import { requestRoll } from './fleet-cloudrun-sweep';
import { e2eBootThrow, e2eRoutesOn } from './e2e-machine-doors';
import type { Store } from './store';

const CREDENTIAL = /^Bearer\s+(nmb_[a-f0-9]{64})$/i;
const RenewSchema = z.object({ epoch: z.number().int().min(1) });

export function cloudRunRoutes<E extends Env>(app: Hono<E>, store: Store): void {
  const fleetSecretOk = (auth: string | undefined): boolean => {
    const secret = process.env['FLEET_SECRET'];
    return Boolean(secret) && auth === `Bearer ${secret}`;
  };
  const machineId = (raw: string): string | null => (z.string().uuid().safeParse(raw).success ? raw : null);

  // nm-fleet: the pool env's credential, minted when it creates the pool or finds one without it
  app.post('/internal/machines/:id/boot-credential', async (c) => {
    if (!fleetSecretOk(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'fleet not served by this store' }, 501);
    const id = machineId(c.req.param('id'));
    if (!id) return c.json({ error: 'invalid machine id' }, 400);
    const out = await mintBootCredential(sql, id);
    if (!out) return c.json({ error: 'no live cloudrun machine with that id' }, 404);
    console.log(`machine_boot_credential machine=${id}`);
    return c.json(out, 201);
  });

  // nm-fleet: a running pool's image is behind, so drain it and roll at the same class (rule M12)
  app.post('/internal/machines/:id/roll', async (c) => {
    if (!fleetSecretOk(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'fleet not served by this store' }, 501);
    const id = machineId(c.req.param('id'));
    if (!id) return c.json({ error: 'invalid machine id' }, 400);
    return c.json({ requested: await requestRoll(sql, id) });
  });

  // machined: `authorization: Bearer <NM_BOOT_CREDENTIAL>`, body {}, at every start (a crash restart
  // included), for its identity, a new epoch and a token bound to it. 401 = machined stops (BootRefused).
  // 409 PARKED (a ghost: the machine is asleep) and 409 BOOT_LOOP (the breaker is open) move nothing,
  // and machined waits for SIGTERM on both (fleet-cloudrun-breaker.ts)
  app.post('/v1/machines/boot', async (c) => {
    const credential = CREDENTIAL.exec(c.req.header('authorization') ?? '')?.[1];
    if (!credential) return c.json({ error: 'a boot needs the machine\'s boot credential as its bearer', code: 'BOOT_CREDENTIAL' }, 401);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'fleet not served by this store' }, 501);
    const body = await c.req.json().catch(() => ({})) as { readinessProtocol?: unknown; snapshotFormats?: unknown };
    const object = body !== null && typeof body === 'object';
    const identity = await bootMachine(sql, credential, object && body.readinessProtocol === 1,
      object && Array.isArray(body.snapshotFormats) && body.snapshotFormats.includes('nm-lazy-work-v1'));
    if (!identity) return c.json({ error: 'this boot credential is unknown or was rotated', code: 'BOOT_CREDENTIAL' }, 401);
    if ('refused' in identity) {
      if (identity.tripped) {
        console.log(`machine_boot_loop machine=${identity.machineId} boots=${identity.tripped.boots} windowMin=${identity.tripped.windowMin}: the breaker tripped, desired_replicas=0`);
        await postBootLoopNotice(store, sql, { id: identity.machineId, workspaceId: identity.workspaceId }, identity.tripped.boots, identity.tripped.windowMin);
      } else {
        console.log(`machine_boot_refused machine=${identity.machineId} code=${identity.refused}`);
      }
      const error = identity.refused === 'SNAPSHOT_READER_REQUIRED'
        ? 'this image cannot read the saved workspace format: deploy a compatible lazy-restore reader. Saved work is unchanged'
        : identity.refused === 'PARKED'
        ? 'this machine is asleep (desired_replicas 0): wait for SIGTERM, or for a wake'
        : 'this machine failed to start too many times in a row: wait for SIGTERM. A person\'s wake or message allows one more boot';
      return c.json({ error, code: identity.refused }, 409);
    }
    console.log(`machine_booted machine=${identity.machineId} epoch=${identity.epoch}`);
    // the e2e boot-loop probe (e2e-routes.ts, sandbox only): machined throws after this grant when its
    // own env has NM_E2E_MARKER=1, the same as a boot that crashes before it reports running
    const e2e = e2eRoutesOn() && (await e2eBootThrow(sql, identity.machineId));
    return c.json(e2e ? { ...identity, e2e: { bootThrow: true } } : identity);
  });

  // machined: `{epoch}` with the current token, while that epoch is current → {token, expiresAt}.
  // 409 once a newer boot owns the machine (machined fences)
  app.post('/v1/machines/token', async (c) => {
    const machine = await machineFromBearer(store, c.req.header('authorization'));
    if ('error' in machine) return c.json({ error: machine.error, code: machine.code }, machine.status);
    const body = RenewSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'name the epoch the token was issued for', code: 'INVALID_INPUT' }, 400);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'fleet not served by this store', code: 'NOT_CONFIGURED' }, 501);
    try {
      const token = /^Bearer\s+(nmm_\S+)$/i.exec(c.req.header('authorization') ?? '')![1]!;
      return c.json({ token, ...(await renewMachineToken(sql, machine.id, body.data.epoch)) });
    } catch (e) {
      return refuse(c, e);
    }
  });

  // the heartbeat additions, fenced; the answer carries the control as well
  app.post('/v1/machines/status', async (c) => {
    const machine = await machineFromBearer(store, c.req.header('authorization'));
    if ('error' in machine) return c.json({ error: machine.error, code: machine.code }, machine.status);
    const body = StatusSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid status', code: 'INVALID_INPUT', issues: body.error.issues }, 400);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'fleet not served by this store', code: 'NOT_CONFIGURED' }, 501);
    try {
      return c.json(await applyMachineStatus(sql, machine.id, body.data));
    } catch (e) {
      return refuse(c, e);
    }
  });

  // what the machine should do now, FLAT ({epoch, action, snapshot}: machined reads it as Control).
  // A replaced instance may still read it: the newer epoch in the answer is what fences it
  app.get('/v1/machines/control', async (c) => {
    const machine = await machineFromBearer(store, c.req.header('authorization'), { allowStale: true });
    if ('error' in machine) return c.json({ error: machine.error, code: machine.code }, machine.status);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'fleet not served by this store', code: 'NOT_CONFIGURED' }, 501);
    const control = await machineControl(sql, machine.id);
    if (!control) return c.json({ error: 'no such machine', code: 'NOT_FOUND' }, 404);
    return c.json(control);
  });
}
