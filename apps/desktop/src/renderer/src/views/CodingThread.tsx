import { CodingMessageBody, codingDelivery, type CodingDisplayDoors } from '../thread/CodingMessageBody';
import { overviewSourceFiles } from '../thread/overview-model';
import { ThreadOverviewBody, useThreadOverview } from '../thread/ThreadOverview';
import { codingOverviewSections, artifactOverviewSection, sourceOverviewSection } from '../thread/overview-sections';
import { AttachLightbox } from '../thread/AttachLightbox';
import type { AttachmentRow } from '../bridge/rows-board';
import { DEFAULT_ENGINEERING_AGENT, type EngineeringSelection } from '@neuramesh/shared';
// THE CODING THREAD (0144, docs/design/coding-threads-2026-09 §5, visual contract Thread.dc.html):
// a conversation whose turns the coding runtime owns, on the ONE session surface. What it ADDS is
// the code face, never a different surface: the head's mode chip, subline and toks · the runtime's
// rows in the thread's own anatomy (thread/CodingTranscript) · ONE gate card above the composer
// (thread/CodingGate) · the one composer with the two coding knobs (thread/CodingComposer) · the
// Changes · Files · Work Plan · Checkpoints · Terminal tabs, the coding thread's own tabs in the
// side panel (thread/CodeFace; the Workbench card until the side-panel round, 2026-10-03), which
// preserve the panel fold across thread changes. Explicit review/plan links open the panel.
// The session id IS the thread id: the machine's history discovery (actor + repo + thread) and
// the synced code_sessions row agree. Ruling 2 (George, 2026-09-26): the runtime and the voice are
// exactly the Code floor's. The brain is the conversation's own pick, else the NeuraMesh brain (George,
// 2026-10-04, shared code-models.ts), never the project's developer seat. Who starts the session: the CLIENT that opens the
// thread — door 1 with the root message as the first prompt, door 2 the same on the next open; a
// thread whose session another client started is opened without a prompt.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { answersResolver, type AnswerDecisionRow } from '../answers';
import type { RepoUI, WorkspaceProjectRow } from '../bridge/rows-board';
import type { AgentRow } from '../bridge/rows-crew';
import type { CodeSessionRow, MessageRow, ThreadRow } from '../bridge/rows-rooms';
import { nm } from '../bridge/nm';
import type { EngineeringWorkspaceTab } from '../engineering/EngineeringEditor';
import { useEngineeringRuntime } from '../engineering/useEngineeringRuntime';
import { continueEngineeringInAct, dismissEngineeringModeHandoff, resolveEngineeringApproval, setEngineeringMode, setEngineeringModel, setEngineeringPermission, submitEngineeringPrompt } from '../engineering/domain';
import { engineeringHarnessOn, projectOf, repoForProject, repoOf, type MachineChipSlot } from './EngineeringOS';
import { CodePanel, codeCountsOf, type CodeCounts } from '../thread/CodeFace';
import { useCodingArtifacts } from '../thread/CodingArtifacts';
import { CodingComposer } from '../thread/CodingComposer';
import { CodingGate } from '../thread/CodingGate';
import { connectedSigns, GitHubGate, GitHubSigns } from '../thread/GitHubGate';
import { CodingTranscript } from '../thread/CodingTranscript';
import { useWorkPlan } from '../engineering/useWorkPlan';
import { useCodeReview } from '../engineering/useCodeReview';
import { ThreadCrumb, ThreadStatusChip, type HeadStatus } from '../thread/parts';
import { AgentAvatar } from '../components/AgentAvatar';
import { Md } from '../md/Md';
import { UnitCard } from '../thread/ThreadMessage';
import { repoLabel } from '../composer/RepoChip';
import { IconAlert, IconCode, IconThreads } from '../ui/icons';
import { parseGitHubConnected, parseKindMarker, parseModeMarker, parseNeed, parseTaskUnitRef, sessionRunLabel, threadTitle } from '@neuramesh/shared';

/** the thread's own messages around the runtime's transcript: rex's line and the kind divider
 *  (door 2) above it, and the unit card of a thread that the retired valve made a unit for. The root message is the
 *  session's first prompt, so the transcript carries it. While the session waits for GitHub, the gate
 *  seat holds the one GitHub card, so a card rex posted before the thread turned to code is not drawn
 *  twice (docs/design/repo-connect-2026-10). `answers` hands a card its decision row (answers.ts). */
function ThreadRows({ rows, agents, repoName, onOpenTask, answers, hideNeeds = false, display }: { display?: CodingDisplayDoors; rows: MessageRow[]; agents: AgentRow[]; repoName: string | null; onOpenTask?: ((taskId: string) => void) | undefined; answers: (messageId: string) => Map<string, string>; hideNeeds?: boolean }) {
  return rows.map((m) => {
    const connected = parseGitHubConnected(m.body);
    if (connected) return <div key={m.id} className="srundiv"><span>GitHub connected · {connected} · {sessionRunLabel(m.created_at, Date.now())}</span></div>;
    if (hideNeeds && parseNeed(m.body)?.connect.includes('github')) return null;
    const unit = parseTaskUnitRef(m.body);
    if (unit) return <div key={m.id} className="msg unitline"><span className="av quiet" aria-hidden><IconThreads s={13} /></span><div className="body">{unit.prose ? <Md text={unit.prose} /> : null}<UnitCard id={unit.id} onOpen={onOpenTask} /></div></div>;
    if (parseKindMarker(m.body) === 'coding') return <div key={m.id} className="sysline"><span>Code work starts here{repoName ? <>, on <b>{repoName}</b></> : null}. The coding runtime takes it from this message on.</span></div>;
    if (parseKindMarker(m.body) || parseModeMarker(m.body)) return null;
    const agent = m.author_kind === 'agent' ? agents.find((a) => a.id === m.author_id) ?? null : null;
    return (
      <div key={m.id} className={`msg${m.author_kind === 'human' ? ' human mine' : ''}`}>
        {agent ? <span className="av"><AgentAvatar name={agent.name} emoji={agent.emoji} size={26} radius={4} role={agent.role} /></span> : null}
        <div className="body">{agent ? <div className="head"><b>{agent.name}</b></div> : null}<CodingMessageBody text={m.body} {...display} answers={answers(m.id)} /></div>
      </div>
    );
  });
}

export function CodingThread({ threadId, thread, back, channelSlug, channelId, crumbProject, repos, onReposChanged, projects, projectId, workspaceId, codeSession, pickedRepoId, pickedSelection, marks, machineChip, machineName, defaultMachineId, plan, onUpgrade, onClose, agents, decisions, onOpenTask, onOpenDoc, onOpenWhiteboard, onOpenArticle, codeSlot, codeTab, onCodeTab, onCodeCounts }: {
  threadId: string;
  thread: Pick<ThreadRow, 'id' | 'title' | 'task_id'> | null;
  back: string;
  channelSlug: string;
  /** the room's id: the GitHub gate and the composer read it */
  channelId: string;
  crumbProject?: { name: string; logo_url?: string | null } | null;
  repos: RepoUI[];
  /** reads the room's repositories again: the door of the gate that waits for a repository, since App reads them once per room */
  onReposChanged: () => void;
  projects: WorkspaceProjectRow[];
  /** the room's project — the repository comes from it when nothing else names one */
  projectId: string | null;
  workspaceId: string;
  /** the thread's synced session row, once a host has opened it (the repo, the mode, the state) */
  codeSession: CodeSessionRow | null;
  /** the repo chip's pick when THIS client birthed the thread (door 1) */
  pickedRepoId: string | null;
  /** the model chip's pick at that birth: the session starts on it (null = the NeuraMesh brain) */
  pickedSelection?: EngineeringSelection;
  marks?: HeadStatus | null;
  machineChip?: MachineChipSlot;
  /** the subline's third fact: where the session runs */
  machineName?: string | null;
  defaultMachineId?: string | null;
  plan: string;
  onUpgrade: (reason: string) => void;
  onClose: () => void;
  agents: AgentRow[];
  /** the room's task-less decision rows, as a conversation gets them: a GitHub card above the root reads its own */
  decisions: AnswerDecisionRow[];
  /** the unit card's door — the peek, as every #N ref opens */
  onOpenTask?: (taskId: string) => void;
  onOpenDoc?: CodingDisplayDoors['onOpenDoc'];
  onOpenWhiteboard?: CodingDisplayDoors['onOpenWhiteboard'];
  onOpenArticle?: CodingDisplayDoors['onOpenArticle'];
  /** the side panel's code pane: the code face's body portals in there, as a conversation's details do */
  codeSlot?: HTMLElement | null;
  /** which of the coding thread's own tabs the panel shows (null while another tab is in front) */
  codeTab?: EngineeringWorkspaceTab | null;
  /** bring one of the coding thread's own tabs to the front: `explicit` (a click) opens the panel,
   *  the editor's own jump to Changes obeys a fold made during the run (shell/arrivals.ts) */
  onCodeTab?: (tab: EngineeringWorkspaceTab, explicit?: boolean) => void;
  /** the counts its tabs wear in the panel's strip */
  onCodeCounts?: (counts: CodeCounts | null) => void;
}) {
  const harness = engineeringHarnessOn();
  const engRepos = useMemo(() => repos.map(repoOf), [repos]);
  const engineering = useEngineeringRuntime(harness, engRepos, workspaceId, threadId, defaultMachineId ?? null);
  const { active, runtime, reason } = engineering;
  const artifacts = useCodingArtifacts(threadId, active?.messages.length ?? 0, onOpenDoc);
  const canExecute = harness || runtime === 'ready';
  const [rows, setRows] = useState<MessageRow[]>([]);
  useEffect(() => { setRows([]); return nm ? nm.watchConvo(threadId, setRows) : undefined; }, [threadId]);
  const root = rows.find((m) => m.author_kind === 'human') ?? null;
  // the transcript draws the root as the session's first prompt. With no session open, the prelude draws it, so the
  // person's own ask stays in view above the gate
  const opened = !!active;
  const prelude = useMemo(() => rows.filter((m) => (m.id !== root?.id || !opened) && !codingDelivery(m.body)), [rows, root?.id, opened]);
  const postlude = useMemo(() => rows.filter((m) => codingDelivery(m.body)), [rows]);
  const answersFor = useMemo(() => answersResolver(rows, decisions), [rows, decisions]);
  const signs = useMemo(() => connectedSigns(rows, answersFor), [rows, answersFor]);
  // the repository, in order: the synced row's, the chip's pick that birthed this thread, the project's primary
  const repoRow = useMemo(() => {
    const byId = (id?: string | null) => (id ? repos.find((r) => r.id === id) ?? null : null);
    return byId(codeSession?.repo_id) ?? byId(pickedRepoId) ?? repoForProject(repos, projectId);
  }, [repos, codeSession?.repo_id, pickedRepoId, projectId]);
  const project = projects.find((p) => p.id === (codeSession?.project_id ?? projectId)) ?? null;
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    if (adopted.current === threadId) return;
    // New work waits for its authoritative row and a host; recorded history does not require a runnable machine.
    if (!harness && (!thread || (!codeSession && runtime !== 'ready'))) return;
    if (!repoRow) return;
    const local = engineering.sessions.some((s) => s.id === threadId);
    // the root message IS the first prompt: a session this device has never seen waits for it to sync
    if (!local && !root) return;
    adopted.current = threadId;
    engineering.adopt({
      id: threadId, repo: repoOf(repoRow), project: project ? projectOf(project) : null, machineId: codeSession?.machine_id ?? null, modelOverride: pickedSelection?.modelId ?? null, agentId: pickedSelection?.agentId ?? null, reasoningEffort: pickedSelection?.reasoningEffort ?? null,
      // the harness simulates every turn; live, a session another client already started is resumed, never re-prompted
      firstPrompt: local ? null : harness ? root?.body ?? null : codeSession ? null : root?.body ?? null,
    });
  }, [threadId, thread?.id, harness, runtime, repoRow?.id, codeSession?.id, root?.id, engineering.sessions.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // the side panel is where the code lives: changing threads preserves its fold, and an
  // approval fronts Changes. The tab is the panel's, so a click in its strip and the editor's own
  // jump to Changes go through one door. The door is held in a ref: the editor's effect lists it as
  // a dependency, and a fresh function every render would re-front Changes on every render.
  const restore = !harness && canExecute && active ? (checkpointId: string) => engineering.restore(active, checkpointId) : undefined;
  const wbTab: EngineeringWorkspaceTab = codeTab ?? 'changes';
  const onCodeTabRef = useRef(onCodeTab);
  onCodeTabRef.current = onCodeTab;
  const setWbTab = useCallback((tab: EngineeringWorkspaceTab) => onCodeTabRef.current?.(tab), []);
  const workPlan = useWorkPlan(active, () => onCodeTabRef.current?.('plan', true));
  const review = useCodeReview(active, () => onCodeTabRef.current?.('changes', true));
  // the strip's counts: the changes, the checkpoints, the Work Plan's mark
  const counts = active ? codeCountsOf(active, artifacts.rows.length) : null;
  const countKey = counts ? `${counts.artifacts}|${counts.changes}|${counts.checkpoints}|${counts.plan}` : '';
  useEffect(() => { onCodeCounts?.(counts); }, [countKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onCodeCounts?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  // the transcript follows the newest row, as the conversation thread does
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [active?.messages.length, active?.workPlan, active?.state, rows.length]);
  const title = thread?.title || (root ? threadTitle(root.body) : 'Code thread');
  const repoName = codeSession?.repo_name || (repoRow ? repoLabel(repoRow) : null);
  const unitId = useMemo(() => rows.map((m) => parseTaskUnitRef(m.body)?.id ?? null).find(Boolean) ?? null, [rows]);
  // the harness applies the reducer's pure moves; live, the runtime's methods carry them to the machine
  const act = active ? {
    send: (text: string, uploads: Parameters<typeof engineering.send>[2]) => harness ? engineering.update(submitEngineeringPrompt(active, text)) : engineering.send(active, text, uploads),
    mode: (mode: 'plan' | 'act') => harness ? engineering.update(setEngineeringMode(active, mode)) : engineering.setMode(active, mode),
    permission: (c: Parameters<typeof setEngineeringPermission>[1], v: boolean) => harness ? engineering.update(setEngineeringPermission(active, c, v)) : engineering.setPermission(active, c, v),
    model: (id: string | null) => harness ? engineering.update(setEngineeringModel(active, id)) : engineering.setModel(active, id),
    approve: (ok: boolean) => harness ? engineering.update(resolveEngineeringApproval(active, ok)) : engineering.approve(active, ok),
    continueInAct: () => harness ? engineering.update(continueEngineeringInAct(active)) : engineering.continueInAct(active),
    dismissHandoff: () => harness ? engineering.update(dismissEngineeringModeHandoff(active)) : engineering.dismissModeHandoff(active),
  } : null;
  const display: CodingDisplayDoors = { onOpenDoc, onOpenArticle, onOpenWhiteboard, onOpenTask, fileRef: artifacts.fileRef, onOpenFile: artifacts.openFile, onAnswer: act && canExecute && active?.state !== 'streaming' && active?.state !== 'awaiting_approval' ? text => act.send(text, []) : undefined };
  // the seat holds the GitHub gate (CodingGate ranks a live approval first): a card above it is a second door
  const seatAsksGitHub = active ? active.blockedOn === 'github' && !active.pendingApproval : !repoRow && !codeSession;
  const [sources, setSources] = useState<{ owner: string; rows: AttachmentRow[] }>({ owner: threadId, rows: [] });
  const [source, setSource] = useState<{ owner: string; row: AttachmentRow } | null>(null);
  useEffect(() => nm?.watchConvoAttachments(threadId, (rows) => setSources({ owner: threadId, rows })), [threadId]);
  const overview = useThreadOverview(`thread:${threadId}`, [
    ...codingOverviewSections(active?.id === threadId ? active : null, (active?.id === threadId ? active.repo.branch : null) ?? codeSession?.branch ?? repoRow?.default_branch ?? 'main', {
      plan: () => workPlan.open(), changes: () => review.open(), files: () => onCodeTab?.('files', true),
      approval: () => { if (active?.pendingApproval?.changes?.length) review.open(); else { const gate = listRef.current?.closest('.codingthread')?.querySelector<HTMLElement>('.gateseat button'); gate?.focus(); } },
    }, { machine: machineName, task: unitId && onOpenTask ? () => onOpenTask(unitId) : undefined }),
    artifacts.error ? { id: 'artifacts', label: 'Artifacts', items: [{ id: 'artifact-error', label: 'Artifacts could not refresh', detail: 'Open to retry', open: () => onCodeTab?.('artifacts', true) }] } : artifactOverviewSection(artifacts.rows, onOpenDoc), sourceOverviewSection(overviewSourceFiles(sources.owner === threadId ? sources.rows : [], rows).filter(row => !artifacts.rows.some(artifact => artifact.id === row.id)), (row) => setSource({ owner: threadId, row })),
  ]);
  return (
    <div className="threadpanel convo codingthread" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="thead thread-crumb-row">
        <button className="scrumb" title="back — Esc" aria-label={`Back to ${back}`} onClick={onClose}>‹ {back}</button>
        <ThreadCrumb project={crumbProject} slug={channelSlug} />
        {/* the mode is the thread's chip: plan in the plan hue, act in the build hue */}
        {active ? <span className={`chip c-${active.mode}`}>{active.mode}</span> : <span className="chip c-code">code</span>}
        <ThreadStatusChip head={marks} />
        {overview.toggle}
      </div>
      <div className="thread-title-row"><span className="convotitle" title={title}>{title}</span></div>
      {codeSlot && active ? createPortal(<CodePanel artifacts={artifacts.pane} artifactRef={artifacts.fileRef} onOpenArtifact={artifacts.openFile} selectedReview={review.selectedReview} selectedPlan={workPlan.text} selectedPath={review.path} onSelectPath={review.select} session={active} tab={wbTab} onTab={setWbTab} onSession={engineering.update} onRestore={restore} restoreUnavailable={!harness && !canExecute} />, codeSlot) : null}
      {!harness && runtime !== 'ready' && (
        <div className={`engnotice engruntime codingnotice${runtime === 'checking' ? '' : ' warning'}`} role="status">
          <span className="engnoticeico"><IconAlert s={14} /></span>
          <span className="engnoticecopy"><b>{runtime === 'checking' ? 'Connecting to your machine…' : 'Execution unavailable'}</b><span>{reason ?? 'Connect the workspace relay and a machine to work on the code here.'}</span></span>
        </div>
      )}
      <div className="convobody">
        <div className="convomain">
          <ThreadOverviewBody overview={overview} label={repoName ?? title}>
          <div className="tmsgs convomsgs" ref={listRef}>
            <ThreadRows display={display} rows={prelude} agents={agents} repoName={repoName} onOpenTask={onOpenTask} answers={answersFor} hideNeeds={seatAsksGitHub} />
            {active ? <CodingTranscript {...display} session={active} artifacts={{ rows: artifacts.timelineRows, card: artifacts.cardFor }} onOpenReview={review.openReview} onApproval={canExecute ? act?.approve : undefined} fileRef={artifacts.fileRef} onOpenFile={artifacts.openFile} onOpenWorkPlan={workPlan.open} /> : artifacts.card}
            <ThreadRows display={display} rows={postlude} agents={agents} repoName={repoName} onOpenTask={onOpenTask} answers={answersFor} />
          </div>
          </ThreadOverviewBody>
          <GitHubSigns.Provider value={signs}>
          {active && act ? (
            <>
              {canExecute ? <div className="gateseat">
                <CodingGate session={active} channelId={channelId} room={channelSlug} repoRow={repoRow} repoName={repoName ?? 'the repository'}
                  onApproval={act.approve} onReviewChanges={review.open} onContinueInAct={act.continueInAct} onDismissHandoff={act.dismissHandoff} onReopen={() => engineering.reopen(active)} />
              </div> : null}
              <div className="tcompose"><CodingComposer disabled={!canExecute} onOpenPlan={() => workPlan.open()} session={active} plan={plan} onUpgrade={onUpgrade} machineChip={machineChip}
                onSend={act.send} onMode={act.mode} onPermission={act.permission} roomId={channelId} roomSlug={channelSlug} onConfigure={(selection) => harness ? engineering.update({ ...active, modelOverride: selection.modelId, agentId: selection.agentId, reasoningEffort: selection.reasoningEffort, agent: agents.find((a) => a.id === selection.agentId) ?? DEFAULT_ENGINEERING_AGENT }) : engineering.configure(active, selection)} /></div>
            </>
          ) : !repoRow && !codeSession ? (
            // no repository in the room's read: the GitHub gate, whose pick or door reads the repositories again,
            // and adopt then opens the session on the root message (docs/design/repo-connect-2026-10)
            <div className="gateseat"><GitHubGate channelId={channelId} room={channelSlug} repoName={null} folder={false} onConnected={onReposChanged} /></div>
          ) : (
            <div className="tcompose"><div className="cbox codingbox waiting"><div className="chint coding"><span className="chintcode" aria-hidden><IconCode s={13} /></span><span>{`The coding runtime opens on ${repoName}…`}</span></div></div></div>
          )}
          </GitHubSigns.Provider>
        </div>
      </div>
      {source?.owner === threadId && <AttachLightbox att={source.row} onClose={() => setSource(null)} />}
    </div>
  );
}
