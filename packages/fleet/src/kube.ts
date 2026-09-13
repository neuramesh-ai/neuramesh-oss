// a deliberately small kubernetes client: kubeconfig/in-cluster auth + server-side apply
// + the four verbs the reconciler needs. built from scratch because the surface is tiny —
// SSA is just a PATCH with content-type application/apply-patch+yaml — and a full client
// library brings API-churn we don't need for a CRD-less controller. revisit if this ever
// grows watches or exotic resources.

import { dump, load } from 'js-yaml';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { KubeObject } from './types.js';

const FIELD_MANAGER = 'nm-fleet';

// apiVersion+kind → url path pieces. only what the fleet stamps; extend deliberately.
const RESOURCES: Record<string, { plural: string; namespaced: boolean }> = {
  'v1/Namespace': { plural: 'namespaces', namespaced: false },
  'v1/Secret': { plural: 'secrets', namespaced: true },
  'v1/PersistentVolumeClaim': { plural: 'persistentvolumeclaims', namespaced: true },
  'v1/ResourceQuota': { plural: 'resourcequotas', namespaced: true },
  'v1/LimitRange': { plural: 'limitranges', namespaced: true },
  'v1/Service': { plural: 'services', namespaced: true },
  'v1/ServiceAccount': { plural: 'serviceaccounts', namespaced: true },
  'apps/v1/StatefulSet': { plural: 'statefulsets', namespaced: true },
  'apps/v1/Deployment': { plural: 'deployments', namespaced: true },
  'networking.k8s.io/v1/NetworkPolicy': { plural: 'networkpolicies', namespaced: true },
};

export interface KubeAuth {
  server: string;
  ca?: Buffer;
  cert?: Buffer;
  key?: Buffer;
  token?: string;
  insecureSkipTlsVerify?: boolean;
  /** kubeconfig exec credential plugin (how GKE mints tokens — gke-gcloud-auth-plugin) */
  exec?: ExecCredentialConfig;
}

export interface ExecCredentialConfig {
  command: string;
  args?: string[];
  env?: { name: string; value: string }[];
}

interface KubeconfigYaml {
  'current-context': string;
  contexts: { name: string; context: { cluster: string; user: string } }[];
  clusters: { name: string; cluster: Record<string, string | boolean> }[];
  users: { name: string; user: Record<string, unknown> }[];
}

const b64 = (v: string | undefined) => (v ? Buffer.from(v, 'base64') : undefined);

/** in-cluster when the serviceaccount env is present, else kubeconfig (KUBECONFIG or ~/.kube/config) */
export function loadAuth(): KubeAuth {
  if (process.env['KUBERNETES_SERVICE_HOST']) {
    const dir = '/var/run/secrets/kubernetes.io/serviceaccount';
    return {
      server: `https://${process.env['KUBERNETES_SERVICE_HOST']}:${process.env['KUBERNETES_SERVICE_PORT'] ?? '443'}`,
      ca: readFileSync(join(dir, 'ca.crt')),
      token: readFileSync(join(dir, 'token'), 'utf8').trim(),
    };
  }
  const path = process.env['KUBECONFIG'] ?? join(homedir(), '.kube', 'config');
  const kc = load(readFileSync(path, 'utf8')) as KubeconfigYaml;
  const ctxName = process.env['FLEET_KUBE_CONTEXT'] ?? kc['current-context'];
  const ctx = kc.contexts.find((c) => c.name === ctxName)?.context;
  if (!ctx) throw new Error(`kube context ${ctxName} not found in ${path}`);
  const cluster = kc.clusters.find((c) => c.name === ctx.cluster)?.cluster;
  const user = kc.users.find((u) => u.name === ctx.user)?.user;
  if (!cluster || !user) throw new Error(`kube context ${ctxName} is incomplete`);
  return {
    server: String(cluster['server']),
    ca: b64(cluster['certificate-authority-data'] as string | undefined),
    insecureSkipTlsVerify: cluster['insecure-skip-tls-verify'] === true,
    cert: b64(user['client-certificate-data'] as string | undefined),
    key: b64(user['client-key-data'] as string | undefined),
    token: user['token'] as string | undefined,
    exec: user['exec'] as ExecCredentialConfig | undefined,
  };
}

export interface KubeResponse {
  status: number;
  body: unknown;
}

export class Kube {
  private execToken?: { token: string; expiresAt: number };

  constructor(private readonly auth: KubeAuth) {}

  /** static token, or one minted by the kubeconfig exec plugin (cached until ~expiry) */
  private bearerToken(): string | undefined {
    if (this.auth.token) return this.auth.token;
    const exec = this.auth.exec;
    if (!exec) return undefined;
    if (this.execToken && Date.now() < this.execToken.expiresAt - 60_000) return this.execToken.token;
    const env = { ...process.env };
    for (const e of exec.env ?? []) env[e.name] = e.value;
    const out = execFileSync(exec.command, exec.args ?? [], { env, encoding: 'utf8' });
    const cred = JSON.parse(out) as { status?: { token?: string; expirationTimestamp?: string } };
    const token = cred.status?.token;
    if (!token) throw new Error(`exec credential plugin ${exec.command} returned no token`);
    const exp = cred.status?.expirationTimestamp ? Date.parse(cred.status.expirationTimestamp) : Date.now() + 5 * 60_000;
    this.execToken = { token, expiresAt: exp };
    return token;
  }

  private raw(method: string, path: string, body?: string, contentType?: string): Promise<KubeResponse> {
    const url = new URL(this.auth.server + path);
    const options: RequestOptions = {
      method,
      host: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      ca: this.auth.ca,
      cert: this.auth.cert,
      key: this.auth.key,
      rejectUnauthorized: !this.auth.insecureSkipTlsVerify,
      headers: {
        accept: 'application/json',
        ...(() => {
          const token = this.bearerToken();
          return token ? { authorization: `Bearer ${token}` } : {};
        })(),
        ...(body ? { 'content-type': contentType ?? 'application/json' } : {}),
      },
    };
    return new Promise((resolve, reject) => {
      const req = httpsRequest(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed: unknown = undefined;
          try {
            parsed = data ? JSON.parse(data) : undefined;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  private pathFor(apiVersion: string, kind: string, namespace: string | undefined, name?: string): string {
    const meta = RESOURCES[`${apiVersion}/${kind}`];
    if (!meta) throw new Error(`unmapped resource ${apiVersion}/${kind}`);
    const prefix = apiVersion === 'v1' ? '/api/v1' : `/apis/${apiVersion}`;
    const nsPart = meta.namespaced ? `/namespaces/${namespace}` : '';
    if (meta.namespaced && !namespace) throw new Error(`${kind} ${name ?? ''} needs a namespace`);
    return `${prefix}${nsPart}/${meta.plural}${name ? `/${name}` : ''}`;
  }

  /** server-side apply: full desired object in, converged object out. idempotent. */
  async apply(obj: KubeObject): Promise<KubeResponse> {
    const path =
      this.pathFor(obj.apiVersion, obj.kind, obj.metadata.namespace, obj.metadata.name) +
      `?fieldManager=${FIELD_MANAGER}&force=true`;
    return this.raw('PATCH', path, dump(obj), 'application/apply-patch+yaml');
  }

  async delete(apiVersion: string, kind: string, namespace: string | undefined, name: string): Promise<KubeResponse> {
    return this.raw('DELETE', this.pathFor(apiVersion, kind, namespace, name));
  }

  async get(apiVersion: string, kind: string, namespace: string | undefined, name: string): Promise<KubeResponse> {
    return this.raw('GET', this.pathFor(apiVersion, kind, namespace, name));
  }

  async list(apiVersion: string, kind: string, labelSelector: string, namespace?: string): Promise<KubeObject[]> {
    const meta = RESOURCES[`${apiVersion}/${kind}`];
    if (!meta) throw new Error(`unmapped resource ${apiVersion}/${kind}`);
    const prefix = apiVersion === 'v1' ? '/api/v1' : `/apis/${apiVersion}`;
    const nsPart = meta.namespaced && namespace ? `/namespaces/${namespace}` : '';
    const res = await this.raw(
      'GET',
      `${prefix}${nsPart}/${meta.plural}?labelSelector=${encodeURIComponent(labelSelector)}`,
    );
    if (res.status !== 200) throw new Error(`list ${kind} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return ((res.body as { items?: KubeObject[] }).items ?? []).map((item) => ({
      ...item,
      apiVersion,
      kind,
    }));
  }
}
