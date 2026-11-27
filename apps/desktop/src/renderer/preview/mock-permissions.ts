import type { PermissionMode } from '@neuramesh/shared';

let workspaceMode: PermissionMode = 'auto-review';
const threadModes = new Map<string, PermissionMode>();

export async function getPermissions(thread?: string, task?: string) {
  const id = thread ?? task;
  return { workspaceMode, threadMode: id ? threadModes.get(id) ?? null : null, legacyControls: false, runtimeReady: true };
}

export async function setPermissions(mode: PermissionMode | null, thread?: string, task?: string) {
  const id = thread ?? task;
  if (id && mode) threadModes.set(id, mode);
  else if (id) threadModes.delete(id);
  else if (mode) workspaceMode = mode;
  return getPermissions(thread, task);
}

export const policies = async () => [
    { id: 'ovr-shell', scope: 'workspace', capability: 'shell.exec', selector: JSON.stringify({ kind: 'shellClass', value: 'destructive' }), verdict: 'deny', rationale: 'Tightened to deny for this workspace', locked: 0, project_id: null },
    { id: 'ovr-egress', scope: 'workspace', capability: 'net.egress', selector: JSON.stringify({ kind: 'any' }), verdict: 'ask', rationale: 'Review every outbound host in this workspace', locked: 0, project_id: null },
    { id: 'ovr-protect', scope: 'workspace', capability: 'fs.read', selector: JSON.stringify({ kind: 'path', glob: '**/.config/acme-secrets/**' }), verdict: 'deny', rationale: 'Agents can’t read .config/acme-secrets', locked: 0, project_id: null },
  ];
