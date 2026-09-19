/* eslint-disable max-lines -- the bridge drift tests intentionally scan this contract as one source */
// The NMBridge contract + the `nm` singleton — extracted from App.tsx (track A1).
//
// `nm` is read from `window` at MODULE-EVAL time, which is safe for the same reason it
// was safe in App.tsx: this module evaluates when App.tsx imports it, and the preview
// harness installs its mock on `window` BEFORE dynamically importing App (preview/main.tsx).
// Do not move this read later (lazy) or earlier (a static preview import) without
// re-checking that ordering.
import type { ChannelRow, ChannelPersonRow, ChannelHistoryRow, ChannelArtifactRow, MessageRow, ThreadRow, HomeConvoRow, HistoryThreadRow } from './rows-rooms';
import type { ConnectorRow, ContentItemRow, ContentItemWide, ScheduleRow, SkillRow, SkillPackRow , ScheduleRunRow } from './rows-content';
import type { TaskRow, TaskAllRow, DecisionAllRow, ProjectRow, WorkspaceProjectRow, RepoUI, BeatUI, RunUI, ArtifactUI, AttachmentRow } from './rows-board';
import type { AgentRow, MachineRow, MemberRow, WorkspaceMembership, PendingInvite, LogRow, RunRow } from './rows-crew';
export type { WorkspaceUsage, CreditHistory } from './rows-infra';
import type { WorkspaceUsage, CreditHistory } from './rows-infra';
import type { CredRow, ProviderId, ProviderStatus, UpdateState, ArchivedThreadRow, FailoverRow, PolicyRowUI, ProcList, FootprintSnapshot, FootprintReply } from './rows-infra';
import type { AlertConnectorRow, AlertPostRow, AlertScheduleRow, BrainOverride, RetroPayload, ThreadMode } from '@neuramesh/shared';
import type { EngineeringNMBridge } from './engineering';
import type { TerminalNMBridge } from './terminal';

/**
 * GET /v1/usage — the WORKSPACE's credit balance plus today's meters (docs/design/
 * cloud-first-2026-08/starter-brain-and-credits.md §5.7).
 *
 * Read over HTTP, never PowerSync: `workspace_credits` and `machine_usage` are deliberately
 * outside the sync publication (operator data), so there is no local row to watch.
 *
 * A workspace that was never granted reads ZERO — the endpoint creates nothing and returns
 * zeros, so "no row" and "no credits" are the same answer to every caller.
 */

/** which backend the shell is standing in (main/connections.ts): the local stack on this Mac, the
 *  hosted cloud, or a server someone runs themselves — the foot's glyph and the sync mark read it */
export type ConnectionKind = 'local' | 'cloud' | 'custom';
export type AuthMode = 'local' | 'dev' | 'supabase' | 'clerk';
export interface ConnectionInfo { id: string; kind: ConnectionKind; authMode: AuthMode; /** the site this connection's copy points at (weburl.ts) */ webUrl?: string; /** a local workspace that moved to Cloud (main/move/files.ts) */ moved?: MovedMarker }
/** Move to Cloud (main/moveipc.ts, artboards H1 and H2): the target, the marker a finished move leaves, the plan's numbers, the pushed phase */
export interface MoveTarget { connectionId: string; workspaceId: string; name: string; slug: string }
export interface MovedMarker { importId: string; movedAt: string; target: MoveTarget; counts: Record<string, number>; totalBytes: number }
export interface MoveStorage { allocationBytes: number; usedBytes: number; totalBytes: number }
export type MovePlanResult =
  | { ok: true; source: { workspaceId: string; name: string; slug: string }; target: MoveTarget; targets: MoveTarget[]; counts: Record<string, number>; totalBytes: number; storage: MoveStorage | null; tooLarge: number; agents: string[]; alreadyMoved?: MovedMarker }
  | { ok: false; code: 'NO_LOCAL' | 'NO_CLOUD' | 'NOT_PRO' | 'NOT_OWNER' | 'FAILED'; message: string; source?: { workspaceId: string; name: string; slug: string }; refusal?: { code: string; storage?: MoveStorage } };
export type MovePhase = 'idle' | 'planning' | 'ready' | 'moving' | 'done' | 'error';
export interface MovePush { phase: MovePhase; seq?: number; total?: number; written?: number; skipped?: number; message?: string; code?: string; table?: string; storage?: MoveStorage }
/** a connection as the rail and the foot's menu read it (main/sync/ipc/membership.ts `ConnectionSummary`) */
export interface ConnectionSummary extends ConnectionInfo {
  /** the API host — a custom server's band and foot glyph name it */
  host: string;
  workspaceId: string;
  workspace: { name: string; slug: string };
  workspaces: WorkspaceMembership[];
  /** the signed-in account on a cloud connection; a local connection has none */
  account: { email: string } | null;
  live: boolean;
}
/** a row from a connection the shell does not stand in — the union tags every row it carries */
export type RailTag = { connectionId: string; connectionKind: ConnectionKind };
/** the rail's union (main/sync/ipc/rail-rows.ts): every row-set a rail row and its band derive
 *  from, for every OTHER live connection, tagged. Empty with one connection. */
export interface RailRowsPayload {
  threads: Array<HistoryThreadRow & RailTag>;
  tasks: Array<TaskAllRow & RailTag>;
  runs: Array<RunUI & RailTag>;
  decisions: Array<DecisionAllRow & RailTag>;
  channels: Array<{ id: string; slug: string; project_id: string | null; msg_count: number } & RailTag>;
  projects: Array<{ id: string; name: string; slug: string; status: string; logo_url: string | null } & RailTag>;
  agents: Array<{ id: string; role: string; retired_at: string | null; channel_ids: string | null } & RailTag>;
}

/** Local mode's stack, as main's driver states it (main/localStack/driver.ts). The renderer
 *  draws these and decides nothing: `blocking` and `aboutMb` arrive computed. */
export type LocalRuntime = 'colima' | 'orbstack' | 'docker-desktop';
export type LocalEngine = 'docker-desktop' | 'orbstack' | 'colima' | 'other';
export interface LocalProgressItem { name: string; bytes: number; total: number | null; done: boolean }
export type LocalStackState =
  | { phase: 'probing' }
  | { phase: 'no-engine'; picked: LocalRuntime }
  | { phase: 'installing'; runtime: LocalRuntime; items: LocalProgressItem[]; vm: 'pending' | 'starting' | 'ready' }
  | { phase: 'engine-starting'; engine: LocalEngine }
  | { phase: 'downloading'; items: LocalProgressItem[] }
  | { phase: 'starting'; services: Array<{ name: string; ready: boolean }> }
  | { phase: 'updating'; version: string; items: LocalProgressItem[] }
  | { phase: 'ready'; version: string; engine: LocalEngine }
  | { phase: 'error'; message: string; from: string };
export interface LocalStackPayload { state: LocalStackState; blocking: boolean; aboutMb: number | null }
/** Settings › Connections (main/connectionsipc.ts): one card per connection */
export interface ConnectionWorkspace { id: string; name: string; slug: string; plan: string | null; seats: number | null; subscriptionStatus: string | null; currentPeriodEnd: string | null }
export interface ConnectionCard { id: string; kind: ConnectionKind; authMode: AuthMode; foreground: boolean; apiUrl: string; powersyncUrl: string; webUrl: string; account: { email: string } | null; workspaceId: string; workspaces: ConnectionWorkspace[]; moved?: MovedMarker }
export interface LocalStackInfo { dir: string; ports: { api: number; powersync: number }; engine: string | null; engineVersion: string | null; stackVersion: string | null; appVersion: string }
export type CustomServerResult = { ok: true; id: string } | { ok: false; code: 'ADDRESS' | 'NM_CONFIG' | 'BEARER' | 'UNREACHABLE'; message: string };
export type WorkspaceExportResult = { ok: true; path: string } | { ok: false; code: 'NOT_AVAILABLE' | 'CANCELLED' | 'FAILED'; message?: string };
/** the upgrade handoff's phase (main/upgradeipc.ts): the sheet draws it and never decides */
export type UpgradePhase = 'idle' | 'waiting' | 'landing' | 'done' | 'expired' | 'error';
export interface UpgradePush { phase: UpgradePhase; url?: string; message?: string }

export interface NMBridge extends EngineeringNMBridge, TerminalNMBridge {
  electron: string;
  channels(): Promise<ChannelRow[]>;
  send(channelId: string, body: string, opts?: { id?: string; attachments?: { id: string; name: string; mime: string }[]; threadId?: string; rootMessageId?: string; threadMode?: ThreadMode; brainOverride?: BrainOverride | null; threadMachineId?: string | null; threadOrigin?: 'desktop' | 'web' | 'routine' | null }): Promise<{ id: string }>;
  /** docs/34 — flip an OPEN conversation's Tasks toggle (HUMAN_ONLY server-side) */
  threadSetMode(threadId: string, mode: ThreadMode): Promise<unknown>;
  // Archiving a conversation (0108) — HUMAN_ONLY and chat-only, both enforced server-side
  threadArchive(threadId: string): Promise<unknown>;
  threadUpdate(threadId: string, fields: { title?: string; description?: string }): Promise<unknown>; // rename from the rail row (rail-ink round) — `thread.update`, human/orchestrator server-side
  // ── whiteboards (docs/38) ──
  wbCreate(channelId: string, opts?: { title?: string; threadId?: string }): Promise<{ id: string }>;
  wbSave(id: string, rev: number, patch: { scene?: string; snapshotSvg?: string; title?: string }): Promise<void>;
  wbArchive(id: string, rev: number, restore?: boolean): Promise<void>;
  wbUpdateCmd(payload: { whiteboardId: string; baseRev: number; title?: string; scene?: string; snapshotSvg?: string; clearSource?: boolean }): Promise<{ ok: boolean; status: number; rev?: number; code?: string; error?: string }>;
  watchWhiteboards(scope: { channelId?: string | null; projectId?: string | null }, cb: (rows: unknown[]) => void): () => void;
  watchWhiteboard(id: string, cb: (row: unknown | null) => void): () => void;
  threadUnarchive(threadId: string): Promise<unknown>;
  /** settle (0137): the thread's status, nothing else — HUMAN_ONLY server-side */
  threadSettle(threadId: string): Promise<unknown>;
  threadUnsettle(threadId: string): Promise<unknown>;
  watchArchivedThreads(cb: (rows: ArchivedThreadRow[]) => void): () => void;
  threadSetBrain(threadId: string, override: Record<string, string> | null): Promise<unknown>;
  /** one seat of one conversation → a model, merged into its override by the main process */
  threadBrainRole?(threadId: string, role: string, model: string): Promise<unknown>;
  /** the conversation's current override, so a card can tell a switch already happened */
  threadBrain?(threadId: string): Promise<Record<string, string> | null>;
  watchThreads(channelId: string, cb: (rows: ThreadRow[]) => void): () => void;
  watchConvo(threadId: string, cb: (rows: MessageRow[]) => void): () => void;
  status(): Promise<{ connected: boolean; lastSyncedAt: string | null; queued?: number }>;
  watchMessages(channelId: string, cb: (rows: MessageRow[]) => void): () => void;
  watchTasks(channelId: string, cb: (rows: TaskRow[]) => void): () => void;
  watchThread(taskId: string, cb: (rows: MessageRow[]) => void): () => void;
  sendThread(taskId: string, channelId: string, body: string, opts?: { id?: string; attachments?: { id: string; name: string; mime: string }[] }): Promise<{ id: string }>;
  attachStage(id: string, name: string, mime: string, bytes: ArrayBuffer): Promise<{ id: string; size: number; width: number | null; height: number | null; thumb: string | null }>;
  attachDiscard(id: string): Promise<void>;
  watchMsgAttachments(channelId: string, cb: (rows: AttachmentRow[]) => void): () => void;
  watchThreadAttachments(taskId: string, cb: (rows: AttachmentRow[]) => void): () => void;
  watchConvoAttachments(threadId: string, cb: (rows: AttachmentRow[]) => void): () => void; // a conversation's own attachments
  watchArtifacts(taskId: string, cb: (rows: ArtifactUI[]) => void): () => void;
  watchBeats(taskId: string, cb: (rows: BeatUI[]) => void): () => void;
  watchRuns(channelId: string, cb: (rows: RunUI[]) => void): () => void;
  watchReplyCounts(channelId: string, cb: (rows: Array<{ message_id: string; thread_id: string; n: number; last_at: string }>) => void): () => void;
  watchOpenRuns(cb: (rows: RunUI[]) => void): () => void;
  createTask(channelId: string, title: string, opts?: { description?: string; offerTo?: string; project?: string; repoId?: string; baseRef?: string; backlog?: boolean; thread?: string; kind?: string; plan?: { legs: string[]; subtasks?: string[]; approach: string }; originThread?: string }): Promise<{ task: TaskRow }>;
  channelMeta(channelId: string): Promise<{ projects: ProjectRow[]; repos: RepoUI[]; reposAll: RepoUI[] }>;
  workspaceMeta(): Promise<{ projects: WorkspaceProjectRow[] }>;
  workspaceSettings(): Promise<{ autoFailover: boolean; activeModelPack: string; commRules: unknown; plan: string; seats: number; subscriptionStatus: string | null; currentPeriodEnd: string | null; primaryMachineId: string | null }>;
  workspaceUpdate(input: { autoFailover?: boolean; activeModelPack?: string; commRules?: { ste100?: boolean; noEmdash?: boolean; custom?: string[] } }): Promise<unknown>;
  /** create the workspace ALONE (no crew, no machine) — the browser wizard's first step,
   *  where the id it mints is what the workspace's cloud machine is provisioned against. */
  workspaceCreate(input: { name: string; slug: string }): Promise<{ workspaceId: string }>;
  /** the nav foot's credit ring. `null` when this deployment does not serve credits (the
   *  endpoint 501s off postgres) or the read failed — the ring then draws NOTHING, because a
   *  meter that cannot read must not paint a full one. */
  usage(): Promise<WorkspaceUsage | null>;
  policies(): Promise<PolicyRowUI[]>;
  policySet(input: { id?: string; scope: string; projectId?: string | null; capability: string; selector: unknown; verdict: string; rationale?: string; locked?: boolean }): Promise<unknown>;
  policyDelete(id: string): Promise<unknown>;
  sandboxGet(): Promise<{ enabled: boolean; envForced: boolean }>;
  sandboxSet(enabled: boolean): Promise<{ ok: boolean }>;
  footprintGet(quick?: boolean): Promise<FootprintReply>;
  footprintReclaim(): Promise<FootprintReply & { snapshot: FootprintSnapshot | null }>;
  applyPack(packId: string): Promise<{ ok: boolean; applied: number }>;
  modelPacks(): Promise<{ packs: Array<{ id: string; name: string; roles: Record<string, string>; updatedAt: string }> }>;
  modelPackSave(input: { packId?: string; name: string; roles: Record<string, string> }): Promise<{ ok: boolean; packId: string }>;
  modelPackDelete(packId: string): Promise<{ ok: boolean }>;
  billingCheckout?(): Promise<{ ok: boolean }>;
  /** the utilization dashboard's history — daily meters + the grant ledger */
  creditsHistory?(): Promise<CreditHistory | null>;
  /** buy a credit pack: names a size, the server prices it, opens hosted Checkout */
  creditsCheckout?(credits: number): Promise<{ ok: boolean }>;
  billingPortal?(): Promise<{ ok: boolean }>;
  machineLimitInfo?(): Promise<{ message: string } | null>;
  machineTransfer?(): Promise<{ ok: boolean }>;
  /** today's machine meter + the fleet's INTENT per machine. `desired_replicas` is deliberately
   *  outside the sync publication, so this read is the only way a surface can tell "asleep on
   *  purpose" from "offline" — see machineState() in shared. */
  machinesUsage?(): Promise<{
    day: string; minutes: number; capMinutes: number | null; plan: string;
    machines: Array<{ id: string; name: string; desiredReplicas: number; lastSeenAt: string | null; lastWakeAt: string | null; lifecycle: string | null; idleStopMin: number | null }>;
  } | null>;
  /** the human's "start it anyway". Refuses OUT LOUD on a spent free day (capped: true) rather
   *  than silently doing nothing, which is what the automatic wake does. */
  machineWake?(): Promise<{ ok: boolean; woken?: number; capped?: boolean; error?: string }>;
  syncAgents(): Promise<{ ok: boolean; registered: number }>;
  projectCreate(name: string, description?: string, slug?: string, newChannels?: string[], identity?: { website?: string; logoUrl?: string }): Promise<{ ok: boolean; projectId: string; slug: string }>;
  // identity.website / identity.logoUrl: '' clears the stored value, undefined keeps it
  projectUpdate(projectId: string, name?: string, description?: string, autoOpenPr?: boolean, runCiBeforeMerge?: boolean, shipGate?: boolean, identity?: { website?: string; logoUrl?: string }, modelPack?: string): Promise<unknown>;
  shipItem(taskId: string, itemId: string, state: 'pending' | 'done' | 'na', note?: string): Promise<unknown>;
  shipItemAdd(taskId: string, title: string, detail?: string): Promise<unknown>;
  subtaskAdd(parentId: string, title: string, description?: string): Promise<unknown>;
  watchJourney(cb: (rows: Array<{ task_id: string; has_design: number; has_plan: number }>) => void): () => void;
  projectArchive(projectId: string, archived: boolean): Promise<unknown>;
  projectDelete(projectId: string): Promise<unknown>;
  channelCreate(projectId: string, slug: string, topic?: string): Promise<{ ok: boolean; channelId: string; slug: string }>;
  channelRename(channelId: string, slug?: string, topic?: string): Promise<{ ok: boolean; channelId: string; slug: string }>;
  channelKind(channelId: string, kind: 'build' | 'marketing'): Promise<{ ok: boolean; channelId: string }>;
  /** step 5 (release drafts §4.7) rides `releases`: the repository, a free one-shot (`now`), a daily Team routine (`watch`); the answer says whether the routine armed or the plan refused it */
  marketingSetup(channelId: string, website: string, focus: string[], goal?: string, releases?: { repoId?: string | null; slug?: string | null; now: boolean; watch: boolean; at?: string; tz?: string }): Promise<{ ok: boolean; channelId: string; threadId?: string; taskId?: string; releases?: { now: boolean; watch: 'armed' | 'plan_limit' | 'off' } }>;
  /** the releases step writes an object; every other step a text or a list (the server checks the shape per step) */
  setupStep(channelId: string, flow: string, step: string, value?: string | string[] | Record<string, unknown>): Promise<{ ok: boolean }>;
  contentUpdate(itemId: string, body: string, mediaUrl?: string): Promise<{ ok: boolean }>;
  contentDelete(itemId: string): Promise<{ ok: boolean }>;
  marketingIntegration(channelId: string, provider: 'posthog' | 'meta' | 'tiktok', enabled: boolean): Promise<{ ok: boolean }>;
  mcpKeys(): Promise<{ presence: Record<'posthog' | 'meta' | 'instagram' | 'tiktok', boolean>; metaUrl: string; tiktokUrl: string }>;
  mcpKeySet(provider: 'posthog' | 'meta' | 'metaUrl' | 'tiktok' | 'tiktokUrl', value: string): Promise<{ presence: Record<'posthog' | 'meta' | 'instagram' | 'tiktok', boolean> }>;
  mcpVerify(provider: 'posthog' | 'meta' | 'tiktok', token: string, url?: string): Promise<{ ok: boolean; detail: string }>;
  scheduleCreate(p: { channelId: string; title: string; prompt: string; cadence: string; atTime?: string; tz?: string; weekday?: number; runAt?: string; routine?: boolean }): Promise<{ ok: boolean; scheduleId: string; nextRunAt: string }>;
  launcherIdeas?(channelId: string, mode: 'task' | 'routine'): Promise<string[] | null>;
  scheduleStatus(scheduleId: string, status: 'active' | 'paused'): Promise<{ ok: boolean }>;
  scheduleDelete(scheduleId: string): Promise<{ ok: boolean }>;
  scheduleUpdate(p: { scheduleId: string; title: string; prompt: string; cadence: string; atTime?: string; tz?: string; weekday?: number; runAt?: string }): Promise<{ ok: boolean; nextRunAt: string }>;
  schedules(channelId: string | null): Promise<{ schedules: ScheduleRow[] }>;
  scheduleRuns(scheduleId: string, limit?: number): Promise<{ runs: ScheduleRunRow[] }>;
  contentItems(channelId: string): Promise<{ items: ContentItemRow[] }>;
  contentByTask(taskId: string): Promise<{ items: ContentItemRow[] }>; // a content task's drafts (marketing-workflow §4.5), rendered inline in its thread
  contentByThread(threadId: string): Promise<{ items: ContentItemRow[] }>;
  contentAll(): Promise<{ items: ContentItemWide[] }>; // every room's content, for Automations › Calendar — narrowing is the ScopeBar's, not the query's
  threadArtifacts(threadId: string): Promise<{ artifacts: ChannelArtifactRow[] }>; // a conversation's own produced files // …and a conversation's (0115) — the same cards with no task behind them
  /** one artifact by id — the ‹article:id› card reads its own row, self-contained like WbCard */
  artifact(artifactId: string): Promise<{ artifact: (ChannelArtifactRow & { channel_id?: string | null; channel_slug?: string | null }) | null }>;
  /** open an article in the OS browser (article round) — main writes the rendered HTML to temp */
  articleExternal(name: string, html: string): Promise<{ ok: boolean }>;
  contentApprove(itemId: string, scheduledAt?: string): Promise<{ ok: boolean }>;
  /** the image floor: generate/regenerate (and with `rewrite`, redraft body+brief) for one draft */
  /** `pending`: the picture was ASKED FOR (a tab posting to the draft's thread) and lands on the row by sync; the desktop draws in place and answers with the thumb */
  draftImage(itemId: string, opts?: { angle?: string; rewrite?: boolean }): Promise<{ ok: boolean; pending?: boolean; thumb?: string; body?: string; error?: string }>;
  /** a draft's hosted media (the UGC film) as a data: URL — read with the session, members only; null when it is gone */
  contentMedia(mediaId: string): Promise<string | null>;
  contentUnschedule(itemId: string): Promise<{ ok: boolean }>;
  mediaPreview(url: string): Promise<{ dataUrl: string | null }>;
  connectorStart(channelId: string, provider?: 'x' | 'linkedin' | 'instagram' | 'tiktok'): Promise<{ ok: boolean }>;
  connectors(channelId?: string): Promise<{ connectors: ConnectorRow[] }>;
  /** the attention bar's three row sets (failure-alerts round) — folded by shared deriveAlerts */
  alerts(): Promise<{ connectors: AlertConnectorRow[]; schedules: AlertScheduleRow[]; posts: AlertPostRow[] }>;
  /** save a file the team or its agents made, wherever the human picks (2026-08-18) */
  saveFileAs(f: { name: string; content: string; base64?: boolean }): Promise<{ saved: boolean; path?: string }>;
  /** delete an artifact — HUMAN_ONLY, and refused for anything a gate resolves against */
  artifactDelete(artifactId: string): Promise<unknown>;
  connectorDisconnect(connectorId: string): Promise<{ ok: boolean }>;
  channelArtifacts(channelId: string): Promise<{ artifacts: ChannelArtifactRow[] }>;
  channelDelete(channelId: string): Promise<unknown>;
  // pin/unpin a room message. The COMMAND, the IPC and `messages.pinned` are all still live;
  // what retired with the feed (docs/35 §6, §10) is the per-message action row that called this.
  pinMessage(messageId: string, pinned: boolean): Promise<unknown>;
  repoAdd(opts: { url?: string; localPath?: string; name?: string; channelSlug?: string; projectId?: string; defaultBranch?: string }): Promise<{ ok: boolean; repoId: string; inserted: boolean }>;
  pickFolder(): Promise<{ path: string; name: string; isGit: boolean; branch: string; remoteLabel: string | null } | null>;
  projectDetect(path: string): Promise<{ name: string; slug: string; description: string; remoteUrl: string | null; remoteLabel: string | null; rooms: string[] } | null>;
  logoDetect(input: { url?: string; path?: string }): Promise<{ logoUrl: string; source: string; website?: string } | null>;
  fsList(root: string, path?: string): Promise<{ entries: { name: string; dir: boolean }[]; error?: string }>;
  fsRead(root: string, path: string): Promise<{ content: string; truncated?: boolean; binary?: boolean; error?: string }>;
  fsWrite(root: string, path: string, content: string): Promise<{ ok: boolean; error?: string }>;
  gitBranches(root: string): Promise<{ current: string | null; branches: string[] }>;
  gitCheckout(root: string, branch: string): Promise<{ ok: boolean; error?: string }>;
  roster(): Promise<{ machines: MachineRow[]; agents: AgentRow[] }>;
  latest(): Promise<Array<{ channel_id: string; latest: string }>>;
  latestThreads(): Promise<Array<{ task_id: string; latest: string }>>;
  registerAgent(input: { name: string; role: string; model: string; runtime?: string; channels: string[]; apiKey?: string; description?: string; brief?: string }): Promise<{ agentId: string }>;
  // `description` routes (read by the orchestrator in list_agents); `brief` instructs (injected
  // into the agent's own turns). '' clears either — 0110.
  agentUpdate(input: { agentId: string; model?: string; runtime?: string; name?: string; description?: string; brief?: string; modelSource?: 'pack' | 'manual' }): Promise<unknown>;
  agentInstructions(name: string, role: string): Promise<{ local: string | null; shipped: string | null; path: string; prompt: Record<string, string> | null }>;
  agentInstructionsWrite(name: string, instructions: string | null): Promise<{ ok: boolean }>;
  agentRetire(agentId: string): Promise<{ ok: boolean; agentId: string; alreadyRetired: boolean }>;
  updateProfile(displayName: string): Promise<{ ok: boolean }>;
  addAgentToChannel(channelId: string, agent: string): Promise<{ ok: boolean }>;
  removeAgentFromChannel(channelId: string, agent: string): Promise<{ ok: boolean }>;
  addPersonToChannel(channelId: string, person: string): Promise<{ ok: boolean }>;
  removePersonFromChannel(channelId: string, person: string): Promise<{ ok: boolean }>;
  channelPeople(channelId: string): Promise<ChannelPersonRow[]>;
  channelHistory(channelId: string): Promise<ChannelHistoryRow[]>;
  setNotificationsEnabled(on: boolean): Promise<{ ok: boolean }>;
  onOpenThread(cb: (nav: { channelId: string; taskId: string | null; messageId: string }) => void): () => void;
  onPlanLimit?(cb: (p: { message: string }) => void): () => void;
  ensureRuntimeCli(runtime: string): Promise<{ ok: boolean; runtime: string }>;
  agentConnectRemote(cardUrl: string, channels: string[]): Promise<{ ok: boolean; agentId: string; name: string }>;
  credentials(): Promise<{ credentials: CredRow[] }>;
  /** the signed-in person's push devices — PLATFORMS only, never tokens (/v1/devices) */
  devices(): Promise<{ devices: Array<{ platform: string }> }>;
  detectProviders(): Promise<Record<ProviderId, ProviderStatus>>;
  // re-run a provider's CLI login (claude auth login / codex login / gemini) in a window, then
  // report whether the machine is authenticated afterward. (impl: Slice 3 IPC)
  providerReauth(provider: string): Promise<{ authed: boolean }>;
  claudeDesignStatus(): Promise<{ configured: boolean; claudeAuthed: boolean; detail: string }>;
  claudeDesignConnect(taskId?: string): Promise<{ configured: boolean; cwd: string; command: string; taskNumber: number | null }>;
  setCredential(input: { scope: 'workspace' | 'agent'; agentId?: string; token?: string; provider?: string; authMode?: 'apikey' | 'subscription' }): Promise<unknown>;
  invite(email: string): Promise<{ inviteId: string; created: boolean; delivery: 'sent' | 'skipped' | 'failed' | 'queued' }>;
  invites(): Promise<Array<{ id: string; email: string; role: string; expiresAt: string; createdAt: string }>>;
  revokeInvite(invite: string): Promise<{ ok: boolean }>;
  watchLibrary(channelId: string, cb: (rows: ArtifactUI[]) => void): () => void;
  promoteArtifact(artifactId: string): Promise<unknown>;
  taskAction(type: string, taskId: string, feedback?: string, input?: { provider?: 'iris' | 'claude-design'; designer?: string; kind?: string }): Promise<unknown>;
  taskSetDod(taskId: string, dod: string): Promise<{ ok: boolean }>;
  setCompute(prefs: { machine?: string | null; agents?: Record<string, string>; shares?: string[]; desktopSessions?: 'here' | 'auto' }): Promise<{ ok: boolean }>;
  computeSharedThreads(member: string): Promise<{ count: number }>;
  shareCompute(member: string, on: boolean): Promise<{ ok: boolean }>;
  taskUpdateDetails(taskId: string, fields: { title?: string; description?: string }): Promise<{ ok: boolean }>;
  retro(range: string): Promise<RetroPayload>;
  members(): Promise<MemberRow[]>;
  welcomed(): Promise<{ welcomed: boolean }>;
  taskDetail(taskId: string): Promise<{ task: Record<string, unknown>; events: Array<{ id: string; type: string; source: string; created_at?: string; occurred_at?: string; payload?: Record<string, unknown> }>; artifacts: ArtifactUI[] }>;
  watchSkills(channelId: string | null, cb: (rows: SkillRow[]) => void): () => void;
  skillCreate(input: { channelSlug?: string; name: string; description: string; scope: 'channel' | 'global'; body: string }): Promise<{ skillId: string }>;
  skillUpdate(input: { skillId: string; description?: string; body?: string; scope?: 'channel' | 'global' }): Promise<unknown>;
  skillDeprecate(skillId: string): Promise<unknown>;
  skillPromote(skillId: string): Promise<unknown>;
  skillSetEnabled(skillId: string, enabled: boolean): Promise<unknown>;
  watchSkillPacks(channelId: string, cb: (rows: SkillPackRow[]) => void): () => void;
  skillpackSetEnabled(packId: string, enabled: boolean): Promise<unknown>;
  skillpackRemove(packId: string): Promise<unknown>;
  skillpackAdd(input: { channelSlug: string; url: string; ref?: string; name?: string }): Promise<{ ok: boolean; packId?: string }>;
  skillpackRetry(packId: string): Promise<unknown>;
  /** WEB ONLY. Make sure a machine exists and is awake before a machine-backed surface opens,
   *  reporting progress so the surface can show the boot. Undefined on desktop, where the
   *  terminal is local — see docs/design/machine-autowake-2026-08. */
  machineEnsure?(onPhase: (p: 'starting' | 'connecting') => void, cancelled?: () => boolean):
    Promise<{ ok: true } | { ok: false; reason: 'capped' | 'unavailable' | 'cancelled'; detail: string }>;
  terminalInfo(taskNumber: number, hasRepo: boolean): Promise<{ available: boolean; cwd: string | null }>;
  openTerminal(taskNumber: number, hasRepo: boolean, cols: number, rows: number, onData: (d: string) => void, onExit: () => void): { subId: string; input: (d: string) => void; resize: (c: number, r: number) => void; close: () => void };
  openTerminalCwd(cwd: string, cols: number, rows: number, onData: (d: string) => void, onExit: () => void, startupCommand?: string): { subId: string; input: (d: string) => void; resize: (c: number, r: number) => void; close: () => void };
  processList(): Promise<ProcList>;
  processKill(kind: 'agent' | 'terminal', id: string): Promise<{ ok: boolean }>;
  watchProcesses(cb: () => void): () => void;
  agentLogs(f: { agentId?: string; runId?: string; taskNumber?: number; level?: string; search?: string; limit?: number }): Promise<LogRow[]>;
  agentRuns(agentId: string, limit?: number): Promise<RunRow[]>;
  exportLogs(f: { agentId?: string; taskNumber?: number; level?: string; search?: string }): Promise<{ saved: boolean; path?: string; count?: number }>;
  debugSeedLogs?(): Promise<{ ok: boolean }>;
  debugSeedPlan?(): Promise<{ ok: boolean; number?: number }>;
  debugSeedReview?(): Promise<{ ok: boolean; number?: number }>;
  debugSeedDod?(): Promise<{ ok: boolean; number?: number }>;
  debugSeedPr?(): Promise<{ ok: boolean; number?: number }>;
  debugSeedImport?(): Promise<{ ok: boolean }>;
  debugSeedLessons?(): Promise<{ ok: boolean; slug?: string; number?: number }>;
  watchAgentLogs(cb: (row: LogRow) => void): () => void;
  watchAgentStream(cb: (p: { key: string; agent: string; text: string; done: boolean }) => void): () => void;
  watchTasksAll(cb: (rows: TaskAllRow[]) => void): () => void;
  watchThreadsAll(cb: (rows: HomeConvoRow[]) => void): () => void;
  watchHistoryAll(cb: (rows: HistoryThreadRow[]) => void): () => void;
  watchDecisionsAll(cb: (rows: DecisionAllRow[]) => void): () => void;
  watchFailover(cb: (row: FailoverRow | null) => void): () => void;
  decisionAction(type: 'decision.answer' | 'decision.dismiss', decisionId: string, answer?: string): Promise<unknown>;
  watchLibraryAll(cb: (rows: ArtifactUI[]) => void): () => void;
  fileUpload(channelId: string): Promise<{ ok: boolean; added: number; skipped: string[] }>;
  watchAttachmentsAll(cb: (rows: AttachmentRow[]) => void): () => void;
  watchRoster(cb: (p: { machines: MachineRow[]; agents: AgentRow[]; members: MemberRow[] }) => void): () => void;
  memory(channelSlug: string): Promise<{
    block: { content: string; basisCount: number; updatedAt: string } | null;
    facts: Array<{ id: string; content: string; kind?: string; taskNumber?: number | null; validFrom: string; validUntil: string | null; supersededBy?: string | null }>;
  }>;
  memoryRetireFact(factId: string, supersededBy?: string): Promise<{ ok: boolean; id: string; retired: boolean }>;
  memoryRecordLesson(channelSlug: string, content: string): Promise<{ decision: 'add' | 'update' | 'noop'; factId: string }>;
  bootstrap(): Promise<{ needsOnboarding: boolean; machineName: string; workspace: { name: string; slug: string }; workspaceId?: string; workspaces?: WorkspaceMembership[]; invites?: PendingInvite[]; connection?: ConnectionInfo; resolving?: boolean }>;
  onboard(input: {
    /** a workspace that exists and never finished the wizard: adopted, never re-created (main/sync/onboard-target.ts) */
    workspaceId?: string;
    name: string;
    slug: string;
    providers: Array<{ provider: string; mode: 'apikey' | 'subscription'; key: string }>;
    activeModelPack?: string;
    agents: Array<{ name: string; role: string; model: string; runtime?: string; emoji?: string; channels: string[] }>;
  }): Promise<{ workspaceId: string; orchestrator: string }>;
  openExternal(url: string): Promise<void>;
  /** the app the OS opens https links with (the link choice's second row); optional: the web client and older hosts have none */
  defaultBrowser?(): Promise<{ name: string; icon: string | null } | null>;
  openHtml(name: string, content: string): Promise<void>;
  authStatus(): Promise<{ mode: AuthMode; user: { id: string; email: string } | null; connection?: Pick<ConnectionInfo, 'id' | 'kind'> }>;
  login(email: string, password: string): Promise<{ user: { id: string; email: string } }>;
  loginGitHub(): Promise<{ user: { id: string; email: string } }>;
  authClerk(): Promise<{ user: { id: string; email: string } }>;
  authClerkOAuth(provider: 'google' | 'github'): Promise<{ user: { id: string; email: string } }>;
  authClerkPassword(email: string, password: string): Promise<{ user: { id: string; email: string } }>;
  authClerkSignup(email: string, password: string): Promise<{ user: { id: string; email: string } }>;
  accountBlockers(): Promise<{ workspaces: Array<{ id: string; name: string; slug: string; role: string; memberCount: number }> }>;
  // multi-workspace (0113)
  workspaces(): Promise<{ active: string; workspaces: WorkspaceMembership[] }>;
  switchWorkspace(workspace: string): Promise<{ ok: true; switching: true }>;
  myInvites(): Promise<{ invites: PendingInvite[]; needsOnboarding: boolean }>;
  acceptInvite(invite: string): Promise<{ workspaceId: string; workspaceName: string; role: string }>;
  declineInvite(invite: string): Promise<{ ok: boolean }>;
  leaveWorkspace(workspace: string): Promise<{ ok: boolean; switching?: boolean }>;
  removeMember(member: string): Promise<unknown>;
  liveRuns(): Promise<{ runs: Array<{ title: string; agent_name: string | null; number: number | null }> }>;
  workspaceDelete(workspaceId: string): Promise<unknown>;
  accountDelete(): Promise<unknown>;
  logout(): Promise<void>;
  onUpdate(cb: (s: UpdateState) => void): () => void;
  /** the foreground connection changed in place (connections.ts setForeground) — the shell remounts
   *  against it; the relaunch that used to follow a workspace switch is gone */
  onForeground?(cb: (c: ConnectionInfo & { workspaceId: string }) => void): () => void;
  // ── the connections (U3b: LOCAL and CLOUD bands) — desktop only, the browser holds one backend ──
  connections?(): Promise<ConnectionSummary[]>;
  onConnections?(cb: (list: ConnectionSummary[]) => void): () => void;
  /** bring another connection to the foreground, standing in one of its workspaces — the shell remounts */
  setForeground?(connectionId: string, workspaceId?: string | null): Promise<{ ok: true; switching: true }>;
  watchRailRows?(cb: (p: RailRowsPayload) => void): () => void;
  // ── Local mode's stack (main/localStack/ipc.ts) — desktop only, the browser has no stack ──
  localStackState?(): Promise<LocalStackPayload>;
  onLocalStack?(cb: (p: LocalStackPayload) => void): () => void;
  localStackPick?(runtime: LocalRuntime): Promise<LocalStackPayload>;
  localStackInstall?(): Promise<LocalStackPayload>;
  localStackRescan?(): Promise<LocalStackPayload>;
  localStackQuit?(): Promise<void>;
  /** keep the containers up after quit (review F9, default off) — Settings › Connections writes it */
  localKeepRunningGet?(): Promise<{ keep: boolean }>;
  localKeepRunningSet?(keep: boolean): Promise<{ keep: boolean }>;
  // ── Get Pro (main/upgradeipc.ts) — desktop only: the browser is already on neuramesh.app ──
  upgradeState?(): Promise<UpgradePush>;
  upgradeStart?(): Promise<{ url: string }>;
  upgradeReopen?(): Promise<void>;
  upgradeCancel?(): Promise<void>;
  onUpgrade?(cb: (p: UpgradePush) => void): () => void;
  // ── Settings › Connections (main/connectionsipc.ts) and the hosted shell's export — desktop only ──
  connectionsList?(): Promise<ConnectionCard[]>;
  connectionAddCustom?(input: { apiUrl: string; powersyncUrl?: string; bearer: string }): Promise<CustomServerResult>;
  connectionRemove?(id: string): Promise<{ ok: boolean }>;
  connectionBillingPortal?(id: string): Promise<{ ok: boolean }>;
  showInFolder?(path: string): Promise<void>;
  localStackInfo?(): Promise<LocalStackInfo>;
  localStackRestart?(): Promise<LocalStackPayload>;
  workspaceExport?(): Promise<WorkspaceExportResult>;
  // ── Move to Cloud (main/moveipc.ts) — desktop only: the local workspace lives here ──
  movePlan?(targetWorkspaceId?: string): Promise<MovePlanResult>;
  moveStart?(targetWorkspaceId: string): Promise<{ ok: true } | MovePlanResult>;
  moveCancel?(): Promise<void>;
  moveState?(): Promise<MovePush>;
  moveOpen?(): Promise<{ ok: boolean }>;
  onMove?(cb: (p: MovePush) => void): () => void;
  updateState(): Promise<UpdateState>;
  updateCheck(): Promise<{ ok: boolean }>;
  updateDownload(): Promise<{ ok: boolean }>;
  updateInstall(): Promise<{ ok: boolean }>;
}

// guarded for the node test runner, where bridge modules are imported without a window
export const nm = typeof window === 'undefined' ? undefined : (window as unknown as { nm?: NMBridge }).nm;

/** resolves once boot-time composition has attached what it will — the desktop's relay lane
 *  (bridge/desktop-relay.ts). The web bridge composes before its App module evaluates, so it
 *  never waits; a hook that decides on the bridge's SHAPE awaits this first, or a fresh boot
 *  straight into Code mode would read "no bridge" a few milliseconds too early. */
export let bridgeReady: Promise<void> = Promise.resolve();
export function setBridgeReady(p: Promise<unknown>): void { bridgeReady = p.then(() => undefined, () => undefined); }
