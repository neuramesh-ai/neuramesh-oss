import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { RepoUI, WorkspaceProjectRow } from '../bridge/rows-board';
import { CaughtUpPeek } from '../brand';
import { NM_PLATFORM } from '../lib/platform';
import { EngineeringEditor, type EngineeringWorkspaceTab } from '../engineering/EngineeringEditor';
import { EngineeringRecentState, EngineeringTranscript, EngineeringWorking } from '../engineering/EngineeringActivity';
import { createEngineeringSession, setEngineeringMachine, resolveEngineeringApproval, submitEngineeringPrompt, type EngineeringProject, type EngineeringRepo, type EngineeringSession, type PermissionCategory } from '../engineering/domain';
import type { EngineeringAttachmentUpload } from '../engineering/attachments';
import { scheduleEngineeringSync } from '../engineering/sync';
import { engineeringShellSession } from '../engineering/copy';
import { useEngineeringRuntime } from '../engineering/useEngineeringRuntime';
import { EngineeringComposer } from '../engineering/EngineeringComposer';
import { EngineeringComposerSplitter, useEngineeringComposerResize } from '../engineering/EngineeringComposerResize';
import { ProjectChip } from '../projects/ProjectChip';
import { Popover } from '../ui/Popover';
import { anchorPoint } from '../ui/anchor';
import { IconAlert, IconChevron, IconCode, IconHistory, IconLock, IconSearch } from '../ui/icons';

/** the shell renders the chip (it owns the fleet); Code says which session it edits and whether it is locked */
type MachineChipSlot = (value: string | null, onPick: (machineId: string | null) => void, disabled: boolean) => ReactNode;
const repoOf = (repo: RepoUI): EngineeringRepo => ({ id: repo.id, name: repo.name, owner: repo.org_name, branch: repo.default_branch, root: repo.local_path ?? null });
const projectOf = (project: WorkspaceProjectRow): EngineeringProject => ({ id: project.id, name: project.name, slug: project.slug, logoUrl: project.logo_url });
const ids = (value?: string | null) => new Set((value ?? '').split(',').filter(Boolean));
const repoForProject = (repos: RepoUI[], projectId: string | null): RepoUI | null => {
  if (!projectId) return repos[0] ?? null;
  return repos.find((repo) => ids(repo.primary_project_ids).has(projectId)) ?? repos.find((repo) => ids(repo.project_ids).has(projectId)) ?? null;
};

const stateLabel = (state: EngineeringSession['state']) => ({ idle: 'Ready', streaming: 'Working', awaiting_approval: 'Needs approval', resumable: 'Paused', completed: 'Complete', error: 'Blocked' })[state];

function ApprovalCard({ session, onResolve }: { session: EngineeringSession; onResolve: (approved: boolean) => void }) {
  const approval = session.pendingApproval;
  const [shown, setShown] = useState(approval);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (approval) { setShown(approval); setClosing(false); return undefined; }
    if (!shown) return undefined;
    setClosing(true);
    const timer = window.setTimeout(() => { setShown(null); setClosing(false); }, 140);
    return () => window.clearTimeout(timer);
  }, [approval, shown]);
  if (!shown) return null;
  return (
    <div className="engapproval" data-state={closing ? 'closing' : 'open'} role="alert">
      <div className="engapprovaltop"><span className="engapprovalico"><IconLock s={13} /></span><span><b>{shown.title}</b><small>{shown.detail}</small></span></div>
      {shown.command && <code>{shown.command}</code>}
      {shown.changes?.length ? <div className="engapprovalstat">{shown.changes.length} files · complete patch open on the right</div> : null}
      <div className="engapprovalactions">
        <button className="btn sm" onClick={() => onResolve(false)}>Decline</button>
        <button className="btn primary sm" onClick={() => onResolve(true)}>Approve once</button>
      </div>
    </div>
  );
}

function Conversation({ session, projects, project, plan, onUpgrade, onNewProject, onProject, onSession, onSend, onMode, onPermission, onModel, onContinueInAct, onDismissModeHandoff, onApproval, machineChip }: {
  session: EngineeringSession; onSession: (session: EngineeringSession) => void;
  projects: WorkspaceProjectRow[]; project: WorkspaceProjectRow | null; plan: string;
  onUpgrade: (reason: string) => void; onNewProject: (origin: { x: number; y: number } | null) => void; onProject: (id: string) => void;
  onSend?: (prompt: string, uploads: EngineeringAttachmentUpload[]) => void; onMode?: (mode: 'plan' | 'act') => void;
  onPermission?: (category: PermissionCategory, value: boolean) => void; onModel?: (modelId: string | null) => void;
  onContinueInAct?: () => void; onDismissModeHandoff?: () => void;
  onApproval?: (approved: boolean) => void; machineChip?: MachineChipSlot;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const followsStream = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  useEffect(() => {
    if (!followsStream.current) return;
    const frame = requestAnimationFrame(() => {
      scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
      setShowJumpToBottom(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [session.pendingApproval?.id, session.updatedAt]);
  const jumpToBottom = () => {
    followsStream.current = true;
    setShowJumpToBottom(false);
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' });
  };
  const streamingReasoning = session.messages.some((item) => item.role === 'reasoning' && item.streaming);
  return (
    <section className="engconversation">
      <div className="engmessageviewport">
        <div className="engmessages" ref={scroll} onScroll={(event) => {
          const pane = event.currentTarget;
          const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 56;
          followsStream.current = atBottom;
          setShowJumpToBottom(!atBottom);
        }}>
          <EngineeringTranscript messages={session.messages} />
          {session.state === 'streaming' && !streamingReasoning ? <EngineeringWorking session={session} /> : null}
          <ApprovalCard session={session} onResolve={(approved) => onApproval ? onApproval(approved) : onSession(resolveEngineeringApproval(session, approved))} />
        </div>
        {showJumpToBottom ? <button className="engscrollbottom" onClick={jumpToBottom} aria-label="Scroll to latest message" data-tip="Scroll to latest"><IconChevron s={14} /></button> : null}
      </div>
      <EngineeringComposer session={session} onSession={onSession}
        onSend={(prompt, uploads) => onSend ? onSend(prompt, uploads) : onSession(submitEngineeringPrompt(session, prompt))}
        onMode={onMode} onPermission={onPermission} onModel={onModel}
        onContinueInAct={onContinueInAct} onDismissModeHandoff={onDismissModeHandoff}
        projects={projects} project={project} onProject={onProject} onNewProject={onNewProject}
        plan={plan} onUpgrade={onUpgrade}
        machineChip={machineChip?.(session.machineId ?? null, (id) => onSession(setEngineeringMachine(session, id)), true)} />
    </section>
  );
}

function EngineeringCodeHistory({ sessions, onOpen, onClose }: { sessions: EngineeringSession[]; onOpen: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const shown = sessions
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter((session) => `${session.title} ${session.project?.name ?? ''} ${session.repo.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Popover label="Code history" anchor={anchorPoint('.engrecentall')} width={440} align="end" onClose={onClose} className="enghistorypop">
      <div className="enghistoryhead"><IconSearch s={14} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Code threads…" aria-label="Search Code threads" /><span>{shown.length}</span></div>
      <div className="enghistorylist">
        {shown.map((session) => <button key={session.id} onClick={() => { onOpen(session.id); onClose(); }}><EngineeringRecentState session={session} /><span><b>{session.title}</b><small><span>{session.project?.name ?? 'Workspace'}</span> · {session.repo.name} · {stateLabel(session.state)}</small></span><em>{session.mode === 'plan' ? 'Plan' : 'Act'}</em></button>)}
        {!shown.length ? <div className="enghistoryempty">{query ? 'No Code threads match this search.' : 'Your Code threads will appear here.'}</div> : null}
      </div>
    </Popover>
  );
}

function EngineeringStart({ repoRows, projects, initialProjectId, sessions, runtime, reason, plan, onUpgrade, onNewProject, onOpen, onStart, machineChip, defaultMachineId = null }: {
  repoRows: RepoUI[]; projects: WorkspaceProjectRow[]; initialProjectId: string | null;
  sessions: EngineeringSession[];
  runtime: 'checking' | 'ready' | 'unavailable';
  reason?: string;
  onOpen: (id: string) => void;
  plan: string; onUpgrade: (reason: string) => void;
  onNewProject: (origin: { x: number; y: number } | null) => void;
  onStart: (repo: EngineeringRepo, prompt: string, preferences: Pick<EngineeringSession, 'mode' | 'permissions' | 'modelOverride' | 'brainPack' | 'machineId'>, uploads: EngineeringAttachmentUpload[], project: EngineeringProject | null) => void;
  machineChip?: MachineChipSlot; defaultMachineId?: string | null;
}) {
  const ready = runtime === 'ready';
  const activeProjects = projects.filter((project) => project.status === 'active');
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId ?? activeProjects[0]?.id ?? null);
  const selectedProject = activeProjects.find((project) => project.id === selectedProjectId) ?? activeProjects[0] ?? null;
  // A new Code task is project-owned. Never guess across repositories while the relation is
  // still syncing: the machine enforces the same join, so a guessed repo would only open a
  // misleading draft and fail after the user sends it.
  const selectedRepoRow = selectedProject ? repoForProject(repoRows, selectedProject.id) : null;
  const selectedRepo = selectedRepoRow ? repoOf(selectedRepoRow) : null;
  // the draft is born on the machine the shell defaults to (rule D9); the chip edits it in place until send
  const freshDraft = () => selectedRepo ? createEngineeringSession(selectedRepo, 'New Code task', selectedProject ? projectOf(selectedProject) : null, defaultMachineId) : null;
  const [draftSession, setDraftSession] = useState<EngineeringSession | null>(freshDraft);
  useEffect(() => { setDraftSession((current) => current !== null && current.repo.id === selectedRepo?.id && current.project?.id === selectedProject?.id ? current : freshDraft()); }, [selectedProject?.id, selectedRepo?.id]);
  const sorted = useMemo(() => sessions.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [sessions]);
  const [visibleCount, setVisibleCount] = useState(5);
  const [historyOpen, setHistoryOpen] = useState(false);
  const recentRoot = useRef<HTMLDivElement>(null);
  const recentSentinel = useRef<HTMLDivElement>(null);
  useEffect(() => { setVisibleCount((count) => Math.min(Math.max(count, 5), Math.max(sorted.length, 5))); }, [sorted.length]);
  useEffect(() => {
    const root = recentRoot.current;
    const sentinel = recentSentinel.current;
    if (!root || !sentinel || visibleCount >= sorted.length) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisibleCount((count) => Math.min(count + 5, sorted.length));
    }, { root, rootMargin: '48px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sorted.length, visibleCount]);
  const recent = sorted.slice(0, visibleCount);
  return (
    <section className="engconversation engstart">
      <div className="engstartbody">
        <div className="engstarthero"><span className="engstartmark"><CaughtUpPeek play /></span><h2>What can I do for you?</h2></div>
        {runtime !== 'ready' ? <div className={`engnotice engruntime${runtime === 'checking' ? '' : ' warning'}`} role="status">
          <span className="engnoticeico"><IconAlert s={14} /></span>
          <span className="engnoticecopy"><b>{runtime === 'checking' ? 'Connecting to your cloud machine…' : 'Code unavailable'}</b><span>{reason ?? 'Connect the workspace relay and cloud machine to start coding.'}</span></span>
        </div> : null}
        <div className="engrecentregion">
          <div className="engrecenthead"><span><IconHistory s={12} /> Recent</span><button className="engrecentall" onClick={() => setHistoryOpen(true)}>View all <span aria-hidden>→</span></button></div>
          <div ref={recentRoot} className="engrecent" aria-label="Recent Code threads">
            {recent.map((session) => <button key={session.id} onClick={() => onOpen(session.id)}><EngineeringRecentState session={session} /><span><b>{session.title}</b><small><span className="engrecentproject">{session.project?.name ?? 'Workspace'}</span> · {session.repo.name} · {stateLabel(session.state)}</small></span><em>{session.mode === 'plan' ? 'Plan' : 'Act'}</em></button>)}
            {!recent.length && <div className="engemptycard">Your recent Code threads will appear here after you send.</div>}
            {visibleCount < sorted.length ? <div ref={recentSentinel} className="engrecentsentinel" aria-hidden /> : null}
          </div>
        </div>
        {historyOpen ? <EngineeringCodeHistory sessions={sorted} onOpen={onOpen} onClose={() => setHistoryOpen(false)} /> : null}
      </div>
      {draftSession && selectedRepo ? (
        <EngineeringComposer session={draftSession} onSession={setDraftSession} disabled={!ready}
          onSend={(prompt, uploads) => onStart(selectedRepo, prompt, draftSession, uploads, selectedProject ? projectOf(selectedProject) : null)}
          projects={activeProjects} project={selectedProject} onProject={setSelectedProjectId} onNewProject={onNewProject}
          plan={plan} onUpgrade={onUpgrade}
          machineChip={machineChip?.(draftSession.machineId ?? null, (id) => setDraftSession(setEngineeringMachine(draftSession, id)), !ready)} />
      ) : <div className="engstartnorepo">
        <span>{selectedProject ? `Connect a repository to ${selectedProject.slug} to start a Code thread.` : 'Create a project and connect a repository to start a Code thread.'}</span>
        {selectedProject ? <ProjectChip projects={activeProjects} active={selectedProject}
          onSwitch={setSelectedProjectId} onNew={onNewProject} /> : null}
      </div>}
    </section>
  );
}

function EngineeringStandby({ repos }: { repos: EngineeringRepo[] }) {
  return (
    <section className="engeditor engstandby" aria-label="Code workspace">
      <div className="engeditorbody">
        <div className="engeditorempty"><IconCode s={30} /><b>Your code stays in view</b><span>Open a recent thread or start a new one. Complete patches, files, plans, and checkpoints will appear here.</span>{repos.length ? <small>{repos.length} connected repositor{repos.length === 1 ? 'y' : 'ies'}</small> : null}</div>
      </div>
    </section>
  );
}

export function EngineeringOS({ repos: repoRows, projects, activeProjectId = null, plan = 'free', onUpgrade = () => {}, onProjectChange = () => {}, onNewProject = () => {}, workspaceId, initialSessionId = null, homeRequest = 0, editorTab, onEditorTab, onSessionsChange, onActiveSessionChange, machineChip, defaultMachineId = null }: {
  repos: RepoUI[];
  projects: WorkspaceProjectRow[];
  activeProjectId?: string | null;
  plan?: string; onUpgrade?: (reason: string) => void;
  onProjectChange?: (id: string) => void;
  onNewProject?: (origin: { x: number; y: number } | null) => void;
  workspaceId: string; initialSessionId?: string | null;
  homeRequest?: number;
  editorTab: EngineeringWorkspaceTab;
  onEditorTab: (tab: EngineeringWorkspaceTab) => void;
  onSessionsChange?: (sessions: EngineeringSession[]) => void;
  onActiveSessionChange?: (sessionId: string | null) => void;
  /** rule D9: the composer's machine chip (the shell builds it — it needs the fleet) and the machine a new session starts on */
  machineChip?: MachineChipSlot; defaultMachineId?: string | null;
}) {
  // `?engruntime=unavailable` lets the preview harness render the unavailable notice: the mock bridge has no Code methods, so the hook lands in its "no bridge" branch
  const harness = (NM_PLATFORM === 'preview' && (typeof location === 'undefined' || new URLSearchParams(location.search).get('engruntime') !== 'unavailable')) || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('engineeringHarness') === '1');
  const repos = useMemo(() => repoRows.map(repoOf), [repoRows]);
  const engineering = useEngineeringRuntime(harness, repos, workspaceId, initialSessionId, defaultMachineId);
  const { active, sessions, runtime, reason } = engineering;
  const activeProject = projects.find((project) => project.id === active?.project?.id) ?? projects.find((project) => project.id === activeProjectId) ?? projects.find((project) => project.status === 'active') ?? null;
  const createForProject = (projectId: string) => {
    const project = projects.find((candidate) => candidate.id === projectId) ?? null;
    const repo = repoForProject(repoRows, project?.id ?? null);
    onProjectChange(projectId);
    // Switching to a project without a connected repository is still a meaningful selection:
    // return to the Code start state, where the missing connection is explained and the user can
    // create/connect a project instead of having the picker silently ignore their choice.
    if (!repo) { engineering.home(); return; }
    engineering.create(repoOf(repo), project ? projectOf(project) : null);
  };
  const workspaceRef = useRef<HTMLDivElement>(null);
  const appliedHomeRequest = useRef(homeRequest);
  const composerResize = useEngineeringComposerResize(workspaceRef);
  useEffect(() => {
    if (appliedHomeRequest.current === homeRequest) return;
    appliedHomeRequest.current = homeRequest;
    engineering.home();
  }, [homeRequest]);
  useEffect(() => scheduleEngineeringSync(() => onSessionsChange?.(sessions.map(engineeringShellSession))), [onSessionsChange, sessions]);
  useEffect(() => { onActiveSessionChange?.(active?.id ?? null); }, [active?.id, onActiveSessionChange]);
  return (
    <div className="engos" data-runtime={harness ? 'harness' : runtime === 'ready' ? 'engineering-relay' : 'unavailable'}>
      <div ref={workspaceRef} className="engworkspace" data-resizing={composerResize.resizing || undefined}
        style={{ '--eng-composer-width': `${composerResize.width}px` } as CSSProperties}>
        {active ? (
          <Conversation session={active} projects={projects.filter((project) => project.status === 'active')} project={activeProject}
            plan={plan} onUpgrade={onUpgrade} onNewProject={onNewProject} onProject={createForProject}
            onSession={engineering.update} machineChip={machineChip}
            {...(!harness ? { onSend: (prompt: string, uploads: EngineeringAttachmentUpload[]) => engineering.send(active, prompt, uploads), onMode: (mode: 'plan' | 'act') => engineering.setMode(active, mode), onContinueInAct: () => engineering.continueInAct(active), onDismissModeHandoff: () => engineering.dismissModeHandoff(active), onPermission: (category: PermissionCategory, value: boolean) => engineering.setPermission(active, category, value), onModel: (modelId: string | null) => engineering.setModel(active, modelId), onApproval: (approved: boolean) => engineering.approve(active, approved) } : {})} />
        ) : <EngineeringStart repoRows={repoRows} projects={projects} initialProjectId={activeProjectId} sessions={sessions} runtime={runtime} reason={reason}
          plan={plan} onUpgrade={onUpgrade} onNewProject={onNewProject}
          onOpen={engineering.open} onStart={engineering.start} machineChip={machineChip} defaultMachineId={defaultMachineId} />}
        <EngineeringComposerSplitter {...composerResize} />
        {active ? <EngineeringEditor session={active} onSession={engineering.update} tab={editorTab} onTab={onEditorTab} {...(!harness ? { onRestore: (checkpointId: string) => engineering.restore(active, checkpointId) } : {})} /> : <EngineeringStandby repos={repos} />}
      </div>
    </div>
  );
}
