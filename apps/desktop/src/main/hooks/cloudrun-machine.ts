// What machined uses of a Cloud Run machine (cloudrun/machine.ts). Types only, and public: machined
// takes the module from the private entry (private.ts), which the public tree replaces with a stub
// that has no module (docs/design/oss-private-seam-2026-11/plan.md). Unset NM_SUBSTRATE never reads it.
import type { MachinedConfig, CloudRunConfig } from '../machined-config';
import type { Chromium, LaunchOpts } from '../browser/chromium';
import type { EgressProxy } from '../browser/egress-proxy';
import type { TerminalHost } from '../relay/machine-edge';
import type { FetchedBundle } from '../relay/engineering-workspace';
import type { EngineeringMachineHost } from '../relay/engineering-host';

/** the daemon's own stop points, which the drain calls in order before its snapshot */
export interface CloudRunDrainHooks {
  holdTurns(): void;
  turnsInFlight(): number;
  /** the approval parks begin their drain first, then this */
  parkTurns(): Promise<void>;
  /** the shared facts flush after this */
  flushBrains(): Promise<void>;
  drainWrites(timeoutMs: number): Promise<void>;
}

/** the box's browser launcher, spread into createBrowserService */
export interface CloudRunBrowserLaunch {
  launch: (o: LaunchOpts) => Promise<Chromium>;
  proxy?: () => Promise<EgressProxy>;
}

export interface CloudRunMachine {
  /** renew the epoch token now (the replica feed calls it after a 401) */
  refreshToken(): Promise<unknown>;
  /** a park about to expire is work for the meter */
  parksBusy(): boolean;
  /** why the agent box is down, or null while it is up */
  boxDown(): string | null;
  /** a repository bundle (control-api repo-bundles.ts), fetched through the snapshot store */
  bundle(key: string): Promise<FetchedBundle>;
  /** the browser in the agent box, or null while the box is down */
  boxBrowser(o: { keepPersonProfiles: boolean; log: (line: string) => void }): CloudRunBrowserLaunch | null;
  /** the browser terminals in the agent box */
  terminals(log: (line: string) => void): TerminalHost;
  setInteractiveReady(ready: boolean): Promise<void>;
  /** the Code host exists: a Code park the boot claim took can resume now */
  engineeringReady(): void;
  /** attach the drain and start the lifecycle */
  attachDrain(hooks: CloudRunDrainHooks): void;
  /** SIGTERM: a short flush, no snapshot, then the token renewal stops */
  finalFlush(): Promise<void>;
  /** after the browser closes: the box link stops */
  close(): Promise<void>;
}

/** a boot that holds its grant and starts the machine once the config is read */
export interface CloudRunBoot {
  start(o: { cfg: MachinedConfig; engineeringHost: () => EngineeringMachineHost | null }): Promise<CloudRunMachine>;
}

export interface CloudRunModule {
  /** the boot call (D12). A held boot never returns, and it exits on SIGTERM */
  boot(env: NodeJS.ProcessEnv, cloudrun: CloudRunConfig): Promise<CloudRunBoot>;
}
