import { decideThreadPermission, isPermissionMode, type PermissionActionKind, type PermissionMode, type PolicyAction, type PolicyRule, type ModeDecision } from '@neuramesh/shared';
import { houseActionReviewer, type ActionReviewer } from './permission-review';

export interface ThreadPermissionGate {
  decide(kind: PermissionActionKind, actions: readonly PolicyAction[], rules: readonly PolicyRule[]): Promise<ModeDecision | null>;
}

/** Read server authority at the tool boundary. Null from a successful read is
 * reserved for a pre-migration coding session with its recorded custom controls. */
export function makeThreadPermissionGate(read: () => Promise<PermissionMode | null>, review: ActionReviewer): ThreadPermissionGate {
  return { async decide(kind, actions, rules) {
    try {
      const mode = await read();
      if (mode === null) return null;
      const decision = decideThreadPermission(mode, kind, actions, rules);
      if (decision.verdict !== 'review') return decision;
      const reviewed = await review(actions);
      if (reviewed.verdict === 'allow' && await read() !== mode) return { verdict: 'ask', reason: 'The permission mode changed during review.' };
      return reviewed;
    } catch {
      return { verdict: 'deny', reason: 'The machine could not confirm the thread permissions. Retry after reconnecting.' };
    }
  } };
}

export function remoteThreadPermissionGate(o: { apiUrl: string; workspace: string; actorId: string; threadId?: string; taskId?:string; runId?: string; headers: () => Promise<Record<string,string>>; fetchImpl?: typeof fetch }) {
  const url = new URL('/v1/permissions', o.apiUrl);
  url.searchParams.set('workspace', o.workspace);
  if (o.threadId) url.searchParams.set('threadId', o.threadId);
  if (o.taskId) url.searchParams.set('taskId', o.taskId);
  if (o.runId) url.searchParams.set('runId', o.runId);
  return makeThreadPermissionGate(async () => {
    const response = await (o.fetchImpl ?? fetch)(url, { headers: await o.headers(), cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Permission selection unavailable');
    const data = await response.json();
    if (!isPermissionMode(data.workspaceMode) || !(data.threadMode === null || isPermissionMode(data.threadMode)) || typeof data.legacyControls !== 'boolean') throw new Error('Unknown permission selection');
    if (data.scheduled === true) return 'turbo';
    return data.legacyControls && !data.threadMode ? null : data.threadMode ?? data.workspaceMode;
  }, houseActionReviewer(o));
}
