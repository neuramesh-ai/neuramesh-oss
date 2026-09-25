// The unbound boot (docs/design/agent-sandbox-2026-09/plan.md §5.2). A warm spare starts with no
// identity: env is baked at pod creation and a claim that set env would cold-start, so the pod
// carries only the pool token and its own name and uid, and ASKS. control-api answers 404 until
// nm-fleet has bound this pod to a machine row (a tick or two after the claim adopted it), then
// the machine's identity and a fresh token. The exchange is outbound, like everything else a
// machine does, and the pod's uid is what keeps a sibling from redeeming it.
//
// Dependency-free on purpose (fetch and a sleep are injected), so the test runs without the
// daemon's native modules.
import type { BootstrapEnv, BootstrapIdentity } from './machined-config';

export interface BootstrapDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
  /** between polls while unbound; the operator binds within one tick (10 s), so a couple of
   *  seconds keeps the wake budget without hammering the api */
  intervalMs?: number;
  /** give up after this many consecutive polls (an unbound pod is a pool spare, which is normal —
   *  but a spare nobody claims in this long is one the pool will replace anyway) */
  maxPolls?: number;
}

export class BootstrapRefused extends Error {}

export async function bootstrapIdentity(env: BootstrapEnv, deps: BootstrapDeps): Promise<BootstrapIdentity> {
  const interval = deps.intervalMs ?? 2_000;
  const maxPolls = deps.maxPolls ?? Number.POSITIVE_INFINITY;
  let polls = 0;
  let saidWaiting = false;
  for (;;) {
    polls++;
    let res: Response | null = null;
    try {
      res = await deps.fetch(`${env.apiUrl}/v1/machines/bootstrap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ poolToken: env.poolToken, pod: env.pod, uid: env.uid }),
      });
    } catch (err) {
      deps.log(`bootstrap: ${env.apiUrl} unreachable (${err instanceof Error ? err.message : err}); retrying`);
    }
    if (res) {
      if (res.status === 200) {
        const body = (await res.json()) as Partial<BootstrapIdentity>;
        if (!body.token || !body.machineId || !body.workspaceId || !body.ownerUserId) throw new Error('bootstrap: control-api answered without a full identity');
        deps.log(`bootstrap: bound as machine=${body.machineId} kind=${body.kind ?? 'runner'} after ${polls} poll(s)`);
        return { machineId: body.machineId, workspaceId: body.workspaceId, kind: body.kind ?? 'runner', ownerUserId: body.ownerUserId, token: body.token };
      }
      // the pool token is wrong or the lane is closed: no amount of waiting fixes a refusal
      if (res.status === 401 || res.status === 403) throw new BootstrapRefused(`bootstrap: refused (${res.status}) — the pool token does not match control-api's FLEET_POOL_TOKEN`);
      if (res.status === 404) {
        if (!saidWaiting) { deps.log(`bootstrap: pod ${env.pod} not bound yet — a warm spare, waiting for a claim`); saidWaiting = true; }
      } else {
        deps.log(`bootstrap: control-api answered ${res.status}; retrying`);
      }
    }
    if (polls >= maxPolls) throw new Error(`bootstrap: not bound after ${polls} polls`);
    await deps.sleep(interval);
  }
}
