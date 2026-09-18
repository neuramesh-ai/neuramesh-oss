// THE REVIEW FLOW — an independent reviewer gating on the PR's CI and the Definition of Done.
// Approval hands to the shipper when the project is ship-gated; otherwise it stops at done and
// waits for a human. Split out of host/flows.ts.
import { starterFallback, unavailableOf } from './starterfallback';
import { projectPolicy, resolveToken, runtimeFor } from '../agents';
import type { ExecTask, HostedAgent, OfferedTask, SkillRef } from '../agents';

import { shouldHoldReview } from '../runtime/honesty';
import { type ShipPlan, type ClaimVerdict } from '@neuramesh/shared';

import { reviewerBeatTitles } from '../beats';

import { reviewBlock } from './plan';

import { type SubjectRef } from '../harness/brain';



import { repoSlug, waitForCi } from './gh';








import { type LogFn } from '../agentlog';


import type { makeShipFlow } from './shipflow';
import type { HostCtx } from './ctx';
import type { ShipTask } from './flows';
import type { PowerSyncDatabase } from '@powersync/node';
import type { Brain } from '../harness/brain';
import type { AgentAttachment } from '../runtime/adapter';
import type { HostQueue } from '../harness/hostqueue';
import type { ParkBook } from '../harness/park';
import type { WhiteboardToolClosures } from '../harness/toolbus';
import type { makeRuns, RunHandle } from './runs';
import type { makeBeats } from './beats';
import type { makePark } from './park';




export function makeReviewFlow(ctx: HostCtx & {
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
  shipperFlow: ReturnType<typeof makeShipFlow>['shipperFlow'];
}) {
const { db, apiUrl, workspace, ownerActorId, post, agents, execQueue, 
        beatCursor, 
        arun, channelLessons, 
        mineLessons, 
        seatFor, setStatus, shipperFlow } = ctx;
// The guard registry's fields keep their short names, exactly as they read inside startAgentHost.
const { 
        reviewed,
        shipPrepped } = ctx.guards;

async function reviewFlow(agent: HostedAgent, t: { id: string; number: number; title: string; channel_id: string }) {
  agent = await seatFor(agent, t.channel_id, { taskId: t.id }); // per-project + per-thread brains (docs/10)
  const actor = { kind: 'agent', id: agent.id, role: 'reviewer' };
  const beats = beatCursor(actor, t.id); // inert until declare(); gates and the catch fail() it
  // Beats gate on the echo mode (not `live`, which is resolved late) — the structural/CI
  // gates run before the reviewer's credential is even resolved. Echo stays beatless so
  // the e2e FSM gate is unchanged.
  const beatsLive = process.env['NM_AGENT_MODE'] !== 'echo';
  try {
    const ch = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [t.channel_id]);
    const { log: rlog } = arun(agent, t, ch.slug);
    const full = await db.get<{ requirements: string | null; definition_of_done: string | null; description: string | null; repo_id: string | null; submitted_sha: string | null; pr_url: string | null; pr_number: number | null; repo_clone: string | null }>(
      `select t.requirements, t.definition_of_done, t.description, t.repo_id, t.submitted_sha, t.pr_url, t.pr_number, r.clone_url as repo_clone
       from tasks t left join repos r on r.id = t.repo_id where t.id = ?`, [t.id],
    );
    let checklist: string[] = [];
    try { checklist = JSON.parse(full?.requirements ?? '[]') as string[]; } catch { /* none */ }
    // the authoritative acceptance contract the reviewer gates on: the Definition
    // of Done when set, else the intake requirements checklist (fallback).
    const dod = (full?.definition_of_done ?? '').trim();
    const reqText = `${checklist.join(' ')} ${full?.description ?? ''} ${t.title}`;
    // Repo-backed = a bound repo, or the requirements explicitly name a github URL (which the
    // orchestrator should have bound at offer). A loose "push…repo" keyword clause used to live here
    // too, but it false-positived on negations — e.g. a scratch task whose description says "no repo
    // push needed" matches both "push" and "repo" — and was unactionable anyway (with no bound repo,
    // there is nothing for the worker to push to). Repo-backing is decided at offer time, not guessed
    // from prose here.
    const repoRequired = !!full?.repo_id || /github\.com\/[\w.-]+\/[\w.-]+/i.test(reqText);
    const pushed = !!full?.submitted_sha;

    // Beats (docs/17): the reviewer's gate sequence. A repo-backed review adds the CI
    // beat; a repo-less scratch review has none. Every bounce below runs through
    // requestChanges (which marks the in-flight beat blocked); the approve path settles
    // the last beat. Live runs only. A re-review (a prior in_review set exists) declares
    // round-labeled titles so the fresh set is visibly a new pass, not the old tracker.
    const priorReviews = beatsLive
      ? await db.get<{ n: number }>(`select count(distinct run_id) as n from beats where task_id = ? and phase = 'in_review'`, [t.id]).catch(() => ({ n: 0 }))
      : { n: 0 };
    await beats.declare('in_review', reviewerBeatTitles(repoRequired, (priorReviews?.n ?? 0) + 1), beatsLive);

    // bounce back to the worker with a reason instead of approving
    const requestChanges = async (feedback: string, note: string): Promise<boolean> => {
      await beats.fail(); // the review stops here — mark the in-flight beat blocked before the phase transitions
      const r = await post('/v1/commands', actor, { type: 'task.request_changes', taskId: t.id, feedback });
      if (r.status >= 400 && r.status < 500) return false; // lost the race / state moved
      if (!r.ok) throw new Error(`request_changes ${r.status}: ${await r.text()}`);
      await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: `Auto-review of #${t.number}: ❌ changes requested — ${feedback}` });
      rlog({ kind: 'lifecycle', phase: 'reviewed', summary: `auto-review of #${t.number}: changes requested (${note})`, level: 'warn' });
      console.log(`agent_review agent=${agent.name} task=${t.number} request_changes (${note})`);
      return true;
    };

    // STRUCTURAL gate (both modes): a repo/commit/PR requirement that produced no
    // pushed branch is NOT done — the deliverable can't be reviewed on a real ref.
    if (repoRequired && !pushed) {
      await requestChanges(
        `the task requires a pull request against the repository${full?.repo_id ? '' : ' (the requirements name one)'}, but nothing was pushed — there is no branch, commit, or PR on the task.${full?.repo_id ? '' : ' If the target repo is not registered in this workspace it cannot be bound; register it (attach it to the project) and re-run so the work lands on a real branch.'}`,
        'repo required but nothing pushed',
      );
      return;
    }
    await beats.next(); // submission is reviewable → onto CI (repo) or the DoD review (scratch)

    // CI gate: a PR with failing or still-pending checks is NOT done. No CI
    // configured (or no PR / gh unavailable) proceeds on the diff + DoD review.
    // The merge happens only on the human's accept — never here. Live-verified;
    // NM_GH_FAKE returns 'none' so the echo gate proceeds deterministically.
    const prNumber = full?.pr_number ?? null;
    const ciPolicy = await projectPolicy(db, t.channel_id); // project may opt out of the CI gate
    // The host is the SINGLE CI authority: settle CI here, then hand the verified
    // verdict to the LLM reviewer via ciNote — so the reviewer never re-checks a
    // half-started pipeline and bounces on "CI pending" (the #1013 loop). CI being
    // still-running, or not-yet-registered right after a push, is not a verdict.
    let ciNote = '';
    if (repoRequired && pushed && prNumber && full?.repo_clone && ciPolicy.runCiBeforeMerge) {
      const slug = repoSlug(full.repo_clone);
      rlog({ kind: 'tool', phase: 'ci', summary: `PR #${prNumber} — settling CI before review` });
      const ci = await waitForCi(slug, prNumber, (n) => rlog({ kind: 'tool', phase: 'ci', summary: `PR #${prNumber} CI not settled yet — poll ${n}` }));
      if (ci.verdict === 'fail') { await requestChanges(`CI is red on the pull request — \`${ci.detail}\` failed. Fix it so the checks pass, then re-submit.`, 'CI failing'); return; }
      if (ci.verdict === 'pending') { await requestChanges(`the pull request's CI didn't finish within the wait window (\`${ci.detail}\`) — the workflow may be stuck; check the run and re-submit once it's green.`, 'CI stuck'); return; }
      ciNote = ci.verdict === 'pass'
        ? `\n\nSystem CI gate: the PR's CI checks have PASSED (verified by the host) — treat any "CI passes / checks green" Definition-of-Done item as SATISFIED.`
        : `\n\nSystem CI gate: no CI is configured on this repo — any CI-related Definition-of-Done item is not applicable here.`;
      if (ci.verdict === 'pass') rlog({ kind: 'tool', phase: 'ci', summary: `PR #${prNumber} CI green (${ci.detail})` });
    } else if (repoRequired && pushed && prNumber && !ciPolicy.runCiBeforeMerge) {
      ciNote = `\n\nSystem CI gate: CI gating is disabled for this project — do not gate on CI.`;
      rlog({ kind: 'tool', phase: 'ci', summary: `CI gate off for this project — reviewing on the diff + DoD` });
    }
    if (repoRequired) await beats.next(); // CI settled (or N/A) → onto the Definition-of-Done review

    // EVIDENCE gate (enforced, not judged): when the Definition of Done explicitly requires
    // screenshots but none are attached, that item is provably unmet — don't let the semantic judge
    // rubber-stamp it on the worker's say-so. Bounce once so the worker can add them; if it's already
    // been bounced and still hasn't (it may be unable to capture a running app), block it for a human.
    if (process.env['NM_AGENT_MODE'] !== 'echo' && /\bscreenshots?\b/i.test(dod)) {
      const shots = await db.getAll<{ name: string; kind: string }>(`select name, kind from artifacts where task_id = ?`, [t.id]);
      const hasShot = shots.some((a) => a.kind === 'image' || /\.(png|jpe?g|gif|webp)$/i.test(a.name));
      if (!hasShot) {
        const [bc] = await db.getAll<{ n: number }>(`select count(*) as n from messages where task_id = ? and author_kind = 'agent' and body like 'Auto-review of #%changes requested%screenshot%'`, [t.id]);
        if (Number(bc?.n ?? 0) >= 1) {
          const reason = 'the Definition of Done requires screenshots, but none were attached after a prior review request — needs human attention (the worker may be unable to capture a running app; attach them or relax the DoD).';
          await beats.fail(); // review can't complete — mark the DoD beat blocked before task.block transitions it
          await post('/v1/commands', actor, { type: 'task.block', taskId: t.id, reason }).catch((e) => console.error(`task_block #${t.number} failed:`, e));
          await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: `Auto-review of #${t.number}: ⛔ blocked — ${reason}` }).catch(() => {});
          rlog({ kind: 'lifecycle', phase: 'reviewed', summary: `blocked #${t.number}: DoD screenshots still missing`, level: 'warn' });
          return;
        }
        await requestChanges('the Definition of Done requires screenshots (e.g. of the delivered pages), but none are attached to the task — capture and attach them, then re-submit.', 'DoD requires screenshots; none attached');
        return;
      }
    }

    // SEMANTIC review (live): do the delivered artifacts satisfy every requirement?
    let cred = await resolveToken(apiUrl, ch.workspace_id, agent, ownerActorId);
    // the seat cannot run → the Starter door (host/starterfallback.ts): a routine's unit is reviewed
    // on the Starter brain; a human's gets the reason and the card and the task HOLDS in_review — the
    // semantic review below fails open to approve when not live, which would accept UNREVIEWED work.
    // It stays in `reviewed` so this doesn't re-fire each poll; a re-submit re-triggers a real review.
    const gap = unavailableOf(cred, agent.runtime);
    if (gap) {
      const next = await starterFallback(agent, gap, { workspace: ch.workspace_id, channelId: ch.id, taskId: t.id, taskNumber: t.number });
      if (!next) {
        await beats.fail(); // review held (no usable seat) — the DoD beat can't complete
        rlog({ kind: 'lifecycle', phase: 'reviewed', summary: `review held — ${gap.kind === 'login' ? `${gap.provider} login ${gap.reason}` : gap.kind}; not auto-approving` });
        setStatus(agent, 'online');
        return;
      }
      agent = next; cred = await resolveToken(apiUrl, ch.workspace_id, agent, ownerActorId);
    }
    // No resolvable credential for the reviewer, but there ARE acceptance criteria to check:
    // the semantic review below would be SKIPPED (live=false) and fall straight through to
    // task.approve — i.e. accept UNREVIEWED work. Hold in_review instead: post an actionable
    // card and stop. It stays in `reviewed` so this doesn't re-fire each poll; a re-submit or
    // a configured credential re-triggers a real review. (Dev gate NM_AGENT_MODE=echo bypasses.)
    if (shouldHoldReview({ authMode: cred.authMode, hasReviewCriteria: !!(dod || checklist.length), globalEchoGate: process.env['NM_AGENT_MODE'] === 'echo' })) {
      const reason = `no auth for reviewer @${agent.name} (${agent.runtime} runtime) — can't run a real review, so #${t.number} won't be auto-approved. Configure a subscription/key for @${agent.name} (Agents → @${agent.name}), then re-submit or re-offer.`;
      await beats.fail(); // review held (no credential) — the DoD beat can't complete
      await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: `⚠️ Review of #${t.number} held: ${reason}` }).catch(() => {});
      rlog({ kind: 'lifecycle', phase: 'reviewed', summary: `review held — no credential for @${agent.name}; not auto-approving` });
      setStatus(agent, 'online');
      return;
    }
    const token = cred.token ?? ''; // apikey → the key; subscription → '' (providerEnv strips keys)
    const live = process.env['NM_AGENT_MODE'] !== 'echo' && cred.authMode !== 'none';
    if (live && (dod || checklist.length)) {
      setStatus(agent, 'thinking');
      const arts = await db.getAll<{ name: string; kind: string }>(`select name, kind from artifacts where task_id = ?`, [t.id]);
      const summary = (await db.getAll<{ body: string }>(`select body from messages where task_id = ? and author_kind = 'agent' order by created_at desc limit 3`, [t.id])).map((m) => m.body).reverse().join('\n');
      // gate on the Definition of Done (the authoritative contract) when set;
      // include the intake checklist as supporting context. Fall back to the
      // checklist as the criteria when no DoD was authored.
      const criteria = dod
        ? `Definition of Done — the AUTHORITATIVE acceptance contract; gate on THIS:\n${dod}${checklist.length ? `\n\nResolved requirements (intake checklist, supporting context):\n${checklist.map((c) => `- ${c}`).join('\n')}` : ''}`
        : `Requirements / checklist:\n${checklist.map((c) => `- ${c}`).join('\n')}`;
      // norms the channel already corrected once — the reviewer gates on them too
      const lessonsNote = await channelLessons(ch.workspace_id, ch.id);
      // a design-gated task carries human-APPROVED mockups — the delivered UI is
      // gated on matching them, as part of the acceptance contract
      const designArts = arts.filter((a) => a.kind === 'design');
      const designNote = designArts.length
        ? `\n\n${reviewBlock('verdict.design_note', { names: designArts.map((a) => a.name).join(', ') })}`
        : '';
      try {
        const raw = await runtimeFor(agent.runtime).complete(
          reviewBlock('verdict.system'),
          reviewBlock('verdict.user', {
            criteria, designNote, ciNote, lessonsNote,
            repoBinding: full?.repo_id ? `bound; pushed ${full.submitted_sha?.slice(0, 10) ?? 'NO'}` : 'none (repo-less scratch run)',
            artifacts: arts.map((a) => `- [${a.kind}] ${a.name}`).join('\n') || '(none)',
            summary: summary.slice(0, 2000),
          }),
          token, agent.model, 400,
        );
        const j = JSON.parse((raw.match(/\{[\s\S]*\}/)?.[0]) ?? '{}') as { verdict?: string; reason?: string };
        if (j.verdict === 'changes') { await requestChanges(j.reason?.trim() || 'a Definition-of-Done item is not satisfied by the delivered artifacts', 'definition of done unmet'); return; }
      } catch (err) {
        console.error(`agent_review_judge #${t.number} failed (approving on structural pass):`, err);
        // fail-open to approve — the structural repo gate already passed
      } finally {
        setStatus(agent, 'online');
      }
    }

    // APPROVE — structural gate passed (+ semantic review passed in live)
    await beats.next(); // the Definition-of-Done review passed — settle the last beat before task.approve
    const approve = await post('/v1/commands', actor, { type: 'task.approve', taskId: t.id });
    if (approve.status >= 400 && approve.status < 500) return; // another reviewer won
    if (!approve.ok) throw new Error(`approve ${approve.status}: ${await approve.text()}`);
    const prRef = prNumber && full?.pr_url ? ` — [PR #${prNumber}](${full.pr_url}), CI ok` : repoRequired && pushed ? ` (pushed ${full?.submitted_sha?.slice(0, 7)})` : '';
    await post('/v1/messages', actor, {
      workspace: ch.workspace_id, channel: ch.id, taskId: t.id,
      body: `Auto-review of #${t.number}: deliverables present and consistent with the ${dod ? 'Definition of Done' : 'requirements'}${prRef}. Approved${prNumber ? ' — accept to merge the PR to its base' : ''} — human acceptance still required.`,
    });
    console.log(`agent_review agent=${agent.name} task=${t.number} approved`);
    rlog({ kind: 'lifecycle', phase: 'reviewed', summary: `auto-review of #${t.number}: approved` });
    // corrected-then-approved → the corrections carry a lesson; mine it into memory
    void mineLessons(agent, t, ch, token, live, rlog).catch((err) => console.error(`lesson_mine task=${t.number} failed:`, err));
  } catch (err) {
    reviewed.delete(t.id); // transient — the watch retries
    await beats.fail(); // an unexpected error mid-review — don't leave a zombie pulsing beat on the retry
    console.error(`agent_review agent=${agent.name} task=${t.number} failed:`, err);
  }
}

const reviseToken = (planJson: string | null): string => {
  if (!planJson) return '';
  try { const p = JSON.parse(planJson) as ShipPlan; return `${p.round}:${p.revisions ?? 0}`; } catch { return ''; }
};
db.watch(
  `select id, number, title, channel_id, pr_number, ship_plan from tasks where state = 'done' and pr_number is not null`,
  [],
  {
    onResult: async (r) => {
      for (const t of (r.rows?._array ?? []) as ShipTask[]) {
        const token = reviseToken(t.ship_plan);
        if (shipPrepped.get(t.id) === token) continue;
        const shipper = [...agents.values()].find((a) => a.role === 'shipper' && a.channels.has(t.channel_id));
        if (!shipper) continue;
        shipPrepped.set(t.id, token);
        execQueue.run({ key: `ship:${t.id}`, kind: 'ship', cause: 'board', agentId: shipper.id, subject: { kind: 'task', number: t.number } }, () => shipperFlow(shipper, t, { resume: false }));
      }
    },
    onError: () => {},
  },
);

// resume a shipping task this process isn't working (host restart mid-draft, or
// a fresh redraft request): the claim already happened, so the flow re-enters
// past it.
db.watch(
  `select id, number, title, channel_id, pr_number, ship_plan from tasks where state = 'shipping'`,
  [],
  {
    onResult: (r) => {
      for (const t of (r.rows?._array ?? []) as ShipTask[]) {
        const token = reviseToken(t.ship_plan);
        if (shipPrepped.get(t.id) === token) continue;
        const shipper = [...agents.values()].find((a) => a.role === 'shipper' && a.channels.has(t.channel_id));
        if (!shipper) continue;
        shipPrepped.set(t.id, token);
        execQueue.run({ key: `ship:${t.id}:resume`, kind: 'ship', cause: 'board', agentId: shipper.id, subject: { kind: 'task', number: t.number } }, () => shipperFlow(shipper, t, { resume: true }));
      }
    },
    onError: () => {},
  },
);

  return { reviewFlow };
}
