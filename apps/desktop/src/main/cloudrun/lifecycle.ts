// Production wiring for the Cloud Run machine lifecycle.
import { BoxManager } from './box';
import { ContainerResources } from './resources';
import { apiSnapshotSigner, EpochFencedError, MachineTokenRejected, Snapshots } from './snapshot';
import { apiVaultChannel, vaultOn, VaultAgent } from './vault';
import type { CloudRunConfig } from '../machined-config';
import { CloudRunLifecycle } from './lifecycle-machine';
import type { Control, ControlChannel } from './lifecycle-contract';
export * from './lifecycle-contract';
export { CloudRunLifecycle } from './lifecycle-machine';

export function apiControlChannel(opts: { apiUrl: string; headers: () => Promise<Record<string, string>>; fetchImpl?: typeof fetch }): ControlChannel {
  const call = opts.fetchImpl ?? fetch;
  return {
    async read() {
      const res = await call(`${opts.apiUrl}/v1/machines/control`, { headers: await opts.headers(), signal: AbortSignal.timeout(10_000) });
      if (res.status === 401) throw new MachineTokenRejected('GET /v1/machines/control: the machine token was refused');
      if (!res.ok) throw new Error(`GET /v1/machines/control: HTTP ${res.status}`);
      return (await res.json()) as Control;
    },
    async report(status) {
      const res = await call(`${opts.apiUrl}/v1/machines/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await opts.headers()) },
        body: JSON.stringify(status),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401) throw new MachineTokenRejected('POST /v1/machines/status: the machine token was refused');
      if (res.status === 409) throw new EpochFencedError(`status epoch ${status.epoch} is stale`);
      if (!res.ok) throw new Error(`POST /v1/machines/status: HTTP ${res.status}`);
    },
  };
}

/** the production wiring: nm-api control and signing, the real box and the real cgroup, and the
 *  login vault when NM_VAULT=1 (nm-api refuses a machine that keeps no logins, and the agent stops) */
export function createCloudRunLifecycle(cfg: CloudRunConfig, api: { apiUrl: string; headers: () => Promise<Record<string, string>> }, o: { homeDir?: string; env?: NodeJS.ProcessEnv } = {}): CloudRunLifecycle {
  let lifecycle: CloudRunLifecycle | null = null;
  const signer = apiSnapshotSigner({ ...api, epoch: () => lifecycle?.epoch ?? 0 });
  const vault = vaultOn(o.env ?? process.env) ? new VaultAgent({
    channel: apiVaultChannel(api),
    homeDir: o.homeDir ?? '/nm/home',
    epoch: () => lifecycle?.epoch ?? 0,
    onFence: (why) => lifecycle?.fence(why),
    onRejected: (why) => void lifecycle?.tokenRejected(why),
  }) : null;
  lifecycle = new CloudRunLifecycle({
    cfg,
    control: apiControlChannel(api),
    snapshots: new Snapshots({ signer, zstdLevel: cfg.zstdLevel }),
    box: new BoxManager({ workDir: cfg.workDir, secretsDir: cfg.secretsDir }),
    resources: new ContainerResources(),
    vault,
  });
  return lifecycle;
}
