// The public face of the control-api's private entry (docs/43 §2, scripts/public-tree.sh PUBLIC_STUBS).
// This build has no Cloud Run machine lane: the routes are absent, the hooks do nothing, and the
// sweeps never call the passes, because cloudRunOn() is false. Same names, same types as the entry.
import type { Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import type { Command } from './commands';
import { DomainError } from './errors';
import type { SqlFragment } from './fleet-idle';
import type { Store } from './store';

type Routes = <E extends Env>(_app: Hono<E>, _store: Store, _deps?: unknown) => void;
type HumanRoutes = <E extends Env & { Variables: { actor: Actor } }>(_app: Hono<E>, _store: Store, _deps?: unknown) => void;
const none = (): void => {};
const off = (): never => { throw new Error('This build has no Cloud Run machine lane'); };

export type SizeClass = 'S' | 'M' | 'L' | 'XL';
export interface CloudRunSweepResult { capDrains: string[]; idleDrains: string[]; lost: string[]; rolled: string[]; rewoken: string[]; speculative?: string[]; upgrades?: { rolledBack: string[]; timedOut: string[]; staged: string[]; forced: string[] } | { error: string } }
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
// a person's Gmail and Calendar link (Inbox) is hosted only: this build serves no /v1/inbox route
export const googleConnectRoutes: Routes = none;
export const inboxLinkRoutes: HumanRoutes = none;
export const gmailLinked = async (_store: Store, _workspace: string, _user: string): Promise<boolean> => false;
// published files on neuramesh.page are hosted only: this build serves no /v1/publish route
export const publishRoutes: HumanRoutes = none;
// the Postiz connector is hosted only: this build serves no /v1/postiz route
export const postizRoutes: HumanRoutes = none;
// a post never goes out through Postiz here: no route is set, so each content hook has nothing to do
export interface PostizFollowResult { checked: number; published: number; failed: number; removed: number; moved: number }
export const postizApprove = async (_store: Store, _itemId: string, _explicitAt: string | undefined, _fallbackAt: string): Promise<{ postId: string; created: boolean } | null> => null;
export const postizUndo = async (_store: Store, _itemId: string, _postId: string): Promise<void> => {};
export const postizRelease = async (_store: Store, _itemId: string, _opts?: { scheduledOnly?: boolean }): Promise<void> => {};
export const postizBeforeUpdate = async (_store: Store, _itemId: string, _body: string, _mediaUrl: string | null | undefined): Promise<void> => {};
export const postizFollow = async (_store: Store): Promise<PostizFollowResult> => ({ checked: 0, published: 0, failed: 0, removed: 0, moved: 0 });
export const postizDraftRoute = async (_store: Store, draft: { channel: string; platform: string; body: string; postizChannel?: string; postizSettings?: Record<string, unknown> }): Promise<{ channel: string; settings: Record<string, unknown> | null } | null> => {
  if (draft.postizChannel || draft.platform === 'postiz') throw new DomainError('NOT_FOUND', 'This build has no Postiz');
  return null;
};
export const postizSetRoute = async (_store: Store, _actor: Actor, _cmd: { item: string; postizChannel: string | null; postizSettings?: Record<string, unknown> }): Promise<{ ok: true; itemId: string }> => {
  throw new DomainError('NOT_FOUND', 'This build has no Postiz');
};

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

/** machine releases and upgrades ride the Cloud Run lane: none here, and the card's commands say so */
export const machineReleasesOn = (): boolean => false;
export const releaseForNewMachine = async (_sql: postgres.Sql): Promise<string | null> => null;
export const releaseCanaryMachine = async (_sql: postgres.Sql): Promise<string | null> => null;
export const machineReleaseRoutes: HumanRoutes = none;
/** the ops page (NM_OPS_USER_IDS) is hosted only: nobody is staff here, so /v1/me never says ops */
export const opsUser = (_userId: string | null | undefined, _env?: NodeJS.ProcessEnv): boolean => false;
/** the site's public list of cloud machine releases: this build serves no /v1/public/machine-releases */
export const machineReleasePublicRoutes = <E extends Env>(_app: Hono<E>, _store: Store, _origin: (o: string) => string | null): void => {};
export const machineUpgradeCommands = async (_store: Store, _actor: Actor, cmd: Command): Promise<object | undefined> => {
  if (cmd.type === 'machine.upgrade' || cmd.type === 'machine.upgrade_cancel' || cmd.type === 'machine.upgrade_rollback' || cmd.type === 'whats_new.mark') {
    throw new DomainError('NOT_FOUND', 'This build has no cloud machine upgrades');
  }
  return undefined;
};
