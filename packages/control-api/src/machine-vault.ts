// THE LOGIN VAULT ROUTES (architecture §7, decision D1; packages/shared login-vault.ts). A Cloud Run
// machine keeps /nm/home in RAM, so every vendor login a person makes in its box is lost at the next
// stop. machined PUTs the allowlisted login files here while it runs, and GETs them at the next boot,
// before the box starts. Rows hold ciphertext only (vault-crypto.ts).
//
// WHO MAY READ. Only the machine itself, by its nmm_ token (machineFromBearer). The machine id and the
// workspace come from the token, never from the path, the query or the body, so no request can name
// another machine. A person's token is 403 MACHINE_ONLY. The token never reaches the box (it lives in
// the supervisor), so a person at the box shell cannot call this route either.
//
// WHICH MACHINES. A member machine is one person's (the relay lets only its owner attach), so it keeps
// that person's logins. A runner is shared by every member of a team, so it keeps none: it is refused
// with VAULT_SHARED_MACHINE, and any row it still has is deleted. One exception, on by default since
// decision D14 (2026-11-05, NM_VAULT_SOLO_RUNNER=0 turns it off): the runner of a one-person workspace with no member
// machine (Pro with one person, member-machines.ts), which the first invitation turns into that
// person's member machine with the same id. Only a Cloud Run machine has a vault: a volume machine keeps
// its home on disk.
//
// A write is a machine write, so it is fenced by epoch: the instance a resize is replacing cannot
// overwrite the vault the new one restored. The generation is a compare-and-swap head on top.
import {
  isVaultLoginFile, VAULT_CODES, VAULT_FILE_MAX_BYTES, VAULT_LOGIN_FILES, VAULT_TOTAL_MAX_BYTES,
  type VaultFile, type VaultRead,
} from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import { z } from 'zod';
import { sqlOf } from './credits';
import { DomainError } from './errors';
import { assertEpoch, refuse } from './fleet-cloudrun';
import { machineFromBearer } from './fleet-cloudrun-boot';
import type { Store } from './store';
import { openVault, sealVault, vaultConfigOf, type SealedVault, type VaultConfig } from './vault-crypto';

/** a PUT body larger than this is refused before it is parsed (base64 of the caps, plus JSON) */
export const VAULT_BODY_MAX_BYTES = 512 * 1024;

/** what the policy reads about the token's machine */
export interface VaultMachine {
  id: string;
  workspaceId: string;
  kind: string;
  substrate: string;
  /** people in the workspace */
  members: number;
  /** a live member machine exists in the workspace (team shape) */
  team: boolean;
}

export interface VaultRow extends SealedVault { generation: number }

/** the route's storage seam: Postgres in production (sqlVaultRepo), a fake in the unit tests */
export interface VaultRepo {
  machine(id: string): Promise<VaultMachine | null>;
  read(machineId: string): Promise<VaultRow | null>;
  /** compare and swap: writes only when the stored generation is `base` (or no row exists and
   *  `base` is 0) and `epoch` is still the machine's. false = it did not write */
  write(m: { machineId: string; workspaceId: string; epoch: number; base: number }, row: VaultRow): Promise<boolean>;
  /** deletes the machine's row. A shared machine must never hand an old login back */
  forget(machineId: string): Promise<void>;
  /** throws DomainError STALE_EPOCH when `epoch` is not the machine's */
  fence(machineId: string, epoch: number): Promise<void>;
}

export interface VaultRouteDeps {
  repo?: VaultRepo;
  /** test seam; production reads NM_VAULT, NM_VAULT_KEY and NM_VAULT_KMS_KEY once, at registration */
  config?: VaultConfig;
}

/** why this machine has no vault, or null when it has one */
/** The runner of a one-person workspace keeps that person's logins (decision D14, 2026-11-05: on by
 *  default, NM_VAULT_SOLO_RUNNER=0 turns it off). It is that person's machine in all but name, and the
 *  first invitation turns it into their member machine with the same id. A second member gets a machine
 *  of their own, and from then on the runner is shared: refused and its row deleted */
export const soloRunnerVault = (env: NodeJS.ProcessEnv = process.env): boolean => env['NM_VAULT_SOLO_RUNNER'] !== '0';

export function vaultRefusal(m: VaultMachine, o: { soloRunner?: boolean } = {}): { code: string; error: string; status: 403 } | null {
  if (m.substrate !== 'cloudrun') return { code: VAULT_CODES.substrate, error: 'Only a Cloud Run machine keeps its logins in the vault. This one keeps them on its disk.', status: 403 };
  if (m.kind === 'member') return null;
  if ((o.soloRunner ?? soloRunnerVault()) && m.kind === 'runner' && m.members === 1 && !m.team) return null;
  return { code: VAULT_CODES.shared, error: 'This machine is shared by the workspace, so it keeps no login. Sign in on your own machine.', status: 403 };
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const PutSchema = z.object({
  epoch: z.number().int().min(0),
  baseGeneration: z.number().int().min(0),
  files: z.array(z.object({ path: z.string().max(200), data: z.string().max(Math.ceil(VAULT_FILE_MAX_BYTES / 3) * 4 + 4) })).max(VAULT_LOGIN_FILES.length),
});

/** the files a PUT names, checked: the allowlist, once each, under the caps. Returns the refusal or the files */
export function checkVaultFiles(files: ReadonlyArray<{ path: string; data: string }>): { files: VaultFile[] } | { status: 400 | 413; code: string; error: string } {
  const seen = new Set<string>();
  let total = 0;
  const out: VaultFile[] = [];
  for (const f of files) {
    if (!isVaultLoginFile(f.path)) return { status: 400, code: 'VAULT_PATH', error: `Only these login files are kept: ${VAULT_LOGIN_FILES.join(', ')}.` };
    if (seen.has(f.path)) return { status: 400, code: 'INVALID_INPUT', error: `${f.path} is named twice.` };
    seen.add(f.path);
    if (!B64.test(f.data) || f.data.length % 4 !== 0) return { status: 400, code: 'INVALID_INPUT', error: `${f.path} is not base64.` };
    const bytes = Buffer.from(f.data, 'base64').length;
    if (bytes > VAULT_FILE_MAX_BYTES) return { status: 413, code: 'VAULT_TOO_LARGE', error: `${f.path} is larger than ${VAULT_FILE_MAX_BYTES} bytes.` };
    total += bytes;
    out.push({ path: f.path, data: f.data });
  }
  if (total > VAULT_TOTAL_MAX_BYTES) return { status: 413, code: 'VAULT_TOO_LARGE', error: `The login files together are larger than ${VAULT_TOTAL_MAX_BYTES} bytes.` };
  return { files: out };
}

const plainOf = (files: VaultFile[]): Buffer => Buffer.from(JSON.stringify({ v: 1, files }));

function filesOf(plain: Buffer): VaultFile[] {
  const parsed = JSON.parse(plain.toString('utf8')) as { files?: Array<{ path?: unknown; data?: unknown }> };
  // a file this server no longer allows is never handed back, even when an older server stored it
  return (parsed.files ?? []).flatMap((f) => (typeof f.path === 'string' && isVaultLoginFile(f.path) && typeof f.data === 'string' ? [{ path: f.path, data: f.data }] : []));
}

/** registered ABOVE the /v1 gate (app.ts), like the snapshot route: the bearer check is this route's
 *  own, and a replaced Cloud Run token must earn 409 STALE_EPOCH, not the gate's 401 */
export function machineVaultRoutes<E extends Env>(app: Hono<E>, store: Store, deps: VaultRouteDeps = {}): void {
  const config = deps.config ?? vaultConfigOf();
  if (config.enabled) console.log(`[vault] login vault on, key ${config.writer?.ref ?? 'MISSING (every call answers 503)'}`);
  const repoOf = (): VaultRepo | null => {
    if (deps.repo) return deps.repo;
    const sql = sqlOf(store);
    return sql ? sqlVaultRepo(sql) : null;
  };

  /** the gate both routes share: on, a machine token, a repo, a key, and a machine that keeps logins */
  const admit = async (authorization: string | undefined): Promise<{ repo: VaultRepo; machine: VaultMachine } | { status: 401 | 403 | 404 | 409 | 501 | 503; code: string; error: string }> => {
    if (!config.enabled) return { status: 404, code: VAULT_CODES.off, error: 'The login vault is not switched on for this server.' };
    const who = await machineFromBearer(store, authorization);
    if ('error' in who) return { status: who.status, code: who.code, error: who.error };
    const repo = repoOf();
    if (!repo) return { status: 501, code: 'NOT_CONFIGURED', error: 'fleet not served by this store' };
    if (!config.writer) return { status: 503, code: 'VAULT_UNAVAILABLE', error: 'The login vault has no key on this server.' };
    const machine = await repo.machine(who.id);
    if (!machine) return { status: 401, code: 'AUTH_FAILED', error: 'unknown machine token' };
    const refusal = vaultRefusal(machine);
    if (refusal) {
      // a runner that became shared may still hold a row from its one-person days: it goes now
      if (refusal.code === VAULT_CODES.shared) await repo.forget(machine.id);
      return refusal;
    }
    return { repo, machine };
  };

  app.get('/v1/machines/vault', async (c) => {
    const gate = await admit(c.req.header('authorization'));
    if ('status' in gate) return c.json({ error: gate.error, code: gate.code }, gate.status);
    const { repo, machine } = gate;
    c.header('cache-control', 'no-store');
    const row = await repo.read(machine.id);
    if (!row) {
      console.log(`vault_read machine=${machine.id} gen=0 files=0`);
      return c.json({ generation: 0, files: [] } satisfies VaultRead);
    }
    let files: VaultFile[];
    try {
      files = filesOf(await openVault(config.readers, row, machine.workspaceId, machine.id, row.generation));
    } catch (e) {
      // never the contents, and never a reason a tamperer could steer by: the row and the cause
      console.error(`vault_unreadable machine=${machine.id} gen=${row.generation} key=${row.keyRef}: ${e instanceof Error ? e.message : e}`);
      return c.json({ error: 'The stored logins cannot be read on this server.', code: 'VAULT_UNREADABLE', generation: row.generation }, 500);
    }
    console.log(`vault_read machine=${machine.id} gen=${row.generation} files=${files.length}`);
    return c.json({ generation: row.generation, files } satisfies VaultRead);
  });

  app.put('/v1/machines/vault', async (c) => {
    if (Number(c.req.header('content-length') ?? 0) > VAULT_BODY_MAX_BYTES) return c.json({ error: 'The login files are too large.', code: 'VAULT_TOO_LARGE' }, 413);
    const gate = await admit(c.req.header('authorization'));
    if ('status' in gate) return c.json({ error: gate.error, code: gate.code }, gate.status);
    const { repo, machine } = gate;
    const raw = await c.req.text();
    if (Buffer.byteLength(raw) > VAULT_BODY_MAX_BYTES) return c.json({ error: 'The login files are too large.', code: 'VAULT_TOO_LARGE' }, 413);
    let body: unknown = null;
    try { body = JSON.parse(raw); } catch { /* refused below */ }
    const parsed = PutSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Supply your epoch, the generation you read, and the login files.', code: 'INVALID_INPUT' }, 400);
    const checked = checkVaultFiles(parsed.data.files);
    if ('code' in checked) return c.json({ error: checked.error, code: checked.code }, checked.status);
    const { epoch, baseGeneration } = parsed.data;
    try {
      await repo.fence(machine.id, epoch);
      const generation = baseGeneration + 1;
      const sealed = await sealVault(config.writer!, plainOf(checked.files), machine.workspaceId, machine.id, generation);
      const wrote = await repo.write({ machineId: machine.id, workspaceId: machine.workspaceId, epoch, base: baseGeneration }, { ...sealed, generation });
      if (!wrote) {
        // the epoch may have moved between the fence and the write: that is the fence's answer
        await repo.fence(machine.id, epoch);
        const current = (await repo.read(machine.id))?.generation ?? 0;
        return c.json({ error: 'The vault changed since this machine read it.', code: VAULT_CODES.conflict, generation: current }, 409);
      }
      console.log(`vault_write machine=${machine.id} epoch=${epoch} gen=${generation} files=${checked.files.map((f) => f.path).join(',') || 'none'}`);
      return c.json({ generation });
    } catch (e) {
      return refuse(c, e);
    }
  });
}

interface DbVaultRow { generation: string; key_ref: string; wrapped_key: Buffer; iv: Buffer; tag: Buffer; ciphertext: Buffer }

/** the vault on Postgres (0160) */
export function sqlVaultRepo(sql: postgres.Sql): VaultRepo {
  return {
    async machine(id) {
      const [row] = await sql<{ id: string; workspace_id: string; kind: string; substrate: string; members: number; team: boolean }[]>`
        select m.id, m.workspace_id, m.kind, m.substrate,
               (select count(*)::int from workspace_members wm where wm.workspace_id = m.workspace_id) as members,
               exists (select 1 from machines o
                        where o.workspace_id = m.workspace_id and o.kind = 'member'
                          and (o.lifecycle is null or o.lifecycle <> 'destroyed')) as team
          from machines m
         where m.id = ${id}::uuid and (m.lifecycle is null or m.lifecycle <> 'destroyed')`;
      return row ? { id: row.id, workspaceId: row.workspace_id, kind: row.kind, substrate: row.substrate, members: row.members, team: row.team } : null;
    },
    async read(machineId) {
      const [row] = await sql<DbVaultRow[]>`
        select generation, key_ref, wrapped_key, iv, tag, ciphertext from machine_vault where machine_id = ${machineId}::uuid`;
      return row ? { generation: Number(row.generation), keyRef: row.key_ref, wrappedKey: row.wrapped_key, iv: row.iv, tag: row.tag, ciphertext: row.ciphertext } : null;
    },
    async write(m, row) {
      // the fence rides the write: a boot that moved the epoch after the route's check still wins.
      // base 0 means "no row yet" and nothing else: a writer that read a row which has since been
      // forgotten must re-read, not resurrect a vault under a generation nobody holds
      const done = await sql<{ generation: string }[]>`
        insert into machine_vault (machine_id, workspace_id, generation, epoch, key_ref, wrapped_key, iv, tag, ciphertext)
        select ${m.machineId}::uuid, ${m.workspaceId}::uuid, ${row.generation}, ${m.epoch}, ${row.keyRef}, ${row.wrappedKey}, ${row.iv}, ${row.tag}, ${row.ciphertext}
          from machines where id = ${m.machineId}::uuid and epoch = ${m.epoch}
           and (${m.base}::bigint = 0) = not exists (select 1 from machine_vault v where v.machine_id = ${m.machineId}::uuid)
        on conflict (machine_id) do update
           set generation = excluded.generation, epoch = excluded.epoch, key_ref = excluded.key_ref,
               wrapped_key = excluded.wrapped_key, iv = excluded.iv, tag = excluded.tag,
               ciphertext = excluded.ciphertext, updated_at = now()
         where machine_vault.generation = ${m.base}
        returning generation`;
      return done.length > 0;
    },
    async forget(machineId) {
      await sql`delete from machine_vault where machine_id = ${machineId}::uuid`;
    },
    async fence(machineId, epoch) {
      await assertEpoch(sql, machineId, epoch);
    },
  };
}

/** the fence's error, for a fake repo in tests */
export const staleEpoch = (epoch: number): DomainError => new DomainError('STALE_EPOCH', `epoch ${epoch} is not current: a newer instance owns this machine`);
