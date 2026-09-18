// The turn transcript and the orchestrator's fan-out closure — what a turn is built FROM.
// Split out of host/content.ts.
import { TURN_BUDGETS, type AgentRole, type TurnKind } from '@neuramesh/shared';
import { resolveToken, runtimeFor } from '../agents';
import type { ExecTask, HostedAgent, ThreadTask } from '../agents';
import { Subtree, planSpawn } from '../harness/subagents';
import { claudeDesignProjectWatch } from '../claudedesign';



import { type LogFn } from '../agentlog';
import { type RunHandle } from './runs';
import { type SubjectRef } from '../harness/brain';
import { withTimeout } from './turnkit';
import type { PowerSyncDatabase } from '@powersync/node';
import type { PromptOverride } from '../runtime/adapter';
import type { Seat } from './lookups';
import type { makeRuns } from './runs';
import type { makeLookups } from './lookups';
import type { makeBlock } from './block';
import type { HostCtx } from './ctx';

export function makeTurnContext(ctx: HostCtx & {
  agents: Map<string, HostedAgent>;
  alog: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null, runId?: string | null) => LogFn;
  apiUrl: string;
  blockFor: ReturnType<typeof makeBlock>['blockFor'];
  brainBriefing: (subject: SubjectRef | null, dir: string) => string;
  db: PowerSyncDatabase;
  designerOverride: (a: { ch: { id: string; slug: string; workspace_id: string }; taskId: string | null; label: string; brief: string; dir: string; brainSubject: SubjectRef | null }) => Promise<PromptOverride>;
  ensureChatWorkspace: (threadId: string) => string;
  legSummary: (out: string) => string;
  narrate: ReturnType<typeof makeRuns>['narrate'];
  openRun: ReturnType<typeof makeRuns>['openRun'];
  ownerActorId: string;
  post: unknown;
  recordLegResult: (subject: SubjectRef, where: { channelId: string; taskId?: string | null }, leg: { role: string; label: string; turnId: string; out: string }) => void;
  resolveSeat: (parent: HostedAgent, channelId: string, role: AgentRole, scope?: { threadId?: string | null; taskId?: string | null }) => Promise<Seat>;
  seatLabel: ReturnType<typeof makeLookups>['seatLabel'];
  taskOf: ReturnType<typeof makeLookups>['taskOf'];
  workspace: string;
}) {
const { alog, apiUrl, blockFor, brainBriefing, db, designerOverride, ensureChatWorkspace, legSummary, narrate, openRun, ownerActorId, post, recordLegResult, resolveSeat, seatLabel, taskOf } = ctx;

// The marketer revising its drafts after a human requests a change (§4.5). It writes a `revise`
// block naming ONLY the drafts that change; the daemon applies each (content.revise for copy, +
// a regenerated on-brand image where asked) so the CARD updates — not just a chat acknowledgement.
// Returns the reply text, or null when there are no drafts yet (caller falls back to a plain turn).
// The card's "Try again" (§4.6): regenerate ONE draft's image from its existing brief — no LLM
// turn, just the designer's key + generateBrandImage. Records the outcome ON the card (thumb on
// success, image_error on failure) so the reason is never buried in a summary message again.

// task header + the NEWEST rows, rendered oldest→newest. "Threads are short and scoped" was the
// old comment's assumption, and past 40 messages its `asc limit 40` silently dropped the newest
// rows — INCLUDING the message that triggered the wake, so the agent answered an old conversation
// (2026-08-18 audit). Newest-kept + per-message caps bound it the direction assemble.ts trims:
// the live exchange stays whole, older context is context.
const THREAD_ROWS = 40;
const THREAD_FULL_RECENT = 6;
const THREAD_OLDER_CHARS = 600;
async function threadTranscript(agent: HostedAgent, t: ThreadTask): Promise<string> {
  const rows = await db.getAll<{ author_kind: string; author_id: string; body: string }>(
    `select author_kind, author_id, body from messages where task_id = ? order by created_at desc limit ${THREAD_ROWS}`,
    [t.id],
  );
  rows.reverse();
  const block = await blockFor(t.channel_id);
  const cutoff = rows.length - THREAD_FULL_RECENT;
  return (
    (block ? `[channel summary block]\n${block}\n\n` : '') +
    `[task #${t.number}: ${t.title}]\nstate: ${t.state}${t.description ? `\ndescription: ${t.description}` : ''}\n\n[thread]\n` +
    rows
      .map((r, i) => {
        const who = r.author_kind === 'agent' ? (r.author_id === agent.id ? 'you' : 'agent') : 'human';
        const body = i < cutoff && r.body.length > THREAD_OLDER_CHARS ? `${r.body.slice(0, THREAD_OLDER_CHARS)} […]` : r.body;
        return `${who}: ${body}`;
      })
      .join('\n')
  );
}

/**
 * The ORCHESTRATOR's fan-out (docs/harness/04) — the gap that made triage routing-only.
 *
 * `TOOL_KINDS.spawn` has always listed `'triage'`, but the orchestrator's toolset is built by
 * buildOrchestratorTools — a registry entirely separate from the bus — so the capability the
 * catalogue granted was never actually delivered. It could route work to a teammate, and it could
 * run `start_deep_work` (research legs: max 6, one level, its own model, research tools only), but
 * it could not fan out general subagents at all. No prompt could have reached it.
 *
 * A triage turn has no task, so the subject is the CHANNEL (or the conversation thread): the leg
 * works in a scratch dir and reports back, exactly like a worker's leg, and the orchestrator owns
 * the result the same way — it answers for everything its subtree produced.
 */
function orchSpawnFor(
  orch: HostedAgent,
  ch: { id: string; slug: string; workspace_id: string },
  threadId: string | null,
  parentRun: RunHandle,
  log: LogFn | undefined,
  // the budget a fan-out draws from follows the TURN, not the role: an owning turn funds real
  // work (25m/72k) where a routing turn funds a question (4m/24k). Passing the wrong one here is
  // how a three-way design round quietly becomes a one-way one.
  kind: TurnKind = 'triage',
): (i: { role: string; prompt: string; label?: string }) => Promise<{ ok: boolean; summary?: string; error?: string }> {
  let remaining = { ...TURN_BUDGETS[kind] };
  const subtree = new Subtree(parentRun.id || ch.id);
  return async (i) => {
    const label = (i.label ?? i.role).slice(0, 80);
    const decision = planSpawn(remaining, { role: i.role as AgentRole, prompt: i.prompt, label });
    if (!decision.ok || !decision.budget) return { ok: false, error: decision.reason ?? 'no budget left to fan out' };
    remaining = {
      wallMs: remaining.wallMs - decision.budget.wallMs,
      contextTokens: remaining.contextTokens - decision.budget.contextTokens,
    };
    const resolved = await resolveSeat(orch, ch.id, i.role as AgentRole, { threadId });
    const seated = resolved.agent;
    const run = await openRun(seated, { workspace: ch.workspace_id, channelId: ch.id, threadId }, {
      kind: 'leg', title: label, ...(parentRun.id ? { parentRunId: parentRun.id } : {}),
      step: 'starting', seat: seatLabel(resolved),
    });
    subtree.add({ turnId: run.id || label, role: i.role as AgentRole, label, state: 'running' });
    log?.({ kind: 'tool', phase: 'call', summary: `spawn ${i.role} · ${label} · ${Math.round(decision.budget.wallMs / 60_000)}m` });
    // the conversation's OWN brain workspace — legs of one thread share it, and it is the same
    // directory the thread's notes and result envelopes live beside (docs/harness/01 §3.2)
    const brainSubject: SubjectRef | null = threadId ? { kind: 'thread', id: threadId } : null;
    const dir = ensureChatWorkspace(threadId ?? ch.id);
    try {
      const cred = await resolveToken(apiUrl, ch.workspace_id, seated, ownerActorId);
      // a synthetic subject: promptOverride bypasses buildCodingPrompt entirely, so the leg needs
      // only enough of an ExecTask shape to be carried through the adapter seam
      const subject = { id: ch.id, number: 0, title: label, channel_id: ch.id, requirements: null, repo_id: null, base_ref: null, branch: null } as unknown as ExecTask;
      // the leg logs under ITS OWN seat and run id — sharing the parent's logger wrote every
      // subagent's tool calls under the orchestrator's agent_id and run_id, one flat stream
      // that no surface could attribute or split (docs/29).
      const legLog = run.id ? alog(seated, null, ch.slug, run.id) : (log ?? (() => {}));
      // A DESIGNER leg draws the way the seated designer draws (docs/29 §4d). Rex owns the whole
      // flow and hires a designer into its design phase — so that leg has to reach the same
      // machinery, or "owned design" would silently mean worse design: plain HTML where the room
      // expected an editable Claude Design project. `designerOverride` carries the three things
      // that make the difference — the design prompt, the designer's system prompt, and the
      // `claudeDesign` flag that is the ONLY thing unlocking `mcp__claude-design__*`.
      const override = i.role === 'designer'
        ? await designerOverride({ ch, taskId: await taskOf(threadId), label, brief: i.prompt, dir, brainSubject })
        : { prompt: `${i.prompt}\n\nYou are a subagent working ONE piece of a larger question for ${orch.name}, the orchestrator of #${ch.slug}. Do exactly this piece, then report what you found and how you know. You cannot create, offer or route board work — your parent owns this and reports for you.${brainBriefing(brainSubject, dir)}` };
      // the Claude Design project URL arrives in a TOOL RESULT, before the model's summary —
      // caught here and announced by the OWNER, since the leg has no board identity to post with
      const projectWatch = claudeDesignProjectWatch();
      let projectUrl: string | null = null;
      const watchedLog: LogFn = (rec) => {
        narrate(run, legLog)(rec);
        if (!override.claudeDesign || projectUrl) return;
        const url = projectWatch.observe(rec);
        if (url) projectUrl = url;
      };
      const out = await withTimeout(
        runtimeFor(seated.runtime).runQuery(
          seated, subject, dir, cred.token ?? '', null, false, undefined, watchedLog,
          undefined, undefined, undefined, undefined, undefined, undefined,
          override,
        ),
        decision.budget.wallMs,
        `subagent "${label}" exceeded its ${Math.round(decision.budget.wallMs / 60_000)}m slice`,
      );
      if (projectUrl && threadId) {
        await post('/v1/messages', { kind: 'agent', id: orch.id, role: 'orchestrator' }, {
          workspace: ch.workspace_id, channel: ch.id, threadId,
          body: `Claude Design project ready: [Open the editable project](${projectUrl}). Keep editing there; I'll sync the review snapshot here when it is ready.`,
        }).catch(() => {});
      }
      subtree.settle(run.id || label, 'done', legSummary(out));
      await run.settle('done', legSummary(out));
      // file it in the THREAD's brain — this path recorded nothing before, so a conversation's
      // fan-out lost everything it learned the moment the turn ended
      if (brainSubject) recordLegResult(brainSubject, { channelId: ch.id }, { role: i.role, label, turnId: run.id || label, out });
      return { ok: true, summary: out };
    } catch (err) {
      const why = err instanceof Error ? err.message.slice(0, 200) : 'the subagent failed';
      subtree.settle(run.id || label, 'failed', why);
      await run.settle('failed', why);
      log?.({ kind: 'tool', phase: 'result', summary: `leg "${label}" failed: ${why}`, level: 'warn' });
      return { ok: false, error: why };
    }
  };
}

  return { threadTranscript, orchSpawnFor };
}
