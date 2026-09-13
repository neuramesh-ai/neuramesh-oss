// THE DESKTOP'S OWN CODE HOST (the desktop Code bridge, slice B1, 2026-09-04) — pure, so it is
// tested with a fake coding core the way the machine daemon's host is.
//
// The same Cline engineering host `machined.ts` runs on a cloud machine, built for the app's own
// user: the member's /v1 headers instead of a machine token (the endpoints the host calls accept a
// member — actorMayReadCredentials · actorInWorkspace), the thread's worktree cut from the repo's
// local checkout on this Mac when it has one, the workspace's policy rules. Sessions are kept here
// keyed by the renderer's subId, under the same per-thread lease the relay edge holds, so one Code
// thread cannot run twice on one machine whichever lane opened it.
import type { AbstractPowerSyncDatabase } from '@powersync/node';
import type { EngineeringMachineOpenMeta, EngineeringOpenMeta, EngineeringRuntimeEvent } from '../../engineering-protocol';
import { resolveEngineeringBrain } from './engineering-brain';
import { createClineEngineeringHost, type ClineEngineeringHostOptions, type EngineeringMachineHost, type EngineeringMachineSession } from './engineering-host';
import { createCodeSessionRecorder } from './engineering-record';
import { loadEngineeringPolicyRules } from './engineering-policy';
import { EngineeringSessionLeases } from './engineering-session-leases';
import { ensureEngineeringWorkspace } from './engineering-workspace';

export interface LocalEngineeringHostOptions {
  db: Pick<AbstractPowerSyncDatabase, 'get' | 'getAll'>;
  apiUrl: string;
  workspaceId: string;
  /** the signed-in member's /v1 headers — the identity this host speaks with */
  authHeaders: () => Promise<Record<string, string>>;
  /** this Mac's machines row, when it has one — the session's synced row names it as the host */
  machineId?: string | null;
  log?: (line: string) => void;
  fetchImpl?: typeof fetch;
  createCore?: ClineEngineeringHostOptions['createCore'];
  createDefaultExecutors?: ClineEngineeringHostOptions['createDefaultExecutors'];
  /** test seams, the machine host's own: a worktree without git, a brain without a replica */
  resolveCwd?: ClineEngineeringHostOptions['resolveCwd'];
  resolveBrain?: ClineEngineeringHostOptions['resolveBrain'];
}

export function createLocalEngineeringHost(o: LocalEngineeringHostOptions): EngineeringMachineHost {
  const auth = { apiUrl: o.apiUrl, machineToken: '', authHeaders: o.authHeaders, workspaceId: o.workspaceId, ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}) };
  return createClineEngineeringHost({
    ...auth,
    resolveCwd: o.resolveCwd ?? ((meta) => ensureEngineeringWorkspace(o.db, o.workspaceId, meta, { preferLocal: true })),
    resolveBrain: o.resolveBrain ?? ((meta) => resolveEngineeringBrain(o.db, auth, meta)),
    resolvePolicyRules: (meta) => loadEngineeringPolicyRules(o.db, o.workspaceId, meta.projectId ?? null),
    // the session's synced row (0135), written as the member this host speaks for
    recorder: createCodeSessionRecorder({ apiUrl: o.apiUrl, headers: o.authHeaders, workspaceId: o.workspaceId, machineId: o.machineId ?? null, ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}), ...(o.log ? { log: o.log } : {}) }),
    ...(o.log ? { log: o.log } : {}),
    ...(o.createCore ? { createCore: o.createCore } : {}),
    ...(o.createDefaultExecutors ? { createDefaultExecutors: o.createDefaultExecutors } : {}),
  });
}

/** the open sessions of the local lane, by the renderer's subId */
export class LocalEngineeringSessions {
  private readonly sessions = new Map<string, { session: EngineeringMachineSession; lease: string }>();
  private readonly leases = new EngineeringSessionLeases();
  constructor(private readonly host: EngineeringMachineHost, private readonly actorId: () => string) {}

  /** open a session; events flow to `emit`, and `exit` fires once — on close, or on an open that failed */
  async open(subId: string, meta: EngineeringOpenMeta, emit: (event: EngineeringRuntimeEvent) => void, exit: () => void): Promise<boolean> {
    const actorId = this.actorId();
    const claim = this.leases.claim(actorId, meta.threadId);
    if (!claim.ok) {
      emit(claim.reason === 'active'
        ? { type: 'error', code: 'SESSION_ACTIVE', recoverable: true, message: 'This Code thread is already active in another window.' }
        : { type: 'error', code: 'ENGINEERING_CHANNEL_LIMIT', recoverable: true, message: 'Too many Code sessions are active. Close one before opening another.' });
      exit();
      return false;
    }
    // the machine's meta carries the actor the RELAY injects after authentication; here the app
    // itself is the authenticated party, so it is the signed-in member. The machine choice is the
    // client's routing key and means nothing to the host.
    const { machineId: _machine, ...rest } = meta;
    const full: EngineeringMachineOpenMeta = { ...rest, actorId };
    try {
      const session = await this.host.open(full, emit);
      this.sessions.set(subId, { session, lease: claim.lease });
      return true;
    } catch (error) {
      this.leases.release(claim.lease);
      emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      exit();
      return false;
    }
  }
  command(subId: string, value: unknown): void { this.sessions.get(subId)?.session.command(value); }
  close(subId: string): boolean {
    const open = this.sessions.get(subId);
    if (!open) return false;
    this.sessions.delete(subId);
    this.leases.release(open.lease);
    open.session.close();
    return true;
  }
  get size(): number { return this.sessions.size; }
}
