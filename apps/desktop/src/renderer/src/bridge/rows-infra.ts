// Synced-row shapes (rows-infra) — extracted from App.tsx (modularization track A1).
// Pure types: what the renderer receives over the NMBridge watches/reads.

export interface CredRow {
  provider: string;
  scope: string;
  agentId: string | null;
  authMode: 'apikey' | 'subscription';
  last4: string | null;
  updatedAt: string;
}

export type ProviderId = 'anthropic' | 'openai' | 'gemini';

export interface ProviderStatus {
  installed: boolean;
  authed: boolean;
  method: 'subscription' | 'apikey' | null;
}

// auto-update lifecycle the update card reflects (mirrors main/update.ts + preload)
export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'available'; version: string; notes: string | null }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string };

/** A conversation the human filed away (0108) — read ONLY by Settings › Archived chats. */
export interface ArchivedThreadRow {
  id: string;
  channel_id: string;
  channel_slug: string;
  title: string;
  archived_at: string;
  updated_at: string;
  last_body: string | null;
}

// Bridge payload shapes that named App-local types (moved here in track A1 so bridge/nm.ts
// can type its own contract without a type-cycle back into App.tsx).
export interface FailoverRow { decision_id: string; channel_id: string; channel_slug: string; body: string }

export type PolicyRowUI = { id: string; scope: string; capability: string; selector: string; verdict: string; rationale: string | null; locked: number; project_id: string | null };

export type ProcList = { agents: Array<{ taskId: string; taskNumber: number | null; agentName: string; title: string }>; terminals: Array<{ subId: string; taskNumber: number; title: string }> };

export type FootprintSnapshot = { at: string; berths: { leased: number; warm: number; bytes: number }; donorsBytes: number; clonesBytes: number; actions: number; reclaimedBytes: number };
export type FootprintBerthUI = { taskNumber: number; title: string | null; state: string | null; cls: 'leased' | 'warm' | 'dead' | 'orphan'; bytes: number; repoId: string | null };
export type FootprintPlanItemUI = { kind: 'finished' | 'submitted' | 'dependencies' | 'repos'; count: number; bytes: number };

export type FootprintPayloadUI = {
  at: string;
  nm: { berths: FootprintBerthUI[]; donors: Array<{ repoId: string; repoName: string | null; hash: string; bytes: number; createdAt: string }>; clones: Array<{ repoId: string; repoName: string | null; bytes: number; openTasks: number }>; deliverablesBytes: number; totalBytes: number; reclaimableBytes: number; plan: FootprintPlanItemUI[]; budgetBytes: number };
  fleet: Array<{ tool: string; path: string; count: number; bytes: number; oldestMs: number | null }>;
  history: FootprintSnapshot[];
};
export type FootprintReply = { ready: true; payload: FootprintPayloadUI } | { ready: false; history: FootprintSnapshot[] };

export interface WorkspaceUsage {
  credits: {
    remaining: number; granted: number; periodStart: string; monthlyGrant: number;
    /** the pools, split: grant resets at the refill, purchased never does (credits round). */
    grantRemaining: number; purchasedRemaining: number;
    /** the one gate — parks the machine and 402s the starter. */
    outOfCredits: boolean;
  };
  /** capMinutes is ALWAYS null now: the daily minute cap died with credits. minutes and
   *  activeSeconds are telemetry; the credit balance is the budget. */
  machine: { minutesToday: number; activeSecondsToday: number; capMinutes: number | null; plan: string };
  brain: { callsToday: number; model: string };
  /** the video rung: films today and what they cost */
  video?: { clipsToday: number; creditsToday: number };
  /** the disk the plan PROVISIONS. `metered: false` means nothing counts bytes on it yet, so a
   *  surface may say "10 GB included" and must never say "3 of 10 GB used". */
  storage: { gb: number; metered: boolean };
  rateVersion: string;
}

/** the utilization dashboard's history (GET /v1/credits/history) */
export interface CreditHistory {
  days: Array<{ day: string; activeSeconds: number; modelCalls: number; modelInTokens: number; modelOutTokens: number; brainCredits: number; machineCredits: number; videoClips?: number; videoCredits?: number }>;
  grants: Array<{ credits: number; kind: string; note: string | null; day: string }>;
  /** the video rung: every film as its own row (a film is the largest thing a credit buys) */
  films?: Array<{ id: string; item: string; tier: string; model: string; seconds: number; credits: number; status: 'queued' | 'running' | 'done' | 'failed'; day: string; at: string }>;
}

/** GET /v1/starter/video — what this server films on, in credits, and the workspace's tier pick (the video rung). */
export interface StarterVideo {
  served: boolean;
  tier: string | null;
  pick: string | null;
  /** the pick is a Pro setting */
  canPick?: boolean;
  tiers: Array<{ tier: string; label: string; model: string; vendor: string; seconds: number; credits: number }>;
}
