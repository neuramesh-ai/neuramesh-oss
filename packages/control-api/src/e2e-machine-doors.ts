// THE BOOT GUARDS' E2E DOORS (scripts/e2e-cloudrun/boot-guards.mjs): the crash-loop breaker and the
// parked-boot refusal (fleet-cloudrun-breaker.ts) need a machine that fails to boot, and a way to read
// the breaker's columns. Inert unless NM_E2E_ROUTES=1 and the fleet secret, exactly as e2e-routes.ts.
//
//   POST /internal/e2e/machines/:id/boot-throw {on}  the machine's next boots throw after the grant
//   GET  /internal/e2e/machines/:id/breaker          the breaker's columns, the epoch, the park
//
// The throw rides the boot grant (`e2e: {bootThrow: true}`), never the pool env: an env change is a
// new revision that nm-fleet rewrites, and it would roll every machine. machined honours it only with
// its own NM_E2E_MARKER=1 (the sandbox pool env), so neither side alone can make a machine throw. The
// switch is one machine_facts row (0156), so it holds across nm-api instances with no new column.
import { bearerIs, e2eSecret } from './bearer-auth';
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import { z } from 'zod';
import { sqlOf } from './credits';
import { e2eRoutesOn } from './e2e-routes';
import type { Store } from './store';

export { e2eRoutesOn };

const BOOT_THROW_KIND = 'e2e-boot-throw';
const uuid = (raw: string): string | null => (z.string().uuid().safeParse(raw).success ? raw : null);

/** is the boot-throw switch on for this machine? Read by the boot route only with NM_E2E_ROUTES=1 */
export async function e2eBootThrow(sql: postgres.Sql, machineId: string): Promise<boolean> {
  const [row] = await sql<{ on: boolean }[]>`
    select true as on from machine_facts f join machines m on m.workspace_id = f.workspace_id
     where m.id = ${machineId}::uuid and f.kind = ${BOOT_THROW_KIND} and f.subject_key = ${machineId}`;
  return Boolean(row);
}

export function e2eMachineDoors<E extends Env>(app: Hono<E>, store: Store): void {
  // constant time, and its own secret when the deploy sets NM_E2E_SECRET (bearer-auth.ts, R10 NM-107)
  const ok = (auth: string | undefined): boolean => e2eRoutesOn() && bearerIs(auth, e2eSecret());

  app.post('/internal/e2e/machines/:id/boot-throw', async (c) => {
    if (!ok(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    const id = uuid(c.req.param('id'));
    const body = z.object({ on: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!sql) return c.json({ error: 'needs postgres' }, 501);
    if (!id || !body.success) return c.json({ error: 'name the machine and {on: true|false}', code: 'INVALID_INPUT' }, 400);
    const [m] = await sql<{ workspace_id: string }[]>`select workspace_id from machines where id = ${id}::uuid and substrate = 'cloudrun'`;
    if (!m) return c.json({ error: 'no cloudrun machine with that id' }, 404);
    if (body.data.on) {
      await sql`insert into machine_facts (workspace_id, kind, subject_key, payload) values (${m.workspace_id}::uuid, ${BOOT_THROW_KIND}, ${id}, '{}'::jsonb)
                on conflict (workspace_id, kind, subject_key) do nothing`;
    } else {
      await sql`delete from machine_facts where workspace_id = ${m.workspace_id}::uuid and kind = ${BOOT_THROW_KIND} and subject_key = ${id}`;
    }
    console.log(`e2e_boot_throw machine=${id} on=${body.data.on}`);
    return c.json({ machineId: id, bootThrow: body.data.on });
  });

  app.get('/internal/e2e/machines/:id/breaker', async (c) => {
    if (!ok(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    const id = uuid(c.req.param('id'));
    if (!sql) return c.json({ error: 'needs postgres' }, 501);
    if (!id) return c.json({ error: 'invalid machine id' }, 400);
    const [row] = await sql<Record<string, unknown>[]>`
      select m.id, m.desired_replicas, m.epoch::int as epoch, m.boot_streak, m.boot_streak_since, m.boot_loop_at,
             m.parked_at, m.last_seen_at, m.last_wake_at, m.drain_state, m.snapshot_work, m.snapshot_box,
             m.snapshot_gc_work, m.snapshot_gc_at
        from machines m where m.id = ${id}::uuid and m.substrate = 'cloudrun'`;
    return row ? c.json(row) : c.json({ error: 'no cloudrun machine with that id' }, 404);
  });
}
