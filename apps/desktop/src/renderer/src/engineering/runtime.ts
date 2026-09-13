import type {
  EngineeringMode,
  EngineeringPolicy,
  EngineeringPermissions,
  EngineeringRepo,
  EngineeringSession,
  PermissionCategory,
} from './domain';

/**
 * Browser-to-runtime boundary for Engineering OS.
 *
 * The machine relay hosts `@cline/sdk` / Cline Core and maps:
 * - `create` -> `ClineCore.start({ config: { mode }, toolPolicies })`
 * - `send` -> `ClineCore.send`
 * - Cline Core events -> `subscribe`
 * - compare/restore -> Cline checkpoint APIs
 *
 * Keeping this contract narrower than NMBridge prevents Cline's extension-specific state from
 * leaking into Neuramesh. The preview/local-web harness implements the same user-visible state
 * machine in-process. Production web uses the authenticated relay adapter and reports an honest
 * `unavailable` state when no machine or supported workspace credential is connected.
 */
export interface EngineeringRuntimeAdapter {
  readonly kind: 'cline-core-relay' | 'local-harness' | 'unavailable';
  readonly available: boolean;
  readonly reason?: string;
  list(): Promise<EngineeringSession[]>;
  create(repo: EngineeringRepo): Promise<EngineeringSession>;
  send(sessionId: string, prompt: string): Promise<void>;
  setMode(sessionId: string, mode: EngineeringMode): Promise<void>;
  setPermissions(sessionId: string, permissions: EngineeringPermissions): Promise<void>;
  approve(sessionId: string, approvalId: string, approved: boolean): Promise<void>;
  restore(sessionId: string, checkpointId: string): Promise<void>;
  subscribe(listener: (sessions: EngineeringSession[]) => void): () => void;
}

/** Cline tool families controlled by the five session toggles. */
export const CLINE_TOOL_FAMILIES: Record<PermissionCategory, readonly string[]> = {
  read: ['read_files', 'read_file', 'list_files', 'list_code_definition_names', 'search_codebase', 'search_files'],
  edit: ['editor', 'replace_in_file', 'write_to_file', 'apply_patch', 'delete_file'],
  command: ['run_commands', 'execute_command'],
  web: ['fetch_web_content', 'web_fetch', 'web_search'],
  mcp: ['*__*'],
};

export interface ClineToolPolicy { enabled: boolean; autoApprove: boolean }

export function clineToolCategory(toolName: string): PermissionCategory | null {
  for (const category of ['read', 'edit', 'command', 'web'] as const) {
    if (CLINE_TOOL_FAMILIES[category].includes(toolName)) return category;
  }
  // Cline registers MCP tools as serverName__toolName. Unknown native tools do not inherit this.
  return toolName.includes('__') && !toolName.startsWith('__') && !toolName.endsWith('__') ? 'mcp' : null;
}

/**
 * Complete, deny-by-default policy manifest for a Cline session. The relay passes every tool the
 * runtime registered; a tool that is not classified remains disabled instead of bypassing the UI.
 */
export function buildClineToolPolicies(
  tools: readonly string[],
  mode: EngineeringMode,
  permissions: EngineeringPermissions,
  policy: EngineeringPolicy,
): Record<string, ClineToolPolicy> {
  const result: Record<string, ClineToolPolicy> = { '*': { enabled: false, autoApprove: false } };
  for (const tool of tools) {
    const category = clineToolCategory(tool);
    const modeAllows = mode === 'act' || (category !== 'edit' && category !== 'command');
    const enabled = !!category && modeAllows && policy[category];
    result[tool] = { enabled, autoApprove: enabled && permissions[category!] };
  }
  return result;
}
