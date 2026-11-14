import type { EngineeringMode, EngineeringPermissions, EngineeringPolicy, PermissionCategory, PermissionDecision } from './domain';

export const PERMISSION_LABELS: Record<PermissionCategory, { label: string; detail: string }> = {
  read: { label: 'Read files', detail: 'Inspect files and search the repository' },
  edit: { label: 'Edit files', detail: 'Create, modify, rename, or delete files' },
  command: { label: 'Execute commands', detail: 'Run shell commands and test suites' },
  web: { label: 'Fetch web content', detail: 'Open URLs and search the web' },
  mcp: { label: 'Use MCP servers', detail: 'Call tools exposed by connected MCP servers' },
};

/** Start unknown historical sessions with review enabled until the user chooses their controls. */
export const REVIEW_ENGINEERING_PERMISSIONS: EngineeringPermissions = {
  read: true, edit: false, command: false, web: false, mcp: false,
};

/** New coding threads may edit and run commands in Act, subject to machine policy. */
export const RECOMMENDED_ENGINEERING_PERMISSIONS: EngineeringPermissions = {
  ...REVIEW_ENGINEERING_PERMISSIONS, edit: true, command: true,
};

export const OPEN_ENGINEERING_POLICY: EngineeringPolicy = {
  read: true, edit: true, command: true, web: true, mcp: true,
};

export function effectivePermission(
  mode: EngineeringMode,
  category: PermissionCategory,
  session: EngineeringPermissions,
  policy: EngineeringPolicy,
): PermissionDecision {
  if (!policy[category]) return 'blocked';
  // Plan is structurally read-only, even if a stale client claims edit/command auto-approval.
  if (mode === 'plan' && (category === 'edit' || category === 'command')) return 'blocked';
  return session[category] ? 'auto' : 'ask';
}
