import { previewEngineeringChanges } from './engineering-preview';
import type { ToolApprovalRequest } from '@cline/sdk';
import type { PolicyRule } from '@neuramesh/shared';
import { engineeringToolCategory, engineeringToolDecision, type EngineeringControls, type EngineeringMachineOpenMeta, type EngineeringRuntimeEvent } from '../../engineering-protocol';
import { engineeringPolicyActions, engineeringPolicyVerdict } from './engineering-policy';
import type { ThreadPermissionGate } from '../thread-permission-gate';
import { codeApprovalKey, parks, type Park, type ParkRegistry } from '../cloudrun/parks';

/** where a Code session's approval would park (cloudrun/parks.ts): its thread, repo and person, and
 *  the session's open meta, so a machine that wakes for the answer can reopen the session with no
 *  tab (engineering-park-resume.ts) */
export interface EngineeringParkMeta { threadId: string; repoId?: string | null; actorId?: string | null; openMeta?: EngineeringMachineOpenMeta }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `gate` (the thread's permission mode) decides first; only an answer still owed to a person parks */
export async function requestEngineeringApproval(request: ToolApprovalRequest, controls: EngineeringControls, policyRules: PolicyRule[], pending: Map<string, (approved: boolean) => void>, emit: (event: EngineeringRuntimeEvent) => void, record: (type: string, payload: unknown) => void, cwd?: string, isActive: () => boolean = () => true, gate?: ThreadPermissionGate, parkMeta?: EngineeringParkMeta): Promise<{ approved: boolean; reason?: string }> {
  record('tool.approval', request);
  const policyResult = (approved: boolean, reason?: string) => {
    record('approval.resolved', { approvalId: request.toolCallId, approved, reason, source: 'policy' });
    return Promise.resolve({ approved, ...(reason ? { reason } : {}) });
  };
  const category = engineeringToolCategory(request.toolName);
  const toolDecision = engineeringToolDecision(controls, request.toolName);
  const remoteCapture = request.toolName === 'capture_task_view' && !!(request.input as {previewOrigin?:string})?.previewOrigin;
  const webDecision = remoteCapture ? engineeringToolDecision(controls, 'fetch_web_content') : 'auto';
  const sessionDecision = [toolDecision,webDecision].includes('blocked') ? 'blocked' : [toolDecision,webDecision].includes('ask') ? 'ask' : toolDecision;
  const policyVerdict = engineeringPolicyVerdict(policyRules, request.toolName, request.input);
  if (!category || policyVerdict === 'deny') {
    return policyResult(false, 'Blocked by Neuramesh workspace policy');
  }
  if (sessionDecision === 'blocked') {
    if (controls.mode === 'plan' && (category === 'edit' || category === 'command')) {
      emit({ type: 'mode_blocked', category, toolName: request.toolName, input: request.input });
      return policyResult(false, 'Blocked by Neuramesh Plan mode');
    }
    return policyResult(false, 'Blocked by Neuramesh workspace policy');
  }
  // Only repository editors supply a diff. Workspace tools validate their own document or artifact.
  const previewEdit = cwd && (request.toolName === 'apply_patch' || request.toolName === 'editor');
  const changes = previewEdit ? await previewEngineeringChanges(cwd, request.toolName, request.input) : [];
  if (previewEdit && (!changes.length || changes.some(change => change.previewError))) {
    return policyResult(false, `The edit could not be safely previewed. Nothing was changed. The selected repository root is ${JSON.stringify(cwd)}. Read the current file and retry with a valid repository-relative path and matching edit contents. Do not invent a /workspace prefix or use shell commands to bypass file review.`);
  }
  const decision = await gate?.decide(remoteCapture ? 'web' : category, engineeringPolicyActions(request.toolName, request.input), policyRules);
  if (!isActive()) return policyResult(false, 'The session closed during the permission check.');
  if (decision) record('permission.checked', { approvalId: request.toolCallId, ...decision });
  if (decision?.verdict === 'deny') return policyResult(false, decision.reason);
  if (decision ? decision.verdict === 'allow' : sessionDecision === 'auto' && policyVerdict === 'allow') return policyResult(true);
  if (changes.length) record('review.proposed', { approvalId: request.toolCallId, toolName: request.toolName, category, input: request.input, changes });
  if (!isActive()) return { approved: false, reason: 'The session closed while preparing the preview.' };
  // CLOUD RUN: the approval outlives the tab. It parks durably; an answer already given under the same
  // key (the re-issued call after a reopen, or a person who answered while the tab was closed) applies
  // without asking again, and a tab that closes mid-wait leaves the park open instead of a denial
  const reg = parkMeta ? parks() : null;
  let held: Park | null = null;
  if (reg && parkMeta) {
    const key = codeApprovalKey(parkMeta.threadId, request.toolName, request.input);
    const prior = await reg.prior(key).catch(() => null);
    if (prior && 'resolution' in prior) {
      await reg.consume(prior.park).catch(() => {});
      record('approval.resolved', { approvalId: request.toolCallId, approved: prior.resolution.approved, source: 'park' });
      return prior.resolution.approved ? { approved: true } : { approved: false, reason: prior.resolution.reason === 'timeout' ? 'The approval timed out' : 'Declined in Neuramesh' };
    }
    held = prior?.park ?? await parkCodeApproval(reg, key, request, category, parkMeta);
  }
  return new Promise((resolve) => {
    pending.set(request.toolCallId, (approved) => {
      if (held && reg) {
        // closing resolves every pending approval as false: that is the tab going away, not an answer
        if (!isActive()) { resolve({ approved: false, reason: 'The session closed; this approval stays parked and applies when the thread continues.' }); return; }
        void reg.consume(held, { answer: approved ? 'Approve' : 'Deny', approved, source: 'machine' }).catch(() => {});
      }
      resolve({ approved, ...(!approved ? { reason: 'Declined in Neuramesh' } : {}) });
    });
    emit({ type: 'approval', approvalId: request.toolCallId, category, toolName: request.toolName, input: request.input, ...(changes.length ? { changes } : {}) });
  });
}

function parkCodeApproval(reg: ParkRegistry, key: string, request: ToolApprovalRequest, category: string, meta: EngineeringParkMeta): Promise<Park | null> {
  const preview = JSON.stringify(request.input ?? null) ?? 'null';
  return reg.park({
    key, kind: 'approval', threadId: UUID.test(meta.threadId) ? meta.threadId : null,
    request: { toolCallId: request.toolCallId, toolName: request.toolName, category, input: preview.length > 4_000 ? `${preview.slice(0, 4_000)}…` : preview },
    checkpoint: { kind: 'code-session', threadId: meta.threadId, repoId: meta.repoId ?? null, actorId: meta.actorId ?? null, ...(meta.openMeta ? { meta: meta.openMeta } : {}) },
    wakeCondition: { on: 'answer' },
  }).catch(() => null);
}
