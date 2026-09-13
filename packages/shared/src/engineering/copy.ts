import { MODEL_ID_SET } from '../model-packs';
import type { EngineeringSession } from './domain';

/** The coding harness is an implementation detail. Product-owned status, error, and persisted
 * session copy crosses this boundary before it reaches the Engineering UI. Repository content,
 * diffs, user messages, and normal model responses stay exact. */
export function engineeringSystemText(value: string): string {
  return value
    .replace(/\bcline(?:[\s_-]*core)?(?=$|[^a-z0-9])/gi, 'Engineering')
    .replace(/\bEngineering\s+Engineering\b/g, 'Engineering')
    .replace(/\bRestored Engineering checkpoint\b/g, 'Restored checkpoint')
    .replace(/\bBefore first Engineering turn\b/g, 'Before first run')
    .replace(/\bBefore Engineering turn (\d+)\b/g, 'Before run $1');
}

/** Sessions survive browser reloads, including copy written by older clients. Migrate only the
 * product-owned fields so historical user and repository content is never rewritten. */
export function productizeStoredEngineeringSession(session: EngineeringSession): EngineeringSession {
  return {
    ...session,
    modelOverride: typeof session.modelOverride === 'string' && MODEL_ID_SET.has(session.modelOverride) ? session.modelOverride : null,
    brainPack: typeof session.brainPack === 'string' ? session.brainPack : null,
    activeActivity: session.activeActivity && ['thinking', 'tool', 'composing'].includes(session.activeActivity.phase)
      ? session.activeActivity
      : null,
    pendingModeHandoff: session.pendingModeHandoff
      && (session.pendingModeHandoff.category === 'edit' || session.pendingModeHandoff.category === 'command')
      ? session.pendingModeHandoff
      : null,
    messages: session.messages.map((message) => {
      const productized = message.role === 'tool' || message.tone === 'warning'
        ? { ...message, body: engineeringSystemText(message.body) }
        : message;
      return productized.role === 'reasoning'
        ? { ...productized, streaming: false, collapsed: true }
        : productized.streaming ? { ...productized, streaming: false } : productized;
    }),
    pendingApproval: session.pendingApproval ? {
      ...session.pendingApproval,
      title: engineeringSystemText(session.pendingApproval.title),
      detail: engineeringSystemText(session.pendingApproval.detail),
    } : null,
    checkpoints: session.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      label: engineeringSystemText(checkpoint.label),
    })),
    ...(session.provider ? { provider: engineeringSystemText(session.provider) } : {}),
    ...(session.model ? { model: engineeringSystemText(session.model) } : {}),
  };
}

/** Keep the browser's thread rail useful without turning localStorage into a repository cache.
 * Machine-side history and the retained worktree remain authoritative for execution details. */
export function persistableEngineeringSession(session: EngineeringSession): EngineeringSession {
  const interrupted = session.state === 'streaming' || session.state === 'awaiting_approval';
  return {
    ...session,
    state: interrupted ? 'resumable' : session.state,
    activeActivity: null,
    pendingApproval: null,
    proposedChanges: [],
    changes: [],
    checkpoints: session.checkpoints.map(({ changes: _changes, ...checkpoint }) => ({ ...checkpoint, changes: [] })),
    // Tool receipts can contain unrestricted command output. User and model-authored transcript
    // remains available for the recent-thread experience described by the product contract.
    messages: session.messages.filter((message) => message.role !== 'tool'),
  };
}

/** The workspace shell needs thread identity and one snippet, never a live transcript or editor
 * payload. Keeping this projection small prevents token streaming from fanning out through App. */
export function engineeringShellSession(session: EngineeringSession): EngineeringSession {
  const latest = session.messages.slice().reverse().find((message) => message.role !== 'tool');
  return { ...persistableEngineeringSession(session), messages: latest ? [latest] : [], checkpoints: [], workPlan: '' };
}
