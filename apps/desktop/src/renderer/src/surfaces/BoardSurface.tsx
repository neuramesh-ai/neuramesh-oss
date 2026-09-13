// THE BOARD — the Tasks destination: its scope bar, its columns, and the backlog idea box.
//
// Split out of App(). The label reads Tasks and the ids read board (renamed 2026-08-05, label
// only), which is why boardStateList and boardLabelOf still carry the old name.
//
// It OWNS the backlog idea box and the journey watch (state-ownership round, 2026-08-16). The
// watch attaches when the board opens and detaches when it closes — journey evidence feeds the
// phase spectrum and nothing else, so nobody outside this surface was reading it.

import { AgentAvatar } from '../components/AgentAvatar';
import { Spectrum } from '../shell/boot';
import { SubStrip } from '../shell/chrome';
import { KindChip } from '../thread/parts';
import { ScopeBar } from '../ui/ScopeBar';
import { journeyFor, parseWorkPlanLegs } from '@neuramesh/shared';
import { useEffect, useState } from 'react';
import { nm } from '../bridge/nm';
import type { Dispatch, SetStateAction } from 'react';
import type { ScopeProps } from '../shell/useScopeMemory';
import type { TaskAllRow, WorkspaceProjectRow } from '../bridge/rows-board';
import type { JourneyRoster } from '@neuramesh/shared';
import type { AgentRow, MachineRow } from '../bridge/rows-crew';
import type { ChannelRow } from '../bridge/rows-rooms';

export function BoardSurface({ current, boardLabelOf, boardStateList, boardTasks, channelRosterFor, chans, openTaskId, projShipGate, roster, scopeChan, scope, setScope, setOpenTaskId, threadUnread, wsProjects }: {
  chans: ChannelRow[];
  /** the room the shell is standing in — a parked idea files against it */
  current: ChannelRow | null;
  wsProjects: WorkspaceProjectRow[];
  boardTasks: TaskAllRow[];
  boardStateList: readonly string[];
  boardLabelOf: (st: string) => string | undefined;
  scopeChan: ChannelRow | null;
  /** this destination's remembered narrowing (shell/useScopeMemory.ts) */
  scope: ScopeProps['scope'];
  setScope: ScopeProps['setScope'];
  roster: { machines: MachineRow[]; agents: AgentRow[] };
  channelRosterFor: (channelId: string) => JourneyRoster;
  projShipGate: (projectId: string | null) => boolean;
  threadUnread: (taskId: string) => boolean;
  openTaskId: string | null;
  setOpenTaskId: Dispatch<SetStateAction<string | null>>;
}) {
  const [ideaDraft, setIdeaDraft] = useState('');

  // journey evidence (docs/24): which tasks carry a design round / a plan doc —
  // the phase spectrum derives its legs from routing HISTORY, never guesses
  // `authed` is gone with the move: this surface only renders inside a signed-in shell
  const [journeyEv, setJourneyEv] = useState<Map<string, { design: boolean; plan: boolean }>>(new Map());
  useEffect(() => {
    if (!nm) return;
    return nm.watchJourney((rows) => setJourneyEv(new Map(rows.map((r) => [r.task_id, { design: !!r.has_design, plan: !!r.has_plan }]))));
  }, []);
  // the spectrum's staffing inputs: the project's release gate (null-safe ON) and

  const addBacklogIdea = async () => {
    const title = ideaDraft.trim();
    const chanId = current?.id;
    if (!title || !nm || !chanId) return;
    setIdeaDraft('');
    await nm.createTask(chanId, title, { backlog: true }); // appears via task sync
  };

  return (
      <>
        <div className="topbar">Tasks<span className="desc">every task in the workspace — filter by project or room</span></div>
        <ScopeBar q={scope.q} onQ={(q) => setScope({ q })} placeholder="Search tasks by title or #number"
          projects={wsProjects} chans={chans} projectId={scope.projectId} channelId={scope.channelId}
          onProject={(projectId) => setScope({ projectId })} onChannel={(channelId) => setScope({ channelId })} />
      <div className="boardrow">
        <div className="boardwrap">
          <div className="cols">
            {boardStateList.map((st) => {
              const col = boardTasks.filter((t) => t.state === st && !t.parent_task_id); // subtasks fold under their parent, never their own card (docs/24)
              return (
                <div key={st} className="col">
                  <div className="colhead">
                    <span className={`chip c-${st}`}>{boardLabelOf(st)}</span>
                    <span className="count">{col.length}</span>
                  </div>
                  {/* the quick-add parks an idea in ONE room — it needs a scope to file into,
                      so it appears only when the head names one (it filed into whichever room
                      you last visited otherwise, which is a guess wearing a text input) */}
                  {st === 'backlog' && scopeChan && (
                    <div className="ideaadd">
                      <input
                        value={ideaDraft}
                        onChange={(e) => setIdeaDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void addBacklogIdea()}
                        placeholder={`Park an idea in #${scopeChan.slug}, then ↵`}
                        title="a parked idea is editable and promotable — no agent works it until someone promotes it"
                      />
                      <div className="ideaaddrow">
                        <button className="btn" disabled={!ideaDraft.trim()} onClick={() => void addBacklogIdea()}>+ Add</button>
                      </div>
                    </div>
                  )}
                  {col.map((t) => (
                    <div key={t.id} className={`tcard${openTaskId === t.id ? ' open' : ''}${threadUnread(t.id) ? ' unreadcard' : ''}`} onClick={() => setOpenTaskId(t.id)}>
                      {/* the room chip rides ONLY at All scope — inside a room every card on
                          this board belongs to the room the head already names */}
                      <div className="tid">#{t.number}{threadUnread(t.id) && <span className="unread" title="new activity in this thread" style={{ marginLeft: 5 }}>●</span>}<KindChip kind={t.kind} />{!scopeChan && t.channel_slug && <span className="troom">#{t.channel_slug}</span>}</div>
                      <div className="tt">{t.title}</div>
                      {(() => {
                        const ag = t.assignee_id ? roster.agents.find((a) => a.id === t.assignee_id) : null;
                        if (!ag && !t.branch) return null;
                        return (
                          <div className="tfoot tfootrow">
                            {ag && <><AgentAvatar name={ag.name} size={15} radius={4} /><span className="tassignee">{ag.name}</span></>}
                            {t.branch && <span className="tbranch">{t.branch}</span>}
                          </div>
                        );
                      })()}
                      {(() => {
                        // the journey as a 4px whisper (docs/24) — legs from routing evidence.
                        // A parked idea has no journey yet; terminal cards need no road ahead.
                        if (t.state === 'backlog' || t.state === 'closed') return null;
                        const ev = journeyEv.get(t.id);
                        const wpl = parseWorkPlanLegs(t.work_plan);
                        const legs = journeyFor(
                          { state: t.state, kind: t.kind, blockedFrom: null, hasDesignRound: !!ev?.design, hasPlanDoc: !!ev?.plan, repoBacked: !!t.repo_id || !!t.pr_number, shipGate: projShipGate(t.project_id), assigneeName: roster.agents.find((a) => a.id === t.assignee_id)?.name ?? null, workPlanLegs: wpl },
                          channelRosterFor(t.channel_id),
                        );
                        return <Spectrum legs={legs} />;
                      })()}
                      <SubStrip subs={boardTasks.filter((x) => x.parent_task_id === t.id)} agents={roster.agents} onOpen={setOpenTaskId} />
                    </div>
                  ))}
                  {!col.length && <div className="colempty">—</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      </>
  );
}
