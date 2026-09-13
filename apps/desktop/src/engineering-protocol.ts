// Moved to @neuramesh/shared (packages/shared/src/engineering/protocol.ts, the mobile-cloud round
// S5.1) — the phone's Code lane validates the same messages. Re-exported so every importer keeps
// its door.
export {
  ENGINEERING_CLINE_TOOL_POLICIES, engineeringToolCategory, engineeringToolDecision,
  isEngineeringCommand, isEngineeringControls, isEngineeringOpenMeta,
} from '@neuramesh/shared';
export type {
  EngineeringAttachmentRef, EngineeringCommand, EngineeringControls, EngineeringMachineOpenMeta, EngineeringMode,
  EngineeringOpenMeta, EngineeringPermissionCategory, EngineeringRuntimeChange, EngineeringRuntimeEvent,
} from '@neuramesh/shared';
