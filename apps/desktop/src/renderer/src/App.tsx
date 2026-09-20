import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import { agentInChannel, type ShipPlan, awaitingAgent, actionableByHuman, decisionHandled, tasksInProject, rowsInProject, replyPreview, MARKETING_SETUP_FLOW, setupProgress, placementFor, type MachineCapability, type ThreadStatus , planLabel } from '@neuramesh/shared';
import { historyRows, plainTitle, resolveRoomSurface, roomBriefs, roomTabsFor, type HistoryRow, type RoomSurface, liveKinOf } from './room-tabs';
import { setConversation } from './wtabs';
import { emptyNavScope, navFlat, type NavScope, isChatRow, isCodeRow } from './navtree';
import { bindReview, reviewKind, reviewPacket, type ReviewBinding, type ReviewComment, type ReviewRound, type ReviewSubject, type ReviewVerdict } from './review';
import { BrandLockup } from './brand';
import { type ChannelRow, type ChannelPersonRow, type ChannelHistoryRow, type MessageRow, type ThreadRow, type HomeConvoRow, type HistoryThreadRow } from './bridge/rows-rooms';
import { type ContentItemWide, type SkillRow, type SkillPackRow } from './bridge/rows-content';
import { type TaskRow, type TaskAllRow, type DecisionAllRow, type ProjectRow, type WorkspaceProjectRow, type RepoUI, type RunUI, type ArtifactUI, type AttachmentRow } from './bridge/rows-board';
import { type AgentRow, type MachineRow, type MemberRow, type WorkspaceMembership, type PendingInvite } from './bridge/rows-crew';
import { type CredRow, type UpdateState, type FailoverRow, type ProcList } from './bridge/rows-infra';
import { nm as nmBridge, type ConnectionInfo } from './bridge/nm';
import { ProjectsPage } from './ProjectsPage';
import { MarketingOS } from './views/MarketingOS';
import { EngineeringOS, EngineeringWorkspaceHeader, engineeringHistoryRows, useEngineeringNavigation } from './engineering';
import { NavDestBand } from './shell/NavDestBand';
import { useNavGroups } from './shell/useNavGroups';
import { useNavBands } from './shell/useNavBands';
import { useConnections, useForegroundSwap } from './shell/useConnections';
import { isAskDecision, isAskTask } from './shell/asks';
import { WorkspaceCalendar } from './WorkspaceCalendar';
import { SheetHead } from './WorkspaceTabs';
import { MachineChip } from './compute/MachineChip';
import { designationFor } from './compute/machine-choice';
import { NM_PLATFORM } from './lib/platform';
import { SideDock } from './shell/SideDock';
import { dockActiveId, dockFoldAfter, dockKeyTarget, dockTabs } from './shell/sidedock-state';
// A LOCAL alias on purpose: TS keeps control-flow narrowing inside closures for local
// consts but drops it for imported bindings — the hundreds of `if (!nm) …` guards rely on it.
const nm = nmBridge;
import { isOnline, agentLive, agentBusy, agentFocus } from './lib/presence';
import { selfInitial, selfLabel, setSelfMachine } from './lib/self';
import { errMsg } from './lib/text';

import { IconActivity, IconAgents, IconBoard, IconBurger, IconCalendar, IconCheck, IconChevron, IconClose, IconCode, IconDockLeft, IconDockRight, IconCredits, IconFootprint, IconGrid, IconHistory, IconHome, IconInbox, IconLibrary, IconMachine, IconMedal, IconMemory, IconPaperclip, IconProject, IconRepeat, IconReply, IconSend, IconSkill, IconThreads, IconTrend, IconWhiteboard, IconCompose, IconWorkbench } from './ui/icons';
import { type ThemeId, type ThemePref, systemTheme, resolveTheme, applyTheme, loadThemePref } from './theme/theme';
import { flashToast, useToast, setProviderSettingsOpener, setPolicySettingsOpener, setUpgradeOpener, setConnectionsSettingsOpener, setMoveToCloudOpener , openMoveToCloud } from './lib/toast';
import { hostedGateFor } from './shell/hostedrule';
import { moveDoorFor } from './shell/move-copy';

import { parseComputePrefs } from './compute/prefs';


import { splitPlanBlocks } from './design/plans';
import { rememberPersonas } from './lib/persona';
import { AgentDirectory } from './context/AgentDirectory';
import { AgentAvatar } from './components/AgentAvatar';
import { ProjectChip } from './projects/ProjectChip';

import { Modal } from './ui/Modal';


import { type TaskRefInfo } from './cards/parse';
import { FailoverBannerContext } from './context/FailoverBanner';
import { CLAUDE_DESIGN_TERMINAL_EVENT, type ClaudeDesignLaunch } from './cards/terminal';
import { FailoverFlyup } from './cards/FailoverCard';


import { STATE_LABEL } from './task/labels';


import { RetroView } from './views/RetroView';
import { FootprintView, footprintPctOf, useFootprint } from './views/FootprintView';
import { CreditsView } from './views/CreditsView';
import { LogsScreen } from './views/LogsScreen';

import { SkillsView } from './views/SkillsView';

import { AgentDetails } from './views/AgentDetails';
import { WorkspaceFiles, type WsFile } from './views/WorkspaceFiles';
import { DocOverlay, previewType } from './views/docpreview';
import { HistoryRail } from './views/HistoryRail';
import { ImageKeyForm, setCreditsOpener, setImageConnectOpener } from './settings/ConnectionsList';

import { BrainChip } from './brain/BrainChip';
import { readBrainDraft } from './brain/draft';


import { ComputePanel } from './compute/ComputePanel';
import { Walkthrough } from './views/Walkthrough';
import { ChannelIntro } from './views/ChannelIntro';
import { WReviewView } from './views/WReviewView';
import { MarketingSetupCard } from './marketing/MarketingSetupCard';
import { MarketingUpgradePrompt } from './marketing/MarketingUpgradePrompt';

import { CreateAgent } from './crew/CreateAgent';

import { ScopeBar } from './ui/ScopeBar';
import { LibrarySurface } from './surfaces/LibrarySurface';
import { MemorySurface } from './surfaces/MemorySurface';
import { AgentsSurface } from './surfaces/AgentsSurface';
import { BoardSurface } from './surfaces/BoardSurface';
import { NavWorkspaceCard } from './surfaces/NavWorkspaceCard';
import { useScopeMemory } from './shell/useScopeMemory';
import { AccountMenu, ProjectsFace } from './views/ProjectsFace';
import { AttachButton, AttachTray, consumeWbAttach, setWbAttach, useAttachments } from './composer/attach';



import { Onboarding } from './views/Onboarding';
import { WorkspaceSettings } from './settings/WorkspaceSettings';
import { InviteTeammate, RevokeShare } from './settings/panels-people';
import { LauncherModal } from './views/LauncherModal';
import { ManageProjectModal } from './projects/ManageProjectModal';
import { CreateProjectModal } from './projects/CreateProjectModal';
import { Marketplace } from './views/Marketplace';
import { RoutinesView } from './views/RoutinesView';
import { SessionList, orbStateFor } from './views/SessionList';
import { type ComposerPerson, MentionButton, TypistChip, filesFromPaste, memberPeople, useDropZone } from './thread/parts';






import { useAgentStream } from './thread/hooks';
import { ComposerInput } from './composer/ComposerInput';


import { ConvoThread } from './thread/ConvoThread';
import { BrandSections } from './marketing/BrandSections';
import { RailToks } from './thread/ThreadRail';
import { createPortal } from 'react-dom';

import { TaskThread } from './thread/TaskThread';
import { WFileView, type WScope, wtabBase } from './wtabs/filetree';
import { Workbench } from './shell/Workbench';
import { WorkbenchDock } from './shell/WorkbenchDock';
import { BrowserPane, type MainView, type TermHandle, TerminalView, viewFromUrl, WhiteboardView } from './wtabs/guests';
import { DockBar, NavWorkspaceFoot, UtilCluster } from './shell/chrome';
import { StatusCluster } from './shell/statuscluster';
import { useCompute } from './compute/useCompute';
import { SCHEDULED_SEC } from './shell/navdest';
import { workbenchApplies, workbenchState } from './shell/workbench-state';
import { BellButton, BellPopover } from './shell/BellPopover';
import { bellFlight, bellQueue } from './shell/bell';
import { useBell, useBellHover } from './shell/useBell';
import { type FaceHoverEvent, type FaceState, faceHover, initialFace } from './shell/facehover';
import { makeRowMarks } from './shell/rowstatus';
import { type HeadStatus } from './thread/parts';
import { BootSplash } from './shell/boot';
import { type CmdItem, CmdKPalette } from './shell/CmdKPalette';
import { BriefStack } from './shell/BriefStack';
import { AddAgentsOverlay, AddPeopleOverlay } from './shell/roster-overlays';
import { MachineLimitModal, MoveToCloudSheet, ProfileModal, SwitchWorkspaceSheet, UpgradeSheet } from './shell/sheets';
import { setConnectionWebUrl } from './weburl';
import { AppearancePanel, UpdateCard } from './shell/appearance';
import { updateKey, updateVisible } from './shell/updatecard-state';
import { InvitedFirstRun } from './views/join';
import { Login } from './views/Login';
import { LocalStackGate } from './views/LocalStackGate';
import { FirstRunDoor } from './views/FirstRunDoor';
import { useBootGates } from './shell/useBootGates';
import { AddRepoModal, ChannelSettingsModal, CreateChannelModal } from './projects/rooms';
import { MarketingCalendar, MarketingLibrary } from './marketing/room-tabs';
import { WhiteboardsHome } from './views/WhiteboardsHome';
import { AgentActivity } from './views/AgentActivity';
import { ComputeIntro } from './compute/ComputeIntro';
import { BellAlerts, useAlerts } from './views/AlertsBar';
import { ArticleView } from './views/ArticleView';
import { HomeTop } from './views/HomeTop';
import { SetupCards } from './views/SetupCards';
import { ComposerHint, NewChatStage, leadFor } from './views/NewChatStage';
import { AddRemoteAgent } from './crew/AddRemoteAgent';
import { HistoryOverlay } from './shell/HistoryOverlay';
import { anchorPoint, watchAnchors } from './ui/anchor';
import { LinkChoiceHost } from './ui/LinkChoice';
import { clampNavW, NAV_W_DEFAULT, NAV_W_MAX, NAV_W_MIN, useLayoutPrefs } from './shell/useLayoutPrefs';
import { useWorkspaceTabs } from './wtabs/useWorkspaceTabs';

// apply the persisted theme before first paint (module load runs before React mounts)
applyTheme(resolveTheme(loadThemePref()));






// auto-update: live lifecycle from the main process (electron-updater). Polls the
// current state on mount so a card mounting after the first event still reflects it.
function useUpdate(): UpdateState {
  const [s, setS] = useState<UpdateState>({ phase: 'idle' });
  useEffect(() => {
    if (!nm?.onUpdate) return;
    void nm.updateState?.().then(setS).catch(() => {});
    return nm.onUpdate(setS);
  }, []);
  return s;
}

const BOARD_STATES = ['backlog', 'todo', 'designing', 'design_review', 'planning', 'plan_review', 'in_progress', 'blocked', 'in_review', 'done', 'shipping', 'ship_review', 'releasing', 'verifying', 'accepted'] as const;
const withBlocked = (_tasks: TaskRow[]): string[] => [...BOARD_STATES];

// Marketing rooms wear the content lifecycle over the SAME states (marketing-workflow
// plan §4.2) — a label lens, no new FSM. The engineering-only legs (design/plan/ship) drop out.
const MK_STATE_LABEL: Record<string, string> = { backlog: 'ideas', todo: 'queued', in_progress: 'drafting', in_review: 'review', done: 'reviewed', accepted: 'approved', blocked: 'blocked', closed: 'closed' };
const MK_BOARD_STATES = ['backlog', 'todo', 'in_progress', 'blocked', 'in_review', 'done', 'accepted'] as const;

// The work-type label (docs/16) — a small, low-noise chip beside the state chip. A routing
// PRIOR, never a gate: it just names what the task IS (bug/feature/…). Outlined + lowercase so
// it reads as metadata, distinct from the filled uppercase state chip; nothing when unlabeled.
/** Completion, not presence: per-step writes (setupflows.ts) make `marketing` non-null from
 * the FIRST wizard answer, so every "is the HQ set up" gate must read setup_at via
 * setupProgress — a presence check flips surfaces mid-wizard. */
const marketingReady = (marketing: string | null | undefined): boolean =>
  setupProgress(MARKETING_SETUP_FLOW, marketing ?? null).complete;


// ── Automations › Calendar (2026-08-13) ───────────────────────────────────────────────────────
// THE TIME VIEW OF EVERYTHING SCHEDULED — its sibling tab is the inventory (what is armed), this
// is when it all actually happens. Two lanes: automations firing, and posts publishing.
//
// It began as the marketing room's Calendar tab: gated on `kind='marketing'` AND a finished setup
// flow, querying ONE channel. So "what is my workspace publishing this week" could not be asked,
// and in every other room the surface did not exist — the Files `promoted = 1` ruling again, a
// predicate that reads as absence. Here the narrowing is the ScopeBar, visible and reversible;
// the room tab stays where it is, exactly as Tasks is both a room tab and a workspace destination.
//
// Automations share the grid because they are the same KIND of fact (George, mid-round): a thing
// that will happen on a clock without you. Showing only the social half made the calendar a
// marketing surface parked under a section whose other half it ignored. Their occurrences are
// PROJECTED through `nextScheduleRun` — the shared, tz-and-DST-correct helper the server and the
// daemon both compute next_run_at with — rather than re-derived from cadence here, because a
// second implementation of when-does-this-fire is exactly how a calendar starts lying.
//
// Three things the workspace scope forces, none of which the room-scoped grid needed:
//  · an UNSCHEDULED rail. A draft with no slot used to be drawn on the day it was CREATED, a cell
//    asserting something will happen when nothing will. It is also the question this surface is
//    for: your agents wrote these and they are going nowhere.
//  · the ROOM on each chip, at All scope (.routineroom, the tag the sibling tab already uses).
//  · an IMAGE DOT — the one thing a text chip cannot say is that a post will publish naked.





// the task peek's clamp (2026-08-10) — the split stage's second tenant sizes like the first:
// a machine-local width, clamped so neither column can be starved into unreadability
const PEEK_W_MIN = 300;
const PEEK_W_MAX = 620;
const PEEK_W_DEFAULT = 380;
const clampPeekW = (w: number) => Math.max(PEEK_W_MIN, Math.min(PEEK_W_MAX, Math.round(w)));


// The "@agent is typing…" status chip shown above a composer. It opens that agent's activity
// log on click — but the click was previously undiscoverable (only a cursor + tooltip hinted it).
// The trailing "view activity ›" cue makes the affordance visible. One component, three call sites.
// Composer context chip — the active project where you type, one click to switch or
// create. Mirrors the top-left switcher's state + plan gating exactly (no new
// semantics; switching re-scopes chat the same way). Lives on the .cfoot row under
// the input box so the typing area never shifts.
// The docs/20 threads-mode chip is GONE (docs/35 §6), and so is the docs/34 Tasks toggle
// (§14, 2026-07-29): the orchestrator triages every send and decides what becomes a task, so
// the composer keeps ONE knob — the room chip (where it lands). threads.mode survives as the
// enforcement floor; every new thread births 'tasks'.

// where the shell is pointed. `nav` picks the destination; inside a room, `view` picks which of
// the room's own surfaces is up (and `roomView`, in turn, which tab).
//
// `board` and `automations` came back as views (2026-08-03). v0.63 made the board a room
// surface to stop it re-asking which room it meant — the nav head's channel scope answers that
// question once for every surface, so both read the scope instead of owning a copy of the
// question. At `All channels` they span the active project; picking a room narrows them.
export type NavDest = 'home' | 'projects' | 'artifacts' | 'agents' | 'logs' | 'retro';
/**
 * The views that are WORKSPACE SURFACES rather than a room you are standing in — and so name the
 * conversation tab themselves. `chat` is absent on purpose: that one really is a room. `code` is
 * absent because it opens as its own editor tab, never in slot 0.
 * `newchat` retired 2026-08-16: it split from `dashboard` in the shell round and merged back the
 * other way — the composer is the landing, Home's briefing is the bell, and one key is one surface.
 */
const SURFACE_TABS: Partial<Record<MainView, string>> = {
  // Home and New chat merged back into one landing (2026-08-16) — the composer IS the landing,
  // and Home's briefing became the bell. `dashboard` keeps the key: it is also the state a thread
  // or a task mounts OVER, so renaming it would touch every session route for a label.
  dashboard: 'New chat',
  board: 'Tasks',
  whiteboards: 'Whiteboards',
  // "Scheduled" is a LABEL rename of Automations (2026-08-16, George) — the view keys, ids,
  // routes, and every doc keep `automations`/`calendar`, exactly the Board → Tasks precedent.
  automations: 'Routines',
  // its own tab name, not the section's: the section is where it HANGS, not what it is
  calendar: 'Content calendar',
  compute: 'Compute',
  skills: 'Skills',
  memory: 'Memory',
  footprint: "Agents' footprint", // machine-scoped — a #channel-slug fallback title would be a lie
  credits: 'Credits', // workspace-scoped billing read — a room slug on its tab would be a lie
  marketing: 'Marketing OS',
  engineering: 'Code',
};

export function App() {
  const [themePref, setThemePref] = useState<ThemePref>(loadThemePref);
  const [theme, setTheme] = useState<ThemeId>(() => resolveTheme(loadThemePref()));
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false); // Move to Cloud (U7): the This Mac card and the foot open it through lib/toast.ts
  const [upgradeReason, setUpgradeReason] = useState<string | null>(null); // contextual copy when a server PLAN_LIMIT routes here
  const [machineLimit, setMachineLimit] = useState<{ message: string } | null>(null); // Free 2nd-machine transfer-or-upgrade card (P1b)
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const { toast, dismiss: dismissToast } = useToast();
  // Plan gating — `plan` is the server-truth (workspaces.plan, written by the Stripe webhook),
  // fetched via workspaceSettings; isCloud derives from it and is the SINGLE source of truth for
  // every Local↔Cloud surface. Fail closed to 'free' until the fetch resolves so Cloud features
  // never flash for a free workspace; refetched on window focus so returning from Stripe checkout
  // (which happens in the external browser) flips the gates live.
  // '' until the fetch resolves: Cloud features never flash for a free workspace, and the hosted gate
  // never flashes for a Pro one (shell/hostedgate.ts gates on `free`, not on "not cloud")
  const [plan, setPlan] = useState<string>('');
  const isCloud = plan === 'cloud';
  const openUpgrade = useCallback((reason: string) => { setUpgradeReason(reason); setUpgradeOpen(true); }, []);
  const [focusTab, setFocusTab] = useState<'connections' | null>(null); // Settings opened on a named tab (Connections has its own door)
  const atts = useAttachments(plan, openUpgrade);
  const composerDrop = useDropZone(atts.addFiles);
  const onComposerPaste = (e: React.ClipboardEvent) => { const fs = filesFromPaste(e); if (fs.length) { e.preventDefault(); atts.addFiles(fs); } };
  // a file dropped anywhere outside a composer drop-zone would otherwise make Electron navigate to it
  useEffect(() => {
    const prevent = (e: DragEvent) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault(); };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => { window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent); };
  }, []);
  useEffect(() => {
    const loadPlan = () => { void nm?.workspaceSettings().then((s) => setPlan(s.plan ?? 'free')).catch(() => {}); };
    loadPlan();
    window.addEventListener('focus', loadPlan);
    return () => window.removeEventListener('focus', loadPlan);
  }, []);
  // Home is the startup view (founder call 2026-07-17, superseding the 07-02 Threads
  // decision): boot lands on the composer with everything that needs you directly
  // beneath it. Notification arrivals still deep-link straight to their thread.
  const [view, setView] = useState<MainView>(() => viewFromUrl() ?? 'dashboard');
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [packs, setPacks] = useState<SkillPackRow[]>([]);
  const [nav, setNav] = useState<NavDest>('home');
  // Mission Control's "while you were away" anchor: the last activity stamp before
  // a ≥30min gap. Rotating at mount (not only on quit) means an app left open
  // overnight still tells the morning story; a focused-only heartbeat keeps `last`
  // honest while the user is actually here.
  const [homeSeen] = useState<number>(() => {
    const now = Date.now();
    let prev = now;
    let last = 0;
    try {
      const s = JSON.parse(localStorage.getItem('nm:homeSeen') || '{}') as { prev?: number; last?: number };
      prev = s.prev ?? now;
      last = s.last ?? 0;
    } catch { /* first run */ }
    const anchor = last && now - last > 30 * 60_000 ? last : Math.min(prev, now);
    localStorage.setItem('nm:homeSeen', JSON.stringify({ prev: anchor, last: now }));
    return anchor;
  });
  // this launch's start — the away-window's far edge (see HomeView.shipped)
  useEffect(() => {
    const beat = () => {
      try {
        const s = JSON.parse(localStorage.getItem('nm:homeSeen') || '{}') as { prev?: number };
        localStorage.setItem('nm:homeSeen', JSON.stringify({ prev: s.prev ?? homeSeen, last: Date.now() }));
      } catch { /* ignore */ }
    };
    const t = setInterval(() => { if (document.hasFocus()) beat(); }, 60_000);
    window.addEventListener('beforeunload', beat);
    return () => { clearInterval(t); window.removeEventListener('beforeunload', beat); };
  }, [homeSeen]);
  const [logsTask, setLogsTask] = useState<number | null>(null); // deep-link: Activity filtered to one task
  // close any open task thread too — the Activity view renders in the main area, which sits
  // BEHIND the z-55 thread overlay, so leaving the thread open would hide it.
  const viewTaskLogs = (n: number) => { setLogsTask(n); setNav('logs'); setOpenTaskId(null); };
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [tasksAll, setTasksAll] = useState<TaskAllRow[]>([]);
  const [libraryAll, setLibraryAll] = useState<ArtifactUI[]>([]);
  const [attsAll, setAttsAll] = useState<AttachmentRow[]>([]);
  // Workspace Files upload: `uploadTo` is the project awaiting a room choice (the room IS the
  // ACL grant, so it is never inferred silently), `uploading` is the in-flight label.
  const [uploadTo, setUploadTo] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [chans, setChans] = useState<ChannelRow[]>([]);
  // the universal launcher (+ New task ▾): task/backlog/routine into any channel
  const [launcher, setLauncher] = useState<null | { mode: 'task' | 'routine' }>(null);
  const [ftMenuOpen, setFtMenuOpen] = useState(false);
  const [current, setCurrent] = useState<ChannelRow | null>(null);
  // ── the nav head's channel scope (2026-08-03, George) ──────────────────────────────────────
  // `null` = All channels: Home, Board, Automations, Library and Recents all span the active
  // project. Picking a room narrows every one of them in the same gesture — one question asked
  // once, at the head of the column, instead of each surface re-asking which room it means.
  //
  // Deliberately a SECOND piece of state beside `current` rather than a replacement for it.
  // `current` is the room a send, a roster, a brief and the message watch belong to, and it has
  // to stay resolved even at All scope — which is exactly how Home already behaved. Scope says
  // what the surfaces SHOW; `current` says which room the shell is standing in. Collapsing them
  // would mean a null room on Home, and every `current!` in this file becoming a crash.
  const [skillsAll, setSkillsAll] = useState<SkillRow[]>([]);
  // Where each destination is narrowed to, remembered for the session (shell/useScopeMemory.ts).
  // One state instead of nine, and — more to the point — one ANSWER instead of two: Tasks and
  // Skills used to remember their filter because App held it, while Whiteboards, Automations and
  // Calendar forgot theirs because each declared its own.
  const { scopeOf, setScope } = useScopeMemory();
  const boardScope = scopeOf('board');
  const skillScope = scopeOf('skills');
  const [scopeId, setScopeId] = useState<string | null>(null);
  // The board's own filters — see the boardTasks memo. Kept beside the shell's `scopeId` rather
  // than reusing it: the nav head's scope answers "which room is the shell standing in", and the
  // board is no longer a room surface, so borrowing that answer is what hid other projects' work.
  const chatStream = useAgentStream(current ? `${current.id}:` : null);
  // docs/35: the room's own messages — what the brief cards and the legacy pass read. Not a feed
  // any more, so there is no stream bubble, no inline task groups and no per-message actions here.
  const [msgs, setMsgs] = useState<MessageRow[]>([]);
  // a feed doc-card expanded into the shared reader overlay (round 5)
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [draft, setDraft] = useState('');
  // docs/34 — what a send from THIS composer becomes. Sticky per machine, shared with Home's
  // composer (one pref, `nm:composer-tasks`), because it answers the same question in both.
  // An armed reply: the room message this send will ROOT its conversation at (docs/31 —
  // rootMessageId + a client-minted threadId). The `task` arm went with the feed: its only
  // caller was the feed row's Reply action, and a task's thread is a surface you stand IN now,
  // with its own composer, so there is nothing left to arm from out here.
  const [replyTo, setReplyTo] = useState<
    | { kind: 'root'; rootMessageId: string; threadId: string; toName: string; preview: string }
    | null
  >(null);
  const [composerFocus, setComposerFocus] = useState(0); // nonce → focuses the composer textarea
  const [composerMention, setComposerMention] = useState(0); // nonce → types "@" + opens the picker
  // the backlog column's quick-add (the board's scratch input — docs/15). The board is a room
  // surface now, so an idea parked here files into THIS room; the channel picker retired with
  // the project-wide scope that made it ambiguous.
  // `repos` = THIS room's project's (the scoped answer eight surfaces want); `reposAll` = the
  // workspace's, for the two that are about the workspace rather than the room.
  const [meta, setMeta] = useState<{ projects: ProjectRow[]; repos: RepoUI[]; reposAll: RepoUI[] }>({ projects: [], repos: [], reposAll: [] });
  const [chanHistory, setChanHistory] = useState<ChannelHistoryRow[]>([]); // the room's papertrail (0093)
  const [chanPeople, setChanPeople] = useState<ChannelPersonRow[]>([]); // the room's people roster (0094)
  // the Add-repo modal — opened from Workspace settings, the project panel and a task's
  // "attach a repo" prompt (the board never asks for one; it reads work, it does not file it)
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  // the work axis: all workspace projects + the active one (top-left switcher).
  // exactly ONE project is active at a time (default = the workspace default
  // project); the choice is persisted like the theme pref.
  const [wsProjects, setWsProjects] = useState<WorkspaceProjectRow[]>([]);
  const [activeProject, setActiveProjectRaw] = useState<string>(() => localStorage.getItem('nm:activeProject') || '');
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  // where the New project modal pivots from — the composer chip or the switcher's menu row
  const [createProjectOrigin, setCreateProjectOrigin] = useState<{ x: number; y: number } | null>(null);
  const [manageProject, setManageProject] = useState<WorkspaceProjectRow | null>(null);
  // the Projects-page kebab's "Delete project…" opens Project settings straight on the
  // slug-typed confirm (the gate itself is unchanged: archived-first, non-default, human)
  const [manageDelete, setManageDelete] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [manageChannel, setManageChannel] = useState<ChannelRow | null>(null);
  // one-time-per-session dismissal of the "Meet the Marketing HQ" prompt (plan §4.1a) —
  // deliberately NOT persisted: converting or renaming the room ends it forever, and a
  // lightweight session dismiss keeps "Not now" honest without a settings write.
  const [kindPromptSeen, setKindPromptSeen] = useState<Set<string>>(new Set());
  // "Skip for now" on the setup greeting — session-local for the same reason
  const [mkSetupSkipped, setMkSetupSkipped] = useState<Set<string>>(new Set());
  // the room's surface lens (docs/32). Every room carries Feed · Board · History; a set-up
  // marketing HQ adds Calendar · Library. Per-room ephemeral state; a room switch always
  // lands back on the Feed — a room opens on its conversation.
  const [roomView, setRoomView] = useState<RoomSurface>('feed');
  // the Automations badge: standing behaviors IN SCOPE. Polled here (not only while the
  // destination is mounted) because the whole point of promoting Routines out of a count-gated
  // room tab is that an armed schedule is visible from anywhere — a badge that only appears once
  // you visit the page is the same invisibility one click further away. RoutinesView reports the
  // live number through onCount while it is open.
  const [roomRoutines, setRoomRoutines] = useState(0);
  // …and its sibling: posts still coming (draft + scheduled). Same reasoning — the count is the
  // reason to look, so it cannot wait until you are already looking. WorkspaceCalendar reports the
  // live number through onCount while it is open; this poll keeps it true while it is not.
  const [roomContent, setRoomContent] = useState(0);
  const [comingPosts, setComingPosts] = useState<ContentItemWide[]>([]);
  useEffect(() => { setRoomView('feed'); }, [current?.id]);
  // brief loading state right after a project switch — drives room/chat skeletons so nothing stale
  // flashes while the new project's channels + messages resolve. Set synchronously here so the very
  // next render already shows skeletons; cleared by the effect below once content lands.
  const [switching, setSwitching] = useState(false);
  // ── multi-workspace (0113) ────────────────────────────────────────────────────────────────
  // Membership is a set. `wsList` backs the account-menu switcher, `wsInvites` the join cards,
  // and `wsSwitchTarget` holds the workspace the confirm sheet is asking about (switching
  // relaunches the app, so it is never a one-click act).
  const [wsList, setWsList] = useState<WorkspaceMembership[]>([]);
  const [wsInvites, setWsInvites] = useState<PendingInvite[]>([]);
  // …a workspace on ANOTHER connection (U3b) rides the same sheet; `connectionId` names which one
  const [wsSwitchTarget, setWsSwitchTarget] = useState<(WorkspaceMembership & { connectionId?: string }) | null>(null);
  // "you joined X — switch?", held OUTSIDE wsInvites: that list mirrors the server and is
  // re-read every 1.5s by the bootstrap poll, so an accepted invitation vanishes from it almost
  // immediately — which used to take the acknowledgement (and its Switch button) with it
  const [justJoined, setJustJoined] = useState<{ workspaceId: string; workspaceName: string } | null>(null);
  // set when the human chooses "set up my own workspace" over a pending invitation — the only
  // thing that lets the wizard through while an invitation is waiting
  const [declinedFirstRun, setDeclinedFirstRun] = useState(false);
  // ── the nav column's two faces (v0.76 slice 2) ────────────────────────────────────────────
  // `rooms` is the channels + Recents panel; `projects` is the switcher. The spine swaps them.
  //
  // Hover is a SHORTCUT, never the only door: the strip sits along the window edge, where a
  // mouse crosses it on the way to somewhere else constantly, so opening waits out an intent
  // delay and closing keeps a grace window (a diagonal move onto a project row must not dismiss
  // the thing under the cursor). The arrow, a click, and ⌘⇧P all open it outright.
  // ── THE WORKBENCH's width (2026-08-16) — the nav grip's idiom at the frame's OTHER edge.
  // Machine-local like the nav width, the theme and the fold; never synced.
  const WB_W_MIN = 220, WB_W_MAX = 460, WB_W_DEFAULT = 284;
  const [wbW, setWbW] = useState(() => {
    const n = Number(localStorage.getItem('nm:panew'));
    return Number.isFinite(n) && n >= WB_W_MIN && n <= WB_W_MAX ? n : WB_W_DEFAULT;
  });
  const [wbDragging, setWbDragging] = useState(false);
  const setWbWPersist = (n: number) => {
    const c = Math.max(WB_W_MIN, Math.min(WB_W_MAX, Math.round(n)));
    setWbW(c);
    try { localStorage.setItem('nm:panew', String(c)); } catch { /* private mode */ }
  };
  // ── THE SIDE DOCK's width (rail-ink round 3, 2026-09-04) — the same idiom, one seam further out
  const SD_W_MIN = 320, SD_W_MAX = 1100, SD_W_DEFAULT = 460;
  const [sdW, setSdW] = useState(() => { const n = Number(localStorage.getItem('nm:sidedockw')); return Number.isFinite(n) && n >= SD_W_MIN && n <= SD_W_MAX ? n : SD_W_DEFAULT; });
  const [sdDragging, setSdDragging] = useState(false);
  const setSdWPersist = (n: number) => { const c = Math.max(SD_W_MIN, Math.min(SD_W_MAX, Math.round(n))); setSdW(c); try { localStorage.setItem('nm:sidedockw', String(c)); } catch { /* private mode */ } };
  /** a repo picked from the `repos` face: the panel's root when no session supplies one */
  const [wbRoot, setWbRoot] = useState<{ name: string; path: string } | null>(null);
  /** the Details face's portal target. STATE, not a ref: the open task has to re-render when the
   *  slot mounts, and a ref would hand it a stale null on the pass that matters. */
  const [wbSlot, setWbSlot] = useState<HTMLDivElement | null>(null);
  /** the quick disk read, fetched once for the shell — the workspace face's Footprint gauge */
  const footprint = useFootprint();
  // The contract lives in shell/facehover.ts as a reducer, and the timer is just its clock. It
  // was three inline handlers until the foot shipped an infinite flip (2026-08-16) — the sort of
  // bug you cannot tune away, because it came from WHO was allowed to schedule what. The module
  // makes the ownership explicit and src/main/facehover.test.ts holds it there.
  const [faceState, setFaceState] = useState<FaceState>(initialFace);
  const navFace = faceState.face;
  const faceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const face = (e: FaceHoverEvent) => setFaceState((prev) => {
    if (faceTimer.current) { clearTimeout(faceTimer.current); faceTimer.current = null; }
    const next = faceHover(prev, e);
    if (next.pending) faceTimer.current = setTimeout(() => setFaceState((p) => faceHover(p, { type: 'settle' })), next.pending.delay);
    return next;
  });
  const armFace = (open: boolean) => face({ type: open ? 'foot-enter' : 'panel-leave' });
  /** drop a pending arm WITHOUT scheduling its opposite — a hover that changed its mind */
  const cancelArm = () => face({ type: 'panel-enter' });
  const closeFace = useCallback(() => {
    if (faceTimer.current) { clearTimeout(faceTimer.current); faceTimer.current = null; }
    setFaceState(initialFace());
  }, []);
  const toggleFace = () => face({ type: 'click' });
  /** open and pin, never toggle — the foot's avatar means "show me my account", not "flip" */
  useEffect(() => () => { if (faceTimer.current) clearTimeout(faceTimer.current); }, []);
  // The shell's keydown listener binds once per [authed, navFolded, navPos]; reading the face
  // through refs keeps Esc honest without re-binding the whole shortcut map on every hover.
  const navFaceRef = useRef(navFace);
  navFaceRef.current = navFace;
  const closeFaceRef = useRef(closeFace);
  closeFaceRef.current = closeFace;
  const setActiveProject = (id: string) => {
    if (id !== activeProject) setSwitching(true);
    setActiveProjectRaw(id);
    localStorage.setItem('nm:activeProject', id);
  };
  // resolve the active project: the persisted pick, else the workspace default, else the first
  const activeProj =
    wsProjects.find((p) => p.id === activeProject) ?? wsProjects.find((p) => p.is_default) ?? wsProjects[0] ?? null;
  // `current` is a click-time snapshot; synced channel fields (kind, marketing profile) must
  // read from the live poll so the marketing surface flips without re-clicking the room.
  const currentLive = current ? (chans.find((c) => c.id === current.id) ?? current) : null;
  const [note, setNote] = useState('');
  const [connected, setConnected] = useState(false);
  const [syncedOnce, setSyncedOnce] = useState(false);
  const [queuedWrites, setQueuedWrites] = useState(0);
  const [auth, setAuth] = useState<{ mode: 'dev' | 'supabase' | 'clerk' | 'local'; user: { id: string; email: string } | null } | null>(null);
  const [boot, setBoot] = useState<{ needsOnboarding: boolean; resumeWorkspaceId?: string; machineName: string; workspace: { name: string; slug: string }; workspaceId?: string; workspaces?: WorkspaceMembership[]; invites?: PendingInvite[]; connection?: ConnectionInfo; resolving?: boolean } | null>(null);
  /** the connection the shell stands in (main/connections.ts) — the rail's `.on` band, the foot's glyph */
  const fgConnId = boot?.connection?.id ?? null;
  // the boot gates (shell/useBootGates.ts): the first-run doors, then Local mode's stack card
  const { firstRun, setFirstRun, doorDone, localStack, setLocalStack } = useBootGates(auth?.mode);
  const engineeringNav = useEngineeringNavigation(boot?.workspaceId, view === 'engineering');
  // Why the splash is still up. bootstrap() is polled every 1.5s and its rejection used to be
  // swallowed (`.catch(() => {})`), so an unreachable API meant an infinite silent retry behind
  // "Getting your workspace ready…" with nothing to act on — the whole app looked hung. Counting
  // the failures lets the splash say what is wrong once it is clear this is not just slow.
  const [bootStall, setBootStall] = useState<{ tries: number; reason: string } | null>(null);
  // auto-update card (bottom-left). Dismiss hides it for this session, keyed by
  // phase+version so a newer release or a phase change re-surfaces it.
  const update = useUpdate();
  const [updateHidden, setUpdateHidden] = useState<string | null>(null);
  const updKey = updateKey(update);
  const showUpdate = updateVisible(update, updateHidden);
  // Once the onboarding wizard is showing, latch it: the wizard itself creates the workspace
  // mid-flow (step 5), so without this the 1.5s bootstrap poll would see the fresh workspace,
  // flip needsOnboarding→false, and yank the user out before the fan-out reveal + onDone.
  const [onboardingActive, setOnboardingActive] = useState(false);
  // unified nav: dock position (left default · top · right) — persisted like the theme/project pref.
  const [navPos, setNavPos] = useState<'left' | 'top' | 'right'>(() => {
    try { const v = localStorage.getItem('nm:navPos'); return v === 'top' || v === 'right' ? v : 'left'; } catch { return 'left'; }
  });
  const setNavPosPersist = (p: 'left' | 'top' | 'right') => { setNavPos(p); try { localStorage.setItem('nm:navPos', p); } catch { /* private */ } };
  // …and folded or open (side docks only — the top dock IS a row, there is nothing to fold).
  // A machine-local preference like the theme and the brand rail's own collapse, never synced.
  const [navFolded, setNavFolded] = useState(() => { try { return localStorage.getItem('nm:navFolded') === '1'; } catch { return false; } });
  const foldNav = (v: boolean) => { setNavFolded(v); try { localStorage.setItem('nm:navFolded', v ? '1' : '0'); } catch { /* private */ } };
  const navIsFolded = navFolded && navPos !== 'top';
  // THE RAIL'S MODE (rail-ink round, 2026-09-04 — the Chat | Code switch under the head, Gemini's
  // Chat | Spark shape): the one place the rail changes what it lists, never its anatomy. Code
  // relists to repo-backed work (navtree.isCodeRow) with the branch as each row's fact, and the
  // band shows code's nouns. Persisted like the fold; never a destination tab strip (docs/33 §8).
  const [navMode, setNavMode] = useState<'chat' | 'code'>(() => { try { return localStorage.getItem('nm:navMode') === 'code' ? 'code' : 'chat'; } catch { return 'chat'; } });
  // switching the mode also takes you there (Gemini's Chat | Spark): Code opens the Engineering
  // floor (#391), Chat brings you home from it — a mode is a place, not a filter you toggle blind
  const setRailMode = (m: 'chat' | 'code') => {
    setNavMode(m); try { localStorage.setItem('nm:navMode', m); } catch { /* private mode */ }
    if (m === 'code') goConversation(() => { setNav('home'); setOpenTaskId(null); setOpenThreadId(null); setView('engineering'); });
    else if (view === 'engineering') goConversation(() => { setNav('home'); setView('dashboard'); });
  };
  // RECENTS · PROJECTS (the nav-recents round, 2026-09-12): the rail's grouping is a machine-local preference like the mode
  const [navView, setNavView] = useState<'recents' | 'projects'>(() => { try { return localStorage.getItem('nm:navView') === 'recents' ? 'recents' : 'projects'; } catch { return 'projects'; } });
  const setRailView = (v: 'recents' | 'projects') => { setNavView(v); try { localStorage.setItem('nm:navView', v); } catch { /* private mode */ } };
  // folding the rail away takes the projects face with it — there is no column left to show it in
  useEffect(() => { if (navIsFolded && navFace === 'projects') closeFace(); }, [navIsFolded, navFace, closeFace]);
  // collapsible nav sections (side dock) — keyed by section; absent/false = expanded (default). Persisted.
  const [navSec, setNavSec] = useState<Record<string, boolean>>(() => {
    // Scheduled opens FOLDED on a fresh machine (George, 2026-09-12); a fold the human changed is theirs and wins
    try { return { [SCHEDULED_SEC]: true, ...JSON.parse(localStorage.getItem('nm:navSec') || '{}') }; } catch { return { [SCHEDULED_SEC]: true }; }
  });
  const toggleSec = (k: string) => setNavSec((s) => { const n = { ...s, [k]: !s[k] }; try { localStorage.setItem('nm:navSec', JSON.stringify(n)); } catch { /* private */ } return n; });
  // side-dock workspace nav compresses to 4 primary items + an expandable "More" group
  const [moreOpen, setMoreOpen] = useState(false);
  // docs/35 §11 — a session is a SURFACE SWAP, not a sheet flight, so both closers are one
  // beat. The two-beat `closing` states existed to keep a sheet mounted while it slid out;
  // there is no slide to wait for, and a 200ms wait on a surface swap is a 200ms budget miss.
  const closeThread = useCallback(() => setOpenTaskId(null), []);
  // conversation threads (v0.40): every send starts one. When its thread row links a task (the
  // orchestrator fanned it out), the surface swaps to the task panel in place.
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  // docs/31: root message id → its thread's reply tally. The reply footer went with the feed;
  // this is what makes a second reply to the same room message JOIN its conversation instead of
  // forking a new one (see replyAtRoot).
  const [replyCounts, setReplyCounts] = useState<Map<string, { threadId: string; n: number; lastAt: string }>>(new Map());
  const closeConvo = useCallback(() => setOpenThreadId(null), []);
  // the active channel's history (threads, freshest first) — feeds the History surface,
  // the unread badge, and the open conversation's upgrade swap
  const [chanThreads, setChanThreads] = useState<ThreadRow[]>([]);
  const [histQ, setHistQ] = useState('');
  // the overlay's project narrowing — reset on close alongside the query, so "Search every
  // thread…" always means it. A filter that outlives the surface it was set on is a search
  // silently lying about its scope the next time you open it.
  const [histProj, setHistProj] = useState<string | null>(null);
  // status is the first filter on the overlay (the thread-status round, 2026-09-08)
  const [histStatus, setHistStatus] = useState<ThreadStatus | null>(null);
  // History at two scales (v0.69): the rail's resting list and its expanded overlay share one
  // query, so typing in the rail and pressing ⏎ continues the search instead of restarting it.
  const [histOpen, setHistOpen] = useState(false);
  const [histAll, setHistAll] = useState<HistoryThreadRow[]>([]);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  // "new since I last opened history" — per-channel watermark, localStorage-persisted
  const [histSeen, setHistSeen] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('nm:histSeen') || '{}'); } catch { return {}; }
  });
  const markHistSeen = (chId: string) => setHistSeen((s) => {
    const n = { ...s, [chId]: new Date().toISOString() };
    try { localStorage.setItem('nm:histSeen', JSON.stringify(n)); } catch { /* private */ }
    return n;
  });
  const { activateWTab, closeWTab, openDefaultTerminal, openTermTab, openWPane, openWTab, patchWTab, setTabPty, setWTabDirty, setWTabMode, setWactive, setWfind, setWrbusy, setWrcomments, setWrerr, setWrevs, setWrmodes, setWtabs, subIdToTab, uniqueTitle, wactive, wactiveRef, wdocs, wfind, wpane, wrbusy, wrcomments, wrerr, wrevs, wrmodes, wstartup, wtabs, wtabsRef, dockOpen, openDock } = useWorkspaceTabs(meta);
  /** a workspace file, by absolute path — every doorway (the pane, ⌘P, a deliverable card, an agent's #ref) converges here */
  const dockOpenRef = useRef(dockOpen); dockOpenRef.current = dockOpen;
  /** ⌘1: the composer in front of you — the thread's box, else Home's (the conversation is never hidden) */
  const focusComposer = () => { setHomeCompose((n) => n + 1); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.tcompose textarea, .convcompose textarea')?.focus()); };
  const openFileTab = (root: string, rel: string) => {
    const path = rel ? `${root.replace(/[/\\]$/, '')}/${rel}` : root;
    openWTab({ id: crypto.randomUUID(), kind: 'file', title: rel ? rel.split('/').pop()! : root.split('/').pop() || root, subtitle: rel || null, path, root, mode: 'edit' });
  };
  // `openEditorTab` retired 2026-08-16 — a file tab with no path was a THIRD file tree (the
  // Workbench's, the old EditorView's, and this). The Workbench is the tree; a click in it opens
  // a real file tab, which is what a reader actually wanted from "Editor".
  /** an agent's deliverable: read-only by capability, not by a button the UI declines to draw */
  const openArtifactTab = (a: { id: string; kind: string; name: string; content: string }, task?: { id: string; number: number } | null) => {
    openWTab(
      { id: crypto.randomUUID(), kind: 'file', title: a.name, subtitle: task ? `#${task.number}` : null, path: null, artifactId: a.id, readOnly: true, taskNumber: task?.number ?? null, mode: 'preview' },
      { name: a.name, content: a.content, taskId: task?.id ?? null, taskNumber: task?.number ?? null },
    );
  };
  const openBrowserTab = (url?: string) => openWTab({ id: crypto.randomUUID(), kind: 'browser', title: uniqueTitle('Browser'), url: url ?? null });
  // a board opens by its row id — reuse keys on whiteboardId, so one board is one tab (docs/38)
  const openWhiteboardTab = (board: { id: string; title: string }) =>
    openWTab({ id: crypto.randomUUID(), kind: 'whiteboard', title: board.title, whiteboardId: board.id });
  // the ＋ flyout's Create → New whiteboard: filed to the scope's room (the chip in its header
  // names the filing), else the room you're in, else the project's first room — one decision,
  // made visibly, never a picker before you may draw
  const newWhiteboard = async () => {
    const ch = scopeChan ?? current ?? chans[0];
    if (!nm?.wbCreate || !ch) return;
    const { id } = await nm.wbCreate(ch.id, {});
    openWhiteboardTab({ id, title: 'Untitled board' });
  };
  // Share to chat (docs/38, amended live 2026-08-05): STAGE, never post. The board lands on the
  // composer as a pill; the human writes their line and one send carries note + marker. Jumping
  // to tab 0 puts the pill in front of them — whichever composer is active shows it, because the
  // staging store is global and the pill rides the shared AttachButton.
  const shareWhiteboard = (row: { id: string; title: string }) => {
    setWbAttach({ id: row.id, title: row.title });
    // Land where the pill is (the live bug: tab 0 still rendered the Whiteboards destination —
    // a surface with no composer, so staging read as "nothing happened"). An open conversation
    // keeps the share; otherwise the chat home takes it, composer focused either way.
    const hasThread = !!openThreadId || !!openTaskId;
    goConversation(() => {
      if (!hasThread) { setOpenTaskId(null); setOpenThreadId(null); openWorkspaceHome(); }
    }, { focus: hasThread ? 'thread' : 'home' });
  };
  /**
   * A round that lands while you are reading the previous one must take the gate away from it.
   *
   * The task's STATE is read live (see `reviewSubject`), but its ROUNDS are artifact rows the
   * renderer does not hold, so they are captured when the tab opens — and a v4 arriving while v3's
   * tab is open would otherwise leave Approve on a superseded round, which is precisely the
   * failure the superseded posture exists to prevent. Proven live: requesting changes woke the
   * architect, which published `implementation-plan-v4.md` while v3 sat open in a tab.
   *
   * The task row's `updated_at` is the signal — every artifact an agent publishes touches it — so
   * this re-reads only when something on that task actually moved.
   */
  const revTasks = Object.values(wrevs).map((r) => r.taskId);
  const revStamp = [...new Set(revTasks)].map((id) => `${id}:${tasksAll.find((t) => t.id === id)?.updated_at ?? ''}`).sort().join('|');
  useEffect(() => {
    const ids = [...new Set(Object.values(wrevs).map((r) => r.taskId))];
    if (!ids.length) return;
    let live = true;
    void Promise.all(ids.map(async (taskId) => {
      const d = await nm?.taskDetail(taskId).catch(() => null);
      const arts = (d?.artifacts ?? []) as Array<{ id: string; name: string; content?: string | null }>;
      if (!live || !arts.length) return;
      const rounds: ReviewRound[] = arts.map((a) => ({ name: a.name, content: a.content ?? '' }));
      setWrevs((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [artId, rev] of Object.entries(prev)) {
          if (rev.taskId !== taskId) continue;
          // the artifact's own bytes too: an agent may rewrite a round in place
          const mine = arts.find((a) => a.id === artId);
          const content = mine?.content ?? rev.artifact.content;
          if (JSON.stringify(rev.rounds) === JSON.stringify(rounds) && content === rev.artifact.content) continue;
          next[artId] = { ...rev, rounds, artifact: { ...rev.artifact, content } };
          changed = true;
        }
        return changed ? next : prev;
      });
    }));
    return () => { live = false; };
  }, [revStamp]);
  /**
   * What the task can tell the gate. Read from the LIVE synced row every time it is asked, never
   * captured at open time — the state is the whole difference between a live verdict and a record.
   */
  const reviewSubject = (task: { id: string; number: number }, rounds: ReviewRound[]): ReviewSubject => {
    const row = tasksAll.find((x) => x.id === task.id);
    let approvedAt: string | null = null;
    try { approvedAt = row?.ship_plan ? (JSON.parse(row.ship_plan) as ShipPlan).approvedAt ?? null : null; } catch { approvedAt = null; }
    return { taskNumber: task.number, taskState: row?.state ?? null, rounds, approvedAt };
  };
  /**
   * Spend a verdict. `say` posts to the thread (the packet, or the plan card's exact answer line);
   * `command` is the audited transition. RULING 1: a spent verdict CLOSES the tab and hands the
   * surface back to the conversation — the tab existed for a decision that no longer needs making.
   */
  const spendVerdict = async (tabId: string, artifactId: string, v: ReviewVerdict, binding: ReviewBinding, comments: ReviewComment[], blocks: string[]) => {
    const rev = wrevs[artifactId];
    if (!rev || wrbusy) return;
    setWrbusy(artifactId);
    setWrerr((e) => ({ ...e, [artifactId]: '' }));
    const packet = reviewPacket(binding, comments, blocks);
    const say = v.say === 'packet' ? packet : v.say;
    try {
      if (say) await nm?.sendThread(rev.taskId, rev.channelId, say);
      if (v.command) await nm?.taskAction(v.command, rev.taskId, v.say === 'packet' ? packet : undefined);
      if (v.closes) {
        closeWTab(tabId);
        // back to the conversation the verdict was announced in, not to whichever sibling tab
        // happened to be next in the strip
        const conv = wtabsRef.current.find((t) => t.kind === 'conversation');
        if (conv) activateWTab(conv.id);
      }
    } catch (e) {
      setWrerr((er) => ({ ...er, [artifactId]: errMsg(e).slice(0, 120) }));
    } finally {
      setWrbusy(null);
    }
  };
  /** an artifact under a live or settled gate — the review tab (docs/36 §13), never a plain viewer */
  const openReviewTab = (a: { id: string; kind: string; name: string; content: string }, rounds: ReviewRound[], task: { id: string; number: number; channel_id: string }) => {
    const id = crypto.randomUUID();
    openWTab({ id, kind: 'review', title: a.name, subtitle: `#${task.number}`, artifactId: a.id, readOnly: true, taskNumber: task.number });
    setWrevs((r) => ({
      ...r,
      // keyed by ARTIFACT, not by tab id: the reuse rule may have handed us a tab that is already
      // open, and its half-written batch (ruling 4) must survive being re-opened onto
      [a.id]: { artifact: { id: a.id, name: a.name, content: a.content, kind: a.kind }, rounds, taskId: task.id, channelId: task.channel_id, taskNumber: task.number },
    }));
  };
  /**
   * The task thread's own doorway, where `ArtifactPreview` and `PlanReview` both used to open.
   *
   * ONE door that asks what the artifact IS: a plan, a release plan or a design round binds to a
   * gate and opens as a review tab; everything else is a deliverable and opens as a read-only file
   * tab. Deciding here rather than at each call site is what keeps a single door — the duplication
   * ruling 3 deleted the overlay for was two doors to one review, and adding a second opener would
   * have re-created it in a new place.
   */
  const openTaskArtifact = async (task: { id: string; number: number; channel_id: string }, name?: string | null) => {
    const d = await nm?.taskDetail(task.id).catch(() => null);
    const arts = (d?.artifacts ?? []) as Array<{ id: string; kind: string; name: string; content?: string | null }>;
    if (!arts.length) return;
    const rounds: ReviewRound[] = arts.map((a) => ({ name: a.name, content: a.content ?? '' }));
    // headline the most visual deliverable when the caller named none — the overlay's own rank —
    // except that anything actually AWAITING A DECISION outranks it: the thing the human is being
    // asked about is what they meant by "open the artifacts"
    const rank = { html: 0, image: 1, diff: 2, markdown: 3, raw: 4 } as const;
    const live = arts.find((a) => bindReview({ name: a.name, content: a.content ?? '', kind: a.kind }, reviewSubject(task, rounds))?.gate.state === 'open');
    const pick = (name && arts.find((a) => a.name === name))
      ?? live
      ?? [...arts].sort((x, y) => rank[previewType(x.name, x.kind, x.content ?? '')] - rank[previewType(y.name, y.kind, y.content ?? '')])[0];
    if (!pick) return;
    const one = { id: pick.id, kind: pick.kind, name: pick.name, content: pick.content ?? '' };
    if (reviewKind(one.name, one.kind)) openReviewTab(one, rounds, task);
    else openArtifactTab(one, task);
  };
  /** an article deliverable: the reading tab (article round) — one artifact = one tab (wtabs dedupe) */
  const openArticleTab = (a: { id: string; name: string; content: string; channelSlug: string | null }) =>
    openWTab({ id: crypto.randomUUID(), kind: 'file', title: a.name.replace(/\.(md|markdown)$/i, ''), subtitle: a.channelSlug ? `#${a.channelSlug}` : 'article', path: null, artifactId: `article:${a.id}`, readOnly: true, mode: 'preview' }, { name: a.name, content: a.content });
  /** a plan, a ship plan or a brief: a FILE, so it opens as a tab and stays open while you type */
  const openDocTab = (d: { label: string; file: string; doc: string }) =>
    openWTab(
      { id: crypto.randomUUID(), kind: 'file', title: d.file, subtitle: d.label, path: null, artifactId: `doc:${d.file}`, readOnly: true, mode: 'preview' },
      { name: d.file, content: d.doc },
    );
  // the frame band's kind buttons: focus the most recent tab of that kind, else make one
  // `'file'` retired 2026-08-16: it opened an EDITOR tab — a second copy of the Workbench's own
  // file tree, in the main area. Its glyph now toggles the Workbench, which is the one tree.
  const openKindTab = (kind: 'terminal' | 'browser') => {
    const match = [...wtabs].reverse().find((x) => x.kind === kind);
    if (match) { activateWTab(match.id); return; }
    if (kind === 'terminal') { openDefaultTerminal(); return; }
    openBrowserTab();
  };
  useEffect(() => {
    const open = (event: Event) => {
      const launch = (event as CustomEvent<ClaudeDesignLaunch>).detail;
      openTermTab({
        cwdRoot: launch.cwd,
        title: launch.taskNumber == null ? 'Claude Design' : `Claude Design #${launch.taskNumber}`,
        startupCommand: launch.command,
      });
    };
    window.addEventListener(CLAUDE_DESIGN_TERMINAL_EVENT, open);
    return () => window.removeEventListener(CLAUDE_DESIGN_TERMINAL_EVENT, open);
  }, [wtabs]);
  // background-processes tracker: live count of agent runs + open terminals, refreshed on any change
  const [procs, setProcs] = useState<ProcList>({ agents: [], terminals: [] });
  const [procOpen, setProcOpen] = useState(false);
  useEffect(() => {
    if (!nm || !auth) return;
    const refresh = () => { void nm.processList().then(setProcs).catch(() => { /* mock / no backend */ }); };
    refresh();
    // the watch pushes instant updates; a slow poll is the safety net that also survives the
    // cold-boot race (the nm:process-* handlers register late in startSync, after auth resolves)
    const un = nm.watchProcesses(refresh);
    const poll = window.setInterval(refresh, 3000);
    return () => { un(); window.clearInterval(poll); };
  }, [auth]);
  const procCount = procs.agents.length + procs.terminals.length;
  // name each live terminal by its workspace tab (so the tracker matches the strip); route Close
  // through the tab (unmounting the terminal → kills the pty), falling back to a raw kill if gone
  const procsView: ProcList = { agents: procs.agents, terminals: procs.terminals.map((t) => ({ ...t, title: wtabs.find((x) => x.id === subIdToTab[t.subId])?.title || t.title })) };
  const onKillProc = (kind: 'agent' | 'terminal', id: string) => {
    if (kind === 'terminal') { const tabId = subIdToTab[id]; if (tabId && wtabs.some((x) => x.id === tabId)) { closeWTab(tabId); return; } }
    void nm?.processKill(kind, id);
  };
  const [acctOpen, setAcctOpen] = useState(false); // account flyout (nav header)
  const [createOpen, setCreateOpen] = useState(false);
  const [addRemoteOpen, setAddRemoteOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false); // People-header "+" — invite (or the free-plan gate)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  // ── THE TASK PEEK (2026-08-10 — docs/33 §8's split stage, second tenant) ────────────────────
  // A `#N` clicked INSIDE a conversation docks the task beside it instead of replacing it: you
  // were mid-something, and the thread you were reading is the context the task needs. Opening
  // the same task from Home, Recents, ⌘K or the board still takes the whole surface — there,
  // picking work IS the switch. Provenance decides the shape (openTaskFrom below).
  const [peekTaskId, setPeekTaskId] = useState<string | null>(null);
  // The Workbench follows the TASK (2026-08-26, George — narrowed from every session,
  // 2026-08-17): a task opening still slides it out (progress in view); a CHAT opening leaves it
  // wherever your toggle put it — every new conversation used to pop the panel open, which made
  // closing it a per-chat chore. It still slides closed when a task peek docks (the peek needs
  // the width), and the toggle — beside the bell — wins from there until the next change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (openTaskId) openWPane(true); }, [openTaskId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (peekTaskId) openWPane(false); }, [peekTaskId]);
  const [peekW, setPeekW] = useState<number>(() => {
    try { const v = Number(localStorage.getItem('nm:peekw')); return Number.isFinite(v) && v > 0 ? clampPeekW(v) : PEEK_W_DEFAULT; }
    catch { return PEEK_W_DEFAULT; }
  });
  const [peekDragging, setPeekDragging] = useState(false);
  const closePeek = useCallback(() => setPeekTaskId(null), []);
  // the shell's key handler is bound once (it must not re-bind per keystroke), so it reads the
  // peek through refs — the same pattern the nav face uses two hooks up
  const peekOpenRef = useRef(false);
  peekOpenRef.current = !!peekTaskId;
  const closePeekRef = useRef(closePeek);
  closePeekRef.current = closePeek;
  /** the PEEK door — every thread renderer's task refs come through here */
  const peekTask = useCallback((id: string) => {
    // a ref to the task you are already standing in is a no-op, not a peek of itself
    setOpenTaskId((cur) => { if (cur !== id) setPeekTaskId(id); return cur; });
  }, []);
  // null = unresolved; resolved from the replica (any human message = welcomed)
  const [welcomed, setWelcomed] = useState<boolean | null>(null);
  const [msgsReady, setMsgsReady] = useState(false);
  const [decisionsAll, setDecisionsAll] = useState<DecisionAllRow[]>([]);
  const [failover, setFailover] = useState<FailoverRow | null>(null);
  // dismissing the fly-up hushes it for this decision only — the card stays open in the
  // room feed (the durable record), and a NEW cap (a fresh decision_id) re-surfaces it
  const [dismissedFo, setDismissedFo] = useState<Set<string>>(() => new Set());
  const flyupOn = failover && !dismissedFo.has(failover.decision_id) ? failover : null;
  const [cmdkOpen, setCmdkOpen] = useState(false); // ⌘K quick-actions palette (docs/12 slice 3)
  // The overlay holds an agent's ID, never a SNAPSHOT of its row. It used to hold the row, so
  // every save wrote to the server, the roster synced — and the modal kept rendering the values
  // it opened with. "Switch @rex to Claude Sonnet 5" appeared to do nothing: the write landed,
  // but `modelDirty` compared the new pick against the stale snapshot, so the button never
  // cleared and the human saw a no-op (founder report). Description and instructions had the
  // same bug, one step quieter — the box simply kept showing the old text after a successful
  // save. Deriving from the live roster makes the modal a VIEW of synced state, so a save
  // confirms itself and a change made on another machine lands here too.
  const [detailAgentId, setDetailAgentId] = useState<string | null>(null);
  // the rail's Agents "+" — a channel-scoped add/remove picker. Hiring from its empty state
  // carries the query into CreateAgent, so "search, find nobody, hire" is one flow.
  const [addAgentsOpen, setAddAgentsOpen] = useState(false);
  const [addPeopleOpen, setAddPeopleOpen] = useState(false); // the People "+" — room roster picker
  const [peopleTick, setPeopleTick] = useState(0); // bumped after a membership write to re-read
  const [createPrefill, setCreatePrefill] = useState('');
  const [activityAgent, setActivityAgent] = useState<AgentRow | null>(null);
  // a leg row opens the SAME panel focused on that leg's run (docs/29) — the run's agent_id is
  // the seat that leg actually ran on, which is why a fan-out's rows attribute at all now
  const [activityRun, setActivityRun] = useState<string | null>(null);
  const [wsOpen, setWsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // when set, Workspace settings opens scrolled/focused on this provider's auth (the AuthCard's
  // "Use an API key instead" deep-link); cleared when the modal closes.
  const [focusProvider, setFocusProvider] = useState<string | null>(null);
  // when set, Workspace settings opens on the Policy tab (the permission card's "Change in
  // workspace policy" link); cleared when the modal closes.
  const [focusPolicy, setFocusPolicy] = useState(false);
  // first-run guided tour of the rail — shown once per machine, then never again
  const [tourOpen, setTourOpen] = useState(() => { try { return localStorage.getItem('nm:toured') !== '1'; } catch { return false; } });
  const [creds, setCreds] = useState<CredRow[]>([]);
  // the on-card "Connect an image model" opens THIS (the image-key prompt), not Workspace settings —
  // it writes a dedicated <provider>-image credential and never touches how agents sign in
  const [imageConnectOpen, setImageConnectOpen] = useState(false);
  const refreshCreds = () => nm?.credentials().then((r) => setCreds(r.credentials)).catch(() => {});
  // register the AuthCard's "Use an API key instead" deep-link (module-level → no prop threading)
  useEffect(() => {
    setProviderSettingsOpener((provider: string) => { setFocusProvider(provider); setWsOpen(true); void refreshCreds(); });
    setUpgradeOpener(() => { setUpgradeReason(null); setUpgradeOpen(true); }); // the sheet's third door (lib/toast.ts): the foot and Settings › Connections
    setConnectionsSettingsOpener(() => { setFocusTab('connections'); setWsOpen(true); });
    setMoveToCloudOpener(() => setMoveOpen(true));
    setPolicySettingsOpener(() => { setFocusPolicy(true); setWsOpen(true); });
    setImageConnectOpener(() => setImageConnectOpen(true));   setCreditsOpener(() => { setNav('home'); setView('credits'); }); // a video card out of credits (the video rung)
    return () => { setProviderSettingsOpener(null); setPolicySettingsOpener(null); setImageConnectOpener(null); setCreditsOpener(null); setUpgradeOpener(null); setConnectionsSettingsOpener(null); setMoveToCloudOpener(null); };
  }, []);
  const refreshRoster = () => nm?.roster().then(setRoster);
  const [roster, setRoster] = useState<{ machines: MachineRow[]; agents: AgentRow[] }>({ machines: [], agents: [] });
  // who fronts the HQ setup greeting: the room's marketer if one exists, else the orchestrator
  const mkSetupAgent = useMemo(() => {
    const live = roster.agents.filter((a) => !a.retired_at);
    const a = live.find((x) => x.role === 'marketer') ?? live.find((x) => x.role === 'orchestrator');
    return a ? { name: a.name, role: a.role, emoji: a.emoji } : { name: 'rex', role: 'orchestrator', emoji: null };
  }, [roster.agents]);
  // A leg's "view subagent activity" — the same panel, opened on that leg's own run.
  // `openLegActivity` retired with the per-leg "view subagent activity" button: a leg's steps
  // fold open from its own row, so the escalation duplicated the affordance beside it. The full
  // panel is still one click away from the card's "view full activity".
  const openAgentActivity = useCallback((a: AgentRow) => { setActivityRun(null); setActivityAgent(a); }, []);
  const [latestMap, setLatestMap] = useState<Record<string, string>>({});
  const [latestThreadMap, setLatestThreadMap] = useState<Record<string, string>>({});
  // `/` skill picker attachment — steers the orchestrator toward a skill via a body marker
  // (the popup + mention state itself lives inside the shared ComposerInput)
  const [attachedSkill, setAttachedSkill] = useState<{ name: string; pack?: string | null } | null>(null);
  // last-read is keyed by id (channels AND task threads — both are distinct uuids)
  const lastReadRef = useRef<Record<string, string>>(JSON.parse(localStorage.getItem('nm:lastRead') ?? '{}'));
  const threadUnread = (taskId: string) =>
    !!latestThreadMap[taskId] && latestThreadMap[taskId]! > (lastReadRef.current[taskId] ?? '');
  // the room home's scroller. docs/35: the whole feed-follow
  // apparatus — per-channel scroll memory, the bottom pin, the end sentinel, the stream follow —
  // went with the feed. A LIST opens at its newest row, which is its top; there is nothing to
  // chase, and the v0.28.1/v0.37.1 traps those effects existed to fix cannot recur.
  const listRef = useRef<HTMLDivElement>(null);

  const markRead = (channelId: string) => {
    lastReadRef.current[channelId] = new Date().toISOString();
    localStorage.setItem('nm:lastRead', JSON.stringify(lastReadRef.current));
  };
  /**
   * OPEN A CONVERSATION — the one door, because the main surface holds ONE session (docs/35 §3.4).
   *
   * Every caller used to set `openThreadId` and leave `openTaskId` alone, and the surface renders
   * `openThreadId && !openTask` — so with a task open, clicking a thread row set state that
   * nothing could show. Worse when the row was the thread you were already on: the id never
   * changed, so React re-rendered nothing and the click looked dead. The human's fix was to
   * navigate somewhere else (which clears the task through the conversation-surface invariant)
   * and come back — which is exactly the bug George hit live (2026-08-11).
   *
   * A session opens by REPLACING the one before it. Enforced here rather than at each of the five
   * call sites, so the next list someone adds cannot reintroduce it.
   */
  const openConversation = (threadId: string, channelId?: string | null): void => {
    setOpenTaskId(null);
    if (channelId) {
      const c = chans.find((x) => x.id === channelId);
      if (c) { setCurrent((cur) => (cur?.id === c.id ? cur : c)); markRead(c.id); }
    }
    setOpenThreadId(threadId);
  };
  // THE room-switch — the sidebar rows and every home composer pill go through here,
  // so picking a room anywhere lands identically (view by kind, read marks, history)
  // docs/32 — the feed IS the room. Every room opened anywhere lands on its conversation:
  // the surface people expect from a chat-shaped product, and the one that already carries
  // the work record. The per-room Home (a duplicate of the workspace Home, scoped to one
  // room) and its landing pin are gone; marketing keeps Calendar + Library, which are real
  // alternate views rather than a second landing. The history panel no longer force-opens —
  // arriving used to present up to three surfaces at once.
  const openRoom = (c: ChannelRow, surface: RoomSurface = 'feed') => {
    setNav('home');
    setScopeId(c.id); // arriving in a room IS scoping to it — the nav head must not disagree
    // Board and Routines are DESTINATIONS now, not room surfaces. Translating here (rather than
    // at each of the half-dozen callers) means every legacy `openRoom(c, 'board')` still lands
    // somewhere real — scoped to the room it named, which is what it was asking for all along.
    setView(surface === 'board' ? 'board' : surface === 'routines' ? 'automations' : 'chat');
    setRoomView(surface === 'board' || surface === 'routines' ? 'feed' : surface);
    // A session belongs to the room it was opened from. Leaving that room used to leave the thread
    // standing with the breadcrumb quietly renamed to the room you had just moved to — the session
    // said #build, the crumb said Home. Picking a room means landing on that room's home.
    setOpenTaskId(null);
    setOpenThreadId(null);
    setCurrent(c);
    markRead(c.id);
    setHistQ('');
    setViewMenuOpen(false);
  };
  // a room's alternate surfaces, from anywhere (the burger, the dock, ⌘K). Marketing's Calendar
  // and Library are the only ones left; Board and Automations went to the nav, and `history`
  // survives for legacy deep-links.
  const openRoomSurface = (surface: RoomSurface, c: ChannelRow | null = current) => {
    if (!c) return;
    setNav('home');
    setView('chat');
    setScopeId(c.id);
    if (current?.id !== c.id) { setOpenTaskId(null); setOpenThreadId(null); setCurrent(c); markRead(c.id); }
    if (surface === 'history') { setHistQ(''); markHistSeen(c.id); } // legacy deep-links only
    setRoomView(surface);
    setViewMenuOpen(false);
  };
  // the workspace Home — everything that needs you, across every room (docs/32)
  // A session belongs to the CONVERSATION surface it was opened from — the same rule openRoom
  // and openWorkspaceHome already state out loud. It renders as `.sessionsurf`, absolutely
  // positioned inside that pane, so navigating to a workspace page left it lying on top of the
  // page you actually asked for: you clicked All projects and got a task thread (George,
  // 2026-08-01). Agents · Activity · Library · Retro · Skills · Memory · Code, all of them.
  // Enforced here rather than by adding two setters to each of a dozen destinations, so the
  // NEXT page someone adds cannot reintroduce it.
  const onConversationSurface = nav === 'home' && (view === 'dashboard' || view === 'chat');
  // A pure workspace DESTINATION is a home-nav surface that is neither the conversation nor a
  // task/thread mounted over it (Credits, Footprint, Compute, Board, Whiteboards, …). Its own
  // heading names it, so the conversation tab + the room's crew clusters are thread chrome on a
  // page that is not a thread (George, 2026-08-31). `code` is excluded — it opens as its own
  // editor tab, so its slot-0 conversation still belongs.
  const onWorkspaceDestination = nav === 'home' && view !== 'dashboard' && view !== 'chat'
    && view !== 'code' && !openTaskId && !openThreadId;
  useEffect(() => {
    if (onConversationSurface) return;
    setOpenTaskId(null);
    setOpenThreadId(null);
  }, [onConversationSurface]);
  /** open a task from somewhere that is NOT the conversation surface (⌘K) — land there first,
   *  or the invariant above would close it in the same tick. */
  const openTaskFromAnywhere = (id: string) => {
    setNav('home');
    setView((v) => (v === 'chat' ? v : 'dashboard'));
    setOpenTaskId(id);
  };
  const openWorkspaceHome = () => {
    setNav('home');
    setView('dashboard');
    setScopeId(null);      // the spine's Home is the WORKSPACE lens — it widens the scope to match
    setOpenTaskId(null);   // same rule as a room switch: Home means Home, not Home behind a session
    setOpenThreadId(null);
    setViewMenuOpen(false);
  };
  // ── the one door (nav round, 2026-08-07) ───────────────────────────────────────────────────
  // A door to a conversation ACTIVATES the conversation. Nav doors used to mutate nav/view while
  // a whiteboard/file/terminal tab stayed fronted — the click worked invisibly underneath (the
  // live share-to-chat and New-chat bugs). Every door funnels here: run the state change and
  // focus the landing composer when there is one. `focus: 'home'` bumps the Home
  // composer's signal; `focus: 'thread'` reaches the open conversation's box after paint.
  const goConversation = (go: () => void, opts?: { focus?: 'home' | 'thread' }) => {
    go();
    // fronting tab 0 retired with the side dock (rail-ink round 3): the conversation is the sheet
    // and never leaves the screen, so a door only runs its state change and places focus
    if (opts?.focus === 'home') setHomeCompose((n) => n + 1);
    if (opts?.focus === 'thread')

      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.tcompose textarea, .convcompose textarea')?.focus());
  };

  // ── the nav head (2026-08-03) ──────────────────────────────────────────────────────────────
  /**
   * Pick a channel scope — `null` is All. Every surface that reads scope follows in one gesture:
   * Home, Board, Automations, Library and Recents.
   *
   * The rule for WHERE you land: a surface you are standing on keeps you (scoping the board
   * leaves you on the board, now narrowed) — the one exception is the conversations surface,
   * which has two forms. All has no room to show a brief or a roster for, so it is the workspace
   * Home; a scoped room is that room's own home. Same destination, two scales.
   */
  const pickScope = (c: ChannelRow | null) => {
    setScopeId(c?.id ?? null);
    if (c) { setCurrent(c); markRead(c.id); }
    setHistQ('');
    // a session is a surface of the room it was opened from — a scope change is leaving it
    setOpenTaskId(null);
    setOpenThreadId(null);
    if (view === 'dashboard' || view === 'chat') { setRoomView('feed'); setView(c ? 'chat' : 'dashboard'); }
  };
  // New chat (⌘N) — the STAGE since the shell round (2026-08-10): a centered composer on an
  // otherwise quiet sheet, the project in the headline. Home stopped being the landing for this
  // because Home stopped having a composer; the chips still pick the room before or after you
  // type, and `homeCompose` is the focus nonce the stage's composer listens on.
  const [homeCompose, setHomeCompose] = useState(0);
  // round 2, ⑦ — the channel the NEXT stage composer should open on (an inherited thread context
  // or a project-＋'s default room); consumed by NewChatStage via initialTarget.
  const [chatTarget, setChatTarget] = useState<string | null>(null);
  // Marketing OS (docs/design/marketing-os-2026-08): a playbook pill/row DRAFTS a message —
  // the stage opens on the room with the ask pre-written; the human still sends. Consumed by
  // NewChatStage on the same composeSignal nonce as initialTarget.
  const [chatDraft, setChatDraft] = useState<string | null>(null);
  const openMarketingAsk = (channelId: string, text: string) => {
    // the stage's room chip lists the ACTIVE project's rooms — follow the ask's room there,
    // or the pre-set target silently falls back to whatever room the chip lands on
    const proj = chans.find((c) => c.id === channelId)?.project_id;
    if (proj && proj !== activeProject) setActiveProject(proj);
    setChatTarget(channelId);
    setChatDraft(text);
    goConversation(() => { setOpenTaskId(null); setOpenThreadId(null); setNav('home'); setView('dashboard'); }, { focus: 'home' });
  };
  const newChat = () => {
    // round 2, ⑦: a chat started from inside a conversation files where you were standing —
    // the open thread's channel (and so its project) pre-sets the stage composer's chip.
    const fromChannel = openThreadId || openTaskId ? current?.id ?? null : null;
    setChatTarget(fromChannel ?? null);
    setChatDraft(null);
    goConversation(() => {
      setOpenTaskId(null);
      setOpenThreadId(null);
      setNav('home');
      setView('dashboard');
    }, { focus: 'home' });
  };
  useEffect(() => {
    if (!nm || !doorDone) return;
    // fall back to the sign-in screen rather than a hung splash if the check ever fails
    void nm.authStatus().then(setAuth).catch(() => setAuth({ mode: 'clerk', user: null }));
  }, [doorDone]);

  // data effects wait for auth: pre-login there is no sync process and no
  // nm:* handlers — invoking them just spams 'No handler registered'
  const authed = auth?.mode === 'dev' || !!auth?.user;
  // THE CONNECTIONS (U3b): the local stack and the cloud, as the rail's bands and the foot's menu
  // read them (shell/useConnections.ts). Desktop only — the browser holds one backend.
  const { conns, refresh: refreshConns } = useConnections(authed);
  // opening a rail row on ANOTHER connection: the swap, and the open that lands after the remount
  // Move to Cloud (U7): the foot's row shares the This Mac card's door rule (shell/move-copy.ts moveDoorFor)
  const moveDoor = moveDoorFor(conns.map((c) => ({ kind: c.kind, workspaces: c.workspaces, moved: c.id === fgConnId ? boot?.connection?.moved : undefined })), plan);
  const { openOnConnection } = useForegroundSwap({ boot, connections: conns, foregroundId: fgConnId, onError: (e) => flashToast(errMsg(e)),
    openTask: (id) => goConversation(() => setOpenTaskId(id)), openThread: (id, ch) => goConversation(() => openConversation(id, ch)) });

  useEffect(() => {
    if (!nm || !authed) return;
    // A success clears the stall; a failure counts it. Retrying stays the behaviour — most of these
    // are a backend that is still coming up — but after ~5 tries the splash stops pretending.
    const poll = () => nm.bootstrap()
      .then((b) => {
        setBoot(b); setConnectionWebUrl(b.connection?.webUrl); // the site this connection's copy points at (weburl.ts)
        setBootStall(null);
        // 0113: bootstrap carries the membership set + waiting invitations, so the switcher and
        // the join card render from the first frame — including offline, where a round trip
        // would leave both surfaces blank.
        if (b.workspaces) setWsList(b.workspaces);
        if (b.invites) setWsInvites(b.invites);
        // shared compute (0114): lets a run card tell "ran on someone else's machine" apart from
        // "called no tools" — see LegActivity
        setSelfMachine(b.machineName ?? null);
      })
      .catch((e: unknown) => setBootStall((prev) => ({
        tries: (prev?.tries ?? 0) + 1,
        reason: e instanceof Error ? e.message : String(e),
      })));
    const t = setInterval(() => void poll(), 1500);
    void poll();
    return () => clearInterval(t);
  }, [authed]);

  // latch the wizard on as soon as bootstrap says onboarding is needed; only onDone clears it.
  // 0113: an invited newcomer ALSO has zero memberships, so the latch waits until we know
  // whether an invitation is waiting — otherwise the wizard beats the join card to the screen
  // and walks them into creating their own empty second workspace.
  useEffect(() => {
    if (boot?.needsOnboarding && (declinedFirstRun || wsInvites.length === 0)) setOnboardingActive(true);
  }, [boot?.needsOnboarding, wsInvites.length, declinedFirstRun]);

  // Invitations arrive while you are already signed in — the old claim-at-sign-in path never
  // reached that case at all. Re-check on window focus, which is when someone comes back from
  // the email that told them they were invited.
  useEffect(() => {
    if (!authed || !nm) return;
    const check = () => void nm?.myInvites().then((r) => setWsInvites(r.invites)).catch(() => { /* offline: keep what we have */ });
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [authed]);

  // Answering an invitation changes the membership set, so the switcher has to hear about it.
  const refreshWorkspaces = useCallback(() => {
    void nm?.workspaces().then((r) => setWsList(r.workspaces)).catch(() => { /* cached list stands */ });
    refreshConns();
  }, [refreshConns]);
  const doSwitchWorkspace = useCallback((workspace: string) => {
    // main swaps the foreground in place and pushes nm:foreground, on which the shell remounts
    // (renderer/main.tsx) — so nothing here needs to react to the resolve
    void nm?.switchWorkspace(workspace).catch((e: unknown) => {
      console.error('workspace switch failed', e);
      setWsSwitchTarget(null);
    });
  }, []);

  // live roster: machines/agents/members push the moment sync lands them —
  // the old 30s poll made fresh logins look broken for half a minute
  const [rosterReady, setRosterReady] = useState(false);
  // ── the compute join moment (0118) ────────────────────────────────────────────────────────
  // Once per workspace, machine-local: your machine could serve, your choice is unset, and the
  // workspace has more than one machine — the situation where "who runs my requests" is a real
  // question with an invisible answer. Everything it reads is already on the roster watch.
  const [computeIntroSeen, setComputeIntroSeen] = useState(false);
  // the Compute DESTINATION's pending un-lend — its own state, because the settings modal's
  // lives inside that modal's component and never mounts when the nav view is showing
  const [navRevoke, setNavRevoke] = useState<{ member: MemberRow; apply: () => void; count: number | null } | null>(null);
  const computeIntro = useMemo(() => {
    if (computeIntroSeen || !rosterReady || !boot || !auth?.user) return false;
    if (localStorage.getItem(`nm:computecard:${boot.workspaceId ?? boot.workspace.slug}`)) return false;
    if (roster.machines.length < 2) return false;
    // NOT gated on owning a capable machine any more (0119): the states that most need saying
    // are the ones where you have none — "someone lent you theirs" and "nobody has, here is the
    // ask". Requiring your own machine hid the card from exactly those members.
    const mine = roster.machines.find((m) => m.owner_user_id === auth.user!.id);
    const mineCapable = (() => { try { return !!mine && (JSON.parse(mine.runtimes ?? '[]') as string[]).length > 0; } catch { return false; } })();
    const anyPeer = roster.machines.some((m) => m.owner_user_id !== auth.user!.id);
    if (!mineCapable && !anyPeer) return false;
    const me = members.find((x) => x.user_id === auth.user!.id);
    const prefs = parseComputePrefs(me?.compute);
    return !prefs.machine && !Object.keys(prefs.agents ?? {}).length;
  }, [computeIntroSeen, rosterReady, boot, auth?.user, roster.machines, members]);
  useEffect(() => {
    if (!nm || !authed) return;
    return nm.watchRoster((p) => {
      rememberPersonas(p.agents); // before commit, so avatars render the chosen face on first paint
      setRoster({ machines: p.machines, agents: p.agents });
      setMembers(p.members);
      setRosterReady(true);
    });
  }, [authed]);

  // workspace-wide tasks back the global board AND thread-panel resolution
  // from any view (chat chips open threads without leaving the channel)
  useEffect(() => {
    if (!nm || !authed) return;
    return nm.watchTasksAll(setTasksAll);
  }, [authed]);

  // the spectrum's staffing inputs: the project's release gate (null-safe ON) and
  // the channel roster by role — resolved the moment you look, never stored
  const projShipGate = useCallback((projectId: string | null) => {
    const p = projectId ? wsProjects.find((x) => x.id === projectId) : null;
    return p?.ship_gate == null ? true : !!p.ship_gate;
  }, [wsProjects]);
  const channelRosterFor = useCallback((channelId: string) => {
    const inCh = roster.agents.filter((a) => !a.retired_at && (a.channel_ids ?? '').split(',').includes(channelId));
    const byRole = (r: string) => inCh.find((a) => a.role === r)?.name ?? null;
    return { designer: byRole('designer'), architect: byRole('architect'), developer: byRole('developer') ?? byRole('worker'), reviewer: byRole('reviewer'), shipper: byRole('shipper') };
  }, [roster.agents]);

  // workspace-wide decisions (docs/12 slice 2): agents' open nmq cards feed Mission
  // Control's queue + badge; answered/dismissed rows collapse thread + channel cards
  useEffect(() => {
    if (!nm || !authed) return;
    return nm.watchDecisionsAll(setDecisionsAll);
  }, [authed]);

  // the one open capacity-failover (docs/22) — surfaced as the sticky fly-up
  useEffect(() => {
    if (!nm || !authed) return;
    return nm.watchFailover(setFailover);
  }, [authed]);

  // docs/35 §5: Home's in-flight CHAT watch is gone with the list it fed. It selected the same
  // workspace-wide threads as watch-history-all with `task_id is null` bolted on, which is a
  // second row-set for one subject — the thing §7 exists to prevent. The session list reads
  // `histRecent` below, so chats and tasks cannot disagree about what is in flight.

  // workspace-wide chat conversations — Home's in-flight list shows the active ones
  // (a thread that upgrades into a task leaves this set and rides its task row)
  const [convosAll, setConvosAll] = useState<HomeConvoRow[]>([]);
  useEffect(() => {
    if (!nm || !authed) return;
    return nm.watchThreadsAll(setConvosAll);
  }, [authed]);

  // every thread in the workspace — the nav's history rail and its overlay read this one set,
  // scoped client-side, so the overlay still works from Home where no room is open
  useEffect(() => {
    if (!nm || !authed) return;
    return nm.watchHistoryAll(setHistAll);
  }, [authed]);

  // ⌘K toggles the quick-actions palette from anywhere in the signed-in shell; ⌘\ folds the rail
  useEffect(() => {
    if (!authed) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      }
      // ⌘\ — the width you get back is worth a key, and a folded rail must be re-openable
      // without hunting for a 26px strip. Inert in the top dock (nothing to fold).
      if ((e.metaKey || e.ctrlKey) && e.key === '\\' && navPos !== 'top') {
        e.preventDefault();
        foldNav(!navFolded);
      }
      // ⌘Y — History expanded, from anywhere. Its scope follows what you are looking at, so
      // the same key means "this room's threads" in a room and "every thread" on Home.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        setHistOpen((v) => !v);
      }
      // ⌘N — a blank session (docs/35 §5): Claude/Codex muscle memory, and unclaimed until now.
      // A NAVIGATION verb, not a second composer: it lands on Home and focuses the one that is
      // already there, chips and all.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newChat();
      }
      // ⌘1…⌘9 — the editor idiom every user of this class of app already has in their fingers,
      // and it costs no pixels at all. ⌘1 is always the conversation — its composer, since the
      // conversation never leaves the screen; ⌘2 onwards are the side dock's tabs (docs/36 §3.7).
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        const hit = dockKeyTarget(wtabsRef.current, Number(e.key));
        if (hit) { e.preventDefault(); if (hit.kind === 'tab') { activateWTab(hit.id); openDock(true); } else focusComposer(); }
      }
      // ⌘J — the side dock, from the keyboard: the panel key every editor of this class uses
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'j') { e.preventDefault(); openDock(!dockOpenRef.current); }
      // ⌘⇧P — the projects face, from the keyboard. Checked BEFORE ⌘P: they share a letter, and
      // the file finder must not open on the way to switching projects.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setFaceState((prev) => faceHover(prev, { type: 'click' }));
        return;
      }
      // ⌘P — open a file. The pane IS the finder: typing in it walks the same nm:fs-list the
      // tree reads, so this needed no new IPC and no second tree.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        openWPane(true);
        setWfind((n) => n + 1);
      }
      // Esc closes the face — it is a surface you opened, so the app's universal dismiss owns it
      if (e.key === 'Escape' && navFaceRef.current === 'projects') { e.preventDefault(); closeFaceRef.current(); }
      // …and it closes the TASK PEEK before the session under it (2026-08-10): Esc unwinds
      // exactly ONE layer, and the peek is the layer you opened last. The session's own Esc
      // (the panel's back crumb) still owns the layer beneath — it just no longer fires first
      // and takes the thread away when you meant to dismiss the task beside it.
      if (e.key === 'Escape' && peekOpenRef.current) { e.preventDefault(); e.stopPropagation(); closePeekRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, navFolded, navPos]);

  // the work axis: all workspace projects (+ the channels they span + open-task
  // counts) back the top-left switcher — a cheap local-replica read, polled so
  // new/renamed/archived projects and counts stay live.
  // conversation threads: watch the active channel's history; and when the open
  // conversation gains a task (the orchestrator fanned it out), swap the sheet to the
  // task thread in place — the union feed keeps the chat prelude visible above it.
  useEffect(() => {
    if (!nm || !current?.id) { setChanThreads([]); return; }
    return nm.watchThreads(current.id, setChanThreads);
  }, [current?.id]);
  useEffect(() => {
    if (!openThreadId) return;
    const t = chanThreads.find((x) => x.id === openThreadId);
    if (t?.task_id) { setOpenTaskId(t.task_id); setOpenThreadId(null); }
  }, [chanThreads, openThreadId]);
  const refreshProjects = () => nm?.workspaceMeta().then((m) => setWsProjects(m.projects)).catch(() => {});
  // channels are a cheap local-replica read too — re-poll them (not only at boot) so a freshly
  // created project's rooms show up and a moved channel re-homes without an app restart. Keep the
  // array identity stable when nothing changed so the room list / focus effects don't churn.
  const refreshChannels = () => nm?.channels().then((rows) => setChans((prev) =>
    prev.length === rows.length && prev.every((c, i) => c.id === rows[i]?.id && c.project_id === rows[i]?.project_id && c.slug === rows[i]?.slug && c.topic === rows[i]?.topic && c.kind === rows[i]?.kind && c.marketing === rows[i]?.marketing)
      ? prev : rows,
  )).catch(() => {});
  // after a channel command that changes a synced field (a rename, a kind flip, the marketing
  // profile), re-poll in a short burst so the room converges fast (2.5s heartbeat is the backstop).
  const refreshChannelsSoon = () => { for (const ms of [180, 500, 1100]) setTimeout(() => void refreshChannels(), ms); };
  // a just-created project + any moved channels need a moment to replicate to the
  // local replica before workspace-meta sees them — poll briefly so the switcher,
  // the room list, and the active-project focus converge fast (not on the 2.5s heartbeat).
  const refreshProjectsSoon = () => { for (const ms of [150, 450, 900, 1500]) setTimeout(() => { void refreshProjects(); void refreshChannels(); }, ms); };
  // per-project brains (docs/10): '' clears the override back to the workspace pack.
  // Nothing is re-materialized — the daemon resolves the seat per run — so this is a
  // single project.update, and the synced row is what the chip re-reads.
  const setProjectPack = async (projectId: string, packId: string) => {
    await nm?.projectUpdate(projectId, undefined, undefined, undefined, undefined, undefined, undefined, packId);
    refreshProjectsSoon();
  };
  useEffect(() => {
    if (!nm || !authed) return;
    void refreshProjects();
    const t = setInterval(() => { void refreshProjects(); void refreshChannels(); }, 2500);
    return () => clearInterval(t);
  }, [authed]);

  // keep the persisted pick in sync with the resolved active project, so the
  // switcher highlights the right row even on first load (default project).
  useEffect(() => {
    if (activeProj && activeProj.id !== activeProject) setActiveProjectRaw(activeProj.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProj?.id]);

  // keep chat focused on a room that BELONGS to the active project. Re-runs when
  // the project or its channel set changes (e.g. a freshly-created project's
  // channels sync in, or a channel is moved in/out) so `current` is never left on
  // another project's channel — which would show that project's stale thread.
  useEffect(() => {
    if (!activeProj || !chans.length) return;
    if (current && current.project_id === activeProj.id) return; // current already belongs to the active project
    const inProj = chans.filter((c) => c.project_id === activeProj.id);
    const target = inProj.find((c) => c.slug === activeProj.primary_channel) ?? inProj[0] ?? null;
    if (target) { setCurrent(target); setNav('home'); }
    else if (current) setCurrent(null); // active project has no room of its own → drop the stale one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProj?.id, chans.length]);

  // Desktop notifications: push the saved on/off pref to the main process (it gates whether OS
  // notifications fire), and deep-link into the thread when the user clicks one — switch project +
  // channel and open the task. The notification fired because the app was unfocused; this brings
  // them right to where they're needed.
  useEffect(() => {
    if (!nm) return;
    void nm.setNotificationsEnabled?.(localStorage.getItem('nm:notifications') !== 'off');
    if (!nm.onOpenThread) return;
    return nm.onOpenThread((nav) => {
      const ch = chans.find((c) => c.id === nav.channelId);
      // setView('chat') matters: the notification promised a thread, and landing on
      // any other home subview (dashboard/skills/memory) would bury it
      goConversation(() => {
        if (ch) { if (ch.project_id) setActiveProject(ch.project_id); setNav('home'); setView('chat'); setCurrent(ch); markRead(ch.id); }
        if (nav.taskId) setOpenTaskId(nav.taskId);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, chans]);

  // A server-side plan gate (PLAN_LIMIT) routes here: open the upgrade modal with the reason so the
  // human always sees a clear path forward, never a silent failure.
  useEffect(() => {
    if (!nm?.onPlanLimit) return;
    return nm.onPlanLimit(({ message }) => { setUpgradeReason(message); setUpgradeOpen(true); });
  }, []);

  // Free single-machine limit (P1b): if this machine hit the limit at boot, surface the
  // transfer-or-upgrade card (the registration was refused; data still syncs read-only).
  useEffect(() => { void nm?.machineLimitInfo?.().then((m) => { if (m) setMachineLimit(m); }).catch(() => {}); }, []);

  // clear the switch skeleton once the new project's chat resolves — a room loaded (and its
  // messages landed), or the project genuinely has no rooms — with a safety net so it never sticks.
  useEffect(() => {
    if (!switching) return;
    const noRooms = !!activeProj && chans.length > 0 && !chans.some((c) => c.project_id === activeProj.id);
    if ((current && msgsReady) || noRooms) { setSwitching(false); return; }
    const tid = setTimeout(() => setSwitching(false), 1000);
    return () => clearTimeout(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switching, current?.id, msgsReady, activeProj?.id, chans.length]);

  useEffect(() => {
    if (!nm || nav !== 'artifacts') return;
    // no open-row reset needed: leaving the destination unmounts WorkspaceFiles, which owns
    // its own folder + open-file state
    return nm.watchLibraryAll(setLibraryAll);
  }, [nav]);

  useEffect(() => {
    if (!nm || nav !== 'artifacts') return;
    return nm.watchAttachmentsAll(setAttsAll);
  }, [nav]);

  useEffect(() => {
    if (!nm || !authed) return;
    const load = () => {
      nm.latest().then((rows) => setLatestMap(Object.fromEntries(rows.map((r) => [r.channel_id, r.latest])))).catch(() => {});
      nm.latestThreads().then((rows) => setLatestThreadMap(Object.fromEntries(rows.map((r) => [r.task_id, r.latest])))).catch(() => {});
    };
    void load();
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, [authed]);

  // an open task thread is "read" — keep clearing it as new activity arrives
  useEffect(() => {
    if (openTaskId) markRead(openTaskId);
  }, [openTaskId, openTaskId ? latestThreadMap[openTaskId] : null]);

  useEffect(() => {
    if (!nm || !authed) return;
    let alive = true;
    const loadChannels = async () => {
      let rows: ChannelRow[] = [];
      let isWelcomed = localStorage.getItem('nm:welcomed') === '1';
      try {
        rows = await nm.channels();
        // cloud truth beats the local flag: any human message in the replica
        // means the guided first-send already happened (the flag lives per
        // renderer origin and silently resets when the dev-server port moves)
        if (!isWelcomed) isWelcomed = (await nm.welcomed()).welcomed;
      } catch {
        // main may still be wiring up — retry below
      }
      if (!alive) return;
      setChans(rows);
      if (rows.length) setWelcomed(isWelcomed);
      // always open on #general — the team home base (the orchestrator's welcome + your first
      // mention land here); work happens in #dev but home is where you get oriented.
      // Re-validate an existing pick against the fresh list: a channel picked during early
      // boot can belong to a superseded workspace resolution (or have been deleted), and a
      // stale id leaves the feed watching a room that will never emit rows again.
      setCurrent((c) => (c && rows.some((r) => r.id === c.id) ? c : rows.find((r) => r.slug === 'general') ?? rows[0] ?? null));
      if (!rows.length) setTimeout(loadChannels, 800); // first sync still inbound
    };
    void loadChannels();
    const status = setInterval(async () => {
      const st = await nm.status();
      setConnected(st.connected);
      setSyncedOnce((prev) => prev || !!st.lastSyncedAt);
      setQueuedWrites(st.queued ?? 0);
    }, 2000);
    return () => {
      alive = false;
      clearInterval(status);
    };
  }, [authed]);

  useEffect(() => {
    // clear immediately on ANY channel change (including → none, when switching to a project
    // with no rooms) so the previous room's messages never linger; skeletons render until this
    // room's first watch result lands
    setMsgs([]);
    setMsgsReady(false);
    if (!nm || !current) return;
    return nm.watchMessages(current.id, (rows) => {
      setMsgs(rows);
      setMsgsReady(true);
      markRead(current.id);
    });
  }, [current?.id]);

  useEffect(() => {
    if (!nm || !current) return;
    setOpenTaskId(null); // thread belongs to the channel we just left
    // Merged onto the defaults, never assigned raw: `then(setMeta)` trusted the bridge to send
    // every key, and when `reposAll` was missing the app UNMOUNTED on the next
    // Workspace-settings open (undefined.length). The handler is fixed, but an older main
    // process is exactly the case where a renderer must degrade rather than blank — the same
    // rule the roster and mcpKeys reads already follow.
    void nm.channelMeta(current.id)
      .then((r) => setMeta({ projects: r?.projects ?? [], repos: r?.repos ?? [], reposAll: r?.reposAll ?? [] }))
      .catch(() => {});
    return nm.watchTasks(current.id, setTasks);
  }, [current?.id]);


  // the room's papertrail (0093) — read once per room from the local replica, and again when
  // membership changes, since adding an agent writes the very row the trail renders.
  useEffect(() => {
    if (!nm || !current) { setChanHistory([]); setChanPeople([]); return; }
    let live = true;
    const load = () => {
      void nm.channelHistory(current.id).then((rows) => { if (live) setChanHistory(rows); }).catch(() => {});
      void nm.channelPeople(current.id).then((rows) => { if (live) setChanPeople(rows); }).catch(() => {});
    };
    load();
    // membership writes land in the replica a beat after the command returns; the callers that
    // add or remove bump `peopleTick` so the roster and the trail re-read without a poll.
    return () => { live = false; };
  }, [current?.id, roster.agents, peopleTick]);

  // Memory is read for the room the PICKER names, defaulting to the room the shell is standing
  // in. It is the one destination that cannot span the workspace client-side: /v1/memory requires
  // a channel and store.channelMemory is keyed by one, so "all rooms" would need a server-side
  // aggregate. Rather than fake it, the room is an explicit, visible choice.
  useEffect(() => {
    if (!nm || !current) return;
    setSkills([]);
    return nm.watchSkills(current.id, (rows) => setSkills(rows as SkillRow[]));
  }, [current?.id]);

  // …and the workspace-wide set the Skills DESTINATION reads. Two watches on purpose: the
  // composer's `/` picker must stay room-scoped (offering a skill that will not run here is worse
  // than not offering it), while the destination is a library and hides nothing by default.
  useEffect(() => {
    if (!nm) return;
    return nm.watchSkills(null, (rows) => setSkillsAll(rows as SkillRow[]));
  }, []);

  useEffect(() => {
    if (!nm || !current) return;
    setPacks([]);
    return nm.watchSkillPacks(current.id, (rows) => setPacks(rows as SkillPackRow[]));
  }, [current?.id]);

  // the open thread follows live task state (chip flips as agents move it);
  // the panel mounts at shell level, so resolve across the workspace too
  const openTask = openTaskId
    ? (tasks.find((t) => t.id === openTaskId) ?? tasksAll.find((t) => t.id === openTaskId) ?? null)
    : null;
  // ── the peeked task (2026-08-10) — resolved the same way, workspace-wide: a thread can name a
  // task in another room, and a ref that resolves to nothing must simply not dock. ──
  const peekTask2 = peekTaskId && peekTaskId !== openTaskId
    ? (tasks.find((t) => t.id === peekTaskId) ?? tasksAll.find((t) => t.id === peekTaskId) ?? null)
    : null;
  // A PEEK ONLY EXISTS BESIDE A SESSION. Leaving the session (back to Home, another thread, a
  // destination) takes the peek with it — that is what keeps it from becoming a second way to
  // browse the board, and it is enforced here rather than at each of a dozen exits.
  const sessionKey = openTaskId ?? openThreadId ?? '';
  useEffect(() => { if (peekTaskId) closePeek(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sessionKey]);
  // …and a ref that resolves to nothing (a purged task, a number from another workspace) must
  // not leave a half-open column standing
  useEffect(() => { if (peekTaskId && !peekTask2) closePeek(); }, [peekTaskId, peekTask2, closePeek]);

  // park an idea on the backlog from the room's board — a channel is the ACL boundary, and
  // the board you are looking at names it: the idea files into the room whose board it is.

  // Runs (docs/29): every OPEN run in the workspace. The rail reads it so an agent that is
  // visibly working in a thread can't simultaneously read "standing by" three inches away.
  const [openRuns, setOpenRuns] = useState<RunUI[]>([]);
  useEffect(() => nm?.watchOpenRuns(setOpenRuns), []);

  // active-project scope (the work axis): the channels it spans (rooms), and the
  // global board + library filtered to it. 'all' = today's unscoped behavior.
  // NOT a slug set. `activeProj.channel_slugs` is a comma-joined list of NAMES, and every project
  // is seeded with the same starter channels — so a `flowe-ai` artifact in its `#marketing` passed
  // a `neuramesh` slug filter and the Library showed another project's files (George, 2026-08-02).
  // The library rows carry `channel_id` now and scope through `rowsInProject` like every other
  // conversation surface, so ownership is the test rather than a name collision.
  // scope the room list by project OWNERSHIP, not slug — every project is seeded with the same
  // default channel names (general/dev/…), so slugs collide across projects.
  const scopedChans = activeProj ? chans.filter((c) => c.project_id === activeProj.id) : chans;
  // A task's project is its CHANNEL's project (CLAUDE.md) — `tasks.project_id` is a
  // denormalized convenience that can be null, and a bare `t.project_id === active.id`
  // dropped those rows out of EVERY project at once (invisible on the board and in the room
  // counts, while the unscoped Home badge still counted them). Resolved, not assumed.
  const scopedTasksAll = tasksInProject(tasksAll, chans, activeProj?.id ?? null);
  // …and the CONVERSATION surfaces follow the same axis. Threads, chats and runs carry no
  // project column of their own, so their project is their channel's (rowsInProject).
  //
  // Everything below fed off a workspace-wide watch and was only ever narrowed by ROOM, which
  // meant that on Home — where the room scope is deliberately null — switching projects changed
  // the channel list and the board while the Recents rail, the ⌘Y overlay and In flight went on
  // showing the project you had just left. Worse than merely wrong: every project is seeded with
  // the same starter slugs, so a leaked row reads `#marketing` exactly like one of yours.
  //
  // Home's needs-you QUEUE is the one written exception (docs/12 §6 / docs/06): a blocked agent
  // in any project needs you regardless of which project you left selected. It keeps `tasksAll`
  // and `decisionsAll`, and its cards badge the project when it is off the active one.
  const projScope = activeProj?.id ?? null;
  // …and the spine's pulses: which PROJECTS have an agent working in them right now. A run names
  // its channel, and a channel names its project — the same resolution every scope here uses, and
  // the same watch the Recents dot reads, so the strip can never disagree with the list.
  const histInProj = useMemo(() => rowsInProject(histAll, chans, projScope), [histAll, chans, projScope]);
  // The scope, RESOLVED — and self-healing: a scoped room that leaves the project (switched
  // away from, deleted, moved) reads as All rather than as a room that is no longer there.
  const scopeChan = scopeId ? scopedChans.find((c) => c.id === scopeId) ?? null : null;
  const scopeChanIds = scopedChans.map((c) => c.id).join(',');
  useEffect(() => {
    if (!nm) return;
    let live = true;
    const ids = new Set(scopeChanIds.split(',').filter(Boolean));
    const load = () => { void nm.schedules(scopeId).then((r) => {
      if (!live) return;
      setRoomRoutines(r.schedules.filter((x) =>
        (x.status === 'active' || x.status === 'paused') && !!x.channel_id && ids.has(x.channel_id)).length);
    }).catch(() => {}); };
    load();
    const iv = setInterval(load, 30_000);
    return () => { live = false; clearInterval(iv); };
  }, [scopeId, scopeChanIds]);
  // the Calendar badge: posts still COMING (draft + scheduled), workspace-wide — the destination's
  // own resting scope, so the number and the surface can never disagree about what they count.
  // Published is deliberately out: it already happened, and a badge is for what is still owed.
  // The rows themselves feed the session marks too (release drafts §4.5): a draft on a unit a
  // conversation owns lifts that conversation into Needs you, off this same poll.
  useEffect(() => {
    if (!nm) return;
    let live = true;
    const load = () => { void nm.contentAll().then((r) => {
      if (!live) return;
      const coming = r.items.filter((it) => it.status === 'draft' || it.status === 'scheduled');
      setComingPosts(coming); setRoomContent(coming.length);
    }).catch(() => {}); };
    load();
    const iv = setInterval(load, 30_000);
    return () => { live = false; clearInterval(iv); };
  }, []);
  // a channel id → its project, the derivation every workspace surface filters through
  const chanProjectOf = useMemo(() => new Map(chans.map((c) => [c.id, c.project_id ?? null])), [chans]);
  // The board is WORKSPACE-WIDE, narrowed only by its own visible filters (2026-08-07). It used
  // to read the active project through `scopedTasksAll` plus the nav head's channel scope, so a
  // task in another project was absent with nothing on screen admitting it — the same defect the
  // Library had. Its own scope bar owns the narrowing now, and every filter is reversible.
  const boardRoom = boardScope.channelId ? chans.find((c) => c.id === boardScope.channelId) ?? null : null;
  const boardTasks = useMemo(() => {
    const needle = boardScope.q.trim().toLowerCase();
    return tasksAll
      .filter((t) => !boardScope.projectId || chanProjectOf.get(t.channel_id) === boardScope.projectId)
      .filter((t) => !boardScope.channelId || t.channel_id === boardScope.channelId)
      .filter((t) => !needle || t.title.toLowerCase().includes(needle) || String(t.number).includes(needle));
  }, [tasksAll, boardScope.projectId, boardScope.channelId, boardScope.q, chanProjectOf]);
  const boardIsMk = !!boardRoom && boardRoom.kind === 'marketing';
  const boardStateList: readonly string[] = boardIsMk ? MK_BOARD_STATES : withBlocked(boardTasks);
  const boardLabelOf = (st: string) => (boardIsMk ? MK_STATE_LABEL[st] ?? STATE_LABEL[st] : STATE_LABEL[st]);
  // the counts the nav destinations wear — live work in scope, and threads that have moved
  // since you last opened this room's history
  const roomOpenTasks = boardTasks.filter((t) => !['closed', 'accepted'].includes(t.state) && !t.parent_task_id).length;
  const roomUnseenThreads = current ? chanThreads.filter((t) => t.updated_at > (histSeen[current.id] ?? '')).length : 0;
  // the surface actually on screen: a marketing room that loses its profile mid-view (setup
  // reset, a kind change) must not strand you on a Calendar tab that no longer exists
  const roomSurface = resolveRoomSurface(roomView, roomTabsFor(currentLive?.kind, marketingReady(currentLive?.marketing)));
  // The overlay is the FULL history and always was, per its own doc comment — but it was fed the
  // project-scoped rows, so "search every thread" quietly meant "this project's threads"
  // (2026-08-07). It reads the workspace-wide sets now and narrows by project on demand.
  const histOvlRows = useMemo(
    () => historyRows({ threads: histAll, tasks: tasksAll, channelId: null, channelSlug: '', query: histQ }),
    [histAll, tasksAll, histQ],
  );
  const projectOfChannel = useMemo(() => new Map(chans.map((c) => [c.id, c.project_id ?? null])), [chans]);
  const homeRows = useMemo(() => historyRows({ threads: histAll, tasks: tasksAll, channelId: null, channelSlug: '', query: '' }), [histAll, tasksAll]); // Home's ledger: the overlay's rows, never its search
  // which rows have an agent in them right now — open runs carry the task or the thread they
  // belong to, and they are synced, so this is honest on every machine. ONE liveness signal for
  // every list that renders a session row (docs/29 §10 / docs/35 §3.2): the Recents rail's dot,
  // the room list's dial and Home's, all off this set.
  // a child's run is live work in the PARENT's session too (2026-08-22) — see liveKinOf
  const liveKin = useMemo(() => liveKinOf(tasksAll), [tasksAll]);
  const histLiveIds = useMemo(() => {
    const live = openRuns.filter((r) => r.state === 'running');
    return new Set(live.flatMap((r) => [...(r.task_id ? [r.task_id, ...liveKin(r.task_id)] : []), ...(r.thread_id ? [r.thread_id] : [])]));
  }, [openRuns, liveKin]);
  // the three words a thread can wear (shared/threadstatus.ts), for the ⌘Y overlay's chips and filter
  const rowMarks = useMemo(() => makeRowMarks({ decisions: decisionsAll, liveIds: histLiveIds, threads: histAll, tasks: tasksAll, drafts: comingPosts }), [decisionsAll, histLiveIds, histAll, tasksAll, comingPosts]);
  // …and for the OPEN session's head (settle round, 2026-09-09). The same derivation the rail's
  // rows run, asked about the one session on screen — a task's thread id lives on TaskAllRow, not
  // on the TaskRow the panel holds, so it is resolved here rather than inside the head.
  const headMarks = useMemo((): HeadStatus | null => {
    const task = openTaskId ? tasksAll.find((t) => t.id === openTaskId) ?? null : null;
    const threadId = openThreadId ?? task?.thread_id ?? null;
    if (!threadId) return null;
    return { ...rowMarks({ threadId, task }), threadId };
  }, [openTaskId, openThreadId, tasksAll, rowMarks]);
  // the raised card's live verb — the SAME rows the pulse reads, shaped for the rail
  const histLiveRuns = useMemo(() => {
    // `role` rides along for the ORB (2026-08-17): `orbStateFor(verb, cat, role)` is what picks
    // `shaping` for a designer, and the rail resolved the agent for its name and then dropped
    // everything else — so the designer's orb was unreachable from this surface by construction.
    const map = new Map<string, { agent: string | null; role: string | null; step: string | null; done: number; total: number }>();
    // Roots first, then legs — so a running SUBAGENT wins the row (docs/harness/04).
    //
    // Two reasons this ordering matters. A parent that has fanned out is not itself the interesting
    // fact ("running pwd && ls"); the leg is. And a leg is named by its TITLE, not its step: the leg's
    // step is written once at openRun and never updated, so reading it left the rail stuck on a
    // permanent "starting" while three subagents came and went (seen live).
    const ordered = [...openRuns.filter((r) => r.kind !== 'leg'), ...openRuns.filter((r) => r.kind === 'leg')];
    for (const r of ordered) {
      if (r.state !== 'running') continue;
      const who = roster.agents.find((a) => a.id === r.agent_id);
      const v = {
        agent: who?.name ?? null,
        role: who?.role ?? null,
        step: r.kind === 'leg' ? r.title : r.step,
        done: r.done ?? 0,
        total: r.total ?? 0,
      };
      if (r.task_id) { map.set(r.task_id, v); for (const k of liveKin(r.task_id)) map.set(k, v); }
      if (r.thread_id) map.set(r.thread_id, v);
    }
    return map;
  }, [openRuns, roster.agents, liveKin]);
  // ── the room home (docs/35) ────────────────────────────────────────────────────────────────
  // THIS room's session list, off the same `historyRows` the rail and the ⌘Y overlay read, plus
  // the legacy pass over the room's own messages (loose human messages that predate sessions).
  const roomSessions = useMemo(
    () => historyRows({ threads: histInProj, tasks: scopedTasksAll, channelId: current?.id ?? null, channelSlug: current?.slug ?? '', query: '', messages: msgs }),
    [histInProj, scopedTasksAll, current?.id, current?.slug, msgs],
  );
  // …and the briefs pinned above it: this room's agents are the roster the predicate resolves
  // against, so a message signed by nobody in this room yields no card (room-tabs.ts).
  // RETIRED agents stay in the set on purpose. They are excluded from every surface that PICKS an
  // agent to do work, but a digest they posted is still this room's record, and dropping it on
  // retirement is the same failure class as the docs/20 hush: a stored value quietly emptying a
  // surface. Retired agents stay synced precisely for attribution (docs/06).
  const roomBriefList = useMemo(() => {
    const ids = new Set(roster.agents.filter((a) => agentInChannel(a.channel_ids, current?.id ?? '')).map((a) => a.id));
    return roomBriefs(msgs, ids);
  }, [msgs, roster.agents, current?.id]);
  /** ONE opener for every session row, wherever it renders: a task, a conversation, or a loose
   *  room message (which has no session yet — replying is what gives it one). */
  // Archiving a conversation (0108). No confirm dialog: archiving is reversible and destroys
  // nothing, so it should not cost one — the row leaves at once and an Undo sits in its place for
  // a few seconds. The server refuses a task thread (TASK_THREAD) and any agent (HUMAN_ONLY); the
  // row only offers the action on a chat thread, so both are belt and braces rather than the gate.
  const [archUndo, setArchUndo] = useState<{ id: string; title: string } | null>(null);
  const archUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const archiveConversation = async (threadId: string, title: string) => {
    if (!nm) return;
    try {
      await nm.threadArchive(threadId);
      if (archUndoTimer.current) clearTimeout(archUndoTimer.current);
      setArchUndo({ id: threadId, title });
      archUndoTimer.current = setTimeout(() => setArchUndo(null), 7000);
    } catch { /* the list is unchanged, so a failure is visible as "nothing happened" */ }
  };
  const undoArchive = async () => {
    const u = archUndo;
    if (!u || !nm) return;
    setArchUndo(null);
    await nm.threadUnarchive(u.id).catch(() => {});
  };

  const openSession = (r: HistoryRow<TaskAllRow>) => {
    if (r.task) { setOpenTaskId(r.task.id); return; }
    // the row names its OWN room, which on Home is not the room you last visited (docs/32 §2a);
    // openConversation carries that room AND closes any open task (the one-session rule)
    if (r.threadId) { openConversation(r.threadId, r.channelId); return; }
    if (r.rootMessageId) replyAtRoot(r.rootMessageId, `${r.title} ${r.snip}`.trim(), 'this message');
  };
  // where an open session's back crumb goes. It is the surface the session REPLACED, so it
  // names it: Home when the session was opened from Home, else this room's active lens.
  const sessionBack = nav === 'home' && view === 'dashboard'
    ? 'Home'
    : `#${current?.slug ?? ''} · ${(roomTabsFor(currentLive?.kind, marketingReady(currentLive?.marketing)).find((t) => t.id === roomSurface)?.label ?? 'Conversations').toLowerCase()}`;

  // the open task's retained worktree — the file pane's tree root, resolved through the very
  // handler the terminal uses to find its jail, so the pane and the shell agree on "the worktree"
  const [taskWorktree, setTaskWorktree] = useState<string | null>(null);
  useEffect(() => {
    if (!nm || !openTask) { setTaskWorktree(null); return; }
    let live = true;
    void nm.terminalInfo(openTask.number, !!openTask.branch).then((r) => { if (live) setTaskWorktree(r.available ? r.cwd : null); }).catch(() => {});
    return () => { live = false; };
  }, [openTask?.id]);

  // ── tab one, derived (docs/36 §3.3) ────────────────────────────────────────────────────────
  // The conversation tab FOLLOWS the room: switching rooms replaces it in place, and there is no
  // `open({kind:'conversation'})` path anywhere, so a second one is unrepresentable rather than
  // merely discouraged. "The conversation" means the whole docs/35 plane — a room's session list,
  // or an open session inside it with its back crumb.
  const convSubject = openTask
    ? { id: `conv:task:${openTask.id}`, title: `#${openTask.number} · ${plainTitle(openTask.title)}`, short: `#${openTask.number}`, taskNumber: openTask.number, live: histLiveIds.has(openTask.id) }
    : openThreadId
      ? { id: `conv:thread:${openThreadId}`, title: plainTitle(chanThreads.find((t) => t.id === openThreadId)?.title || 'Conversation'), short: current ? `#${current.slug}` : 'the conversation', taskNumber: null, live: histLiveIds.has(openThreadId) }
      // A SURFACE is not a room, and it outranks whichever channel happens to still be `current`.
      // Home established this — otherwise the tab read "#build" while Home was on screen — and
      // every other workspace surface has exactly the same problem: standing on Automations with
      // the tab labelled "#marketing" names the room you left, not the thing you are looking at.
      // These surfaces are workspace-wide now, so a channel name on their tab is not merely
      // unhelpful, it is wrong.
      : SURFACE_TABS[view]
        ? { id: `conv:${view}`, title: SURFACE_TABS[view]!, short: SURFACE_TABS[view]!, taskNumber: null, live: false }
        : current
          ? { id: `conv:room:${current.id}`, title: `#${current.slug}`, short: `#${current.slug}`, taskNumber: null, live: openRuns.some((r) => r.state === 'running' && r.channel_id === current.id) }
          : { id: 'conv:home', title: 'New chat', short: 'New chat', taskNumber: null, live: false };
  useEffect(() => {
    setWtabs((prev) => {
      const head = prev[0];
      if (head?.kind === 'conversation' && head.id === convSubject.id && head.title === convSubject.title) return prev;
      const r = setConversation(prev, { id: convSubject.id, title: convSubject.title, taskNumber: convSubject.taskNumber }, wactiveRef.current);
      // the active tab CARRIES THROUGH a room switch — the file you are reading belongs to your
      // work, not to the room you were standing in — unless you were ON the conversation, where
      // staying put means following it rather than being dropped onto a sibling
      setWactive(r.activeId ?? r.tabs[0]?.id ?? null);
      return r.tabs;
    });
  }, [convSubject.id, convSubject.title]);
  // the conversation is the SHEET, not a tab (rail-ink round 3, 2026-09-04): it is never hidden
  // behind a guest, so the conversation-active flag, the peek and the unread count all retired
  const engineeringContextOn = view === 'engineering' && !openTaskId && !openThreadId;
  // the dock draws the guests; a guest coming to the front unfolds it, the last one leaving folds it
  const dockGuests = dockTabs(wtabs), dockActive = dockActiveId(wtabs, wactive);
  const dockPrev = useRef({ active: dockActive, count: dockGuests.length });
  useEffect(() => {
    const next = { active: dockActive, count: dockGuests.length };
    const verdict = dockFoldAfter(dockPrev.current, next);
    dockPrev.current = next;
    if (verdict) openDock(verdict === 'open');
  }, [dockActive, dockGuests.length]);
  const wtab = wtabs.find((t) => t.id === wactive) ?? null;
  const wtabDoc = wtab ? wdocs[wtab.id] : null;
  /** what the ＋ flyout and the file pane are pointed at: the ACTIVE tab's worktree, else the conversation's */
  const wscope: WScope = (() => {
    const localRepo = (meta.repos || []).find((r) => r.provider === 'local' && r.local_path);
    if (wtab && (wtab.readOnly || wtabDoc)) return { root: null, label: 'artifacts', taskId: wtabDoc?.taskId ?? openTask?.id ?? null, taskNumber: wtabDoc?.taskNumber ?? wtab.taskNumber ?? null, hasRepo: false };
    // a file tab's subtitle is its path INSIDE the root, so the pane names the root itself — a
    // pane headed "src/components/NavDrawer.tsx" would be labelling itself with its own selection
    if (wtab?.root) return { root: wtab.root, label: (wtab.path ? null : wtab.subtitle) || wtabBase(wtab.root), taskId: null, taskNumber: wtab.taskNumber ?? null, hasRepo: false };
    if (openTask) return { root: taskWorktree, label: taskWorktree ? `nm-${openTask.number}` : `#${openTask.number}`, taskId: openTask.id, taskNumber: openTask.number, hasRepo: !!openTask.branch };
    // nothing in front of you: a repo you picked in the Workbench's `repos` face, else the
    // workspace's own local repo (which still targets the ＋ flyout's terminal, as it always did)
    return { root: wbRoot?.path ?? localRepo?.local_path ?? null, label: wbRoot?.name ?? localRepo?.name ?? 'this machine', taskId: null, taskNumber: null, hasRepo: false };
  })();
  /** a session or a file tab is in front of you — as opposed to the landing or a destination.
   *  An open CONVERSATION counts (2026-08-17): it was the one thing missing from this list, and
   *  its absence is why a chat thread could only ever reach the `repos` face — which is why its
   *  details had to keep rendering inside the sheet. */
  /**
   * TWO SIGNALS, and the difference between them is `wbRoot` (George, 2026-08-19).
   *
   * `wbSessionOpen` — is a session actually in front of you? A thread, a task, or a file/artifact
   * tab. This decides whether the panel APPEARS AT ALL (`workbenchApplies`).
   *
   * `wbSessionScoped` — the same, plus a repo you picked in the Repos face to browse. That decides
   * which FACES a context offers, where a browsed root legitimately counts.
   *
   * Collapsing them into one was the bug: `wbRoot` is sticky and workspace-wide, so once you had
   * browsed a repo the panel thought a session was open forever and followed you onto the New chat
   * stage, which has no session at all. Browsing a repo is not a session; it is a place the panel
   * can point WHEN there is one.
   *
   * One statement because App.tsx sits on a 3000-line ratchet and comments are free while code
   * lines are not — the alternative was shedding a line somewhere unrelated to buy this one.
   */
  const wbSessionOpen = !!(wtab?.root || wtabDoc || wtab?.readOnly || openTask || openThreadId), wbSessionScoped = wbSessionOpen || !!wbRoot;
  const wb = workbenchState({
    root: wscope.root, taskId: wscope.taskId, taskNumber: wscope.taskNumber,
    threadId: openTask ? null : openThreadId,
    // the room backs the Details face when no session does — its brand docs, queue and
    // connections, which used to mount as a panel of their own on the room home
    channelId: current?.id ?? null,
    label: wscope.label, sessionScoped: wbSessionScoped,
  });
  /** the Workbench card renders: a session-shaped surface, and a context with at least one face */
  const wbCardApplies = workbenchApplies(view, wbSessionOpen) && !!wb.subject, wbCardOn = wpane && wbCardApplies;
  const toggleWorkbench = () => openWPane(!wpane);
  const wactivePath = wtab?.path ?? (wtabDoc?.name ?? null);
  const wdirtyPaths = useMemo(() => new Set(wtabs.filter((t) => t.dirty && t.path).map((t) => t.path!)), [wtabs]);
  const wterms = useRef<Map<string, TermHandle>>(new Map());
  // a terminal computes 0 rows while its pane is hidden, so it re-fits the frame after it lands
  useEffect(() => {
    if (!wactive) return;
    const r = requestAnimationFrame(() => wterms.current.get(wactive)?.fit());
    return () => cancelAnimationFrame(r);
  }, [wactive]);
  /** a note in the worktree you are working in — created on disk, then opened as its own tab */
  const newMarkdown = async () => {
    const root = wscope.root;
    if (!root) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2');
    const rel = `note-${stamp}.md`;
    await nm?.fsWrite(root, rel, `# Note\n\n`);
    openFileTab(root, rel);
  };
  /** the side dock's ＋ (and ⌘P): what opens BESIDE the conversation, scoped to the active tab's worktree */
  const openHere = (what: 'file' | 'terminal' | 'browser' | 'markdown' | 'whiteboard') => {
    // "Open a file…" is the Workbench's finder — the card owns the one file tree (2026-08-16)
    if (what === 'file') { openWPane(true); setWfind((n) => n + 1); return; }
    if (what === 'terminal') {
      if (wscope.taskNumber != null) openTermTab({ taskNumber: wscope.taskNumber, hasRepo: wscope.hasRepo, title: `#${wscope.taskNumber}` });
      else if (wscope.root) openTermTab({ cwdRoot: wscope.root, title: wscope.label }); // the row promised "in <label>"
      else openDefaultTerminal();
      return;
    }
    if (what === 'browser') { openBrowserTab(); return; }
    if (what === 'whiteboard') { void newWhiteboard(); return; }
    void newMarkdown();
  };
  // which room Board/History open from OUTSIDE a room (the burger, the dock, ⌘K): the one you
  // are standing in, else the project's first — never a dead click
  // Stable across the 2.5s heartbeat (which only touches meta/chans, not tasks/roster), so the
  // markdown `components` map below can be memoized on it — that keeps react-markdown from giving
  // each inline TaskRefLink a fresh identity every sync, which was remounting it (wiping the hover
  // card mid-hover) and replaying its entry animation (the blip).
  const mdTaskRef = useCallback((n: number): TaskRefInfo | null => {
    const t = tasks.find((x) => x.number === n) ?? tasksAll.find((x) => x.number === n);
    if (!t) return null;
    const ag = t.assignee_kind === 'agent' ? roster.agents.find((x) => x.id === t.assignee_id)?.name ?? null : null;
    return { id: t.id, number: n, title: t.title, state: t.state, assignee: ag, branch: t.branch, pr: t.pr_number };
  }, [tasks, tasksAll, roster.agents]);

  // ── THE TASK PEEK's column (2026-08-10) ─────────────────────────────────────────────────────
  // The split stage's second tenant (docs/33 §8): ONE animated number (the peek's width) with the
  // session column at `flex: 1` absorbing the difference, so open · resize · expand · close read
  // as one gesture rather than two coincidental animations. The peek renders the SAME TaskThread
  // the full surface renders — the panel is not forked, it is narrowed — with `peek` swapping the
  // back crumb for close · expand · open full.
  const peekStyle = { ['--nm-peekw' as string]: `${peekW}px` } as React.CSSProperties;
  const peekChan = peekTask2 ? chans.find((c) => c.id === peekTask2.channel_id) ?? null : null;
  const peekProject = peekTask2
    ? wsProjects.find((p) => p.id === (tasksAll.find((x) => x.id === peekTask2.id)?.project_id ?? peekChan?.project_id ?? activeProject)) ?? null
    : null;
  const peekNode = peekTask2 ? (
    <>
      {/* the seam: invisible at rest, a 3px pill on hover, --ring while dragging — the nav grip's
          own recipe, because it is the same act on a different edge */}
      <div
        className="pkgrip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the task peek"
        aria-valuenow={peekW}
        aria-valuemin={PEEK_W_MIN}
        aria-valuemax={PEEK_W_MAX}
        tabIndex={0}
        title="Drag to resize · double-click resets"
        onPointerDown={(e) => {
          e.preventDefault();
          const el = e.currentTarget;
          const startX = e.clientX;
          const startW = peekW;
          let last = startW;
          setPeekDragging(true);
          el.setPointerCapture(e.pointerId);
          const move = (ev: PointerEvent) => { last = clampPeekW(startW - (ev.clientX - startX)); setPeekW(last); };
          const up = () => {
            try { localStorage.setItem('nm:peekw', String(last)); } catch { /* private mode */ }
            setPeekDragging(false);
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
            el.removeEventListener('pointercancel', up);
          };
          el.addEventListener('pointermove', move);
          el.addEventListener('pointerup', up);
          el.addEventListener('pointercancel', up);
        }}
        onDoubleClick={() => { setPeekW(PEEK_W_DEFAULT); try { localStorage.setItem('nm:peekw', String(PEEK_W_DEFAULT)); } catch { /* private mode */ } }}
        onKeyDown={(e) => {
          // functional updates: two presses in one frame must not both read the same render
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          setPeekW((w) => { const c = clampPeekW(w + (e.key === 'ArrowLeft' ? 12 : -12)); try { localStorage.setItem('nm:peekw', String(c)); } catch { /* private mode */ } return c; });
        }}
      >
        <span className="pkgripbar" aria-hidden />
      </div>
      <div className="taskpeek" role="complementary" aria-label={`Task #${peekTask2.number}`}>
        <TaskThread
          key={peekTask2.id}
          task={peekTask2}
          back={sessionBack}
          peek={{
            // the promotion: hand the sheet over to the ordinary full session surface — the
            // "I'm switching to this now" door, and the only one that changes what you are in
            onFull: () => { const id = peekTask2.id; closePeek(); setOpenTaskId(id); },
          }}
          convoThreadId={chanThreads.find((t) => t.task_id === peekTask2.id)?.id ?? peekTask2.origin_thread_id ?? null}
          convoThread={chanThreads.find((t) => t.task_id === peekTask2.id) ?? null}
          threadBrain={(chanThreads.find((t) => t.task_id === peekTask2.id) ?? chanThreads.find((t) => t.id === peekTask2.origin_thread_id))?.brain_override ?? null}
          brainProject={peekProject ? { id: peekProject.id, name: peekProject.name, pack: peekProject.model_pack ?? null } : null}
          crumbProject={peekProject ? { name: peekProject.name, logo_url: peekProject.logo_url } : null}
          onSetProjectPack={(packId) => setProjectPack(peekProject?.id ?? activeProject, packId)}
          onBrainConnect={(p) => { setFocusProvider(p); setWsOpen(true); void refreshCreds(); }}
          onOpenWhiteboard={openWhiteboardTab} onOpenDoc={openDocTab} onOpenArticle={openArticleTab}
          agents={roster.agents}
          machines={roster.machines}
          members={members}
          selfId={auth?.user?.id}
          selfEmail={auth?.user?.email}
          channelId={peekTask2.channel_id}
          channelSlug={peekChan?.slug ?? tasksAll.find((x) => x.id === peekTask2.id)?.channel_slug ?? ''}
          channelKind={peekChan?.kind ?? null}
          channelMarketing={peekChan?.marketing ?? null}
          decisions={decisionsAll.filter((d) => d.task_id === peekTask2.id)}
          onClose={closePeek}
          onPreview={(name?: string) => void openTaskArtifact(peekTask2, name)}
          onViewLogs={() => viewTaskLogs(peekTask2.number)}
          onActivity={openAgentActivity}
          plan={plan} hostedGate={hostedGateFor(boot?.connection, plan)}
          onUpgrade={openUpgrade}
          onOpenReview={(name) => void openTaskArtifact(peekTask2, name)}
          onOpenTerminal={(t) => openTermTab({ taskNumber: t.number, hasRepo: !!t.branch, title: '#' + t.number })}
          onOpenSkills={() => { closePeek(); setOpenTaskId(null); setView('skills'); }}
          taskRef={mdTaskRef}
          // a ref inside the peek SWAPS its subject rather than stacking a second column —
          // one peek at a time, the same rule the app gives every other panel at an edge
          onOpenTask={peekTask}
          subtasks={tasksAll.filter((x) => x.parent_task_id === peekTask2.id)}
          shipGate={projShipGate(tasksAll.find((x) => x.id === peekTask2.id)?.project_id ?? null)}
        />
      </div>
    </>
  ) : null;
  // …and then by the nav head's channel scope on top of the project axis (2026-08-03): All shows
  // the project's whole library, a picked room shows that room's. Same knob as Home and Board.
  // Workspace Files is UNSCOPED by construction — the project axis is the folder grid, not a
  // filter applied before you can look. So it reads `libraryAll`/`attsAll` directly rather than
  // the scoped views above, and normalizes both watches into one row shape.
  const wsFiles = useMemo<WsFile[]>(() => [
    ...libraryAll.filter((a) => !!a.channel_id).map((a): WsFile => ({
      id: a.id, name: a.name, kind: a.kind, mime: a.mime ?? null, size: a.size_bytes ?? null,
      created_at: a.created_at, channel_id: a.channel_id!, channel_slug: a.channel_slug ?? null,
      promoted: !!a.promoted, source: a.task_id ? 'task' : 'room',
      task_number: a.task_number ?? null, inline_content: a.inline_content,
    })),
    ...attsAll.filter((a) => !!a.channel_id).map((a): WsFile => ({
      id: a.id, name: a.name, kind: a.kind, mime: a.mime, size: a.size_bytes,
      created_at: a.created_at, channel_id: a.channel_id!, channel_slug: a.channel_slug ?? null,
      promoted: false, source: 'chat', task_number: null, inline_content: a.inline_content,
    })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at)), [libraryAll, attsAll]);

  // the working roster vs the alumni: retired agents stay synced (attribution, rehire)
  // but leave every live surface — lists, pickers, mentions, counts.
  const activeAgents = roster.agents.filter((a) => !a.retired_at);
  // the machine card's capability read (0118): what a machine can serve, and whose it is
  // ── consent (0119) ────────────────────────────────────────────────────────────────────────
  // Machines joined to their owner's grant, so "may I use this?" is answered the same way here
  // as in the daemon — one shared predicate, never a second opinion in the UI.
  const meId = auth?.user?.id ?? null;
  const machineCaps: MachineCapability[] = useMemo(() => roster.machines.map((m) => ({
    machineId: m.id, ownerUserId: m.owner_user_id ?? '', lastSeenAt: m.last_seen_at,
    runtimes: (() => { try { return JSON.parse(m.runtimes ?? '[]') as string[]; } catch { return []; } })(),
    sharesWith: parseComputePrefs(members.find((x) => x.user_id === m.owner_user_id)?.compute).shares ?? [],
  })), [roster.machines, members]);
  const myPrefs = parseComputePrefs(members.find((x) => x.user_id === meId)?.compute);
  /** where MY next request to this agent would run — the routing answer, distinct from `hosted_on` */
  const placeOf = (a: AgentRow) => placementFor({ id: a.id, runtime: a.runtime ?? 'claude-code', model: a.model }, myPrefs, machineCaps, meId, Date.now());
  const machNameOf = (id: string | null): string | null => roster.machines.find((m) => m.id === id)?.name ?? null;
  // A project's crew = every ACTIVE agent registered to any room the project owns (the same
  // distinct-agents-via-channels join the server runs for agents_count). Mapped by channel ID,
  // never slug — every project seeds a #general/#dev, so slugs collide across projects.
  const agentsByProject = useMemo(() => {
    const chanToProj = new Map<string, string>();
    for (const c of chans) if (c.project_id) chanToProj.set(c.id, c.project_id);
    const m = new Map<string, AgentRow[]>();
    for (const a of activeAgents) {
      const seen = new Set<string>();
      for (const raw of (a.channel_ids ?? '').split(',')) {
        const pid = chanToProj.get(raw.trim());
        if (!pid || seen.has(pid)) continue; // an agent in three rooms of one project counts once
        seen.add(pid);
        m.set(pid, [...(m.get(pid) ?? []), a]);
      }
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chans, roster.agents]);
  // the folded rail's two vitals — the pulse survives the fold even though the detail doesn't.
  // Same predicates the open rail draws from, so the strip can never disagree with it.
  // The fold strip's second vital, inherited by the spine: a room in this project has moved and
  // you have not seen it. It still matters most exactly when the nav is folded away and the
  // channel list is not there to say so. (Its twin — a `N live` count — retired with the strip:
  // the spine's pulse already says work is happening, and a folded rail never needed the tally,
  // only the fact.)
  const anyRoomUnread = scopedChans.some((c) => c.id !== current?.id && !!latestMap[c.id] && latestMap[c.id]! > (lastReadRef.current[c.id] ?? ''));
  // what the nav head's menu shows per room: unread, and how many conversations are in there.
  // Counted off `histInProj`/`scopedTasksAll` — the very rows Recents and ⌘Y render — so the
  // number beside a room and the list you get after picking it can never disagree.

  // The rail is THIS ROOM's line-up, not the workspace directory (round 17b): only agents
  // registered to the active channel appear here. Everyone else lives in the "+" overlay,
  // and adding them there is what makes them show up in the rail — one obvious way in.
  //
  // WORKING-FIRST within that: an agent that claims work rises to the top and falls back
  // when it settles, off the synced `status` column, so it re-sorts on the live roster watch
  // with no timer and no local ordering state. Sorting happens BEFORE the cap, so a busy
  // agent can never be the one hidden behind "+N more".
  const railOrder = useMemo(() => {
    // docs/32: the rail lists the crew of the room you are in. On the workspace Home you are in
    // no room, so it lists the whole crew — scoping it to whichever channel you last visited
    // would hide most of your agents behind a room you are not looking at.
    const onHome = nav === 'home' && view === 'dashboard';
    const pool = roster.agents.filter((a) => !a.retired_at && (onHome || !current?.id || agentInChannel(a.channel_ids, current.id)));
    return [...pool].sort((x, y) => Number(agentBusy(y)) - Number(agentBusy(x)) || x.name.localeCompare(y.name));
  }, [roster.agents, current?.id, nav, view]);

  // the rail's People list — this room's members, falling back to the workspace while the
  // channel_members replica is still empty (a client that hasn't caught up with 0094 yet).
  // Without the fallback a mid-sync boot would render "People 0", which reads as data loss.
  const railPeople = useMemo(() => {
    if (!current?.id || !chanPeople.length) return members;
    const inRoom = new Set(chanPeople.map((p) => p.user_id));
    return members.filter((m) => inRoom.has(m.user_id));
  }, [members, chanPeople, current?.id]);


  // the composer's reachable roster: every active agent (in-room ones summon directly;
  // out-of-room ones the orchestrator offers to add) + every workspace member, by handle
  const composerPeople: ComposerPerson[] = [
    ...activeAgents.map((a) => ({ name: a.name, kind: 'agent' as const, here: agentInChannel(a.channel_ids, current?.id ?? ''), role: a.role, emoji: a.emoji })),
    ...memberPeople(members, activeAgents.map((a) => a.name), auth?.user?.id, auth?.user?.email),
  ];

  const markWelcomed = () => {
    localStorage.setItem('nm:welcomed', '1');
    setWelcomed(true);
  };

  /**
   * Reply at a ROOM MESSAGE — the one way into the two things that have no session of their own:
   * a pinned brief (docs/35 §4.1) and a legacy loose message (§10). It roots a conversation at
   * that message through the docs/31 machinery, with no new command: the send below carries
   * `rootMessageId` and a client-minted `threadId`, the server births the thread, and the
   * message keeps its place as its root. If a conversation is ALREADY rooted there it is joined,
   * not forked — replying twice to the same message must not scatter the answers.
   */
  const replyAtRoot = (messageId: string, body: string, name: string) => {
    const existing = replyCounts.get(messageId)?.threadId;
    if (existing) { openConversation(existing); return; }
    setReplyTo({ kind: 'root', rootMessageId: messageId, threadId: crypto.randomUUID(), toName: name, preview: replyPreview(body) });
    setComposerFocus((n) => n + 1);
  };
  // switching rooms drops any armed reply context (it belonged to the room you left)
  useEffect(() => { setReplyTo(null); }, [current?.id]);
  useEffect(() => {
    if (!nm || !current?.id) { setReplyCounts(new Map()); return; }
    return nm.watchReplyCounts(current.id, (rows) => {
      const next = new Map<string, { threadId: string; n: number; lastAt: string }>();
      for (const r of rows) {
        if (!r.message_id) continue;
        next.set(r.message_id, { threadId: r.thread_id, n: Number(r.n ?? 0), lastAt: r.last_at });
      }
      setReplyCounts(next);
    });
  }, [current?.id]);

  // WHERE THIS SESSION RUNS (rule D9): the chip's choice for the next send, and the designation the
  // send writes — the choice, or the desktop default's Mac; Auto writes nothing and the ladder decides
  const [sessionMachine, setSessionMachine] = useState<string | null>(null);
  const sessionOrigin = NM_PLATFORM === 'web' ? 'web' as const : 'desktop' as const;
  const selfMachineId = boot?.machineName ? roster.machines.find((m) => m.name === boot.machineName)?.id ?? null : null;
  const sessionDesignation = (chosen: string | null) => designationFor({ origin: sessionOrigin, chosen, prefs: parseComputePrefs(members.find((m) => m.user_id === meId)?.compute), selfMachineId });
  const send = async () => {
    const body = draft.trim();
    const attSpecs = atts.specs();
    if ((!body && !attSpecs.length) || atts.busy || !nm || !current) return;
    const t0 = performance.now();
    // guillemet marker (avoids @/#/[[ collisions) — Md renders it as a chip, and
    // the orchestrator parses it to consider the attached skill
    const marker = attachedSkill ? `‹skill:${attachedSkill.name}${attachedSkill.pack ? `@${attachedSkill.pack}` : ''}› ` : '';
    const msgId = atts.msgId();
    const thread = replyTo; // capture before clearing
    setDraft('');
    setAttachedSkill(null);
    setReplyTo(null);
    atts.reset();
    markWelcomed();
    // docs/35 §4.2 — EVERY SEND BIRTHS A SESSION, including this one. docs/34 §8 had listed the
    // room composer as a non-goal because a feed message had no thread to carry a mode; with the
    // feed retired that objection is spent, and a send that landed as a loose room message would
    // now be a row in the legacy pass — a surface built for messages nothing can create any more.
    // A reply keeps the message it answers as its root; a fresh send is its own root, and the
    // toggle rides the birth message so the server can freeze the mode on the thread.
    const threadId = thread?.threadId ?? crypto.randomUUID();
    // No client-declared mode since the Tasks toggle retired (2026-07-29, docs/34 §14): every
    // thread births 'tasks' — the orchestrator triages and decides whether work is filed. The
    // mode column and the CHAT_THREAD floor stay: legacy chat threads keep answering
    // conversationally, exactly as frozen at their birth.
    await nm.send(current.id, marker + consumeWbAttach(body), {
      id: msgId,
      attachments: attSpecs,
      threadId,
      rootMessageId: thread?.rootMessageId ?? msgId,
      // docs/10 §15: the brain the composer was showing. Applied only when this send BIRTHS the
      // thread — the server ignores it on an existing one, the same contract as birth_mode.
      brainOverride: thread ? null : readBrainDraft(),
      // …and where it runs, and which client bore it (0134) — birth-only, like the two above
      threadMachineId: thread ? null : sessionDesignation(sessionMachine),
      threadOrigin: thread ? null : sessionOrigin,
    });
    setSessionMachine(null);
    openConversation(threadId); // …and land in the session you just started
    setNote(`✓ sent in ${Math.max(1, Math.round(performance.now() - t0))}ms · syncing to team`);
    setTimeout(() => setNote(''), 2500);
  };
  const orchName = activeAgents.find((a) => a.role === 'orchestrator')?.name ?? null;
  // welcomed === null means "not resolved yet" — never coach until we know
  const needsFirstSend = welcomed === false && !!orchName && authed;
  const introDraft = `@${orchName} introduce yourself. What can you do for this team?`;
  useEffect(() => {
    // survives relaunches: as long as they've NEVER sent, the draft re-appears
    if (needsFirstSend && !draft && current) setDraft(introDraft);
  }, [needsFirstSend, current?.id]);
  useEffect(() => {
    // fresh machine, existing workspace: the human's history syncs in after
    // first paint — stand down and drop the templated draft if untouched
    if (welcomed === false && msgs.some((m) => m.author_kind === 'human')) {
      markWelcomed();
      setDraft((d) => (d === introDraft ? '' : d));
    }
  }, [msgs, welcomed]);
  const showWelcomeHint = needsFirstSend;

  // persist + apply a chosen theme (or 'system'); the source of truth is localStorage
  const setThemeChoice = (pref: ThemePref) => {
    try { localStorage.setItem('nm:theme', pref); } catch { /* private mode */ }
    setThemePref(pref);
    const r = resolveTheme(pref);
    setTheme(r);
    applyTheme(r);
  };
  // when following the OS, track its day/night changes live
  useEffect(() => {
    if (themePref !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { const r = systemTheme(); setTheme(r); applyTheme(r); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [themePref]);

  // ABOVE the early returns below: a hook after a conditional return runs on some renders and
  // not others, which is the hook-order crash React reports rather than a subtle bug.
  // Every agent face in the app resolves through ONE directory, so the hover card and the
  // detail overlay are the same card wherever you meet an agent (docs/33 §8: new features
  // inherit the idiom rather than rebuilding it). Retired agents stay in it deliberately —
  // their name still appears on old messages, and that face should still open their record.
  // the LIVE row for the open overlay — re-derived on every roster sync, so a save confirms
  // itself instead of the modal rendering what it opened with
  const detailAgent = detailAgentId ? (roster.agents ?? []).find((a) => a.id === detailAgentId) ?? null : null;
  const agentDirectory = useMemo(() => ({
    byName: new Map((roster.agents ?? []).map((a) => [a.name.trim().toLowerCase(), a])),
    open: (a: AgentRow) => { setDetailAgentId(a.id); void refreshCreds(); },
  }), [roster.agents, refreshCreds]);

  // Hooks END here — everything below the boot gate must stay hook-free (Rules of Hooks;
  // the harness caught a violation the day the tree landed, so it is now a stated rule).
  // ONE ask truth (needsyou.ts): the badge count, the tree's row pulses and the group dots all
  // read these two predicates — a second derivation is the defect class the round retires.
  // A SETUP task asks while OPEN — the wizard is the human's checklist, so the ball never
  // leaves their court until it finishes or they cancel — and never after: its `done` has no
  // accept (SETUP_TASK_TRANSITIONS), so letting it fall through to the generic done-arm would
  // queue a button the server refuses forever — the finished-subtask trap, verbatim
  // (needsyou.ts's own docstring). Own branch, so neither list can bleed into the other.
  // the ask predicates live in shell/asks.ts (U3b): the connection bands run them over another
  // connection's rows too, and a predicate copied is a derivation that drifts
  // `needsYou` is the bell's own count (below) — the top dock's card and the bell read ONE
  // number, so the two surfaces cannot disagree about how much is waiting.
  // …as ids a rail row can wear (a decision pulses the thread/task it was asked in)
  const askIds = useMemo(() => {
    const out = new Set<string>();
    for (const t of tasksAll) if (isAskTask(t, roster.agents)) out.add(t.id);
    for (const d of decisionsAll) if (isAskDecision(d)) { if (d.task_id) out.add(d.task_id); else if (d.thread_id) out.add(d.thread_id); }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the predicates close over roster
  }, [tasksAll, decisionsAll, roster.agents]);
  // the bell's rows + count, and the in-flight lane under them. ONE derivation behind the badge
  // and the list — `needsYou` above reads `bell.count`, so the two can never drift apart.
  const { open: bellOpen, setOpen: setBellOpen, leaving: bellLeaving, gone: bellGone, busy: bellBusy, setBusy: setBellBusy, settle: bellSettle } = useBell();
  // SETTLE from the bell (0137): the thread's status, nothing else. Same confirm-then-collapse
  // mechanics the dismiss had: out of the count once the server said yes, never optimistically.
  const bellSettleThread = async (threadId: string, rowId: string) => {
    if (!nm || bellBusy) return;
    setBellBusy(rowId);
    try { await nm.threadSettle(threadId); bellSettle(rowId); }
    catch (e) { flashToast(errMsg(e)); }
    finally { setBellBusy(null); }
  };
  // SETTLE, from every surface that offers it — the rail row, its ⋯ menu, the thread heads and the
  // ⌘Y overlay. There is no standing reverse control anywhere (George, 2026-09-09: "not sure we
  // need the back to needs you button"), so the toast's Undo is the ONLY way back from a settle
  // you did not mean; a thread returns on its own when a new gate or card lands in it.
  const settleThread = async (threadId: string) => {
    if (!nm) return;
    try {
      await nm.threadSettle(threadId);
      flashToast('Settled', { label: 'Undo', run: () => void nm.threadUnsettle(threadId).catch((e) => flashToast(errMsg(e))) });
    } catch (e) { flashToast(errMsg(e)); }
  };
  const bell = useMemo(
    () => bellQueue({ tasks: tasksAll, decisions: decisionsAll, agents: roster.agents, gone: bellGone, leaving: bellLeaving }),
    [tasksAll, decisionsAll, roster.agents, bellGone, bellLeaving],
  );
  // the attention bar's one derivation (failure-alerts round) — the Home bar and the bell's
  // Attention section render from THIS, so the two surfaces can never disagree
  const { alerts, refresh: refreshAlerts, dismiss: dismissAlert } = useAlerts(authed);
  const bellHover = useBellHover(bellOpen, setBellOpen);
  const bellFlightRows = useMemo(
    () => bellFlight({ tasks: tasksAll, convos: convosAll, runs: openRuns }),
    [tasksAll, convosAll, openRuns],
  );
  // a chat row's live status: which agent is streaming into which thread right now. Delta storms
  // must not re-render the shell, so state only changes on start / stop / agent-swap.
  const [liveThreads, setLiveThreads] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!nm) return;
    return nm.watchAgentStream((p) => {
      setLiveThreads((m) => {
        if (p.done) { if (!(p.key in m)) return m; const { [p.key]: _gone, ...rest } = m; return rest; }
        if (m[p.key] === p.agent) return m;
        return { ...m, [p.key]: p.agent };
      });
    });
  }, []);
  const { navW, setNavW, navWDragging, setNavWDragging, setNavWPersist, nudgeNavW } = useLayoutPrefs();
  // the rail's scope (flat round, 2026-08-17) — machine-local, like the fold and the theme. A
  // stale id resolves to All inside `navFlat`, never to an empty rail with no visible way out
  // (the same rule `nm:homescope` follows).
  // where the next popover grows from — one capture-phase listener, above the boot gate with
  // every other App hook (a hook below it "Rendered more hooks than during the previous render"
  // the instant boot resolves). See ui/anchor.ts.
  useEffect(() => watchAnchors(), []);
  const [navScope, setNavScope] = useState<NavScope>(() => {
    try { return { ...emptyNavScope(), ...(JSON.parse(localStorage.getItem('nm:navScope') ?? '{}') as Partial<NavScope>) }; }
    catch { return emptyNavScope(); }
  });
  const putNavScope = (next: NavScope) => {
    setNavScope(next);
    localStorage.setItem('nm:navScope', JSON.stringify(next));
  };
  // the # popover: which project's channel filter is open, and where (viewport coords —
  // the rail scrolls, and a menu anchored inside a scroller is the docs/33 §8 trap)
  // The tree spans the WORKSPACE (2026-08-07): it IS the project list now, so rows narrowed to the
  // active project would leave every other project invisible — which is exactly what shipped in
  // v0.87.0 (one group, the active one). `histAll`/`tasksAll` are the unscoped sets; the tree's
  // own per-project channel filter is the only narrowing it gets.
  const histTreeRows = useMemo(() => [...engineeringHistoryRows(engineeringNav.sessions), ...historyRows({ threads: histAll, tasks: tasksAll, channelId: null, channelSlug: '', query: '' })].sort((a, b) => b.when.localeCompare(a.when)), [engineeringNav.sessions, histAll, tasksAll]);
  const navList = useMemo(() => {
    const keyed = (pick: Set<string>) => new Set(histTreeRows.filter((r) => (r.task && pick.has(r.task.id)) || (r.threadId && pick.has(r.threadId))).map((r) => r.key));
    return navFlat({
      filter: navMode === 'code' ? isCodeRow : isChatRow,
      rows: histTreeRows,
      cap: navView === 'recents' ? 10_000 : undefined, // Recents pages its own rows in the rail; the folders keep the flat cap
      channels: chans,
      // ARCHIVED PROJECTS STAY OUT (2026-08-09). `nm:workspace-meta` deliberately returns every
      // project — the Projects page needs the archived ones to list and unarchive — and navFlat's
      // own `projects` type has no `status` field, so it cannot filter. Neither end was wrong; the
      // filter simply belonged here, at the one consumer that wants only live projects, and was
      // never written. Archiving a project left it sitting in the rail exactly as before.
      projects: wsProjects.filter((p) => p.status !== 'archived'),
      scope: navScope,
      askKeys: keyed(askIds),
      liveKeys: keyed(histLiveIds),
    });
  }, [histTreeRows, chans, wsProjects, askIds, histLiveIds, navScope, navMode, navView]);

  // THE GROUPED RAIL (rail-ink round): Chat mode's folders, one per project — state and list in one hook
  const navGroups = useNavGroups({ filter: navMode === 'code' ? isCodeRow : isChatRow, rows: histTreeRows, channels: chans, projects: wsProjects.filter((p) => p.status !== 'archived'), askIds, liveIds: histLiveIds });
  // THE CONNECTION BANDS (U3b): every other connection's rows through the rail's union, built with the
  // same `historyRows` the foreground's go through, then both lanes under LOCAL · CLOUD
  const navBandsState = useNavBands({ authed, connections: conns, foregroundId: fgConnId, rows: histTreeRows, filter: navMode === 'code' ? isCodeRow : isChatRow, channels: chans, projects: wsProjects.filter((p) => p.status !== 'archived'), askIds, liveIds: histLiveIds, groupFold: { folded: navGroups.folded, expanded: navGroups.expanded } });
  // the cloud machine's state (cloud-cap round) — polled, not watched; see useCompute
  const computeState = useCompute(authed);

  // Until we know who's signed in (auth) and — once authed — whether they need onboarding
  // (boot), show a neutral splash. Otherwise the main app shell flashes for a frame between
  // sign-in and the bootstrap result resolving to the wizard.
  // Local mode (artboards A1–A6): while the stack has not reached `ready` — or a warm boot is still in
  // one of its two waits — the first-run card is the whole screen. The card draws main's state; the
  // splash covers the beat before the first payload and the beat between `ready` and the workspace.
  if (firstRun && firstRun.phase !== 'done' && nm) return <FirstRunDoor state={firstRun} onChoose={(door) => void nm.firstRunChoose?.(door).then(setFirstRun)} onReopen={() => void nm.firstRunReopen?.()} onCancel={() => void nm.firstRunCancel?.().then(setFirstRun)} />;
  if (auth?.mode === 'local' && localStack?.blocking && localStack.state.phase !== 'probing' && nm) {
    return <LocalStackGate payload={localStack} onPick={(r) => void nm.localStackPick?.(r).then(setLocalStack)} onInstall={() => void nm.localStackInstall?.().then(setLocalStack)} onRescan={() => void nm.localStackRescan?.().then(setLocalStack)} onQuit={() => void nm.localStackQuit?.()} />;
  }
  if (!auth || (authed && (!boot || boot.resolving)) || (auth.mode === 'local' && (!localStack || localStack.state.phase === 'probing'))) {
    return <BootSplash stall={authed ? bootStall : null} />;
  }

  if ((auth.mode === 'supabase' || auth.mode === 'clerk') && !auth.user) {
    // the update card rides along: a stale build must be able to update from the sign-in screen
    return <Login mode={auth.mode} onDone={(user) => setAuth({ mode: auth.mode, user })} update={showUpdate ? <UpdateCard signin state={update} onClose={() => setUpdateHidden(updKey)} /> : null} />;
  }

  // AN INVITATION BEATS THE WIZARD (0113). An invited newcomer has zero memberships — the exact
  // signal onboarding keys on — so without this branch the wizard walks someone who was invited
  // to a running team into creating their own empty workspace instead. Only their own explicit
  // "set up my own workspace" (declinedFirstRun) lets the wizard through.
  if (boot?.needsOnboarding && !onboardingActive && !declinedFirstRun && wsInvites.length > 0) {
    return (
      <InvitedFirstRun
        invite={wsInvites[0]!}
        onJoined={() => {
          // the membership exists now; main re-resolves on relaunch, which is also what binds
          // this machine to the workspace they just joined
          doSwitchWorkspace(wsInvites[0]!.workspaceId);
        }}
        onOwnWorkspace={() => { setDeclinedFirstRun(true); setOnboardingActive(true); }}
      />
    );
  }

  if (boot && (boot.needsOnboarding || onboardingActive)) {
    return (
      <Onboarding
        machineName={boot.machineName} local={boot.connection?.authMode === 'local'}
        resumeWorkspaceId={boot.resumeWorkspaceId}
        onDone={(orchestrator, goal) => {
          // Seed the composer so they land one click from the loop: an explicit goal wins; otherwise
          // the orchestrator intro. A fresh workspace always gets it (no machine-level "welcomed" gate).
          if (orchestrator) setDraft(goal ? `@${orchestrator} ${goal}` : `@${orchestrator} introduce yourself. What can you do for this team?`);
          // land ON the seeded composer — a wizard exit anywhere else buries the intro moment
          setNav('home');
          setView('chat');
          setOnboardingActive(false); // release the latch — the wizard owns this exit
          setBoot({ ...boot, needsOnboarding: false });
        }}
      />
    );
  }

  // the channel list only makes sense where channels scope the content (chat, board,
  // skills, library, memory, activity). Code (folders) and Agents (workspace) don't use it.
  // the Retro is workspace-wide like the Agents page — no room context in the nav
  // Home (the old dashboard) is project-scoped now — its composer targets the project's
  // rooms, so the rail keeps Channels/People/Agents there. Workspace-level views
  // (Projects, Agents, Retro, Code) still drop the scoped sections.
  const channelScoped = !((nav === 'home' && view === 'code') || nav === 'agents' || nav === 'retro' || nav === 'projects');
  // the greeting's first name — same resolution the account row uses (profile display
  // name, else the email-derived label); suppressed while it would only say "you"
  const selfFirst = (() => {
    const first = selfLabel(members.find((m) => m.user_id === auth?.user?.id)?.display_name, auth?.user?.email).split(/\s+/)[0];
    return first && first !== 'you' ? first : null;
  })();
  // the chrome's two status marks — sync, and the cloud machine (shell/statuscluster.tsx)
  const statusCluster = (
    <StatusCluster live={roster.agents.some((a) => a.status === 'working' || a.status === 'thinking' || a.status === 'review')}
      connected={connected} queuedWrites={queuedWrites} syncedOnce={syncedOnce} compute={computeState}
      connection={boot?.connection?.kind}
      onOpenCompute={() => { setNav('home'); setView('compute'); }} />
  );

  // Mission Control is deliberately workspace-wide (docs/12 §6): a blocked agent in
  // ANY project needs you, so the nav badge counts across projects, not scopedTasksAll.
  // …and it counts exactly what HomeView queues: a gate you already answered in the thread
  // is out of both (needsyou.ts), so the badge can never disagree with the page it opens.

  // ⌘K items build from live state at render (docs/12 slice 3). Accept-all runs the
  const buildCmdkItems = (): CmdItem[] => {
    const ready = tasksAll.filter((t) => t.state === 'done');
    // same rule as the queue and the badge — ⌘K must not offer to re-answer what you answered
    const openDecs = decisionsAll.filter((d) => d.status === 'open' && !decisionHandled(d));
    // born-approved units (a routine's hands-off create) rest in plan_review with the stamp set — nothing to review
    const planQ = tasksAll.filter((t) => t.state === 'plan_review' && !t.plan_approved_at && actionableByHuman(t) && !awaitingAgent(t));
    const items: CmdItem[] = [
      { group: 'Create', icon: <IconThreads s={13} />, label: 'Fan out a task', sub: `describe it in #${current?.slug ?? 'general'} — the orchestrator takes it from there`, run: () => { setNav('home'); setView('chat'); } },
    ];
    // ACCEPT LEFT THE PALETTE (2026-09-08): a done task is landed by saying merge in its thread. The
    // ready ones still jump, so the word is one keystroke from wherever you are.
    for (const t of ready.slice(0, 6)) items.push({ group: 'Needs you', icon: <IconCheck s={13} />, label: `#${t.number} passed review — ${t.title}`, sub: t.pr_number ? `say merge in the thread to land PR #${t.pr_number}` : 'say accept in the thread to close it', run: () => openTaskFromAnywhere(t.id) });
    for (const d of openDecs.slice(0, 6)) items.push({ group: 'Needs you', icon: <IconInbox s={13} />, label: `Answer: ${d.question}`, sub: `${d.task_number != null ? `#${d.task_number} · ` : ''}#${d.channel_slug} — opens Home`, run: () => { setNav('home'); setView('dashboard'); } });
    for (const t of planQ.slice(0, 4)) items.push({ group: 'Needs you', icon: <IconBoard s={13} />, label: `Review plan #${t.number} — ${t.title}`, run: () => openTaskFromAnywhere(t.id) });
    // ⌘K spans every room in the workspace, so a jump can land you OUTSIDE the active project.
    // Take the project with you: the room's own lists are scoped to it now, so arriving without
    // switching would open a room whose conversations, board and sidebar all belong to somewhere
    // else — the same divergence this pass exists to close. The notification deep-link already
    // switches (see nm.onOpenThread); this is the same move from the palette.
    // …and every project is seeded with the same starter slugs, so a bare `#dev` names two rooms:
    // name the project on the ones that collide.
    const slugDupes = new Set(chans.filter((c, i) => chans.findIndex((x) => x.slug === c.slug) !== i).map((c) => c.slug));
    for (const c of chans) {
      const pn = slugDupes.has(c.slug) ? wsProjects.find((p) => p.id === c.project_id)?.slug ?? null : null;
      items.push({
        group: 'Jump to', icon: <span className="cmdkhash">#</span>, label: `#${c.slug}`,
        sub: [pn, c.topic].filter(Boolean).join(' · ') || undefined,
        // openRoom, not a bare setCurrent: jumping to a room SCOPES to it, so the nav head, the
        // board, Automations, the Library and Recents all arrive where you asked to be
        run: () => { if (c.project_id && c.project_id !== activeProj?.id) setActiveProject(c.project_id); openRoom(c); },
      });
    }
    for (const t of tasksAll.filter((x) => !['closed', 'accepted'].includes(x.state)).slice(0, 12)) {
      items.push({ group: 'Jump to', icon: <IconBoard s={13} />, label: `#${t.number} ${t.title}`, sub: `${STATE_LABEL[t.state as keyof typeof STATE_LABEL] ?? t.state} · #${t.channel_slug}`, run: () => openTaskFromAnywhere(t.id) });
    }
    // projects: fast switching lost zero keystrokes when the head dropdown retired — the
    // palette carries per-project switch commands plus the page + create entries
    for (const p of wsProjects.filter((x) => x.status === 'active' && x.id !== activeProj?.id)) {
      items.push({ group: 'Projects', icon: <IconGrid s={13} />, label: `Switch to ${p.slug}`, sub: p.open_tasks ? `${p.name} · ${p.open_tasks} open` : p.name, run: () => { setActiveProject(p.id); setNav('home'); setView('dashboard'); } });
    }
    items.push({ group: 'Projects', icon: <IconGrid s={13} />, label: 'All projects', sub: 'the Projects page — cards, settings, archive', run: () => setNav('projects') });
    items.push({ group: 'Jump to', icon: <IconHistory s={13} />, label: current ? `#${current.slug} history` : 'Search every thread', sub: current ? 'every thread this room has had · ⌘Y' : 'across every room · ⌘Y', run: () => setHistOpen(true) });
    items.push({
      group: 'Projects', icon: <IconProject s={13} />, label: 'New project',
      run: () => { setCreateProjectOrigin(null); setCreateProjectOpen(true); },
    });
    const views: Array<[React.ReactNode, string, () => void]> = [
      [<IconHome s={13} key="v-mc" />, 'New chat', () => newChat()],
      [<IconThreads s={13} key="v-th" />, 'Threads', () => { setNav('home'); setView('chat'); }],
      [<IconBoard s={13} key="v-bd" />, 'Tasks', () => { setNav('home'); setView('board'); }],
      [<IconWhiteboard s={13} key="v-wb" />, 'Whiteboards', () => { setNav('home'); setView('whiteboards'); }],
      // Automations was missing from this list entirely; adding its Calendar half without it would
      // leave the palette naming a child whose parent it has never heard of.
      [<IconRepeat s={13} key="v-au" />, 'Scheduled · Routines', () => { setNav('home'); setView('automations'); }],
      [<IconCalendar s={13} key="v-ca" />, 'Content calendar', () => { setNav('home'); setView('calendar'); }],
      [<IconTrend s={13} key="v-mk" />, 'Marketing OS', () => { setNav('home'); setView('marketing'); }],
      [<IconCode s={13} key="v-en" />, 'Code', () => { setNav('home'); setView('engineering'); }],
      [<IconFootprint s={13} key="v-fp" />, "Agents' footprint", () => { setNav('home'); setView('footprint'); }],
      [<IconCredits s={13} key="v-cr" />, 'Credits', () => { setNav('home'); setView('credits'); }],
      [<IconHistory s={13} key="v-hi" />, 'History', () => setHistOpen(true)],
      [<IconSkill s={13} key="v-sk" />, 'Skills', () => { setNav('home'); setView('skills'); }],
      [<IconAgents s={13} key="v-ag" />, 'Agents', () => setNav('agents')],
      [<IconLibrary s={13} key="v-li" />, 'Files', () => setNav('artifacts')],
      [<IconMemory s={13} key="v-me" />, 'Memory', () => { setNav('home'); setView('memory'); }],
      [<IconActivity s={13} key="v-ac" />, 'Activity', () => setNav('logs')],
      [<IconMedal s={13} key="v-re" />, 'Retro', () => setNav('retro')],
    ];
    for (const [icon, label, run] of views) items.push({ group: 'View', icon, label, run });
    return items;
  };
  // a clickable section header that collapses its body (side dock); the chevron hints state.
  // `count` rides the label so a collapsed band still says how much it hides.
  const secHd = (key: string, label: string, extra?: React.ReactNode, count?: number) => (
    <div className="navsecthd" data-tour={`sect-${key}`}>
      <button className="navsecttoggle" onClick={() => toggleSec(key)} aria-expanded={!navSec[key]} data-tip={`${navSec[key] ? 'Expand' : 'Collapse'} ${label}`}>
        <span className={`navchev${navSec[key] ? ' c' : ''}`} aria-hidden><IconChevron s={12} /></span>
        {label}
        {count ? <span className="navsectcnt">{count}</span> : null}
      </button>
      {extra}
    </div>
  );
  // The account trigger. In a SIDE dock it is a door, not a surface (2026-08-04): clicking it
  // opens the projects face with its account footer already expanded, so the workspace column has
  // ONE panel instead of a panel plus a popover that opened 40px away with a second identity
  // header in it. The TOP dock has no spine and no face, so there it keeps the flyout — the menu
  // below is now that dock's account surface and nothing else's.
  const acctName = selfLabel(members.find((m) => m.user_id === auth?.user?.id)?.display_name, auth?.user?.email);
  const accountBlock = (
    <div className="navacct">
      <button
        // the walkthrough's third stop — present in BOTH docks, unlike the anchors it replaced
        data-tour="account"
        className={`navuser${acctOpen ? ' on' : ''}`}
        title={`${acctName} · ${planLabel(plan)} · account`}
        aria-haspopup={navPos === 'top' ? 'menu' : undefined}
        aria-expanded={acctOpen}
        onClick={() => {
          if (navPos === 'top') { setAcctOpen((o) => !o); return; }
          // side dock: reveal the face AND its footer in one gesture, and pin it — this was a
          // click on an avatar, not a pointer drifting past the rail, so it should stay put
          setAcctOpen(true);
          setFaceState({ face: 'projects', pinned: true, pending: null });
        }}
      >
        <span className="navuserav">{selfInitial(auth?.user?.email)}</span>
      </button>
      {acctOpen && navPos === 'top' && (
        <AccountMenu
          user={auth?.user ?? null}
          displayName={acctName}
          isCloud={isCloud} local={boot?.connection?.kind === 'local'}
          navPos={navPos}
          workspaces={wsList}
          activeWorkspace={boot?.workspaceId ?? ''}
          onSwitchWorkspace={setWsSwitchTarget}
          onClose={() => setAcctOpen(false)}
          onWorkspace={() => { setWsOpen(true); void refreshCreds(); }}
          onProfile={() => setProfileOpen(true)}
          onUpgrade={() => setUpgradeOpen(true)}
          onTour={() => { try { localStorage.removeItem('nm:toured'); } catch { /* private mode */ } setTourOpen(true); }}
          onSignout={() => void nm?.logout()}
          onAppearance={() => setAppearanceOpen(true)}
          onNavPos={setNavPosPersist}
          onAgents={() => setNav('agents')}
          onFootprint={() => { setNav('home'); setView('footprint'); }}
          onCompute={() => { setNav('home'); setView('compute'); }}
          onCredits={() => { setNav('home'); setView('credits'); }}
          onRetro={() => setNav('retro')}
        />
      )}
    </div>
  );
  // Workspace views — row 1 in top dock, but inside the scroll region in side dock so it
  // scrolls together with the channels/people/agents below it. Collapse applies to side only.
  // the destinations block (surfaces/NavWorkspaceCard.tsx)
  const workspaceCard = <NavWorkspaceCard {...{ moreOpen, nav, navPos, navSec, needsYou: bell.count, onWorkbench: () => openWPane(!wpane), roomContent, roomOpenTasks, roomRoutines, secHd, setMoreOpen, setNav, setView, view, wbOpen: wpane && workbenchApplies(view, wbSessionOpen) && !!wb.subject }} />;
  return (
    <AgentDirectory.Provider value={agentDirectory}>
    <FailoverBannerContext.Provider value={!!flyupOn}>
    <div className="shell" data-navpos={navPos}>
      {/* frame top bar — the window frame owns the global chrome (Cabinet-grade shell):
          wordmark · the fold · ⌘K. Hidden in top-dock mode (that row IS the chrome).
          The project › surface crumb RETIRED 2026-09-04 (rail-ink round, George — the Gemini
          head): the project already lives in the rail's scope row and the surface in its
          workspace tab, so the crumb was saying two things twice. */}
      {navPos !== 'top' && (
        <header className="frametop">
          <span className="ftbrand"><BrandLockup size={13} /></span>
          {/* THE fold control. It lives here, not on the rail, because the frame top is the one
              strip that is chrome in every view — so the rail can be folded (and found again)
              from a full-screen task or a board, not only from the rail itself. It wears the
              same dock glyph as the position segment in the account menu (a chevron here would
              read as another crumb separator), pressed-in while the rail is away. */}
          <button
            className={`ftfold${navFolded ? ' folded' : ''}`}
            aria-pressed={navFolded}
            aria-label={navFolded ? 'Show the sidebar' : 'Hide the sidebar'}
            data-tip={navFolded ? 'Show the sidebar · ⌘\\' : 'Hide the sidebar · ⌘\\'}
            onClick={() => foldNav(!navFolded)}
          >{navPos === 'right' ? <IconDockRight s={14} /> : <IconDockLeft s={14} />}
            {/* folded, the nav's workspace foot is gone with the column — so its unread dot rides
                here. A fold must not cost information (docs/33 §8's rail rule, applied to the nav). */}
            {navIsFolded && anyRoomUnread && <span className="ftfolddot" aria-hidden />}</button>
          {/* the label is a SPAN so the pill can shrink beside the utilities — a bare text
              node has no min-width and drags the frame top into overflow at narrow widths */}
          <button className="ftsearch" onClick={() => setCmdkOpen(true)} aria-label="Search (⌘K)">⌕ <span className="ftslbl">Search — channels, tasks, artifacts</span> <b>⌘K</b></button>
          {/* the topbar's ＋New task ▾ moved into the rail's New chat caret (2026-07-30):
              two creation verbs at opposite corners of the frame answered one question twice */}
          {/* the ambient utilities (the shell round, 2026-08-10) — the bottom dock strip's whole
              cluster, rehomed after the search: they show on almost every page, so they live on
              the chrome row that does. No ⌘K tile here — the search pill IS that door. */}
          <span className="ftutils">
            <UtilCluster activeKind={wtabs.find((x) => x.id === wactive)?.kind ?? null} onKind={openKindTab}
              dockOpen={dockOpen} onDock={() => openDock(!dockOpen)}
              procCount={procCount} procOpen={procOpen} onProc={() => setProcOpen((v) => !v)}
              procs={procsView} onKill={onKillProc} status={statusCluster} overflow />
          </span>
        </header>
      )}
      {launcher && (
        <LauncherModal
          mode={launcher.mode}
          channels={chans}
          projects={wsProjects}
          initialChannelId={current?.id ?? null}
          orchName={activeAgents.find((a) => a.role === 'orchestrator')?.name ?? 'rex'}
          plan={isCloud ? 'cloud' : 'free'}
          onUpgrade={() => setUpgradeOpen(true)}
          onClose={() => setLauncher(null)}
          onOpenRoom={openRoom}
        />
      )}
      {createOpen && (
        <CreateAgent
          channels={chans}
          projects={wsProjects}
          prefillName={createPrefill}
          prefillChannelId={createPrefill ? current?.id ?? null : null}
          onClose={() => { setCreateOpen(false); setCreatePrefill(''); }}
          onDone={() => void refreshRoster()}
        />
      )}
      {addAgentsOpen && current && (
        <AddAgentsOverlay
          agents={activeAgents}
          channel={current}
          scopedTasks={scopedTasksAll}
          onAdd={async (a) => {
            try {
              const r = await nm?.addAgentToChannel(current.id, a.name);
              if (r?.ok) { flashToast(`Added @${a.name} to #${current.slug}`); await refreshRoster(); }
            } catch { flashToast('Could not add agent'); }
          }}
          onRemove={async (a) => {
            try {
              const r = await nm?.removeAgentFromChannel(current.id, a.name);
              if (r?.ok) { flashToast(`Removed @${a.name} from #${current.slug}`); await refreshRoster(); }
            } catch { flashToast('Could not remove agent'); }
          }}
          onCreate={(prefill) => { setAddAgentsOpen(false); setCreatePrefill(prefill); setCreateOpen(true); void refreshCreds(); }}
          onConnectRemote={() => { setAddAgentsOpen(false); setAddRemoteOpen(true); }}
          onClose={() => setAddAgentsOpen(false)}
        />
      )}
      {addPeopleOpen && current && (
        <AddPeopleOverlay
          members={members}
          inRoomIds={new Set(railPeople.map((p) => p.user_id))}
          channel={current}
          meId={auth?.user?.id ?? null}
          selfEmail={auth?.user?.email}
          onAdd={async (m) => {
            try {
              const r = await nm?.addPersonToChannel(current.id, m.user_id);
              if (r?.ok) { flashToast(`Added ${m.display_name ?? 'them'} to #${current.slug}`); setPeopleTick((t) => t + 1); }
            } catch { flashToast('Could not add them to this room'); }
          }}
          onRemove={async (m) => {
            try {
              const r = await nm?.removePersonFromChannel(current.id, m.user_id);
              if (r?.ok) { flashToast(`Removed ${m.display_name ?? 'them'} from #${current.slug}`); setPeopleTick((t) => t + 1); }
            } catch { flashToast('Could not remove them from this room'); }
          }}
          onInvite={() => { setAddPeopleOpen(false); setInviteOpen(true); }}
          onClose={() => setAddPeopleOpen(false)}
        />
      )}
      {addRemoteOpen && (
        <AddRemoteAgent channels={chans} projects={wsProjects} onClose={() => setAddRemoteOpen(false)} onDone={() => void refreshRoster()} />
      )}
      {inviteOpen && (
        <Modal title="Invite people" onClose={() => setInviteOpen(false)} anchored origin={anchorPoint()}>
          <InviteTeammate isCloud={isCloud} onUpgrade={() => { setInviteOpen(false); setUpgradeOpen(true); }} />
        </Modal>
      )}
      {detailAgent && (
        <AgentDetails agent={detailAgent} channels={chans} projects={wsProjects} creds={creds} isCloud={isCloud}
          place={(() => {
            const p = placeOf(detailAgent);
            const mine = machNameOf(p.machineId);
            return { on: detailAgent.hosted_on ?? null, mine,
              why: p.why === 'failover' ? 'lent to you; yours cannot serve this runtime'
                : p.why === 'agent-choice' ? 'your pick for this agent'
                  : p.why === 'default' ? 'your default machine' : null };
          })()}
          onClose={() => setDetailAgentId(null)} onUpgrade={() => { setDetailAgentId(null); setUpgradeOpen(true); }} onSaved={() => void refreshCreds()} />
      )}
      {activityAgent && <AgentActivity agent={activityAgent} focusRunId={activityRun} onClose={() => { setActivityAgent(null); setActivityRun(null); }} />}
      {/* Archive undo — SHELL level, so it fires whichever of the three row renderers you archived
          from (nav rail · room list · ⌘Y overlay). It used to live inside the room feed only. */}
      {/* `afloat`, not `shell`: the floating variant used to wear the app shell's own class
          name, which handed a toast `height: 100vh` and the frame's padding — a full-height
          slab pinned to the bottom (found live, R4) */}
      {archUndo && (
        <div className="archundo afloat" role="status">
          <span><b>{plainTitle(archUndo.title)}</b> archived — it&rsquo;s in Settings › Archived chats.</span>
          <button type="button" onClick={() => void undoArchive()}>Undo</button>
        </div>
      )}
      {wsOpen && <WorkspaceSettings creds={creds} user={auth?.user ?? null} repos={meta.reposAll} isCloud={isCloud} focusProvider={focusProvider} focusPolicy={focusPolicy} focusTab={focusTab}
        workspaceId={boot?.workspaceId ?? ''} workspaceName={boot?.workspace.name || 'this workspace'}
        isOwner={members.find((m) => m.user_id === auth?.user?.id)?.role === 'owner'}
        machines={roster.machines} members={members} agents={roster.agents} selfMachineName={boot?.machineName ?? null}
        onAddRepo={() => setAddRepoOpen(true)} onUpgrade={() => { setWsOpen(false); setUpgradeOpen(true); }} onClose={() => { setWsOpen(false); setFocusProvider(null); setFocusPolicy(false); setFocusTab(null); }} onSaved={() => void refreshCreds()} />}
      {imageConnectOpen && (
        <DocOverlay title="Connect an image model" onClose={() => setImageConnectOpen(false)}>
          <div className="mkimgconnect"><ImageKeyForm onSaved={() => { void refreshCreds(); setImageConnectOpen(false); }} /></div>
        </DocOverlay>
      )}
      {profileOpen && <ProfileModal user={auth?.user ?? null} member={members.find((m) => m.user_id === auth?.user?.id)} channels={chans} projects={wsProjects} onClose={() => setProfileOpen(false)} onSave={async (dn) => { await nm!.updateProfile(dn); }} />}
      {addRepoOpen && (
        <AddRepoModal
          channelSlug={current?.slug}
          onClose={() => setAddRepoOpen(false)}
          onAdded={() => { if (current && nm) void nm.channelMeta(current.id).then(setMeta).catch(() => {}); }}
        />
      )}
      {createProjectOpen && (
        <CreateProjectModal
          origin={createProjectOrigin}
          onClose={() => setCreateProjectOpen(false)}
          onCreated={(id) => {
            refreshProjectsSoon();
            // The new project has to replicate to the local replica before it can be made
            // active — the same reason a new room is polled for below. Switching to an id
            // `wsProjects` has never seen did the opposite of what it says: `activeProj`
            // resolved through the fallback to the workspace DEFAULT project, and the
            // reconcile effect then wrote that fallback back over the pick. Creating a
            // project landed you in `default`, while localStorage kept the new id — so the
            // switch you asked for arrived on the NEXT app launch.
            let tries = 0;
            const pick = () => void nm?.workspaceMeta().then((m) => {
              setWsProjects(m.projects);
              if (m.projects.some((p) => p.id === id)) setActiveProject(id);
              else if (tries++ < 15) setTimeout(pick, 200);
            }).catch(() => { if (tries++ < 15) setTimeout(pick, 200); });
            pick();
          }}
        />
      )}
      {/* Project settings edits a project that may not be the one you are standing in, so its
          repo list stays the WORKSPACE's rather than the active room's project — its prior
          behaviour, deliberately not narrowed by the scoping fix. */}
      {manageProject && (
        <ManageProjectModal
          project={manageProject}
          onSetProjectPack={setProjectPack}
          onBrainConnect={(p) => { setFocusProvider(p); setWsOpen(true); void refreshCreds(); }}
          repos={meta.reposAll}
          initialDelete={manageDelete}
          onClose={() => { setManageProject(null); setManageDelete(false); }}
          onChanged={() => { refreshProjectsSoon(); }}
          onAddRepo={() => setAddRepoOpen(true)}
        />
      )}
      {createChannelOpen && activeProj && (
        <CreateChannelModal
          projectId={activeProj.id}
          projectName={activeProj.name}
          onClose={() => setCreateChannelOpen(false)}
          onCreated={(id) => {
            refreshProjectsSoon();
            // the new room must replicate to the local replica before we can select it — poll briefly
            let tries = 0;
            const pick = () => void nm?.channels().then((rows) => {
              const c = rows.find((r) => r.id === id);
              if (c) { setNav('home'); setCurrent(c); markRead(c.id); }
              else if (tries++ < 10) setTimeout(pick, 200);
            }).catch(() => {});
            pick();
          }}
        />
      )}
      {manageChannel && (
        <ChannelSettingsModal
          channel={manageChannel}
          onClose={() => setManageChannel(null)}
          onChanged={() => { refreshProjectsSoon(); }}
          onDeleted={(id) => { setManageChannel(null); if (current?.id === id) setCurrent(null); refreshProjectsSoon(); }}
        />
      )}
      {currentLive && currentLive.slug === 'marketing' && currentLive.kind !== 'marketing' && !kindPromptSeen.has(currentLive.id) && (
        <MarketingUpgradePrompt
          onConvert={() => { const id = currentLive.id; setKindPromptSeen((p) => new Set(p).add(id)); void nm?.channelKind(id, 'marketing'); setView('chat'); refreshChannelsSoon(); }}
          onClose={() => setKindPromptSeen((p) => new Set(p).add(currentLive.id))}
        />
      )}
      {/* The upload's room picker. A file's readers ARE that room's registered agents, so the
          room is a permission grant and gets asked for out loud rather than inferred. */}
      {uploadTo && (() => {
        const p = wsProjects.find((x) => x.id === uploadTo);
        const rooms = chans.filter((c) => c.project_id === uploadTo);
        return (
          <Modal title={`Add files to ${p?.name ?? 'this project'}`} onClose={() => setUploadTo(null)}
            subtitle="Pick the room these files belong to — every agent registered there will be able to read them.">
            {!rooms.length && <p className="mkpromptbody">This project has no rooms yet. Create one from the channel list first.</p>}
            <div className="uproomlist">
              {rooms.map((c) => {
                const readers = roster.agents.filter((a) => !a.retired_at && agentInChannel(a.channel_ids, c.id));
                return (
                  <button key={c.id} className="uproom" disabled={!!uploading} onClick={async () => {
                    setUploading(c.slug);
                    setUploadTo(null);
                    const r = await nm?.fileUpload(c.id).catch(() => null);
                    setUploading(null);
                    if (!r) setUploadNote('Upload failed — nothing was added.');
                    else if (!r.added && !r.skipped.length) setUploadNote(null);
                    else setUploadNote(`${r.added} added to #${c.slug}${r.skipped.length ? ` · skipped: ${r.skipped.join(', ')}` : ''}`);
                  }}>
                    <b>#{c.slug}</b>
                    <span>{readers.length ? `${readers.map((a) => a.name).join(', ')} can read` : 'no agents registered — nobody can read these yet'}</span>
                  </button>
                );
              })}
            </div>
          </Modal>
        );
      })()}
      {uploadNote && (
        <div className="nmtoast" role="status" onAnimationEnd={() => setUploadNote(null)}>{uploadNote}</div>
      )}
      {appearanceOpen && <AppearancePanel pref={themePref} active={theme} onPick={setThemeChoice} onClose={() => setAppearanceOpen(false)} />}
      {moveOpen && <MoveToCloudSheet onClose={() => setMoveOpen(false)} />}
      {upgradeOpen && !(isCloud && boot?.connection?.kind === 'cloud') && <UpgradeSheet reason={upgradeReason ?? undefined} onClose={() => { setUpgradeOpen(false); setUpgradeReason(null); }} />}
      {/* switching relaunches the app, so it is never a one-click act (0113) */}
      {wsSwitchTarget && (
        <SwitchWorkspaceSheet
          target={wsSwitchTarget}
          onCancel={() => setWsSwitchTarget(null)}
          // a workspace on another connection (U3b) is the rail's own swap; on this one, the switch as before
          onConfirm={() => { const cid = wsSwitchTarget.connectionId; if (cid && cid !== fgConnId && nm?.setForeground) void nm.setForeground(cid, wsSwitchTarget.id).catch((e: unknown) => { console.error('foreground swap failed', e); setWsSwitchTarget(null); }); else doSwitchWorkspace(wsSwitchTarget.id); }}
        />
      )}
      {navRevoke && (
        <RevokeShare member={navRevoke.member} count={navRevoke.count}
          onConfirm={navRevoke.apply} onClose={() => setNavRevoke(null)} />
      )}
      {computeIntro && boot && (
        <ComputeIntro workspaceName={boot.workspace.name} machines={roster.machines} members={members}
          agents={roster.agents} selfUserId={auth?.user?.id ?? null} selfMachineName={boot.machineName}
          askChannelId={chans[0]?.id ?? null}
          onDone={() => { localStorage.setItem(`nm:computecard:${boot.workspaceId ?? boot.workspace.slug}`, '1'); setComputeIntroSeen(true); }} />
      )}
      {machineLimit && <MachineLimitModal message={machineLimit.message} onTransfer={() => { void nm?.machineTransfer?.(); }} onUpgrade={() => { setMachineLimit(null); setUpgradeOpen(true); }} onClose={() => setMachineLimit(null)} />}
      {marketplaceOpen && <Marketplace isCloud={isCloud} onUpgrade={() => { setMarketplaceOpen(false); setUpgradeOpen(true); }} onClose={() => setMarketplaceOpen(false)} />}
      {toast && (
        <div className="nmtoast">
          {toast.msg}
          {toast.undo && <button type="button" className="nmtoastundo" onClick={() => { toast.undo!.run(); dismissToast(); }}>{toast.undo.label}</button>}
        </div>
      )}
      {showUpdate && navPos === 'top' && <UpdateCard floating state={update} onClose={() => setUpdateHidden(updKey)} />}
      {tourOpen && rosterReady && <Walkthrough onDone={() => setTourOpen(false)} />}
      {/* THE SPINE RETIRED (2026-08-16) — its 30px went back to the sheet and the workspace
          moved to the FOOT of the nav column (`NavWorkspaceFoot`, rendered inside the rooms face
          below). Everything it carried came along: the live pulse, the unread dot, the face's
          hover/click trigger and the account. The fold's chevron did not — with no strip at the
          edge there is nothing to unfold from, and the frame top's `.ftfold` has always been the
          control docs/33 §2 names. */}
      {/* unified dockable nav — channels · recents, plus the top dock's view strip.
          one panel, placed left (default) / top / right; data-pos drives the compact top variant.
          data-folded collapses a side dock to nothing — the spine beside it is already the strip
          (tokens.css: "one fold idiom, not two"). The panel stays mounted so the width animates
          and every scroll position survives the fold. */}
      <nav
        className="navpanel"
        data-pos={navPos}
        data-folded={navIsFolded ? '1' : undefined}
        data-dragging={navWDragging ? '1' : undefined}
        // the width rides a CSS var, not an inline width: the folded rule ([data-folded]) must
        // keep winning, and an inline style would outrank it (the shell round, 2026-08-10)
        style={navPos !== 'top' ? ({ '--nm-navw': `${navW}px` } as React.CSSProperties) : undefined}
        // the face's hover region is the spine AND the column it opens into — a diagonal move
        // from the strip onto a project row must not cross "outside" and dismiss it mid-reach
        // Opening is the FOOT's job; closing is leaving the column. Splitting the two is what
        // makes a flip impossible: nothing inside the panel can schedule a close, so the face
        // cannot be dismissed by the very reveal that put it there.
        onMouseEnter={() => cancelArm()}
        onMouseLeave={() => { if (!navIsFolded) armFace(false); }}
      >
        {/* THE TWO FACES — same column, same width, no shadow (v0.76 slice 2). BOTH stay mounted,
            stacked in one grid cell: unmounting the loser gave the swap an entrance and no exit
            (an instant cut, docs/33 §7) and threw away the rooms face's Recents scroll every time.
            `data-on` drives the cross; the top dock has no spine, so it has no second face. */}
        <div className="navfaces">
        {navPos !== 'top' && (
          <ProjectsFace
            on={navFace === 'projects'}
            workspace={boot?.workspace.name || ''}
            workspaceInitial={(boot?.workspace.name?.[0] ?? 'N').toUpperCase()}
            isCloud={isCloud}
            account={{ initial: selfInitial(auth?.user?.email), name: acctName, email: auth?.user?.email ?? null }}
            navPos={navPos}
            workspaces={wsList}
            activeWorkspace={boot?.workspaceId ?? ''}
            footprintPct={footprintPctOf(footprint)}
            onSwitchWorkspace={(w) => { closeFace(); setWsSwitchTarget(w); }}
            // the connections (U3b, artboard B4) — New workspace is the wizard, the desktop's one workspace-creation flow
            connections={nm?.connections ? conns : null} foregroundConnection={fgConnId} liveConnections={new Set((navBandsState.bands ?? []).filter((b) => b.live).map((b) => b.id))}
            onPickWorkspace={(cid, w) => { closeFace(); setWsSwitchTarget({ ...w, connectionId: cid }); }} onConnections={() => { closeFace(); setFocusTab('connections'); setWsOpen(true); }}
            onNewWorkspace={() => { closeFace(); setOnboardingActive(true); }} onGetPro={() => { closeFace(); setUpgradeReason(null); setUpgradeOpen(true); }}
            onMoveToCloud={moveDoor === 'none' ? undefined : () => { closeFace(); if (moveDoor === 'move') openMoveToCloud(); else { setUpgradeReason(null); setUpgradeOpen(true); } }}
            onAll={() => { closeFace(); setNav('projects'); }}
            onUpgrade={() => { closeFace(); setUpgradeOpen(true); }}
            onAgents={() => { closeFace(); setNav('agents'); }}
            onFootprint={() => { closeFace(); setNav('home'); setView('footprint'); }}
            onCompute={() => { closeFace(); setNav('home'); setView('compute'); }}
            onCredits={() => { closeFace(); setNav('home'); setView('credits'); }}
            onRetro={() => { closeFace(); setNav('retro'); }}
            onWorkspace={() => { closeFace(); setWsOpen(true); void refreshCreds(); }}
            onProfile={() => { closeFace(); setProfileOpen(true); }}
            onTour={() => { closeFace(); try { localStorage.removeItem('nm:toured'); } catch { /* private mode */ } setTourOpen(true); }}
            onSignout={() => void nm?.logout()}
            onAppearance={() => { closeFace(); setAppearanceOpen(true); }}
            onNavPos={setNavPosPersist}
          />
        )}
        <div className="navface rooms" data-on={navFace === 'rooms' || navPos === 'top' ? '1' : '0'}>
        {/* header — the project block, TOP DOCK ONLY. In a side dock the project moved to the
            spine: a name at the top of a column promises the column, and Home's count spans the
            workspace (docs/12 §6). The top dock is a row, so nothing sits "under" the name there. */}
        {navPos === 'top' && (
        <div className="navhead">
          <button data-tour="project" className={`navhead-main${nav === 'projects' ? ' on' : ''}`} onClick={() => setNav('projects')} title="All projects">
            <span className="navbadge" aria-hidden>
              {/* the active project's detected logo when it has one; on load failure the img hides itself and the initial shows through */}
              {activeProj?.logo_url && <img className="navbadgelogo" src={activeProj.logo_url} alt="" draggable={false} onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
              {(boot?.workspace.name?.[0] ?? 'N').toUpperCase()}
            </span>
            <span className="wsproj">
              <span className="wsswitch-txt">
                {/* name can be '' while an offline boot awaits workspace resolution — show the neutral placeholder, not a blank header */}
                <b>{activeProj?.slug ?? (boot?.workspace.name || 'neuramesh')}</b>
                <small>{boot?.workspace.name || '…'}</small>
              </span>
              <span className="wscaret" aria-hidden><IconGrid s={13} /></span>
            </span>
          </button>
        </div>
        )}
        {/* Workspace card — row 1 in top dock (fixed); in side dock it renders inside the scroll below */}
        {navPos === 'top' && workspaceCard}
        {/* scoped context — channels · people · agents · machines. Only for channel-scoped
            views (Threads/Board/Library/Memory/Activity); hidden on Code + the Agents page. */}
        <div className="navscroll">
          {/* the WORKSPACE view group left the side rail (conversation-first shell): Home is
              where you already are, Board + the rest live behind the top-right view menu,
              and Agents/Retro moved into the account menu. The top dock keeps its strip. */}
          {channelScoped && (navPos === 'top' ? (
            /* TOP — second row: channel pills + people/agent avatar clusters + machine chip */
            <div className="navctx">
              <div className="navctxgrp">
                {scopedChans.map((c) => {
                  const unread = c.id !== current?.id && !!latestMap[c.id] && latestMap[c.id]! > (lastReadRef.current[c.id] ?? '');
                  return (
                    <button key={c.id} className={`chanpill${current?.id === c.id ? ' on' : ''}`} title={c.topic || `#${c.slug}`} onClick={() => pickScope(c)}>
                      #{c.slug}{unread && <span className="unread">●</span>}
                    </button>
                  );
                })}
              </div>
              {!!members.length && (
                <div className="navcluster" title="People in this workspace">
                  {members.map((p) => (
                    <span key={p.user_id} className={`clusterav${p.user_id === auth?.user?.id ? ' me' : ''}`} title={p.user_id === auth?.user?.id ? selfLabel(p.display_name, auth?.user?.email) : (p.display_name ?? 'member')}>
                      {(p.user_id === auth?.user?.id ? selfInitial(auth?.user?.email) : (p.display_name?.[0] ?? 'M')).toUpperCase()}
                    </span>
                  ))}
                </div>
              )}
              {!!activeAgents.length && (
                <div className="navcluster" title="Agents">
                  {activeAgents.map((a) => {
                    const busy = a.status === 'working' || a.status === 'review' || a.status === 'thinking';
                    const reviewing = agentFocus(a, scopedTasksAll, openRuns).startsWith('review');
                    return (
                      <button key={a.id} className="clusterav agent" title={`${a.name} · ${agentFocus(a, scopedTasksAll, openRuns)}`} aria-label={`${a.name} — open details`} onClick={() => setDetailAgentId(a.id)}>
                        <span className="agpingwrap">{busy && <span className={`agping${reviewing ? ' review' : ''}`} aria-hidden />}<AgentAvatar name={a.name} size={26} radius={7} /></span>
                      </button>
                    );
                  })}
                </div>
              )}
              {!!roster.machines.length && (
                <span className="navmchip" title={roster.machines.map((m) => `${m.name} · ${isOnline(m.last_seen_at) ? 'online' : 'offline'}`).join(' · ')}>
                  <IconMachine s={13} /> {roster.machines.filter((m) => isOnline(m.last_seen_at)).length}/{roster.machines.length} online
                </span>
              )}
            </div>
          ) : (
            <>
              {/* docs/35 §5 as amended 2026-07-30 (George): ONE creation spot, top-left. The
                  main button is New chat — describe or ask, triage decides (docs/34 §14). The
                  caret carries the launcher's other modes (structured New task with room/repo
                  picked up front, and New routine on a schedule) — the topbar's ＋New task ▾
                  moved here rather than living as a second creation verb across the frame. */}
              {/* THE NAV HEAD — the channel scope. It sits above the creation verb because it is
                  the column's subject: everything below (New chat's target room, the
                  destinations, Recents) reads it. */}
              {/* The channels head retired (nav round, 2026-08-07): channels are a per-project
                  # filter on the tree's group headers, where select and create both live. The
                  destinations scope to the ACTIVE project (the spine's axis), whole-project. */}
              {/* On Automations the primary verb IS "arm an automation" — the one creation spot
                  follows the DESTINATION rather than making that screen grow a second add control
                  of its own (George, 2026-08-01). ⌘N still means New chat, so the shortcut badge
                  steps aside instead of claiming a key it doesn't own. */}
              {/* the Chat | Code switch — a segmented control, the shell's ONE mode switch */}
              <div className="navseg" role="tablist" aria-label="Rail mode">
                <button type="button" role="tab" aria-selected={navMode === 'chat'} className={navMode === 'chat' ? 'on' : ''} onClick={() => setRailMode('chat')}>Chat</button>
                <button type="button" role="tab" aria-selected={navMode === 'code'} className={navMode === 'code' ? 'on' : ''} onClick={() => setRailMode('code')}>Code</button>
              </div>
              <div className="navnew" onMouseLeave={() => setFtMenuOpen(false)}>
                {/* ALWAYS New chat (2026-08-16, George). It used to become "New automation" on
                    the Scheduled destination — a creation verb that changes under you is a verb
                    you have to check before pressing, and it was the third door to the same act:
                    the caret's own New routine row is right beside it, and Scheduled carries a
                    ＋ New automation button of its own. The nav's verb is the app's verb. */}
                {/* a TEXT ROW with an icon, not a pill (rail-ink round, 2026-09-04, George — "menus
                    are text with icons, not embossed buttons"): the verb keeps its place and its
                    shortcut, and stops being the one raised object in a column of rows. */}
                {/* in Code mode the verb is "New session" — the Engineering floor's own new-session
                    home (#391). The 2026-08-16 "always New chat" ruling was about the verb changing
                    under you per DESTINATION; a mode you switched on purpose is a state you can see. */}
                <button type="button" className="navnewrow"
                  onClick={() => { setFtMenuOpen(false); if (navMode === 'code') goConversation(() => { setNav('home'); setOpenTaskId(null); setOpenThreadId(null); setView('engineering'); engineeringNav.home(); }); else newChat(); }}
                  title={navMode === 'code' ? 'New session' : 'New chat — ⌘N'} aria-label={navMode === 'code' ? 'New session' : 'New chat'}>
                  <span className="nncico" aria-hidden>{navMode === 'code' ? <IconCode s={15} /> : <IconCompose s={15} />}</span>
                  <span className="navhomelbl">{navMode === 'code' ? 'New session' : 'New chat'}</span>
                  {navMode === 'chat' && <span className="nnck" aria-hidden>⌘N</span>}
                </button>
                {/* a real chevron, not a ▾ glyph: at 9px the character was almost invisible against
                    the row's own weight (George, 2026-08-01) — and it is the only sign the launcher
                    has more than one mode in it. */}
                <button type="button" className="navnewcaret" aria-label="More ways to start" aria-expanded={ftMenuOpen} onMouseEnter={() => setFtMenuOpen(true)} onClick={() => setFtMenuOpen((v) => !v)}>
                  <IconChevron s={14} />
                </button>
                {ftMenuOpen && (
                  <>
                    <div className="ftmenuveil" onClick={() => setFtMenuOpen(false)} />
                    <div className="navrowmenu navnewmenu" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setFtMenuOpen(false); setLauncher({ mode: 'task' }); }}><IconBoard s={13} />New task</button>
                      <button type="button" role="menuitem" onClick={() => { setFtMenuOpen(false); setLauncher({ mode: 'routine' }); }}><IconRepeat s={13} />New routine</button>
                    </div>
                  </>
                )}
              </div>
              {/* THE SHORTCUTS BAND, re-cut 2026-08-16. Three destinations: Whiteboards ·
                  Scheduled · Files. Home left for the BELL (a count meaning "someone is waiting
                  on you" belongs on chrome that opens a popover, not on a nav row), and Tasks
                  left for nothing — the board is deprecating, and a nav row is the last place to
                  keep a door onto a surface that is coming down. Skills · Memory · Activity ·
                  Agents · Retro stay behind the (now ungated) views burger and ⌘K. */}
              <div className="navband navdest">
                {/* collapsible like Projects (R4, George) — same secHd, same nm:navSec store */}
                {secHd('shortcuts', 'Shortcuts')}
                {/* rows derived in shell/navdest.ts (tested), drawn in shell/NavDestBand.tsx —
                    extracted from here in the marketing-os round to hold App's line ratchet */}
                {!navSec.shortcuts && (
                  <NavDestBand nav={nav} view={view} navSec={navSec} routines={roomRoutines} calendar={roomContent} mode={navMode}
                    goView={(v) => goConversation(() => { setNav('home'); setOpenTaskId(null); setOpenThreadId(null); setView(v); })}
                    goFiles={() => goConversation(() => { setNav('artifacts'); setOpenTaskId(null); setOpenThreadId(null); })}
                    toggleScheduled={() => toggleSec(SCHEDULED_SEC)} goCode={() => setRailMode('code')} />
                )}
                {!chans.length && <div className="navsect">syncing…</div>}
                {/* The "no channels here" prompt retired with the channel list (2026-08-07): a
                    project's channels live behind its own `#` in the tree, which is also where
                    ＋ New channel now is — and an empty project already says so in its group
                    ("No conversations yet"). Two doors for one act, one of them floating above
                    the section that owns it, is the duplication this round is about. */}
              </div>
            </>
          ))}
              {/* People and Agents left the rail (v0.69) for the room header's roster cluster —
                  two stacks of avatars beside the views burger. They are facts ABOUT the room you
                  are in, so they belong on that room rather than in the workspace-wide nav, and
                  the rail gets its vertical back for History. Their overlays are unchanged: the
                  cluster is a new door to the same room, not a second copy of it. */}
          {/* History at rest (v0.69): the jump list under the roster. It follows the active
              channel, spans every room on Home, and ⏎ / "See all" hands the query to the
              full surface. Suppressed in the top dock, which has no rail to put it in — a FOLDED
              rail needs no gate here, because `.navpanel[data-folded]` already hides every
              child but the fold tab, exactly as it does for the channel list. */}
          {navPos !== 'top' && (
            <HistoryRail
              nav={navList}
              liveIds={histLiveIds}
              liveRuns={histLiveRuns}
              askIds={askIds}
              marksOf={(r) => navBandsState.marksOf(r) ?? rowMarks(r)}
              onSettle={(threadId) => void settleThread(threadId)}
              collapsed={!!navSec.recents}
              openId={view === 'engineering' ? engineeringNav.activeId : openTaskId ?? openThreadId}
              onToggle={() => toggleSec('recents')}
              onPickProject={(pid) => {
                // the rail's scope chip is the SWITCHER too (2026-08-07's ruling, kept): picking a
                // project moves the destinations' scope as well, so one act narrows the rail and
                // takes you there. `All projects` widens the rail without evicting you from the
                // project you are standing in — there is no "no project" to switch to.
                if (pid) setActiveProject(pid);
                // the room filter belongs to the project it was picked in; carrying it across
                // would apply a room this project does not have (navFlat drops it, but the chip
                // would still read as set for a beat)
                putNavScope({ projectId: pid, channelId: null });
              }}
              onNewProject={() => { setCreateProjectOrigin(null); setCreateProjectOpen(true); }}
              onAllProjects={() => setNav('projects')}
              // one chip = show only that room; clicking the room you are already narrowed to
              // clears the filter. Every state it can reach is visible in the strip itself.
              onPickChannel={(cid) => putNavScope({ ...navScope, channelId: cid })}
              onNewChannelIn={(pid) => { setActiveProject(pid); setCreateChannelOpen(true); }}
              // A rail row opens a session that may live in ANOTHER room — always could (the rail
              // is unscoped on All), but auto-filing made it routine, and the session header read
              // the room you were STANDING in rather than the one the conversation is in: a
              // thread rex had just filed into #marketing opened titled `# general` (seen live,
              // 2026-08-03). The row knows its room; it just wasn't handing it over.
              // OPENING A SESSION FRONTS THE CONVERSATION TAB (George, 2026-08-19). Picking a
              // thread while a file or artifact tab was in front left you reading that tab with
              // the new session loaded invisibly behind it — the click looked like it did
              // nothing. `goConversation` is the existing rule for exactly this; these three
              // doors (this rail, Home's session list, the ⌘Y overlay) simply never used it.
              onOpenThread={(id, channelId) => goConversation(() => openConversation(id, channelId))}
              onOpenTask={(id) => goConversation(() => setOpenTaskId(id))}
              onOpenEngineering={(id) => goConversation(() => { setNav('home'); setOpenTaskId(null); setOpenThreadId(null); engineeringNav.open(id); setView('engineering'); })}
              onExpand={() => setHistOpen(true)}
              groups={navGroups.groups} onToggleFold={navGroups.toggleFold} onShowMore={navGroups.showMore} projectRooms={navGroups.projectRooms}
              view={navView} onView={setRailView}
              bands={navBandsState.bands} onToggleBand={navBandsState.toggleFold} onOpenOn={openOnConnection}
              onNewChatIn={(pid) => { setActiveProject(pid); newChat(); }}
              codeMode={navMode === 'code'}
              onArchive={archiveConversation}
              // rename from the row (rail-ink round): a chat through thread.update, a task through
              // task.update_details — the server freezes a task's title once work starts
              onRename={(row, title) => { void (row.task ? nm?.taskUpdateDetails(row.task.id, { title }) : row.threadId ? nm?.threadUpdate(row.threadId, { title }) : undefined); }}
            />
          )}
          {/* the hover-`#` channel popover retired 2026-08-09 — the strip under each project head
              is the same control, permanently visible. Multi-select went with it on purpose: one
              room or all rooms covers the real uses, and a strip chip shows its own state where a
              popover selection was invisible once closed. */}
        </div>
        {/* auto-update card — docked at the panel's foot, Claude-desktop style (the top
            dock has no side panel, so App renders the floating variant instead). */}
        {showUpdate && navPos !== 'top' && <UpdateCard state={update} onClose={() => setUpdateHidden(updKey)} />}
        {navPos === 'top' && <div className="navfoot">{accountBlock}</div>}
        </div>
        </div>
        {/* THE WORKSPACE FOOT (2026-08-16), under everything it contains — the spine's successor.
            It sits OUTSIDE `.navfaces`, and that is load-bearing: inside the rooms face it was
            hidden the instant the face crossed over, which pulled it out from under the cursor,
            fired its own `mouseleave`, closed the face, brought it back under the cursor, and
            flipped the column forever (George, live, 2026-08-16). A hover trigger cannot live
            inside the thing it reveals. Out here it is the HINGE: the face opens above it and it
            stays put, which is also why the face no longer draws an account row of its own.
            The top dock is a row with no column to put a foot in, so it keeps its popover. */}
        {/* the setup tracker docks HERE, right above the workspace bar — see SetupCards for why
            it left the bottom-right corner. Folded nav and the top dock keep the floating card. */}
        {navPos !== 'top' && !navIsFolded && <SetupCards variant="dock" connection={boot?.connection?.kind} />}
        {navPos !== 'top' && (
          <NavWorkspaceFoot
            workspace={boot?.workspace.name || ''}
            initial={(boot?.workspace.name?.[0] ?? 'N').toUpperCase()}
            unread={anyRoomUnread}
            faceOpen={navFace === 'projects'}
            onToggleFace={toggleFace}
            onUpgrade={openUpgrade}
            connection={boot?.connection?.kind}
            connectionHost={conns.find((c) => c.id === fgConnId)?.host ?? null}
            // the foot OPENS; the column CLOSES (below). Leaving the bar only cancels a pending
            // open — scheduling a close here is what made the flip loop possible in the first place.
            onHover={(over) => { if (navIsFolded) return; if (over) armFace(true); else cancelArm(); }}
          />
        )}
      </nav>
      {/* the nav grip (the shell round, 2026-08-10) — the split-stage idiom at the nav edge:
          invisible at rest (the gutter is the hit area), a 3px pill on hover, --ring + a live
          px readout while dragging. Drag is direct manipulation (data-dragging kills the fold's
          width transition); double-click resets and MAY animate. Hidden while folded — the
          gutter it lives in is gone. In a right dock the drag direction inverts. */}
      {navPos !== 'top' && !navIsFolded && (
        <div
          className="navgrip"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the sidebar"
          aria-valuenow={navW}
          aria-valuemin={NAV_W_MIN}
          aria-valuemax={NAV_W_MAX}
          tabIndex={0}
          data-tip="Drag to resize · double-click resets"
          onPointerDown={(e) => {
            e.preventDefault();
            const el = e.currentTarget;
            const startX = e.clientX;
            const startW = navW;
            const dir = navPos === 'right' ? -1 : 1;
            let last = startW;
            setNavWDragging(true);
            el.setPointerCapture(e.pointerId);
            const move = (ev: PointerEvent) => { last = clampNavW(startW + dir * (ev.clientX - startX)); setNavW(last); };
            const up = () => {
              // persist ONCE on release — a localStorage write per pointermove is 60 writes/s
              try { localStorage.setItem('nm:navw', String(last)); } catch { /* private mode */ }
              setNavWDragging(false);
              el.removeEventListener('pointermove', move);
              el.removeEventListener('pointerup', up);
              el.removeEventListener('pointercancel', up);
            };
            el.addEventListener('pointermove', move);
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
          }}
          onDoubleClick={() => setNavWPersist(NAV_W_DEFAULT)}
          onKeyDown={(e) => {
            const dir = navPos === 'right' ? -1 : 1;
            if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeNavW(-12 * dir); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); nudgeNavW(12 * dir); }
          }}
        >
          <span className="navgripbar" aria-hidden />
          {navWDragging && <span className="navgripout" aria-hidden>{navW}px</span>}
        </div>
      )}
      <div className="shellbody">
      <div className="main">
        {/* docs/36 — THE WORKSPACE STRIP. `.main` is tabbed: tab one is the conversation, pinned
            and unclosable and following the room, and files, terminals and browsers open BESIDE
            it as closable siblings with a fixed kind. The session below is tab one's body rather
            than an absolutely-positioned sibling of `.main`, which is §2.1's live defect fixed —
            the task panel's own terminal pin used to open a tab the open task buried. */}
        {/* docs/36, amended in the rail-ink round 3 (2026-09-04): the conversation IS the sheet.
            The workspace tab strip that opened this sheet — tab one the conversation, files and
            terminals as closable siblings — lives in the SIDE DOCK now (shell/SideDock.tsx), so
            what stays here is the sheet's head row: a destination's own controls and the room's
            rail. The session below is the sheet's body, the Workbench its floating card. */}
        <SheetHead
          context={engineeringContextOn ? <EngineeringWorkspaceHeader
            session={engineeringNav.activeSession} sessionCount={engineeringNav.sessions.length}
            tab={engineeringNav.workspaceTab} onTab={engineeringNav.setWorkspaceTab}
            onHome={engineeringNav.home} onNew={engineeringNav.home} /> : null}
          aux={(
            <>
              {/* THE BELL leads the rail (2026-08-16) — Home's needs-you queue, on chrome. Unlike
                  the clusters beside it, it is NEVER gated: they stand down the moment a task or
                  thread opens, which is most of the time, and a queue you can only see from one
                  surface is a queue you forget. The scope pills that used to lead this rail went
                  with Home — every destination carries its own ScopeBar, and two filters on a
                  notification tray is exactly the chrome this round is deleting. */}
              <span className="bellwrap" {...bellHover.wrap}>
                <BellButton count={bell.count} open={bellOpen} onToggle={bellHover.toggle} />
                {bellOpen && (
                  <BellPopover
                    alertCount={alerts.length}
                    alertsSection={<BellAlerts alerts={alerts} onOpen={() => { setBellOpen(false); setNav('home'); setView('dashboard'); }} />}
                    rows={bell.rows} count={bell.count} flight={bellFlightRows}
                    leaving={bellLeaving} busyId={bellBusy} liveThreads={liveThreads}
                    agentName={(id) => (id ? roster.agents.find((a) => a.id === id)?.name ?? null : null)}
                    agentRole={(id) => (id ? roster.agents.find((a) => a.id === id)?.role ?? null : null)}
                    orbState={(step, role) => orbStateFor(step, null, role)}
                    answered={awaitingAgent}
                    onOpenTask={setOpenTaskId}
                    onOpenConvo={(channelId, threadId) => openConversation(threadId, channelId)}
                    onSettle={(threadId, rowId) => void bellSettleThread(threadId, rowId)}
                    onHistory={() => setHistOpen(true)}
                    onClose={() => setBellOpen(false)}
                  />
                )}
              </span>
              {/* the room's crew — facts ABOUT the room you are standing in, so they keep their
                  gate: an open task or thread is not a room, and the rail would be lying. */}
              {channelScoped && !onWorkspaceDestination && !(openTaskId || openThreadId) && current && !!railPeople.length && (
                <button className="rosterclu" data-tip={`${railPeople.length} ${railPeople.length === 1 ? 'person' : 'people'} in #${current.slug} — add or invite`}
                  aria-label={`People in this channel (${railPeople.length})`} onClick={() => setAddPeopleOpen(true)}>
                  <span className="cluav">
                    {railPeople.slice(0, 3).map((p) => {
                      const nm2 = p.user_id === auth?.user?.id ? selfLabel(p.display_name, auth?.user?.email) : (p.display_name ?? 'member');
                      return <span key={p.user_id} className="clutile">{(nm2[0] ?? 'M').toUpperCase()}</span>;
                    })}
                  </span>
                  <span className="clun">{railPeople.length}</span>
                </button>
              )}
              {channelScoped && !onWorkspaceDestination && !(openTaskId || openThreadId) && current && !!railOrder.length && (
                <button className="rosterclu" data-tip={`${railOrder.length} agent${railOrder.length === 1 ? '' : 's'} in #${current.slug} — add, remove or hire`}
                  aria-label={`Agents in this channel (${railOrder.length})`} onClick={() => setAddAgentsOpen(true)}>
                  <span className="cluav">
                    {railOrder.slice(0, 3).map((a) => (
                      <span key={a.id} className="cluagent">
                        {(agentBusy(a) || openRuns.some((r) => r.agent_id === a.id && !r.parent_run_id)) && <span className="cluping" aria-hidden />}
                        <AgentAvatar name={a.name} size={22} radius={6} />
                      </span>
                    ))}
                  </span>
                  <span className="clun">{railOrder.length}</span>
                </button>
              )}
              {/* the Workbench toggle moved INTO the thread's header (rail-ink round 3, 2026-09-04):
                  the panel is a card inside the thread now. A room home has details but no header
                  of its own, so there it keeps a seat here, beside the views menu. In a session
                  neither shows: the header has the toggle and the views menu belongs to the stage. */}
              {!(openTaskId || openThreadId) && wbCardApplies && (
                <button className={`utilbtn${wpane ? ' on' : ''}`} data-tip={wpane ? 'Hide the Workbench — ⌘P' : 'Show the Workbench — ⌘P'} aria-pressed={wpane}
                  aria-label={wpane ? 'Hide the Workbench' : 'Show the Workbench'} onClick={toggleWorkbench}>
                  <IconWorkbench s={15} />
                </button>
              )}
              {!(openTaskId || openThreadId) && (
                <button className={`utilbtn${viewMenuOpen ? ' on' : ''}`} data-tip="Views" aria-label="Views" onClick={() => setViewMenuOpen((v) => !v)}>
                  <IconBurger s={15} />
                </button>
              )}
            </>
          )}
        />
        <div className="wtbody">
        <div className="wtpanes">
        <div className="wtpane on" role="region" aria-label="Conversation">
        {/* the room's utilities moved INTO the workspace strip's right rail (the shell round,
            2026-08-10 — WTabStrip's `aux`): the floating `.utilbar` under the strip's right end
            collided with the pane toggle's tooltip. The views MENU stays anchored here in the
            pane it acts on. */}
        {viewMenuOpen && (
          <>
            <div className="projmenu-scrim" onClick={() => setViewMenuOpen(false)} />
            <div className="viewmenu" role="menu">
              <button role="menuitem" onClick={() => { setViewMenuOpen(false); setNav('home'); setView('dashboard'); }}><IconHome s={14} /><span className="navlabel">Home</span></button>
              <button role="menuitem" onClick={() => { setViewMenuOpen(false); setNav('home'); setView('board'); }}><IconBoard s={14} /><span className="navlabel">Tasks</span>{roomOpenTasks ? <span className="navitembadge">{roomOpenTasks}</span> : null}</button>
              <button role="menuitem" onClick={() => { setViewMenuOpen(false); setNav('home'); setView('whiteboards'); }}><IconWhiteboard s={14} /><span className="navlabel">Whiteboards</span></button>
              {/* Scheduled's two surfaces are FLAT here — a menu has no room to nest, and both are
                  one click from the band anyway. Label only: the view keys stay automations/calendar. */}
              <button role="menuitem" onClick={() => { setViewMenuOpen(false); setNav('home'); setView('automations'); }}><IconRepeat s={14} /><span className="navlabel">Routines</span>{roomRoutines ? <span className="navitembadge">{roomRoutines}</span> : null}</button>
              <button role="menuitem" onClick={() => { setViewMenuOpen(false); setNav('home'); setView('calendar'); }}><IconCalendar s={14} /><span className="navlabel">Calendar</span>{roomContent ? <span className="navitembadge">{roomContent}</span> : null}</button>
              <button role="menuitem" onClick={() => setHistOpen(true)}><IconHistory s={14} /><span className="navlabel">History</span>{roomUnseenThreads ? <span className="navitembadge">{roomUnseenThreads > 9 ? '9+' : roomUnseenThreads}</span> : null}</button>
              <div className="viewmenusep" />
              <button role="menuitem" onClick={() => { setViewMenuOpen(false); setNav('home'); setView('marketing'); }}><IconTrend s={14} /><span className="navlabel">Marketing OS</span></button>
              <button role="menuitem" onClick={() => { setViewMenuOpen(false); setNav('home'); setView('engineering'); }}><IconCode s={14} /><span className="navlabel">Code</span></button>
              <button role="menuitem" onClick={() => { setViewMenuOpen(false); setNav('home'); setView('skills'); }}><IconSkill s={14} /><span className="navlabel">Skills</span></button>
              <button role="menuitem" onClick={() => { setViewMenuOpen(false); setNav('artifacts'); }}><IconLibrary s={14} /><span className="navlabel">Files</span></button>
              <button role="menuitem" onClick={() => { setViewMenuOpen(false); setNav('home'); setView('memory'); }}><IconMemory s={14} /><span className="navlabel">Memory</span></button>
              <button role="menuitem" onClick={() => { setViewMenuOpen(false); setNav('logs'); }}><IconActivity s={14} /><span className="navlabel">Activity</span></button>
              {/* the Workbench, from the menu too — it is a PANEL, so this toggles rather than
                  navigating, and it reads its own state (2026-08-16; the old "Code" row opened an
                  editor tab that duplicated this panel's tree in the main area). */}
              <button role="menuitem" onClick={() => { setViewMenuOpen(false); openWPane(!wpane); }} aria-pressed={wpane}><IconCode s={14} /><span className="navlabel">Workbench</span><span className="navitembadge">⌘P</span></button>
            </div>
          </>
        )}
        {nav === 'projects' && (
          <ProjectsPage
            projects={wsProjects}
            activeId={activeProj?.id ?? null}
            workspaceName={boot?.workspace.name || '…'}
            agentsFor={(id) => agentsByProject.get(id) ?? []}
            people={members}
            selfId={auth?.user?.id ?? null}
            selfEmail={auth?.user?.email ?? null}
            onSwitch={(id) => { setActiveProject(id); setNav('home'); setView('dashboard'); }}
            onManage={(p) => setManageProject(p)}
            onDelete={(p) => { setManageDelete(true); setManageProject(p); }}
            onArchive={(p, archived) => void nm?.projectArchive(p.id, archived)
              .then(() => { flashToast(archived ? `${p.slug} archived` : `${p.slug} is back`); refreshProjectsSoon(); })
              .catch((e) => flashToast(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 90) : 'could not update project'))}
            onNew={(origin) => { setCreateProjectOrigin(origin); setCreateProjectOpen(true); }}
          />
        )}
      {nav === 'agents' && <AgentsSurface {...{activeAgents, boot, isCloud, machNameOf, machineCaps, meId, members, placeOf, refreshCreds, refreshRoster, roster, setAddRemoteOpen, setCreateOpen, setDetailAgentId, setMarketplaceOpen, setNav, setUpgradeOpen, setView}} />}

        {nav === 'logs' && (
          <>
            <div className="topbar">Activity<span className="desc">every agent turn, tool call and beat · workspace-wide</span></div>
            <LogsScreen agents={roster.agents} task={logsTask} onTask={setLogsTask} />
          </>
        )}
        {nav === 'retro' && <RetroView />}

        {/* A DESTINATION, not an overlay. SubPage's × is the thread-sheet convention from round
            17, when Library slid in over the room you were standing in and closing restored it.
            Files is a top-level nav item now — like Projects, Agents and Retro — and a destination
            with a close button asks "close to WHAT?", a question the nav already answers. Same
            `.topbar` header those pages use: title · desc · actions, no ×. */}
        {nav === 'artifacts' && (() => {
          const nProj = wsProjects.filter((p) => p.status === 'active').length;
          return (
            <>
              <div className="topbar">Workspace Files
                <span className="desc">Everything the team and its agents have written, uploaded or approved · {wsFiles.length} file{wsFiles.length === 1 ? '' : 's'} across {nProj} project{nProj === 1 ? '' : 's'}</span>
              </div>
              <WorkspaceFiles
                projects={wsProjects}
                chans={chans}
                agents={roster.agents}
                files={wsFiles}
                uploading={uploading}
                onUpload={(projectId) => setUploadTo(projectId)}
                onOpenRoom={(channelId) => { const c = chans.find((x) => x.id === channelId); if (c) { setNav('home'); openRoom(c); } }}
              />
            </>
          );
        })()}

        {(() => {
          // ONE topbar for every room: its name and topic, with the room's surfaces on the row
          // beneath. docs/32: this bar names the ROOM you are in. The workspace Home is not a
          // room, so it gets its own header rather than wearing whichever channel you last visited.
          if (nav !== 'home' || !current || view !== 'chat') return null;
          // Board and Routines left the strip (2026-08-03) for nav destinations that read the
          // head's scope, so a plain room has exactly ONE surface — and a strip of one is a
          // label wearing an underline. Only a set-up marketing HQ (Conversations · Calendar ·
          // Library) still has a choice to render.
          const tabs = roomTabsFor(currentLive?.kind, marketingReady(currentLive?.marketing));
          if (tabs.length < 2) return null;
          const activeTab = roomSurface;
          const badge = (id: RoomSurface) => (id === 'history' ? roomUnseenThreads || null : null);
          // A room's surfaces sit on their OWN row under its name (the Slack shape), not inline with
          // it: a tab strip beside the title reads as part of the title, and the room's topic had to
          // be dropped entirely to make space for it. Two rows give the name its line back — topic
          // included — and the tabs a strip of their own. Same underline idiom as the task panel's
          // Thread · Review · Diff, so "tabs under a heading" looks like one thing app-wide.
          return (
            <div className="roomhead">
              {/* No name and no topic. The workspace tab names the room, and the topic was a second
                  line of chrome above content that says more — the room head is just its tabs now. */}
              <div className="roomtabbar" role="tablist" aria-label="Channel surfaces">
                {tabs.map((t) => {
                  const n = badge(t.id);
                  return (
                    <button key={t.id} role="tab" aria-selected={activeTab === t.id} className={`roomtab${activeTab === t.id ? ' on' : ''}`}
                      aria-label={t.label} onClick={() => openRoomSurface(t.id)}>
                      {t.label}
                      {n ? <span className="roomtabn">{n > 99 ? '99+' : n}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}
        {nav === 'home' && view === 'dashboard' && (
          // THE LANDING (2026-08-16) — Home and New chat are one surface again, the other way
          // round from the shell round's split: the composer IS the landing, and Home's briefing
          // became the bell. `dashboard` stays the view key because it is also the state a thread
          // or task mounts OVER; what changed is what it renders when nothing is open.
          <NewChatStage
            onSeeUsage={() => { setNav('home'); setView('compute'); }}
            ledger={{ rows: homeRows, marksOf: rowMarks, projects: wsProjects, projectOf: projectOfChannel, scope: scopeOf('home'), setScope: (x) => setScope('home', x), onOpenThread: (id, channelId) => goConversation(() => openConversation(id, channelId)), onOpenTask: (id) => goConversation(() => setOpenTaskId(id)), onSettle: (threadId) => void settleThread(threadId), onArchive: archiveConversation, onHistory: () => setHistOpen(true) }}
            agents={roster.agents}
            projects={wsProjects}
            activeProjectId={activeProject}
            channels={scopedChans}
            defaultChannelId={current?.id ?? null}
            people={composerPeople}
            skills={skills}
            packs={packs}
            plan={plan} hostedGate={hostedGateFor(boot?.connection, plan)}
            greeting={selfFirst}
            composeSignal={homeCompose}
            initialTarget={chatTarget}
            initialDraft={chatDraft}
            onSend={(channelId, text, opts) => {
              // the stage targets a room that may not be the "current" one — align them so the
              // conversation watch, history and the session surface all read the room addressed
              const c = chans.find((x) => x.id === channelId);
              if (c && current?.id !== c.id) { setCurrent(c); markRead(c.id); }
              return nm!.send(channelId, text, opts);
            }}
            machineChip={(value, onPick) => <MachineChip machines={roster.machines} members={members} selfUserId={meId} selfMachineName={boot?.machineName ?? null}
              origin={sessionOrigin} value={value} onPick={onPick} cloud={computeState} />}
            sessionBirth={(chosen) => ({ threadMachineId: sessionDesignation(chosen), threadOrigin: sessionOrigin })}
            onOpenThread={(id, channelId) => goConversation(() => openConversation(id, channelId))}
            onPickProject={(pid) => { if (pid !== activeProj?.id) setActiveProject(pid); }}
            onNewProject={() => { setCreateProjectOrigin(null); setCreateProjectOpen(true); }}
            onAllProjects={() => setNav('projects')}
            onBrainConnect={(p) => { setFocusProvider(p); setWsOpen(true); void refreshCreds(); }}
            onSetProjectPack={(packId) => setProjectPack(activeProject, packId)}
            onUpgrade={openUpgrade}
            // an invitation needs you but is not a task and must never be counted as one, so it
            // stays a card on the landing rather than a row in the bell (0113)
            topSections={(
              <HomeTop
                alerts={alerts} refreshAlerts={refreshAlerts} dismissAlert={dismissAlert} onUpgrade={openUpgrade}
                onOpenCalendar={() => { setNav('home'); setView('calendar'); }}
                onOpenRoutines={() => { setNav('home'); setView('automations'); }}
                justJoined={justJoined} wsInvites={wsInvites}
                currentWorkspace={boot?.workspace.name || 'this workspace'}
                onSwitchWorkspace={doSwitchWorkspace}
                onDismissJoined={() => setJustJoined(null)}
                onInviteJoined={(joined) => {
                  refreshWorkspaces();
                  setWsInvites((prev) => prev.filter((i) => i.inviteId !== joined.inviteId));
                  setJustJoined({ workspaceId: joined.workspaceId, workspaceName: joined.workspaceName });
                }}
                onInviteDismiss={(inviteId) => setWsInvites((prev) => prev.filter((i) => i.inviteId !== inviteId))}
              />
            )}
          />
        )}
        {nav === 'home' && view !== 'dashboard' && (
          <>
        {/* The Board — a nav destination that reads the head's scope (2026-08-03): All spans the
            active project, a picked room narrows to it. One board, one scope, named once.
            It READS work; it does not open a second way to create it. Task creation is the
            universal launcher (＋New task ▾) and the room's own composer — a bare input + repo
            select on a board is the pre-conversation-first idiom docs/33 §8 retired. The backlog
            column keeps its in-place quick-add: that parks an idea in the column it lands in. */}
        {view === 'automations' && (
          <>
            <div className="topbar">Scheduled · Routines<span className="desc">every schedule in the workspace — filter by project or room</span></div>
            <RoutinesView scope={scopeOf('routines')} setScope={(x) => setScope('routines', x)}
              projects={wsProjects}
              chans={chans}
              onCount={setRoomRoutines}
              onOpenRun={(threadId, channelId) => goConversation(() => openConversation(threadId, channelId))}
              onNew={() => setLauncher({ mode: 'routine' })}
            />
          </>
        )}
        {/* Automations' other half. It reads the same way its sibling does — workspace-wide, one
            visible ScopeBar — because it used to be a tab inside one marketing room and could not
            be asked the only question a calendar is for: what is going out this week. */}
        {view === 'calendar' && (
          <>
            <div className="topbar">Content calendar<span className="desc">every drafted and scheduled post — filter by project or room</span></div>
            <WorkspaceCalendar scope={scopeOf('calendar')} setScope={(x) => setScope('calendar', x)} projects={wsProjects} chans={chans} onCount={setRoomContent} />
          </>
        )}
        {/* Marketing OS (docs/design/marketing-os-2026-08 round 2): the marketing floor as a
            destination — the Calendar/Files ungating ruling applied a third time. Session and
            task doors flip back to the conversation surface first (the :1070 invariant closes
            any open session the moment this view mounts, so the door must leave it). */}
        {view === 'marketing' && (
          <>
            <div className="topbar">Marketing OS<span className="desc">every project’s marketing, one desk</span></div>
            <MarketingOS projects={wsProjects} chans={chans} scope={scopeOf('marketing')} setScope={(x) => setScope('marketing', x)}
              alerts={alerts} refreshAlerts={refreshAlerts} dismissAlert={dismissAlert} threads={histAll} tasks={tasksAll} messages={[]} marksOf={rowMarks}
              onOpenCalendar={() => { setNav('home'); setView('calendar'); }} onOpenRoutines={() => { setNav('home'); setView('automations'); }}
              onOpenSession={(r) => goConversation(() => { setNav('home'); setView('dashboard'); openSession(r); })}
              onOpenTask={(id) => goConversation(() => { setNav('home'); setView('dashboard'); setOpenTaskId(id); })} onAsk={openMarketingAsk} />
          </>
        )}
        {view === 'engineering' && <EngineeringOS key={boot?.workspaceId ?? 'workspace'} workspaceId={boot?.workspaceId ?? 'workspace'}
          repos={meta.reposAll.length ? meta.reposAll : meta.repos} projects={wsProjects} activeProjectId={activeProj?.id ?? null}
          plan={plan} onUpgrade={openUpgrade} onProjectChange={setActiveProject}
          onNewProject={(origin) => { setCreateProjectOrigin(origin); setCreateProjectOpen(true); }}
          initialSessionId={engineeringNav.requestedId} homeRequest={engineeringNav.homeRequest}
          defaultMachineId={sessionDesignation(null)}
          machineChip={(value, onPick, disabled) => <MachineChip machines={roster.machines} members={members} selfUserId={meId} selfMachineName={boot?.machineName ?? null}
            origin={sessionOrigin} value={value} onPick={onPick} cloud={computeState} disabled={disabled} />}
          editorTab={engineeringNav.workspaceTab} onEditorTab={engineeringNav.setWorkspaceTab}
          onSessionsChange={engineeringNav.setSessions} onActiveSessionChange={engineeringNav.syncActive} />}
        {view === 'whiteboards' && (
          <>
            <div className="topbar">Whiteboards<span className="desc">every board in the workspace — filter by project or room</span></div>
            <WhiteboardsHome scope={scopeOf('whiteboards')} setScope={(x) => setScope('whiteboards', x)}
              projects={wsProjects}
              chans={chans}
              onOpen={openWhiteboardTab}
              onNew={() => void newWhiteboard()}
            />
          </>
        )}
        {view === 'footprint' && (
          <>
            <div className="topbar">Agents&rsquo; footprint<span className="desc">this machine</span></div>
            <FootprintView />
          </>
        )}
        {view === 'credits' && <CreditsView />}
        {/* the SAME ComputePanel the settings tab renders — one implementation, two doors, so
            the destination can never drift from the modal it mirrors */}
        {view === 'compute' && (
          <>
            <div className="topbar">Compute<span className="desc">the machines your agents run on, and who lends them</span></div>
            <div className="libwrap cmpwrap">
              <ComputePanel onUpgrade={openUpgrade} machines={roster.machines} members={members} agents={roster.agents}
                selfMachineName={boot?.machineName ?? null} selfUserId={meId}
                onRevoke={(r) => {
                  setNavRevoke({ ...r, count: null });
                  void nm?.computeSharedThreads(r.member.user_id)
                    .then(({ count }) => setNavRevoke((cur) => (cur && cur.member.user_id === r.member.user_id ? { ...cur, count } : cur)))
                    .catch(() => setNavRevoke((cur) => (cur ? { ...cur, count: 0 } : cur)));
                }} />
            </div>
          </>
        )}
      {view === 'board' && <BoardSurface boardLabelOf={boardLabelOf} boardStateList={boardStateList} boardTasks={boardTasks} channelRosterFor={channelRosterFor} chans={chans} current={current} openTaskId={openTaskId} projShipGate={projShipGate} roster={roster} scope={boardScope} setScope={(x) => setScope('board', x)} scopeChan={scopeChan} setOpenTaskId={setOpenTaskId} threadUnread={threadUnread} wsProjects={wsProjects} />}


        {view === 'skills' && current && (() => {
          const needle = skillScope.q.trim().toLowerCase();
          const shownSkills = skillsAll
            .filter((sk) => !skillScope.projectId || !sk.channel_id || chanProjectOf.get(sk.channel_id) === skillScope.projectId)
            .filter((sk) => !skillScope.channelId || !sk.channel_id || sk.channel_id === skillScope.channelId)
            .filter((sk) => !needle || sk.name.toLowerCase().includes(needle) || (sk.description ?? '').toLowerCase().includes(needle));
          return (
            <>
              <div className="topbar">Skills<span className="desc">every skill in the workspace — filter by project or room</span></div>
              {/* a workspace-scoped skill (channel_id null) survives every room filter: it really
                  does apply everywhere, so hiding it under a room pick would be a lie */}
              <ScopeBar q={skillScope.q} onQ={(q) => setScope('skills', { q })} placeholder="Search skills" projects={wsProjects} chans={chans}
                projectId={skillScope.projectId} channelId={skillScope.channelId} onProject={(projectId) => setScope('skills', { projectId })} onChannel={(channelId) => setScope('skills', { channelId })} />
              <SkillsView skills={shownSkills} packs={packs} channelSlug={current.slug} agents={roster.agents} members={members} selfId={auth?.user?.id} selfEmail={auth?.user?.email} loading={!syncedOnce} q={skillScope.q} />
            </>
          );
        })()}

      {view === 'memory' && <MemorySurface chans={chans} current={current} wsProjects={wsProjects} scope={scopeOf('memory')} setScope={(x) => setScope('memory', x)} />}

        {/* the Code view is the WORKBENCH now — a frame-level panel, not a tab (2026-08-16) */}

      {view === 'library' && <LibrarySurface current={current} />}

        {view === 'chat' && currentLive && roomSurface === 'calendar' && (
          <MarketingCalendar key={currentLive.id} channel={currentLive} projectName={wsProjects.find((p) => p.id === currentLive.project_id)?.name ?? null} />
        )}
        {view === 'chat' && currentLive && roomSurface === 'library' && (
          <MarketingLibrary key={currentLive.id} channel={currentLive} />
        )}
        {/* docs/35 — THE ROOM HOME. A room is a folder of sessions, not a message feed. The
            surface id stays `feed` (roomView is persisted per machine AND is
            resolveRoomSurface's fallback target, so a new id would strand every stored value and
            break the fallback in one move); what it renders is the pinned briefs over this
            room's session list. The feed's own furniture — inline task groups, the reply footer,
            per-message actions, the scroll-follow machinery — is DELETED rather than hidden:
            dead code that duplicates a live surface comes back (docs/32 §8). */}
        {view === 'chat' && roomSurface === 'feed' && (
          // the whole surface (list + composer) is the drop target, not just the composer box
          <div className="chatdrop" {...composerDrop.dropProps}>

        <div className="mkfeedbody">
        <div className="jumpwrap">
        <div className="roomhome" ref={listRef}>
          <BriefStack briefs={roomBriefList} onOpen={(b) => replyAtRoot(b.messageId, b.body, 'this brief')} onHistory={() => setHistOpen(true)} taskRef={mdTaskRef} onOpenTask={setOpenTaskId} />
          {switching || (!msgsReady && current) ? (
            <div className="msgskels">
              {[0, 1, 2].map((i) => (
                <div key={i} className="msg skel">
                  <span className="av skeldot" />
                  <div className="body">
                    <span className="skelbar" style={{ width: `${30 - i * 6}%` }} />
                    <span className="skelbar dim" style={{ width: `${78 - i * 18}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
            {/* the undo moved to the SHELL level (search `archundo afloat`) — it has to fire for the nav
                rail and the ⌘Y overlay too, and only the shell sees all three */}
            <SessionList
              rows={roomSessions}
              liveIds={histLiveIds}
              showRoom={false}
              onOpen={openSession}
              onSeeAll={() => setHistOpen(true)}
              onArchive={archiveConversation}
              /* an empty room shows its FACE instead of a bare line: the hero, the self-retiring
                 setup cards (add agents · add people · attach a repo) and the papertrail. It was
                 the head of the feed's scroll; with no sessions yet it is the whole surface. */
              empty={current ? (
                <ChannelIntro
                  channel={currentLive ?? current}
                  projectName={activeProj?.slug ?? null}
                  roomAgents={activeAgents.filter((a) => agentInChannel(a.channel_ids, current.id))}
                  roomPeople={chanPeople}
                  members={members}
                  meId={auth?.user?.id ?? null}
                  history={chanHistory}
                  hasRepo={!!meta.repos.length}
                  onAddAgents={() => setAddAgentsOpen(true)}
                  onAddPeople={() => setAddPeopleOpen(true)}
                  onAttachRepo={() => setAddRepoOpen(true)}
                  onSetTopic={() => setManageChannel(current)}
                />
              ) : (
                <div className="empty">This project has no channels yet — switch projects from the top-left, or add one in project settings.</div>
              )}
            />
            </>
          )}
          {/* The HQ setup greeting is the room's FIRST MESSAGE, so it renders after the room's own
              head. It used to sit atop the list on the reasoning that "until it is answered there
              is nothing else in that room to read" — which is exactly wrong for the case it exists
              to serve: a BRAND-NEW marketing channel, where the intro, the crew cards and the
              papertrail are all already there. The greeting was landing above the `#marketing`
              heading, so plume spoke before the room had introduced itself (George, 2026-08-02). */}
          {/* COMPLETION-derived, not presence-derived (2026-08-09): the wizard writes per step
              now, so `marketing` is non-null from the first answer — a presence check would
              vanish the card mid-flow. setup_at (stamped by the completing command since the
              HQ first shipped) is the one authoritative "this ran to the end". */}
          {currentLive?.kind === 'marketing' && !setupProgress(MARKETING_SETUP_FLOW, currentLive.marketing ?? null).complete && !mkSetupSkipped.has(currentLive.id) && (
            <MarketingSetupCard
              key={currentLive.id}
              channel={currentLive}
              agent={mkSetupAgent}
              projectWebsite={activeProj?.website}
              onDone={(anchor) => { refreshChannelsSoon(); if (anchor?.taskId) openTaskFromAnywhere(anchor.taskId); else if (anchor?.threadId) openConversation(anchor.threadId); }}
              onSkip={() => setMkSetupSkipped((p) => new Set(p).add(currentLive.id))}
            />
          )}
        </div>
        </div>
        {/* THE ROOM's sections (2026-08-17) — into the Workbench's Details face, the same one the
            task and the conversation portal into. They used to mount here as `BrandDocsRail`, a
            THIRD copy of one panel: the aside inside a task, the aside inside a chat, and this.
            When the panel is shut the room says what it holds and opens it, exactly as a thread
            does — never an in-sheet panel of its own. */}
        {currentLive?.kind === 'marketing' && setupProgress(MARKETING_SETUP_FLOW, currentLive.marketing ?? null).complete && (() => {
          const sections = (
            <BrandSections
              channelId={currentLive.id}
              channelSlug={currentLive.slug}
              onOpen={(d) => openDocTab(d)}
              marketing={currentLive.marketing}
            />
          );
          if (wpane && wbSlot) return createPortal(sections, wbSlot);
          return (
            <RailToks sections={[]} extraLabel="brand · queue · connections" label={`#${currentLive.slug} details`}
              onOpen={() => openWPane(true)} />
          );
        })()}
        </div>

        <div className="composer">
          {(() => {
            const busy = roster.agents.filter(
              (a) =>
                (a.status === 'thinking' || a.status === 'working') &&
                agentLive(a, roster.machines) &&
                agentInChannel(a.channel_ids, current?.id ?? ''),
            );
            // also surface whoever is actively streaming a reply INTO this channel chat — the precise
            // "responding right now" signal (agent status alone can miss a just-started turn).
            const streamer = chatStream ? roster.agents.find((a) => a.name === chatStream.agent) ?? null : null;
            const list = streamer && !busy.some((b) => b.id === streamer.id) ? [streamer, ...busy] : busy;
            if (!list.length) return null;
            return (
              <div className="typingbar">
                {list.map((a) => {
                  const label = streamer && a.id === streamer.id ? (chatStream!.text.trim() ? 'typing' : 'thinking') : a.status === 'thinking' ? 'typing' : a.status;
                  return <TypistChip key={a.id} name={a.name} label={label} onOpen={() => openAgentActivity(a)} />;
                })}
                <span className="tdots"><i /><i /><i /></span>
              </div>
            );
          })()}
          <div className="cbox">
            {(() => {
              // No orchestrator in the room means there is nobody to introduce — say nothing. Nor
              // while replying: the reply pill already says who this is going to, and two context
              // strips stacked on one box is noise.
              const lead = replyTo ? null : leadFor(roster.agents, current?.id);
              if (!lead) return null;
              // docs/34 §7 / docs/35 §4.2 — a composer NAMES ITS CONSEQUENCE, and this one now
              // carries the Tasks toggle too, so the line has to move with it
              return <ComposerHint lead={lead} onInsert={(name) => {
                setDraft((d) => `${d}${d && !/\s$/.test(d) ? ' ' : ''}@${name} `);
                setComposerFocus((n) => n + 1);
              }} />;
            })()}
            {attachedSkill && (
              <div className="skillattach">
                <span className="skillchip"><IconSkill s={12} /> skill: {attachedSkill.name}{attachedSkill.pack ? ` · ${attachedSkill.pack}` : ''}</span>
                <button className="skillattachx" title="remove" onClick={() => setAttachedSkill(null)}><IconClose s={12} /></button>
              </div>
            )}
            {replyTo && (
              <div className="rpill">
                <span className="rpillwho"><IconReply s={11} /> starting a conversation on {replyTo.toName}</span>
                <span className="rpilltxt" title={replyTo.preview}>{replyTo.preview}</span>
                <button className="rpillx" title="Cancel reply (Esc)" onClick={() => setReplyTo(null)}><IconClose s={12} /></button>
              </div>
            )}
            <AttachTray items={atts.items} onRemove={atts.remove} />
            <ComposerInput
              value={draft}
              onChange={setDraft}
              onSend={() => void send()}
              people={composerPeople}
              skills={skills}
              packs={packs}
              attachedSkill={attachedSkill}
              onPickSkill={setAttachedSkill}
              onClearSkill={() => setAttachedSkill(null)}
              onOpenSkills={() => setView('skills')}
              onPaste={onComposerPaste}
              focusSignal={composerFocus}
              mentionSignal={composerMention}
              placeholder={current
                ? replyTo
                  ? `Reply — this starts a conversation in #${current.slug} · ↵ send`
                  : `Describe the work for #${current.slug} — or just ask · @ mention · / skill · ↵ send`
                : 'syncing…'}
            />
            {/* ONE control row inside the box: the two things you can add to a message, then the
                chip that says where it is going, then send. docs/35 §4.2 as amended by docs/34
                §14: the room chip is the composer's one knob (pinned in a room — the room is a
                given, so it states rather than offers); what a send BECOMES is the
                orchestrator's triage, not a control. */}
            <div className="row">
              {current && <span className="cchip pinned" data-tip="the channel this lands in"><span className="h">#</span> {current.slug}</span>}
              <span className="cdiv" aria-hidden />
              <MentionButton onMention={() => setComposerMention((n) => n + 1)} />
              <AttachButton onFiles={atts.addFiles} count={atts.count} max={atts.limits.maxPerMessage} />
              <ProjectChip
                projects={wsProjects.filter((p) => p.status === 'active')}
                active={activeProj}
                onSwitch={setActiveProject}
                onNew={(origin) => { setCreateProjectOrigin(origin); setCreateProjectOpen(true); }}
              />
              {/* WHERE this session will run (rule D9) — the composer's third knob */}
              <MachineChip machines={roster.machines} members={members} selfUserId={meId} selfMachineName={boot?.machineName ?? null}
                origin={sessionOrigin} value={sessionMachine} onPick={setSessionMachine} cloud={computeState} />
              {/* the SAME pill as the thread composer (George, 2026-07-31): a message sent here
                  becomes a conversation too, so the crew and the roles table read identically */}
              <BrainChip
                onConnect={(p) => { setFocusProvider(p); setWsOpen(true); void refreshCreds(); }}
                project={activeProj ? { id: activeProj.id, name: activeProj.name, pack: activeProj.model_pack ?? null } : null}
                onSetProjectPack={(packId) => setProjectPack(activeProject, packId)}
                castAgents={roster.agents.filter((a) => !a.retired_at && agentInChannel(a.channel_ids, current?.id ?? ''))}
              />
              {showWelcomeHint && <span className="welcomehint">Your first message is drafted. Send it and meet your orchestrator →</span>}
              <span className="sendnote inline">{note}</span>
              <button className={`btn primary send${showWelcomeHint ? ' coach' : ''}`} disabled={atts.busy} onClick={() => void send()} aria-label={atts.busy ? 'Uploading attachments' : 'Send message'} data-tip="Send · ↵">
                {atts.busy ? '…' : <IconSend s={20} />}
              </button>
            </div>
          </div>
        </div>
          {composerDrop.dragging && <div className="drophint full"><span className="drophintpill"><IconPaperclip s={16} /> Drop to attach</span></div>}
          </div>
        )}
          </>
        )}
      {/* docs/35 §3.4 — A SESSION IS A SURFACE, not a sheet over a feed. Opening one takes the
          whole main region and a back crumb returns; there is no veil, because there is nothing
          behind it to dim, and no slide, because this is a surface swap (§11). The moment a
          conversation's thread row links a task, the upgrade effect swaps this for the task
          surface below — one continuous place, upgraded in situ. */}
      {openThreadId && !openTask && (
        <div className="sessionsurf" data-peek={peekTask2 ? '1' : undefined} data-dragging={peekDragging ? '1' : undefined} style={peekStyle}>
          <div className="sscol">
          <ConvoThread
            // a conversation's details go where a task's do (2026-08-17) — the Workbench, and
            // only there. This was the half of the 2026-08-16 round that never landed.
            railSlot={wpane ? wbSlot : null} wbOpen={wbCardOn} onToggleWorkbench={toggleWorkbench}
            onWorkbench={() => openWPane(true)}
            onUpgradeReason={(r) => { setUpgradeReason(r); setUpgradeOpen(true); }}
            onSeeUsage={() => { setNav('home'); setView('compute'); }}
            threadId={openThreadId}
            back={sessionBack}
            thread={chanThreads.find((t) => t.id === openThreadId) ?? null}
            channelId={current?.id ?? ''}
            channelSlug={current?.slug ?? ''}
            channelKind={currentLive?.kind}
            channelMarketing={currentLive?.marketing}
            agents={roster.agents}
            machines={roster.machines}
            members={members}
            selfEmail={auth?.user?.email}
            people={composerPeople}
            skills={skills}
            packs={packs}
            plan={plan} hostedGate={hostedGateFor(boot?.connection, plan)}
            decisions={decisionsAll.filter((d) => !d.task_id && d.channel_id === current?.id)}
            onUpgrade={openUpgrade}
            onClose={closeConvo}
            onActivity={openAgentActivity}
            taskRef={mdTaskRef}
            // a `#N` ref clicked INSIDE this thread PEEKS (docs/33 §8's split stage, second
            // tenant): you were mid-something, so the task docks beside the conversation
            // instead of replacing it. Lists keep setOpenTaskId — picking work IS the switch.
            onOpenTask={peekTask}
            onOpenDoc={openDocTab}
            // the CHANNEL's project — a conversation has no task to derive one from, so it takes
            // the room's, which is the same rule (docs/06: a task's project is its channel's)
            brainProject={(() => {
              const pid = currentLive?.project_id ?? activeProject;
              const p = wsProjects.find((x) => x.id === pid);
              return p ? { id: p.id, name: p.name, pack: p.model_pack ?? null } : null;
            })()}
            crumbProject={(() => {
              const p = wsProjects.find((x) => x.id === (currentLive?.project_id ?? activeProject));
              return p ? { name: p.name, logo_url: p.logo_url } : null;
            })()}
            onSetProjectPack={(packId) => setProjectPack(currentLive?.project_id ?? activeProject, packId)}
            onBrainConnect={() => { setWsOpen(true); void refreshCreds(); }}
            // Approve = promote. `promoted` is what the Library view reads, so an unpromoted
            // artifact is a draft in the thread and nothing more. Resolve by NAME, newest first:
            // proposing the same name again supersedes, so the freshest row is the one on offer.
            onApproveDoc={async (file) => {
              const chId = current?.id;
              if (!chId || !nm) return;
              const { artifacts } = await nm.channelArtifacts(chId).catch(() => ({ artifacts: [] as any[] }));
              const hit = artifacts
                .filter((a) => a.name === file)
                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
              if (hit) await nm.promoteArtifact(hit.id).catch(() => {});
            }}
            onOpenWhiteboard={openWhiteboardTab} onOpenArticle={openArticleTab}
            marks={headMarks} onSettle={(threadId) => void settleThread(threadId)}
          />
          </div>
          {peekNode}
        </div>
      )}
      {/* the task session / review cockpit — the same surface and the same crumb anatomy as a
          chat session (docs/35 §3.4); session rows, board cards and the ⌘Y overlay all open it.
          Its docs/25 zoning is untouched. A task born from a conversation unions the chat
          prelude into its feed. */}
      {openTask && (
        <div className="sessionsurf" data-peek={peekTask2 ? '1' : undefined} data-dragging={peekDragging ? '1' : undefined} style={peekStyle}>
        <div className="sscol">
        <TaskThread
          // the details panel renders in the WORKBENCH, and only there (2026-08-17) — the in-sheet
          // `.mkrail` retired with the flat round, so this is one panel at one edge with one door
          railSlot={wpane ? wbSlot : null} wbOpen={wbCardOn} onToggleWorkbench={toggleWorkbench}
          // the thread's word and its settle act (settle round) — the PEEK deliberately carries
          // neither: its head keeps only the acts you take while reading beside a conversation
          marks={headMarks} onSettle={(threadId) => void settleThread(threadId)}
          // the header's toggle: opening it lands on Details, because that is what the button in
          // a TASK's action row promises — not whatever face you last left the panel on

          convoThreadId={chanThreads.find((t) => t.task_id === openTask.id)?.id ?? openTask.origin_thread_id ?? null}
          convoThread={chanThreads.find((t) => t.task_id === openTask.id) ?? null}
          threadBrain={(chanThreads.find((t) => t.task_id === openTask.id) ?? chanThreads.find((t) => t.id === openTask.origin_thread_id))?.brain_override ?? null}
          brainProject={(() => {
            // the TASK's project, not the active one — a task's project is its channel's (docs/06)
            const pid = tasksAll.find((x) => x.id === openTask.id)?.project_id ?? activeProject;
            const p = wsProjects.find((x) => x.id === pid);
            return p ? { id: p.id, name: p.name, pack: p.model_pack ?? null } : null;
          })()}
          crumbProject={(() => {
            const pid = tasksAll.find((x) => x.id === openTask.id)?.project_id ?? activeProject;
            const p = wsProjects.find((x) => x.id === pid);
            return p ? { name: p.name, logo_url: p.logo_url } : null;
          })()}
          onSetProjectPack={(packId) => setProjectPack(tasksAll.find((x) => x.id === openTask.id)?.project_id ?? activeProject, packId)}
          onBrainConnect={(p) => { setFocusProvider(p); setWsOpen(true); void refreshCreds(); }}
          onOpenWhiteboard={openWhiteboardTab} onOpenDoc={openDocTab} onOpenArticle={openArticleTab}
          back={sessionBack}
          task={openTask}
          agents={roster.agents}
          machines={roster.machines}
          members={members}
          selfId={auth?.user?.id}
          selfEmail={auth?.user?.email}
          channelId={openTask.channel_id}
          channelSlug={chans.find((c) => c.id === openTask.channel_id)?.slug ?? tasksAll.find((x) => x.id === openTask.id)?.channel_slug ?? ''}
              channelKind={chans.find((c) => c.id === openTask.channel_id)?.kind ?? null}
              channelMarketing={chans.find((c) => c.id === openTask.channel_id)?.marketing ?? null}
          decisions={decisionsAll.filter((d) => d.task_id === openTask.id)}
          onClose={closeThread}
          onPreview={(name?: string) => void openTaskArtifact(openTask, name)}
          onViewLogs={() => viewTaskLogs(openTask.number)}
          onActivity={openAgentActivity}
          plan={plan} hostedGate={hostedGateFor(boot?.connection, plan)}
          onUpgrade={openUpgrade}
          onOpenReview={(name) => void openTaskArtifact(openTask, name)}
          onOpenTerminal={(t) => openTermTab({ taskNumber: t.number, hasRepo: !!t.branch, title: '#' + t.number })}
          onOpenSkills={() => { setOpenTaskId(null); setView('skills'); }}
          taskRef={mdTaskRef}
          // a `#N` ref clicked INSIDE this thread PEEKS (docs/33 §8's split stage, second
          // tenant): you were mid-something, so the task docks beside the conversation
          // instead of replacing it. Lists keep setOpenTaskId — picking work IS the switch.
          onOpenTask={peekTask}
          subtasks={tasksAll.filter((x) => x.parent_task_id === openTask.id)}
          shipGate={projShipGate(tasksAll.find((x) => x.id === openTask.id)?.project_id ?? null)}
        />
        </div>
        {peekNode}
        </div>
      )}
        </div>
        </div>
        {/* THE WORKBENCH, a card inside the thread's sheet (rail-ink round 3, 2026-09-04, George,
            Codex as the reference): the panel is the open session's own details, so it floats at
            the sheet's right edge beside the conversation, which recentres in what is left. It was
            a naked frame column (2026-08-16) and then a second sheet (2026-09-04 morning); the seat
            it held on the frame is the side dock's now. HIDDEN on a destination (2026-08-19) — see
            `workbenchApplies`: `wpane` is the human's preference and a destination does not edit it. */}
        {wbCardOn && (
          <WorkbenchDock variant="card" width={wbW} min={WB_W_MIN} max={WB_W_MAX} mirrored={false} dragging={wbDragging}
            onWidth={setWbWPersist} onReset={() => setWbWPersist(WB_W_DEFAULT)} onDragging={setWbDragging}>
            {/* a doorway, never a viewer: a file clicked in the drawer opens a TAB in the side dock */}
          <Workbench
            scope={wscope} activePath={wactivePath} dirtyPaths={wdirtyPaths} findSeq={wfind}
            scopeLabel={wb.scopeLabel} files={wb.files}
            slotRef={setWbSlot}
            onOpenFile={openFileTab}
            onClose={() => openWPane(false)} />
          </WorkbenchDock>
        )}
        </div>
        {/* the bottom strip survives ONLY in top-dock mode, which hides the frame top the
            cluster moved to (the shell round, 2026-08-10) — everywhere else it is gone and
            the frame's 38px bottom band went back to the sheet */}
        {navPos === 'top' && (
          <DockBar activeKind={wtabs.find((x) => x.id === wactive)?.kind ?? null} onKind={openKindTab}
            dockOpen={dockOpen} onDock={() => openDock(!dockOpen)}
            procCount={procCount} procOpen={procOpen} onProc={() => setProcOpen((v) => !v)}
            procs={procsView} onKill={onKillProc} status={statusCluster} onCmdK={() => setCmdkOpen(true)} />
        )}
      </div>
      {(navPos === 'top' || navIsFolded) && <SetupCards connection={boot?.connection?.kind} />}
      {/* THE SIDE DOCK (rail-ink round 3, 2026-09-04) — the tab strip's own column at the frame's
          right edge, where the Workbench used to dock: files, terminals, browsers, whiteboards and
          reviews open BESIDE the conversation, never over it. Mounted whenever it has tabs so a
          folded dock keeps its ptys and page histories — the fold is CSS, not an unmount. */}
      {(dockOpen || dockGuests.length > 0) && (
        <SideDock open={dockOpen} width={sdW} min={SD_W_MIN} max={SD_W_MAX} mirrored={navPos === 'right'} dragging={sdDragging}
          onWidth={setSdWPersist} onReset={() => setSdWPersist(SD_W_DEFAULT)} onDragging={setSdDragging}
          tabs={dockGuests} activeId={dockActive} scope={wscope} onActivate={activateWTab} onClose={closeWTab} onNew={openHere} onFold={() => openDock(false)}>
        {wtabs.filter((t) => t.kind !== 'conversation').map((t) => (
          <div key={t.id} className={`wtpane${t.id === dockActive ? ' on' : ' hidden'}`} role="tabpanel" aria-label={t.title} data-kind={t.kind}>
            {t.kind === 'terminal' && (
              <TerminalView onUpgrade={() => setUpgradeOpen(true)}
                ref={(r) => { if (r) wterms.current.set(t.id, r); else wterms.current.delete(t.id); }}
                taskNumber={t.taskNumber ?? undefined} hasRepo={!!tasksAll.find((x) => x.number === t.taskNumber)?.branch}
                cwdRoot={t.root ?? undefined} cwd={t.root ?? null} startupCommand={wstartup.current[t.id]}
                onPty={(subId) => setTabPty(t.id, subId)} />
            )}
            {t.kind === 'browser' && (
              <BrowserPane url={t.url ?? undefined}
                onNavigate={(u) => patchWTab(t.id, (x) => (x.url === u ? null : { url: u }))}
                onTitle={(title) => patchWTab(t.id, (x) => (!title.trim() || x.title === title ? null : { title }))} />
            )}
            {t.kind === 'whiteboard' && t.whiteboardId && (
              <Suspense fallback={<div className="wbpane"><div className="wbwait">Opening the canvas…</div></div>}>
                <WhiteboardView boardId={t.whiteboardId}
                  onDirty={(d) => setWTabDirty(t.id, d)}
                  onTitle={(title) => patchWTab(t.id, (x) => (x.title === title ? null : { title }))}
                  onShare={(r) => void shareWhiteboard(r)} />
              </Suspense>
            )}
            {/* A file tab with no path used to be an EDITOR tab: a second copy of the Workbench's
                file tree, rendered in the main area. `openEditorTab` is gone, so none can be made
                — but a persisted tab set from before 2026-08-16 can still hold one, and a tab
                that renders nothing is worse than the duplication was. It migrates itself: the
                Workbench opens on the same root and the tab closes. */}
            {t.kind === 'file' && !t.path && !t.artifactId && (
              <div className="cwempty">
                <div className="cwemptyinner">
                  <span className="cwemptyico"><IconCode s={30} /></span>
                  <h3>This is the Workbench now</h3>
                  <p>Browsing a folder lives in the Workbench &mdash; the card inside the thread, beside your work &mdash; one file tree instead of two.</p>
                  <div className="cwemptybtns">
                    <button className="btn sm primary" onClick={() => {
                      if (t.root) setWbRoot({ name: t.subtitle || t.title, path: t.root });
                      openWPane(true);
                      closeWTab(t.id);
                    }}><IconCode s={13} /> Open the Workbench</button>
                  </div>
                </div>
              </div>
            )}
            {t.kind === 'file' && (t.path || t.artifactId) && (t.artifactId?.startsWith('article:')
              ? <ArticleView artifactId={t.artifactId.slice('article:'.length)} name={wdocs[t.id]?.name ?? t.title} content={wdocs[t.id]?.content ?? ''} />
              : <WFileView tab={t} doc={wdocs[t.id]} onMode={(m) => setWTabMode(t.id, m)} onDirty={(d) => setWTabDirty(t.id, d)} />)}
            {t.kind === 'review' && (() => {
              const art = t.artifactId ?? '';
              const rev = wrevs[art];
              if (!rev) return <div className="wfempty">This review is no longer available.</div>;
              const binding = bindReview(rev.artifact, reviewSubject({ id: rev.taskId, number: rev.taskNumber }, rev.rounds));
              if (!binding) return <div className="wfempty">This artifact is not under review.</div>;
              const comments = wrcomments[art] ?? [];
              // a mode the binding no longer offers (the diff's predecessor went away) falls back
              // rather than rendering nothing
              const stored = wrmodes[art];
              const mode = stored && binding.modes.includes(stored) ? stored : binding.defaultMode;
              return (
                <WReviewView
                  tab={t} binding={binding} content={rev.artifact.content} comments={comments} mode={mode}
                  busy={wrbusy === art} error={wrerr[art] ?? ''}
                  onComments={(next) => setWrcomments((c) => ({ ...c, [art]: next }))}
                  onMode={(m) => setWrmodes((ms) => ({ ...ms, [art]: m }))}
                  onSpend={(v, cs) => void spendVerdict(t.id, art, v, binding, cs, splitPlanBlocks(rev.artifact.content))}
                  onOpenLatest={(name) => void openTaskArtifact({ id: rev.taskId, number: rev.taskNumber, channel_id: rev.channelId }, name)}
                  onClose={() => closeWTab(t.id)} />
              );
            })()}
          </div>
        ))}
        </SideDock>
      )}
      </div>
      {cmdkOpen && <CmdKPalette items={buildCmdkItems()} onClose={() => setCmdkOpen(false)} />}
      <LinkChoiceHost openInApp={openBrowserTab} />
      {/* History expanded (v0.69) — shell level, so it floats over a room, the board or Home
          without any of them losing their place. Esc or the scrim puts you back. */}
      {histOpen && (
        <HistoryOverlay
          // ⌘Y has no press to grow from, so it falls back to the control the surface belongs to:
          // the rail's magnifier. Folded away, `anchorPoint` returns the press (or null → centred).
          anchor={anchorPoint('.navhistfind')}
          rows={histOvlRows}
          q={histQ}
          onQ={setHistQ}
          scopeLabel="Search every thread…"
          grouped
          projects={wsProjects.filter((p) => p.status === 'active')}
          projectOf={projectOfChannel}
          projFilter={histProj}
          onProjFilter={setHistProj}
          marksOf={rowMarks}
          statusFilter={histStatus}
          onStatusFilter={setHistStatus}
          onSettle={(threadId) => void settleThread(threadId)}
          onQuit={() => { setHistOpen(false); setHistQ(''); setHistProj(null); setHistStatus(null); }}
          onOpenThread={(id, channelId) => goConversation(() => openConversation(id, channelId))}
          onOpenTask={(id) => goConversation(() => setOpenTaskId(id))}
          onArchive={archiveConversation}
          />
      )}
      {/* the capacity switch follows the human — sticky above whatever composer is frontmost.
          Answering posts to the channel it lives in (task_id null) so the daemon executes it. */}
      {flyupOn && (
        <FailoverFlyup
          row={flyupOn}
          onAnswer={(channelId, text) => void nm?.send(channelId, text)}
          onDismiss={() => setDismissedFo((prev) => new Set(prev).add(flyupOn.decision_id))}
          onOpenChannel={(channelId) => {
            const c = chans.find((x) => x.id === channelId);
            if (c) { setOpenTaskId(null); setOpenThreadId(null); setCurrent(c); setNav('home'); setView('dashboard'); markRead(c.id); }
          }}
        />
      )}
    </div>
    </FailoverBannerContext.Provider>
    </AgentDirectory.Provider>
  );
}
