// token-custody paths through the reconciler, against a fake kube. the contract under
// test: a missing secret mints exactly once (plaintext only ever transits the operator),
// an existing secret is adopted by labels with its data untouched, and file mode
// (no minter) skips loudly instead of inventing a credential.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Kube, KubeResponse } from './kube.js';
import { reconcile } from './reconcile.js';
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

const desired: DesiredState = {
  workspaces: [
    {
      id: 'acme', plan: 'cloud', quotaCpu: '16', quotaMemory: '64Gi', quotaPvcCount: '10',
      machines: [
        { id: 'runner0', kind: 'runner', ownerUserId: 'u1', replicas: 1, cpu: '500m', memory: '2Gi', cpuLimit: '4', memoryLimit: '8Gi', disk: '20Gi' },
      ],
    },
  ],
};

interface FakeCalls {
  applied: KubeObject[];
  gets: string[];
}

/** a kube whose list/get answers are canned and whose applies are recorded */
function fakeKube(over: { secretGetStatus?: number; secretBody?: unknown } = {}): { kube: Kube; calls: FakeCalls } {
  const calls: FakeCalls = { applied: [], gets: [] };
  const kube = {
    async list() {
      return [];
    },
    async get(_api: string, kind: string, ns: string | undefined, name: string): Promise<KubeResponse> {
      calls.gets.push(`${kind}/${ns}/${name}`);
      return { status: over.secretGetStatus ?? 404, body: over.secretBody };
    },
    async apply(obj: KubeObject): Promise<KubeResponse> {
      calls.applied.push(obj);
      return { status: 200, body: obj };
    },
    async delete(): Promise<KubeResponse> {
      return { status: 200, body: {} };
    },
  } as unknown as Kube;
  return { kube, calls };
}

describe('reconcile token custody', () => {
  it('mints once for a missing secret and writes it labeled, before the statefulset', async () => {
    const { kube, calls } = fakeKube({ secretGetStatus: 404 });
    const minted: string[] = [];
    const result = await reconcile(kube, desired, env, templates, async (id) => {
      minted.push(id);
      return 'nmm_test_token';
    });
    expect(result.errors).toEqual([]);
    expect(minted).toEqual(['runner0']);
    const secretIdx = calls.applied.findIndex((o) => o.kind === 'Secret');
    const stsIdx = calls.applied.findIndex((o) => o.kind === 'StatefulSet');
    expect(secretIdx).toBeGreaterThanOrEqual(0);
    expect(secretIdx).toBeLessThan(stsIdx);
    const secret = calls.applied[secretIdx] as KubeObject & { data: { token: string } };
    expect(secret.metadata.name).toBe('machine-runner0-token');
    expect(secret.metadata.labels?.['neuramesh.io/machine']).toBe('runner0');
    expect(Buffer.from(secret.data.token, 'base64').toString('utf8')).toBe('nmm_test_token');
  });

  it('adopts an existing secret with labels only — never touching its data', async () => {
    const { kube, calls } = fakeKube({ secretGetStatus: 200, secretBody: { data: { token: 'aGFuZA==' } } });
    const result = await reconcile(kube, desired, env, templates, async () => {
      throw new Error('minter must not run for an existing secret');
    });
    expect(result.errors).toEqual([]);
    const secret = calls.applied.find((o) => o.kind === 'Secret') as KubeObject & { data?: unknown };
    expect(secret.metadata.labels?.['neuramesh.io/managed']).toBe('true');
    expect(secret.data).toBeUndefined();
  });

  it('file mode (no minter) skips a missing secret instead of failing the tick', async () => {
    const { kube, calls } = fakeKube({ secretGetStatus: 404 });
    const result = await reconcile(kube, desired, env, templates);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(calls.applied.some((o) => o.kind === 'Secret')).toBe(false);
    // the workload still lands — machined refuses loudly on the missing token, kubelet retries
    expect(calls.applied.some((o) => o.kind === 'StatefulSet')).toBe(true);
  });

  it('a minter failure surfaces as an action error, not a crashed tick', async () => {
    const { kube, calls } = fakeKube({ secretGetStatus: 404 });
    const result = await reconcile(kube, desired, env, templates, async () => {
      throw new Error('control-api unreachable');
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toContain('control-api unreachable');
    expect(calls.applied.some((o) => o.kind === 'StatefulSet')).toBe(true);
  });
});
