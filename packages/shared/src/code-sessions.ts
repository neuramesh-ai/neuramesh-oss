// Code sessions as synced rows (0135, the mobile-cloud round, plan D8). The vocabulary every
// writer and reader of `code_sessions` shares: the state names are the renderer's
// EngineeringTurnState, so a row's `state` and a live session's `state` are one word.
export const CODE_SESSION_STATES = ['idle', 'streaming', 'awaiting_approval', 'resumable', 'completed', 'error'] as const;
export type CodeSessionState = (typeof CODE_SESSION_STATES)[number];
export const CODE_SESSION_MODES = ['plan', 'act'] as const;
export type CodeSessionMode = (typeof CODE_SESSION_MODES)[number];
/** the approval categories the runtime gates on (engineering-protocol's EngineeringPermissionCategory) */
export const CODE_APPROVAL_CATEGORIES = ['read', 'edit', 'command', 'web', 'mcp'] as const;
export type CodeApprovalCategory = (typeof CODE_APPROVAL_CATEGORIES)[number];

/** how a session's row ends when its runtime turn ends — the runtime's reason, mapped once */
export function codeSessionEndState(reason: string): CodeSessionState {
  return reason === 'completed' ? 'completed' : reason === 'error' ? 'error' : 'resumable';
}

/** the row's title: the first line of the first prompt, clipped — the desktop's own rule */
export function codeSessionTitle(prompt: string, max = 120): string {
  const line = prompt.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}
