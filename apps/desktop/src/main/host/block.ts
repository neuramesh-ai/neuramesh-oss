// BLOCKING — what a task says when it cannot move, and the sleep-time tick that revisits it.
// A block is a STATE with a reason, never a stalled flow, which is why the reason text and the
// channel-wide refresh live together. Split out of host/flows.ts.
import { resolveToken, runtimeFor } from '../agents';
import type { ExecTask, HostedAgent, OfferedTask, SkillRef } from '../agents';


import { TURN_BUDGETS, type ClaimVerdict } from '@neuramesh/shared';





import { type SubjectRef } from '../harness/brain';






import { keyEnvFor, providerFor } from '../runtime/adapter';





import { type LogFn } from '../agentlog';

import { withTimeout } from './turnkit';
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

export function makeBlock(ctx: HostCtx & {
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
const { db, apiUrl, workspace, ownerActorId, post, agents, 
        
        
        
 } = ctx;
// The guard registry's fields keep their short names, exactly as they read inside startAgentHost.
const { 
        refreshing, 
 } = ctx.guards;

async function blockFor(channelId: string): Promise<string | null> {
  const [b] = await db.getAll<{ content: string }>(
    `select content from memory_blocks where channel_id = ? and kind = 'channel_summary'`,
    [channelId],
  );
  return b?.content ?? null;
}

async function refreshChannelBlock(agent: HostedAgent, channelId: string, basisCount: number) {
  const ch = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [channelId]);
  const openTasks = await db.getAll<{ number: number; title: string; state: string }>(
    `select number, title, state from tasks where channel_id = ? and state not in ('closed','accepted') order by number desc limit 8`,
    [channelId],
  );
  const cred = await resolveToken(apiUrl, ch.workspace_id, agent, ownerActorId);
  // the summarizer talks to the Anthropic API directly (claudeTurn → new Anthropic), which
  // can't use a CLI *subscription* login — so fall back to an env API key when the cred carries
  // no token, and drop to the echo summary if there's no usable key (instead of erroring).
  // BUT when the cred is BLOCKED (preferred subscription down + Manual failover), do NOT reach
  // for the env key: this background digest must not silently bill — go quiet (echo) instead.
  if (cred.blocked) console.log(`memory_block channel=${ch.slug} skipped=auth_blocked provider=${cred.blocked.provider} (failover manual)`);
  // provider-agnostic: the summary runs on the (orchestrator) agent's own model, so use its
  // provider's env key as the fallback — not a hardcoded Anthropic key.
  const envKey = keyEnvFor(providerFor(agent.runtime)).map((k) => process.env[k]).find((v): v is string => !!v) ?? '';
  const token = cred.blocked ? '' : (cred.token || envKey);
  const live = process.env['NM_AGENT_MODE'] !== 'echo' && !!token;

  let content: string;
  if (live) {
    const recent = await db.getAll<{ author_kind: string; body: string }>(
      `select author_kind, body from messages where channel_id = ? and task_id is null order by created_at desc limit 30`,
      [channelId],
    );
    const prev = await blockFor(channelId);
    content = await withTimeout(
      runtimeFor(agent.runtime).streamTurn(
        agent,
        ch.slug,
        `human: You maintain the always-in-context summary block for #${ch.slug}. Rewrite it from scratch: ≤120 words, present tense — what's happening, decisions made, active work and who has it. No headers, no preamble.\n\nCurrent block:\n${prev ?? '(none yet)'}\n\nOpen tasks:\n${openTasks.map((t) => `#${t.number} ${t.title} [${t.state}]`).join('\n') || '(none)'}\n\nRecent channel messages (newest first):\n${recent.map((r) => `${r.author_kind}: ${r.body.slice(0, 200)}`).join('\n')}`,
        token,
      ),
      TURN_BUDGETS.sweep.wallMs / 4,
      'block refresh timed out',
    );
  } else {
    content = `#${ch.slug}: ${basisCount} messages · open tasks: ${openTasks.length}${openTasks[0] ? ` (latest #${openTasks[0].number} “${openTasks[0].title}” ${openTasks[0].state})` : ''}`;
  }

  const res = await post('/v1/commands', { kind: 'agent', id: agent.id, role: 'orchestrator' }, {
    type: 'memory.refresh_block',
    workspace: ch.workspace_id,
    channel: ch.id,
    content: content.slice(0, 4000),
    basisCount,
  });
  if (!res.ok) throw new Error(`refresh_block ${res.status}: ${await res.text()}`);
  console.log(`memory_block channel=${ch.slug} basis=${basisCount} mode=${live ? 'claude' : 'echo'} ok`);

  // distill durable facts behind the block refresh (extract→reconcile)
  let candidates: string[];
  if (live) {
    const recent = await db.getAll<{ author_kind: string; body: string }>(
      `select author_kind, body from messages where channel_id = ? and task_id is null order by created_at desc limit 30`,
      [channelId],
    );
    const raw = await withTimeout(
      runtimeFor(agent.runtime).streamTurn(
        agent,
        ch.slug,
        `human: Extract durable facts from this channel activity — decisions made, conventions adopted, owners, deadlines. Only things worth remembering in a month. One fact per line, ≤200 chars, no bullets, no preamble. Output nothing if there are none.\n\n${recent.map((r) => `${r.author_kind}: ${r.body.slice(0, 200)}`).join('\n')}`,
        token,
      ),
      TURN_BUDGETS.sweep.wallMs / 4,
      'fact extraction timed out',
    );
    candidates = raw.split('\n').map((l) => l.trim()).filter((l) => l.length >= 12 && l.length <= 300).slice(0, 5);
  } else {
    candidates = [`#${ch.slug} channel status: ${basisCount} messages and ${openTasks.length} open tasks on the board`];
  }
  for (const content of candidates) {
    const fr = await post('/v1/commands', { kind: 'agent', id: agent.id, role: 'orchestrator' }, {
      type: 'memory.upsert_fact',
      workspace: ch.workspace_id,
      channel: ch.id,
      content,
      basisCount,
    });
    if (fr.ok) {
      const { decision } = (await fr.json()) as { decision: string };
      console.log(`memory_fact channel=${ch.slug} decision=${decision}`);
    }
  }
}

async function sleepTimeTick() {
  for (const agent of agents.values()) {
    if (agent.role !== 'orchestrator') continue;
    for (const channelId of agent.channels) {
      if (refreshing.has(channelId)) continue;
      try {
        const [cnt] = await db.getAll<{ n: number }>(
          `select count(*) as n from messages where channel_id = ? and task_id is null`,
          [channelId],
        );
        const n = Number(cnt?.n ?? 0);
        const [blk] = await db.getAll<{ basis_count: number }>(
          `select basis_count from memory_blocks where channel_id = ? and kind = 'channel_summary'`,
          [channelId],
        );
        const basis = Number(blk?.basis_count ?? 0);
        if (n === 0 || n - basis < (basis === 0 ? 1 : 5)) continue;
        refreshing.add(channelId);
        refreshChannelBlock(agent, channelId, n)
          .catch((err) => console.error(`memory_block refresh failed:`, err))
          .finally(() => refreshing.delete(channelId));
      } catch {
        // local read hiccup — next tick retries
      }
    }
  }
}
const sleepTimer = setInterval(() => void sleepTimeTick(), 5_000);
sleepTimer.unref?.();


// where the work will happen — announced at claim so humans can follow along

  return { blockFor, refreshChannelBlock, sleepTimeTick };
}
