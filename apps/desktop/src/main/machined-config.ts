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

/** the env the StatefulSet template would have stamped (infra/k8s/templates/machine.yaml) */
export function identityEnv(identity: BootstrapIdentity): Record<string, string> {
  return {
    NM_MACHINE_TOKEN: identity.token,
    NM_MACHINE_ID: identity.machineId,
    NM_WORKSPACE_ID: identity.workspaceId,
    NM_MACHINE_KIND: identity.kind,
    NM_OWNER_USER_ID: identity.ownerUserId,
  };
}

/** a spare that redeemed its binding boots exactly like a stamped machine: the identity fills the
 *  env the StatefulSet template would have carried, and readConfig's own checks still apply */
export function configFromBootstrap(env: Record<string, string | undefined>, identity: BootstrapIdentity): MachinedConfig {
  return readConfig({ ...env, ...identityEnv(identity) });
}

/** ...and the PROCESS becomes one, environment included: `env` is machined's own process.env.
 *  apiauth reads the machine bearer from the environment at call time, and until this only the
 *  config held the token: a claim runner's agent host sent every /v1 call with no bearer, which
 *  production's gate (header lane closed) answers 401 AUTH_REQUIRED. The dev stack opens the
 *  header lane, which is why k3d never showed it (2026-09-26). Validates before it writes, so a
 *  bad identity never lands. */
export function adoptIdentity(env: Record<string, string | undefined>, identity: BootstrapIdentity): MachinedConfig {
  const cfg = configFromBootstrap(env, identity);
  Object.assign(env, identityEnv(identity));
  return cfg;
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

/** the commit this machine's image was built from (the Dockerfile bakes NM_IMAGE_SHA from
 *  machine-image.yml), or null on a local build. Only a full commit sha counts: the API stores it
 *  as the machine's daemon_version, and a value it refused would cost the whole beat, not a field. */
export function imageShaOf(env: Record<string, string | undefined>): string | null {
  const sha = env['NM_IMAGE_SHA']?.trim() ?? '';
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/** the 30-second beat's command (machined.ts). `daemonVersion` rides every beat once the image
 *  names its commit; an older image sends none, and the API keeps whatever the row holds. */
export function heartbeatBody(machineId: string, beat: { activeSeconds: number; busy: boolean; runtimes?: string[]; imageSha: string | null }) {
  return {
    type: 'machine.heartbeat' as const,
    machineId,
    activeSeconds: beat.activeSeconds,
    busy: beat.busy,
    ...(beat.runtimes ? { runtimes: beat.runtimes } : {}),
    ...(beat.imageSha ? { daemonVersion: beat.imageSha } : {}),
  };
}
