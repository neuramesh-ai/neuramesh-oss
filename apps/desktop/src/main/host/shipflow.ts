// THE SHIP FLOW (docs/23) — the shipper claiming a reviewer-approved PR task, studying the
// change, and proposing a release plan. The claim IS the cross-machine dedupe.
// Split out of host/flows.ts.
import { authBlockedCard, projectPolicy, resolveToken, runtimeFor } from '../agents';
import type { ExecTask, HostedAgent, OfferedTask, SkillRef } from '../agents';


import { buildShipUserPrompt, composePrompt, shipPlanName, type ShipPlan, type ClaimVerdict } from '@neuramesh/shared';

import { shipperBeatTitles } from '../beats';



import { type SubjectRef } from '../harness/brain';


import { contractFor } from '../contracts';
import { deployNotesSection, ghPrBody, repoSlug, repoSlugFor, waitForCi } from './gh';






import { scanDiff, scanNote } from '../shipscan';

import { type LogFn } from '../agentlog';


import type { makeReleaseDocs } from './releasedocs';
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



export function makeShipFlow(ctx: HostCtx & {
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
  releaseDocsNote: ReturnType<typeof makeReleaseDocs>['releaseDocsNote'];
}) {
const { db, apiUrl, workspace, ownerActorId, post, 
        beatCursor, 
        arun, channelLessons, discoverSkills,
        
        seatFor, setStatus, releaseDocsNote } = ctx;
// The guard registry's fields keep their short names, exactly as they read inside startAgentHost.
const { 
        
        shipPrepped } = ctx.guards;

async function shipperFlow(agent: HostedAgent, t: ShipTask, opts: { resume: boolean }) {
  agent = await seatFor(agent, t.channel_id, { taskId: t.id }); // per-project + per-thread brains (docs/10)
  const actor = { kind: 'agent', id: agent.id, role: 'shipper' };
  const beats = beatCursor(actor, t.id);
  const beatsLive = process.env['NM_AGENT_MODE'] !== 'echo';
  try {
    const ch = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [t.channel_id]);
    // gate check is convenience here (the server enforces it on claim_ship)
    const policy = await projectPolicy(db, t.channel_id);
    if (!policy.shipGate && !opts.resume) return;
    if (!opts.resume) {
      const claim = await post('/v1/commands', actor, { type: 'task.claim_ship', taskId: t.id });
      if (claim.status >= 400 && claim.status < 500) return; // lost the race, gate off, or state moved — a fresh signal re-fires
      if (!claim.ok) throw new Error(`claim_ship ${claim.status}: ${await claim.text()}`);
    }
    const { log: slog } = arun(agent, t, ch.slug);
    const full = await db.get<{ definition_of_done: string | null; description: string | null; pr_url: string | null; pr_number: number | null; submitted_sha: string | null; repo_clone: string | null; repo_local: string | null; ship_plan: string | null }>(
      `select t.definition_of_done, t.description, t.pr_url, t.pr_number, t.submitted_sha, r.clone_url as repo_clone, r.local_path as repo_local, t.ship_plan
       from tasks t left join repos r on r.id = t.repo_id where t.id = ?`, [t.id],
    );
    const prNumber = full?.pr_number ?? t.pr_number;
    let prior: ShipPlan | null = null;
    try { prior = full?.ship_plan ? (JSON.parse(full.ship_plan) as ShipPlan) : null; } catch { /* none */ }
    const round = (prior?.round ?? 0) + 1;
    // the human's bounce feedback (revise_ship_plan) is the redraft context — the
    // panel/relay posts it as a thread packet (the events log is not replicated)
    const feedback = round > 1
      ? await db.get<{ body: string }>(`select body from messages where task_id = ? and body like '%Release-plan changes requested%' order by created_at desc limit 1`, [t.id])
          .then((r) => (r?.body ?? '').replace(/^.*Release-plan changes requested[:\s—-]*/i, '').trim())
          .catch(() => '')
      : '';

    await beats.declare('shipping', shipperBeatTitles(round), beatsLive);
    if (!opts.resume) {
      await post('/v1/messages', actor, {
        workspace: ch.workspace_id, channel: ch.id, taskId: t.id,
        body: `Review passed — preparing #${t.number} for release${prNumber ? ` (round ${round > 1 ? round : 1})` : ''}. Studying [PR #${prNumber}](${full?.pr_url ?? ''}): the diff, CI, the PR's Deploy notes, and the team's release doctrine.`,
      }).catch(() => {});
    }

    // ── gather (host-verified, no model judgment) ──
    const slug = full?.repo_clone ? repoSlug(full.repo_clone) : await repoSlugFor({ clone_url: full?.repo_clone, local_path: full?.repo_local, org_name: null, name: null });
    const pr = prNumber && slug ? await ghPrBody(slug, prNumber) : { title: '', body: '' };
    const deployNotes = deployNotesSection(pr.body);
    const ci = prNumber && slug ? await waitForCi(slug, prNumber, (n) => slog({ kind: 'tool', phase: 'ci', summary: `PR #${prNumber} CI not settled — poll ${n}` })) : { verdict: 'none' as const, detail: '' };
    const ciNote = ci.verdict === 'pass' ? `CI on PR #${prNumber}: settled GREEN (${ci.detail}) — host-verified.`
      : ci.verdict === 'fail' ? `CI on PR #${prNumber}: RED (${ci.detail}) — the plan must surface this; the reviewer normally bounces red CI.`
      : ci.verdict === 'pending' ? `CI on PR #${prNumber}: still pending after the wait window.`
      : 'CI: none configured on this repo.';
    const diffArt = await db.get<{ inline_content: string | null }>(`select inline_content from artifacts where task_id = ? and kind = 'diff' order by created_at desc limit 1`, [t.id]).catch(() => null);
    const diffText = diffArt?.inline_content ?? '';
    const scan = scanDiff(diffText);
    const scanLine = scanNote(scan);
    await beats.next(); // studied → scanning noted
    slog({ kind: 'tool', phase: 'shipscan', summary: scanLine.split('\n')[0] ?? 'shipscan done' });
    const releaseDocs = await releaseDocsNote(full?.repo_clone ?? null);
    const lessonsNote = await channelLessons(ch.workspace_id, ch.id);
    const skills = await discoverSkills(ch.id, ch.workspace_id).catch(() => [] as SkillRef[]);
    const shipSkill = skills.find((s) => /ship|launch|release/i.test(s.name));
    // the channel roster: real agent ids so an owner:'agent' item can NAME its
    // owner; the daemon coerces anything unresolvable to 'shipper' below
    const roster = await db.getAll<{ id: string; name: string; role: string }>(
      `select a.id, a.name, a.role from agents a join agent_channels ac on ac.agent_id = a.id
       where ac.channel_id = ? and a.retired_at is null order by a.name`, [ch.id],
    ).catch(() => [] as Array<{ id: string; name: string; role: string }>);
    const rosterIds = new Set(roster.map((a) => a.id));
    const rosterNote = roster.length
      ? `Channel roster (the ONLY valid agentId values for owner:"agent" items — anything else coerces to the shipper):\n${roster.map((a) => `- ${a.name} (${a.role}) — agentId: ${a.id}`).join('\n')}`
      : '';
    const skillsNote = shipSkill?.body ? `Team skill "${shipSkill.name}" (excerpt):\n${shipSkill.body.slice(0, 6000)}` : '';
    await beats.next(); // scan settled → drafting

    // ── draft (judgment) ──
    type DraftItem = { id: string; title: string; detail?: string; owner: 'shipper' | 'human' | 'agent'; agentId?: string; auto?: 'ci'; state?: 'pending' | 'done' };
    let draft: { risk: 'low' | 'medium' | 'high'; summary: string; report: string; items: DraftItem[] };
    if (process.env['NM_AGENT_MODE'] === 'echo') {
      // deterministic stub so the dev-gate e2e exercises the full FSM without a model
      draft = {
        risk: scan.riskHint, summary: `echo release plan for #${t.number}`,
        report: `# Release plan (echo)\n\n${scanLine}\n\nRollback: revert the merge.`,
        items: [
          { id: 'ci', title: `CI green on PR #${prNumber}`, owner: 'shipper', auto: 'ci', state: ci.verdict === 'pass' ? 'done' : 'pending' },
          { id: 'verify-prod', title: 'Verify the deploy serves the change', owner: 'shipper' },
        ],
      };
    } else {
      const cred = await resolveToken(apiUrl, ch.workspace_id, agent, ownerActorId);
      if (cred.blocked) {
        await beats.fail();
        await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: authBlockedCard(agent, cred.blocked, t.number) }).catch(() => {});
        slog({ kind: 'lifecycle', phase: 'shipping', summary: `release planning held — ${cred.blocked.provider} subscription not usable`, level: 'warn' });
        shipPrepped.delete(t.id); // a reconnect/resume re-enters
        return;
      }
      setStatus(agent, 'thinking');
      try {
        const raw = await runtimeFor(agent.runtime).complete(
          composePrompt(contractFor('bosun', 'shipper')?.prompt?.['plan.system'] ?? '', {}),
          buildShipUserPrompt({
            taskNumber: t.number, title: t.title, definitionOfDone: (full?.definition_of_done ?? '').trim(),
            prNumber, prTitle: pr.title, deployNotes, ciNote, scanNote: scanLine,
            diffSummary: diffText.slice(0, 24_000), releaseDocs, lessonsNote, skillsNote, reworkFeedback: feedback, rosterNote,
          }),
          cred.token ?? '', agent.model, 2000,
        );
        const parsed = JSON.parse((raw.match(/\{[\s\S]*\}/)?.[0]) ?? '{}') as Partial<typeof draft>;
        const items = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 12);
        if (!items.length) throw new Error('release plan came back with no checklist items');
        const order = { low: 0, medium: 1, high: 2 } as const;
        const risk = parsed.risk && order[parsed.risk] !== undefined && order[parsed.risk] >= order[scan.riskHint] ? parsed.risk : scan.riskHint;
        draft = { risk, summary: String(parsed.summary ?? '').slice(0, 1900), report: String(parsed.report ?? scanLine), items };
      } finally {
        setStatus(agent, 'online');
      }
    }
    // normalize: unique kebab ids; the host's CI verdict overrides the model's optimism
    const seenIds = new Set<string>();
    const items = draft.items.map((i, n) => {
      let id = String(i.id ?? `item-${n + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `item-${n + 1}`;
      while (seenIds.has(id)) id = `${id.slice(0, 36)}-${n + 1}`;
      seenIds.add(id);
      const auto = i.auto === 'ci' ? 'ci' as const : undefined;
      const state = auto ? (ci.verdict === 'pass' ? 'done' as const : 'pending' as const) : 'pending' as const;
      // an agent-owned item must name a REGISTERED channel agent — anything
      // unresolvable coerces to the shipper (an unowned box is impossible)
      const validAgent = i.owner === 'agent' && !!i.agentId && rosterIds.has(String(i.agentId));
      const owner = i.owner === 'human' ? 'human' as const : validAgent ? 'agent' as const : 'shipper' as const;
      if (i.owner === 'agent' && !validAgent) slog({ kind: 'tool', phase: 'shipscan', summary: `plan item "${String(i.title ?? '').slice(0, 60)}" named an unknown agent — coerced to shipper`, level: 'warn' });
      return { id, title: String(i.title ?? '').slice(0, 300) || 'untitled step', detail: String(i.detail ?? '').slice(0, 2000), owner, ...(validAgent ? { agentId: String(i.agentId) } : {}), ...(auto ? { auto } : {}), state };
    });
    // the ROLLOUT SPINE (docs/23): the checklist IS the road to live, so the host
    // always closes it with the machine-driven legs — the merge (execute_ship fires
    // when the gates above clear; the verifying watch ticks it with the merge) and the
    // release verification (shipverify → confirm_release). Model-authored merge/verify
    // rows are dropped: these legs are host truth, never judgment. shipItemsPending
    // excludes them, so they narrate the rollout without re-arming the gate.
    const modelMergeVerify = /^(?:squash-)?merge\b.*(?:pr|#\d)|^verify\b.*(?:post-merge|release land|rollout)/i;
    type DraftShipItem = { id: string; title: string; detail: string; owner: 'shipper' | 'human' | 'agent'; agentId?: string; auto?: 'ci' | 'merge' | 'verify'; state: 'pending' | 'done' };
    const spine: DraftShipItem[] = items.filter((i) => {
      const drop = modelMergeVerify.test(i.title);
      if (drop) slog({ kind: 'tool', phase: 'shipscan', summary: `dropped model item "${i.title.slice(0, 60)}" — the host owns the rollout legs`, level: 'warn' });
      return !drop;
    });
    if (!spine.some((i) => i.auto === 'ci') && prNumber) {
      spine.unshift({ id: seenIds.has('ci') ? 'ci-gate' : 'ci', title: `CI green on PR #${prNumber}`, detail: 'host-verified via gh pr checks', owner: 'shipper' as const, auto: 'ci' as const, state: ci.verdict === 'pass' ? 'done' as const : 'pending' as const });
    }
    spine.push(
      { id: seenIds.has('merge-pr') ? 'merge-pr-spine' : 'merge-pr', title: prNumber ? `Merge PR #${prNumber} — the release event` : 'Merge the PR — the release event', detail: 'execute_ship squash-merges the moment every gate above clears; the verifying watch ticks this with the merge.', owner: 'shipper' as const, auto: 'merge' as const, state: 'pending' as const },
      { id: seenIds.has('verify-release') ? 'verify-release-spine' : 'verify-release', title: 'Verify post-merge CI + production rollout', detail: 'shipverify proves the release landed (post-merge CI + release workflows) before acceptance.', owner: 'shipper' as const, auto: 'verify' as const, state: 'pending' as const },
    );

    await beats.next(); // drafted → proposing
    // settle the set BEFORE propose_ship_plan: the command transitions shipping →
    // ship_review, and the beat gate follows phase ownership (BEAT_PHASE_ROLES has no
    // ship_review entry — that phase is the human's), so a write after the transition
    // is refused and the last beat pulses forever (the #1018 "Propose the release
    // plan" 3/4). Same order the architect and reviewer flows use.
    await beats.next();
    const propose = await post('/v1/commands', actor, { type: 'task.propose_ship_plan', taskId: t.id, report: draft.report.slice(0, 60_000), risk: draft.risk, summary: draft.summary, round, items: spine });
    if (propose.status >= 400 && propose.status < 500) { slog({ kind: 'lifecycle', phase: 'shipping', summary: `propose_ship_plan refused (${propose.status}) — state moved`, level: 'warn' }); return; }
    if (!propose.ok) throw new Error(`propose_ship_plan ${propose.status}: ${await propose.text()}`);
    const needYou = items.filter((i) => i.owner === 'human').length;
    // the full report is referenced by NAME, exactly like the architect's
    // implementation-plan message — the client linkifies it into the plan
    // review overlay, where the human comments block-by-block and approves
    // or bounces the round (docs/23 v2). Keep "Release plan vN for #N"
    // verbatim: the orchestrator's channel announce dedupes on that marker.
    await post('/v1/messages', actor, {
      workspace: ch.workspace_id, channel: ch.id, taskId: t.id,
      body: `Release plan v${round} for #${t.number} — risk: **${draft.risk}**. ${draft.summary} Full plan: **${shipPlanName(round)}** — ${items.length} item${items.length === 1 ? '' : 's'}${needYou ? `, ${needYou} need${needYou === 1 ? 's' : ''} you` : ''}. Approve to arm the checklist (or request changes and I redraft); I merge the moment every box clears, then verify the release lands before #${t.number} is accepted.`,
    }).catch(() => {});
    console.log(`agent_ship agent=${agent.name} task=${t.number} plan v${round} proposed (risk ${draft.risk})`);
    slog({ kind: 'lifecycle', phase: 'shipping', summary: `release plan v${round} proposed — risk ${draft.risk}, ${items.length} items` });
  } catch (err) {
    shipPrepped.delete(t.id); // transient — a watch tick retries
    await beats.fail();
    console.error(`agent_ship agent=${agent.name} task=${t.number} failed:`, err);
  }
}

  return { shipperFlow };
}
