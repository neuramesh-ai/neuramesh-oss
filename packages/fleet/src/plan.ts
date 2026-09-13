// the pure planning core (repo idiom: decisions in pure code, effects thin — stall.ts,
// shipverify.ts). observed cluster state in, desired rows in, ordered actions out.
//
// level-triggered: every reconcile re-applies every desired object via SSA (a no-op when
// nothing changed), so drift — a hand-scaled statefulset, a deleted quota — converges back
// to row truth on the next tick. deletes are the only guarded path: the planner will only
// ever delete inside namespaces carrying our managed label, and it removes a machine's
// PVC explicitly, because vendor logins must not outlive a removed machine row.

import type { DesiredState, FleetEnv, KubeObject } from './types.js';
import {
  KIND_LABEL,
  MACHINE_LABEL,
  MANAGED_LABEL,
  WORKSPACE_LABEL,
  namespaceFor,
  pvcFor,
  secretFor,
  statefulSetFor,
} from './names.js';
import { renderDocs } from './template.js';

export type Action =
  | { op: 'apply'; obj: KubeObject; reason: string }
  | { op: 'delete'; kind: DeletableKind; namespace?: string; name: string; reason: string }
  // the token-custody step (architecture.md §3.3): make sure the machine's token Secret
  // exists before its statefulset lands. the reconciler adopts an existing secret
  // (labels only, data untouched) or mints a fresh token from control-api.
  | { op: 'ensure-secret'; namespace: string; name: string; workspaceId: string; machineId: string; reason: string };

export type DeletableKind = 'Namespace' | 'StatefulSet' | 'Secret' | 'PersistentVolumeClaim';

/** what the reconciler observed, reduced to the three facts the planner needs */
export interface Observed {
  /** namespaces carrying MANAGED_LABEL=true */
  managedNamespaces: string[];
  /** statefulsets carrying MACHINE_LABEL, keyed `namespace/name` */
  machineStatefulSets: { namespace: string; name: string }[];
  /** token secrets carrying MACHINE_LABEL, keyed `namespace/name` — an adopted or minted
   *  secret is labeled, so it disappears from the ensure path on the next tick */
  tokenSecrets: string[];
}

export interface Templates {
  workspace: string;
  machine: string;
}

export function planActions(
  desired: DesiredState,
  observed: Observed,
  env: FleetEnv,
  templates: Templates,
): Action[] {
  const actions: Action[] = [];
  const desiredNamespaces = new Set<string>();
  const desiredStatefulSets = new Set<string>();

  for (const ws of desired.workspaces) {
    const ns = namespaceFor(ws.id);
    desiredNamespaces.add(ns);

    for (const obj of renderDocs(templates.workspace, {
      WORKSPACE_ID: ws.id,
      NAMESPACE: ns,
      PLAN: ws.plan,
      QUOTA_CPU: ws.quotaCpu,
      QUOTA_MEMORY: ws.quotaMemory,
      QUOTA_PVC_COUNT: ws.quotaPvcCount,
    })) {
      actions.push({ op: 'apply', obj, reason: `workspace ${ws.id}` });
    }

    for (const m of ws.machines) {
      const sts = statefulSetFor(m.id);
      desiredStatefulSets.add(`${ns}/${sts}`);
      // token custody before workload: the secret must exist (or be minted) before the
      // pod first starts, or machined crash-loops on a missing NM_MACHINE_TOKEN
      const secret = secretFor(m.id);
      if (!observed.tokenSecrets.includes(`${ns}/${secret}`)) {
        actions.push({
          op: 'ensure-secret',
          namespace: ns,
          name: secret,
          workspaceId: ws.id,
          machineId: m.id,
          reason: `machine ${ws.id}/${m.id} token`,
        });
      }
      for (const obj of renderDocs(templates.machine, {
        NAMESPACE: ns,
        WORKSPACE_ID: ws.id,
        MACHINE_ID: m.id,
        KIND: m.kind,
        OWNER_USER_ID: m.ownerUserId ?? '',
        REPLICAS: String(m.replicas),
        CPU: m.cpu,
        MEMORY: m.memory,
        CPU_LIMIT: m.cpuLimit,
        MEMORY_LIMIT: m.memoryLimit,
        DISK: m.disk,
        IMAGE: env.image,
        RUNTIME_CLASS: env.runtimeClass,
        STORAGE_CLASS: env.storageClass,
        POWERSYNC_URL: env.powersyncUrl,
        API_URL: env.apiUrl,
        RELAY_URL: env.relayUrl ?? '',
        MACHINE_COMMAND: env.machineCommand,
      })) {
        actions.push({ op: 'apply', obj, reason: `machine ${ws.id}/${m.id}` });
      }
    }
  }

  // removed machines: delete the workload, its token, and — deliberately — its PVC
  for (const sts of observed.machineStatefulSets) {
    if (desiredStatefulSets.has(`${sts.namespace}/${sts.name}`)) continue;
    if (!desiredNamespaces.has(sts.namespace) && !observed.managedNamespaces.includes(sts.namespace)) continue;
    const machineId = sts.name.replace(/^machine-/, '');
    const reason = `machine ${sts.namespace}/${machineId} removed`;
    actions.push({ op: 'delete', kind: 'StatefulSet', namespace: sts.namespace, name: sts.name, reason });
    actions.push({ op: 'delete', kind: 'Secret', namespace: sts.namespace, name: secretFor(machineId), reason });
    actions.push({ op: 'delete', kind: 'PersistentVolumeClaim', namespace: sts.namespace, name: pvcFor(machineId), reason });
  }

  // removed workspaces: delete the namespace (cascades everything inside).
  // guarded twice: only namespaces we observed carrying the managed label.
  for (const ns of observed.managedNamespaces) {
    if (desiredNamespaces.has(ns)) continue;
    actions.push({ op: 'delete', kind: 'Namespace', name: ns, reason: `workspace ${ns} removed` });
  }

  return actions;
}

/** the labels every stamped object carries — asserted in tests so the delete guards hold */
export function expectedLabels(workspaceId: string, machineId?: string): Record<string, string> {
  const labels: Record<string, string> = {
    [MANAGED_LABEL]: 'true',
    [WORKSPACE_LABEL]: workspaceId,
  };
  if (machineId) labels[MACHINE_LABEL] = machineId;
  return labels;
}

export { MANAGED_LABEL, WORKSPACE_LABEL, MACHINE_LABEL, KIND_LABEL };
