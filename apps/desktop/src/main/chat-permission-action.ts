import type { PermissionActionKind, PolicyAction } from '@neuramesh/shared';
import { toolCallToAction } from './policygate';

// Named house tools still authorize their project, files and connector at execution.
// This table only identifies reads and draft edits. New tools ask until classified.
const reads = new Set(['list_team','read_agent_thread','read_coding_tasks','recall','load_skill','list_playbooks','list_library','read_library_doc','list_repos','list_repo_files','read_repo_file','list_repo_changes','list_whiteboards','read_whiteboard','list_tasks','list_backlog','task_status']);
const edits = new Set(['create_whiteboard','update_whiteboard','draft_article']);

export function chatPermissionAction(name: string, input: Record<string, unknown>): { kind: PermissionActionKind; actions: PolicyAction[] } | null {
  if (name === 'mcp__nm__run_command') name = 'Bash';
  if (['TodoWrite','ToolSearch','mcp__nm__declare_beats','mcp__nm__advance_beat'].includes(name)) return null;
  if (name.startsWith('mcp__nm__')) {
    const tool = name.slice('mcp__nm__'.length);
    return { kind: reads.has(tool) ? 'read' : edits.has(tool) ? 'edit' : 'mcp', actions: [{ capability: 'tool.mcp', tool }] };
  }
  if (name === 'WebSearch') return { kind: 'web', actions: [{ capability: 'net.egress' }] };
  const action = toolCallToAction(name, input);
  if (!action) return { kind: 'mcp', actions: [] };
  const kind = name === 'Bash' ? 'command' : action.capability === 'fs.read' ? 'read'
    : action.capability === 'fs.write' ? 'edit' : action.capability === 'net.egress' ? 'web' : 'mcp';
  return { kind, actions: [action] };
}

/** NeuraMesh dispatches its own MCP handlers through the host gate. Native SDK
 * tools and other connected servers must pass that same check before execution. */
export function nativePermissionHooks(check: import('./runtime/adapter').PermissionGate) {
  return { PreToolUse: [{
    timeout: 900,
    hooks: [async (input: { hook_event_name?: string; tool_name?: string; tool_input?: unknown }) => {
      if (input.hook_event_name !== 'PreToolUse') return {};
      const name = input.tool_name ?? '';
      if (name.startsWith('mcp__nm__')) return {};
      const result = await check(name, (input.tool_input ?? {}) as Record<string, unknown>);
      return { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: result.decision, permissionDecisionReason: result.reason } };
    }],
  }] };
}
