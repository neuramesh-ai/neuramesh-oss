// The release-docs note — what the shipper reads out of the repo before proposing a plan.
// Split out of host/flows.ts.
import { notifyDesktop } from '../agents';
import type { ExecTask, HostedAgent, OfferedTask, SkillRef } from '../agents';


import { shipItemsPending, type ShipPlan, type ClaimVerdict } from '@neuramesh/shared';





import { cachePath, type SubjectRef } from '../harness/brain';



import { ghCapable, ghPrMerge, ghPrMergeSha, ghPrState, git, repoSlug, repoSlugFor, waitForCi, waitForRelease } from './gh';








import { type LogFn } from '../agentlog';


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

export function makeReleaseDocs(ctx: HostCtx & {
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
const { db, workspace, post, agents, 
        
        
        
 } = ctx;
// The guard registry's fields keep their short names, exactly as they read inside startAgentHost.
const { 
        
        shipAnnounceInFlight, shipCiVerified, shipExecuting, shipPrepped, verifyInFlight } = ctx.guards;

// Release-doctrine excerpt from the repo's cached clone (best-effort, offline-
// capable when the clone exists on THIS machine — single-box setups always do).
async function releaseDocsNote(cloneUrl: string | null): Promise<string> {
  try {
    if (!cloneUrl) return '';
    const { join } = await import('node:path');
    const { readFile, readdir } = await import('node:fs/promises');
    const repos = cachePath('repos');
    const dirs = await readdir(repos).catch(() => [] as string[]);
    for (const d of dirs) {
      const dir = join(repos, d);
      const origin = await git(['remote', 'get-url', 'origin'], dir).catch(() => '');
      if (!origin || repoSlug(origin) !== repoSlug(cloneUrl)) continue;
      for (const f of ['RELEASING.md', 'docs/11-releases.md', 'RELEASE.md', 'DEPLOY.md']) {
        const txt = await readFile(join(dir, f), 'utf8').catch(() => '');
        if (txt) return `${f}:\n${txt.slice(0, 8000)}`;
      }
      return '';
    }
    return '';
  } catch { return ''; }
}

// releasing executor: verify auto:'ci' items, then attempt the merge the moment
// the list clears — the server refuses an early execute (SHIP_ITEMS_PENDING), so
// this can be eager. The watch selects ship_plan, so every tick re-fires it.
db.watch(
  `select id, number, title, channel_id, pr_number, ship_plan from tasks where state = 'releasing'`,
  [],
  {
    onResult: async (r) => {
      if (!(await ghCapable())) return; // BYOK lane: no gh credential — a capable daemon verifies CI + executes
      for (const row of (r.rows?._array ?? []) as Array<ShipTask & { ship_plan: string | null }>) {
        let plan: ShipPlan | null = null;
        try { plan = row.ship_plan ? (JSON.parse(row.ship_plan) as ShipPlan) : null; } catch { continue; }
        if (!plan) continue;
        shipPrepped.delete(row.id); // the round landed — a later revise re-enters the draft flow cleanly
        // prefer the shipper that authored the plan when it lives here; else any local channel shipper
        const shipper = agents.get(plan.shipperId) ?? [...agents.values()].find((a) => a.role === 'shipper' && a.channels.has(row.channel_id));
        if (!shipper || shipper.role !== 'shipper') continue;
        const actor = { kind: 'agent', id: shipper.id, role: 'shipper' };
        // host-verified CI items: settle once, tick on green
        for (const item of plan.items) {
          if (item.auto !== 'ci' || item.state !== 'pending') continue;
          const key = `${row.id}:${item.id}`;
          if (shipCiVerified.has(key) || !row.pr_number) continue;
          shipCiVerified.add(key);
          void (async () => {
            const full = await db.get<{ repo_clone: string | null; repo_local: string | null }>(`select r.clone_url as repo_clone, r.local_path as repo_local from tasks t join repos r on r.id = t.repo_id where t.id = ?`, [row.id]).catch(() => null);
            const slug = full ? await repoSlugFor({ clone_url: full.repo_clone, local_path: full.repo_local, org_name: null, name: null }) : '';
            if (!slug) return;
            const ci = await waitForCi(slug, row.pr_number!);
            if (ci.verdict === 'pass' || ci.verdict === 'none') {
              await post('/v1/commands', actor, { type: 'task.check_ship_item', taskId: row.id, itemId: item.id, state: 'done', note: ci.verdict === 'pass' ? `host-verified: ${ci.detail}` : 'no CI configured' }).catch(() => {});
            } else {
              shipCiVerified.delete(key); // red/pending — re-verify on the next tick
            }
          })();
        }
        if (shipItemsPending(plan) > 0 || shipExecuting.has(row.id)) continue;
        shipExecuting.add(row.id);
        void (async () => {
          try {
            const res = await post('/v1/commands', actor, { type: 'task.execute_ship', taskId: row.id });
            if (res.ok) {
              const chan = await db.get<{ id: string; workspace_id: string }>('select id, workspace_id from channels where id = ?', [row.channel_id]).catch(() => null);
              if (chan) await post('/v1/messages', actor, { workspace: chan.workspace_id, channel: chan.id, taskId: row.id, body: `🚢 Shipping #${row.number} — every checklist item is clear under the approved plan; merging PR #${row.pr_number} and verifying the release now.` }).catch(() => {});
              console.log(`agent_ship task=${row.number} execute_ship ok — the verifying watch merges + verifies from here`);
            } else if (res.status === 422) {
              shipExecuting.delete(row.id); // items re-armed (added/unticked) — wait for the next tick
            } else if (res.status >= 500) {
              shipExecuting.delete(row.id);
            }
          } catch {
            shipExecuting.delete(row.id);
          }
        })();
      }
    },
    onError: () => {},
  },
);

db.watch(
  `select t.id, t.number, t.title, t.channel_id, t.pr_number, t.pr_url, t.ship_plan, r.org_name, r.name as repo_name, r.clone_url, r.local_path
   from tasks t join repos r on r.id = t.repo_id
   where t.state = 'verifying' and t.pr_number is not null`,
  [],
  {
    onResult: async (r) => {
      if (!(await ghCapable())) return; // BYOK lane: no gh credential — a capable daemon merges + verifies
      for (const row of (r.rows?._array ?? []) as Array<{ id: string; number: number; title: string; channel_id: string; pr_number: number; pr_url: string | null; ship_plan: string | null; org_name: string; repo_name: string; clone_url: string | null; local_path: string | null }>) {
        if (verifyInFlight.has(row.id)) continue;
        let plan: ShipPlan | null = null;
        try { plan = row.ship_plan ? (JSON.parse(row.ship_plan) as ShipPlan) : null; } catch { /* tolerated — fall through to any local shipper */ }
        const shipper = (plan ? agents.get(plan.shipperId) : undefined) ?? [...agents.values()].find((a) => a.role === 'shipper' && a.channels.has(row.channel_id));
        if (!shipper || shipper.role !== 'shipper') continue;
        verifyInFlight.add(row.id);
        void (async () => {
          try {
            const actor = { kind: 'agent', id: shipper.id, role: 'shipper' };
            const chan = await db.get<{ id: string; workspace_id: string }>('select id, workspace_id from channels where id = ?', [row.channel_id]).catch(() => null);
            const say = async (body: string) => { if (chan) await post('/v1/messages', actor, { workspace: chan.workspace_id, channel: chan.id, taskId: row.id, body }).catch(() => {}); };
            // the thread IS the dedupe store — a daemon restart re-runs the
            // verification (reads are idempotent) but never re-announces
            const said = async (marker: string) =>
              !!(await db.getAll<{ id: string }>('select id from messages where task_id = ? and body like ?', [row.id, `%${marker}%`]).catch(() => [])).length;
            // tick a rollout-spine leg (auto merge/verify) as the machine completes it —
            // idempotent via the pending check, so restarts and re-verifies never re-tick
            const tickAuto = async (kind: 'merge' | 'verify', note: string) => {
              const cur = await db.get<{ ship_plan: string | null }>('select ship_plan from tasks where id = ?', [row.id]).catch(() => null);
              let p: ShipPlan | null = null;
              try { p = cur?.ship_plan ? (JSON.parse(cur.ship_plan) as ShipPlan) : null; } catch { return; }
              const it = p?.items.find((i) => i.auto === kind && i.state === 'pending');
              if (!it) return;
              const res = await post('/v1/commands', actor, { type: 'task.check_ship_item', taskId: row.id, itemId: it.id, state: 'done', note: note.slice(0, 480) }).catch(() => null);
              if (res && !res.ok && res.status !== 409) console.error(`ship_verify task=${row.number} tick ${kind} ${res.status}`);
            };

            const slug = await repoSlugFor({ clone_url: row.clone_url, local_path: row.local_path, org_name: row.org_name, name: row.repo_name });
            if (!slug) {
              if (!(await said('no GitHub remote to resolve'))) await say(`⚠️ #${row.number} is ready to ship, but this repo has no GitHub remote to resolve — merge [PR #${row.pr_number}](${row.pr_url}) yourself, then Accept.`);
              return;
            }

            // 1 · the merge — the PR's own state is the cross-restart, cross-machine truth
            let prState = await ghPrState(slug, row.pr_number);
            if (prState === 'unknown') return; // transient gh failure — the next tick retries
            if (prState === 'closed') {
              if (!(await said('was closed without merging'))) { await say(`⚠️ [PR #${row.pr_number}](${row.pr_url}) was closed without merging — nothing to verify. Request changes to bounce a fresh round, or Accept if this was handled elsewhere.`); notifyDesktop(`Release blocked · #${row.number}`, `PR #${row.pr_number} closed unmerged`); }
              return;
            }
            if (prState === 'open') {
              const res = await ghPrMerge(slug, row.pr_number);
              if (!res.ok) {
                console.error(`ship_verify task=${row.number} pr=${row.pr_number} repo=${slug} merge FAILED: ${res.error}`);
                if (!(await said('the squash-merge failed'))) { await say(`⚠️ #${row.number}: the squash-merge failed — ${res.error}. Fix it (or merge manually), then Accept; I retry on the next restart.`); notifyDesktop(`Merge failed · #${row.number}`, res.error); }
                return;
              }
              console.log(`ship_verify task=${row.number} pr=${row.pr_number} repo=${slug} merged`);
              if (!(await said(`Squash-merged [PR #${row.pr_number}]`))) await say(`🔀 Squash-merged [PR #${row.pr_number}](${row.pr_url}) into its base and deleted the branch — verifying the release (post-merge CI + release pipelines) before acceptance.`);
            }

            // 2 · the verdict — poll the merge commit until the release settles
            const sha = await ghPrMergeSha(slug, row.pr_number);
            if (!sha) return; // gh hasn't surfaced the merge commit yet — next tick
            await tickAuto('merge', `squash-merged as ${sha.slice(0, 7)}`);
            for (let round = 0; ; round++) {
              const cur = await db.get<{ state: string }>('select state from tasks where id = ?', [row.id]).catch(() => null);
              if (cur?.state !== 'verifying') return; // accepted / bounced / cancelled elsewhere — stand down
              const v = await waitForRelease(slug, sha);
              if (v.verdict === 'green' || v.verdict === 'none') {
                const note = v.verdict === 'green' ? v.detail : 'no post-merge CI or release workflows configured — proceeding on the review verdict';
                await tickAuto('verify', note);
                if (!(await said(`Release verified for #${row.number}`))) await say(`✅ Release verified for #${row.number} — ${note} (merge \`${sha.slice(0, 7)}\`). Accepting.`);
                const res = await post('/v1/commands', actor, { type: 'task.confirm_release', taskId: row.id, note });
                if (res.status === 409) console.log(`ship_verify task=${row.number} confirm_release 409 — state moved, standing down`);
                else if (!res.ok) console.error(`ship_verify task=${row.number} confirm_release ${res.status}`);
                else console.log(`ship_verify task=${row.number} release confirmed (${v.verdict})`);
                return;
              }
              if (v.verdict === 'red') {
                console.error(`ship_verify task=${row.number} RED: ${v.detail}`);
                if (!(await said(`Release verification FAILED for #${row.number}`))) { await say(`🔴 Release verification FAILED for #${row.number} — ${v.detail} ([PR #${row.pr_number}](${row.pr_url}) @ \`${sha.slice(0, 7)}\`). I keep watching: re-run the failed pipeline and I pick it up. **Accept** overrides; **Request changes** bounces a fix-forward round.`); notifyDesktop(`Release verification failed · #${row.number}`, v.detail); }
              } else {
                // a pending verdict that outlived waitForRelease's window — say so once, keep watching
                if (!(await said(`Release verification for #${row.number} is still settling`))) { await say(`⏳ Release verification for #${row.number} is still settling — ${v.detail}. I keep watching.`); notifyDesktop(`Release still settling · #${row.number}`, v.detail); }
              }
              if (process.env['NM_GH_FAKE'] === '1') return; // gates stay deterministic — no re-check loop
              if (round >= 47) return; // ~24h of half-hour re-checks — past this the stall watchdog owns it
              await new Promise((res2) => setTimeout(res2, 30 * 60_000));
            }
          } catch (err) {
            console.error(`ship_verify task=${row.number} failed:`, err);
          } finally {
            verifyInFlight.delete(row.id);
          }
        })();
      }
    },
    onError: () => {},
  },
);

db.watch(
  `select id, number, title, channel_id, ship_plan from tasks where state = 'ship_review'`,
  [],
  {
    onResult: async (r) => {
      for (const row of (r.rows?._array ?? []) as Array<ShipTask & { ship_plan: string | null }>) {
        let plan: ShipPlan | null = null;
        try { plan = row.ship_plan ? (JSON.parse(row.ship_plan) as ShipPlan) : null; } catch { continue; }
        if (!plan) continue;
        shipPrepped.delete(row.id); // the round landed — a later revise re-enters the draft flow cleanly
        const marker = `Release plan v${plan.round} for #${row.number}`;
        const key = `${row.id}:${plan.round}`;
        if (shipAnnounceInFlight.has(key)) continue;
        const orch = [...agents.values()].find((a) => a.role === 'orchestrator' && a.channels.has(row.channel_id));
        if (!orch) continue;
        shipAnnounceInFlight.add(key);
        void (async () => {
          // persisted dedupe: the shipper's own proposal message carries the marker;
          // the orchestrator adds the channel digest line only if nobody has yet
          const seen = await db.getAll<{ id: string }>(`select id from messages where channel_id = ? and (task_id is null or task_id != ?) and body like ?`, [row.channel_id, row.id, `%${marker}%`]).catch(() => []);
          if (seen.length) return;
          const needYou = plan.items.filter((i) => i.owner === 'human' && i.state === 'pending').length;
          const chan = await db.get<{ id: string; workspace_id: string; slug: string }>('select id, workspace_id, slug from channels where id = ?', [row.channel_id]).catch(() => null);
          if (!chan) return;
          await post('/v1/messages', { kind: 'agent', id: orch.id, role: 'orchestrator' }, {
            workspace: chan.workspace_id, channel: chan.id,
            body: `${marker} is ready — risk **${plan.risk}**, ${plan.items.length} items${needYou ? ` (${needYou} yours)` : ''}. Approve it in the task thread; @${agents.get(plan.shipperId)?.name ?? 'the shipper'} merges when the checklist clears.`,
          }).catch(() => {});
          notifyDesktop(`Release plan · #${row.number}`, `${row.title} — risk ${plan.risk}; approve to arm the checklist.`);
        })();
      }
    },
    onError: () => {},
  },
);


  return { releaseDocsNote };
}
