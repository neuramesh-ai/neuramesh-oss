// the fleet's desired-state contract (docs/design/cloud-first-2026-08/architecture.md §3).
// this is what control-api will serve at /v1/fleet/desired and what fixtures feed the
// reconciler in tests. deliberately flat and boring: rows in, workloads out.

export type MachineKind = 'member' | 'runner';

export interface MachineSpec {
  /** machines row id — must be dns-safe, it names the workload (`machine-<id>`) */
  id: string;
  kind: MachineKind;
  /** member machines only: the owner whose logins live on the PVC */
  ownerUserId?: string;
  /** 0 = stopped (PVC survives) · 1 = running. rows are truth; drift is reverted. */
  replicas: 0 | 1;
  /** pod requests — what Autopilot bills */
  cpu: string;
  memory: string;
  /** burst ceilings */
  cpuLimit: string;
  memoryLimit: string;
  /** PVC size, e.g. "50Gi" */
  disk: string;
}

export interface WorkspaceSpec {
  /** workspace id — dns-safe, names the namespace (`ws-<id>`) */
  id: string;
  /** plan tier label; quota vars derive from it server-side */
  plan: string;
  /** namespace ceilings (ResourceQuota) */
  quotaCpu: string;
  quotaMemory: string;
  quotaPvcCount: string;
  machines: MachineSpec[];
}

export interface DesiredState {
  workspaces: WorkspaceSpec[];
}

/** per-environment knobs (k3d has no gVisor and no PD CSI; GKE sets both) */
export interface FleetEnv {
  /** '' = omit → cluster default storage class */
  storageClass: string;
  /** '' = omit → default runtime (k3d); 'gvisor' on GKE */
  runtimeClass: string;
  /** machine image ref */
  image: string;
  /** the PowerSync instance machined syncs against ('' only in command-overridden test envs) */
  powersyncUrl: string;
  /** control-api base ('' = machined's default) */
  apiUrl: string;
  /** wss origin of nm-relay; empty/absent = machines run without a browser terminal */
  relayUrl?: string;
  /** JSON array command override ('' = the image CMD, nm-machined; tests set a sleep) */
  machineCommand: string;
}

/** a parsed kubernetes manifest — only the fields the fleet reads */
export interface KubeObject {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace?: string; labels?: Record<string, string> };
  spec?: unknown;
  [key: string]: unknown;
}
