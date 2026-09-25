// machined's pure config core — dependency-free so tests import it without dragging
// the daemon's native modules (@powersync/node) through the test loader.

export interface MachinedConfig {
  machineToken: string;
  machineId: string;
  workspaceId: string;
  kind: string;
  ownerUserId: string;
  apiUrl: string;
  powersyncUrl: string;
  stateDir: string;
}

/** what a warm spare carries instead of an identity (infra/k8s/templates/pool.yaml): the pool
 *  token plus its own pod name and uid — the three things control-api's bootstrap exchange
 *  needs (docs/design/agent-sandbox-2026-09/plan.md §5.2). null = this is not a spare. */
export interface BootstrapEnv {
  apiUrl: string;
  poolToken: string;
  pod: string;
  uid: string;
}

export function bootstrapEnvOf(env: Record<string, string | undefined>): BootstrapEnv | null {
  if (env['NM_MACHINE_TOKEN']) return null;
  const poolToken = env['NM_POOL_TOKEN'];
  const pod = env['NM_POD_NAME'];
  const uid = env['NM_POD_UID'];
  if (!poolToken || !pod || !uid) return null;
  return { apiUrl: env['NM_API_URL'] ?? 'https://api.neuramesh.app', poolToken, pod, uid };
}

/** the identity the bootstrap exchange answers with — the row's, never the pod's guess */
export interface BootstrapIdentity {
  machineId: string;
  workspaceId: string;
  kind: string;
  ownerUserId: string;
  token: string;
}

/** a spare that redeemed its binding boots exactly like a stamped machine: the identity fills the
 *  env the StatefulSet template would have carried, and readConfig's own checks still apply */
export function configFromBootstrap(env: Record<string, string | undefined>, identity: BootstrapIdentity): MachinedConfig {
  return readConfig({
    ...env,
    NM_MACHINE_TOKEN: identity.token,
    NM_MACHINE_ID: identity.machineId,
    NM_WORKSPACE_ID: identity.workspaceId,
    NM_MACHINE_KIND: identity.kind,
    NM_OWNER_USER_ID: identity.ownerUserId,
  });
}

/** pure and loud: a machine with half an identity must refuse to boot, not half-run */
export function readConfig(env: Record<string, string | undefined>): MachinedConfig {
  const need = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`machined: ${name} is required`);
    return v;
  };
  const token = need('NM_MACHINE_TOKEN');
  if (token === 'unprovisioned') throw new Error('machined: token still unprovisioned — the mint never reached this machine');
  if (!token.startsWith('nmm_')) throw new Error('machined: NM_MACHINE_TOKEN is not a machine token');
  return {
    machineToken: token,
    machineId: need('NM_MACHINE_ID'),
    workspaceId: need('NM_WORKSPACE_ID'),
    kind: env['NM_MACHINE_KIND'] ?? 'runner',
    ownerUserId: need('NM_OWNER_USER_ID'),
    apiUrl: env['NM_API_URL'] ?? 'https://api.neuramesh.app',
    powersyncUrl: need('NM_POWERSYNC_URL'),
    stateDir: env['NM_STATE'] ?? '/nm/state',
  };
}
