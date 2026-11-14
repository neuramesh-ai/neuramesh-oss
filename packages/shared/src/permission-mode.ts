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

// Exact host-registered NeuraMesh operations that stay inside the workspace. External
// MCPs keep their qualified names. Shell, browser, release and connector operations
// have their own effects and must pass their normal permission checks.
const workspaceTools = new Set([
  'list_workspace', 'read_workspace_file', 'list_projects', 'list_agents', 'list_team',
  'read_agent_thread', 'message_agent', 'recall', 'load_skill', 'list_playbooks',
  'list_tasks', 'list_backlog', 'read_coding_tasks', 'task_status',
  'list_library', 'read_library_doc', 'list_repos', 'list_repo_files', 'list_repo_changes', 'read_repo_file',
  'list_whiteboards', 'read_whiteboard', 'create_whiteboard', 'update_whiteboard',
  'read_drafts', 'draft_article', 'draft_posts', 'draft_replies', 'revise_posts', 'revise_replies',
  'propose_angles', 'propose_design_round', 'propose_library_doc', 'propose_impl_plan',
  'request_design', 'request_plan', 'request_changes', 'request_verdict', 'revise_design',
  'revise_plan', 'revise_ship_plan', 'set_thread_title', 'post_thread', 'share_images',
  'add_backlog_item', 'update_backlog_item', 'promote_backlog_item', 'add_subtask',
  'create_project', 'create_agent', 'add_agent_to_channel', 'create_task', 'create_coding_task',
  'open_code_session', 'offer_task', 'take_task', 'propose_routine', 'offer_routine_session',
  'run_playbook', 'start_deep_work', 'generate_image', 'shelve_repo_screenshot',
  // These tools only draft a schedule confirmation card. A human confirms the external operation.
  'schedule_posts', 'unschedule_posts',
  // Message boards: a person gave this agent access to the board, and the service checks Read or Post on each call.
  'message_board_list', 'message_board_catch_up', 'message_board_send', 'message_board_take_handoff',
]);

/** Privileged release endpoints additionally enforce their signed workflow approval.
 * These shortcuts must not let a tool or a Turbo schedule skip it. */
export function needsReleaseApproval(action: PolicyAction): boolean {
  if (action.capability === 'tool.mcp') {
    const tool = action.tool ?? '';
    // An arbitrary webpage can publish on a click or a form submission. The
    // browser cannot attest the effect, so a human authorizes these interactions.
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
    if (needsReleaseApproval(action)) requiresHuman = 'A human must approve this release action.';
    // Check all applicable restrictions. A generic baseline allow can precede a
    // more specific, administrator-authored protected path at the same scope.
    for (const rule of rules) {
      if (rule.capability !== action.capability || (!rule.locked && rule.id.startsWith('base.')) || !matchesSelector(action, rule.selector)) continue;
      if (rule.verdict === 'deny') return { verdict: 'deny', reason: rule.rationale || 'Blocked by workspace policy.' };
      if (rule.verdict === 'ask') requiresHuman = rule.rationale || 'A workspace rule requires approval.';
    }
  }
  if (requiresHuman) return { verdict: 'ask', reason: requiresHuman };
  if (actions.every(action => action.capability === 'tool.mcp' && workspaceTools.has(action.tool ?? ''))) {
    return { verdict: 'allow', reason: 'NeuraMesh workspace tool' };
  }
  if (mode === 'turbo' || kind === 'read' || (kind === 'edit' && mode !== 'request-review')) {
    return { verdict: 'allow', reason: PERMISSION_MODE_COPY[mode].label };
  }
  return mode === 'auto-review'
    ? { verdict: 'review', reason: 'Independent action review' }
    : { verdict: 'ask', reason: `${PERMISSION_MODE_COPY[mode].label} requires approval for this action.` };
}
