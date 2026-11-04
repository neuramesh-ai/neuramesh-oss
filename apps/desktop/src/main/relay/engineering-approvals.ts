import { previewEngineeringChanges } from './engineering-preview';
import type { ToolApprovalRequest } from '@cline/sdk';
import type { PolicyRule } from '@neuramesh/shared';
import { engineeringToolCategory, engineeringToolDecision, type EngineeringControls, type EngineeringRuntimeEvent } from '../../engineering-protocol';
import { engineeringPolicyActions, engineeringPolicyVerdict } from './engineering-policy';
import type { ThreadPermissionGate } from '../thread-permission-gate';

export async function requestEngineeringApproval(request: ToolApprovalRequest, controls: EngineeringControls, policyRules: PolicyRule[], pending: Map<string, (approved: boolean) => void>, emit: (event: EngineeringRuntimeEvent) => void, record: (type: string, payload: unknown) => void, cwd?: string, isActive: () => boolean = () => true, gate?: ThreadPermissionGate): Promise<{ approved: boolean; reason?: string }> {
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
  return new Promise((resolve) => {
    pending.set(request.toolCallId, (approved) => resolve({ approved, ...(!approved ? { reason: 'Declined in Neuramesh' } : {}) }));
    emit({ type: 'approval', approvalId: request.toolCallId, category, toolName: request.toolName, input: request.input, ...(changes.length ? { changes } : {}) });
  });
}
