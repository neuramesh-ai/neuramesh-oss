import type { NMEvent } from '@neuramesh/shared';

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
}
