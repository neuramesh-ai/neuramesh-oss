// Deep work (docs/29) — the fan-out that outlives the wake that started it, the brief each leg
// is staged with, and the read-only study pass. Split out of host/workspace.ts.
import { runtimeFor } from '../agents';
import type { HostedAgent } from '../agents';
import { MAX_LEG_CONCURRENCY, fanoutStep, mapCapped, type WorkLeg } from '../runs';
import { TURN_BUDGETS } from '@neuramesh/shared';

import { briefFileName } from '../library';

import { claudePathOption, providerEnv } from '../runtime/adapter';
import { drainQuery, withTimeout } from './turnkit';



import { type SubjectRef } from '../harness/brain';
import { type LibDoc } from './orchtools';
import { type LogFn } from '../agentlog';
import type { PowerSyncDatabase } from '@powersync/node';
import type { Brain } from '../harness/brain';
import type { makeRuns } from './runs';
import type { HostCtx } from './ctx';

export function makeDeepWork(ctx: HostCtx & {
  libraryDocs: (channelId: string, limit?: number, scope?: 'room' | 'project' | 'workspace') => Promise<LibDoc[]>;
  alog: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null, runId?: string | null) => LogFn;
  brain: Brain;
  claimed: { has: (id: string) => boolean; add: (id: string) => unknown; delete: (id: string) => boolean };
  db: PowerSyncDatabase;
  narrate: ReturnType<typeof makeRuns>['narrate'];
  openRun: ReturnType<typeof makeRuns>['openRun'];
  post: any;
  recordLegResult: (subject: SubjectRef, where: { channelId: string; taskId?: string | null }, leg: { role: string; label: string; turnId: string; out: string }) => void;
  wake: (agent: HostedAgent, m: { id: string; channel_id: string; body: string; thread_id?: string | null }) => Promise<void>;
  workspace: string;
}) {
const { alog, narrate, openRun, post, recordLegResult , libraryDocs } = ctx;

// ── The channel library, read from the local replica ──────────────────────────────────────
// The gap this closes: the orchestrator could route work about a product it could not read
// anything about. Its registry had no way to reach `artifacts` at all, so when a human asked
// "did you check the channel library", the honest answer was no — and rex instead blamed
// memory and a disconnected Drive, which is the worse failure of the two.
//
// Nothing new syncs: `artifacts.inline_content` is already in the replica (client-core
// schema), and the marketing bootstrap already reads a doc out of it by name. This only
// generalizes that read so every orchestrator turn — and every research leg — can do it.

/**
 * The architect's read-only turn over its study workspace (see openPlanningWorkspace).
 *
 * Same shape as deepWorkQuery, different tool set: no web, and `cwd` is the staged clone
 * rather than a temp dir, so Read/Grep/Glob land on the real code and the approved mockups.
 * Write/Edit/Bash are refused AT THE SDK — planning must never mutate anything, and that is
 * enforced rather than requested. Returns null for runtimes with no read-tool seam, so the
 * mixture-of-agents falls back to its tool-less draft instead of silently degrading.
 */
function readOnlyStudy(agent: HostedAgent, dir: string, token: string, log?: LogFn):
  ((system: string, user: string) => Promise<string>) | null {
  if (agent.runtime === 'codex' || agent.runtime === 'gemini') return null;
  return async (system, user) => {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    return drainQuery(
      query({
        prompt: user,
        options: {
          ...claudePathOption(),
          env: providerEnv('anthropic', token),
          model: agent.model,
          maxTurns: 24,
          allowedTools: ['Read', 'Grep', 'Glob'],
          disallowedTools: ['Write', 'Edit', 'NotebookEdit', 'Bash', 'Task', 'WebSearch', 'WebFetch'],
          permissionMode: 'bypassPermissions',
          cwd: dir,
          systemPrompt: system,
        },
      }) as AsyncIterable<any>,
      '',
      log,
    );
  };
}

// ── Deep work (docs/29 §3): the ONE way an agent may keep working past its own reply ─────
//
// The failure this exists to end: an orchestrator that says "I'll report back in ~10 minutes"
// when its turn is capped at four and nothing can post afterwards. Here the promise is backed
// by a row — the run outlives the wake, its legs are visible while they work, and the report
// is posted by the daemon, not by a model hoping to be alive later.
//
// Web tools only. A research leg has NO business writing files or running commands on the
// user's machine, so that's enforced at the SDK (disallowedTools), not asked for in a prompt.
async function deepWorkQuery(agent: HostedAgent, prompt: string, token: string, log?: LogFn, dir?: string | null): Promise<string> {
  if (agent.runtime === 'codex' || agent.runtime === 'gemini') {
    // honest degradation: those adapters expose no web tools through our seam, so a leg
    // answers from what the model already knows. Weaker — never silently passed off as research.
    return runtimeFor(agent.runtime).streamTurn(agent, '', prompt, token, log);
  }
  const os = await import('node:os');
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  return drainQuery(
    query({
      prompt,
      options: {
        ...claudePathOption(),
        env: providerEnv('anthropic', token),
        model: agent.model,
        maxTurns: 16,
        allowedTools: ['WebSearch', 'WebFetch', 'Read', 'Grep', 'Glob'],
        disallowedTools: ['Write', 'Edit', 'NotebookEdit', 'Bash', 'Task'],
        permissionMode: 'bypassPermissions',
        // the brief dir when the caller staged one (see stageBrief): Read/Grep/Glob are
        // already allowed, so the team's own docs need no new tool to become reachable
        cwd: dir ?? os.tmpdir(),
        systemPrompt:
          'You are researching one narrow angle for a teammate. Search the web, read the best sources, and report what you actually found. ' +
          (dir
            ? 'Your working directory holds the TEAM\'S OWN documents about the subject — read them FIRST (Glob/Read) and treat them as ground truth. They tell you which product this actually is; a web search for the same name will often surface a different company, and a report about the wrong company is worthless. Where the web and these docs disagree about what the product is, the docs win. '
            : '') +
          'Lead with the findings, cite the source domain inline, and say plainly when the evidence is thin — an honest "little evidence either way" is worth more than a confident guess. Under 400 words.',
      },
    }) as AsyncIterable<any>,
    '(no findings)',
    log,
  );
}

/**
 * Stage the room's library into a scratch dir so a research leg can READ it.
 *
 * The bug this ends: five legs researched a product from the open web, found two unrelated
 * things by the same name, and reported on the wrong company — while the brand docs sat in
 * the same room's library the whole time. The legs had `Read` all along; they had nothing to
 * point it at. Returns null when the library is empty, so the no-docs path is byte-identical.
 */
async function stageBrief(channelId: string, runId: string): Promise<string | null> {
  const docs = (await libraryDocs(channelId)).filter((d) => (d.inline_content ?? '').trim());
  if (!docs.length) return null;
  const os = await import('node:os');
  const { join } = await import('node:path');
  const fs = await import('node:fs/promises');
  const dir = join(os.tmpdir(), `nm-brief-${runId.replace(/-/g, '').slice(0, 12)}`);
  await fs.mkdir(dir, { recursive: true });
  for (const d of docs) {
    await fs.writeFile(join(dir, briefFileName(d.name)), d.inline_content ?? '', 'utf8').catch(() => {});
  }
  return dir;
}

/**
 * Opens a `work` run and returns immediately; the legs run DETACHED, so the caller's turn can
 * end while the work carries on. Returns the run id (or null if the row couldn't be opened —
 * in which case no promise is made, by construction).
 */
async function startDeepWork(
  agent: HostedAgent,
  ch: { id: string; slug: string; workspace_id: string },
  where: { threadId?: string | null; taskId?: string | null },
  title: string,
  legs: WorkLeg[],
  token: string,
): Promise<string | null> {
  const parent = await openRun(
    agent,
    { workspace: ch.workspace_id, channelId: ch.id, threadId: where.threadId ?? null, taskId: where.taskId ?? null },
    { kind: 'work', title, total: legs.length + 1, step: 'starting the legs' },
  );
  if (!parent.id) return null; // no row ⇒ no promise: the tool tells the model to answer now instead

  void (async () => {
    const runId = crypto.randomUUID();
    const log = alog(agent, null, ch.slug, runId);
    log({ kind: 'wake', phase: 'deep_work', summary: `deep work started: ${title} (${legs.length} legs)` });
    // the team's own docs, on disk, before a single leg starts (see stageBrief)
    const brief = await stageBrief(ch.id, parent.id ?? runId).catch(() => null);
    // deep work outlives its turn, so its findings have to outlive it too — filed under the
    // conversation that asked for them. A task-thread run keys on the thread it renders in.
    const deepSubject: SubjectRef | null = where.threadId ? { kind: 'thread', id: where.threadId } : null;
    if (brief) log({ kind: 'tool', phase: 'inject', summary: `staged the room library for the legs to read` });
    const live = new Set<string>();
    let done = 0;
    const findings: string[] = [];
    const bump = () => parent.step(fanoutStep(done, legs.length, [...live]), done);
    try {
      await mapCapped(legs, MAX_LEG_CONCURRENCY, async (leg) => {
        const legRun = await openRun(
          agent,
          { workspace: ch.workspace_id, channelId: ch.id, threadId: where.threadId ?? null, taskId: where.taskId ?? null },
          { kind: 'leg', title: leg.name, parentRunId: parent.id, step: 'starting' },
        );
        live.add(leg.name);
        await bump();
        try {
          // the leg logs under its OWN run id, so its activity can be read back on its own
          // (docs/29). Sharing the parent's logger is what made five subagents one flat,
          // unattributed stream that no surface could split.
          const legLog = legRun.id ? alog(agent, null, ch.slug, legRun.id) : log;
          const out = await withTimeout(deepWorkQuery(agent, leg.prompt, token, narrate(legRun, legLog), brief), TURN_BUDGETS.leg.wallMs, `leg "${leg.name}" timed out`);
          findings.push(`### ${leg.name}\n\n${out.trim()}`);
          await legRun.settle('done', out.trim().split('\n').find((l) => l.trim())?.slice(0, 200) ?? 'done');
          // the angle's findings survive the run: a note + a result envelope in the thread's
          // brain, so a re-woken orchestrator reads what was found instead of re-commissioning it
          if (deepSubject) recordLegResult(deepSubject, { channelId: ch.id, taskId: where.taskId ?? null }, { role: 'worker', label: leg.name, turnId: legRun.id || leg.name, out });
        } catch (err) {
          const why = err instanceof Error ? err.message.slice(0, 200) : 'the leg failed';
          // a dead leg is REPORTED, not hidden: partial research the human can see the
          // holes in beats a tidy report that quietly covered four angles instead of five
          findings.push(`### ${leg.name}\n\n_(this angle failed: ${why})_`);
          await legRun.settle('failed', why);
          log({ kind: 'result', phase: 'error', summary: `leg "${leg.name}" failed: ${why}`, level: 'warn' });
        }
        live.delete(leg.name);
        done += 1;
        await bump();
      });

      await parent.step('synthesizing the report', legs.length);
      const synthesis = await withTimeout(
        deepWorkQuery(
          agent,
          `You asked ${legs.length} research angles about: "${title}".\n\nHere is what came back:\n\n${findings.join('\n\n')}\n\n` +
            'Write the report for a founder who will act on it today. Open with the 3 findings that actually change what they should do, each with its evidence. ' +
            'Then the rest, grouped. Name what the evidence does NOT support. Markdown, no preamble, no restating the brief.',
          token,
          log,
          brief,
        ),
        TURN_BUDGETS.deep.wallMs / 5,
        'synthesis timed out',
      );
      await post('/v1/messages', { kind: 'agent', id: agent.id }, {
        workspace: ch.workspace_id, channel: ch.id,
        body: synthesis.trim(),
        ...(where.taskId ? { taskId: where.taskId } : {}),
        ...(where.threadId ? { threadId: where.threadId } : {}),
      }).catch(() => {});
      await parent.settle('done', `${legs.length} angle${legs.length === 1 ? '' : 's'} · report posted`);
      log({ kind: 'wake', phase: 'deep_work', summary: `deep work done: ${title}` });
    } catch (err) {
      const why = err instanceof Error ? err.message.slice(0, 200) : 'the work failed';
      await parent.settle('failed', why);
      log({ kind: 'wake', phase: 'error', summary: `deep work failed: ${why}`, level: 'error' });
      // the human was promised a report. Saying nothing is how the original bug felt from
      // their side — a failure they can see is a different, survivable thing.
      await post('/v1/messages', { kind: 'agent', id: agent.id }, {
        workspace: ch.workspace_id, channel: ch.id,
        body: `I couldn't finish “${title}” — ${why}. Nothing was posted; ask me to retry and I'll pick it up again.`,
        ...(where.taskId ? { taskId: where.taskId } : {}),
        ...(where.threadId ? { threadId: where.threadId } : {}),
      }).catch(() => {});
    } finally {
      if (brief) await (await import('node:fs/promises')).rm(brief, { recursive: true, force: true }).catch(() => {});
    }
  })();

  return parent.id;
}

  return { deepWorkQuery, stageBrief, startDeepWork, readOnlyStudy };
}
