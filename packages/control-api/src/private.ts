// The public face of the control-api's private entry (docs/43 §2, scripts/public-tree.sh PUBLIC_STUBS).
// This build has no Cloud Run machine lane: the routes are absent, the hooks do nothing, and the
// sweeps never call the passes, because cloudRunOn() is false. Same names, same types as the entry.
import type { Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import type { SqlFragment } from './fleet-idle';
import type { Store } from './store';

type Routes = <E extends Env>(_app: Hono<E>, _store: Store, _deps?: unknown) => void;
type HumanRoutes = <E extends Env & { Variables: { actor: Actor } }>(_app: Hono<E>, _store: Store, _deps?: unknown) => void;
const none = (): void => {};
const off = (): never => { throw new Error('This build has no Cloud Run machine lane'); };

export type SizeClass = 'S' | 'M' | 'L' | 'XL';
export interface CloudRunSweepResult { capDrains: string[]; idleDrains: string[]; lost: string[]; rolled: string[]; rewoken: string[]; speculative?: string[] }
export interface RetentionResult { machines: number; deleted: number; kept: number; truncated: boolean; errors: string[] }
export interface DepcacheResult { listed: number; deleted: number; truncated: boolean; wrapped: boolean; errors: string[] }
export interface SnapshotStorage {
  bucket: string;
  stat(object: string): Promise<{ size: number } | null>;
}

export const cloudRunOn = (): boolean => false;
export const cloudRunRoutes: Routes = none;
/** a no-op SET: no breaker trips without the lane */
export const clearBreakerOnHumanWake = (sql: postgres.Sql, _go: () => SqlFragment) => sql`boot_loop_at = m.boot_loop_at`;
export const cloudRunSweep = async (_sql: postgres.Sql, _idleMin: number): Promise<CloudRunSweepResult> => off();
export const depcachePass = async (_storage?: SnapshotStorage | null): Promise<DepcacheResult | null> => off();
export const snapshotRetentionPass = async (_sql: postgres.Sql, _storage?: SnapshotStorage | null): Promise<RetentionResult | null> => off();
export const configuredSnapshotStorage = (): SnapshotStorage | null => null;
export const alwaysOnRoutes: HumanRoutes = none;
export const prewakeRoutes: HumanRoutes = none;
export const fireWakeWait = (_store: Store, _runId: string): void => {};
export const fireParkReplies = (_store: Store, _workspaceId: string, _where: { taskId: string | null; threadId: string | null }, _body: string, _actor: { kind: string; id: string }): void => {};
export const settleParksForDecision = async (_store: Store, _decisionId: string, _answer: string | null, _actor: { kind: string; id: string }): Promise<void> => {};
export const machineParkRoutes: Routes = none;
export const parkHumanRoutes: HumanRoutes = none;
export const machineFactRoutes: Routes = none;
export const machineSnapshotRoutes: Routes = none;
export const machineVaultRoutes: Routes = none;

export const BUNDLE_URL_PREFIX = 'nm-bundle:';
export const repoBundlesOn = (_env?: NodeJS.ProcessEnv): boolean => false;
export const repoBundleRoutes: HumanRoutes = none;
export const repoBundleStorage = (): SnapshotStorage | null => null;
export function bundleKeyOf(url: string | null | undefined): string | null {
  return /^nm-bundle:([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/.exec(url ?? '')?.[1] ?? null;
}
export const bundleObject = (workspaceId: string, key: string): string => `v1/workspaces/${workspaceId}/repos/${key}.bundle`;
export async function memberOf(store: Store, actor: Actor, workspace: string): Promise<boolean> {
  if (actor.kind === 'human') return (await store.humanMemberIds(workspace)).includes(actor.id);
  if (actor.kind === 'agent') return (await store.agentWorkspace(actor.id)) === workspace;
  return false;
}

export const e2eRoutesOn = (): boolean => false;
export const e2eRoutes: Routes = none;
export const e2eMachineDoors: Routes = none;
