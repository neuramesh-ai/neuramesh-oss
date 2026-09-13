// Moved to @neuramesh/shared (engineering/activity.ts, the mobile-cloud round S5.1) — the phone's
// transcript folds reasoning and groups receipts with the same presentation. Re-exported.
export {
  engineeringActivePresentation, engineeringActivityPresentation, engineeringPlanItems, engineeringReasoningSeconds,
  groupEngineeringTranscript, streamingEngineeringText,
} from '@neuramesh/shared';
export type { EngineeringActivityKind, EngineeringActivityPresentation, EngineeringActivityStatus, EngineeringPlanItem, EngineeringTranscriptBlock } from '@neuramesh/shared';
