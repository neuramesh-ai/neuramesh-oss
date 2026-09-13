// THE FAN-OUT — a parent agent spawning subagent legs, and what comes back (docs/harness/04).
//
// Four functions split out of startAgentHost: which seat a leg runs as, the briefing it starts
// from, the spawn itself, and how a result is recorded against the parent.
//
// They are one module because a leg is only meaningful relative to its parent. The spawn records
// its parent's run id so the leg hangs off it — without that, `parentRunOf` returns null and
// every subagent opens as a ROOT run, which renders as separate top-level cards even though the
// fan-out ran correctly.
import type { LogFn } from '../agentlog';
import { resolveToken, runtimeFor } from '../agents';
import type { ExecTask, HostedAgent } from '../agents';
import { type SubjectRef } from '../harness/brain';
import { Subtree, planSpawn } from '../harness/subagents';
import { type Seat } from './lookups';
import { withTimeout } from './turnkit';
import { searchXText, type ApiGetFn } from './searchx';
import { type AgentRole } from '@neuramesh/shared';
import { join } from 'node:path';
import type { PowerSyncDatabase } from '@powersync/node';
import type { Brain } from '../harness/brain';
import type { makeRuns } from './runs';
import type { makeStaffing } from './staffing';
import type { makeWorkspace } from './workspace';

export function makeLegs(ctx: {
  db: PowerSyncDatabase;
  apiUrl: string;
  ownerActorId: string;
  brain: Brain;
  /** the run this leg hangs off — null makes every subagent a ROOT run (docs/harness/04) */
  parentRunOf: (taskId: string) => string | null;
  openRun: ReturnType<typeof makeRuns>['openRun'];
  narrate: ReturnType<typeof makeRuns>['narrate'];
  seatFor: ReturnType<typeof makeStaffing>['seatFor'];
  activePackRoles: ReturnType<typeof makeStaffing>['activePackRoles'];
  seatLabel: (seat: Seat) => string;
  legSummary: (out: string) => string;
  workspaceListing: ReturnType<typeof makeWorkspace>['workspaceListing'];
  workspaceOf: (channelId: string) => Promise<string>;
  apiGet: ApiGetFn;
}) {
  const { db, apiUrl, ownerActorId, brain, parentRunOf, openRun, narrate, seatFor,
          activePackRoles, seatLabel, legSummary, workspaceListing, workspaceOf, apiGet } = ctx;

  // ── Subagents: the fan-out, owned by its parent (docs/harness/04) ───────────────────────────
  // Founder ruling 2026-07-31: an agent may fan out as many subagents as the work needs, to any depth,
  // and if it fans them out IT OWNS THAT WORKFLOW. Three things make that safe, and all three are here:
  //
  //  1. A subagent has NO `agents` row. It is a `runs` row with a parent, so it has no board identity
  //     to act with — the FSM needs not one new guard, because there is nothing to guard against.
  //  2. Its toolset is `toolsForTurn('leg', …)`, which contains no board command by construction.
  //  3. Its budget is a SLICE of the parent's remainder, so unbounded depth still halts — on physics
  //     rather than on a permission a model could argue with.
  //
  // The parent's turn cannot settle while a child runs: `spawnLeg` is awaited by the tool call, and the
  // queue settles the parent only after its flow returns.
  function spawnLegFor(
    parent: HostedAgent,
    where: { workspace: string; channelId: string; taskId?: string | null; threadId?: string | null },
    dir: string,
    task: ExecTask,
    budget: { wallMs: number; contextTokens: number },
    log: LogFn | undefined,
    _depth: number,
  ): (i: { role: string; prompt: string; label?: string }) => Promise<{ ok: boolean; summary?: string; error?: string }> {
    const subtree = new Subtree(task.id);
    let remaining = { ...budget };
    return async (i) => {
      const label = (i.label ?? i.role).slice(0, 80);
      const decision = planSpawn(remaining, { role: i.role as AgentRole, prompt: i.prompt, label });
      if (!decision.ok || !decision.budget) return { ok: false, error: decision.reason ?? 'no budget left to fan out' };
      remaining = {
        wallMs: remaining.wallMs - decision.budget.wallMs,
        contextTokens: remaining.contextTokens - decision.budget.contextTokens,
      };
      // Seat the child by ROLE through the SAME path a level-1 agent uses (docs/10) — a role is model +
      // prompt configuration, never a permission tier, which is why this needs no new config surface.
      const resolved = await resolveSeat(parent, where.channelId, i.role as AgentRole);
      const seated = resolved.agent;
      const runKey = `${task.id}:leg:${subtree.all().length}`;
      // The seat rides its own COLUMN now (0103) rather than squatting in `step`. It had to: `step`
      // is the live activity line, so `narrate` overwrote the seat within seconds of the leg starting
      // and "which config is this running on" was gone for the rest of the run.
      const run = await openRun(seated, where, {
        kind: 'leg', title: label, parentRunId: parentRunOf(task.id) ?? undefined,
        step: 'starting', seat: seatLabel(resolved),
      });
      subtree.add({ turnId: run.id || runKey, role: i.role as AgentRole, label, state: 'running' });
      log?.({ kind: 'tool', phase: 'call', summary: `leg "${label}" · ${i.role} · ${seated.model} · ${Math.round(decision.budget.wallMs / 60_000)}m` });
      try {
        const cred = await resolveToken(apiUrl, where.workspace, seated, ownerActorId);
        const out = await withTimeout(
          runtimeFor(seated.runtime).runQuery(
            // narrate: the child's activity lines become ITS run's live step, so the leg row says what
            // the subagent is actually doing rather than what it was doing at t=0
            seated, task, dir, cred.token ?? '', null, false, undefined, narrate(run, log ?? (() => {})),
            undefined, undefined, undefined, undefined, undefined, undefined,
            // a caller-authored turn: the child works ONE piece and reports back to its parent
            { prompt: `${i.prompt}\n\nYou are a subagent working ONE piece of a larger task for ${parent.name}. Do exactly this piece, then report what you produced and how you validated it. You cannot submit, accept or file board work — your parent owns this workflow and reports for you.${brainBriefing({ kind: 'task', number: task.number }, dir)}` },
            undefined, undefined, undefined, undefined,
            // the leg's REAL kind on the bus (TOOL_KINDS can finally grant a leg something), and
            // the X read closed over this room — host/searchx.ts, the one implementation
            { turnKind: 'leg', searchX: (q) => searchXText(apiGet, { kind: 'agent', id: seated.id, ...(seated.role ? { role: seated.role } : {}) }, { workspaceId: where.workspace, channelId: where.channelId }, q.query, q.max) },
          ),
          decision.budget.wallMs,
          `subagent "${label}" exceeded its ${Math.round(decision.budget.wallMs / 60_000)}m slice`,
        );
        subtree.settle(run.id || runKey, 'done', legSummary(out));
        await run.settle('done', legSummary(out));
        // The subagent's result lands in the SUBJECT's brain, two ways (docs/harness/01, /02):
        //   · an AgentMessage envelope — its first real use. A parent could previously only re-read
        //     prose it had concatenated itself; now `collect()` gives it typed results.
        //   · a note, so the NEXT agent on this task inherits what this one found. Nothing wrote a
        //     brain note before, which is why "a new agent starts warm" was still unfulfilled.
        recordLegResult({ kind: 'task', number: task.number }, { channelId: task.channel_id, taskId: task.id }, { role: i.role, label, turnId: run.id || runKey, out });
        return { ok: true, summary: out };
      } catch (err) {
        // a dead leg is REPORTED, never hidden — partial work the human can see the holes in beats a
        // tidy answer that quietly covered two angles instead of three
        const why = err instanceof Error ? err.message.slice(0, 200) : 'the subagent failed';
        subtree.settle(run.id || runKey, 'failed', why);
        await run.settle('failed', why);
        log?.({ kind: 'tool', phase: 'result', summary: `leg "${label}" failed: ${why}`, level: 'warn' });
        return { ok: false, error: why };
      }
    };
  }

  /**
   * File a finished subagent's result in its subject's brain.
   *
   * Keyed on the SUBJECT rather than a task, because that is the whole point of the layout
   * (docs/harness/01 §3.2) and the task-shaped signature was quietly excluding the case that needed
   * it most: an orchestrator's fan-out in a CONVERSATION filed nothing at all, so five research legs
   * finished, their findings went into one synthesized message, and everything they read and decided
   * evaporated when the turn ended — §2.2, still live on the thread path.
   *
   * Best-effort by construction: a brain that cannot be written must never fail a turn that already
   * did its work. Wrapped so a full disk costs the RECORD, not the result.
   */
  function recordLegResult(
    subject: SubjectRef,
    where: { channelId: string; taskId?: string | null },
    leg: { role: string; label: string; turnId: string; out: string },
  ): void {
    try {
      const b = brain.open(subject);
      b.appendMessage({
        id: crypto.randomUUID(),
        v: 1,
        from: { kind: 'subagent', id: leg.role, turnId: leg.turnId },
        to: { kind: 'parent' },
        kind: 'result',
        subject: { workspaceId: '', channelId: where.channelId, ...(where.taskId ? { taskId: where.taskId } : {}) },
        // prose for the human, structure for the harness — the projection rule (docs/harness/02 §3.1)
        body: { text: legSummary(leg.out), data: { kind: 'generic', role: leg.role, label: leg.label, summary: leg.out.slice(0, 4_000) } },
        at: new Date().toISOString(),
      });
      // one note per leg, named for the leg, so an arriving agent reads them as a set
      b.writeNote(`leg-${leg.label}`, `# ${leg.label} (${leg.role})\n\n${leg.out.slice(0, 8_000)}\n`);
    } catch { /* the work stands; only the record is lost */ }
  }

  /**
   * What a subagent is told about the brain it is working in.
   *
   * The gap this closes: both spawn sites said "in your working directory" and stopped. A child had
   * no way to know what was already there, what earlier agents had established, or what its siblings
   * had produced — so a fan-out re-read the same sources n times and wrote n unrelated files.
   *
   * Deliberately a LISTING plus a pointer, not the content: the child has Read and can open what it
   * needs, and inlining five notes into every sibling's prompt is how a fan-out's context cost turns
   * quadratic.
   */
  function brainBriefing(subject: SubjectRef | null, dir: string): string {
    const lines = [`Your working directory is ${dir} — it is SHARED with everyone else working this subject, and it persists between turns.`];
    if (!subject) return `\n\n${lines[0]} Write what you produce there.`;
    try {
      const b = brain.open(subject);
      const files = workspaceListing(subject, 20);
      const notes = b.notes();
      const results = b.messages().filter((m) => m.kind === 'result');
      if (files.length) lines.push(`Already in it: ${files.map((f) => f.name).join(', ')}. Read what is relevant before you start, and EDIT an existing file rather than writing a near-duplicate beside it.`);
      else lines.push('It is currently empty.');
      if (notes.length) lines.push(`Working notes from earlier agents on this subject (read them — they are why this is shared): ${notes.map((n) => n.name).join(', ')}, under ${join(b.path, 'notes')}.`);
      if (results.length) {
        const labels = results.map((m) => (m.body.data as { label?: string } | undefined)?.label).filter(Boolean);
        lines.push(`${results.length} sibling result${results.length === 1 ? '' : 's'} already filed${labels.length ? ` (${labels.slice(-6).join(', ')})` : ''} — do not redo that ground.`);
      }
    } catch { /* a brain we cannot read still leaves the child a usable directory */ }
    lines.push('Write what you produce into that directory so your parent and the next agent inherit it.');
    return `\n\n${lines.join(' ')}`;
  }

  async function resolveSeat(parent: HostedAgent, channelId: string, role: AgentRole): Promise<Seat> {
    const base = await seatFor(parent, channelId);
    // a live, non-retired agent of this role registered to THIS channel — the room's own specialist
    const [specialist] = await db.getAll<{ id: string; name: string; model: string; brief: string | null; runtime: string | null }>(
      `select a.id, a.name, a.model, a.brief, a.runtime from agents a
         join agent_channels ac on ac.agent_id = a.id
        where ac.channel_id = ? and a.role = ? and a.retired_at is null and a.id != ?
        order by a.created_at limit 1`,
      [channelId, role, parent.id],
    ).catch(() => [] as Array<{ id: string; name: string; model: string; brief: string | null; runtime: string | null }>);
    if (specialist?.model) {
      return {
        // the runtime stays the PARENT's: a leg is delivered through the parent's adapter, and
        // swapping runtimes mid-turn is a different (and unbuilt) thing from swapping models
        agent: { ...base, role, model: specialist.model, ...(specialist.brief ? { brief: specialist.brief } : {}) },
        from: { id: specialist.id, name: specialist.name },
      };
    }
    const roles = await activePackRoles(await workspaceOf(channelId));
    const model = roles?.[role];
    return { agent: model ? { ...base, role, model } : { ...base, role }, from: null };
  }

  return { spawnLegFor, recordLegResult, brainBriefing, resolveSeat };
}
