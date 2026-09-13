// planner tests run against the REAL templates in infra/k8s/templates — the contract is
// "rows in, exactly these manifests out", so the templates are part of the unit under test.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { planActions, type Observed } from './plan.js';
import { MANAGED_LABEL, WORKSPACE_LABEL } from './names.js';
import type { DesiredState, FleetEnv, KubeObject } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(here, '..', '..', '..', 'infra', 'k8s', 'templates');
const templates = {
  workspace: readFileSync(join(templatesDir, 'workspace.yaml'), 'utf8'),
  machine: readFileSync(join(templatesDir, 'machine.yaml'), 'utf8'),
};

const env: FleetEnv = {
  storageClass: '', runtimeClass: '', image: 'busybox:stable',
  powersyncUrl: 'https://ps.dev', apiUrl: '', machineCommand: '["/bin/sh","-c","exec sleep infinity"]',
};
const gkeEnv: FleetEnv = {
  storageClass: 'nm-xfs', runtimeClass: 'gvisor', image: 'x',
  powersyncUrl: 'https://ps.prod', apiUrl: 'https://api.prod', machineCommand: '',
};

const desired: DesiredState = {
  workspaces: [
    {
      id: 'acme',
      plan: 'cloud',
      quotaCpu: '16',
      quotaMemory: '64Gi',
      quotaPvcCount: '10',
      machines: [
        { id: 'alice', kind: 'member', ownerUserId: 'u1', replicas: 1, cpu: '500m', memory: '2Gi', cpuLimit: '4', memoryLimit: '8Gi', disk: '50Gi' },
        { id: 'runner0', kind: 'runner', replicas: 1, cpu: '500m', memory: '2Gi', cpuLimit: '4', memoryLimit: '8Gi', disk: '20Gi' },
      ],
    },
  ],
};

const empty: Observed = { managedNamespaces: [], machineStatefulSets: [], tokenSecrets: [] };

function applies(actions: ReturnType<typeof planActions>): KubeObject[] {
  return actions.filter((a) => a.op === 'apply').map((a) => (a as { obj: KubeObject }).obj);
}

describe('planActions', () => {
  it('stamps the full workspace bundle plus both machines', () => {
    const objs = applies(planActions(desired, empty, env, templates));
    const kinds = objs.map((o) => o.kind);
    expect(kinds).toContain('Namespace');
    expect(kinds).toContain('ResourceQuota');
    expect(kinds).toContain('NetworkPolicy');
    expect(kinds.filter((k) => k === 'StatefulSet')).toHaveLength(2);
    // token Secrets are provisioning-owned, never stamped (reconcile must not clobber them)
    expect(kinds.filter((k) => k === 'Secret')).toHaveLength(0);
  });

  it('labels every object for the delete guards', () => {
    for (const obj of applies(planActions(desired, empty, env, templates))) {
      expect(obj.metadata.labels?.[MANAGED_LABEL], `${obj.kind}/${obj.metadata.name}`).toBe('true');
      expect(obj.metadata.labels?.[WORKSPACE_LABEL]).toBe('acme');
    }
  });

  it('omits runtimeClass/storageClass on k3d and sets them on gke', () => {
    const stsOf = (e: FleetEnv) =>
      applies(planActions(desired, empty, e, templates)).find((o) => o.kind === 'StatefulSet') as KubeObject & {
        spec: { template: { spec: { runtimeClassName?: string } }; volumeClaimTemplates: { spec: { storageClassName?: string } }[] };
      };
    expect(stsOf(env).spec.template.spec.runtimeClassName).toBeUndefined();
    expect(stsOf(env).spec.volumeClaimTemplates[0]!.spec.storageClassName).toBeUndefined();
    expect(stsOf(gkeEnv).spec.template.spec.runtimeClassName).toBe('gvisor');
    expect(stsOf(gkeEnv).spec.volumeClaimTemplates[0]!.spec.storageClassName).toBe('nm-xfs');
  });

  it('command override renders in test envs and vanishes for the image CMD (machined)', () => {
    type Sts = KubeObject & { spec: { template: { spec: { containers: { command?: string[]; env: { name: string; value: string }[] }[] } } } };
    const stsOf = (e: FleetEnv) =>
      applies(planActions(desired, empty, e, templates)).find((o) => o.kind === 'StatefulSet') as Sts;
    expect(stsOf(env).spec.template.spec.containers[0]!.command).toEqual(['/bin/sh', '-c', 'exec sleep infinity']);
    expect(stsOf(gkeEnv).spec.template.spec.containers[0]!.command).toBeUndefined();
    const psEnv = stsOf(gkeEnv).spec.template.spec.containers[0]!.env.find((v) => v.name === 'NM_POWERSYNC_URL');
    expect(psEnv?.value).toBe('https://ps.prod');
  });

  it('replicas flow from the row — wake and stop are data, not verbs', () => {
    const stopped: DesiredState = JSON.parse(JSON.stringify(desired));
    stopped.workspaces[0]!.machines[0]!.replicas = 0;
    const sts = applies(planActions(stopped, empty, env, templates)).find(
      (o) => o.kind === 'StatefulSet' && o.metadata.name === 'machine-alice',
    ) as KubeObject & { spec: { replicas: number } };
    expect(sts.spec.replicas).toBe(0);
  });

  it('deletes a removed machine including its PVC, only inside managed namespaces', () => {
    const observed: Observed = {
      managedNamespaces: ['ws-acme'],
      machineStatefulSets: [
        { namespace: 'ws-acme', name: 'machine-alice' },
        { namespace: 'ws-acme', name: 'machine-gone' },
      ],
      tokenSecrets: [],
    };
    const actions = planActions(desired, observed, env, templates);
    const deletes = actions.filter((a): a is Extract<typeof a, { op: 'delete' }> => a.op === 'delete');
    expect(deletes.map((d) => `${d.kind}/${d.name}`)).toEqual([
      'StatefulSet/machine-gone',
      'Secret/machine-gone-token',
      'PersistentVolumeClaim/data-machine-gone-0',
    ]);
  });

  it('deletes a removed workspace namespace, never an unmanaged one', () => {
    const observed: Observed = {
      managedNamespaces: ['ws-acme', 'ws-oldco'],
      machineStatefulSets: [],
      tokenSecrets: [],
    };
    const actions = planActions(desired, observed, env, templates);
    const nsDeletes = actions.filter(
      (a): a is Extract<typeof a, { op: 'delete' }> => a.op === 'delete' && a.kind === 'Namespace',
    );
    expect(nsDeletes).toHaveLength(1);
    expect(nsDeletes[0]!.name).toBe('ws-oldco');
  });

  it('ensure-secret precedes each machine statefulset, and vanishes once the secret is observed', () => {
    const actions = planActions(desired, empty, env, templates);
    const idx = (pred: (a: (typeof actions)[number]) => boolean) => actions.findIndex(pred);
    const secretIdx = idx((a) => a.op === 'ensure-secret' && a.machineId === 'alice');
    const stsIdx = idx((a) => a.op === 'apply' && a.obj.kind === 'StatefulSet' && a.obj.metadata.name === 'machine-alice');
    expect(secretIdx).toBeGreaterThanOrEqual(0);
    expect(secretIdx).toBeLessThan(stsIdx);
    const ensures = actions.filter((a): a is Extract<typeof a, { op: 'ensure-secret' }> => a.op === 'ensure-secret');
    expect(ensures.map((a) => `${a.namespace}/${a.name}`)).toEqual([
      'ws-acme/machine-alice-token',
      'ws-acme/machine-runner0-token',
    ]);

    const converged: Observed = {
      ...empty,
      tokenSecrets: ['ws-acme/machine-alice-token', 'ws-acme/machine-runner0-token'],
    };
    expect(planActions(desired, converged, env, templates).some((a) => a.op === 'ensure-secret')).toBe(false);
  });

  it('refuses ids that are not dns-safe', () => {
    const bad: DesiredState = JSON.parse(JSON.stringify(desired));
    bad.workspaces[0]!.id = 'Acme Inc';
    expect(() => planActions(bad, empty, env, templates)).toThrow(/dns-safe/);
  });
});
