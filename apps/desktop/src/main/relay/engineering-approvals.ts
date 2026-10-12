import { previewEngineeringChanges } from './engineering-preview';
import type { ToolApprovalRequest } from '@cline/sdk';
import type { PolicyRule } from '@neuramesh/shared';
import { engineeringToolCategory, engineeringToolDecision, type EngineeringControls, type EngineeringRuntimeEvent } from '../../engineering-protocol';
import { engineeringPolicyVerdict } from './engineering-policy';

export async function requestEngineeringApproval(request: ToolApprovalRequest, controls: EngineeringControls, policyRules: PolicyRule[], pending: Map<string, (approved: boolean) => void>, emit: (event: EngineeringRuntimeEvent) => void, record: (type: string, payload: unknown) => void, cwd?: string, isActive: () => boolean = () => true): Promise<{ approved: boolean; reason?: string }> {
  record('tool.approval', request);
  const policyResult = (approved: boolean, reason?: string) => {
    record('approval.resolved', { approvalId: request.toolCallId, approved, reason, source: 'policy' });
    return Promise.resolve({ approved, ...(reason ? { reason } : {}) });
  };
  const category = engineeringToolCategory(request.toolName);
  const sessionDecision = engineeringToolDecision(controls, request.toolName);
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
  if (sessionDecision === 'auto' && policyVerdict === 'allow') return policyResult(true);
  const changes = cwd && category === 'edit' ? await previewEngineeringChanges(cwd, request.toolName, request.input) : [];
  if (changes.length) record('review.proposed', { approvalId: request.toolCallId, toolName: request.toolName, category, input: request.input, changes });
  if (!isActive()) return { approved: false, reason: 'The session closed while preparing the preview.' };
  return new Promise((resolve) => {
    pending.set(request.toolCallId, (approved) => resolve({ approved, ...(!approved ? { reason: 'Declined in Neuramesh' } : {}) }));
    emit({ type: 'approval', approvalId: request.toolCallId, category, toolName: request.toolName, input: request.input, ...(changes.length ? { changes } : {}) });
  });
}
