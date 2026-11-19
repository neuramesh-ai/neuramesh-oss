import { evaluatePolicy, matchesSelector, type PolicyAction, type PolicyRule } from './policy';

export const PERMISSION_MODES = ['request-review', 'default', 'auto-review', 'turbo'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export const PERMISSION_MODE_COPY: Record<PermissionMode, { label: string; description: string }> = {
  'request-review': { label: 'Request Review', description: 'Read files. Ask before edits, commands and connections.' },
  default: { label: 'Default', description: 'Read and edit files. Ask before commands and connections.' },
  'auto-review': { label: 'Auto Review', description: 'A separate AI reviewer checks actions that would ask. Uses workspace credits.' },
  turbo: { label: 'Turbo', description: 'Run permitted tools without asking.' },
};

export function isPermissionMode(value: unknown): value is PermissionMode {
  return PERMISSION_MODES.some(mode => mode === value);
}

export interface PermissionSelection {
  workspaceMode: PermissionMode;
  threadMode: PermissionMode | null;
  legacyControls: boolean;
  /** False during a mixed fleet rollout, or while there is no connected host. */
  runtimeReady?: boolean;
  scheduled?: boolean;
}

export type ModeDecision = { verdict: 'allow' | 'ask' | 'deny' | 'review'; reason: string };
export type PermissionActionKind = 'read' | 'edit' | 'command' | 'web' | 'mcp';

// NeuraMesh's own tools are safe (George, 2026-11-18): no prompt in the chat. The host
// strips the nm server prefix, so they reach the gate by their bare registry name, and
// every other server's tool keeps its qualified `server__tool` name. A new nm tool is
// safe by construction. Safe is not a bypass: the server still enforces its human-only
// commands, a release action below follows the mode, and a person's ask or deny rule wins.
export function isNeuraMeshTool(tool: string | undefined): boolean {
  return !!tool && /^[a-z][a-z0-9_]*$/.test(tool) && !tool.includes('__');
}

/** A release action follows the permission mode like a command or a connector write
 * (George, 2026-11-18): Request Review and Default ask, Auto Review goes to the reviewer,
 * Turbo (and so a scheduled run) allows. It never takes the safe NeuraMesh tool, read or
 * edit shortcut. The server still enforces its human-only commands, accept_task's human
 * word and the signed release approvals on its privileged endpoints. */
export function isReleaseAction(action: PolicyAction): boolean {
  if (action.capability === 'tool.mcp') {
    const tool = action.tool ?? '';
    // An arbitrary webpage can publish on a click or a form submission, and the
    // browser cannot attest the effect.
    if (['web_click', 'web_type', 'accept_task'].includes(tool)) return true;
    if (/(?:^|[._-])(?:publish|deploy|merge|execute_ship|approve_ship_plan)(?:$|[._-])/i.test(tool)) return true;
    // External servers can name a publishing action "create" or "call". Only
    // trusted read verbs have a known effect here. Ask before an opaque write.
    return tool.includes('__') && !/^(?:get|read|list|search|lookup|fetch)(?:_|$)/.test(tool.split('__').at(-1) ?? '');
  }
  if (action.capability !== 'shell.exec') return false;
  return /\b(?:gh\s+pr\s+merge|glab\s+mr\s+merge|(?:npm|pnpm|yarn|cargo)\s+publish|(?:fly|flyctl|wrangler|firebase)\s+deploy|vercel\s+(?:deploy|--prod)|kubectl\s+(?:apply|set|rollout)|helm\s+(?:install|upgrade))\b/i.test(action.command ?? '');
}

/** Evaluate the actual host actions, before executing any part of a composite tool. */
export function decideThreadPermission(mode: PermissionMode, kind: PermissionActionKind, actions: readonly PolicyAction[], rules: readonly PolicyRule[]): ModeDecision {
  if (!actions.length) return { verdict: 'deny', reason: 'This tool has no recognized action.' };
  let requiresHuman: string | undefined;
  for (const action of actions) {
    const base = evaluatePolicy(action, rules);
    if (base.verdict === 'deny') return { verdict: 'deny', reason: base.rationale };
    // Check all applicable restrictions. A generic baseline allow can precede a
    // more specific, administrator-authored protected path at the same scope.
    for (const rule of rules) {
      if (rule.capability !== action.capability || (!rule.locked && rule.id.startsWith('base.')) || !matchesSelector(action, rule.selector)) continue;
      if (rule.verdict === 'deny') return { verdict: 'deny', reason: rule.rationale || 'Blocked by workspace policy.' };
      if (rule.verdict === 'ask') requiresHuman = rule.rationale || 'A workspace rule requires approval.';
    }
  }
  if (requiresHuman) return { verdict: 'ask', reason: requiresHuman };
  const release = actions.some(isReleaseAction);
  if (!release && actions.every(action => action.capability === 'tool.mcp' && isNeuraMeshTool(action.tool))) {
    return { verdict: 'allow', reason: 'NeuraMesh tool' };
  }
  if (mode === 'turbo' || (!release && (kind === 'read' || (kind === 'edit' && mode !== 'request-review')))) {
    return { verdict: 'allow', reason: PERMISSION_MODE_COPY[mode].label };
  }
  return mode === 'auto-review'
    ? { verdict: 'review', reason: 'Independent action review' }
    : { verdict: 'ask', reason: `${PERMISSION_MODE_COPY[mode].label} requires approval for this action.` };
}
