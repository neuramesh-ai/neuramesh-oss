// What a claim RESOLVES before work starts — the estimate the card shows and the checklist the
// worker executes instead of inventing its own. Split out of host/claimflow.ts.
import { runtimeFor } from '../agents';
import type { ExecTask, HostedAgent, OfferedTask, SkillRef } from '../agents';
import { type ClaimVerdict } from '@neuramesh/shared';


import { type SubjectRef } from '../harness/brain';

import { type LogFn } from '../agentlog';
import { withTimeout } from './turnkit';
import { STATIC_CHECKLIST } from './flows';
import type { HostCtx } from './ctx';
import type { PowerSyncDatabase } from '@powersync/node';
import type { Brain } from '../harness/brain';
import type { AgentAttachment } from '../runtime/adapter';
import type { HostQueue } from '../harness/hostqueue';
import type { ParkBook } from '../harness/park';
import type { WhiteboardToolClosures } from '../harness/toolbus';
import type { makeRuns, RunHandle } from './runs';
import type { makeBeats } from './beats';
import type { makePark } from './park';

export function makeClaimResolve(ctx: HostCtx & {
  db: PowerSyncDatabase;
  apiUrl: string;
  workspace: string;
  ownerActorId: string;
  agents: Map<string, HostedAgent>;
  brain: Brain;
  parkBook: ParkBook;
  execQueue: HostQueue;
  /** the claim registry — `delete` also re-arms the queue slot, which is why it is not a bare Set */
  claimed: { has: (id: string) => boolean; add: (id: string) => unknown; delete: (id: string) => boolean };
  // ── services other makers already built: their types are INFERRED, never restated ──────────
  NO_RUN: ReturnType<typeof makeRuns>['NO_RUN'];
  openRun: ReturnType<typeof makeRuns>['openRun'];
  narrate: ReturnType<typeof makeRuns>['narrate'];
  declareBeats: ReturnType<typeof makeBeats>['declareBeats'];
  advanceBeat: ReturnType<typeof makeBeats>['advanceBeat'];
  beatCursor: ReturnType<typeof makeBeats>['beatCursor'];
  parkFor: ReturnType<typeof makePark>['parkFor'];
  // ── the host's own helpers ────────────────────────────────────────────────────────────────
  alog: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null, runId?: string | null) => LogFn;
  arun: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null) => { log: LogFn; runId: string };
  brainNotes: (subject: SubjectRef, cap?: number, perNote?: number) => string;
  brainNotesFor: (task: ExecTask, cap?: number, perNote?: number) => string;
  brainResults: (subject: SubjectRef, cap?: number, per?: number) => string;
  channelLessons: (workspaceId: string, channelId: string) => Promise<string>;
  claimVerdict: (runtime: string, model: string | null, originUserId: string | null, elapsedMs: number, extra?: { agentId?: string; priorMachineId?: string | null }) => Promise<ClaimVerdict>;
  discoverSkills: (channelId: string, workspaceId: string) => Promise<SkillRef[]>;
  handleExhaustion: (agent: HostedAgent, t: ExecTask | null, ch: { id: string; slug: string; workspace_id: string }) => Promise<void>;
  legSummary: (out: string) => string;
  mineLessons: (reviewer: HostedAgent, t: { id: string; number: number; title: string }, ch: { id: string; slug: string; workspace_id: string }, token: string, live: boolean, log?: LogFn) => Promise<void>;
  orchestratorTurn: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, transcript: string, token: string, thread?: { id: string; number: number; title: string; state: string }, log?: LogFn, skills?: SkillRef[], attachments?: AgentAttachment[], convoThreadId?: string | null, run?: RunHandle, onDelta?: (t: string) => void) => Promise<string>;
  originOf: (t: OfferedTask) => string | null;
  priorMachineFor: (threadId?: string | null, taskId?: string | null) => Promise<string | null>;
  readOnlyStudy: (agent: HostedAgent, dir: string, token: string, log?: LogFn) => ((system: string, user: string) => Promise<string>) | null;
  seatFor: (agent: HostedAgent, channelId: string, scope?: { threadId?: string | null; taskId?: string | null }) => Promise<HostedAgent>;
  setStatus: (agent: HostedAgent, status: 'online' | 'thinking' | 'working') => void;
  sinceFirstSeen: (key: string) => number;
  spawnLegFor: (parent: HostedAgent, where: { workspace: string; channelId: string; taskId?: string | null; threadId?: string | null }, dir: string, task: ExecTask, budget: { wallMs: number; contextTokens: number }, log: LogFn | undefined, _depth: number) => (i: { role: string; prompt: string; label?: string }) => Promise<{ ok: boolean; summary?: string; error?: string }>;
  taskRecallNote: (workspaceId: string, query: string, lessonsNote: string) => Promise<string>;
  whiteboardClosures: (actor: { kind: string; id: string; role?: string }, ch: { id: string; workspace_id: string }, at: { taskId?: string; threadId?: string }) => WhiteboardToolClosures;
}) {
const { workspace, 
        
        
 } = ctx;
// The guard registry's fields keep their short names, exactly as they read inside startAgentHost.
const { 
 } = ctx.guards;

async function estimateFor(agent: HostedAgent, t: ExecTask, token: string | null, live: boolean, checklist: string[]): Promise<string> {
  if (!live || !token) return '~1 min (echo stub)';
  try {
    const raw = await withTimeout(
      runtimeFor(agent.runtime).streamTurn(
        agent,
        'estimates',
        `human: You are about to execute task #${t.number} “${t.title}”${t.repo_id ? ' (repo-backed)' : ' (file deliverable)'} with this checklist: ${checklist.join(' · ')}. Reply with ONLY a rough wall-clock estimate for an AI agent run, like "~10–20 min". No prose.`,
        token,
      ),
      20_000,
      'estimate timed out',
    );
    const m = raw.trim().split('\n')[0]!.slice(0, 24);
    return /min|hour|hr|m\b/i.test(m) ? m : '~5–15 min';
  } catch {
    return '~5–15 min';
  }
}

// a real requirements read, generated after the claim is won (claims stay
// fast and atomic); any failure falls back to the static checks
async function checklistFor(agent: HostedAgent, t: OfferedTask, token: string): Promise<string[]> {
  try {
    const raw = await withTimeout(
      runtimeFor(agent.runtime).streamTurn(
        agent,
        'requirements',
        `human: You just claimed task #${t.number}: “${t.title}”${t.repo_id ? ' (repo-backed — you will work on a branch)' : ''}. List the 3–5 concrete requirement checks you are confirming before starting — short imperative bullets, one per line, no preamble.`,
        token,
      ),
      45_000,
      'checklist generation timed out',
    );
    const items = raw
      .split('\n')
      .map((l) => l.replace(/^[-*•\d.\s]+/, '').trim())
      .filter((l) => l.length > 3 && l.length < 160)
      .slice(0, 5);
    return items.length >= 2 ? items : STATIC_CHECKLIST;
  } catch {
    return STATIC_CHECKLIST;
  }
}

  return { estimateFor, checklistFor };
}
