// the thin effectful shell around the pure planner: observe → plan → execute.
// errors on one action never block the rest — a wedged workspace must not stop
// every other workspace's wake.

import type { Kube } from './kube.js';
import { planActions, type Action, type Observed, type Templates } from './plan.js';
import { MACHINE_LABEL, MANAGED_LABEL, WORKSPACE_LABEL } from './names.js';
import type { DesiredState, FleetEnv, KubeObject } from './types.js';

const DELETABLE: Record<string, { apiVersion: string }> = {
  Namespace: { apiVersion: 'v1' },
  StatefulSet: { apiVersion: 'apps/v1' },
  Secret: { apiVersion: 'v1' },
  PersistentVolumeClaim: { apiVersion: 'v1' },
};

/** mints a fresh machine token via control-api — only the operator ever holds the plaintext,
 *  and only for the moment between mint and secret write (architecture.md §3.3) */
export type TokenMinter = (machineId: string) => Promise<string>;

export interface ReconcileResult {
  applied: number;
  deleted: number;
  /** ensure-secret steps that could not run (no minter in file mode) — visible, never fatal */
  skipped: number;
  errors: { action: Action; error: string }[];
}

export async function observe(kube: Kube): Promise<Observed> {
  const namespaces = await kube.list('v1', 'Namespace', `${MANAGED_LABEL}=true`);
  const statefulSets = await kube.list('apps/v1', 'StatefulSet', MACHINE_LABEL);
  const secrets = await kube.list('v1', 'Secret', MACHINE_LABEL);
  return {
    managedNamespaces: namespaces.map((n) => n.metadata.name),
    machineStatefulSets: statefulSets.map((s) => ({
      namespace: s.metadata.namespace ?? '',
      name: s.metadata.name,
    })),
    tokenSecrets: secrets.map((s) => `${s.metadata.namespace}/${s.metadata.name}`),
  };
}

function secretLabels(workspaceId: string, machineId: string): Record<string, string> {
  return { [MANAGED_LABEL]: 'true', [WORKSPACE_LABEL]: workspaceId, [MACHINE_LABEL]: machineId };
}

/** adopt-or-mint for one machine token secret. an existing secret (hand-provisioned, or a
 *  survivor of an operator restart) is adopted by labeling it — its data is owned by whoever
 *  wrote it and SSA leaves unlisted fields of other field managers alone, so a live
 *  machine's token is never rotated out from under it. only a truly absent secret mints. */
async function ensureSecret(
  kube: Kube,
  action: Extract<Action, { op: 'ensure-secret' }>,
  minter: TokenMinter | undefined,
): Promise<'applied' | 'skipped'> {
  const existing = await kube.get('v1', 'Secret', action.namespace, action.name);
  if (existing.status === 200) {
    const adopt: KubeObject = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: action.name,
        namespace: action.namespace,
        labels: secretLabels(action.workspaceId, action.machineId),
      },
    };
    const res = await kube.apply(adopt);
    if (res.status >= 300) throw new Error(`adopt secret ${action.name}: ${res.status} ${JSON.stringify(res.body)}`);
    return 'applied';
  }
  if (existing.status !== 404) throw new Error(`get secret ${action.name}: ${existing.status} ${JSON.stringify(existing.body)}`);
  if (!minter) return 'skipped';
  const token = await minter(action.machineId);
  const secret: KubeObject = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name: action.name,
      namespace: action.namespace,
      labels: secretLabels(action.workspaceId, action.machineId),
    },
    type: 'Opaque',
    data: { token: Buffer.from(token, 'utf8').toString('base64') },
  };
  const res = await kube.apply(secret);
  if (res.status >= 300) throw new Error(`write secret ${action.name}: ${res.status} ${JSON.stringify(res.body)}`);
  return 'applied';
}

export async function reconcile(
  kube: Kube,
  desired: DesiredState,
  env: FleetEnv,
  templates: Templates,
  minter?: TokenMinter,
): Promise<ReconcileResult> {
  const observed = await observe(kube);
  const actions = planActions(desired, observed, env, templates);
  const result: ReconcileResult = { applied: 0, deleted: 0, skipped: 0, errors: [] };

  for (const action of actions) {
    try {
      if (action.op === 'apply') {
        const res = await kube.apply(action.obj);
        if (res.status >= 300) throw new Error(`apply ${action.obj.kind}/${action.obj.metadata.name}: ${res.status} ${JSON.stringify(res.body)}`);
        result.applied++;
      } else if (action.op === 'ensure-secret') {
        const outcome = await ensureSecret(kube, action, minter);
        if (outcome === 'applied') result.applied++;
        else result.skipped++;
      } else {
        const meta = DELETABLE[action.kind];
        if (!meta) throw new Error(`undeletable kind ${action.kind}`);
        const res = await kube.delete(meta.apiVersion, action.kind, action.namespace, action.name);
        // 404 is a converged delete, not an error
        if (res.status >= 300 && res.status !== 404) throw new Error(`delete ${action.kind}/${action.name}: ${res.status} ${JSON.stringify(res.body)}`);
        result.deleted++;
      }
    } catch (err) {
      result.errors.push({ action, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
