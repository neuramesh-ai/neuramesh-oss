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
