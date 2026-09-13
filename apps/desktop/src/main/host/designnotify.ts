// The design-round NOTIFY — telling the room a round is waiting on a human.
// approve_design is HUMAN-ONLY and lives on the server; nothing here can approve anything.
// Split out of host/designflow.ts.
import { notifyDesktop } from '../agents';
import type { ExecTask, HostedAgent, OfferedTask, SkillRef, PlanTask } from '../agents';
import { type ClaimVerdict } from '@neuramesh/shared';


import { type SubjectRef } from '../harness/brain';


import { type LogFn } from '../agentlog';
import type { makePlanFlow } from './planflow';
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
import { makeBlock } from './block';

export function makeDesignNotify(ctx: HostCtx & {
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
  ownerHandle: ReturnType<typeof makePlanFlow>['ownerHandle'];
  blockFor: ReturnType<typeof makeBlock>['blockFor'];
}) {
const { db, workspace, post, 
        
        alog, 
        
        ownerHandle } = ctx;
// The guard registry's fields keep their short names, exactly as they read inside startAgentHost.
const { designNotified, 
 } = ctx.guards;

// The designer's flow (docs/14): study the repo's design system from a shallow
// read-only clone, draft self-contained HTML mockups under .nm-evidence/design/,
// and propose them (designing -> design_review) for the HUMAN approval gate.
// Mirrors architectFlow's shape — pickup ack, credential resolve, echo stub,
// failure surfaced to the thread, guard released for a retry.

// design_review announce: tag the owner, name the mockups, notify the desktop.
// Approval itself is the human's button (task.approve_design is HUMAN_ONLY in
// the FSM) — the orchestrator never decides here, it only surfaces the ask.
async function orchDesignNotify(orch: HostedAgent, t: PlanTask) {
  const actor = { kind: 'agent', id: orch.id, role: 'orchestrator' };
  const ch = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [t.channel_id]).catch(() => null);
  if (!ch) { designNotified.delete(t.id); return; }
  try {
    const arts = await db.getAll<{ name: string }>(`select name from artifacts where task_id = ? and kind = 'design'`, [t.id]).catch(() => [] as Array<{ name: string }>);
    const latest = arts.reduce((m, a) => Math.max(m, Number(/^design-mockup-v(\d+)-/.exec(a.name)?.[1] ?? 0)), 0);
    const names = arts.filter((a) => a.name.startsWith(`design-mockup-v${latest}-`)).map((a) => `**${a.name}**`);
    const live = process.env['NM_AGENT_MODE'] !== 'echo';
    const tag = live ? await ownerHandle(ch.workspace_id) : null;
    await post('/v1/messages', actor, {
      workspace: ch.workspace_id, channel: ch.id, taskId: t.id,
      body: `${tag ? `${tag} — ` : ''}the design mockups for #${t.number} “${t.title}” are ready for your review${names.length ? ` (${names.join(', ')})` : ''}. Open the Design panel in this thread to preview them in both themes, then **Approve design** to hand it to the architect — or tell me what to change and I'll send it back to the designer. Nothing is planned or built until you approve.`,
    });
    notifyDesktop(`Design ready for review — #${t.number}`, `${t.title} — approve to move it into planning, or request changes.`);
    alog(orch, { id: t.id, number: t.number, channel_id: t.channel_id }, ch.slug)({ kind: 'lifecycle', phase: 'review', summary: `routed design #${t.number} to the human for approval` });
    console.log(`design_review_human task=${t.number} notified`);
    // hold here; the designNotified guard prevents a re-notify
  } catch (err) {
    designNotified.delete(t.id);
    console.error(`orch_design_notify #${t.number} failed:`, err);
  }
}

  return { orchDesignNotify };
}
