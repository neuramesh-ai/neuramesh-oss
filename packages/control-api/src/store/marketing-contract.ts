import type { CompanyProfile, NMEvent } from '@neuramesh/shared';

export interface MarketingStore {
  startProjectMarketing(projectId: string, userId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ channelId: string; taskId: string }>;
  setChannelMarketing(channelId: string, profile: { website: string | null; focus: string[]; goal?: string; bootstrap_thread_id?: string; setup_by: string; setup_at: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; workspace: string }>;
  // one answered setup-flow step (setupflows.ts), merged into the profile as it lands — the
  // per-step write that makes an abandoned wizard a pause instead of a loss
  setChannelSetupStep(channelId: string, input: { flowId: string; stepId: string; patch: Record<string, unknown> }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; workspace: string }>;
  // release-day backfill: a setup task for every existing flow-bearing room left untouched
  backfillSetupTasks(workspace: string): Promise<number>;
  // flip one MCP integration toggle on the room's marketing profile (marketing.mcp.<provider>)
  setMarketingIntegration(channelId: string, provider: string, enabled: boolean, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  /** the Postiz lane's rows: each project's connector, and a post's route (store/postiz-content.ts) */
  readonly postizContent: import('./postiz-content').PostizContentStore;
}

/** the first run's company answers (docs/design/onboarding-2026-11 O2), which decide the starter room's setup task */
export interface FirstRunStore {
  /** card 1 (workspace.set_profile): the answers, and the name when it changes. Owner or admin only, in the same transaction. */
  setWorkspaceProfile(workspaceId: string, input: { name?: string; profile: CompanyProfile; by: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
}
