// THE SLEEPER RUNG, daemon side (docs/design/member-machines-2026-09/plan.md §4.3).
//
// A cloud member machine holds its owner's vendor logins and is asleep most of the time. When no
// machine that is awake can serve a piece of work — the runner has no Claude login, the member's
// laptop is closed — the ladder used to say "no machine available" and stop. Now it asks the
// fleet to wake the best sleeper (one that PUBLISHED the runtime while it was awake and is lent
// to the origin, or is theirs) and stands down: the sleeper's daemon boots, its dead-letter sweep
// finds the unanswered message, and its own ladder claims. The offer of a task waits the same way.
//
// ONE memo for the whole host, at module scope: chat wakes and task claims both come through here,
// and a machine asked twice inside five minutes is a machine mid-boot, not a machine ignored.
import { nobodyCanServe, wakeCandidates, type MachineCapability } from '@neuramesh/shared';

export const SLEEPER_MEMO_MS = 5 * 60_000;
const asked = new Map<string, number>();

export interface SleeperAsk {
  runtime: string;
  model: string | null;
  /** the member the work came from — null for a sweep or a schedule */
  originUserId: string | null;
  workspace: string;
  /** the agent doing the asking — the server checks it belongs to the workspace */
  actor: { kind: string; id: string; role?: string };
}

export interface SleeperAnswer {
  machineId: string;
  ownerUserId: string;
  /** true when THIS call issued the wake; false when it was asked inside the memo window */
  asked: boolean;
}

export function makeSleeperWake(deps: {
  peerMachines: () => Promise<MachineCapability[]>;
  post: (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<Response>;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());

  /** Ask the fleet to wake the best sleeper for this work. Null when an awake machine could serve
   *  (then the ladder's grace handles it) or when no sleeper is worth waking. */
  async function requestSleeperWake(a: SleeperAsk): Promise<SleeperAnswer | null> {
    const machines = await deps.peerMachines();
    const t = now();
    // an awake, lent, capable machine will step in on its own — waking a sleeper beside it would
    // spend a boot for nothing
    if (!nobodyCanServe(machines, a.runtime, a.originUserId, t, a.model)) return null;
    const [best] = wakeCandidates({ machines, runtime: a.runtime, model: a.model, originUserId: a.originUserId }, t);
    if (!best) return null;
    const last = asked.get(best.machineId) ?? 0;
    if (t - last < SLEEPER_MEMO_MS) return { machineId: best.machineId, ownerUserId: best.ownerUserId, asked: false };
    asked.set(best.machineId, t);
    const res = await deps.post('/v1/commands', a.actor, {
      type: 'machine.wake', workspace: a.workspace, machineId: best.machineId,
      ...(a.originUserId ? { forUserId: a.originUserId } : {}),
    }).catch(() => null);
    if (!res || !res.ok) {
      // a refusal is not a boot: forget the memo so the next need asks again once the reason
      // (credits, a revoked grant) may have changed
      asked.delete(best.machineId);
      console.log(`sleeper_wake_refused machine=${best.machineId.slice(0, 8)} status=${res?.status ?? 'network'} runtime=${a.runtime}`);
      return null;
    }
    console.log(`sleeper_wake machine=${best.machineId.slice(0, 8)} for=${a.originUserId ?? 'workspace'} runtime=${a.runtime}`);
    return { machineId: best.machineId, ownerUserId: best.ownerUserId, asked: true };
  }

  return { requestSleeperWake };
}

/** test seam: forget every memo (the map is module-scoped on purpose) */
export function resetSleeperMemo(): void {
  asked.clear();
}
