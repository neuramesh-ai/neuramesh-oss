// Whether the agent runtimes run in the Cloud Run agent box, and the handles the spawn sites need
// when they do (README.md, "Agent runtimes in the box"). Set once by `startBoxRuntimes`
// (runtime-start.ts) after the box is up; null everywhere else (a laptop, a GKE pod, a Cloud Run
// machine with NM_BOX_RUNTIMES=off), and then every reader below is a no-op.
//
// Deliberately import-free: runtime/adapter.ts, runtime/cli.ts and runtime/orchmcp.ts read it, and
// the desktop app loads those, so it must not pull the box, the relay or node:child_process along.

/** the CLIs a relay wrapper stands in for */
export type BoxTarget = 'claude' | 'codex' | 'agy';
export const BOX_TARGETS: readonly BoxTarget[] = ['claude', 'codex', 'agy'];

/** the e2e witness's shell (e2e-boxcli.ts): a relay target only when NM_E2E_BOXCLI=1 */
export const E2E_SHELL_TARGET = 'nm-e2e-sh';

/** the env name the relay ticket rides to the wrapper (host side only: it never enters the box) */
export const RELAY_TICKET_ENV = 'NM_BOX_RELAY_TICKET';
/** the env name the per-box bus bearer has inside the box (delivered through secretEnv) */
export const BOX_BEARER_ENV = 'NM_BOX_BEARER';

export interface BoxRuntimeHooks {
  /** the host path of the relay wrapper an SDK spawns in place of the CLI */
  wrapper(target: BoxTarget): string;
  /** a fresh relay ticket for one spawn env: `{ NM_BOX_RELAY_TICKET }` */
  relayEnv(): Record<string, string>;
  /** the per-box bearer the bus listener on the host veth IP demands; null when the bus is not exposed */
  bearer: string | null;
  /** the e2e shell's wrapper (NM_E2E_BOXCLI=1 only), else null */
  e2eShell?: string | null;
}

let hooks: BoxRuntimeHooks | null = null;

export function setBoxRuntime(h: BoxRuntimeHooks | null): void { hooks = h; }
export function boxRuntime(): BoxRuntimeHooks | null { return hooks; }
export function boxRuntimesActive(): boolean { return hooks !== null; }

/** the relay ticket for a spawn env, or nothing when the runtimes run here */
export function boxRelayEnv(): Record<string, string> { return hooks ? hooks.relayEnv() : {}; }
