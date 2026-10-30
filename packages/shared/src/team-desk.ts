/** Agent Desk shares ordinary threads; these are the server's small card projections. */
export interface TeamHome {
  id: string; project_id: string; channel_id: string; home_agent_id: string;
  title: string; description: string; created_by: string; created_at: string; updated_at: string;
  task_id: null; mode: 'chat'; kind: 'chat'; brain_override: string | null; home_thinking: string | null;
  summary: string | null; summary_revision: number; last_body: string | null; last_author_kind: string | null;
  msg_count: number; routine_count: number; work_count: number; settled_at: string | null;
}
export interface TeamDeskState { projectId: string; channelId: string; homes: TeamHome[] }
export interface TeamContextMessage { id: string; author_kind: string; author_id: string; body: string; created_at: string }
export interface TeamContext {
  home: TeamHome | null; summary: string | null; revision: number;
  messages: TeamContextMessage[]; compactThrough: string | null;
}
export const TEAM_TEMPLATES = [
  { name: 'Rex', role: 'orchestrator', specialty: 'Chief of staff', description: 'Coordinate goals, decisions, priorities and follow-through across the startup.' },
  { name: 'Plume', role: 'marketer', specialty: 'Marketing', description: 'Positioning, content, campaigns and growth experiments.' },
  { name: 'Echo', role: 'marketer', specialty: 'Social media', description: 'Social media strategy, platform-specific drafts, content calendars and community engagement. Prepare drafts for approval; never publish without permission.' },
  { name: 'Patch', role: 'developer', specialty: 'Engineering', description: 'Build and maintain software, investigate bugs and implement reviewed plans.' },
  { name: 'Iris', role: 'designer', specialty: 'Design', description: 'Product experience, research synthesis, visual design and accessible interfaces.' },
  { name: 'Atlas', role: 'architect', specialty: 'Architecture', description: 'Technical direction, system design and engineering tradeoffs.' },
  { name: 'Scout', role: 'reviewer', specialty: 'Quality', description: 'Review changes, test workflows and identify reliability and security risks.' },
  { name: 'Bosun', role: 'shipper', specialty: 'Delivery', description: 'Release coordination, rollout plans and operational follow-through.' },
  { name: 'Piper', role: 'sales', specialty: 'Sales', description: 'Customer discovery, pipeline, outreach drafts and sales follow-up.' },
  { name: 'Milo', role: 'worker', specialty: 'Product', description: 'Customer problems, product strategy, specifications and roadmap prioritization.' },
  { name: 'Sage', role: 'worker', specialty: 'Research', description: 'Market and competitor research with verifiable evidence and explicit uncertainty.' },
  { name: 'Remy', role: 'worker', specialty: 'Customer success', description: 'Support triage, onboarding, customer feedback and retention.' },
  { name: 'Ledger', role: 'worker', specialty: 'Finance', description: 'Budgets, runway scenarios, metrics and financial operations; flag assumptions and decisions requiring qualified advice.' },
  { name: 'Olive', role: 'worker', specialty: 'Operations', description: 'People operations, internal processes, vendor coordination and operating checklists.' },
] as const;
