// Transport-neutral contract between the Engineering renderer and the coding runtime living on
// the workspace machine. It stays independent of React, Electron, and Cline so both relay edges
// can validate messages before they cross a trust boundary.

import { MODEL_ID_SET } from '../model-packs';
import { PLAN_ENTITLEMENTS } from '../entitlements';

export type EngineeringMode = 'plan' | 'act';
export type EngineeringPermissionCategory = 'read' | 'edit' | 'command' | 'web' | 'mcp';

export interface EngineeringControls {
  mode: EngineeringMode;
  permissions: Record<EngineeringPermissionCategory, boolean>;
  policy: Record<EngineeringPermissionCategory, boolean>;
}

export interface EngineeringOpenMeta extends EngineeringControls {
  threadId: string;
  /** Selected project. Optional only for sessions persisted by older clients. */
  projectId?: string;
  cwd?: string;
  repoId: string;
  repoName: string;
  branch: string;
  /** A task-scoped model id. Null/omitted inherits repository and developer defaults. */
  modelId?: string | null;
  /** A task-scoped Neuramesh model-pack id. Null/omitted inherits repository and developer defaults. */
  /** @deprecated Kept only so Code threads created by older clients can resume. */
  brainPack?: string | null;
  /** WHERE THIS SESSION RUNS (the desktop Code bridge, slice B1) — a client-side choice: the id of
   *  the machine to host it. The desktop routes its own machine's id to the in-process lane and
   *  anything else to the relay; the relay lane strips it, since the attach frame already names
   *  the machine. Null/omitted = the lane's default. */
  machineId?: string | null;
}

export interface EngineeringMachineOpenMeta extends EngineeringOpenMeta {
  /** Injected by the relay after client authentication; never accepted from browser metadata. */
  actorId: string;
}

export type EngineeringCommand =
  | { type: 'attachment_start'; id: string; name: string; mime: string; size: number }
  | { type: 'attachment_chunk'; id: string; index: number; data: string }
  | { type: 'attachment_end'; id: string }
  | { type: 'prompt'; prompt: string; attachments?: EngineeringAttachmentRef[] }
  | { type: 'controls'; controls: EngineeringControls }
  | { type: 'model'; modelId: string | null }
  /** @deprecated Older clients selected the developer seat indirectly through a pack. */
  | { type: 'brain'; brainPack: string | null }
  | { type: 'approval'; approvalId: string; approved: boolean }
  | { type: 'restore'; checkpointRunCount: number }
  | { type: 'abort' };

export interface EngineeringAttachmentRef {
  id: string;
  name: string;
  mime: string;
}

export type EngineeringRuntimeEvent =
  | { type: 'ready'; provider: string; model: string; cwd: string; modelId: string | null; brainPack: string | null }
  | { type: 'model_changed'; provider: string; model: string; modelId: string | null; brainPack: string | null }
  /** @deprecated Accepted so an older machine can finish an already-open browser session. */
  | { type: 'brain_changed'; provider: string; model: string; brainPack: string | null }
  | { type: 'session_started'; sessionId: string }
  | { type: 'attachment_ack'; id: string; index: number }
  | { type: 'agent_event'; event: Record<string, unknown> }
  | { type: 'status'; status: string }
  | { type: 'mode_blocked'; category: 'edit' | 'command'; toolName: string }
  | { type: 'approval'; approvalId: string; category: EngineeringPermissionCategory; toolName: string; input: unknown }
  | { type: 'approval_resolved'; approvalId: string; approved: boolean }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cost?: number }
  | { type: 'restored'; checkpointRunCount: number }
  | { type: 'changes'; changes: EngineeringRuntimeChange[] }
  | { type: 'error'; message: string; code?: string; recoverable?: boolean }
  | { type: 'ended'; reason: string };

export interface EngineeringRuntimeChange {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
  before: string;
  after: string;
  diff: string;
}

const CATEGORIES = new Set<EngineeringPermissionCategory>(['read', 'edit', 'command', 'web', 'mcp']);

export function isEngineeringOpenMeta(value: unknown): value is EngineeringOpenMeta {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v['threadId'] === 'string' && v['threadId'].length > 0
    && typeof v['repoId'] === 'string' && typeof v['repoName'] === 'string' && typeof v['branch'] === 'string'
    && (v['projectId'] === undefined || isBoundedString(v['projectId'], 200))
    && isModelId(v['modelId'])
    && isBrainPack(v['brainPack'])
    && isEngineeringControls(v);
}

function isBrainPack(value: unknown): value is string | null | undefined {
  return value === undefined || value === null
    || (typeof value === 'string' && value.length > 0 && value.length <= 200);
}

function isModelId(value: unknown): value is string | null | undefined {
  return value === undefined || value === null
    || (typeof value === 'string' && MODEL_ID_SET.has(value));
}

const isBoundedString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const isAttachmentId = (value: unknown): value is string => isBoundedString(value, 100) && /^[a-zA-Z0-9._-]+$/.test(value);
const MAX_ATTACHMENT_LIMITS = PLAN_ENTITLEMENTS.cloud.attachments;
const isAttachmentRef = (value: unknown): value is EngineeringAttachmentRef => {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Record<string, unknown>;
  return isAttachmentId(ref['id']) && isBoundedString(ref['name'], 255) && isBoundedString(ref['mime'], 200);
};

export function isEngineeringControls(value: unknown): value is EngineeringControls {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v['mode'] !== 'plan' && v['mode'] !== 'act') return false;
  for (const name of ['permissions', 'policy'] as const) {
    const bag = v[name];
    if (!bag || typeof bag !== 'object') return false;
    for (const category of CATEGORIES) if (typeof (bag as Record<string, unknown>)[category] !== 'boolean') return false;
  }
  return true;
}

export function isEngineeringCommand(value: unknown): value is EngineeringCommand {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v['type'] === 'attachment_start') return isAttachmentId(v['id']) && isBoundedString(v['name'], 255) && isBoundedString(v['mime'], 200)
    && typeof v['size'] === 'number' && Number.isInteger(v['size']) && v['size'] >= 0 && v['size'] <= MAX_ATTACHMENT_LIMITS.maxBytes;
  if (v['type'] === 'attachment_chunk') return isAttachmentId(v['id']) && typeof v['index'] === 'number' && Number.isInteger(v['index']) && v['index'] >= 0
    && typeof v['data'] === 'string' && v['data'].length > 0 && v['data'].length <= 192 * 1024;
  if (v['type'] === 'attachment_end') return isAttachmentId(v['id']);
  if (v['type'] === 'prompt') return typeof v['prompt'] === 'string' && v['prompt'].trim().length > 0
    && (v['attachments'] === undefined || (Array.isArray(v['attachments']) && v['attachments'].length <= MAX_ATTACHMENT_LIMITS.maxPerMessage && v['attachments'].every(isAttachmentRef)));
  if (v['type'] === 'controls') return isEngineeringControls(v['controls']);
  if (v['type'] === 'model') return isModelId(v['modelId']) && v['modelId'] !== undefined;
  if (v['type'] === 'brain') return isBrainPack(v['brainPack']) && v['brainPack'] !== undefined;
  if (v['type'] === 'approval') return typeof v['approvalId'] === 'string' && typeof v['approved'] === 'boolean';
  if (v['type'] === 'restore') return typeof v['checkpointRunCount'] === 'number' && Number.isInteger(v['checkpointRunCount']) && v['checkpointRunCount'] > 0;
  return v['type'] === 'abort';
}

const NATIVE_TOOL_CATEGORY: Record<string, EngineeringPermissionCategory> = {
  read_files: 'read',
  search_codebase: 'read',
  run_commands: 'command',
  fetch_web_content: 'web',
  apply_patch: 'edit',
  editor: 'edit',
};

export function engineeringToolCategory(toolName: string): EngineeringPermissionCategory | null {
  return NATIVE_TOOL_CATEGORY[toolName] ?? (toolName.includes('__') ? 'mcp' : null);
}

export function engineeringToolDecision(
  controls: EngineeringControls,
  toolName: string,
): 'auto' | 'ask' | 'blocked' {
  const category = engineeringToolCategory(toolName);
  if (!category || !controls.policy[category]) return 'blocked';
  if (controls.mode === 'plan' && (category === 'edit' || category === 'command')) return 'blocked';
  return controls.permissions[category] ? 'auto' : 'ask';
}

/** Every tool is routed through the runtime approval callback. The wildcard lets discovered MCP
 * tools reach that gate; unknown native tools are still denied by engineeringToolCategory(). */
export const ENGINEERING_CLINE_TOOL_POLICIES: Record<string, { enabled: boolean; autoApprove: boolean }> = {
  '*': { enabled: true, autoApprove: false },
  read_files: { enabled: true, autoApprove: false },
  search_codebase: { enabled: true, autoApprove: false },
  run_commands: { enabled: true, autoApprove: false },
  fetch_web_content: { enabled: true, autoApprove: false },
  apply_patch: { enabled: true, autoApprove: false },
  editor: { enabled: true, autoApprove: false },
};
