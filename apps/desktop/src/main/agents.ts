// AgentHost slice 1: channel-scoped @mention wake → reply, posted through the
// control-api as a real agent actor. `runAgentTurn` is the seam where the
// Claude Agent SDK lands (W3 slice 2); without ANTHROPIC_API_KEY it echoes.
// Electron is loaded ON USE (see electronlazy.ts) — this module is 9k lines of behaviour that
// tests import under plain node, and the three call sites below already tolerate its absence
// because they run headless too.
import { apiAuthHeaders } from './apiauth';
import { electron } from './electronlazy';
import { startPlanRouteWatch } from './host/planroute';

// Desktop notification (local, the human's machine) — fired when a plan needs
// the human's review. Best-effort: silently no-ops if unsupported.
export function notifyDesktop(title: string, body: string): void {
  try {
    const Notification = electron()?.Notification;
    if (Notification?.isSupported()) new Notification({ title, body }).show();
  } catch { /* headless / unsupported */ }
}

// live token streaming to the local renderer — key = `${channelId}:${taskId??''}`
// THE choke point for every live bubble — so the machine-fence filter belongs here rather than
// at each of the dozen call sites. onDelta hands us the GROWING text, which means a fence the
// daemon is going to strip from the posted message would otherwise type itself out in front of
// the human first (live #1048: a JSON array of post bodies, under "plume is typing"). While a
// fence is open we say what is being written instead, in the renderer's own forming-hint idiom.
export function emitStream(key: string, agent: string, text: string, done: boolean): void {
  const { text: visible, forming } = visibleStream(text);
  const body = forming ? `${visible}${visible ? '\n\n' : ''}› *${forming === 'drafts' ? 'updating the drafts' : 'question card forming'}…*` : visible;
  for (const w of electron()?.BrowserWindow.getAllWindows() ?? []) {
    if (!w.webContents.isDestroyed()) w.webContents.send('nm:agent-stream', { key, agent, text: body, done });
  }
}

import type { PowerSyncDatabase } from '@powersync/node';
import type { AgentLog, LogFn } from './agentlog';
import { buildDesignPrompt, designSystemPrompt, claudeDesignPromptBlock, designProviderFromEvents, mentionRe, bareAddressRe, defaultBaselineRules, visibleStream, STARTER_MODEL, TURN_BUDGETS, type Actor, type DesignProvider, type NMEvent, type SessionOrigin } from '@neuramesh/shared';

import { HostQueue, durableStore } from './harness/hostqueue';
// shared compute (0114): one origin-affinity rule, shared with every other client
import { shouldClaim, type ClaimVerdict, type ComputePrefs, type MachineCapability } from '@neuramesh/shared';
import { Brain, type SubjectRef, cachePath, deliverablePath } from './harness/brain';
import { removeTaskWorkspace } from './harness/workspaces';
import { stagePriorDesignRound } from './staging';
import { claudeCode } from './runtime/claudecode';
import { makeBerthSweep } from './host/berthsweep';
import { makeSchedules } from './host/schedules';
import { makeOrchSweeps } from './host/orchsweeps';
import { makeWake } from './host/wake';
import { makeWakeRouting } from './host/wakerouting';
import { makeSleeperWake } from './host/sleepers';
import { makeLegs } from './host/legs';
import { makeOrchTurn } from './host/orchestratorturn';
import { postReplyCard } from './host/replycard';
import { searchXText } from './host/searchx';
import { makeWbClosures } from './host/wbclosures';
import { type SweepSnapshot } from './harness/berths';

// The live berth sweep, registered by startWatches — sync.ts's footprint IPC calls it for
// Reclaim-now. Null until an agent host runs (headless windows, tests): callers surface that
// as "no daemon on this machine", never a crash.
let berthSweepLive: (() => Promise<SweepSnapshot>) | null = null;
export function berthSweepNow(): Promise<SweepSnapshot | null> {
  return berthSweepLive ? berthSweepLive() : Promise.resolve(null);
}
import { ParkBook } from './harness/park';

import { readAnswers } from '@neuramesh/shared';

import { pickImageProvider, generateImage, reviewImage, thumbDataUrl, publishDataUrl, type ImageCred } from './imagegen';
import { parseBrandGuidelines, buildImagePrompt, EMPTY_BRAND, type BrandTokens } from '@neuramesh/shared';
import type { RuntimeAdapter, ProviderName, PromptOverride } from './runtime/adapter';
import { providerFor, keyEnvFor, setAgentProxy, sandboxFsEnabled, setSandboxFsCache } from './runtime/adapter';
import { startEgressProxy } from './sandbox/egress';
import { readSandboxSetting } from './sandbox/setting';
import { git, repoSlugFor, ghCapable, ghPrMerge, ghPrState } from './host/gh';
import { withTimeout, claudeTurn, directComplete } from './host/turnkit';
import { designBlocks } from './host/plan';

export { ghFakeCalls } from './host/gh';


import { emitProcChange } from './procbus';
import { directActs } from './host/directacts';

import { hasSubscription, hasProviderLogin } from './runtime/detect';
import { readMemberKey } from './runtime/memberkey';
import { decideAuth, type AuthResolution } from './runtime/authpolicy';

import { codexSdkAdapter } from './runtime/codexsdk';

import { type MonitorSignals } from './sweepgate';

import { geminiAdapter } from './runtime/gemini';

import { createStatusPump } from './presence';

import { makeHostGuards } from './host/guards';
import { makeBeats } from './host/beats';
import { makeRuns, type RunHandle } from './host/runs';
import { makePark } from './host/park';
import { makeLookups } from './host/lookups';

import { makeOrchTools } from './host/orchtools';
import type { HostCtx } from './host/ctx';
import { anthropicOrchestratorTurn, codexSdkOrchestratorTurn, geminiDispatch, type OrchTransportArgs } from './host/orchturn';
import { makeChatTurn } from './host/chatturn';
import { makeFlows } from './host/flows';
import { makeEcho } from './host/echo';
import { makeMarketing } from './host/marketing';
import { makeWorkspace } from './host/workspace';
import { makeMemory } from './host/memory';
import { makeDispatch } from './host/dispatch';
import { makeStaffing } from './host/staffing';
import { makeContent } from './host/content';

export interface HostedAgent {
  id: string;
  name: string;
  model: string;
  role: string;
  runtime: string; // 'claude-code' | 'codex' | 'gemini' — selects the RuntimeAdapter
  brief?: string | null; // one-line specialty remit (0056) — injected into task prompts
  // 'manual' = a human pinned this brain by hand; project packs (like workspace packs)
  // must never quietly move it. See seatFor().
  modelSource?: string | null;
  channels: Set<string>;
}

// a discoverable team Agent Skill (post enable/disable filter) — the body is the
// full procedure load_skill returns; pack_name labels which pack it came from
export type SkillRef = { name: string; description: string; body: string; pack_name?: string | null };

interface HostOpts {
  db: PowerSyncDatabase;
  machineId: string;
  /** the workspace this host is standing in — agents are workspace-level resources now (0114),
   *  so this, not machineId, is what decides which agents this daemon may serve */
  workspace: string;
  apiUrl: string;
  ownerActorId: string;
  agentLog: AgentLog;
  killTaskPtys?: (taskNumber: number) => void; // kill any open review terminals before reclaiming a workspace
}

export interface ExecTask {
  id: string;
  number: number;
  title: string;
  channel_id: string;
  repo_id: string | null;
  base_ref: string | null;
  branch: string | null;
  requirements?: string | null;
  kind?: string | null; // task_kind — a content task routes the marketer's posts.json into content_items
}

export interface OfferedTask extends ExecTask {
  offered_agent_id: string;
  requirements: string | null;
  requirements_confirmed: number;
  /** who filed it — a HUMAN creator is the origin member whose machine gets first refusal (0114);
   *  an agent creator (the orchestrator filing on the board's behalf) leaves it unattributed */
  creator_kind?: string | null;
  creator_id?: string | null;
}

export interface ThreadTask {
  id: string;
  number: number;
  title: string;
  description: string | null;
  state: string;
  channel_id: string;
  assignee_kind: string | null;
  assignee_id: string | null;
  kind?: string | null; // 'content' routes a thread reply to the draft-revise flow, not a chat turn
}














// A task's project automation policy (task → channel → project). Both default true (today's
// behavior); humans flip them in Project settings. Failures fall back to the defaults.
export async function projectPolicy(
  db: { getAll: <T>(sql: string, params?: unknown[]) => Promise<T[]> },
  channelId: string,
): Promise<{ autoOpenPr: boolean; runCiBeforeMerge: boolean; shipGate: boolean }> {
  try {
    const [p] = await db.getAll<{ auto_open_pr: number | null; run_ci_before_merge: number | null; ship_gate: number | null }>(
      'select p.auto_open_pr, p.run_ci_before_merge, p.ship_gate from projects p join channels c on c.project_id = p.id where c.id = ?',
      [channelId],
    );
    return {
      autoOpenPr: p?.auto_open_pr == null ? true : !!p.auto_open_pr,
      runCiBeforeMerge: p?.run_ci_before_merge == null ? true : !!p.run_ci_before_merge,
      // ship gate (docs/23) defaults ON; pre-flag replica rows (null) read true —
      // this is what makes the rollout re-snapshot-free
      shipGate: p?.ship_gate == null ? true : !!p.ship_gate,
    };
  } catch { return { autoOpenPr: true, runCiBeforeMerge: true, shipGate: true }; }
}



// Concurrent workers share one cached clone per repo — git's fetch/worktree
// locks are not reentrant, so clone-dir operations serialize per repo. The
// work itself (and pushes, which lock per-branch on the remote) run freely.
const repoLocks = new Map<string, Promise<unknown>>();
export async function withRepoLock<T>(repoId: string, fn: () => Promise<T>): Promise<T> {
  const prev = repoLocks.get(repoId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  repoLocks.set(repoId, next);
  return next;
}


// Resolve the BYOK key for an agent's runtime (the A2A multi-runtime path). The
// provider derives from the agent's runtime (claude-code→anthropic, codex→openai,
// gemini→gemini); the workspace/agent credential is the real source, the matching
// env var (ANTHROPIC_API_KEY / CODEX_API_KEY / GEMINI_API_KEY — the machine's
// keychain) is the local fallback. Keys never leave the machine.
// what THIS machine can serve — lives in runtime/localruntimes.ts (member-machines round); the
// re-export keeps sync.ts and machined.ts on the name they always imported
import { localRuntimes } from './runtime/localruntimes';
export { localRuntimes };

export async function resolveToken(
  apiUrl: string,
  workspace: string,
  agent: HostedAgent,
  ownerActorId: string,
): Promise<AuthResolution> {
  const provider = providerFor(agent.runtime);
  // The user's stored preference for this provider (apikey + a key, or subscription), plus the
  // workspace failover policy (auto = may fall over to a key; manual/default = surface a card).
  let stored: { token: string | null; authMode: 'apikey' | 'subscription' | null } = { token: null, authMode: null };
  let autoFailover = false;
  try {
    const r = await fetch(`${apiUrl}/v1/credentials/resolve?workspace=${workspace}&agentId=${agent.id}&provider=${provider}`, {
      headers: await apiAuthHeaders(apiUrl, { kind: 'human', id: ownerActorId }),
    });
    const j = (await r.json()) as { token?: string | null; authMode?: 'apikey' | 'subscription' | null; autoFailover?: boolean };
    stored = { token: j.token ?? null, authMode: j.authMode ?? null };
    autoFailover = !!j.autoFailover;
  } catch { /* offline → fall back to env/detection below */ }
  const envKey = keyEnvFor(provider).map((k) => process.env[k]).find((v): v is string => !!v) ?? null;
  // THIS member's own key, from THIS machine, never uploaded (0114). Outranks the workspace
  // credential: under shared compute the stored one belongs to whoever configured the workspace,
  // and a member who supplied their own must never silently bill a teammate's.
  // inline require, matching the sandbox-setting read below: agents.ts has no top-level electron
  // import, so the node test runner can load this module without an Electron host
  const memberKey = (() => {
    try {
      const { app } = require('electron') as typeof import('electron');
      return readMemberKey(app.getPath('userData'), provider);
    } catch { return null; }
  })();

  // seated on the HOUSE model? then the platform serves this agent when nothing of the user's
  // resolves — a catalog fact, not a credential lookup.
  const platformModel = agent.model === STARTER_MODEL;
  // A cloud machine (runner/member) has no vendor logins to reconnect — machined sets this on the
  // image, and a laptop the user owns leaves it unset.
  const cloudMachine = ['runner', 'member'].includes(process.env['NM_MACHINE_KIND'] ?? '');
  // Explicit API-key mode needs no machine detection (decideAuth ignores sub/login there).
  if (stored.authMode === 'apikey') {
    return decideAuth({ provider, storedAuthMode: 'apikey', storedToken: stored.token, autoFailover, subActive: false, loginPresent: false, envKey, memberKey, platformModel, cloudMachine });
  }
  // Subscription-preferring path: probe this machine for a usable / present login, then decide.
  const [subActive, loginPresent] = await Promise.all([hasSubscription(provider), hasProviderLogin(provider)]);
  return decideAuth({ provider, storedAuthMode: stored.authMode, storedToken: stored.token, autoFailover, subActive, loginPresent, envKey, memberKey, platformModel, cloudMachine });
}

// @mention + bare-leading-name matching lives in @neuramesh/shared (mentions.ts) —
// the SAME tokenizer drives the composer highlight, so a name that lights up in the
// input is exactly a name these wake decisions will summon.

export function echoTurn(agent: HostedAgent, body: string): string {
  const stripped = body.replace(mentionRe(agent.name, 'gi'), '').replace(bareAddressRe(agent.name), '').trim();
  return `[echo · ${agent.name}] heard: “${stripped}” — set an Anthropic key (agent, workspace, or env) for real replies.`;
}

export const PROVIDER_LABEL: Record<ProviderName, string> = { anthropic: 'Claude', openai: 'OpenAI/Codex', gemini: 'Gemini' };

// The message an agent posts when its PREFERRED subscription login is down and the failover
// policy won't silently bill a key — an actionable card the human acts on (reconnect the CLI
// login, or explicitly switch to API-key mode). Carries a fenced ```nmauth block the renderer
// turns into buttons; degrades to a readable note if rendered as plain markdown.
export function authBlockedCard(agent: HostedAgent, blocked: { provider: ProviderName; reason: 'expired' | 'unavailable' }, taskNumber?: number): string {
  const label = PROVIDER_LABEL[blocked.provider];
  const why = blocked.reason === 'expired'
    ? `your **${label}** subscription login on this machine has expired`
    : `there's no active **${label}** subscription login on this machine`;
  const what = taskNumber ? `can't run #${taskNumber}` : `can't reply`;
  const card = JSON.stringify({ provider: blocked.provider, reason: blocked.reason, agent: agent.name, ...(taskNumber ? { taskNumber } : {}) });
  return `⚠️ @${agent.name} ${what} — ${why}. I won't fall back to an API key on my own (that would bill you), so choose how to proceed:\n\n\`\`\`nmauth\n${card}\n\`\`\``;
}


/** Does a PUBLISHING X connector serve this room? Scoped by PROJECT, not channel (0106) and
 * ordered exactly like `connectorWithSecret`, so what a chat turn is told matches what publish
 * would actually resolve. Only the boolean is needed here — the orchestrator reads the full
 * connector list for its own scheduling context and derives the same flag from it. */
export async function xPublishConnectedFor(
  db: { getAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> },
  ch: { id: string; workspace_id: string },
): Promise<boolean> {
  const rows = await db.getAll<{ provider: string }>(
    `select k.provider from connectors k
      where k.workspace_id = ? and k.status = 'connected' and k.provider = 'x'
        and (k.project_id is null
             or k.project_id = (select project_id from channels where id = ?))
      limit 1`,
    [ch.workspace_id, ch.id],
  ).catch(() => [] as Array<{ provider: string }>);
  return rows.length > 0;
}

/**
 * What an agent is told about reading X — ONE wording, shared by the orchestrator and chat
 * prompts so the two can never drift into disagreeing about the same room.
 *
 * A live run fanned four research legs at "X engagement research for @handle" with only
 * WebSearch/WebFetch, hit x.com's 402 login wall, and filed follower-count proxies labelled
 * "high reach" — because the room said "Connected accounts: x (@handle)" and nothing said
 * whether that meant readable.
 *
 * ONE boolean, because reading and publishing are now ONE credential: the connector's token
 * already carries `tweet.read`, and the server reads with it (/v1/x/search). The old
 * "publishing works but reading does not" arm is gone with the BYOK bearer that created it.
 *
 * Silent when no account is connected — deliberately. `search_x` still EXISTS on that turn, so
 * an agent asked to search calls it, gets the 409, and is told exactly what to say by the tool
 * result. An enforced refusal beats a prompted one (doctrine §4), and a room that never touches
 * X pays nothing for this.
 */
export function xResearchNote(connected: boolean): string {
  if (!connected) return '';
  return `\n\n[READING X — this room's connected X account can be READ as well as published to, so you have real access. Use the \`search_x\` tool for ANY question about what is on X: finding posts to reply to, gauging a topic, checking whether a handle is active. It returns real handles and real engagement numbers, or an honest failure — never estimates. Do NOT answer X questions with WebFetch or WebSearch instead: x.com answers unauthenticated fetches with a login wall and search engines barely index it, so those two produce guesses. Reads are metered, so search deliberately with a specific query rather than by reflex.]`;
}













// The Anthropic adapter is a straight binding of the three Claude functions to
// the RuntimeAdapter seam — no behavior change. Codex/Gemini adapters (slice 2)
// implement the same three methods via their CLIs + SDKs.
const anthropicAdapter: RuntimeAdapter = {
  streamTurn: claudeTurn,
  complete: directComplete,
  runQuery: claudeCode,
};
// pick the RuntimeAdapter for an agent by its runtime (the A2A multi-runtime seam).
export function runtimeFor(runtime: string): RuntimeAdapter {
  // OpenAI agents run the in-process @openai/codex-sdk (worker/chat/reason) — the local codex harness
  // on the user's ChatGPT login or an OpenAI key. e2e-validated on the subscription in the live daemon.
  if (runtime === 'codex') return codexSdkAdapter;
  if (runtime === 'gemini') return geminiAdapter;
  return anthropicAdapter;
}

// ── "Give me ideas" — the launcher's live assessment ──────────────────────────
// Instead of canned sample pills, the + New task launcher asks the orchestrator
// for ideas grounded in the room's ACTUAL state: a tool-less one-shot over the
// open board, parked backlog, and roster, returning 3–4 prompts it could
// genuinely drive there. Module-level so sync.ts can expose it over IPC; the
// host lends its handles at boot. Null (no host / no orch / no creds / bad
// shape) tells the renderer to fall back to its generic samples — the button
// always yields pills. Echo mode answers instantly so the flow demos keyless.
let ideasHost: { db: HostOpts['db']; apiUrl: string; ownerActorId: string } | null = null;

export async function launcherIdeas(channelId: string, mode: 'task' | 'routine'): Promise<string[] | null> {
  const h = ideasHost;
  if (!h) return null;
  const ch = await h.db.get<{ id: string; slug: string; workspace_id: string; kind: string | null; topic: string | null }>(
    'select id, slug, workspace_id, kind, topic from channels where id = ?', [channelId],
  ).catch(() => null);
  if (!ch) return null;
  const orch = await h.db.get<HostedAgent>(
    `select id, name, model, role, runtime, brief from agents where workspace_id = ? and role = 'orchestrator' and retired_at is null limit 1`,
    [ch.workspace_id],
  ).catch(() => null);
  if (!orch) return null;
  if (process.env['NM_AGENT_MODE'] === 'echo') {
    return mode === 'task'
      ? [`Summarize what moved in #${ch.slug} this week`, 'Audit the board — flag anything stuck or unowned', 'Draft a plan for the next milestone']
      : ['Post a morning summary of overnight movement', 'Friday recap: what shipped and what stalled'];
  }
  const cred = await resolveToken(h.apiUrl, ch.workspace_id, orch, h.ownerActorId);
  if (cred.blocked || cred.authMode === 'none') return null;
  const board = await h.db.getAll<{ number: number; title: string; state: string }>(
    `select number, title, state from tasks where channel_id = ? and state not in ('closed', 'accepted', 'backlog') order by updated_at desc limit 12`, [ch.id],
  ).catch(() => [] as Array<{ number: number; title: string; state: string }>);
  const backlog = await h.db.getAll<{ title: string }>(
    `select title from tasks where channel_id = ? and state = 'backlog' order by updated_at desc limit 8`, [ch.id],
  ).catch(() => [] as Array<{ title: string }>);
  const roster = await h.db.getAll<{ name: string; role: string }>(
    `select a.name, a.role from agents a join agent_channels ac on ac.agent_id = a.id where ac.channel_id = ? and a.retired_at is null order by a.name`, [ch.id],
  ).catch(() => [] as Array<{ name: string; role: string }>);
  const system =
    `You are ${orch.name}, the orchestrator for #${ch.slug} in a NeuraMesh workspace. A human opened the "new ${mode}" launcher and asked for ideas. ` +
    `Suggest work YOU can actually drive in this room, grounded ONLY in the room state provided — reference its real tasks and gaps, never invent features or tools. ` +
    (mode === 'routine'
      ? 'Each idea must make sense as a RECURRING routine on a schedule (a standing summary, check, or sweep). '
      : 'Each idea must be a one-off ask you could triage now (a fix, an audit, a summary, a plan, a backlog promotion). ') +
    `Output ONLY a JSON array of 3-4 strings, no prose, no fences: each one a message in the human's own words, imperative, ≤ 90 chars.`;
  const state = [
    `Room: #${ch.slug}${ch.kind && ch.kind !== 'build' ? ` (${ch.kind})` : ''}${ch.topic ? ` — ${ch.topic}` : ''}`,
    roster.length ? `Team: ${roster.map((r) => `${r.name} (${r.role})`).join(', ')}` : 'Team: just the orchestrator',
    board.length ? `Open board:\n${board.map((t) => `- #${t.number} ${t.title} · ${t.state}`).join('\n')}` : 'Open board: empty',
    backlog.length ? `Backlog (parked):\n${backlog.map((t) => `- ${t.title}`).join('\n')}` : 'Backlog: empty',
  ].join('\n\n');
  try {
    const raw = (await withTimeout(
      runtimeFor(orch.runtime).complete(system, state, cred.token ?? '', orch.model, 400),
      30_000, 'launcher ideas timed out after 30s',
    )).trim();
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').match(/\[[\s\S]*\]/)?.[0] ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return null;
    const clean = [...new Set(parsed.filter((s): s is string => typeof s === 'string').map((s) => s.trim().slice(0, 120)).filter(Boolean))].slice(0, 4);
    return clean.length >= 2 ? clean : null;
  } catch (err) {
    console.warn(`launcher_ideas #${ch.slug} fell back:`, err instanceof Error ? err.message : err);
    return null;
  }
}




// No wall clock on execution (2026-07-29). The 15m cap existed because nothing else
// could tell "still working" from "wedged", so the daemon guessed with a timer and
// threw away real work at the boundary — plus a "Still on it — 6m in" heartbeat spamming
// every task thread to prove the run was alive. Both are obsolete: a task's execution now
// opens a synced `work` run (docs/29) whose step line narrates the live activity feed, so
// liveness is OBSERVED rather than asserted, and the stall watchdog (stall.ts) reads that
// same feed to flag a run that genuinely stopped moving. A run ends when the work ends,
// when a human hits Stop, or when the watchdog escalates it — never on a timer.
// after this many failed execution attempts, auto-block instead of re-looping
// on every host restart (the stuck-#1004 lesson, 2026-06-13)
export const EXEC_FAIL_BLOCK_AFTER = 2;

// The orchestrator's two sweep cadences (see runOrchestratorSweeps): the full pass carries
// the judgment turns (digests + the periodic self-check) and stays rationed; the watchdog
// pass is a deterministic activity-feed scan that only spends a turn when work is actually
// stuck — the replacement for agents announcing their own progress.
const ORCH_FULL_SWEEP_MS = 15 * 60_000;
const ORCH_WATCHDOG_MS = 5 * 60_000;

// Active executions on THIS host, keyed by task id — so a cancel can abort the
// in-flight run immediately (the "stop a task → halt the agent" path). The cancel
// watch finds the AbortController here and aborts it; `stoppedTasks` marks the ones
// halted by a STOP (vs the time cap) so executeFlow halts cleanly without pushing
// or submitting half-work. Exported for the gate to assert the abort fired.
export const executing = new Map<string, AbortController>();
export const stoppedTasks = new Set<string>();
// stop an in-flight run cleanly: mark it stopped (so executeFlow bails without pushing half-work), abort, drop.
export function stopExecuting(taskId: string): void {
  stoppedTasks.add(taskId);
  executing.get(taskId)?.abort();
  executing.delete(taskId);
  emitProcChange();
}

// Await a permission card's answer by polling the replica for its decision row to flip
// (the human answered Approve/Deny on desktop or mobile). Fail-closed: returns null on
// timeout, dismissal, or the run aborting (cap/cancel) → the gate denies. The card was
// posted as the agent, so the server already turned it into an open decision row.
/**
 * `where` is the conversation the card is waiting in: a claimed task, or (docs/34) a chat
 * thread, which has no task at all. The two differ only in which column the reply-line
 * fallback reads and whether an abort can cancel the wait — a chat has no execution to abort.
 */
export async function awaitDecision(
  db: PowerSyncDatabase,
  messageId: string,
  where: { taskId: string } | { threadId: string },
  question: string,
  timeoutMs = TURN_BUDGETS.review.wallMs, // docs/harness/05 §3.6
): Promise<string | null> {
  const taskId = 'taskId' in where ? where.taskId : null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (taskId && executing.get(taskId)?.signal.aborted) return null;
    // 1) authoritative: the decision row flipped (a desktop decision.answer)
    const drows = await db
      .getAll<{ status: string; answer: string | null }>('select status, answer from decisions where message_id = ? limit 1', [messageId])
      .catch(() => [] as { status: string; answer: string | null }[]);
    const d = drows[0];
    if (d && d.status !== 'open') return d.status === 'answered' ? d.answer : null;
    // 2) reply-line answer (`**question** → Approve`) — how a mobile client answers today
    const mrows = await db
      .getAll<{ body: string }>(
        taskId
          ? "select body from messages where task_id = ? and author_kind = 'human'"
          : "select body from messages where thread_id = ? and author_kind = 'human'",
        [taskId ?? (where as { threadId: string }).threadId],
      )
      .catch(() => [] as { body: string }[]);
    const ans = readAnswers(mrows.map((r) => r.body)).get(question);
    if (ans) return ans;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}


// Repo-less deliverables: whatever the agent wrote in the scratch workspace
// becomes file artifacts (text, capped) — "build me a page" must ship the page.
const ARTIFACT_CAP = 390_000; // stay under the 400KB command-schema cap

// downscale an image to a data URI that fits inline (full-res → Storage, phase 2)
export function imageDataUri(path: string): string | null {
  try {
    const nativeImage = electron()?.nativeImage;
    if (!nativeImage) return null;
    const img = nativeImage.createFromPath(path);
    if (img.isEmpty()) return null;
    const { width } = img.getSize();
    let uri = (width > 1000 ? img.resize({ width: 1000, quality: 'good' }) : img).toDataURL();
    if (uri.length > ARTIFACT_CAP) uri = img.resize({ width: 640, quality: 'good' }).toDataURL();
    return uri.length <= ARTIFACT_CAP ? uri : null;
  } catch {
    return null;
  }
}


// Deterministic decomposition for echo mode: split one request into distinct
// deliverables so the protocol's "one message → several intakes" path is
// exercised without a model. The real (claude) orchestrator uses judgment; this
// is a stand-in. Strong signals only (enumeration / separators), capped at 4.
export function splitGoals(raw: string): string[] {
  const goal = raw.trim();
  // strongest signal: a numbered or bulleted list across lines
  const items = goal
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => /^(\d+[.)]|[-*•])\s+/.test(l))
    .map((l) => l.replace(/^(\d+[.)]|[-*•])\s+/, '').trim());
  if (items.length >= 2) return items.slice(0, 4);
  // otherwise split one line on separators between distinct asks
  const parts = goal
    .split(/\s*(?:[,;]|\band also\b|\bthen\b|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
  return parts.length >= 2 ? parts.slice(0, 4) : [goal];
}

// a human's `/`-attached skill rides as a leading guillemet marker on the message
// body (‹skill:name@pack›) — both the renderer chip and the orchestrator read it
export const SKILL_MARKER = /‹skill:([\w-]+)(?:@([\w-]+))?›/;
export function parseSkillMarker(body: string): { name: string; pack?: string } | null {
  const m = body.match(SKILL_MARKER);
  return m ? { name: m[1]!, ...(m[2] ? { pack: m[2] } : {}) } : null;
}

// Load a message's attachments for agent context: image bytes as base64 (Claude image blocks),
// text files decoded + inlined, other binaries noted by name. Returns the structured list AND a
// manifest appended to the transcript so EVERY runtime is at least aware of (and can read text
// from) them — image vision is Claude-only, the rest degrade to the manifest.
export type AttDbLike = { getAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> };
const TEXTUAL_EXT = /\.(md|markdown|txt|text|json|jsonc|ya?ml|toml|csv|tsv|log|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|cc|cs|php|sh|bash|zsh|sql|html?|css|scss|xml|svg|env|ini|cfg|conf|dockerfile|diff|patch)$/i;
export function isTextual(mime: string, name: string): boolean {
  return mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || TEXTUAL_EXT.test(name);
}

// Locally git-exclude host/agent staging dirs in a repo checkout, so the submit's
// `git add -A` can never sweep them into the commit/PR: .nm-attachments/ (staged chat
// attachments) and .nm-evidence/ (mock render sources + scratch evidence the agent
// produces — the class of files that leaked into PR #149 on task #1004). info/exclude
// is repo-local and never touches the user's .gitignore; idempotent (worktrees share
// the clone's exclude file, and attempts repeat).
export async function excludeFromGit(dir: string, patterns: string[]): Promise<void> {
  try {
    const { readFile, appendFile } = await import('node:fs/promises');
    const { join, isAbsolute } = await import('node:path');
    const rel = await git(['rev-parse', '--git-path', 'info/exclude'], dir);
    const file = isAbsolute(rel) ? rel : join(dir, rel);
    const existing = await readFile(file, 'utf8').catch(() => '');
    const missing = patterns.filter((p) => !existing.split('\n').includes(p));
    if (missing.length) await appendFile(file, `\n${missing.join('\n')}\n`);
  } catch { /* not a git repo / no exclude — best effort */ }
}
export const STAGING_EXCLUDES = ['.nm-evidence/', '.nm-attachments/'];





/**
 * Did the rework actually rework anything? With round N-1 staged on disk, the
 * collector always finds files, so a run that edited nothing would silently
 * re-propose the previous round as new — the "no mockups" guard can no longer
 * catch it. A round is real if any file changed, appeared, or was dropped.
 */
export function designRoundChanged(
  staged: Map<string, string>,
  collected: Array<{ name: string; html: string }>,
): boolean {
  if (!staged.size) return true; // round 1 — nothing to compare against
  if (collected.length !== staged.size) return true;
  return collected.some((m) => staged.get(m.name) !== m.html);
}

// The output contract for a marketing content task: the marketer writes its drafts to posts.json,
// which the daemon (draftPostsFromWorkspace) turns into task-attached content_items rendered inline
// as review cards (marketing-workflow §4.5). Injected into the content-task run so the deliverable
// is structured posts, not a prose write-up.
export const CONTENT_OUTPUT_CONTRACT = `\n\n[OUTPUT CONTRACT — this is a marketing CONTENT task, so your deliverable is the POSTS THEMSELVES, not a write-up. Write your drafts to a file named \`posts.json\` at the workspace root: a JSON array where each entry is {"platform": "x" | "instagram" | "linkedin" | "tiktok" | "email", "body": "…", "imageBrief": "… (optional)", "mediaUrl": "https://… (optional)"}. One entry per post — draft the number the brief asked for, on-brand and within each platform's limits.
"body" is ONLY the text that goes on the wire. Put NOTHING else in it — no character count, no "(draft only)" footer, no image brief, no note to the reviewer. That text would PUBLISH verbatim and it breaks the character count the human reviews against. "imageBrief" is ART DIRECTION you are handing to this room's DESIGNER, who renders it and attaches the result to the card — so write the picture you want for THIS post: subject, composition, light, mood, and the on-brand look (the palette and visual rules from brand-guidelines.md; the exact hex values are appended for you, so name the intent — "warm gold key light on near-black" — rather than pasting codes). One picture, described directly: no meta, no "an image of", no alternatives.
Set it ONLY when the post should carry a visual — because the human asked for images, or the platform requires one (Instagram and TikTok always do). A text-only post gets no imageBrief; do not invent visuals nobody asked for. Only set "mediaUrl" if you have a genuinely real public image URL — never invent one, it replaces the designer's image.
The system turns each entry into a reviewable post card in the task thread; the human approves and schedules them and you NEVER publish. Write ONLY posts.json (plus any media files you reference) — no README, no prose summary.]`;


// The same brand doc stageBrandContext hands the marketer as prose, read back as STRUCTURE so
// the image generator can bind the real palette (marketing-workflow §4.6). The bootstrap already
// writes a `| Role | Hex |` table into brand-guidelines.md — this is where that pays off. A room
// with no brand doc yet still generates, just without the colour constraint.
export async function brandTokensFor(db: AttDbLike, channelId: string): Promise<{ tokens: BrandTokens; product?: string }> {
  const [ch] = await db.getAll<{ marketing: string | null; website: string | null }>(
    `select c.marketing as marketing, p.website as website
       from channels c left join projects p on p.id = c.project_id where c.id = ?`,
    [channelId],
  ).catch(() => [] as Array<{ marketing: string | null; website: string | null }>);
  const [doc] = await db.getAll<{ inline_content: string | null }>(
    `select inline_content from artifacts where channel_id = ? and kind = 'doc' and name = 'brand-guidelines.md' order by created_at desc limit 1`,
    [channelId],
  ).catch(() => [] as Array<{ inline_content: string | null }>);
  let product = ch?.website ?? undefined;
  try { if (ch?.marketing) product = (JSON.parse(ch.marketing) as { website?: string }).website || product; } catch { /* keep the project's */ }
  return { tokens: doc?.inline_content ? parseBrandGuidelines(doc.inline_content) : EMPTY_BRAND, product };
}

// Which key draws the pictures: the BYOK credential the user stored in the app first (the same
// provider_credentials row a Codex or Gemini agent resolves), then this machine's env. Note a
// SUBSCRIPTION login is not enough — ChatGPT/Google OAuth carries no API key, and the image
// endpoints need one — so a subscription-only machine generates nothing and the draft says so.
async function storedKeyFor(apiUrl: string, workspace: string, agentId: string, ownerActorId: string, provider: 'openai' | 'gemini'): Promise<string | null> {
  // `<provider>-image` FIRST: the key entered in the marketing room's Image generation row lives
  // under its own id precisely so turning images on doesn't re-auth the agents. A plain provider
  // key still counts — a workspace already on BYOK shouldn't have to enter a second one.
  for (const id of [`${provider}-image`, provider]) {
    try {
      const r = await fetch(`${apiUrl}/v1/credentials/resolve?workspace=${workspace}&agentId=${agentId}&provider=${id}`, {
        headers: await apiAuthHeaders(apiUrl, { kind: 'human', id: ownerActorId }),
      });
      const token = ((await r.json()) as { token?: string | null }).token ?? null;
      if (token) return token;
    } catch {
      return null; // offline → the caller falls through to the machine's env
    }
  }
  return null;
}

async function imageCredFor(apiUrl: string, workspace: string, agentId: string, ownerActorId: string): Promise<ImageCred | null> {
  for (const provider of ['openai', 'gemini'] as const) {
    const key = await storedKeyFor(apiUrl, workspace, agentId, ownerActorId, provider);
    if (key) return { provider, key };
  }
  return pickImageProvider();
}

/**
 * THE DESIGNER DRAWS. Visual output belongs to the channel's designer, so a post's image is
 * commissioned on the DESIGNER's seat rather than on some ambient key — the same seat the human
 * chose for this project's visual work, in the same model pack.
 *
 * One hard constraint the pack can't wish away: Anthropic ships no image endpoint, and the
 * designer seat is curated to Claude in most packs (model-packs.ts) because its day job is
 * studying a repo and writing HTML mockups. So when the designer's own provider cannot draw, the
 * work still belongs to the designer — it just gets rendered through whichever image-capable key
 * the workspace has, and we say so out loud instead of silently producing nothing.
 */
export async function designerImageCred(
  apiUrl: string,
  workspace: string,
  designer: HostedAgent | undefined,
  ownerActorId: string,
): Promise<{ cred: ImageCred | null; note?: string }> {
  const seat = designer ? providerFor(designer.runtime) : null;
  if (designer && (seat === 'openai' || seat === 'gemini')) {
    const key = (await storedKeyFor(apiUrl, workspace, designer.id, ownerActorId, seat)) ?? pickImageProvider()?.key ?? null;
    if (key) return { cred: { provider: seat, key } };
  }
  const cred = await imageCredFor(apiUrl, workspace, designer?.id ?? '', ownerActorId);
  if (!cred) return { cred: null };
  if (designer && seat === 'anthropic') {
    return { cred, note: `${designer.name} art-directed these on ${designer.model}, but Anthropic has no image endpoint — the pictures were rendered on ${cred.provider}. Put the designer on an OpenAI or Gemini seat to keep it all on one brain.` };
  }
  return { cred };
}

// Generate ONE on-brand image and package it for a draft: the inline `thumb` the card shows and
// the publish-size `publish` that gets hosted. Shared by the create path and the revise path so
// both draw the same way (palette-bound prompt · marketer sign-off · one redraw). Never throws.
type BrandImageOut = { bytes?: Buffer; mime?: string; thumb?: string; publish?: string; model?: string; reviewNote?: string; error?: string };
export async function generateBrandImage(cred: ImageCred, reviewSeat: string, brand: { tokens: BrandTokens; product?: string }, brief: string, platform: string, agentName: string): Promise<BrandImageOut> {
  const spec = buildImagePrompt(brief, brand.tokens, platform, brand.product);
  if (!spec) return {};
  const first = await generateImage(spec, cred);
  if (!first.image) return { error: first.error };
  let img = first.image;
  const verdict = await reviewImage(cred, reviewSeat, brief, img);
  let reviewNote: string | undefined;
  if (!verdict.ok && verdict.fix) {
    const redraw = await generateImage({ ...spec, prompt: `${spec.prompt}\n\nRevision — fix exactly this and change nothing else: ${verdict.fix}` }, cred);
    if (redraw.image) { img = redraw.image; reviewNote = `${agentName} sent the ${platform} image back once — ${verdict.fix}`; }
  }
  const [thumb, publish] = await Promise.all([thumbDataUrl(img.bytes), publishDataUrl(img.bytes)]);
  return { bytes: img.bytes, mime: img.mime, thumb: thumb ?? undefined, publish: publish ?? undefined, model: first.model, reviewNote };
}

// ONE agent host per (backend, workspace). Both boot paths can otherwise race (normal boot +
// the nm:onboard handler), and two live hosts double every wake — the server-side
// reply dedupe (0060) makes the dupes impossible, but a second host still burns
// double tokens on every turn, so refuse it structurally too.
//
// Keyed rather than a process-wide flag since Local mode (connections.ts): the local stack and
// the cloud each run their own host in this one process, on their own replica, for their own
// workspace. Shared compute is still about several MEMBERS' machines serving one workspace —
// each backend gets a single host here, never two on the same workspace.
const hostsStarted = new Set<string>();
// The two task shapes the plan/design flows read. Declared at module level so the flows
// module (host/flows.ts) shares the SAME shape rather than restating it.
export type PlanTask = { id: string; number: number; title: string; description: string | null; channel_id: string; requirements: string | null; repo_id: string | null; base_ref: string | null; assignee_id?: string | null };
export type DesignTask = PlanTask & { repo_id: string | null; base_ref: string | null; updated_at: string };

/** a skill pack mid-import — the curator watch and the flow that runs it share the shape */
export type ImportPack = { id: string; name: string; channel_id: string; source_url: string; source_ref: string };

// Staging lives in staging.ts, but `agents` stays the ONE import its callers use — a split
// inside a module is not a reason for every flow to learn a second path.
export { collectFiles, runCoding, worktreeRun } from './execution';
export { RESEARCH_OUTPUT_CONTRACT, loadMessageAttachments, openPlanningWorkspace, stageApprovedDesigns, stageBrandContext, stageConnections, stagePriorDesignRound, stageTaskAttachments } from './staging';

export function startAgentHost({ db, machineId, workspace, apiUrl, ownerActorId, agentLog, killTaskPtys }: HostOpts) {
  const hostKey = `${apiUrl}|${workspace}`;
  if (hostsStarted.has(hostKey)) {
    console.warn(`agent_host already running for ${workspace.slice(0, 8)} — second start ignored (one host per backend and workspace)`);
    return;
  }
  hostsStarted.add(hostKey);
  ideasHost = { db, apiUrl, ownerActorId }; // lend the launcher's ideas one-shot its handles
  // Containment L1: bring up the egress proxy once per daemon and route every agent's HTTP(S) traffic
  // through it (agentBaseEnv reads the URL setAgentProxy stores). v1 enforces the always-on metadata /
  // link-local floor for ALL agents — the SSRF credential-theft sink no legitimate egress needs.
  // Per-workspace net.egress denial at the network layer is the next step (a per-run proxy bound to
  // that run's effective policy). Fail-open: if the proxy can't bind, agents run un-proxied rather
  // than losing egress. Opt out with NM_EGRESS_PROXY=off.
  if (process.env.NM_EGRESS_PROXY !== 'off') {
    void startEgressProxy(() => defaultBaselineRules())
      .then((p) => { setAgentProxy(p.url); console.log('egress proxy listening on', p.url); })
      .catch((e: unknown) => { console.warn('egress proxy failed to start; agents run un-proxied:', e instanceof Error ? e.message : e); });
  }
  // Containment L1b: load the per-machine sandbox toggle into the cache (default ON; NM_SANDBOX_FS
  // still overrides). Read once at boot; the IPC toggle updates the cache live for the next agent run.
  try { const { app } = require('electron') as typeof import('electron'); setSandboxFsCache(readSandboxSetting(app.getPath('userData'))); } catch { /* keep the default-on cache */ }
  // Containment L1b boot status (kernel FS sandbox — jails cred-store + userData reads). Codex keeps
  // its always-on native workspace-write regardless.
  console.log(sandboxFsEnabled()
    ? `agent FS sandbox ON: claude=native · agy=${process.platform === 'darwin' ? 'seatbelt' : 'off (non-darwin)'} · codex=workspace-write`
    : 'agent FS sandbox OFF (NM_SANDBOX_FS=off) — agents can read cred stores; codex keeps its native workspace-write');
  // context-bound log sink; alog(agent, task?, channelSlug?, runId?) -> LogFn
  const alog = (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null, runId?: string | null): LogFn =>
    agentLog.for({ agentId: agent.id, agentName: agent.name, runId: runId ?? null, taskId: t?.id ?? null, taskNumber: t?.number ?? null, channelSlug: channelSlug ?? null });
  // arun() opens a NEW activity run (a channel reply, a task attempt, a sweep, a review) — every row
  // it logs shares one run_id, so the UI can scope to "what this agent is doing right now". Returns
  // both the run-scoped logger and the run_id (pass the id to nested helpers that take their own logger).
  const arun = (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null): { log: LogFn; runId: string } => {
    const runId = crypto.randomUUID();
    return { log: alog(agent, t, channelSlug, runId), runId };
  };
  const agents = new Map<string, HostedAgent>();

  // ── shared compute (0114) ─────────────────────────────────────────────────────────────────
  // What this host can serve. Probed once at start and refreshed on the register heartbeat: a
  // login can appear (the human signs into Claude) or vanish mid-session, and a stale list makes
  // peers either wait on a machine that cannot serve or race one that can.
  let myRuntimes: string[] = [];
  void localRuntimes().then((r) => {
    myRuntimes = r;
    console.log(`agent_host runtimes=${r.join(',') || 'none'} — what this machine can serve`);
  });

  /** Every machine in this workspace, as the policy needs to see them. Read from the replica, so
   *  it works offline and costs nothing per decision. */
  async function peerMachines(): Promise<MachineCapability[]> {
    const rows = await db.getAll<{ id: string; owner_user_id: string | null; runtimes: string | null; last_seen_at: string | null; kind: string | null }>(
      'select id, owner_user_id, runtimes, last_seen_at, kind from machines where workspace_id = ?', [workspace],
    ).catch(() => []);
    // CONSENT (0119): the grant lives on the LENDER's member row, so each machine is joined to
    // its owner's `compute.shares` here — shouldClaim stays pure and needs no extra argument.
    const memberRows = await db.getAll<{ user_id: string; compute: string | null }>(
      'select user_id, compute from workspace_members where workspace_id = ?', [workspace],
    ).catch(() => []);
    const sharesOf = new Map<string, string[]>();
    for (const m of memberRows) {
      try { sharesOf.set(m.user_id, ((JSON.parse(m.compute ?? '{}') as { shares?: string[] }).shares) ?? []); } catch { sharesOf.set(m.user_id, []); }
    }
    return rows.map((r) => ({
      sharesWith: sharesOf.get(r.owner_user_id ?? '') ?? [],
      machineId: r.id, kind: r.kind ?? 'local',
      ownerUserId: r.owner_user_id ?? '',
      // jsonb arrives as text through the SQLite replica; a machine that has not published yet
      // reads as incapable, which is the safe direction (peers step in rather than wait on it)
      runtimes: (() => { try { return JSON.parse(r.runtimes ?? '[]') as string[]; } catch { return []; } })(),
      lastSeenAt: r.last_seen_at,
      // this host is authoritative about ITSELF: the replica's own row lags a resume-from-sleep,
      // and its published runtimes lag a fresh login
      ...(r.id === machineId ? { runtimes: myRuntimes, lastSeenAt: new Date().toISOString() } : {}),
    }));
  }

  /**
   * Should this machine serve this piece of work — and if not yet, how long until it should ask
   * again? Origin-affinity: the member who asked gets first refusal on their own machine, and
   * other members' machines step in only when it cannot serve (offline, or missing the runtime).
   *
   * Returns the verdict; callers that get `wait` re-ask after `retryInMs` rather than dropping
   * the work, so a wedged origin machine is a delay and never a black hole.
   */
  async function claimVerdict(
    // `model` is REQUIRED, not optional: a house-brain agent needs no local runtime, and an
    // optional field that a caller forgets silently restores the bug where a runtime-less cloud
    // runner refused every wake it had just been started for.
    runtime: string, model: string | null, originUserId: string | null, elapsedMs: number,
    extra?: { agentId?: string; priorMachineId?: string | null; threadMachineId?: string | null; origin?: SessionOrigin | null; modelFree?: boolean },
  ): Promise<ClaimVerdict> {
    const machines = await peerMachines();
    const self = machines.find((m) => m.machineId === machineId)
      ?? { machineId, ownerUserId: ownerActorId, runtimes: myRuntimes, lastSeenAt: new Date().toISOString() };
    // the ORIGIN member's compute choice (0118) — prefs speak only for the person the work came from
    const prefs = await originPrefs(originUserId);
    // the session's own designation and origin (0134, rule D9) ride beside continuity
    return shouldClaim({ self, machines, runtime, model, originUserId, elapsedMs, prefs, agentId: extra?.agentId, priorMachineId: extra?.priorMachineId ?? null, threadMachineId: extra?.threadMachineId ?? null, origin: extra?.origin ?? null, modelFree: extra?.modelFree === true }, Date.now());
  }

  /** `workspace_members.compute` for one member, from the replica. Null = unset = origin affinity. */
  async function originPrefs(originUserId: string | null): Promise<ComputePrefs | null> {
    if (!originUserId) return null;
    const row = await db.get<{ compute: string | null }>(
      'select compute from workspace_members where workspace_id = ? and user_id = ?', [workspace, originUserId],
    ).catch(() => null);
    try { return row?.compute ? (JSON.parse(row.compute) as ComputePrefs) : null; } catch { return null; }
  }

  /** Continuity (0118): the machine that last served this thread/task — where its files live.
   *  Null for a fresh thread or a channel-feed wake, which is what lets prefs move NEW work. */
  async function priorMachineFor(threadId?: string | null, taskId?: string | null): Promise<string | null> {
    const row = taskId
      ? await db.get<{ machine_id: string | null }>(
        'select machine_id from runs where workspace_id = ? and task_id = ? and machine_id is not null order by started_at desc limit 1', [workspace, taskId],
      ).catch(() => null)
      : threadId
        ? await db.get<{ machine_id: string | null }>(
          'select machine_id from runs where workspace_id = ? and thread_id = ? and machine_id is not null order by started_at desc limit 1', [workspace, threadId],
        ).catch(() => null)
        : null;
    return row?.machine_id ?? null;
  }

  /** The member a task is attributed to. Only a HUMAN creator counts: an orchestrator-filed task
   *  is nobody's in particular, and pretending otherwise would park it behind a grace window for
   *  a machine that never asked for it. */
  const originOf = (t: OfferedTask): string | null =>
    (t.creator_kind === 'human' && t.creator_id) ? t.creator_id : null;

  /** How long this host has known about an item. Tracked locally rather than read off a column:
   *  the grace window is about how long WE have deferred, and every host starts its clock when it
   *  first sees the work — which is what makes the window uniform without a shared timestamp. */
  function sinceFirstSeen(key: string): number {
    const at = firstSeen.get(key);
    if (at === undefined) { firstSeen.set(key, Date.now()); return 0; }
    return Date.now() - at;
  }
  function rearmWake(messageId: string): boolean {
    const n = wakeGaveUp.get(messageId) ?? 0;
    if (n >= 2) return false;
    if (wakeGaveUp.size > 500) wakeGaveUp.clear(); // bounded (the firedStalls idiom)
    wakeGaveUp.set(messageId, n + 1);
    processed.delete(messageId);
    return true;
  }
  // ── P1: admission control (docs/harness/05) ───────────────────────────────────────────────
  // The watches below stay exactly as they are — they become trigger PRODUCERS. What changes is that
  // a heavy flow no longer starts the instant its row appears: it asks this queue, which admits it
  // when a slot is free and admits the most urgent thing first. Before, five offers landing in one
  // sync tick started five flows, each able to spawn a ~220 MB runtime CLI, with nothing in the
  // system saying how many a machine may run.
  //
  // Its store is deliberately EPHEMERAL (the default). `claimed` below is an in-flight guard, not a
  // dedupe record: the resume watch picks up "in_progress tasks that THIS PROCESS isn't executing —
  // host crashed/restarted mid-task" by testing it, so a durable version would strand every task
  // whose host died mid-execution. Durability belongs to already-handled FACTS (merged, reclaimed).
  // ── P2 adoption: the brain, written by every queued turn (docs/harness/01 §3.3) ────────────
  // The queue is the one place that brackets every flow, so it is also where the turn ledger is
  // written. Three flows (executeFlow, claimFlow, resumeFlow) have no `finally` of their own, so
  // before this there was no record at all of how a thrown turn ended.
  //
  // Local only, under the locked 2026-06-13 privacy rule: this never reaches the replica or the cloud.
  // Best-effort by construction — the recorder is wrapped in try/catch at the queue, because a brain
  // that cannot be written must degrade the RECORD, never the work.
  const brain = new Brain();
  const execQueue = new HostQueue({
    log: (line) => console.log(`agent_host ${line}`),
    turns: {
      open: (w) => {
        const subject = w.subject;
        if (!subject) return; // no subject → nothing to file it under; the turn still runs
        brain.open(subject).ledger(w.key).append({
          t: 'turn.open', turnId: w.key, kind: w.kind, agent: w.agentId, model: '', at: new Date().toISOString(),
        });
      },
      settle: (w, state, err) => {
        const subject = w.subject;
        if (!subject) return;
        brain.open(subject).ledger(w.key).append({
          t: 'turn.settle', state,
          summary: state === 'failed' ? (err instanceof Error ? err.message.slice(0, 300) : 'the flow threw') : 'completed',
          at: new Date().toISOString(),
        });
      },
    },
  });
  // one durable store for every already-handled guard on this machine
  const hostGuards = durableStore(brain.root, (line) => console.warn(`agent_host ${line}`));

  // The whole dedupe/in-flight surface, built once and destructured so every call site
  // below keeps its own short name (host/guards.ts documents what each one remembers).
  const guards = makeHostGuards(hostGuards);
  const {
    processed, firstSeen, wakeGaveUp, claimedIds, hireProposed,
    markedOnline, bootstrapAuthCardPosted,
    saidNoCompute, reclaimed, merged, decided,
    approvedOffered, noOrchLogged, designNotified,
    importing,
    
    wakesInFlight,
    reviewed, planned, planningStaffingNotified, designed, designAsked, 
  } = guards;

  // The context extracted services take (host/ctx.ts). It is assembled here because this is
  // where its parts exist — `post` closes over apiUrl/ownerActorId, guards over the brain root.
  const ctx: HostCtx = { post, guards, machineId };
  const { declareBeats, advanceBeat, beatCursor } = makeBeats(ctx);
  const { NO_RUN, LEASE_LOST, openRun, narrate } = makeRuns(ctx);
  const { taskOf, seatLabel, workspaceOf, parentRunOf } = makeLookups(ctx, { db });

  // A Set-shaped facade so all ~15 existing call sites read unchanged, while `delete` — which every
  // caller uses to mean "let this run again" (a request_changes bounce, a failed claim) — also
  // re-arms the queue. Without that the queue would refuse the retry the old Set permitted.
  const claimed = {
    has: (id: string) => claimedIds.has(id),
    add(id: string) { claimedIds.add(id); return this; },
    delete(id: string) { execQueue.rearm(id); return claimedIds.delete(id); },
  };
  let zeroAgentWarned = false; // de-dupe the orphaned-registrations warning (re-armed on recovery)
  const startedAt = new Date().toISOString();


  // ── P1: every wake is queued too (docs/harness/05) ─────────────────────────────────────────
  // `cause: 'message'` is PRIORITY 1: a person is waiting on this specific reply, so it is admitted
  // ahead of any board work already queued. The `processed` set still guards duplicate handling; the
  // queue adds the ceiling and the ordering. Keyed per (agent, message) so two agents addressed in one
  // message both answer, while the same pair can never answer twice.
  function queueWake(agent: HostedAgent, m: { id: string; channel_id: string; thread_id?: string | null; body: string }): void {
    execQueue.run({ key: `wake:${m.id}:${agent.id}`, kind: 'chat', cause: 'message', agentId: agent.id,
      ...(m.thread_id ? { subject: { kind: 'thread' as const, id: m.thread_id } } : {}) }, () => wake(agent, m));
  }

  async function post(path: string, actor: { kind: string; id: string; role?: string }, body: unknown) {
    const res = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: await apiAuthHeaders(apiUrl, actor as Actor),
      body: JSON.stringify(body),
    });
    return res;
  }

  /** GET counterpart of `post` — for the read routes an agent tool calls (e.g. /v1/x/search).
   * A generous timeout: X's search can be slow, and a hung fetch would eat the turn's budget. */
  async function apiGet(path: string, actor: { kind: string; id: string; role?: string }) {
    return fetch(`${apiUrl}${path}`, {
      headers: await apiAuthHeaders(apiUrl, actor as Actor),
      signal: AbortSignal.timeout(30_000),
    });
  }

  // the whiteboard tool closures (host/wbclosures.ts) — the agents' strict command lane
  const { whiteboardClosures } = makeWbClosures({ ...ctx, apiUrl });

  // the reply card, for the WORKER bus (reply-radar round): the leg/work turn that found the
  // conversations hands them over itself, through the one writer host/replycard.ts owns.
  // X reads on a WORK turn (2026-08-26): TOOL_KINDS grants search_x to `work`, but a tool is only
  // advertised when the host can SERVICE it — and the closure was built for legs only. Live, the
  // worker said so itself: "no X rows were fabricated because search_x was not surfaced". The
  // grant and the closure have to move together or the grant is a lie.
  const searchXFor = (
    actor: { kind: string; id: string; role?: string },
    ch: { id: string; workspace_id: string },
  ) => (q: { query: string; max?: number }): Promise<string> =>
    searchXText(apiGet, actor, { workspaceId: ch.workspace_id, channelId: ch.id }, q.query, q.max);

  const replyDraft = (
    actor: { kind: string; id: string; role?: string },
    ch: { id: string; workspace_id: string },
    at: { taskId?: string; threadId?: string },
  ) => (i: { report?: string; baseline?: string; replies: unknown[] }): Promise<string> =>
    postReplyCard({ post, actor, ch, anchor: at.taskId ? { taskId: at.taskId } : at.threadId ? { threadId: at.threadId } : null }, i);


  /**
   * Crash recovery for runs (docs/29): settle every `running` row this agent owns.
   *
   * A run is settled in a `finally`, which never executes if the app is killed or crashes —
   * so the row stays `running` forever, the roster keeps spinning off that synced state, and
   * the background-processes popup shows nothing to stop it (that popup lists the HOST-LOCAL
   * `executing` map, which a fresh process starts empty). Called once per agent per boot,
   * beside the status reset that already handles the other half of the same crash.
   */


  /**
   * A leg's close-out line, for a row that has ~30 characters of room.
   *
   * A subagent's raw summary opens with things like "Done. Wrote
   * '~/.neuramesh/deliverables/nm-1012/angle-a.md' — 4 angles…", and an absolute host
   * path in a 30-character slot crushes the leg's own NAME out of the row (seen live). Paths collapse
   * to their basename and the boilerplate opener goes.
   */
  function legSummary(out: string): string {
    const first = out.split('\n').find((l) => l.trim()) ?? 'done';
    return first
      .replace(/\/[^\s'"`]*\/([^\s'"`/]+)/g, '$1')     // /a/b/c.md → c.md
      .replace(/^(?:Done|Finished|Complete)[.:]?\s*/i, '') // it settled done; saying so twice is noise
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'done';
  }




  /**
   * What previous agents on this task wrote down — folded into the next turn's prompt.
   *
   * This is the payoff of the per-subject brain (docs/harness/01 §2.2): before it, an agent arriving on
   * a task after a rework bounce, a re-offer, or a fan-out got a truncated transcript and nothing the
   * last one LEARNED. Writing notes without reading them would have been pure ceremony, so the read
   * side lands in the same change as the write side.
   *
   * Bounded hard: notes are agent-authored and can be long, and this rides a prompt that already has a
   * budget. Newest first, capped, and truncated per note — a partial note is worth more than none.
   */
  function brainNotes(subject: SubjectRef, cap = 4, perNote = 1_200): string {
    try {
      const notes = brain.open(subject).notes();
      if (!notes.length) return '';
      const take = notes.slice(-cap).reverse();
      const what = subject.kind === 'task' ? 'this task' : 'this conversation';
      const body = take.map((n) => `--- ${n.name.replace(/\.md$/, '')} ---\n${n.body.slice(0, perNote).trim()}`).join('\n\n');
      return `\nWhat earlier work on ${what} already established (from its own working notes${notes.length > cap ? `, newest ${cap} of ${notes.length}` : ''}) — build on it, do NOT redo it:\n${body}\n`;
    } catch {
      return '';
    }
  }

  const brainNotesFor = (task: ExecTask, cap = 4, perNote = 1_200): string =>
    brainNotes({ kind: 'task', number: task.number }, cap, perNote);

  /**
   * What THIS subject's subagents have already reported — the `results` block (docs/harness/02).
   *
   * Distinct from notes on purpose: a note is what an agent chose to write down for whoever comes
   * next, a result is what a leg handed its parent. A re-woken orchestrator that fanned out last
   * turn needs the second one or it re-runs the fan-out it already paid for.
   */
  function brainResults(subject: SubjectRef, cap = 6, per = 900): string {
    try {
      const rows = brain.open(subject).messages().filter((m) => m.kind === 'result');
      if (!rows.length) return '';
      const take = rows.slice(-cap);
      const body = take.map((m) => {
        const d = m.body.data as { role?: string; label?: string; summary?: string } | undefined;
        return `--- ${d?.label ?? d?.role ?? 'subagent'} ---\n${(d?.summary ?? m.body.text ?? '').slice(0, per).trim()}`;
      }).join('\n\n');
      return `\nWhat subagents on this subject already reported${rows.length > cap ? ` (newest ${cap} of ${rows.length})` : ''} — use it, do NOT fan out again for the same ground:\n${body}\n`;
    } catch {
      return '';
    }
  }


  // The conversation workspace + deep work (host/workspace.ts).
  const { libraryDocs, subjectFor, ensureChatWorkspace, sweepLegacyChatDirs, workspaceListing, workspaceRead,
          readOnlyStudy, startDeepWork } = makeWorkspace({
    post, machineId, guards, db, workspace, alog, brain, claimed, narrate, openRun, recordLegResult: (...a: Parameters<typeof recordLegResult>) => recordLegResult(...a),
    // a THUNK: wake.ts is built below and takes services from here — the cycle has to break somewhere
    wake: (...a) => wake(...a),
  });

  // Memory in the loop (host/memory.ts) — lessons, recall, and post-approve mining.
  const { channelLessons, taskRecallNote, mineLessons } = makeMemory({ post, machineId, guards, db, apiUrl, workspace, ownerActorId });
  // Staffing and seats (host/staffing.ts) — add-before-hire, the seat brain, capacity failover.
  const { offerAddAgents, confirmAddAgent, seatFor, activePackRoles, executeHire,
          confirmCreateAgent, handleExhaustion, confirmFailover } = makeStaffing({
    post, machineId, guards, db, apiUrl, workspace, ownerActorId, agents, brain, claimed,
    execQueue,
    resumeFlow: (...args: Parameters<typeof resumeFlow>) => resumeFlow(...args),
  });

  // The fan-out (host/legs.ts): which seat a leg runs as, its briefing, the spawn, and how a
  // result is recorded against the parent.
  const { spawnLegFor, recordLegResult, brainBriefing, resolveSeat } = makeLegs({
    db, apiUrl, ownerActorId, brain, parentRunOf, openRun, narrate, seatFor,
    activePackRoles, seatLabel, legSummary, workspaceListing, workspaceOf, apiGet,
  });
  // Drafted content (host/content.ts) — the image, the in-place revision, the turn transcript.
  const { draftImageFor, generateDraftImage, generateShareImage, reviseContentDrafts, threadTranscript, orchSpawnFor, draftsForAnchor, buildScheduleCard } = makeContent({
    post, machineId, guards, db, apiUrl, workspace, ownerActorId, agents, alog, brainBriefing,
    designerOverride, ensureChatWorkspace, legSummary, narrate, openRun, recordLegResult, resolveSeat, seatLabel, taskOf,
    blockFor: (...args: Parameters<typeof blockFor>) => blockFor(...args),
  });
  // the calendar modal's direct line (host/directacts.ts): filled at boot, read by nm:draft-image
  directActs.draftImage = draftImageFor;

  // The orchestrator tool registry (host/orchtools.ts). It takes the host services it calls
  // rather than closing over them, which is the only way ~970 lines of tool definitions could
  // leave this closure without their bodies changing.
  const { buildOrchestratorTools } = makeOrchTools({
    post, machineId, guards, db, agents, apiGet, brain, buildScheduleCard, draftsForAnchor, ensureChatWorkspace,
    executeHire, generateDraftImage, generateShareImage, libraryDocs, startDeepWork, subjectFor, whiteboardClosures,
    workspaceListing, workspaceRead,
  });
  const { chatTurn, defaultResponder, threadModeFor } = makeChatTurn({
    post, machineId, guards, db, agents, apiGet, discoverSkills, draftsForAnchor, ensureChatWorkspace,
    generateDraftImage, generateShareImage, narrate, whiteboardClosures,
  });


  /**
   * Seat a subagent by role — SPECIALIST FIRST, then the role default.
   *
   * The founder ruling (2026-08-02): "rex can spin up subagents from any seated agent config based on
   * what that agent is specialized in, or its own subagents if no specialist config exists". So a
   * designer leg in a room where @iris sits should run on **iris's** seat — her model, her stored
   * specialty brief — rather than on a generic role default that happens to share her job title. That
   * brief is the whole reason a hired agent is better than a role name (docs/06 add-before-hire).
   *
   * What it does NOT do is borrow her identity. The leg still runs as the PARENT: a subagent has no
   * `agents` row and no board identity (docs/harness/04 I2), so `id` and `name` stay rex's and every
   * command the leg's work produces is rex's to answer for. Only the CONFIG is inherited, and `from`
   * records whose — which is what the run row's seat displays.
   *
   * When nothing in the room specialises, `from` is null and the caller says "role default" rather
   * than implying a specialist that does not exist.
   */

  /**
   * The turn a DESIGNER leg runs — the same one the seated designer runs.
   *
   * Rex owns the whole flow and hires a designer into its design phase, so that leg has to reach
   * the same machinery or "owned design" would quietly mean worse design: plain HTML in a room that
   * expected an editable Claude Design project. Three things carry the difference, and all three
   * live here rather than in the generic subagent prompt:
   *
   *  - `buildDesignPrompt` — the real brief (requirements, repo binding, prior round to edit)
   *  - `designSystemPrompt` — the designer's own stance, not "you are a subagent"
   *  - `claudeDesign: true` — the ONLY thing that puts `mcp__claude-design__*` in the toolset
   *
   * The provider follows the human's choice on the task when there is one (`designProviderFor`),
   * exactly as the seated flow does; a thread-scoped round with no task draws HTML, which is the
   * honest default rather than silently opening a project nobody asked for.
   */
  async function designerOverride(a: {
    ch: { id: string; slug: string; workspace_id: string };
    taskId: string | null;
    label: string;
    brief: string;
    dir: string;
    brainSubject: SubjectRef | null;
  }): Promise<PromptOverride> {
    const chosen = a.taskId ? await designProviderFor(a.taskId).catch(() => null) : null;
    const provider: DesignProvider = chosen?.provider ?? 'iris';
    const t = a.taskId
      ? await db.get<{ number: number; title: string; description: string | null; requirements: string | null }>(
          'select number, title, description, requirements from tasks where id = ?', [a.taskId],
        ).catch(() => null)
      : null;
    const block = await blockFor(a.ch.id).catch(() => null);
    // Rework continuity: put round N-1 back on disk so this round EDITS it rather than redrawing
    // from scratch. The seated flow has always done this, and without it an owned round 2 quietly
    // loses everything the human liked about round 1 — the worst kind of "revision".
    const prior = a.taskId
      ? await stagePriorDesignRound(db, a.taskId, a.dir).catch(() => ({ names: [] as string[], round: 0, staged: [] as Array<{ name: string; html: string }> }))
      : { names: [] as string[], round: 0, staged: [] as Array<{ name: string; html: string }> };
    const base = buildDesignPrompt(
      designBlocks(),
      {
        number: t?.number ?? 0,
        title: t?.title ?? a.label,
        description: t?.description ?? a.brief,
        requirements: t?.requirements ?? JSON.stringify([a.brief]),
      },
      {
        repoBacked: false, channelBlock: block, feedback: null,
        ...(prior.names.length ? { priorMockups: prior.names, priorRound: prior.round } : {}),
      },
    );
    const prompt = provider === 'claude-design'
      ? `${base}\n\n${claudeDesignPromptBlock(t?.number, t?.title)}`
      : base;
    return {
      // the leg still needs to know it is ONE direction among several and that its parent reports
      // for it — that framing rides on top of the design brief rather than replacing it
      prompt: `${prompt}\n\nYou are drawing ONE direction ("${a.label}") for ${a.ch.slug}'s orchestrator, alongside other designers working different directions. Draw only this one. You cannot create, offer or route board work — your parent owns this round and posts your mockups for the human's approval.${brainBriefing(a.brainSubject, a.dir)}`,
      system: designSystemPrompt(designBlocks(), 'the designer', false),
      claudeDesign: provider === 'claude-design',
    };
  }

  /** The task a conversation thread belongs to, when it is a task thread rather than a chat. */


  /**
   * The seat as the run row carries it: `role · model` plus whose config it inherited.
   *
   * Stored rather than derived, because it CANNOT be derived — a leg's `agent_id` is the parent's
   * (a subagent has no row of its own), so a roster lookup hands back the orchestrator's own role and
   * model for every leg. This string is the only place the seat survives.
   */


  /** The parent run for a task, so a leg hangs off the right node of the tree. */


  // ── Park (docs/harness/05 §3.8): a turn that ends without the work ending ────────────────────
  // The capability the worker prompt used to deny outright ("nothing you start survives it… no
  // scheduled check-in that calls you back"). A worker waiting on CI now ends its turn at zero token
  // cost and is called back when the checks land, instead of burning a 15-minute wall or giving up.
  const parkBook = new ParkBook();
  // Built HERE rather than beside the other services: parkBook is its wiring, and this is
  // where it exists. resumeFlow is declared far below, so it arrives as a thunk.
  const { parkFor, runDueParks, settleOrphanedRuns } = makePark(ctx, {
    db, parkBook, execQueue, agents, claimed,
    resumeFlow: (agent, t) => resumeFlow(agent, t),
  });
  /** taskId → the park a live turn asked for, read once its runQuery returns. */
  /** taskId → why a parked turn is being resumed; folded into the next turn's prompt, then cleared. */


  // A wake's run: opened alongside the stream so the two live surfaces tell ONE story (docs/26's
  // hard-won lesson), settled on every exit path. Titled from the human's own words, because
  // that is what the human will recognize when they scroll back.
  //
  // `triggerMessageId` makes this the WAKE LEASE (0114). Shared compute means every member
  // machine hosting this agent sees the same message; without a claim in front of the spend they
  // would each generate an answer and the server's reply index (0060) would discard all but one.
  // The caller MUST honour `.lost` and generate nothing.
  async function openWakeRun(agent: HostedAgent, where: { workspace: string; channelId: string; threadId?: string | null; taskId?: string | null }, prompt: string, triggerMessageId?: string | null): Promise<RunHandle> {
    const title = prompt.replace(/\s+/g, ' ').trim().slice(0, 120) || 'replying';
    if (triggerMessageId) {
      const stand = await wakeGate(agent, where, triggerMessageId);
      if (stand) return stand; // .lost — the caller generates nothing
    }
    return openRun(agent, where, { kind: 'wake', title, step: 'thinking…', triggerMessageId: triggerMessageId ?? null }).catch(() => NO_RUN);
  }


  async function designProviderFor(taskId: string): Promise<{ provider: DesignProvider; runKey: string } | null> {
    try {
      const res = await fetch(`${apiUrl}/v1/tasks/${taskId}`, {
        headers: await apiAuthHeaders(apiUrl, { kind: 'human', id: ownerActorId }),
      });
      if (!res.ok) return null;
      const detail = (await res.json()) as { events?: NMEvent[] };
      const events = detail.events ?? [];
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        const provider = designProviderFromEvents(event ? [event] : []);
        if (provider) return { provider, runKey: event?.id ?? `${taskId}:${provider}` };
      }
      return null;
    } catch {
      return null;
    }
  }

  // agents.status is what every client renders as the typing/working chip, so a
  // status write must never be silently dropped: one lost clear wedges "typing"
  // until the next relaunch (the machine keeps heartbeating, so agentLive can't
  // hide it). Every write flows through the pump — last-write-wins per agent,
  // retried with capped backoff until the server acks or a newer status
  // supersedes (presence.ts).
  const statusPump = createStatusPump({
    post: async (agentId, status) =>
      (await post('/v1/commands', { kind: 'human', id: ownerActorId }, { type: 'agent.set_status', agentId, status })).status,
    onRetry: (agentId, status, attempt, delayMs) =>
      console.error(`agent_status agent=${agents.get(agentId)?.name ?? agentId.slice(0, 8)} status=${status} retry=${attempt} in=${Math.round(delayMs / 1000)}s`),
  });

  // Beats (docs/17): the daemon-driven flows surface their phase milestones as an
  // ordered, human-legible set that whoever is watching sees tick off live. Best-effort
  // by construction — a beats write must never break or slow a real flow, so every
  // failure is logged and swallowed. The server gates writes to the agent whose role
  // owns the task's current phase (descriptive; beats never gate an FSM transition).

  // The ENFORCEMENT SEAM — the skills an agent may reach for in a channel: active
  // AND enabled AND (no pack OR its pack is enabled). Shared by the worker (before
  // it executes) and the orchestrator (so it can steer toward a fitting skill).
  // Disabled = structurally absent from what any agent ever sees. Replica = 0/1.
  async function discoverSkills(channelId: string, workspaceId: string): Promise<SkillRef[]> {
    return db.getAll<SkillRef>(
      `select s.name, s.description, s.body, p.name as pack_name from skills s
       left join skill_packs p on p.id = s.pack_id
       where s.status = 'active' and s.enabled = 1 and (s.pack_id is null or p.enabled = 1)
         and (s.channel_id = ? or (s.channel_id is null and s.workspace_id = ?))
       order by s.channel_id is null limit 60`,
      [channelId, workspaceId],
    );
  }




  db.watch(
    // retired agents are not hosted: they never enter the in-memory map, so the offer
    // watch, review dispatch, chat wake, and the online mark all skip them.
    //
    // SHARED COMPUTE (0114): scoped by WORKSPACE, not by machine. `a.machine_id = ?` pinned every
    // agent to the one laptop that registered it, so a teammate saw rex in the roster while every
    // request they made was served by (and billed to) the owner's machine — and went unanswered
    // when it slept. Agents are workspace-level resources; the machines they run on are their
    // members'. Which host actually serves a given piece of work is decided per-item by the
    // origin-affinity policy (shared/src/compute.ts) and settled atomically by the server —
    // `task.claim` for board work, the run lease for wakes. `machine_id` survives as provenance.
    `select a.id, a.name, a.model, a.role, a.runtime, a.brief, a.model_source, ac.channel_id from agents a
     join agent_channels ac on ac.agent_id = a.id
     where a.workspace_id = ? and a.retired_at is null and coalesce(a.kind, 'local') != 'remote'`,
    [workspace],
    {
      onResult: (r) => {
        agents.clear();
        for (const row of (r.rows?._array ?? []) as Array<{ id: string; name: string; model: string; role: string; runtime: string | null; brief: string | null; model_source: string | null; channel_id: string }>) {
          const existing = agents.get(row.id) ?? { id: row.id, name: row.name, model: row.model, role: row.role, runtime: row.runtime ?? 'claude-code', brief: row.brief, modelSource: row.model_source, channels: new Set<string>() };
          existing.channels.add(row.channel_id);
          agents.set(row.id, existing);
        }
        console.log(`agent_host agents=${agents.size}${[...agents.values()].some((a) => a.runtime !== 'claude-code') ? ' runtimes=' + [...new Set([...agents.values()].map((a) => a.runtime))].join(',') : ''}`);
        if (agents.size > 0) zeroAgentWarned = false; // recovered → re-arm the warning
        else if (!zeroAgentWarned) {
          // Could be boot-lag (agent_channels not replicated yet) — re-check after a grace period. If
          // STILL zero while agents exist in this WORKSPACE, their channel registrations were orphaned
          // (a channel/project delete or migration cascade emptied agent_channels) and the whole agent
          // loop is OFFLINE. Surface it loudly instead of silently doing nothing.
          setTimeout(() => {
            if (agents.size > 0 || zeroAgentWarned) return;
            void db.getAll<{ n: number }>(`select count(*) as n from agents where workspace_id = ? and retired_at is null`, [workspace]).then(([row]) => {
              if ((row?.n ?? 0) > 0 && agents.size === 0 && !zeroAgentWarned) {
                zeroAgentWarned = true;
                console.error(`⚠️ agent_host: ${row!.n} agent(s) in this workspace but NONE are bound to a channel — the agent loop is OFFLINE (no agent will respond, monitor, or summarize). agent_channels was orphaned by channel/project churn. Recover with the "Re-sync agents" action (workspace.sync_agents).`);
              }
            }).catch(() => {});
          }, 10_000);
        }
        for (const a of agents.values()) {
          if (!markedOnline.has(a.id)) {
            markedOnline.add(a.id);
            // through the pump: the boot reset is the crash-recovery write (a busy
            // status a dead run left behind) — the one write that must not drop
            statusPump.set(a.id, 'online');
            // …and the same crash leaves RUNS saying `running`, which the UI spins off
            // independently of status. This process just started, so nothing it owns can
            // still be running; settle them as stopped. Once per agent per boot (the
            // markedOnline latch), so a later roster reload never touches a live run.
            void settleOrphanedRuns(a);
          }
        }
        // Roster just (re)loaded — pick up any board work the state watches saw before agents
        // existed, and answer chat that arrived while no host was running (dead letters).
        if (agents.size > 0) { void reconcileBoard(); void sweepDeadLetters(); }
      },
      onError: () => {},
    },
  );

  // offered tasks: claim -> confirm requirements -> announce in the task thread.
  // Orchestrator-created tasks are claimable ONLY requirements-confirmed (the
  // offer carries the thread-resolved checklist): a premature offer cannot
  // start execution. Human-created tasks keep the self-confirm path — the
  // human specified the work when they wrote it.
  // A plan_review offer is claimable only once the HUMAN has stamped the plan
  // (plan_approved_at — task.approve_plan is HUMAN_ONLY, docs/29 §4d): the server
  // refuses the claim anyway, and attempting early burned the one-shot `claimed`
  // guard, so approval never released the task (the smoke-gate stall). The stamp
  // is a tasks-column change, so approval itself retriggers this watch.
  db.watch(
    // `creator_kind`/`creator_id` ride along for shared compute (0114): a HUMAN-created task is
    // attributed to that member, so their own machine gets first refusal on it. An
    // orchestrator-filed task has no such origin — it is unattributed and any capable machine may
    // take it at once, which is the right default for work nobody typed directly.
    `select id, number, title, channel_id, kind, offered_agent_id, repo_id, base_ref, branch, requirements, requirements_confirmed,
            creator_kind, creator_id
       from tasks
     where workspace_id = ? and state in ('todo', 'plan_review') and offered_agent_id is not null
       and (state != 'plan_review' or plan_approved_at is not null)
       and (state != 'plan_review' or instr(coalesce(work_plan, ''), '"design"') = 0)
       and (requirements_confirmed = 1 or creator_kind != 'agent' or not exists (
         select 1 from agents a where a.id = tasks.creator_id and a.role = 'orchestrator'))`,
    [workspace],
    {
      onResult: (r) => {
        for (const t of (r.rows?._array ?? []) as OfferedTask[]) {
          const agent = agents.get(t.offered_agent_id);
          if (!agent || claimed.has(t.id)) continue;
          claimed.add(t.id);
          // An offer to the ORCHESTRATOR means it is taking the work itself, not delegating —
          // so it runs the owning flow, never the worker's. `claimFlow` would post "Claimed #N"
          // and drop straight into the coding loop, which is the one thing an owner must not do:
          // its job is to decide the phase and fan out, not to build.
          const owning = agent.role === 'orchestrator';
          // each branch is its own thunk rather than a ternary inside one: both flows spawn runtime
          // CLIs, so both must be visibly admitted by the queue (the E4 adoption check greps for
          // exactly this shape, and a ternary hides one of them from it)
          const flow = owning ? () => ownFlow(agent, t) : () => claimFlow(agent, t);
          execQueue.run(
            { key: t.id, kind: owning ? 'own' : 'work', cause: 'board', agentId: agent.id, subject: { kind: 'task', number: t.number } },
            flow,
          );
        }
      },
      onError: () => {},
    },
  );

  // Plan-first design routing (2026-08-17): extracted to host/planroute.ts (the ratchet) —
  // an approved design-first plan fires request_design at the channel designer, LLM-free.
  startPlanRouteWatch({ db, post, workspace });

  // remote (external A2A) agents: a task offered to one is delegated over A2A
  // (they have no local machine, so the local-agent watch above skips them). Any
  // host may pick it up; the atomic claim de-dupes. Public-channel scoping + the
  // FSM apply unchanged since a remote agent is a normal agents row.
  db.watch(
    `select t.id, t.number, t.title, t.description, t.channel_id, t.offered_agent_id, t.requirements, t.requirements_confirmed,
            a.id as ra_id, a.name as ra_name, a.role as ra_role, a.endpoint_url as ra_endpoint
     from tasks t join agents a on a.id = t.offered_agent_id
     where t.state = 'todo' and a.kind = 'remote' and a.endpoint_url != ''`,
    [],
    {
      onResult: (r) => {
        for (const row of (r.rows?._array ?? []) as Array<OfferedTask & { description?: string | null; ra_id: string; ra_name: string; ra_role: string; ra_endpoint: string }>) {
          if (claimed.has(row.id)) continue;
          claimed.add(row.id);
          execQueue.run({ key: row.id, kind: 'work', cause: 'board', agentId: row.ra_id }, () => remoteDelegate({ id: row.ra_id, name: row.ra_name, role: row.ra_role, endpoint_url: row.ra_endpoint }, row));
        }
      },
      onError: () => {},
    },
  );

  // in-flight guard lifecycle: `claimed` holds a task from claim/resume until
  // we OBSERVE it leave in_progress (submit landing). Releasing on observation
  // — not on submit success — means a request_changes bounce re-arms resume
  // without a double-execution race in the sync gap.
  db.watch(
    `select id from tasks where state in ('in_review', 'done', 'accepted', 'closed', 'blocked')`,
    [],
    {
      onResult: (r) => {
        for (const row of (r.rows?._array ?? []) as Array<{ id: string }>) claimed.delete(row.id);
      },
      onError: () => {},
    },
  );

  // review guard lifecycle: clear `reviewed` once a task LEAVES in_review (a
  // request_changes bounce → in_progress, or approve → done), so a RE-submitted
  // task gets a FRESH review instead of being skipped as already-reviewed. Without
  // this, the reviewer reviewed once and never again on re-submit (dogfooding bug).
  db.watch(
    `select id from tasks where state in ('in_progress', 'done', 'accepted', 'closed', 'blocked')`,
    [],
    {
      onResult: (r) => {
        for (const row of (r.rows?._array ?? []) as Array<{ id: string }>) {
          reviewed.delete(row.id);
          execQueue.rearm(`review:${row.id}`); // a re-submission earns a FRESH review
        }
      },
      onError: () => {},
    },
  );

  // Built before the watch below calls its debounce. It only CONSTRUCTS — nothing arms here.
  const { runBerthSweep, scheduleBerthSweep } = makeBerthSweep({ db, brain, withRepoLock, killTaskPtys });
  db.watch(
    `select number, repo_id, branch from tasks where state in ('accepted', 'closed')`,
    [],
    {
      onResult: async (r) => {
        for (const row of (r.rows?._array ?? []) as Array<{ number: number; repo_id: string | null; branch: string | null }>) {
          if (reclaimed.has(row.number)) continue;
          reclaimed.add(row.number);
          killTaskPtys?.(row.number); // close review terminals before the dir vanishes under them
          const remove = () => removeTaskWorkspace({
            wtDir: cachePath('worktrees', `nm-${row.number}`),
            deliverableDir: deliverablePath(row.number),
            cloneDir: row.repo_id ? cachePath('repos', row.repo_id) : null,
            branch: row.branch ?? `nm/${row.number}`, // pre-branch-column tasks used the bare fallback
          });
          // clone-dir git ops share the creation path's per-repo lock (git locks aren't reentrant)
          const notes = await (row.repo_id ? withRepoLock(row.repo_id, remove) : remove()).catch(() => [] as string[]);
          if (notes.length) console.log(`workspace_reclaim nm-${row.number}: ${notes.join(', ')}`);
          // the subject brain (turn ledgers, notes) dies with the workspace — this call was
          // documented from day one and never wired; 51 stale subject dirs proved it
          try { brain.reclaim({ kind: 'task', number: row.number }); } catch { /* best-effort */ }
          scheduleBerthSweep(); // a settle changes the berth picture — resnapshot soon (debounced)
        }
      },
      onError: () => {},
    },
  );

  // ── the berth sweep: ONE owner for cache/ (worktree-berths round, docs/40) ─────────────────
  // The executor lives in berthsweep.ts. The TIMERS stay here, in the boot sequence, because
  // when a timer arms is a boot fact — a sweep buried in a maker is one nobody can find.
  setTimeout(() => { void runBerthSweep().catch(() => {}); }, 120_000); // boot pass, after the stall sweep settles
  setInterval(() => { void runBerthSweep().catch(() => {}); }, 6 * 3600_000);
  berthSweepLive = runBerthSweep;

  db.watch(
    `select t.id, t.number, t.channel_id, t.assignee_id, t.pr_number, t.pr_url, r.org_name, r.name as repo_name, r.clone_url, r.local_path
     from tasks t join repos r on r.id = t.repo_id
     where t.state = 'accepted' and t.pr_number is not null`,
    [],
    {
      onResult: async (r) => {
        for (const row of (r.rows?._array ?? []) as Array<{ id: string; number: number; channel_id: string; assignee_id: string | null; pr_number: number; pr_url: string | null; org_name: string; repo_name: string; clone_url: string | null; local_path: string | null }>) {
          if (merged.has(row.id) || !(await ghCapable())) continue; // gh-less BYOK machine: skip without recording "handled" — a capable daemon merges
          merged.add(row.id);
          // Resolve the slug the SAME way the PR was opened (real remote, not the
          // placeholder org_name/name) so `gh pr merge` targets the actual GitHub repo
          // — a local-checkout repo's `local/<name>` is unresolvable (the GraphQL error).
          const slug = await repoSlugFor({ clone_url: row.clone_url, local_path: row.local_path, org_name: row.org_name, name: row.repo_name });
          const chan = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [row.channel_id]).catch(() => null);
          const actor = { kind: 'agent', id: row.assignee_id ?? '', role: 'developer' };
          if (!slug) {
            console.error(`pr_merge task=${row.number} pr=${row.pr_number} FAILED: could not resolve a GitHub repo slug (clone_url empty, no origin remote at ${row.local_path ?? 'no local path'})`);
            // the guard is durable now, so a FAILED attempt must release it or a transient failure
            // (a missing remote that is later added, a network blip) would never be retried again —
            // durability records "successfully handled", never "attempted"
            merged.delete(row.id);
            if (chan && row.assignee_id) await post('/v1/messages', actor, { workspace: chan.workspace_id, channel: chan.id, taskId: row.id, body: `⚠️ Accepted #${row.number}, but I couldn't merge [PR #${row.pr_number}](${row.pr_url}): this repo has no GitHub remote to resolve (\`git remote add origin <github-url>\` on its checkout, then merge it yourself).` }).catch(() => {});
            continue;
          }
          // already merged (an earlier process, another machine, or a human): settled —
          // no re-merge, and above all no re-announcement (the duplicate 🎉 bug)
          if ((await ghPrState(slug, row.pr_number)) === 'merged') {
            console.log(`pr_merge task=${row.number} pr=${row.pr_number} repo=${slug} already merged — quiet`);
            continue;
          }
          const res = await ghPrMerge(slug, row.pr_number);
          if (res.ok) {
            console.log(`pr_merge task=${row.number} pr=${row.pr_number} repo=${slug} ok`);
            if (chan && row.assignee_id) await post('/v1/messages', actor, { workspace: chan.workspace_id, channel: chan.id, taskId: row.id, body: `🎉 Accepted — squash-merged [PR #${row.pr_number}](${row.pr_url}) into its base and deleted the branch.` }).catch(() => {});
          } else {
            console.error(`pr_merge task=${row.number} pr=${row.pr_number} repo=${slug} FAILED: ${res.error}`);
            merged.delete(row.id); // release the durable guard so a transient failure can retry (see above)
            if (chan && row.assignee_id) await post('/v1/messages', actor, { workspace: chan.workspace_id, channel: chan.id, taskId: row.id, body: `⚠️ Accepted #${row.number}, but merging [PR #${row.pr_number}](${row.pr_url}) failed: ${res.error}. Merge it yourself, or check \`gh auth status\`.` }).catch(() => {});
          }
        }
      },
      onError: () => {},
    },
  );

  // stop / pause: a human or the orchestrator moved a task an agent on THIS host is actively running
  // OUT of in_progress — `closed` (cancelled) or `blocked` (paused). Abort the in-flight run IMMEDIATELY
  // so the model/CLI halts at once, instead of working blind to completion and then failing its submit
  // (blocked → in_review is an illegal transition — the symptom that surfaced this). stoppedTasks tells
  // executeFlow to bail cleanly without pushing half-work, and is consumed on bail — so a later
  // unblock → in_progress resume re-runs the task fresh.
  db.watch(
    `select id, number, channel_id, state from tasks where state in ('closed', 'blocked')`,
    [],
    {
      onResult: async (r) => {
        for (const row of (r.rows?._array ?? []) as Array<{ id: string; number: number; channel_id: string; state: string }>) {
          const ac = executing.get(row.id);
          if (!ac || ac.signal.aborted) continue; // not running here, or already halting
          const blocked = row.state === 'blocked';
          stoppedTasks.add(row.id);
          ac.abort();
          executing.delete(row.id);
          emitProcChange();
          console.log(`agent_stop task=${row.number} — aborted the in-flight run on ${blocked ? 'block' : 'cancel'}`);
          const chan = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [row.channel_id]).catch(() => null);
          if (chan) await post('/v1/messages', { kind: 'human', id: ownerActorId }, { workspace: chan.workspace_id, channel: chan.id, taskId: row.id, body: blocked
            ? `⏸ Blocked — halted the agent working on #${row.number}; it stopped where it was and will pick the work back up when you unblock it.`
            : `🛑 Stopped — halted the agent working on #${row.number}; implementation did not continue.` }).catch(() => {});
        }
      },
      onError: () => {},
    },
  );

  // resume: in_progress tasks assigned to my agents that this process isn't
  // executing — host crashed/restarted mid-task, or a human bounced it back
  // with request_changes. Pick the work back up instead of stranding it.
  db.watch(
    `select id, number, title, channel_id, kind, assignee_id, repo_id, base_ref, branch, requirements, requirements_confirmed
     from tasks where state = 'in_progress' and assignee_kind = 'agent'`,
    [],
    {
      onResult: (r) => {
        for (const t of (r.rows?._array ?? []) as Array<ExecTask & { assignee_id: string; requirements_confirmed: number }>) {
          const agent = agents.get(t.assignee_id);
          if (!agent || claimed.has(t.id)) continue;
          claimed.add(t.id);
          // THE REWORK LOOP (docs/29 §4d). A task bouncing back to in_progress on an OWNED task is
          // the reviewer's changes landing on the owner — and the owner judges them: act on them by
          // spawning a fixer, push back with reasoning, or raise an `nmq` card when the call is
          // genuinely the human's. `resumeFlow` would instead drop rex into the worker's coding
          // resume, which is the same category error as claimFlow on the way in.
          //
          // Re-entry is already sound: `claimed` is released only when a task reaches in_review /
          // done / blocked, so an owning turn that ends with the task still in_progress (waiting on
          // a human) does not immediately re-fire — a human replying in the thread wakes rex through
          // the normal message path instead.
          const owning = agent.role === 'orchestrator';
          const flow = owning ? () => ownFlow(agent, t) : () => resumeFlow(agent, t);
          execQueue.run(
            { key: t.id, kind: owning ? 'own' : 'work', cause: 'board', agentId: agent.id, subject: { kind: 'task', number: t.number } },
            flow,
          );
        }
      },
      onError: () => {},
    },
  );

  // architect: a task parked in `planning` (the orchestrator routed it here)
  // gets an implementation plan drafted via the mixture-of-agents, then
  // proposed (planning -> plan_review). Board-driven, like a dev waking on an
  // offer — no orchestrator↔architect chat.
  // repo_id/base_ref ride along so the architect can STUDY the code it is planning changes to
  // (the same read-only clone the designer studies) instead of planning from a paragraph.


  db.watch(
    `select id, number, title, description, channel_id, requirements, repo_id, base_ref, assignee_id from tasks where state = 'planning'`,
    [],
    {
      onResult: (r) => {
        for (const t of (r.rows?._array ?? []) as PlanTask[]) {
          dispatchPlanning(t);
        }
      },
      onError: () => {},
    },
  );

  db.watch(
    `select id, number, title, description, channel_id, requirements, plan_approved_at from tasks where state = 'plan_review' and offered_agent_id is null`,
    [],
    {
      onResult: (r) => {
        for (const t of (r.rows?._array ?? []) as Array<PlanTask & { plan_approved_at: string | null }>) {
          const orch = [...agents.values()].find((a) => a.role === 'orchestrator' && a.channels.has(t.channel_id));
          if (!orch) {
            // surface the most common "orchestrator never acknowledged the plan" cause:
            // no orchestrator registered to THIS machine in the task's channel
            if (!noOrchLogged.has(t.id)) { noOrchLogged.add(t.id); console.warn(`plan_review #${t.number}: no orchestrator on this machine for its channel — the plan won't be reviewed until one is registered`); }
            continue;
          }
          // the PARKED path's second act: the human stamped an UNOFFERED plan (the card's
          // task.approve_plan — HUMAN_ONLY, docs/29 §4d), so the judgment is settled and the
          // orchestrator's remaining job is the offer. Without this branch the parked flow
          // ended at the stamp: `decided` had already consumed the one-shot at card time.
          if (t.plan_approved_at) {
            if (approvedOffered.has(t.id)) continue;
            approvedOffered.add(t.id);
            void (async () => {
              const ch = await db.get<{ id: string; slug: string; workspace_id: string }>('select id, slug, workspace_id from channels where id = ?', [t.channel_id]).catch(() => null);
              if (ch) await offerPlanToWorker(orch, t, ch).catch((err) => { approvedOffered.delete(t.id); console.error(`plan_offer_after_approve #${t.number} failed:`, err); });
              else approvedOffered.delete(t.id);
            })();
            continue;
          }
          if (decided.has(t.id)) continue;
          decided.add(t.id);
          void orchPlanDecision(orch, t);
        }
      },
      onError: () => {},
    },
  );

  db.watch(
    `select id, number, title, description, channel_id, requirements, repo_id, base_ref, updated_at, assignee_id from tasks where state = 'designing'`,
    [],
    {
      onResult: (r) => {
        for (const t of (r.rows?._array ?? []) as DesignTask[]) {
          // an owned design round is the owner's phase — it hires the designer (docs/29 §4d)
          const owner = t.assignee_id ? agents.get(t.assignee_id) : undefined;
          if (owner?.role === 'orchestrator') {
            if (claimed.has(t.id)) continue;
            claimed.add(t.id);
            execQueue.run({ key: t.id, kind: 'own', cause: 'board', agentId: owner.id, subject: { kind: 'task', number: t.number } }, () => ownFlow(owner, t));
            continue;
          }
          const des = [...agents.values()].find((a) => a.role === 'designer' && a.channels.has(t.channel_id));
          if (!des) continue;
          void dispatchDesigner(des, t);
        }
      },
      onError: () => {},
    },
  );

  db.watch(
    `select id, number, title, description, channel_id, requirements from tasks where state = 'design_review'`,
    [],
    {
      onResult: (r) => {
        for (const t of (r.rows?._array ?? []) as PlanTask[]) {
          if (designNotified.has(t.id)) continue;
          const orch = [...agents.values()].find((a) => a.role === 'orchestrator' && a.channels.has(t.channel_id));
          if (!orch) continue;
          designNotified.add(t.id);
          void orchDesignNotify(orch, t);
        }
      },
      onError: () => {},
    },
  );


  // in-flight guard reconcile: free a task from the architect/designer/decision
  // guards once it leaves their state, so a revise (plan_review -> planning,
  // design_review -> designing) re-drafts and a re-proposal gets a fresh pass.
  db.watch(
    `select id, state from tasks where state in ('todo', 'designing', 'design_review', 'planning', 'plan_review', 'in_progress', 'in_review', 'done', 'accepted', 'closed', 'blocked')`,
    [],
    {
      onResult: (r) => {
        for (const row of (r.rows?._array ?? []) as Array<{ id: string; state: string }>) {
          if (row.state !== 'planning') planned.delete(row.id);
          if (row.state !== 'planning') planningStaffingNotified.delete(row.id);
          if (row.state !== 'plan_review') decided.delete(row.id);
          if (row.state !== 'designing') designed.delete(row.id);
          if (row.state !== 'designing') designAsked.delete(row.id);
          if (row.state !== 'design_review') designNotified.delete(row.id);
        }
      },
      onError: () => {},
    },
  );

  // curator: a user-added skill pack (status='importing', origin='imported') is
  // cloned, scanned for **/SKILL.md, parsed (the shared deterministic parser —
  // no model, no prompt-injection surface, ~ms vs a fleet of SDK cold-starts),
  // and committed. Progress + terminal state ride the SYNCED pack row, so the
  // tracker is team-visible + offline-correct (agent logs are local-only).
  db.watch(
    `select id, name, channel_id, source_url, source_ref from skill_packs where status = 'importing' and origin = 'imported'`,
    [],
    {
      onResult: (r) => {
        for (const p of (r.rows?._array ?? []) as ImportPack[]) {
          if (importing.has(p.id)) continue;
          const cur = [...agents.values()].find((a) => a.role === 'curator' && a.channels.has(p.channel_id));
          if (!cur) continue; // no curator on this machine for the channel — another host owns it
          importing.add(p.id);
          execQueue.run({ key: `import:${p.id}`, kind: 'sweep', cause: 'board', agentId: cur.id }, () => curatorImport(cur, p));
        }
      },
      onError: () => {},
    },
  );














  db.watch(
    `select id, channel_id, thread_id, author_kind, author_id, body from messages
     where task_id is null and created_at > ? order by created_at desc limit 30`,
    [startedAt],
    {
      onResult: (r) => {
        for (const m of (r.rows?._array ?? []) as Array<{ id: string; channel_id: string; thread_id: string | null; author_kind: string; author_id: string; body: string }>) {
          handleFeedMessage(m);
        }
      },
      onError: () => {},
    },
  );

  // thread wakes: a human replying inside a task thread is addressing the
  // task's owner — the channel orchestrator while it's unclaimed intake
  // (todo), the assignee while the work runs (in_progress/blocked). An
  // explicit @mention overrides; in review and beyond it's mention-only
  // (request_changes is the enforced bounce path, not thread chatter).
  // Agent-authored thread messages never wake anyone — no agent↔agent loops.
  db.watch(
    `select id, task_id, channel_id, author_kind, author_id, body from messages
     where task_id is not null and author_kind = 'human' and created_at > ? order by created_at desc limit 30`,
    [startedAt],
    {
      onResult: (r) => {
        for (const m of (r.rows?._array ?? []) as Array<{ id: string; task_id: string; channel_id: string; author_kind: string; author_id: string; body: string }>) {
          if (processed.has(m.id)) continue;
          processed.add(m.id);
          void routeThreadMessage(m);
        }
      },
      onError: () => {},
    },
  );


  // Boot dead-letter sweep: the two message watches above only see created_at > startedAt,
  // so a message sent while NO host was running (the phone-while-away case) predates every
  // later boot and would otherwise go unanswered FOREVER. On roster load, pull a bounded
  // window of human messages, keep the ones no agent has spoken after (chatsweep.ts), and
  // re-run them through the SAME decision paths as the live watches. Cross-host/boot dupe
  // safety is the server's exactly-once index (one reply per agent + trigger, 0060) — a
  // second host's sweep 409s and stands down; this is scheduling, not enforcement.
  const SWEEP_LOOKBACK_MS = 24 * 60 * 60 * 1000;











  const wakeStarted = (chId: string): void => { wakesInFlight.set(chId, (wakesInFlight.get(chId) ?? 0) + 1); };
  const wakeEnded = (chId: string): void => {
    const n = (wakesInFlight.get(chId) ?? 1) - 1;
    if (n > 0) wakesInFlight.set(chId, n); else wakesInFlight.delete(chId);
  };

  const sweepPeriod = (d: Date): 'morning' | 'midday' | 'evening' | null => {
    const h = d.getHours();
    if (h >= 8 && h < 11) return 'morning';
    if (h >= 12 && h < 15) return 'midday';
    if (h >= 17 && h < 20) return 'evening';
    return null;
  };
  // restart-safe: the in-memory set resets on relaunch, so also check the channel for today's heading.
  const summaryPostedToday = async (chId: string, period: string, day: string): Promise<boolean> =>
    (await db.getAll<{ id: string }>(`select id from messages where channel_id = ? and author_kind = 'agent' and body like ? and created_at >= ? limit 1`, [chId, `%${SUMMARY_MARKER[period]}%`, `${day}T00:00:00`])).length > 0;
  // skip idle channels — only monitor one with HUMAN or open-board activity since
  // the channel's monitor watermark. Agent messages (including the orchestrator's own
  // posts) never re-arm the monitor: counting them let one leaked sweep note wake the
  // next tick off itself, forever. Agent work that matters rides task state, which the
  // open-task clause below still catches. Whether the monitor may RUN on these signals
  // is gateMonitor's call (sweepgate.ts) — a live or just-landed wake defers it.
  const channelMonitorSignals = async (chId: string, since: string, nowMs: number): Promise<MonitorSignals> => {
    const [m] = await db.getAll<{ n: number; newest: string | null }>(`select count(*) as n, max(created_at) as newest from messages where channel_id = ? and author_kind = 'human' and created_at > ?`, [chId, since]);
    // backlog churn never re-arms the monitor: a parked idea needs no orchestrator
    // action by construction, and waking on it would re-create the #74 spam class
    const [t] = await db.getAll<{ n: number }>(`select count(*) as n from tasks where channel_id = ? and state not in ('accepted','closed','backlog') and updated_at > ?`, [chId, since]);
    const newestMs = m?.newest ? Date.parse(m.newest) : NaN;
    return {
      humanMsgsSince: m?.n ?? 0,
      tasksUpdatedSince: t?.n ?? 0,
      newestHumanMsgAgeMs: Number.isFinite(newestMs) ? Math.max(0, nowMs - newestMs) : null,
      wakesInFlight: wakesInFlight.get(chId) ?? 0,
    };
  };




  // fire-and-forget for the daemon's lifetime (matches the existing sleepTimer pattern above).
  setInterval(() => { void runOrchestratorSweeps('full').catch(() => {}); }, ORCH_FULL_SWEEP_MS);
  // the progress check: deterministic, cheap, and frequent enough that a wedged run is caught
  // in minutes rather than being announced by the agent itself every three minutes
  setInterval(() => { void runOrchestratorSweeps('watchdog').catch(() => {}); }, ORCH_WATCHDOG_MS);
  setTimeout(() => { void runOrchestratorSweeps('full').catch(() => {}); }, 90_000); // first sweep shortly after boot
  // once per boot, after the replica has had a moment to carry the threads this needs to match on
  setTimeout(() => { void sweepLegacyChatDirs(); }, 45_000);

  function setStatus(agent: HostedAgent, status: 'online' | 'thinking' | 'working') {
    statusPump.set(agent.id, status);
  }

  // The marketing bootstrap (host/marketing.ts) and the echo harness (host/echo.ts).
  const { runMarketingBootstrap } = makeMarketing({
    post, machineId, guards, db, apiUrl, workspace, ownerActorId, arun, runDueParks, setStatus,
    wake: (...a) => wake(...a), // same cycle as makeWorkspace above
    runDueSchedules: () => runDueSchedules(),
  });

  // The minute-tick for armed routines (schedules.ts). A THUNK for runMarketingBootstrap because
  // the two are a cycle — a bootstrap schedule fires the flow, and the flow re-ticks the schedules.
  const { runDueSchedules } = makeSchedules({
    db, apiUrl, ownerActorId, post, agents, bootstrapAuthCardPosted, arun,
    runMarketingBootstrap: (...a) => runMarketingBootstrap(...a),
  });

  // the sleeper rung (host/sleepers.ts): the claim and wake flows ask the fleet to wake a lent
  // cloud machine when nobody awake can serve — one memo for the whole host
  const { requestSleeperWake } = makeSleeperWake({ peerMachines, post });
  // The role flows (host/flows.ts) — architect → designer → developer → reviewer → shipper,
  // plus claim/own/resume and the block machinery. They take the host services they call.
  const {
    architectFlow, blockFor, claimFlow, curatorImport,
    designerFlow, offerPlanToWorker, orchDesignNotify,
    orchPlanDecision, ownFlow,
    remoteDelegate, resumeFlow,
  } = makeFlows({
    post, machineId, guards, db, apiUrl, workspace, ownerActorId, agents, brain, parkBook, execQueue, claimed,
    NO_RUN, openRun, narrate, declareBeats, advanceBeat, beatCursor, parkFor,
    alog, arun, brainNotes, brainNotesFor, brainResults, channelLessons, claimVerdict, discoverSkills,
    handleExhaustion, legSummary, mineLessons, originOf, priorMachineFor, readOnlyStudy, requestSleeperWake,
    orchestratorTurn: (...args: Parameters<typeof orchestratorTurn>) => orchestratorTurn(...args),
    seatFor, setStatus, sinceFirstSeen, spawnLegFor, taskRecallNote, whiteboardClosures, replyDraft, searchXFor,
  });

  // Triage and dispatch (host/dispatch.ts) — routing to the architect or the designer, the
  // staffing gap, and the board reconcile that re-derives what should be running.
  const { dispatchPlanning, dispatchDesigner, reconcileBoard } = makeDispatch({
    post, machineId, guards, db, workspace, agents, claimed, execQueue, setStatus,
    architectFlow, designerFlow, orchPlanDecision, orchDesignNotify, ownFlow, resumeFlow,
    designProviderFor,
  });

  const { echoOrchestrate, echoThreadOrchestrate, echoPlanReview } = makeEcho({
    post, machineId, guards, db, workspace, agents, hireProposed, offerPlanToWorker,
  });

  // The wake path (wake.ts): a message arrives and some agent answers it. Forty-three
  // dependencies — that number is the finding, not the split's fault: this path touches
  // nearly everything the host does, and until now that was true but invisible.
  // Shared by both halves; a const, not two literals, so routing can take a subset.
  const wakeCtx = {
    db, LEASE_LOST, NO_RUN, SWEEP_LOOKBACK_MS, agents, alog, apiUrl, arun, blockFor, brainNotes, brainResults,
    chatTurn, claimVerdict, confirmAddAgent, confirmCreateAgent, confirmFailover, defaultResponder, discoverSkills,
    echoOrchestrate, echoPlanReview, echoThreadOrchestrate, execQueue, generateDraftImage, handleExhaustion,
    offerAddAgents, openWakeRun, ownerActorId, peerMachines, post, priorMachineFor, processed, queueWake,
    rearmWake, reviseContentDrafts, runDueSchedules, runMarketingBootstrap, saidNoCompute, seatFor, setStatus,
    threadModeFor, threadTranscript, wakeEnded, wakeStarted,
    // a THUNK: orchestratorTurn is built below, from services this maker also needs
    orchestratorTurn: (...a: Parameters<typeof orchestratorTurn>) => orchestratorTurn(...a),
  };
  const { wake, wakeThread } = makeWake(wakeCtx);

  // Who answers (host/wakerouting.ts). The edge points one way — routing calls wakeThread and
  // the runner never calls back — which is what let them split.
  const { wakeGate, handleFeedMessage, routeThreadMessage, sweepDeadLetters } = makeWakeRouting({ ...wakeCtx, wakeThread });


  // POWERS_NOTE moved into the contract as `sweep.note` (2026-08-18) — its "you don't
  // unblock" clause contradicted the FSM, and a literal nobody reviews is how that survives.
  // ── Orchestrator sweeps ──────────────────────────────────────────────────────────────────────
  // The orchestrator OWNS its channels, so on a timer it (1) auto-monitors for anything left
  // unhandled and acts, and (2) posts morning/midday/evening status summaries. Live-only (echo gates
  // never run these). It uses its normal tools + posts a channel message, or stands down (NO_REPLY).
  const SUMMARY_MARKER: Record<string, string> = { morning: '☀️ Morning status', midday: '🕑 Midday status', evening: '🌙 Evening status' };
  const sweepTranscript = async (ch: { id: string; slug: string }): Promise<string> => {
    const recent = await db.getAll<{ author_kind: string; body: string }>(`select author_kind, body from messages where channel_id = ? and task_id is null order by created_at desc limit 18`, [ch.id]);
    const open = await db.getAll<{ number: number; title: string; state: string; assignee: string | null }>(`select t.number, t.title, t.state, (select name from agents where id = t.assignee_id) as assignee from tasks t where t.channel_id = ? and t.state not in ('accepted','closed','backlog') order by t.number desc limit 30`, [ch.id]);
    // parked ideas ride along so summaries can carry the tally — they are NOT open work
    const [bl] = await db.getAll<{ n: number }>(`select count(*) as n from tasks where channel_id = ? and state = 'backlog'`, [ch.id]);
    const backlog = (bl?.n ?? 0) > 0 ? await db.getAll<{ number: number; title: string }>(`select number, title from tasks where channel_id = ? and state = 'backlog' order by number desc limit 8`, [ch.id]) : [];
    const block = await blockFor(ch.id);
    return (block ? `[channel summary block]\n${block}\n\n` : '') +
      `Open tasks on #${ch.slug}:\n${open.map((t) => `#${t.number} ${t.title} [${t.state}${t.assignee ? ` · ${t.assignee}` : ''}]`).join('\n') || '(none)'}\n\n` +
      `Backlog on #${ch.slug} (parked ideas, not open work): ${bl?.n ?? 0}${backlog.length ? `\n${backlog.map((t) => `#${t.number} ${t.title}`).join('\n')}` : ''}\n\n` +
      `Recent #${ch.slug} channel messages (newest first):\n${recent.map((r) => `${r.author_kind === 'agent' ? 'agent' : 'human'}: ${r.body.slice(0, 200)}`).join('\n') || '(none)'}`;
  };

  // The sweeps themselves live in orchsweeps.ts; the INTERVALS stay here, in the boot
  // sequence, for the same reason the berth sweep's do — when a sweep fires is a boot fact.
  const { runOrchestratorSweeps } = makeOrchSweeps({
    db, post, agents, claimed, guards, apiUrl, ownerActorId, startedAt, buildOrchestratorTools,
    SUMMARY_MARKER, sweepPeriod, summaryPostedToday,
    channelMonitorSignals, sweepTranscript, dispatchOrchestrator, discoverSkills, arun,
  });

  // Route an orchestrator transport call to the agent's provider — shared by message turns AND the
  // periodic sweeps (orchestratorSweep). Hybrid free default for Gemini: prefer the user's agy/Google
  // OAuth login (no key) when present and not on an explicit API key, else the @google/genai SDK with
  // our GEMINI_API_KEY. token is non-empty only for an explicit apikey cred → SDK.
  async function dispatchOrchestrator(agent: HostedAgent, args: OrchTransportArgs): Promise<string> {
    const provider = providerFor(agent.runtime);
    if (provider === 'gemini') {
      return geminiDispatch(args, { houseModel: agent.model === STARTER_MODEL, apiUrl, workspace, actorId: ownerActorId });
    }
    if (provider === 'openai') return codexSdkOrchestratorTurn(args);
    return anthropicOrchestratorTurn(args);
  }

  // The orchestrator's turn (host/orchestratorturn.ts) — it assembles the turn and hands it to
  // whichever transport the provider needs. Choosing is not the same job as running.
  const { orchestratorTurn } = makeOrchTurn({
    db, NO_RUN, buildOrchestratorTools, draftsForAnchor, ensureChatWorkspace, orchSpawnFor,
    dispatchOrchestrator,
  });


}
