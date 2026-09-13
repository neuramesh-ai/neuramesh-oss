// Moved to @neuramesh/shared (packages/shared/src/engineering/domain.ts, the mobile-cloud round
// S5.1): the phone renders the same session model. Re-exported so the view keeps its door.
export {
  continueEngineeringInAct, createEngineeringSession, dismissEngineeringModeHandoff, effectivePermission,
  OPEN_ENGINEERING_POLICY, PERMISSION_LABELS, RECOMMENDED_ENGINEERING_PERMISSIONS, resolveEngineeringApproval,
  setEngineeringBrainPack, setEngineeringMachine, setEngineeringMode, setEngineeringModel, setEngineeringPermission,
  setEngineeringPolicy, submitEngineeringPrompt,
} from '@neuramesh/shared';
export type {
  EngineeringActiveActivity, EngineeringApproval, EngineeringAttachment, EngineeringChange, EngineeringCheckpoint,
  EngineeringMessage, EngineeringMode, EngineeringPermissions, EngineeringPolicy, EngineeringProject, EngineeringRepo,
  EngineeringSession, EngineeringTurnState, PermissionCategory, PermissionDecision,
} from '@neuramesh/shared';
