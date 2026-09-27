// THE CODING THREAD (0144, docs/design/coding-threads-2026-09 §5, visual contract Thread.dc.html):
// a conversation whose turns the coding runtime owns, on the ONE session surface. What it ADDS is
// the code face, never a different surface: the head's mode chip, subline and toks · the runtime's
// rows in the thread's own anatomy (thread/CodingTranscript) · ONE gate card above the composer
// (thread/CodingGate) · the one composer with the two coding knobs (thread/CodingComposer) · the
// Changes · Work Plan · Checkpoints · Terminal tabs in the WORKBENCH card (thread/CodeFace), which
// opens by itself on a coding thread (George, 2026-09-26), so the conversation is never covered.
// The session id IS the thread id: the machine's history discovery (actor + repo + thread) and
// the synced code_sessions row agree. Ruling 2 (George, 2026-09-26): the runtime, the voice and
// the brain rule are exactly the Code floor's. Who starts the session: the CLIENT that opens the
// thread — door 1 with the root message as the first prompt, door 2 the same on the next open; a
// thread whose session another client started is opened without a prompt.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RepoUI, WorkspaceProjectRow } from '../bridge/rows-board';
import type { AgentRow } from '../bridge/rows-crew';
import type { CodeSessionRow, MessageRow, ThreadRow } from '../bridge/rows-rooms';
import { nm } from '../bridge/nm';
import type { EngineeringWorkspaceTab } from '../engineering/EngineeringEditor';
import { useEngineeringRuntime } from '../engineering/useEngineeringRuntime';
import { continueEngineeringInAct, dismissEngineeringModeHandoff, resolveEngineeringApproval, setEngineeringMode, setEngineeringModel, setEngineeringPermission, submitEngineeringPrompt } from '../engineering/domain';
import { engineeringHarnessOn, projectOf, repoForProject, repoOf, type MachineChipSlot } from './EngineeringOS';
import { CodeFace } from '../thread/CodeFace';
import { CodingComposer } from '../thread/CodingComposer';
import { CodingGate } from '../thread/CodingGate';
import { CodingTranscript } from '../thread/CodingTranscript';
import { ThreadCrumb, ThreadStatusChip, type HeadStatus } from '../thread/parts';
import { AgentAvatar } from '../components/AgentAvatar';
import { Md } from '../md/Md';
import { MARKER_RE } from '../thread/markers';
import { UnitCard } from '../thread/ThreadMessage';
import { repoLabel } from '../composer/RepoChip';
import { IconAlert, IconBranch, IconCode, IconMachine, IconThreads, IconWorkbench } from '../ui/icons';
import { parseKindMarker, parseModeMarker, parseTaskUnitRef, threadTitle } from '@neuramesh/shared';

/** the thread's own messages around the runtime's transcript: rex's line and the kind divider
 *  (door 2) above it, the unit card (the valve's result) below it. The root message is the
 *  session's first prompt, so the transcript carries it. */
function ThreadRows({ rows, agents, repoName, onOpenTask }: { rows: MessageRow[]; agents: AgentRow[]; repoName: string | null; onOpenTask?: ((taskId: string) => void) | undefined }) {
  return rows.map((m) => {
    const unit = parseTaskUnitRef(m.body);
    if (unit) return <div key={m.id} className="msg unitline"><span className="av quiet" aria-hidden><IconThreads s={13} /></span><div className="body">{unit.prose ? <Md text={unit.prose} /> : null}<UnitCard id={unit.id} onOpen={onOpenTask} /></div></div>;
    if (parseKindMarker(m.body) === 'coding') return <div key={m.id} className="sysline"><span>Code work starts here{repoName ? <>, on <b>{repoName}</b></> : null}. The coding runtime takes it from this message on.</span></div>;
    if (parseKindMarker(m.body) || parseModeMarker(m.body)) return null;
    const agent = m.author_kind === 'agent' ? agents.find((a) => a.id === m.author_id) ?? null : null;
    return (
      <div key={m.id} className={`msg${m.author_kind === 'human' ? ' human mine' : ''}`}>
        {agent ? <span className="av"><AgentAvatar name={agent.name} emoji={agent.emoji} size={26} radius={4} role={agent.role} /></span> : null}
        <div className="body">{agent ? <div className="head"><b>{agent.name}</b></div> : null}<Md text={m.body.replace(MARKER_RE, '').trim()} /></div>
      </div>
    );
  });
}

export function CodingThread({ threadId, thread, back, channelSlug, channelId, crumbProject, repos, projects, projectId, workspaceId, codeSession, pickedRepoId, marks, machineChip, machineName, defaultMachineId, plan, onUpgrade, onClose, agents, onOpenTask, railSlot, onWorkbench, wbOpen, onToggleWorkbench }: {
  threadId: string;
  thread: ThreadRow | null;
  back: string;
  channelSlug: string;
  /** the room's id — the valve's create lands the unit in this room */
  channelId: string;
  crumbProject?: { name: string; logo_url?: string | null } | null;
  repos: RepoUI[];
  projects: WorkspaceProjectRow[];
  /** the room's project — the repository comes from it when nothing else names one */
  projectId: string | null;
  workspaceId: string;
  /** the thread's synced session row, once a host has opened it (the repo, the mode, the state) */
  codeSession: CodeSessionRow | null;
  /** the repo chip's pick when THIS client birthed the thread (door 1) */
  pickedRepoId: string | null;
  marks?: HeadStatus | null;
  machineChip?: MachineChipSlot;
  /** the subline's third fact: where the session runs */
  machineName?: string | null;
  defaultMachineId?: string | null;
  plan: string;
  onUpgrade: (reason: string) => void;
  onClose: () => void;
  agents: AgentRow[];
  /** the unit card's door — the peek, as every #N ref opens */
  onOpenTask?: (taskId: string) => void;
  /** the Workbench card's slot: the code face portals in there, as a conversation's details do */
  railSlot?: HTMLElement | null;
  /** opens the Workbench card — a coding thread opens it by itself (George, 2026-09-26) */
  onWorkbench?: () => void;
  wbOpen?: boolean;
  onToggleWorkbench?: () => void;
}) {
  const harness = engineeringHarnessOn();
  const engRepos = useMemo(() => repos.map(repoOf), [repos]);
  const engineering = useEngineeringRuntime(harness, engRepos, workspaceId, threadId, defaultMachineId ?? null);
  const { active, runtime, reason } = engineering;
  const [rows, setRows] = useState<MessageRow[]>([]);
  useEffect(() => { setRows([]); return nm ? nm.watchConvo(threadId, setRows) : undefined; }, [threadId]);
  const root = rows.find((m) => m.author_kind === 'human') ?? null;
  const prelude = useMemo(() => rows.filter((m) => m.id !== root?.id && !parseTaskUnitRef(m.body)), [rows, root?.id]);
  const postlude = useMemo(() => rows.filter((m) => !!parseTaskUnitRef(m.body)), [rows]);
  // the repository, in order: the synced row's, the chip's pick that birthed this thread, the project's primary
  const repoRow = useMemo(() => {
    const byId = (id?: string | null) => (id ? repos.find((r) => r.id === id) ?? null : null);
    return byId(codeSession?.repo_id) ?? byId(pickedRepoId) ?? repoForProject(repos, projectId);
  }, [repos, codeSession?.repo_id, pickedRepoId, projectId]);
  const project = projects.find((p) => p.id === (codeSession?.project_id ?? projectId)) ?? null;
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    if (adopted.current === threadId) return;
    if (!harness && runtime !== 'ready') return;
    if (!repoRow) return;
    const local = engineering.sessions.some((s) => s.id === threadId);
    // the root message IS the first prompt: a session this device has never seen waits for it to sync
    if (!local && !root) return;
    adopted.current = threadId;
    engineering.adopt({
      id: threadId, repo: repoOf(repoRow), project: project ? projectOf(project) : null, machineId: codeSession?.machine_id ?? null,
      // the harness simulates every turn; live, a session another client already started is resumed, never re-prompted
      firstPrompt: local ? null : harness ? root?.body ?? null : codeSession ? null : root?.body ?? null,
    });
  }, [threadId, harness, runtime, repoRow?.id, codeSession?.id, root?.id, engineering.sessions.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // the Workbench is where the code lives: it opens with the thread, and an approval fronts the Changes tab
  const restore = !harness && active ? (checkpointId: string) => engineering.restore(active, checkpointId) : undefined;
  const [wbTab, setWbTab] = useState<EngineeringWorkspaceTab>('changes');
  useEffect(() => { onWorkbench?.(); }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (active?.pendingApproval?.changes?.length) setWbTab('changes'); }, [active?.pendingApproval?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // the transcript follows the newest row, as the conversation thread does
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [active?.messages.length, active?.state, rows.length]);
  const title = thread?.title || (root ? threadTitle(root.body) : 'Code thread');
  const repoName = codeSession?.repo_name || (repoRow ? repoLabel(repoRow) : null);
  const unitId = useMemo(() => rows.map((m) => parseTaskUnitRef(m.body)?.id ?? null).find(Boolean) ?? null, [rows]);
  const [made, setMade] = useState<string | null>(null);
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
  const reviewChanges = () => { setWbTab('changes'); onWorkbench?.(); };
  return (
    <div className="threadpanel convo codingthread" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="thead">
        <button className="scrumb" title="back — Esc" aria-label={`Back to ${back}`} onClick={onClose}>‹ {back}</button>
        <ThreadCrumb project={crumbProject} slug={channelSlug} />
        <span className="convotitle" title={title}>{title}</span>
        {/* the mode is the thread's chip: plan in the plan hue, act in the build hue */}
        {active ? <span className={`chip c-${active.mode}`}>{active.mode}</span> : <span className="chip c-code">code</span>}
        <ThreadStatusChip head={marks} />
        <div className="theadact">{onToggleWorkbench && <button className={`navpin${wbOpen ? ' on' : ''}`} aria-pressed={!!wbOpen} title={wbOpen ? 'Hide the Workbench — ⌘P' : 'Show the Workbench — ⌘P'} onClick={onToggleWorkbench}><IconWorkbench s={14} /></button>}</div>
      </div>
      {/* the subline: branch · repository · machine (the facts live as counts on the Workbench's tabs) */}
      <div className="codinghead">
        <div className="sssub"><IconBranch s={11} /><span>{active?.repo.branch ?? codeSession?.branch ?? repoRow?.default_branch ?? 'main'}</span><span>·</span><span>{repoName ?? 'no repository'}</span>{machineName ? <><span>·</span><IconMachine s={11} /><span>{machineName}</span></> : null}{unitId || made ? <><span>·</span><button className="sssublink" onClick={() => onOpenTask?.(unitId ?? made!)}>a unit ✓</button></> : null}</div>
      </div>
      {railSlot && active ? createPortal(<CodeFace session={active} tab={wbTab} onTab={setWbTab} onSession={engineering.update} onRestore={restore} />, railSlot) : null}
      {!harness && runtime !== 'ready' && (
        <div className={`engnotice engruntime codingnotice${runtime === 'checking' ? '' : ' warning'}`} role="status">
          <span className="engnoticeico"><IconAlert s={14} /></span>
          <span className="engnoticecopy"><b>{runtime === 'checking' ? 'Connecting to your machine…' : 'Code unavailable'}</b><span>{reason ?? 'Connect the workspace relay and a machine to work on the code here.'}</span></span>
        </div>
      )}
      {!repoRow && !codeSession && (
        <div className="engnotice engruntime codingnotice warning" role="status">
          <span className="engnoticeico"><IconAlert s={14} /></span>
          <span className="engnoticecopy"><b>No repository</b><span>Connect a repository to this project. The coding runtime works on it here.</span></span>
        </div>
      )}
      <div className="convobody">
        <div className="convomain">
          <div className="tmsgs convomsgs" ref={listRef}>
            <ThreadRows rows={prelude} agents={agents} repoName={repoName} onOpenTask={onOpenTask} />
            {active ? <CodingTranscript session={active} /> : null}
            <ThreadRows rows={postlude} agents={agents} repoName={repoName} onOpenTask={onOpenTask} />
          </div>
          {active && act ? (
            <>
              <div className="gateseat">
                <CodingGate session={active} threadId={threadId} channelId={channelId} title={title} repoRow={repoRow} repoName={repoName ?? 'the repository'} root={root?.body ?? null}
                  unitId={unitId} hasTask={!!thread?.task_id} onApproval={act.approve} onReviewChanges={reviewChanges} onContinueInAct={act.continueInAct} onDismissHandoff={act.dismissHandoff} onMade={setMade} />
              </div>
              <div className="tcompose"><CodingComposer session={active} project={project} plan={plan} onUpgrade={onUpgrade} machineChip={machineChip}
                onSend={act.send} onMode={act.mode} onPermission={act.permission} onModel={act.model} /></div>
            </>
          ) : (
            <div className="tcompose"><div className="cbox codingbox waiting"><div className="chint coding"><span className="chintcode" aria-hidden><IconCode s={13} /></span><span>{repoRow ? `The coding runtime opens on ${repoName}…` : 'This conversation needs a repository first.'}</span></div></div></div>
          )}
        </div>
      </div>
    </div>
  );
}
