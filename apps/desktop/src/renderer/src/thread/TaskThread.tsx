// The task thread (docs/25) — the conversation on a board task, its zoned panel, the gate
// card above the composer and the design studio docked beside it.
// Extracted from App.tsx (track A3).
import { BrainNotice } from './BrainNotice';
import { ThreadHead } from './ThreadHead';
import { AgentAvatar } from '../components/AgentAvatar';
import { AgentGhost } from './AgentGhost';
import { WaitGhost, useWaitGhost } from './WaitGhost';
import { waitRunFor } from './waitghost-rule';
import { AttachButton, AttachTray, consumeWbAttach, useAttachments } from '../composer/attach';
import { AttachLightbox } from './AttachLightbox';
import { BeatsTracker } from '../task/BeatsTracker';
import { BrainChip } from '../brain/BrainChip';
import { BrandSections } from '../marketing/BrandSections';
import { ComposerInput } from '../composer/ComposerInput';
import { DeliveryStrip } from './DeliveryStrip';

import { DesignStudio } from '../design/DesignStudio';
import { DiffView } from '../views/docpreview';
import { DraftingCard, MentionButton, ThreadRoomChip, ThreadRootPin, TypistChip, filesFromPaste, memberPeople, streamContent, type ComposerPerson, type HeadStatus, type PostVCard, type RailSection, useDropZone } from './parts';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconClose, IconPaperclip, IconReply, IconSend, IconSkill } from '../ui/icons';
import { MarketingSetupCard } from '../marketing/MarketingSetupCard';
import { Md } from '../md/Md';
import { Modal } from '../ui/Modal';
import { PostPreviewModal } from '../marketing/PostPreviewModal';
import { RunCard } from './RunCard';
import { RunDock, ThreadLiveBar } from './ThreadLiveBar';
import { SocialPostCard, postCardsFrom } from '../marketing/SocialPostCard';
import { StreamBubble } from './StreamBubble';
import { HostedGate } from '../shell/HostedGate';
import { ThreadMessage } from './ThreadMessage';
import { RailSections, RailToks } from './ThreadRail';
import { agentInChannel, groupDeliveries, isPlanDoc, isPostsFile, isRunOpen, journeyFor, parsePlanRef, parseWorkPlanLegs, parseBrainOverride, renderableDeliverables, supersededIds, type Provider, type RunState } from '@neuramesh/shared';

import { answersResolver } from '../answers';
import { designRoundAnchor, orderTranscriptEntries, type TimedTranscriptEntry } from '../transcript-order';
import { designVer, planVer, shipPlanVer } from '../review';


import { nm as nmBridge } from '../bridge/nm';
import { pickPlans, pickShipPlans } from '../design/plans';
import { plainTitle } from '../room-tabs';
import { suggestionTarget, type TaskRefInfo } from '../cards/parse';
import { type AgentRow, type MachineRow, type MemberRow } from '../bridge/rows-crew';
import { type ArtifactUI, type AttachmentRow, type DecisionAllRow, type TaskAllRow, type TaskRow } from '../bridge/rows-board';

import { type MessageRow, type ThreadRow } from '../bridge/rows-rooms';
import { useAgentStream } from './hooks';
import { useShipGate } from './task/ShipGate';
import { useSubtasks } from './task/Subtasks';
import { useTaskPosts } from './task/Posts';
import { useDesignDock } from './task/DesignStudioDock';
import { useTaskContract } from './task/Contract';
import { useTaskEvents } from './task/Events';
import { useTaskGates } from './task/Gates';
import { useTaskData } from './task/Data';
import { useTaskPresence } from './task/Presence';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// The studio's docked width is a per-machine preference (docs/25 zone contract: the
// thread keeps its --col measure, the studio spends the panel's slack). Floor keeps a
// mockup legible; ceiling keeps the thread from being starved — under NARROW_PANEL the
// studio takes the sheet instead, which is what the old overlay always did.
export const STUDIO_W_KEY = 'nm.designStudio.w';

export const STUDIO_MIN = 380;

export const STUDIO_MAX = 900;

export const clampStudio = (w: number) => Math.max(STUDIO_MIN, Math.min(STUDIO_MAX, Math.round(w)));

/** Kept in lockstep with --dur-studio in tokens.css — the JS unmount waits it out. */
export const STUDIO_ANIM_MS = 420;

export function TaskThread({
  task,
  back,
  agents,
  machines,
  members,
  selfId,
  selfEmail,
  channelId,
  channelSlug,
  channelKind,
  channelMarketing,
  decisions,
  onClose,
  onPreview,
  onViewLogs,
  onActivity,
  plan,
  hostedGate,
  onUpgrade,
  onOpenTerminal,
  onOpenReview,
  onOpenSkills,
  taskRef,
  onOpenTask,
  onOpenWhiteboard, onOpenArticle, onOpenDoc,
  subtasks,
  shipGate,
  convoThreadId,
  convoThread,
  threadBrain,
  brainProject,
  crumbProject,
  onSetProjectPack,
  onBrainConnect,
  railSlot, onWorkbench, wbOpen, onToggleWorkbench,
  marks, onSettle,
  peek,
}: {
  task: TaskRow;
  /** the thread's word and its settle act, for the head (shell/rowstatus.ts) */
  marks?: HeadStatus | null;
  onSettle?: (threadId: string) => void;
  /** where the back crumb goes — one header anatomy for both session kinds (docs/35 §3.4) */
  back: string;
  /** where the details panel renders — the Workbench's Details slot, and nowhere else since
   *  2026-08-17. Null means it is shut or on another face, and the head's toks stand in for it.
   *  A PEEK never gets one: at 380px the Workbench is the column. */
  railSlot?: HTMLElement | null;
  /** OPEN the Workbench (the RailToks door while the panel is shut) — the toggle lives on the tab row */
  onWorkbench?: () => void;
  wbOpen?: boolean; onToggleWorkbench?: () => void; // the Workbench card's state + its header toggle (rail-ink round 3)
  /** the header's own toggle for the panel that holds this task's details */
  /** rendered as a PEEK beside the thread it was opened from (the task-peek round,
   *  2026-08-10 — docs/33 §8's split stage, second tenant). The panel is the same panel;
   *  only its way out changes: close · open full replace the back crumb. */
  peek?: { onFull: () => void };
  agents: AgentRow[];
  machines: MachineRow[];
  members: MemberRow[];
  selfId?: string | null;
  selfEmail?: string | null;
  channelId: string;
  channelSlug: string;
  /** the ROOM's kind — a marketing HQ contributes brand sections to this thread's rail */
  channelKind?: string | null;
  channelMarketing?: string | null;
  decisions: DecisionAllRow[]; // this task's synced nmq-card state (docs/12 slice 2)
  onClose: () => void;
  onPreview: (name?: string) => void;
  onViewLogs: () => void;
  onActivity?: (a: AgentRow) => void;
  plan: string; /** a free hosted workspace (shell/hostedrule.ts): the gate card docks where the reply box stood */ hostedGate?: boolean;
  onUpgrade: (reason: string) => void;
  onOpenTerminal?: (t: TaskRow) => void;
  onOpenWhiteboard?: (b: { id: string; title: string }) => void; onOpenArticle?: (a: import('./ArticleCard').ArticleOpen) => void;
  /** opens a doc in a workspace tab — the DocDropCard Open icon, the Brand-docs rail rows */
  onOpenDoc?: (d: { label: string; file: string; doc: string }) => void;
  /**
   * Open an artifact through the shell's ONE door (openTaskArtifact): a design round binds to its
   * gate and lands as a review TAB. TaskThread cannot reach openWTab itself, so the door is passed
   * in — the same shape as onOpenTerminal.
   */
  onOpenReview?: (name?: string | null) => void;
  onOpenSkills?: () => void;
  // inline #1234 references in thread prose resolve + link exactly as in the channel feed
  taskRef?: (n: number) => TaskRefInfo | null;
  onOpenTask?: (id: string) => void;
  // subtasks (docs/24): this task's companion work (rows with parent_task_id = task.id)
  subtasks?: TaskAllRow[];
  // the project's release gate — the spectrum's ship leg derives from it
  shipGate?: boolean;
  // set when this task was born from a conversation: the feed unions the pre-task chat
  convoThreadId?: string | null;
  /** the conversation row this task grew out of — carries the root it answers (docs/31) */
  convoThread?: ThreadRow | null;
  // docs/10 §15 — this conversation's brain override, as the raw synced column. Passed rather
  // than looked up here because the shell already holds the thread rows.
  threadBrain?: string | null;
  brainProject?: { id: string; name: string; pack: string | null } | null;
  /** the thread's project, for the header place-crumb (project › #room) */
  crumbProject?: { name: string; logo_url?: string | null } | null;
  onSetProjectPack?: (packId: string) => Promise<void>;
  onBrainConnect?: (provider: Provider) => void;
}) {
  // The re-zoned panel (v0.36): every auxiliary surface is a header tok whose click opens ONE
  // accordion drawer under the header — requirements (+ the Definition of Done), artifacts,
  // subtasks, branch/PR, and the review loop.
  const [closing, setClosing] = useState(false);
  const [blocking, setBlocking] = useState(false);
  // hands-off (2026-09-16): the unit's origin thread carries schedule_id when a routine opened it —
  // the plan card's record then reads auto-approved · routine instead of a human's approved
  const [routineBorn, setRoutineBorn] = useState(false);
  useEffect(() => {
    const origin = task.origin_thread_id;
    if (!nm?.watchHistoryAll || !origin) { setRoutineBorn(false); return; }
    return nm.watchHistoryAll((rows) => setRoutineBorn(rows.some((r) => r.id === origin && !!r.schedule_id)));
  }, [task.origin_thread_id]);
  const [blockReason, setBlockReason] = useState('');
  const [threadLightbox, setThreadLightbox] = useState<AttachmentRow | null>(null);
  const [cfocus, setCfocus] = useState(0); // ⌥-click on a pill drops its text here to edit
  const [cmention, setCmention] = useState(0); // nonce → the @ button types "@" + opens the picker
  const [designOpen, setDesignOpen] = useState(false);
  const [designInitialName, setDesignInitialName] = useState<string | null>(null);
  // studio geometry: width is a per-machine preference, expanded is per-open
  const [studioW, setStudioW] = useState(() => clampStudio(Number(localStorage.getItem(STUDIO_W_KEY)) || 520));
  const [studioExp, setStudioExp] = useState(false);
  useEffect(() => { localStorage.setItem(STUDIO_W_KEY, String(studioW)); }, [studioW]);
  // drag the grip: measure from the panel's right edge so the studio grows leftward
  const panelRef = useRef<HTMLElement | null>(null);
  const startStudioDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const right = panelRef.current?.getBoundingClientRect().right ?? window.innerWidth;
    const move = (ev: PointerEvent) => setStudioW(clampStudio(right - ev.clientX));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const [draft, setDraft] = useState('');
  // Request-changes / design-changes speak through the thread composer (v0.33): arming sets a
  // mode pill that scopes the next send to the review action instead of a plain reply.
  const [composerMode, setComposerMode] = useState<'request_changes' | 'revise_design' | 'revise_ship_plan' | 'revise_plan' | null>(null);
  // request-changes on ONE marketing draft: the composer arms with that card as a pill, and the
  // reply posts a thread message referencing it so the marketer knows exactly which draft (§4.5).
  const [mkReplyTo, setMkReplyTo] = useState<{ id: string; letter: string } | null>(null);
  // the reply box is a full ComposerInput — same mentions, popup, and `/` skills as the channel
  const [attachedSkill, setAttachedSkill] = useState<{ name: string; pack?: string | null } | null>(null);
  const atts = useAttachments(plan, onUpgrade);
  const threadDrop = useDropZone(atts.addFiles);
  const [actErr, setActErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [editDetails, setEditDetails] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  // presence (any agent the daemon woke for THIS thread — assignee or not, e.g. rex
  // answering here) vs content (tokens flowing)
  const threadStream = useAgentStream(`${channelId}:${task.id}`);
  const { rows, threadAttByMsg, arts, beats, openArt, setOpenArt, skills, packs, detail, act, artByName, runTrees_, taskRunRows } = useTaskData({ task, channelId, busy, setBusy, setActErr, listRef, threadStream, convoThreadId, setComposerMode });
  const { isContent, mkImageReady, mkPosts, mkPreview, setMkPreview, setMkTick } = useTaskPosts(task, rows.length);
  // The ghost the thread wears while nothing is working yet (docs/26 §5). Derived here, like its
  // sibling in useConvoPresence, so the surface knows whose face it is (run card › ghost › chip).
  const waitCarded = useMemo(() => new Set(runTrees_.filter((t) => isRunOpen(t.run.state as RunState)).map((t) => t.run.agent_id)), [runTrees_]);
  const waitRun = useMemo(() => waitRunFor(taskRunRows.filter((r) => r.task_id === task.id), rows), [taskRunRows, task.id, rows]);
  const waitGhost = useWaitGhost({ rows, agents, channelId, run: waitRun, task, carded: waitCarded });
  const threadAnswers = useMemo(() => answersResolver(rows, decisions), [rows, decisions]);
  const sugTarget = useMemo(() => suggestionTarget(rows, agents), [rows, agents]);
  const threadStreaming = streamContent(threadStream);

  // The panel has ONE view: the thread (v0.64). Review and Diff were tabs that re-listed what the
  // header toks and the inline deliverables already show, and each one hid the conversation to do
  // it — you click a task to see what HAPPENED, and the gate card above the composer carries the
  // decision (docs/25 — "thread owns the middle"). Everything they held is a tok away.
  useEffect(() => { setEditDetails(false); setComposerMode(null); setMkReplyTo(null); }, [task.id]);
  // a reply target is stale once its draft is gone (deleted, or published so it's no longer editable)
  useEffect(() => { if (mkReplyTo && !mkPosts.some((p) => p.id === mkReplyTo.id && p.status !== 'published')) setMkReplyTo(null); }, [mkReplyTo, mkPosts]);
  // an armed mode only makes sense while its gate is open — clear it if the task moves on
  useEffect(() => {
    if (composerMode === 'request_changes' && !['in_review', 'done'].includes(task.state)) setComposerMode(null);
    if (composerMode === 'revise_design' && task.state !== 'design_review') setComposerMode(null);
    if (composerMode === 'revise_plan' && task.state !== 'plan_review') setComposerMode(null);
    if (composerMode === 'revise_ship_plan' && !['ship_review', 'shipping'].includes(task.state)) setComposerMode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.state]);
  // arming drops the caret straight into the reply box — click "Request changes", type, ↵
  useEffect(() => {
    if (composerMode || mkReplyTo) document.querySelector<HTMLTextAreaElement>('.tcompose .cbox textarea')?.focus();
  }, [composerMode, mkReplyTo]);


  const send = async () => {
    const body = draft.trim();
    const attSpecs = atts.specs();
    if ((!body && !attSpecs.length) || atts.busy || !nm) return;
    const mode = composerMode;
    if (mode && !body) return; // sending work back needs words, not just files
    // same guillemet marker as the channel composer — Md renders it as a chip and
    // the orchestrator reads it from the thread transcript
    const marker = attachedSkill ? `‹skill:${attachedSkill.name}${attachedSkill.pack ? `@${attachedSkill.pack}` : ''}› ` : '';
    const msgId = atts.msgId();
    setDraft('');
    setAttachedSkill(null);
    atts.reset();
    // an armed mode posts ONE thread reply (attachments ride along) then fires the review
    // action with the same text — act() skips its own thread post via silentThread.
    if (mode === 'request_changes') {
      await nm.sendThread(task.id, channelId, `Changes requested: ${marker + body}`, { id: msgId, attachments: attSpecs });
      await act('task.request_changes', body, { silentThread: true });
      return;
    }
    if (mode === 'revise_design') {
      const packet = `🎨 Design changes requested on #${task.number} (round ${latestRound}):\n${body}`;
      await nm.sendThread(task.id, channelId, packet, { id: msgId, attachments: attSpecs });
      await act('task.revise_design', packet, { silentThread: true });
      return;
    }
    if (mode === 'revise_plan') {
      // the packet is load-bearing the same way the ship-plan one is: rex's redraft reads the
      // human's feedback from this thread line and re-proposes (propose_impl_plan / propose_plan)
      const packet = `📋 Plan changes requested on #${task.number}:\n${body}`;
      await nm.sendThread(task.id, channelId, packet, { id: msgId, attachments: attSpecs });
      await act('task.revise_plan', packet, { silentThread: true });
      return;
    }
    if (mode === 'revise_ship_plan') {
      // the packet marker is load-bearing: the shipper's redraft reads its feedback
      // from this thread line (the events log is not replicated to clients)
      const packet = `📦 Release-plan changes requested on #${task.number}:\n${body}`;
      await nm.sendThread(task.id, channelId, packet, { id: msgId, attachments: attSpecs });
      await act('task.revise_ship_plan', packet, { silentThread: true });
      return;
    }
    if (mkReplyTo) {
      // reference the exact card so the marketer revises THAT draft; the leading ↩ #n·x reads
      // as a reply chip and the assignee (marketer) is woken by the thread post
      await nm.sendThread(task.id, channelId, `↩ Re #${task.number}·${mkReplyTo.letter}: ${marker + body}`, { id: msgId, attachments: attSpecs });
      setMkReplyTo(null);
      return;
    }
    await nm.sendThread(task.id, channelId, marker + consumeWbAttach(body), { id: msgId, attachments: attSpecs }); // optimistic: renders via watch
  };

  const agentName = (id: string | null) => (id ? (agents.find((a) => a.id === id)?.name ?? 'agent') : null);
  // reply-box roster: only this room's active agents — a thread summons in-channel
  // teammates, so out-of-room names must neither suggest nor light up here — plus the
  // workspace members (humans are workspace-wide, not channel-registered). Handles are
  // reserved against ALL active agents, not just in-room ones, so a member's handle is
  // the same in every composer.
  const liveAgents = agents.filter((a) => !a.retired_at);
  const channelDesigner = liveAgents.find((a) => a.role === 'designer' && agentInChannel(a.channel_ids, channelId)) ?? null;
  const channelArchitect = liveAgents.find((a) => a.role === 'architect' && agentInChannel(a.channel_ids, channelId)) ?? null;
  const threadPeople: ComposerPerson[] = [
    ...liveAgents.filter((a) => agentInChannel(a.channel_ids, channelId)).map((a) => ({ name: a.name, kind: 'agent' as const, here: true, role: a.role, emoji: a.emoji })),
    ...memberPeople(members, liveAgents.map((a) => a.name), selfId, selfEmail),
  ];
  const assignee = task.assignee_kind === 'agent' ? agentName(task.assignee_id) : task.assignee_id ? 'you/team' : null;
  const offered = agentName(task.offered_agent_id);
  const { all: planArts, latest: latestPlan } = pickPlans(arts);
  const { all: shipPlanArts, latest: latestShipPlan } = pickShipPlans(arts);
  // One door, two plan families, and it is the SAME door every other artifact uses: `onPreview`
  // opens a tab, and the tab is a review whenever the artifact is under a gate (docs/36 §13). An
  // explicit name wins (each link opens its exact version); a bare open falls back to the latest
  // implementation plan.
  const openPlan = (name?: string) => onPreview(name ?? latestPlan?.name ?? undefined);
  const { openDesign, roundMockups, latestRound, studioOpen, studioShown } = useDesignDock({ task, arts, designOpen, setDesignOpen, setDesignInitialName, setStudioExp, listRef, onOpenReview });
  const { who, reviewT, events, designProvider, claudeDesignUrl, reviews, workAttempts } = useTaskEvents({ detail, agents, members, rows, task });
  const { canReview, detailsEditable, saveDetails } = useTaskContract({ task, arts, busy, setBusy, setActErr, titleDraft, descDraft, setEditDetails });

  const { subs, openSubs, doneSubs, subRows, subTok, subsWarm, subtaskActions, subtaskDone } = useSubtasks({ task, subtasks, busy, setBusy, actErr, setActErr, agents, act, onOpenTask });


  // the phase spectrum (docs/24): this task's derived journey, one quiet bar
  const spectrumLegs = useMemo(() => {
    if (task.parent_task_id) return []; // subtasks ride the parent's journey
    // a setup task has no build→review→accept journey to derive — the ring was announcing
    // "PHASE 1 OF 3 · BUILD" over a human checklist (George, 2026-08-09). Its progress is the
    // wizard's own step counter, which the queue row and the card already show.
    if (task.kind === 'setup') return [];
    const rosterByRole = (r: string) => agents.find((a) => !a.retired_at && (a.channel_ids ?? '').split(',').includes(channelId) && a.role === r)?.name ?? null;
    const liveBeats = beats.filter((b) => b.phase === task.state);
    const doneBeats = liveBeats.filter((b) => b.status === 'done').length;
    return journeyFor(
      {
        state: task.state, kind: task.kind, blockedFrom: null,
        hasDesignRound: arts.some((a) => a.kind === 'design'),
        hasPlanDoc: arts.some((a) => isPlanDoc(a.name)),
        repoBacked: !!task.repo_id || !!task.pr_number,
        shipGate: shipGate ?? true,
        assigneeName: agents.find((a) => a.id === task.assignee_id)?.name ?? null,
        // plan-first units (docs/41): the DECLARED legs drive the journey; legacy rows keep
        // the evidence derivation (null → journeyFor's old branch, byte for byte)
        workPlanLegs: parseWorkPlanLegs(task.work_plan),
      },
      { designer: rosterByRole('designer'), architect: rosterByRole('architect'), developer: rosterByRole('developer') ?? rosterByRole('worker'), reviewer: rosterByRole('reviewer'), shipper: rosterByRole('shipper') },
      liveBeats.length ? { done: doneBeats, total: liveBeats.length } : undefined,
    );
  }, [task.parent_task_id, task.state, task.repo_id, task.pr_number, task.assignee_id, task.work_plan, arts, beats, agents, channelId, shipGate]);

  const { shipActions, shipCard, verifyingActions } = useShipGate({ task, busy, setBusy, actErr, setActErr, act, agentName, openSubs, composerMode, setComposerMode, canReview, latestShipPlan, openPlan, onPreview });

  // The human "Request design" affordance is GONE (2026-07-30, George): triage owns the
  // design-vs-not call — rex routes user-facing work to the designer (docs/14/16) and the
  // provider question arrives as a decision card when it needs a human. A button that
  // second-guessed triage on every todo task was a second answer to an answered question.

  const { designActions, designHandoff, artStrip, blockedActions } = useTaskGates({ task, channelId, arts, busy, actErr, act, assignee, channelArchitect, composerMode, setComposerMode, onPreview, studioOpen, roundMockups, latestRound, openDesign, designProvider, claudeDesignUrl });


  const { liveLeg, factHolder, factcap, liveBeat, shipBeat, ghostAgentId, typists, typistsBar, blockingInput } = useTaskPresence({ task, channelId, agents, machines, beats, spectrumLegs, runTrees_, assignee, offered, threadStream, busy, act, blocking, setBlocking, blockReason, setBlockReason, onActivity });

  // Marketing content is reviewed PER-CARD (each card opens the human PostPreviewModal to approve +
  // schedule), so there's no group Approve gate for the DRAFTS — but the TASK still needs a way to
  // close out, or it strands in in_review forever (the 2026-07-24 report). A slim task-level bar:
  // approve the reviewed batch to done, then accept & close; Request changes bounces it to the
  // marketer. No Review-Artifacts button — the draft cards ARE the review surface, not a diff panel.
  const contentActions = (task.state === 'in_review' || task.state === 'done') ? (
    <div className="tactions">
      {task.state === 'in_review' ? (
        <button className="btn primary" disabled={busy} onClick={() => void act('task.approve')} title={`the drafts are reviewed — move #${task.number} to done, ready to accept & close`}>Approve drafts</button>
      ) : (
        // ACCEPT IS THE HUMAN'S WORD (George, 2026-09-08): the button is gone everywhere. Say merge in
        // the thread and the orchestrator applies it, on the server's proof that you spoke after review.
        <span className="fomini">Review passed. Say merge here to land #{task.number}.</span>
      )}
      <button
        className="btn"
        disabled={busy}
        aria-pressed={composerMode === 'request_changes'}
        onClick={() => { if (composerMode === 'request_changes') setComposerMode(null); else setComposerMode('request_changes'); }}
        title="send the drafts back to the marketer for changes — arms the reply box below"
      >Request changes</button>
      {actErr && <span className="acterr">{actErr}</span>}
    </div>
  ) : null;
  // A SETUP task's wizard renders IN the transcript, at the top (see the render below) — it
  // docked as a gate above the composer first, and with zero messages the empty transcript
  // stretched a void between the header and the card (George's screenshot, 2026-08-09). The
  // wizard is the thread's CONTENT, like the room's greeting card, not a verdict on it.
  const setupOpen = task.kind === 'setup' && (task.state === 'todo' || task.state === 'in_progress');
  // One state, one gate (v0.36): exactly one contextual surface ever docks above the
  // composer — the card the CURRENT state needs a decision on. A working task docks
  // nothing; everything else lives behind its header tok. A setup task docks nothing.
  // CLOSED IS A DEAD END UNTIL A HUMAN OPENS IT (2026-08-11, George live). Replying into a
  // closed task asks nobody for anything — no agent is watching it, and the FSM has no edge out
  // of `closed`… except the one this ships: `task.reopen`, human-only, landing in `todo`. So the
  // composer stands down and this card takes its place, which is the honest shape: the way back
  // in is a decision, not a message. The docs/25 rule holds — exactly ONE gate card docks.
  const closedActions = task.state === 'closed' ? (
    <div className="tactions closedgate">
      <span className="closednote">This task is closed. Reopen it to reply — it returns to <b>To&nbsp;Do</b> for triage.</span>
      <button className="btn" disabled={busy} onClick={() => void act('task.reopen')}>Reopen task</button>
      {actErr && <span className="acterr">{actErr}</span>}
    </div>
  ) : null;
  // a CLOSED task docks nothing: the reopen card in the composer's slot is its one card, and
  // every other gate offers a move the FSM would refuse anyway (a closed content task would
  // still have shown approve/schedule on its drafts — buttons for a task nobody is working).
  const gate = setupOpen || closedActions
    ? null
    // SUBTASK FIRST, before kind (George, live 2026-08-14 on #1044). A content task that is also
    // a subtask took the content branch and got its task-level Accept — a button `evaluateTransition`
    // is required to refuse ("a subtask has no accept"). Being a subtask is structural; the kind
    // only decides which review surface it gets. VerdictCard already ordered it this way.
    : task.parent_task_id
    ? (subtaskActions ?? subtaskDone)
    : (isContent
    ? contentActions // per-card draft review + a task-level Accept so the content task can close
    : blockedActions
      ?? designActions
      ?? (task.state === 'ship_review' || task.state === 'releasing' || task.state === 'shipping' ? <>{shipCard}{shipActions}</> : null)
      ?? verifyingActions);
  // in_review / done dock NOTHING now — the verdict arrives as the orchestrator's card in the
  // transcript, where it can name the artifacts it is about (see the note on canReview above).

  // ── The rail (docs/25 round 2) ────────────────────────────────────────────────────────────
  // What used to be the facts line and its one drawer. The bodies are unchanged — they moved from
  // an accordion under the header into sections of a panel that is always in the same place. Each
  // section is pushed only when it HAS rows, which is the whole appearance rule: `ThreadRail`
  // renders nothing at all when this array and `extra` are both empty.
  const railSections: RailSection[] = [];
  // Description leads the rail (George, 2026-08-09): it used to render as a block at the TOP
  // of the transcript, where a two-line brief cost the thread its opening messages — prime
  // reading space spent restating what the title and the gate card already say. The rail is
  // where the task's reference material lives (docs/25), and rail sections are always open,
  // so "show it by default" is the shape of the panel rather than a stored preference.
  if (task.description) {
    railSections.push({
      key: 'desc', head: 'Description',
      body: (
        <div className="raildesc">
          <Md text={task.description} taskRef={taskRef} onOpenTask={onOpenTask} />
        </div>
      ),
    });
  }
  // Requirements and the Definition of Done LEFT the rail (rail-ink round 3, 2026-09-04, George on
  // the built card: "I don't think the requirements/DoD section is needed on the workbench"). The
  // plan is where the DoD is authored and revised (docs/41: the architect's `## Definition of
  // Done`, revised through plan review); the server still gates on it and on the confirmed
  // checks. The in-card editor went with the section — the card shows what a session is making.
  if (arts.length > 0) {
    railSections.push({
      key: 'artifacts', head: 'Artifacts', meta: String(arts.length),
      body: (
        <>
          {/* the thumbnail gallery leads the section, as it led the drawer: for a task whose
              deliverables are screenshots, the picture IS the index. It scrolls horizontally
              inside the rail rather than shrinking — a 60px thumb proves nothing. */}
          {artStrip}
          <div className="tarts">
            {arts.map((a) => (
              <span key={a.id} className="artgroup">
                <button
                  className={`artchip${openArt === a.id ? ' on' : ''}`}
                  onClick={() => (planVer(a.name) || shipPlanVer(a.name) ? openPlan(a.name) : a.kind === 'design' || designVer(a.name) ? openDesign(a.name) : setOpenArt(openArt === a.id ? null : a.id))}
                >
                  <span className="akind">{a.kind}</span> <span className="aname">{a.name}</span>
                  {planVer(a.name) > 0 && a.name === latestPlan?.name && planArts.length > 1 && <span className="vbadge">latest</span>}
                  {shipPlanVer(a.name) > 0 && a.name === latestShipPlan?.name && shipPlanArts.length > 1 && <span className="vbadge">latest</span>}
                </button>
                <button
                  className={`star${Number(a.promoted) === 1 ? ' on' : ''}`}
                  title={Number(a.promoted) === 1 ? 'in the channel library' : 'promote to channel library'}
                  disabled={Number(a.promoted) === 1}
                  onClick={() => void nm?.promoteArtifact(a.id)}
                >
                  {Number(a.promoted) === 1 ? '★' : '☆'}
                </button>
              </span>
            ))}
          </div>
          {openArt && (() => {
            const a = arts.find((x) => x.id === openArt);
            if (!a?.inline_content) return <div className="empty">No inline content — fetch the branch to inspect.</div>;
            return a.kind === 'diff' ? <DiffView text={a.inline_content} /> : <pre className="diffview"><div className="dline">{a.inline_content}</div></pre>;
          })()}
          <p className="mkrailhint">★ promotes to the channel library</p>
        </>
      ),
    });
  }
  if (subTok) {
    // warm when open subtasks are holding the parent's next gate — the one signal the collapsed
    // tab's dot is for, so a folded rail still tells you something needs doing
    railSections.push({
      key: 'subtasks', head: 'Subtasks', meta: subs.length ? `${doneSubs}/${subs.length}` : '+', warm: subsWarm,
      body: <>{subRows}<p className="mkrailhint">{subs.length ? `${doneSubs}/${subs.length} done` : 'none yet'} · capped at 8</p></>,
    });
  }
  if (task.pr_number || task.branch) {
    railSections.push({
      key: 'pr', head: 'Pull request', meta: task.pr_number ? `#${task.pr_number}` : 'branch',
      body: (
        <>
          <div className="prline"><span className="k">branch</span><span className="tbranch">{task.branch ?? '—'}</span></div>
          {task.pr_number ? <div className="prline"><span className="k">pull request</span><span>#{task.pr_number} · squash-merges on accept</span></div> : null}
          {canReview && <div className="prline"><button className="btn sm" onClick={() => onPreview()}>Review Artifacts ↗</button></div>}
          <p className="mkrailhint">{workAttempts} work round{workAttempts === 1 ? '' : 's'}</p>
        </>
      ),
    });
  }
  if (reviews.length > 0) {
    railSections.push({
      key: 'rounds', head: 'Review loop', meta: String(reviews.length),
      body: (
        <>
          {reviews.map((e, i) => (
            <div key={e.id} className="auditrow"><span className="rbadge">R{i + 1}</span> <b>{who(e.source)}</b> <span>{e.type === 'task.approved' ? 'approved ✓' : 'changes requested'}</span> <span className="time">{reviewT(e.ts)}</span></div>
          ))}
          <p className="mkrailhint">{reviews.filter((e) => e.type === 'task.approved').length} approved · {reviews.filter((e) => e.type === 'task.changes_requested').length} changes requested</p>
        </>
      ),
    });
  }

  return (
    <aside
      ref={panelRef}
      className="threadpanel"
      style={studioOpen ? ({
        ['--studio-w' as never]: `${studioW}px`,
        // the animated basis: 0 before it opens and while it closes, the dragged width
        // docked, the whole sheet expanded. One number, so open/close/expand/collapse are
        // all the same gesture and the thread column absorbs the difference by itself.
        ['--studio-basis' as never]: !studioShown ? '0px' : studioExp ? '100%' : `${studioW}px`,
      }) : undefined}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || closing) return;
        // the studio unwinds a layer at a time: expanded → docked → closed
        if (studioExp) { setStudioExp(false); return; }
        if (studioOpen) { setDesignOpen(false); return; }
        onClose(); // Esc slides the sheet away (the rail folds from its own chevron)
      }}
    >
      {closing && (
        <Modal
          title={task.state === 'in_progress' ? `Stop #${task.number}?` : `Close #${task.number}?`}
          onClose={() => setClosing(false)}
          footer={
            <>
              <button className="btn sm" onClick={() => setClosing(false)}>Keep it</button>
              <button className="btn danger sm" disabled={busy} onClick={() => void act('task.cancel').then(() => setClosing(false))}>{task.state === 'in_progress' ? 'Stop & close' : 'Close task'}</button>
            </>
          }
        >
          <p className="modalhint">{task.state === 'in_progress'
            ? `The running agent halts immediately and #${task.number} leaves the board. Its audit log stays on the record.`
            : `#${task.number} leaves the board. Its full audit log stays on the record — this can't be undone from here.`}</p>
          {actErr && <div className="acterr" style={{ marginTop: 8 }}>{actErr}</div>}
        </Modal>
      )}
      <ThreadHead wbOpen={wbOpen} onToggleWorkbench={onToggleWorkbench} {...{ act, back, blocking, busy, channelSlug, crumbProject, editDetails, isContent, marks, onClose, onOpenTerminal, onSettle, onViewLogs, peek, setBlocking, setClosing, spectrumLegs, task }} />
      {/* the header zone (v0.36): identity + journey. The journey lives HERE — it IS the
          status summary — and the facts line folds every auxiliary surface into one row of
          toks; clicking one opens a single drawer under the tabs. v0.68: the journey is a
          30px ring at the title's right edge, not a full-width ribbon above the facts. */}
      <div className="phead">
        <div className="pheadtitle">
          {task.title}
          {/* rewriting the task's own title/description is a full-surface act, like the header
              actions above — a peek reads the task and answers its gate (docs/25 §1b) */}
          {detailsEditable && !editDetails && !peek && (
            <button className="dodedit" title="edit the title & description (editable while pre-work)" onClick={() => { setTitleDraft(task.title); setDescDraft(task.description ?? ''); setEditDetails(true); }}>✎ Edit</button>
          )}
        </div>
        {/* what remains of the facts row: the ASSIGNMENT caption only. Its toks became rail
            sections (docs/25 round 2). A content task still carries none — it reads as one
            conversation rather than a work record. */}
        {!isContent && (
          <div className="facts">
            <span className={`specnow${factHolder && liveLeg ? ' working' : ''}`} style={liveLeg ? { ['--segc' as never]: `var(${liveLeg.colorVar})` } : undefined}>
              {/* the face, not just the handle — avatars are the one identity system (docs/33 §8), and
                  a working teammate should be recognisable at a glance rather than parsed from text */}
              {factHolder && <AgentAvatar name={factHolder} size={18} />}
              {factcap}
            </span>
          </div>
        )}
        {/* THE DETAILS TOKS (2026-08-17) — what the Workbench's Details face holds, said out loud
            while it is shut, each one a door to it. The in-sheet rail retired this round, so
            without this the description and the Definition of Done would simply be off-screen
            with nothing on the thread to suggest they exist. It hides while the panel is open:
            a strip pointing at a panel you are already looking at is noise. */}
        {!railSlot && onWorkbench && (
          <RailToks sections={railSections} label={`#${task.number} details`} onOpen={onWorkbench}
            extraLabel={channelKind === 'marketing' ? 'brand' : null} />
        )}
      </div>
      {/* The split (design round 2026-07-28): the studio is a resizable PEER column, not
          an overlay — the thread keeps its --col measure and the studio spends the panel's
          slack. Expanded, the thread column yields the sheet entirely. v0.64 retired the
          tab strip, so the thread (and this split) is now the panel's only view. */}
      <div className={`tsplit${studioOpen ? ' withstudio' : ''}${studioOpen && studioShown && studioExp ? ' exp' : ''}`}>
        <div className="tcol">
          {actErr && <div className="acterr" style={{ padding: '4px 16px 0' }}>{actErr}</div>}
          {/* same bar as the conversation thread: a task worked on someone else's machine reads
              as messages appearing from nowhere unless the surface says who and where */}
          <ThreadLiveBar trees={runTrees_} agents={agents} />
          <div className="jumpwrap">
          <div className="tmsgs" ref={listRef} data-streamkey={`${channelId}:${task.id}`}>
      <ThreadRootPin thread={convoThread ?? null} rows={rows} agents={agents} members={members} />
      {editDetails ? (
        <div className="dodbox">
          <input className="titleinput" value={titleDraft} autoFocus disabled={busy} onChange={(e) => setTitleDraft(e.target.value)} placeholder="task title" />
          <textarea className="dodta" value={descDraft} disabled={busy} onChange={(e) => setDescDraft(e.target.value)} placeholder="details, context, links — everything a teammate needs to pick this up cold. Drop images and discussion in the thread below." />
          <div className="dodactions">
            <button className="btn primary" disabled={busy || !titleDraft.trim()} onClick={() => void saveDetails()}>Save</button>
            <button className="btn" disabled={busy} onClick={() => { setEditDetails(false); setActErr(''); }}>Cancel</button>
          </div>
        </div>
      ) : null}
      {/* the description block LEFT the transcript (George, 2026-08-09): it sat above the
          first message spending the column's opening lines on reference material. It reads
          from the rail's Description section now — same Md, always visible, out of the way.
          The edit box above stays: it is transient, and mid-edit IS the moment you want the
          text front and centre. */}
      {/* the setup wizard leads the transcript — content, not a gate. Docked above the
          composer it left the empty transcript stretching a void over it (same day). It
          renders exactly like the room's greeting: plume's message, then the steps; message
          rows land beneath it as the thread grows. */}
      {setupOpen && (
        <MarketingSetupCard
          channel={{ id: channelId, marketing: channelMarketing ?? null }}
          agent={agents.find((a) => a.role === 'marketer' && !a.retired_at) ?? agents.find((a) => a.role === 'orchestrator' && !a.retired_at) ?? { name: 'plume', role: 'marketer', emoji: null }}
          // nothing to do on completion: the server finishes the task in the same command,
          // the done state syncs down, and this card yields on the next render
          onDone={() => {}}
        />
      )}
        {(() => {
          const renderMsg = (m: MessageRow) => (
            <ThreadMessage
              key={m.id}
              m={m} agents={agents} members={members} selfId={selfId} selfEmail={selfEmail} channelId={channelId}
              atts={threadAttByMsg.get(m.id) ?? []} onOpenAtt={setThreadLightbox}
              answers={threadAnswers(m.id)} decisions={decisions}
              onAnswerPost={(txt) => void nm?.sendThread(task.id, channelId, txt)}
              taskRef={taskRef} onOpenTask={onOpenTask} onOpenWhiteboard={onOpenWhiteboard} onOpenDoc={onOpenDoc} onOpenArticle={onOpenArticle}
              planCtx={{ task, handsOff: routineBorn, onOpenPlan: (name?: string) => openPlan(name), onArmRevise: () => setComposerMode('revise_plan') }}
              md={{
                onOpenPlan: latestPlan || latestShipPlan ? (name?: string) => openPlan(name) : undefined,
                designTaskId: task.id,
                verdictTask: { id: task.id, state: task.state, isSubtask: !!task.parent_task_id, repoBacked: !!task.repo_id },
                onDismissCard: (question: string) => {
                  const d = decisions.find((x) => x.question === question && x.status === 'open');
                  if (d) void nm?.decisionAction('decision.dismiss', d.id);
                },
                fileRef: artByName,
                onOpenFile: onPreview,
              }}
              // docs/25 zoning: while a gate card is docked the row stands down — one decision
              // surface at a time
              suggestions={!gate && !threadStream && sugTarget === m.id
                ? { onPick: (t) => void nm?.sendThread(task.id, channelId, t), onEdit: (t) => { setDraft(t); setCfocus((n) => n + 1); } }
                : null}
            />
          );
          // ── ONE transcript builder ────────────────────────────────────────────────────────
          // This used to be two, split on `if (!isContent)`: a content task got draft cards and
          // NO deliverable strips, no run cards and no design handoff; every other task got those
          // and never a draft card. Neither half was a decision about what a thread should show —
          // it was a decision about what KIND it was, which is the same defect the rail just
          // fixed one layer up. Now every source contributes when it HAS something, and a task
          // that happens to hold both shows both.
          //
          // It is also what lets `draft_posts` drop its refusal guard: there is no longer a task
          // whose drafts would render nowhere.
          const latestMessageAt = rows.length
            ? new Date(rows[rows.length - 1]!.created_at).getTime()
            : Date.now();
          const providerSelected = [...events]
            .reverse()
            .find((event) => event.type === 'task.design_provider_selected' || event.type === 'task.design_requested');
          const providerAt = providerSelected
            ? new Date(providerSelected.ts ?? providerSelected.occurred_at ?? providerSelected.created_at ?? '').getTime()
            : Number.NaN;
          const fallback = Number.isFinite(providerAt) ? providerAt : latestMessageAt;

          const cards = postCardsFrom(mkPosts, rows);
          const renderCard = (c: PostVCard) => (
            <SocialPostCard
              key={c.key} item={c.item} channelSlug={channelSlug} taskNumber={task.number} letter={c.letter}
              version={c.version} superseded={c.superseded}
              onOpen={() => setMkPreview(c.item)}
              onReply={c.superseded ? undefined : () => { setMkReplyTo({ id: c.item.id, letter: c.letter }); setCfocus((n) => n + 1); }}
              onGenerateImage={c.superseded ? undefined : (redraw, kind) => void nm?.sendThread(task.id, channelId, kind === 'video' ? `Film the hook for #${task.number}·${c.letter}.‹gen-video:${c.item.id}›` : `${redraw ? 'Redraw' : 'Generate'} the image for #${task.number}·${c.letter}.‹gen-image:${c.item.id}›`)}
              imageReady={mkImageReady}
            />
          );
          const deliveryCards = cards.filter((c) => !c.isRevision);   // originals + their replaced versions
          const revisionCards = cards.filter((c) => c.isRevision);    // each after its own reply
          // still drafting → a trailing skeleton, with N-of-M when the count is in the ask
          const stillDrafting = (isContent || mkPosts.length > 0)
            && (task.state === 'in_progress' || typists.length > 0 || !!threadStream);
          const draftStrip = deliveryCards.length > 0 || stillDrafting;

          // the liveness pings are hushed only when a DRAFTING STRIP is carrying progress — the
          // condition the old branch expressed as "this is a content task", which silenced them
          // on a content task that had no strip and never on a task that did
          const msgRows = draftStrip ? rows.filter((m) => !/^\s*Still on it — \d+m in \(cap/.test(m.body)) : rows;

          const entries: TimedTranscriptEntry<React.ReactNode>[] = msgRows.map((message, index) => ({
            at: new Date(message.created_at).getTime(),
            order: index,
            value: renderMsg(message),
          }));

          // Deliverables (docs/30): each submit's files render as their OWN strip at the moment
          // they landed. Echoes of messages already on screen are dropped — and so is the
          // marketer's WIRE FILE when its posts are already on screen as cards. That last rule is
          // what the kind-branch was really providing: `posts.json` cards as a fallback when
          // nothing else renders those posts, never beside the cards themselves. Plan documents
          // follow the same rule (2026-08-18, founder report — "another message from rex?"): each
          // version's ‹plan:vN› message already renders the document as its review card, so the
          // strip showing the doc again read as a duplicate reply. Card when carding, strip as
          // the fallback for pre-marker threads.
          const bodies = rows.map((m) => m.body);
          const planCarding = bodies.some((b) => parsePlanRef(b));
          const deliverable = renderableDeliverables(
            arts
              .filter((a) => !(cards.length > 0 && isPostsFile(a.name)))
              .filter((a) => !(planCarding && isPlanDoc(a.name)))
              .map((a) => ({ id: a.id, name: a.name, kind: a.kind, content: a.inline_content, createdAt: a.created_at })),
            bodies,
          );
          const byId = new Map(arts.map((a) => [a.id, a]));
          const supers = supersededIds(deliverable);
          for (const batch of groupDeliveries(deliverable)) {
            const rowArts = batch.map((b) => byId.get(b.id)).filter((a): a is ArtifactUI => !!a);
            if (!rowArts.length) continue;
            entries.push({
              at: new Date(rowArts[rowArts.length - 1]!.created_at).getTime(),
              order: 9_500,
              // a plan card opens the block-comment REVIEW overlay, not the generic artifact
              // preview — the same routing the artifacts rail section already does
              value: (
                <DeliveryStrip
                  key={`delivery-${rowArts[0]!.id}`}
                  arts={rowArts}
                  superseded={supers}
                  onOpen={(name) => (planVer(name) || shipPlanVer(name) ? openPlan(name) : onPreview(name))}
                />
              ),
            });
          }

          // Runs (docs/29): work that outlived its turn renders in the transcript, in start order.
          // A content task draws these now too — its marketer's run was always there, and the
          // kind-branch was the only reason it went unnarrated.
          for (const t of runTrees_) {
            // A LIVE run pins to the tail; a settled one sorts by when it started.
            // Anchoring a running card to started_at buries it: the work goes on for minutes and
            // every message posted meanwhile lands underneath, so the card that is still moving is
            // no longer the newest thing on screen. Same rule as the design gate — while it is
            // happening it stays last, and once it is history it sits where it happened.
            // MAX_SAFE_INTEGER - 1 keeps it just above the design card's own pin.
            const liveRun = isRunOpen(t.run.state as RunState);
            entries.push({
              at: liveRun ? Number.MAX_SAFE_INTEGER - 1 : new Date(t.run.started_at).getTime(),
              order: 9_000,
              value: <RunCard key={t.run.id} tree={t} agent={agents.find((a) => a.id === t.run.agent_id) ?? null} onActivity={onActivity} />,
            });
          }

          if (designHandoff) {
            // WHILE THE ROUND IS YOURS TO DECIDE, the card is pinned to the tail: it is the thing
            // you have to act on, and chronological placement buries it — the proposal lands at
            // 03:44 and the owner's own announcements at 03:44/03:49/03:50 sort on top of it, which
            // is what the live thread did. Once the decision is made it reverts to its artifact
            // time so the history reads in the order it happened.
            const awaitingYou = task.state === 'design_review';
            const handoffAt = awaitingYou ? Number.MAX_SAFE_INTEGER : designRoundAnchor(roundMockups, fallback);
            entries.push({
              at: handoffAt,
              order: 10_000,
              // Detail events arrive after the artifact/message watches. Anchor the key as
              // well as the sort value so React moves the existing card when its lifecycle
              // time resolves (proposal → approval) instead of preserving its first DOM slot.
              value: <Fragment key={`design-handoff-${latestRound || 1}-${handoffAt}`}>{designHandoff}</Fragment>,
            });
          }

          // ── drafted posts ────────────────────────────────────────────────────────────────
          if (draftStrip) {
            const deliveryAnchor = mkPosts.length ? Math.min(...mkPosts.map((p) => new Date(p.created_at).getTime())) : Date.now();
            const target = (() => { const m = /\b(\d+)\s+(?:x\s+|ig\s+|instagram\s+|social\s+|linkedin\s+|tiktok\s+)?(?:posts?|drafts?|tweets?|slides?)/i.exec(`${task.title} ${task.description ?? ''}`); const n = m ? parseInt(m[1]!, 10) : 0; return n >= 1 && n <= 20 ? n : 0; })();
            entries.push({ at: deliveryAnchor, order: 10_000, value: (
              <div className="mkdrafts" key="delivery">
                <div className="mkdraftsgrid">
                  {deliveryCards.map(renderCard)}
                  {stillDrafting && <DraftingCard done={mkPosts.length} total={target} />}
                </div>
              </div>
            ) });
          }
          for (const c of revisionCards) {
            entries.push({ at: c.anchor, order: 10_000, value: <div className="mkdrafts" key={`rev-${c.key}`}><div className="mkdraftsgrid">{renderCard(c)}</div></div> });
          }
          // SHOW (live #1048): a reply that NAMES drafts re-anchors those cards under it, instead
          // of the marketer retyping the posts as prose beside the cards already rendering them.
          // Same mechanism as ‹revised:…›, different verb. The de-dupe is PER MESSAGE, not global:
          // a draft revised earlier in the thread must still show when the human later asks to see
          // it — only the same reply naming a draft in both markers would double it.
          const currentById = new Map(cards.filter((c) => !c.superseded).map((c) => [c.item.id, c]));
          for (const m of rows) {
            const mk = /‹cards:([^›]+)›/.exec(m.body);
            if (!mk) continue;
            const revisedHere = new Set((/‹revised:([^›]+)›/.exec(m.body)?.[1] ?? '').split(',').map((x) => x.trim()));
            const shown = mk[1]!.split(',').map((x) => x.trim()).filter((id) => !revisedHere.has(id))
              .map((id) => currentById.get(id)).filter((c): c is PostVCard => !!c);
            if (!shown.length) continue;
            entries.push({
              at: new Date(m.created_at).getTime() + 1, order: 10_000,
              value: (
                <div className="mkdrafts mkrecall" key={`show-${m.id}`}>
                  <div className="mkrecallhd"><span className="mkrecalldot" aria-hidden />drafts {shown.map((c) => c.letter).join(', ')}</div>
                  <div className="mkdraftsgrid">{shown.map((c) => renderCard({ ...c, key: `show-${m.id}-${c.key}` }))}</div>
                </div>
              ),
            });
          }
          return orderTranscriptEntries(entries);
        })()}
        {mkPreview && <PostPreviewModal item={mkPreview} channelSlug={channelSlug} channelId={channelId} projectName={crumbProject?.name ?? null} onClose={() => setMkPreview(null)} onChanged={() => setMkTick((n) => n + 1)} />}
        {/* The live-narration ghost, RESTORED for cardless work (2026-07-30, George's live-run
            report). v0.69.2 retired it because a task EXECUTION's run card narrates the same
            work — but a triage/reply wake draws no card (docs/29: a bare wake run is the
            ghost's story), so retiring it unconditionally left those wakes narrated by nothing
            but the typist chip. One live surface per agent, ranked: run card › ghost › chip —
            the ghost stands down only when that agent's own card is on screen. */}
        {!threadStreaming && (() => {
          const ga = ghostAgentId ? agents.find((a) => a.id === ghostAgentId) ?? null : null;
          if (!ga) return null;
          return <AgentGhost key={ga.id} agent={ga} beat={ga.id === task.assignee_id ? liveBeat ?? shipBeat : null} onActivity={onActivity} />;
        })()}
        {/* …and the seconds BEFORE that ghost can exist (docs/26 §5). A reply here wakes an agent
            through the server, so its `thinking` status is two sync hops away — several seconds
            of a thread that looked broken. It is handed the TASK, so the wake's own policy
            decides whether anybody is coming at all: a reply on a settled task wakes nobody
            unless it names somebody, and an orb there would promise an answer never sent. */}
        {!threadStreaming && !ghostAgentId && (
          <WaitGhost found={waitGhost} onRetry={async () => { await nm?.sendThread(task.id, channelId, rows[rows.length - 1]?.body ?? ''); }} />
        )}
        {threadStreaming && <StreamBubble live={threadStreaming} />}
        {/* runTrees_ belongs in this test: a live run card IS activity, and claiming otherwise
            directly under a spinning card is the thread calling itself empty while it works. */}
        {/* a SETUP thread renders no empty-state line at all (George, 2026-08-09): the wizard
            below is the content, the rail's Description already says answers persist, and a
            line whose only job is to caption the blank column ADDS to the blank column. The
            other branches promise agent activity, which a setup task cannot have. */}
        {!rows.length && !threadStream && !designHandoff && !runTrees_.length && task.kind !== 'setup' && (
          <div className="tempty">
            {task.state === 'todo'
              ? 'No replies yet — answer here and the orchestrator picks it up.'
              : 'No activity yet — the thread fills as agents claim, work, and review.'}
          </div>
        )}
      </div>
      </div>
      {/* the brain notice leads the dock (docs/10 §15.7): a seat that cannot run is the thing no
          gate below it can move past. It reads the OWNING conversation's brain, and Reset returns it. */}
      <BrainNotice rows={rows} override={parseBrainOverride(threadBrain ?? null)} onReset={convoThreadId ? async () => { await nm?.threadSetBrain(convoThreadId, null); } : undefined} />
      {(typistsBar || blockingInput || gate) && (
        <div className="tdock" data-gate={gate ? '1' : undefined}>
          {typistsBar}
          {blockingInput}
          {gate}
        </div>
      )}
      <div className="tcompose">
        {/* A CLOSED TASK HAS NO REPLY FIELD (2026-08-11, George live). Replying into it asks
            nobody for anything: no agent watches a terminal task, and until this round the FSM
            had no edge out of `closed` at all. So the composer is not disabled — it is not
            there — and its slot carries the one thing that IS available: reopen (human-only,
            landing in `todo`). A greyed-out box would still look like somewhere to type. */}
        {closedActions ?? (<>
        {!gate && <RunDock trees={runTrees_} agents={agents} onOpen={onActivity} scrollRef={listRef} />}
        {!gate && <BeatsTracker beats={beats} ticker activePhase={task.state} />}
        {/* the stream chip yields to the ghost like every other surface (card › ghost › chip):
            while the ghost narrates this agent's thinking in the stream, a chip saying
            "thinking" again under the composer is the same sentence twice. It returns the
            moment text starts streaming — the bubble takes the stream slot and the chip
            becomes its caption. */}
        {threadStream && (threadStreaming || !ghostAgentId) && (
          <div className="typingbar">
            <TypistChip name={threadStream.agent} label={threadStream.text.trim() ? 'typing' : 'thinking'} onOpen={() => { const ta = agents.find((x) => x.name === threadStream.agent); if (ta) onActivity?.(ta); }} />
            <span className="tdots"><i /><i /><i /></span>
          </div>
        )}
        {hostedGate ? <HostedGate /> : (
        <div
          className={`cbox${threadDrop.dragging ? ' dropping' : ''}${composerMode || mkReplyTo ? ' armed' : ''}`}
          {...threadDrop.dropProps}
          onKeyDownCapture={(e) => { if (e.key === 'Escape' && (composerMode || mkReplyTo)) { e.stopPropagation(); setComposerMode(null); setMkReplyTo(null); } }}
        >
          {composerMode && (
            <div className="skillattach">
              <span className="skillchip modechip">
                {composerMode === 'request_changes'
                  ? <>↩ Request changes · #{task.number}{assignee ? <> · to {assignee}</> : null}</>
                  : composerMode === 'revise_ship_plan'
                    ? <>📦 Release-plan changes · #{task.number}</>
                    : <>Design changes · #{task.number} · round {latestRound}</>}
              </span>
              <button className="skillattachx" title="cancel — esc" onClick={() => setComposerMode(null)}><IconClose s={12} /></button>
            </div>
          )}
          {mkReplyTo && !composerMode && (
            <div className="skillattach">
              <span className="skillchip modechip"><IconReply s={12} /> Request changes · #{task.number}·{mkReplyTo.letter}</span>
              <button className="skillattachx" title="cancel — esc" onClick={() => setMkReplyTo(null)}><IconClose s={12} /></button>
            </div>
          )}
          {attachedSkill && (
            <div className="skillattach">
              <span className="skillchip"><IconSkill s={12} /> skill: {attachedSkill.name}{attachedSkill.pack ? ` · ${attachedSkill.pack}` : ''}</span>
              <button className="skillattachx" title="remove" onClick={() => setAttachedSkill(null)}><IconClose s={12} /></button>
            </div>
          )}
          <AttachTray items={atts.items} onRemove={atts.remove} />
          <ComposerInput
            value={draft}
            onChange={setDraft}
            onSend={() => void send()}
            people={threadPeople}
            skills={skills}
            packs={packs}
            attachedSkill={attachedSkill}
            onPickSkill={setAttachedSkill}
            onClearSkill={() => setAttachedSkill(null)}
            onOpenSkills={onOpenSkills}
            onPaste={(e) => { const fs = filesFromPaste(e); if (fs.length) { e.preventDefault(); atts.addFiles(fs); } }}
            placeholder={
              composerMode === 'request_changes'
                ? `What needs to change? — ↵ sends #${task.number} back${assignee ? ` to ${assignee}` : ''} · esc cancels`
                : composerMode === 'revise_plan'
                  ? `What should change in the plan? — ↵ sends it back for a new version · esc cancels`
                  : composerMode === 'revise_design'
                  ? `What should change in the mockups? — ↵ sends round ${latestRound} back · esc cancels`
                  : composerMode === 'revise_ship_plan'
                    ? `What should change in the release plan? — ↵ sends it back to the shipper · esc cancels`
                    : mkReplyTo
                      ? `What should change on draft ${mkReplyTo.letter}?${assignee ? ` — ${assignee} revises it` : ''} · esc cancels`
                      : `Reply in #${task.number} thread — @ mention · / skill · ↵ send`
            }
            focusSignal={cfocus}
            mentionSignal={cmention}
          />
          <div className="trow">
            <MentionButton onMention={() => setCmention((n) => n + 1)} />
            <AttachButton onFiles={atts.addFiles} count={atts.count} max={atts.limits.maxPerMessage} />
            <ThreadRoomChip slug={channelSlug} />
            {/* docs/10 §15 — the conversation's brain. It lives on the THREAD composer because
                that is where "who am I actually talking to" is asked, and because the override
                it edits belongs to this thread and no other. */}
            {convoThreadId && (
              <BrainChip
                onConnect={onBrainConnect ?? (() => {})}
                project={brainProject ?? null}
                onSetProjectPack={onSetProjectPack}
                thread={{ id: convoThreadId, label: `#${task.number} · ${plainTitle(task.title)}`, override: parseBrainOverride(threadBrain ?? null) }}
                castAgents={liveAgents.filter((a) => agentInChannel(a.channel_ids, channelId))}
                onSetThreadBrain={async (override) => { await nm?.threadSetBrain(convoThreadId, override as Record<string, string> | null); }}
              />
            )}
            <button className="btn primary tsend" disabled={(composerMode || mkReplyTo ? !draft.trim() : !draft.trim() && !atts.count) || atts.busy} onClick={() => void send()} aria-label={atts.busy ? 'Uploading attachments' : 'Send reply'} data-tip="Send · ↵">{atts.busy ? '…' : <IconSend s={20} />}</button>
          </div>
          {threadDrop.dragging && <div className="drophint"><IconPaperclip s={15} /> Drop to attach</div>}
        </div>
        )}
        </>)}
      </div>
      {threadLightbox && <AttachLightbox att={threadLightbox} onClose={() => setThreadLightbox(null)} />}
        </div>
        {/* ONE rail (docs/25 round 2): the thread's own sections, and — when the room is a
            marketing HQ — its brand docs and connections UNDER them. That second half is the fix
            for the inverted case: the brand panel used to mount in a conversation and the room
            home but never here, so a marketing room's own content task was the one place its
            voice and guidelines vanished. */}
        {/* THE DETAILS PANEL (2026-08-16) — description · requirements · Definition of Done ·
            artifacts · subtasks. It renders into the WORKBENCH when the shell offers a slot,
            because two panels at the window's right edge is exactly the duplication this round
            exists to remove: the Workbench was on the frame and this was inside the sheet, three
            inches apart, both of them "the panel beside the thread" (George, live).
            Without a slot — the Workbench closed, or a peek column, or the top dock — it falls
            back to the in-sheet rail it always was, so the details are never simply gone. */}
        {(() => {
          const extra = channelKind === 'marketing'
            ? <BrandSections channelId={channelId} channelSlug={channelSlug} onOpen={(d) => onOpenDoc?.(d)} marketing={channelMarketing} />
            : null;
          if (railSlot) return createPortal(<RailSections sections={railSections} extra={extra} />, railSlot);
          // no slot — the panel is shut or on another face. NOT an in-sheet copy of it (that was
          // the second panel this round removed); the toks under the head say what it holds and
          // open it. `onWorkbench` is the same door the head's dock-right pin uses.
          return null;
        })()}
        {studioOpen && (
          <>
            <div
              className="sgrip"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the design studio"
              title="drag to resize"
              onPointerDown={startStudioDrag}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') setStudioW((w) => clampStudio(w + 32));
                if (e.key === 'ArrowRight') setStudioW((w) => clampStudio(w - 32));
              }}
              tabIndex={0}
            />
            <DesignStudio
              taskId={task.id} taskNumber={task.number} channelId={channelId}
              mockups={roundMockups} round={latestRound} taskState={task.state}
              provider={designProvider === 'claude-design' ? 'claude-design' : 'iris'}
              externalUrl={claudeDesignUrl} initialName={designInitialName} rows={rows} agents={agents}
              designerName={(task.assignee_kind === 'agent' ? agentName(task.assignee_id) : null) ?? channelDesigner?.name ?? 'the designer'}
              shown={studioShown} expanded={studioExp} onToggleExpand={() => setStudioExp((x) => !x)}
              onClose={() => { setStudioExp(false); setDesignOpen(false); }}
            />
          </>
        )}
        </div>
    </aside>
  );
}
