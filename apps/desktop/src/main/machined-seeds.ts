// the runner's marketing seed (plume for browser workspaces, 2026-10-04). a Mac seeds its marketing
// rooms at each connection boot (sync/seeds.ts): the marketing packs, the setup backfill and plume.
// a browser workspace may have no Mac, so its cloud runner does the same work: one pass at boot once
// this process syncs, one pass SEED_DELAY_MS after the replica changes a fact the planner reads
// (planMarketingRoomSeeds, seed.ts), and one more after a backoff while a command stays open. a
// workspace has one live runner (plan-flip.ts) and browsers send nothing, so there is one writer.
// machined cannot load sync/seeds.ts, which imports electron.
//
// it speaks as the OWNER: the machine bearer plus a human actor header, which the server accepts
// only for the machine's own owner (machine-auth.ts). only machined.ts imports this module, so the
// Mac app's main process never runs it.
import type { Actor, AgentRole } from '@neuramesh/shared';
import type { MachinedConfig } from './machined-config';
import { backoffDelayMs, isRetryable } from './presence';
import { planMarketingRoomSeeds } from './seed';

/** the replica, as much of it as the seed reads (a PowerSyncDatabase fits) */
export interface SeedReplica {
  getAll<T>(sql: string, params?: unknown[]): Promise<T[]>;
  watch(sql: string, params: unknown[], handler: { onResult: (r: { rows?: { _array?: unknown[] } }) => void; onError?: (e: Error) => void }): void;
}

export interface RunnerSeedDeps {
  db: SeedReplica;
  cfg: Pick<MachinedConfig, 'kind' | 'machineId' | 'workspaceId' | 'ownerUserId'>;
  /** resolves once this process syncs a checkpoint. a runner's replica lives on its volume, so after
   * a sleep the file shows the facts from before the sleep until then (machined.ts) */
  synced: () => Promise<void>;
  post: (path: string, actor: Actor, body: unknown) => Promise<{ status: number }>;
  /** the active pack's role map: null for no pack, a throw for a failed read (host/hire.ts) */
  packRoles: (workspaceId: string) => Promise<Record<AgentRole, string> | null>;
  log: (line: string) => void;
  /** the clock, for tests */
  timer?: (fn: () => void, ms: number) => void;
}

/** a burst of replica writes (Launch registers the whole crew) makes one pass */
export const SEED_DELAY_MS = 5_000;
/** a pass that leaves a command open runs again after this wait, which doubles at each retry up to the cap */
export const RETRY_BASE_MS = 30_000;
export const RETRY_CAP_MS = 30 * 60_000;

// the planner's inputs and nothing else. an agent's status is not here, so a heartbeat or a turn
// never starts a pass, although PowerSync runs this query again on every write to agents.
const INPUTS_SQL = `select 'agent' as fact, id, name, role, retired_at as at from agents
  where workspace_id = ? and (role in ('orchestrator', 'marketer') or name = 'plume')
  union all select 'room', id, null, null, created_at from channels where workspace_id = ? and kind = 'marketing'
  order by 1, 2`;

export function startRunnerSeeds(deps: RunnerSeedDeps): void {
  const { db, cfg, post, log } = deps;
  // a member machine serves its person, and a Mac seeds at its own boot: only the runner seeds here
  if (cfg.kind !== 'runner') return;
  const timer = deps.timer ?? ((fn: () => void, ms: number) => { setTimeout(fn, ms); });
  const ws = cfg.workspaceId;
  const owner: Actor = { kind: 'human', id: cfg.ownerUserId };
  // a restart clears this, so each boot refreshes the packs and repeats the backfill, as a Mac launch does
  const settled = { rooms: new Set<string>(), backfill: false, register: false };

  // resolves false when the command stays open for a later pass
  const send = async (cmd: Record<string, unknown>): Promise<boolean> => {
    const type = String(cmd['type']);
    const room = type === 'agent.register' ? (cmd['channels'] as string[]).join(',') : (cmd['channel'] as string | undefined);
    const status = await post('/v1/commands', owner, cmd).then((r) => r.status, () => null);
    log(`runner_seed ${type} ${status ?? 'offline'}${room ? ` room=${room}` : ''}`);
    // a 2xx or a refusal settles the command, because a refusal does not change on a retry. a 5xx, a
    // 429 or no answer leaves it open (presence.ts). so does a 404 or a 409 on the register: it names
    // every room the replica lists, and one room deleted after the read refuses the whole register.
    // the next pass sends a fresh list.
    if (isRetryable(status) || (type === 'agent.register' && (status === 404 || status === 409))) return false;
    if (type === 'skillpack.seed_defaults') settled.rooms.add(String(cmd['channel']));
    else if (type === 'setup.backfill') settled.backfill = true;
    else if (type === 'agent.register') settled.register = true;
    return true;
  };

  // resolves true when a command stays open or plume waits for the pack
  const pass = async (): Promise<boolean> => {
    const [orchestrator, rooms, marketer, plume] = await Promise.all([
      db.getAll(`select 1 from agents where workspace_id = ? and role = 'orchestrator' and retired_at is null limit 1`, [ws]),
      db.getAll<{ id: string }>(`select id from channels where workspace_id = ? and kind = 'marketing' order by created_at, id`, [ws]),
      // retired included, as on the Mac: a register would undo a person's retirement
      db.getAll(`select 1 from agents where workspace_id = ? and role = 'marketer' limit 1`, [ws]),
      db.getAll<{ role: string }>(`select role from agents where workspace_id = ? and name = 'plume' limit 1`, [ws]),
    ]);
    // the pack only seats plume, so a workspace that has a marketer reads none
    const pack = !marketer.length && !settled.register
      ? await deps.packRoles(ws).then((roles) => ({ roles, failed: false }), () => ({ roles: null, failed: true }))
      : { roles: null, failed: false };
    const plan = planMarketingRoomSeeds({
      workspace: ws, machineId: cfg.machineId, hasOrchestrator: orchestrator.length > 0, rooms: rooms.map((r) => r.id),
      hasMarketer: marketer.length > 0, plumeRole: plume[0]?.role ?? null, packRoles: pack.roles, packReadFailed: pack.failed, settled,
    });
    for (const reason of plan.skipped) log(`runner_seed skip: ${reason}`);
    let open = plan.held;
    for (const cmd of plan.cmds) if (!(await send(cmd))) open = true;
    return open;
  };

  // one pass at a time: a pass asked for while one runs follows it. a pass that leaves something open
  // runs again after a backoff, because no replica change may come to start it. one retry waits at a time
  let running = false;
  let again = false;
  let retries = 0;
  let retryDue = false;
  const run = (): void => {
    if (running) { again = true; return; }
    running = true;
    void pass()
      .catch((e: unknown) => { log(`runner_seed pass failed: ${e instanceof Error ? e.message : String(e)}`); return true; })
      .then((open) => {
        if (!open) { retries = 0; return; }
        if (retryDue) return;
        retryDue = true;
        const ms = backoffDelayMs(retries++, RETRY_BASE_MS, RETRY_CAP_MS);
        log(`runner_seed retry in ${ms / 1000} s`);
        timer(() => { retryDue = false; run(); }, ms);
      })
      .finally(() => {
        running = false;
        if (again) { again = false; run(); }
      });
  };

  // the first result is the boot pass. after it, a change waits SEED_DELAY_MS, and the changes in
  // that wait ride the same pass. the watch starts after this process syncs: a pass on the facts from
  // before a sleep could settle plume's register without the rooms made during the sleep
  let seen: string | null = null;
  let due = false;
  void deps.synced().then(() => db.watch(INPUTS_SQL, [ws, ws], {
    onResult: (r) => {
      const now = JSON.stringify(r.rows?._array ?? []);
      if (now === seen) return;
      const boot = seen === null;
      seen = now;
      if (boot) { run(); return; }
      if (due) return;
      due = true;
      timer(() => { due = false; run(); }, SEED_DELAY_MS);
    },
    onError: (e) => log(`runner_seed watch failed: ${e.message}`),
  })).catch((e: unknown) => log(`runner_seed sync wait failed: ${e instanceof Error ? e.message : String(e)}`));
}
