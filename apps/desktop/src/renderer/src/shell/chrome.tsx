// The shell's chrome — the dock bar, the utility cluster, the nav's workspace foot and the
// strip under them. Extracted from App.tsx (track A4).
import { CreditRing } from './CreditRing';
import { IconActivity, IconChevron, IconCloud, IconCmd, IconDockRight, IconGlobe, IconMachine, IconServer, IconTerm } from '../ui/icons';
import type { ConnectionKind } from '../bridge/nm';
import { type AgentRow } from '../bridge/rows-crew';
import { type ProcList } from '../bridge/rows-infra';
import { type TaskAllRow } from '../bridge/rows-board';
import { type WTabKind } from '../wtabs';
import { useState } from 'react';

// ── Subtasks fold on a board card (docs/24): companion work never gets its own
// card — the parent grows this strip: count · quiet progress · status rows. ──
export function SubStrip({ subs, agents, onOpen }: { subs: TaskAllRow[]; agents: AgentRow[]; onOpen?: (id: string) => void }) {
  const doneCount = subs.filter((x) => x.state === 'done' || x.state === 'closed').length;
  const allDone = doneCount === subs.length;
  const [open, setOpen] = useState(!allDone);
  if (!subs.length) return null;
  const who = (x: TaskAllRow) => agents.find((a) => a.id === x.assignee_id || a.id === x.offered_agent_id)?.name ?? null;
  return (
    <div className="substrip" onClick={(e) => e.stopPropagation()}>
      <button className="subtog" onClick={() => setOpen((o) => !o)}>
        <span className="chev">{open ? '▾' : '▸'}</span> subtasks
        <span className="subbar">{doneCount}/{subs.length} <span className="subbarline"><i style={{ width: `${Math.round((doneCount / subs.length) * 100)}%` }} /></span></span>
      </button>
      {open && subs.map((x) => {
        const done = x.state === 'done' || x.state === 'closed';
        const activeSub = x.state === 'in_progress';
        return (
          <div key={x.id} className={`subrow${done ? ' done' : ''}`} role={onOpen ? 'button' : undefined} onClick={onOpen ? () => onOpen(x.id) : undefined}>
            <span className="sdot">
              {done ? (
                <svg className="scheck" viewBox="0 0 13 13"><circle cx="6.5" cy="6.5" r="6" /><path d="M4.1 6.8l1.6 1.6 3-3.5" /></svg>
              ) : activeSub ? <span className="sactive" /> : <span className="sring" />}
            </span>
            <span className="sid">#{x.number}</span>
            <span className="st" title={x.title}>{x.title}</span>
            {who(x) && <span className="who">{who(x)}</span>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * THE WORKSPACE FOOT (2026-08-16) — the successor to the spine (v0.76, `.prail`).
 *
 * The spine spent 30px of frame standing a single vertical string beside the nav. The contract it
 * existed to protect — the WORKSPACE is a different scope from the project under it — survives
 * without a column of its own: the workspace sits at the FOOT of the nav, under everything it
 * contains, which says the same thing by position and costs nothing. The 30px went back to the
 * sheet and `--projrail-w` retired with it.
 *
 * It carries every tenant the spine had:
 *  · the workspace's marks — a pulse while an agent works ANYWHERE, a dot when a room has moved
 *    unseen. They coexist; picking one would drop a signal exactly when the workspace is busiest.
 *  · the trigger for the second face — hover (140ms intent, armed by the shell), click to pin,
 *    ⌘⇧P. The face crosses in over the same column, 0px layout shift, unchanged machinery.
 *  · the account, at the bar's right end, disclosing the face's account block.
 *  · the CREDIT RING (2026-08-28), between the name and the account: the WORKSPACE's balance
 *    beside the person spending it. It owns its own read (`CreditRing.tsx`), so this bar stays
 *    the declarative thing it was and App.tsx never learns about credits.
 *
 * It renders OUTSIDE the faces, and that placement is load-bearing rather than incidental: inside
 * the rooms face it was hidden the moment the face crossed over, which pulled it out from under
 * the cursor, fired its own `mouseleave`, closed the face, put it back under the cursor and
 * flipped the column forever (George, live, 2026-08-16). A hover trigger cannot live inside the
 * thing it reveals. Out here it is the HINGE the face opens above — which is also why the face
 * stopped drawing an account row of its own: this bar IS that row.
 *
 * The fold's chevron does NOT come along: with no strip left at the edge there is nothing to
 * unfold from, and docs/33 §2 has always said the fold control belongs on the frame top
 * (`.ftfold`, present in every view). Folded, that pin wears the unread dot so the fold still
 * costs no information.
 */
export function NavWorkspaceFoot({ workspace, initial, unread, faceOpen, onToggleFace, onHover, onUpgrade, connection, connectionHost }: {
  /** the WORKSPACE name — the bar's whole subject */
  workspace: string;
  /** its tile letter (the workspace's initial, never the signed-in person's) */
  initial: string;
  /** a room has moved and you have not seen it */
  unread: boolean;
  /** the column above it is showing its workspace face */
  faceOpen: boolean;
  onToggleFace: () => void;
  onHover: (over: boolean) => void;
  /** the credit popover's way out of a cap — the shared upgrade surface, with a reason */
  onUpgrade?: (reason: string) => void;
  /** the connection this workspace lives on (main/connections.ts): the laptop on local, the cloud
   *  on cloud (artboard A5), a server for a custom one (artboard B4). The dev lane draws no glyph. */
  connection?: ConnectionKind;
  /** a custom server's host — the glyph's word */
  connectionHost?: string | null;
}) {
  return (
    <div
      className={`navwsfoot${faceOpen ? ' open' : ''}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <button
        type="button"
        className="navwsmain"
        onClick={onToggleFace}
        aria-expanded={faceOpen}
        title={`${workspace} — workspace menu · ⌘⇧P${unread ? ' · a channel has moved' : ''}`}
        aria-label={`${workspace} workspace menu${unread ? ', unread channels' : ''}`}
      >
        <span className="navwstile" aria-hidden>
          {/* no live pulse here (George, 2026-09-19: "the weird border blinking on the workspace icon"):
              liveness stays on the tree's group headers, per project, where it names its work */}
          {unread && <span className="navwsunread" />}
          {initial}
        </span>
        <span className="navwsname">{workspace || '…'}</span>
        {connection === 'local' && <span className="navwsconn" aria-hidden title="This Mac"><IconMachine s={13} /></span>}
        {connection === 'cloud' && <span className="navwsconn" aria-hidden title="neuramesh.app"><IconCloud s={13} /></span>}
        {connection === 'custom' && connectionHost && <span className="navwsconn" aria-hidden title={connectionHost}><IconServer s={13} /></span>}
        <span className={`navwscar${faceOpen ? ' open' : ''}`} aria-hidden><IconChevron s={12} /></span>
      </button>
      {/* no account avatar here. The bar IS the account trigger — clicking it opens the face,
          which carries the account block — so a second avatar beside the ring was a duplicate
          control for a door already open, sitting where the ring's reading should end. */}
      <CreditRing workspace={workspace} onUpgrade={onUpgrade} />
    </div>
  );
}

// summary of running background work (agent runs + open terminals) with a stop control on each
export function ProcPopover({ procs, onKill, onClose }: { procs: ProcList; onKill: (kind: 'agent' | 'terminal', id: string) => void; onClose: () => void }) {
  const empty = !procs.agents.length && !procs.terminals.length;
  return (
    <div className="procpop" onMouseLeave={onClose}>
      <div className="procpophd">Background processes</div>
      {empty && <div className="procempty">Nothing running right now.</div>}
      {procs.agents.length > 0 && <div className="procsect">Agent runs</div>}
      {procs.agents.map((a) => (
        <div key={a.taskId} className="procrow">
          <span className="procico"><IconActivity s={12} /></span>
          <span className="procname">{a.taskNumber ? `#${a.taskNumber}` : 'task'} · {a.agentName}</span>
          <button className="procstop" onClick={() => onKill('agent', a.taskId)}>Stop</button>
        </div>
      ))}
      {procs.terminals.length > 0 && <div className="procsect">Terminals</div>}
      {procs.terminals.map((tm) => (
        <div key={tm.subId} className="procrow">
          <span className="procico"><IconTerm s={12} /></span>
          <span className="procname">{tm.title}</span>
          <button className="procstop" onClick={() => onKill('terminal', tm.subId)}>Close</button>
        </div>
      ))}
    </div>
  );
}

// the ambient utility cluster: editor / browser / terminal openers + background-processes
// count + the sync/live status pill (founder call 2026-07-07: ambient status belongs on
// ambient chrome, not a view's topbar). Icon-only — tooltips carry the names.
//
// It lives on the FRAME TOP's right end, after the ⌘K search pill (the shell round, 2026-08-10:
// these show on almost every page, so they ride the one chrome row that does — and the old
// dock's ⌘ tile folds into the search pill, so `onCmdK` renders only where no pill exists).
// The top-dock mode keeps its bottom DockBar: that mode hides the frame top entirely.
export function UtilCluster({ activeKind, onKind, dockOpen, onDock, procCount, procOpen, onProc, procs, onKill, status, onCmdK, overflow }: {
  activeKind: WTabKind | null; onKind: (kind: 'terminal' | 'browser') => void;
  /** the SIDE DOCK is showing at the frame's right edge (rail-ink round 3, 2026-09-04) */
  dockOpen: boolean;
  /** …and this is its toggle — the seat the Workbench button held (which had taken the Editor's,
   *  2026-08-16). The Workbench moved inside the thread and is toggled from the thread's header;
   *  the frame-level panel is the tab dock now, so the frame-level switch is the dock's. */
  onDock: () => void;
  procCount: number; procOpen: boolean; onProc: () => void;
  procs: ProcList; onKill: (kind: 'agent' | 'terminal', id: string) => void; status?: React.ReactNode;
  onCmdK?: () => void;
  /** narrow-window fallback: the three openers fold into one ⋯ menu instead of wrapping */
  overflow?: boolean;
}) {
  const [more, setMore] = useState(false);
  const kinds: Array<['browser' | 'terminal', React.ComponentType<{ s?: number }>, string]> = [
    ['browser', IconGlobe, 'Browser'], ['terminal', IconTerm, 'Terminal'],
  ];
  // bare name, like Browser and Terminal beside it (George, 2026-08-16): a tooltip that explains
  // the panel is a tooltip that has to be READ, and this row's whole idiom is one-word labels.
  return (
    <>
      {onCmdK && <button className="dockbarbtn ico" onClick={onCmdK} data-tip="Quick actions · ⌘K" aria-label="Quick actions (⌘K)"><IconCmd s={15} /></button>}
      <button className={`dockbarbtn ico utilkind${dockOpen ? ' on' : ''}`} onClick={onDock} aria-pressed={dockOpen} data-tip="Side panel · ⌘J" aria-label="Side panel"><IconDockRight s={15} /></button>
      {kinds.map(([k, Icon, label]) => (
        <button key={k} className={`dockbarbtn ico utilkind${activeKind === k ? ' on' : ''}`} onClick={() => onKind(k)} data-tip={label} aria-label={label}><Icon s={15} /></button>
      ))}
      {overflow && (
        <span className="ftutilmorewrap">
          <button className="dockbarbtn ico ftutilmore" onClick={() => setMore((v) => !v)} aria-label="More tools" aria-expanded={more} data-tip="Side panel · Browser · Terminal">⋯</button>
          {more && (
            <>
              <div className="ftmenuveil" onClick={() => setMore(false)} />
              <div className="viewmenu ftutilmenu">
                <button onClick={() => { setMore(false); onDock(); }}><span className="ftmi"><IconDockRight s={14} /></span><span className="ftmlbl"><b>Side panel</b></span></button>
                {kinds.map(([k, Icon, label]) => (
                  <button key={k} onClick={() => { setMore(false); onKind(k); }}><span className="ftmi"><Icon s={14} /></span><span className="ftmlbl"><b>{label}</b></span></button>
                ))}
              </div>
            </>
          )}
        </span>
      )}
      <div className="dockbarproc">
        <button className={`dockbarbtn ico${procOpen ? ' on' : ''}`} onClick={onProc} data-tip="Background processes" aria-label="Background processes">
          <IconActivity s={15} />
          {procCount > 0 && <span className="dockbarbadge">{procCount}</span>}
        </button>
        {procOpen && <ProcPopover procs={procs} onKill={onKill} onClose={() => onProc()} />}
      </div>
      {status && <div className="dockbarstatus">{status}</div>}
    </>
  );
}

// the top-dock mode's bottom strip — that mode hides the frame top, so the cluster keeps its
// old berth there (with the ⌘K tile, which has no search pill to fold into). Side docks render
// UtilCluster on the frame top instead; this band no longer mounts for them.
export function DockBar(props: Parameters<typeof UtilCluster>[0]) {
  return (
    <div className="dockbar">
      <span className="dockbarsp" />
      <UtilCluster {...props} />
    </div>
  );
}
