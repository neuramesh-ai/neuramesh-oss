// every kubernetes name the fleet stamps, derived in ONE place. the reconciler, the
// planner's delete path, and the tests all read these — naming drift between "create"
// and "delete" is how orphaned PVCs (and orphaned vendor logins) happen.

export const MANAGED_LABEL = 'neuramesh.io/managed';
export const WORKSPACE_LABEL = 'neuramesh.io/workspace';
export const MACHINE_LABEL = 'neuramesh.io/machine';
export const KIND_LABEL = 'neuramesh.io/kind';

const DNS_SAFE = /^[a-z0-9]([a-z0-9-]{0,50}[a-z0-9])?$/;

/** ids come from rows; refuse anything that would produce an invalid or ambiguous name */
export function assertDnsSafe(id: string, what: string): void {
  if (!DNS_SAFE.test(id)) throw new Error(`${what} id ${JSON.stringify(id)} is not dns-safe`);
}

export function namespaceFor(workspaceId: string): string {
  assertDnsSafe(workspaceId, 'workspace');
  return `ws-${workspaceId}`;
}

export function statefulSetFor(machineId: string): string {
  assertDnsSafe(machineId, 'machine');
  return `machine-${machineId}`;
}

export function secretFor(machineId: string): string {
  return `${statefulSetFor(machineId)}-token`;
}

/** volumeClaimTemplate `data` + statefulset name + ordinal 0 — the PVC a machine owns */
export function pvcFor(machineId: string): string {
  return `data-${statefulSetFor(machineId)}-0`;
}
