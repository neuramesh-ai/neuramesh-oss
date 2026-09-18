// THE DESIGN FLOW (docs/14) — the designer drawing a round, and the notify that tells the room
// a round is waiting. approve_design is HUMAN-ONLY and lives on the server; nothing here can
// approve anything. Split out of host/flows.ts.
import { starterFallback, unavailableOf, whyUnavailable } from './starterfallback';
import { designRoundChanged, resolveToken, runtimeFor, stagePriorDesignRound } from '../agents';
import type { ExecTask, HostedAgent, OfferedTask, SkillRef, DesignTask } from '../agents';


import { buildDesignPrompt, claudeDesignPromptBlock, designProviderQuestionBlock, designSystemPrompt, type DesignProvider, type ClaimVerdict } from '@neuramesh/shared';

import { designerBeatTitles } from '../beats';

import { designBlocks } from './plan';

import { cachePath, type SubjectRef } from '../harness/brain';

import { claudeDesignNeedsAuthorization, claudeDesignProjectWatch } from '../claudedesign';

import { git, localRepoRemote } from './gh';








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
import { makeDesignNotify } from './designnotify';



export function makeDesignFlow(ctx: HostCtx & {
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
const { db, apiUrl, workspace, ownerActorId, post, 
        beatCursor, 
        alog, arun, 
        
        seatFor, setStatus, blockFor } = ctx;
// The guard registry's fields keep their short names, exactly as they read inside startAgentHost.
const { designed, 
 } = ctx.guards;

const { orchDesignNotify } = makeDesignNotify(ctx);

// The designer's flow (docs/14): study the repo's design system from a shallow
// read-only clone, draft self-contained HTML mockups under .nm-evidence/design/,
// and propose them (designing -> design_review) for the HUMAN approval gate.
// Mirrors architectFlow's shape — pickup ack, credential resolve, echo stub,
// failure surfaced to the thread, guard released for a retry.
async function designerFlow(designer: HostedAgent, t: DesignTask, designProvider: DesignProvider) {
  designer = await seatFor(designer, t.channel_id, { taskId: t.id }); // per-project + per-thread brains (docs/10)
  const actor = { kind: 'agent', id: designer.id, role: 'designer' };
  const beats = beatCursor(actor, t.id); // inert until declare(); the catch can fail() it safely
  let chRef: { id: string; slug: string; workspace_id: string } | undefined;
  let dlog: LogFn | undefined;
  try {
    const ch = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [t.channel_id]);
    chRef = ch;
    if (designProvider === 'claude-design' && designer.runtime !== 'claude-code') {
      throw new Error(`Claude Design requires Iris to use a Claude model; @${designer.name} currently runs ${designer.runtime}. Switch the designer brain to Claude or use Iris quick mockups.`);
    }
    let cred = await resolveToken(apiUrl, ch.workspace_id, designer, ownerActorId);
    // the seat cannot run → the Starter door (host/starterfallback.ts): a routine's unit designs on
    // the Starter brain; a human's gets the reason and the card, and the unit blocks until they act
    const gap = unavailableOf(cred, designer.runtime);
    if (gap) {
      const next = await starterFallback(designer, gap, { workspace: ch.workspace_id, channelId: ch.id, taskId: t.id, taskNumber: t.number });
      if (!next) {
        await post('/v1/commands', actor, { type: 'task.block', taskId: t.id, reason: `@${designer.name} cannot run here. ${whyUnavailable(gap, designer.runtime)} Sign in again, or switch this conversation to the NeuraMesh brain, then re-route #${t.number} to design.` }).catch((e) => console.error(`task_block #${t.number} failed:`, e));
        setStatus(designer, 'online');
        return;
      }
      designer = next; cred = await resolveToken(apiUrl, ch.workspace_id, designer, ownerActorId);
    }
    const token = cred.token ?? ''; // apikey → the key; subscription → '' (providerEnv strips keys)
    const live = process.env['NM_AGENT_MODE'] !== 'echo' && cred.authMode !== 'none';
    setStatus(designer, 'working');
    let checklist: string[] = [];
    try { checklist = JSON.parse(t.requirements ?? '[]') as string[]; } catch { /* none */ }
    // a rework (revise_design bounced it back) folds in the human's feedback
    const feedback = await db.getAll<{ body: string }>(
      `select body from messages where task_id = ? and author_kind = 'human' order by created_at desc limit 4`,
      [t.id],
    );
    const notes = feedback.map((f) => f.body).reverse().join('\n');
    // round = prior proposals + 1 — versions the mockup names (mirrors plan versioning)
    const prior = await db.getAll<{ name: string }>(`select name from artifacts where task_id = ? and kind = 'design'`, [t.id]).catch(() => [] as Array<{ name: string }>);
    const round = prior.reduce((m, a) => Math.max(m, Number(/^design-mockup-v(\d+)-/.exec(a.name)?.[1] ?? 0)), 0) + 1;
    // Beats: the designer's two daemon-observable work milestones (docs/17) — study (the
    // repo clone) → draft+render (the design run). Live runs only; the coding-CLI internals
    // (per-mockup render/verify) are Slice 4 territory, and the proposal is the FSM
    // transition to design_review, not a work beat. A rework round declares rework-named
    // titles: the fresh run_id alone left the tracker pixel-identical to round 1.
    await beats.declare('designing', designerBeatTitles(round), live);
    const { log: runLog } = arun(designer, { id: t.id, number: t.number, channel_id: t.channel_id }, ch.slug);
    dlog = runLog;
    if (live) {
      await post('/v1/messages', actor, {
        workspace: ch.workspace_id, channel: ch.id, taskId: t.id,
        // same ruling as the provider question above: a designer subagent drafts the ROUND,
        // it does not pick up the task — the orchestrator owns it throughout
        body: designProvider === 'claude-design'
          ? `${designer.name} here — I'm drafting round ${round} of #${t.number} in Claude Design. Keep editing there; when the design is ready, I'll sync the exported snapshot here for your review. Nothing is planned or built before you approve it.`
          : `${designer.name} here — I'm ${round > 1 && notes ? `reworking round ${round} of #${t.number} with your feedback` : `studying the existing design system before drafting round ${round} of #${t.number}`}. The mockups land in this thread for your approval.`,
      }).catch(() => {});
      runLog({ kind: 'lifecycle', phase: 'claimed', summary: `picked up #${t.number} to design (round ${round})` });
    }
    let mockups: Array<{ name: string; html: string }> = [];
    let summary = '';
    let externalDesignUrl: string | null = null;
    if (live) {
      const { join } = await import('node:path');
      const { mkdir, rm, readdir, readFile } = await import('node:fs/promises');
      const work = cachePath('design', `nm-${t.number}`);
      await rm(work, { recursive: true, force: true }).catch(() => {});
      await mkdir(work, { recursive: true });
      // study material: a shallow read-only clone of the task's repo (never the
      // user's working checkout; discarded after the proposal — nothing to leak)
      let dir = work;
      let repoBacked = false;
      if (t.repo_id) {
        const repo = await db.get<{ clone_url: string | null; local_path: string | null; default_branch: string | null }>(
          `select clone_url, local_path, default_branch from repos where id = ?`, [t.repo_id],
        ).catch(() => null);
        let cloneUrl = repo?.clone_url ?? null;
        if (!cloneUrl && repo?.local_path) cloneUrl = await localRepoRemote(repo.local_path).catch(() => '');
        const ref = t.base_ref || repo?.default_branch || 'main';
        if (cloneUrl) {
          try {
            await git(['clone', '--depth', '1', '--branch', ref, cloneUrl, join(work, 'repo')]);
            dir = join(work, 'repo');
            repoBacked = true;
          } catch (err) {
            runLog({ kind: 'exec', phase: 'study', summary: `couldn't clone the repo to study (${err instanceof Error ? err.message.slice(0, 120) : 'error'}) — designing from the brief instead`, level: 'warn' });
          }
        }
      }
      await mkdir(join(dir, '.nm-evidence', 'design'), { recursive: true });
      // rework continuity: put round N-1 back on disk so this round edits it
      const priorRound = await stagePriorDesignRound(db, t.id, dir);
      if (priorRound.names.length) {
        runLog({ kind: 'exec', phase: 'study', summary: `round ${priorRound.round} staged for edit (${priorRound.names.join(', ')}) — reworking, not redrawing` });
      }
      const block = await blockFor(t.channel_id);
      const basePrompt = buildDesignPrompt(
        designBlocks(),
        { number: t.number, title: t.title, description: t.description, requirements: JSON.stringify(checklist) },
        { repoBacked, feedback: notes || null, channelBlock: block, priorMockups: priorRound.names, priorRound: priorRound.round },
      );
      const prompt = designProvider === 'claude-design'
        ? `${basePrompt}\n\n${claudeDesignPromptBlock(t.number, t.title)}`
        : basePrompt;
      const execT: ExecTask = { id: t.id, number: t.number, title: t.title, channel_id: t.channel_id, repo_id: null, base_ref: null, branch: null, requirements: JSON.stringify(checklist) };
      await beats.next(); // study done (repo cloned) → drafting the mockups
      let projectAnnouncement: Promise<void> | null = null;
      // provenance, not pattern-matching: only the create_project/get_project call's
      // OWN result names this task's project (claudedesign.ts)
      const projectWatch = claudeDesignProjectWatch();
      const designRunLog: LogFn = (rec) => {
        runLog(rec);
        if (designProvider !== 'claude-design' || externalDesignUrl) return;
        const projectUrl = projectWatch.observe(rec);
        if (!projectUrl) return;
        externalDesignUrl = projectUrl;
        // Tool results arrive before the model's final summary. Persist the exact
        // project link immediately so the in-flight handoff never falls back to
        // Claude Design home and survives a renderer/app restart.
        projectAnnouncement = (async () => {
          const existing = await db.get<{ id: string }>(
            `select id from messages where task_id = ? and body like ? order by created_at desc limit 1`,
            [t.id, `%${projectUrl}%`],
          ).catch(() => null);
          if (existing) return;
          await post('/v1/messages', actor, {
            workspace: ch.workspace_id,
            channel: ch.id,
            taskId: t.id,
            body: `Claude Design project ready: [Open the editable project](${projectUrl}). Keep editing there; I'll sync the review snapshot here when it is ready.`,
          });
        })().catch((err) => {
          runLog({ kind: 'lifecycle', phase: 'handoff', summary: `couldn't persist the Claude Design project link: ${err instanceof Error ? err.message.slice(0, 140) : String(err).slice(0, 140)}`, level: 'warn' });
        });
      };
      const note = await runtimeFor(designer.runtime).runQuery(
        designer, execT, dir, token, block, repoBacked, undefined, designRunLog,
        [], undefined, undefined, undefined, undefined, undefined,
        { prompt, system: designSystemPrompt(designBlocks(), designer.name, repoBacked), claudeDesign: designProvider === 'claude-design' },
      );
      await projectAnnouncement;
      summary = (note ?? '').slice(0, 2000);
      // NOT a fallback scan of the summary any more. A URL in the model's prose is
      // unprovenanced — #1034's dead link came from exactly that — so a round with no
      // create_project result reports itself as snapshot-only instead of linking out.
      if (designProvider === 'claude-design' && !externalDesignUrl) {
        runLog({ kind: 'lifecycle', phase: 'handoff', summary: `no Claude Design project was created for #${t.number} — proposing the HTML snapshot only`, level: 'warn' });
      }
      const outDir = join(dir, '.nm-evidence', 'design');
      const files = (await readdir(outDir).catch(() => [] as string[])).filter((f) => /\.html?$/i.test(f)).sort().slice(0, 6);
      for (const f of files) {
        const html = await readFile(join(outDir, f), 'utf8').catch(() => '');
        if (html.trim() && html.length <= 300_000) mockups.push({ name: f, html });
      }
      if (!mockups.length && designProvider === 'claude-design' && claudeDesignNeedsAuthorization(summary)) {
        // Consent is an expected first-run handoff, not a failed design. Keep
        // this selection guarded; answering the fresh card mints the new run key.
        await beats.fail();
        runLog({ kind: 'lifecycle', phase: 'authorization', summary: `waiting for Claude Design access on #${t.number}`, level: 'warn' });
        await post('/v1/messages', actor, {
          workspace: ch.workspace_id,
          channel: ch.id,
          taskId: t.id,
          body: `Claude Design needs one-time access before I can create this mockup. Finish approving access in [Claude Design settings](https://claude.ai/design/settings) (the browser window that opened), then choose **Use Claude Design** again below and I'll continue. Or switch to an Iris HTML draft now.\n\n${designProviderQuestionBlock()}`,
        });
        return;
      }
      if (!mockups.length) throw new Error('the design run produced no mockup .html files under .nm-evidence/design/');
      if (!designRoundChanged(priorRound.staged, mockups)) {
        throw new Error(`the rework left round ${priorRound.round} byte-identical — no change was applied to the mockups`);
      }
      await beats.next(); // mockups rendered → drafting beat done (proposal is the phase transition)
      await rm(work, { recursive: true, force: true }).catch(() => {}); // mockups ride the command now
    } else {
      // echo: a deterministic, tokens-faithful stub so the dev gate exercises the FSM
      mockups = [{
        name: 'mockup',
        html: `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><title>#${t.number} mockup</title><style>:root{color-scheme:light dark}body{font-family:system-ui;margin:0;padding:48px;background:#1d1d1d;color:#e6e6e6}[data-theme='light'] body,html[data-theme='light'] body{background:#faf6f0;color:#2c2018}.card{max-width:560px;border:1px solid #464646;border-radius:12px;padding:24px}h1{font-size:20px;margin:0 0 8px}.acc{color:#e27c62}</style></head><body><div class="card"><h1>#${t.number} — ${t.title.replace(/</g, '&lt;')}</h1><p class="acc">echo stub mockup</p><p>Set an API key to get a real design study (tokens, existing pages, both themes).</p></div></body></html>`,
      }];
      summary = designProvider === 'claude-design'
        ? 'echo stub Claude Design handoff (connect Claude Design for a real editable project)'
        : 'echo stub mockup (set an API key for a real design study)';
    }
    const res = await post('/v1/commands', actor, { type: 'task.propose_design', taskId: t.id, round, summary: summary || undefined, mockups });
    if (!res.ok) throw new Error(`propose_design ${res.status}: ${await res.text()}`);
    await post('/v1/messages', actor, {
      workspace: ch.workspace_id, channel: ch.id, taskId: t.id,
      body: `Design mockups ${round > 1 ? `reworked — round ${round}` : 'proposed'} for #${t.number}: ${mockups.length} mockup${mockups.length === 1 ? '' : 's'} in the artifacts (**design-mockup-v${round}-…**).${
        externalDesignUrl
          ? ` Keep editing the source in [Claude Design](${externalDesignUrl}); I synced this revision here as the review snapshot.`
          : designProvider === 'claude-design'
            ? ` (No editable Claude Design project was created this round — these are the exported snapshots only.)`
            : ''
      } Preview them in this thread and approve, or request changes — nothing is planned or built until you approve.`,
    });
    alog(designer, null, ch.slug)({ kind: 'lifecycle', phase: 'proposed', summary: `proposed ${mockups.length} mockup(s) for #${t.number} (round ${round}, ${live ? 'live' : 'echo stub'})` });
  } catch (err) {
    designed.delete(t.id);
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`designer_flow #${t.number} failed:`, err);
    // Never let a design die silently — mirror architectFlow: log it as an error,
    // tell the human in the thread, and attempt a block so it surfaces as actionable.
    (dlog ?? alog(designer, t, chRef?.slug ?? null))({ kind: 'result', phase: 'error', summary: `mockup generation failed for #${t.number}: ${reason.slice(0, 180)}`, level: 'error' });
    await beats.fail(); // mark the in-flight beat blocked while we still own `designing` (before task.block)
    if (chRef) {
      await post('/v1/messages', actor, {
        workspace: chRef.workspace_id, channel: chRef.id, taskId: t.id,
        body: `⚠️ ${designer.name} couldn't draft the mockups for #${t.number} — ${reason.slice(0, 180)}. Re-route it to design (or nudge me here) to retry.`,
      }).catch(() => {});
      await post('/v1/commands', actor, { type: 'task.block', taskId: t.id, reason: `mockup generation failed: ${reason.slice(0, 200)}` }).catch((e) => console.error(`task_block #${t.number} failed:`, e));
    }
  } finally {
    setStatus(designer, 'online');
  }
}

  return { designerFlow, orchDesignNotify };
}
