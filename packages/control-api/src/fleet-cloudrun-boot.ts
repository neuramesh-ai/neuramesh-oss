// The Cloud Run machine's identity (D12, packages/fleet/CLOUDRUN.md). The pool template carries ONE
// long-lived credential per machine (NM_BOOT_CREDENTIAL), good for POST /v1/machines/boot and nothing
// else. Each boot is a new incarnation: the epoch moves by one in the database, and the answer is that
// epoch and a machine token bound to it, short-lived and renewable while the epoch is current. So a
// wake needs no new revision, and a crash restart in the same revision just boots again; the instance
// before it, if any still runs, is fenced by the same move. Only the hashes land on the row.
import { createHash, randomBytes } from 'node:crypto';
import type postgres from 'postgres';
import { DomainError } from './errors';
import { asSize, guardPct, readRow, toControl, type Control, type SizeClass } from './fleet-cloudrun';
import { bootLoopMax, bootLoopWindowMin, bootVerdict } from './fleet-cloudrun-breaker';
import type { MachineIdentityRow } from './fleet';
import { hashMachineToken, mintMachineToken } from './machine-auth';
import type { Store } from './store';
import { sqlOf } from './credits';

/** a boot token lives this long; machined renews it while its epoch is current */
export const TOKEN_TTL_SECONDS = 15 * 60;
const sha = (v: string): string => createHash('sha256').update(v).digest('hex');
const LIVE_CLOUDRUN = (sql: postgres.Sql) => sql`substrate = 'cloudrun' and kind <> 'local' and (lifecycle is null or lifecycle <> 'destroyed')`;

/** nm-fleet's mint, when it creates a pool or finds one without a credential. Rotates: the credential
 *  a pool env held before stops working, so the operator mints only when it writes the env at once */
export async function mintBootCredential(sql: postgres.Sql, machineId: string): Promise<{ credential: string } | null> {
  const credential = `nmb_${randomBytes(32).toString('hex')}`;
  const [row] = await sql<{ id: string }[]>`
    update machines set boot_credential_hash = ${sha(credential)}
     where id = ${machineId}::uuid and ${LIVE_CLOUDRUN(sql)}
     returning id`;
  return row ? { credential } : null;
}

export interface BootIdentity {
  machineId: string; workspaceId: string; kind: string; ownerUserId: string;
  epoch: number; token: string; expiresAt: string;
  sizeClass: SizeClass; guardPct: number;
  snapshot: Control['snapshot']; control: Control;
}

/** a refused boot (fleet-cloudrun-breaker.ts): no epoch moved. `tripped` names the machine whose
 *  breaker opened on THIS boot, so the route posts the one notice */
export interface BootRefusal {
  refused: 'PARKED' | 'BOOT_LOOP' | 'SNAPSHOT_READER_REQUIRED';
  machineId: string; workspaceId: string;
  tripped: { boots: number; windowMin: number } | null;
}

interface BootRow { id: string; workspace_id: string; desired_replicas: number; boot_loop_at: Date | null; boot_streak: number; boot_streak_since: Date | null; snapshot_work: string | null; now: Date }

/** credential in, a new epoch and a token bound to it out. The token before it moves to
 *  prev_token_hash, where it only ever earns 409 STALE_EPOCH. A drain the old incarnation was asked
 *  for to grow, or began on its own, ends with it (fresh memory); a stop, a roll or a resize in
 *  flight is the machine's, not the instance's, and carries on. A parked machine (a ghost) or one
 *  whose breaker is open is refused before anything moves (fleet-cloudrun-breaker.ts) */
export async function bootMachine(sql: postgres.Sql, credential: string, explicitReadiness = false, supportsLazyRestore = false): Promise<BootIdentity | BootRefusal | null> {
  const { token, hash } = mintMachineToken();
  const transient = () => sql`drain_reason in ('grow', 'oom', 'crash') and drain_state in ('requested', 'draining')`;
  const cfg = { max: bootLoopMax(), windowMin: bootLoopWindowMin() };
  type Booted = { id: string; workspace_id: string; kind: string; owner_user_id: string; epoch: string; token_expires_at: Date };
  const out = await (sql.begin(async (_tx) => {
    const tx = _tx as unknown as postgres.Sql;
    // FOR UPDATE: two instances booting at once (a resize overlap) count as two boots, in order
    const [cur] = await tx<BootRow[]>`
      select id, workspace_id, desired_replicas, boot_loop_at, boot_streak, boot_streak_since, snapshot_work, now() as now from machines
       where boot_credential_hash = ${sha(credential)} and ${LIVE_CLOUDRUN(tx)}
       for update`;
    if (!cur) return null;
    const verdict = bootVerdict({ desiredReplicas: cur.desired_replicas, bootLoopAt: cur.boot_loop_at, streak: cur.boot_streak, streakSince: cur.boot_streak_since }, new Date(cur.now).getTime(), cfg);
    const refusal = (refused: BootRefusal['refused'], tripped: BootRefusal['tripped']): BootRefusal => ({ refused, machineId: cur.id, workspaceId: cur.workspace_id, tripped });
    if (verdict.kind === 'parked') return refusal('PARKED', null);
    // An older image must never fall back to an old full archive and overwrite newer saved work.
    if (cur.snapshot_work?.startsWith('manifest-e') && !supportsLazyRestore) return refusal('SNAPSHOT_READER_REQUIRED', null);
    if (verdict.kind === 'loop') {
      // parked_at = now: the sweep's `rewoken` pass reads a message after parked_at as a wake, and the
      // message that started the loop is older than the trip. The stamp also keeps that pass off
      await tx`
        update machines
           set desired_replicas = 0, started_at = null,
               boot_loop_at = coalesce(boot_loop_at, now()),
               parked_at = case when ${verdict.trip} then now() else parked_at end
         where id = ${cur.id}::uuid`;
      return refusal('BOOT_LOOP', verdict.trip ? { boots: cur.boot_streak, windowMin: cfg.windowMin } : null);
    }
    const [row] = await tx<Booted[]>`
      update machines
         set epoch = epoch + 1, token_epoch = epoch + 1,
             prev_token_hash = token_hash, token_hash = ${hash},
             token_expires_at = now() + make_interval(secs => ${TOKEN_TTL_SECONDS}::int),
             interactive_ready = case when ${explicitReadiness} then false else null end,
             drain_state = case when ${transient()} then null else drain_state end,
             drain_reason = case when ${transient()} then null else drain_reason end,
             boot_streak = ${verdict.streak}::int,
             boot_streak_since = case when ${verdict.fresh} then now() else boot_streak_since end
       where id = ${cur.id}::uuid
       returning id, workspace_id, kind, owner_user_id, epoch, token_expires_at`;
    return row ?? null;
  }) as Promise<Booted | BootRefusal | null>);
  if (!out) return null;
  if ('refused' in out) return out;
  const row = out;
  const full = await readRow(sql, row.id);
  if (!full) return null;
  const control = toControl(full);
  return {
    machineId: row.id, workspaceId: row.workspace_id, kind: row.kind, ownerUserId: row.owner_user_id,
    epoch: Number(row.epoch), token, expiresAt: new Date(row.token_expires_at).toISOString(),
    sizeClass: asSize(full.size_class), guardPct: guardPct(), snapshot: control.snapshot, control,
  };
}

interface TokenRow extends MachineIdentityRow { substrate: string; epoch: string; token_epoch: string | null; current: boolean; expired: boolean }

/** the machine behind an nmm_ bearer, with the epoch verdict a Cloud Run machine needs: a token from
 *  an older epoch is 409 STALE_EPOCH (machined fences on it), an expired one 401. The general lanes
 *  (fleet.ts machineByTokenHash) refuse both as 401; only this lane tells the two apart. `allowStale`
 *  is for the control read alone: it writes nothing, and its answer (a newer epoch) is itself the fence */
export async function machineFromBearer(store: Store, authorization: string | undefined, opts: { allowStale?: boolean } = {}): Promise<MachineIdentityRow | { error: string; code: string; status: 401 | 403 | 409 | 501 }> {
  const bearer = /^Bearer\s+(nmm_\S+)$/i.exec(authorization ?? '')?.[1];
  if (!bearer) return { error: 'this route is for a machine, never a person', code: 'MACHINE_ONLY', status: 403 };
  const hash = hashMachineToken(bearer);
  const sql = sqlOf(store);
  if (!sql) {
    // a store without postgres (unit tests): the store's own identity lookup, no epoch to check
    if (!store.machineByTokenHash) return { error: 'fleet not served by this store', code: 'NOT_CONFIGURED', status: 501 };
    return (await store.machineByTokenHash(hash)) ?? { error: 'unknown machine token', code: 'AUTH_FAILED', status: 401 };
  }
  const [row] = await sql<TokenRow[]>`
    select m.id, m.workspace_id, m.owner_user_id, m.kind, u.clerk_user_id as owner_clerk_id, m.substrate, m.epoch, m.token_epoch,
           (m.token_hash = ${hash}) as current,
           (m.token_expires_at is not null and m.token_expires_at <= now()) as expired
      from machines m left join nm_users u on u.id = m.owner_user_id
     where (m.token_hash = ${hash} or (m.prev_token_hash = ${hash} and m.substrate = 'cloudrun'))
       and m.kind <> 'local' and (m.lifecycle is null or m.lifecycle <> 'destroyed')
     limit 1`;
  if (!row) return { error: 'unknown machine token', code: 'AUTH_FAILED', status: 401 };
  if (row.substrate === 'cloudrun') {
    // a replaced token, or one from an older epoch: the newest boot owns the machine
    const stale = !row.current || Number(row.token_epoch ?? -1) < Number(row.epoch);
    if (row.current && row.expired) return { error: 'the machine token expired; boot again', code: 'AUTH_FAILED', status: 401 };
    if (stale && !opts.allowStale) return { error: 'a newer instance owns this machine', code: 'STALE_EPOCH', status: 409 };
  }
  return { id: row.id, workspace_id: row.workspace_id, owner_user_id: row.owner_user_id, kind: row.kind, owner_clerk_id: row.owner_clerk_id };
}

/** extends the token while the epoch it names is current. The SAME token comes back: a rotated one
 *  would turn a request still in flight with the old token into a 409, and machined would fence
 *  itself. machineFromBearer already refused a replaced or expired token. */
export async function renewMachineToken(sql: postgres.Sql, machineId: string, epoch: number): Promise<{ expiresAt: string }> {
  const [row] = await sql<{ token_expires_at: Date }[]>`
    update machines set token_expires_at = now() + make_interval(secs => ${TOKEN_TTL_SECONDS}::int)
     where id = ${machineId}::uuid and substrate = 'cloudrun' and token_epoch = epoch and epoch = ${epoch}
     returning token_expires_at`;
  if (!row) throw new DomainError('STALE_EPOCH', `epoch ${epoch} is not current: a newer instance owns this machine`);
  return { expiresAt: new Date(row.token_expires_at).toISOString() };
}
