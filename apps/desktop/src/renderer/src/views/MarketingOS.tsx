// MARKETING OS — the marketing floor as a workspace destination (docs/design/
// marketing-os-2026-08, round 2). Room home screens are hidden in this shell, so the growth
// desk lives HERE: unscoped it is every project's marketing at a glance (the AlertsBar, a
// project marketing card per project with three honest states, the playbook shelf, the
// marketing threads); scoped by the ScopeBar it is one project's desk and the catalog with
// that room's real state. Pills and rows DRAFT A MESSAGE, never run a command — the New-chat
// stage opens on the room with the ask pre-written and rex triages it (the plan gate stays
// the one consent). State is derived, never stored: scores from report-shaped docs, armed
// cadences from schedule prompts, setup from the profile — the same joins list_playbooks
// hands rex, so the two surfaces cannot disagree.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MARKETING_SETUP_FLOW,
  PLAYBOOKS,
  playbookAsk,
  playbookFromAsk,
  playbookOfReport,
  reportFrom,
  setupProgress,
  setupProgressLabel,
  type Alert,
} from '@neuramesh/shared';
import { nm as nmBridge } from '../bridge/nm';
import { ScopeBar } from '../ui/ScopeBar';
import { SessionList } from './SessionList';
import { AlertsBar } from './AlertsBar';
import { ProjLogo } from '../components/AgentAvatar';
import { ConnectionsList } from '../settings/ConnectionsList';
import { ConnStrip, Dial, RunForPop, stateMeta, useRoomConnectors, whenShort, type RoomPlaybookState, type RunForRow } from './mkosbits';
import { historyRows, type HistoryRow, type HistoryThread, type RoomMessage } from '../room-tabs';
import type { ScopeProps } from '../shell/useScopeMemory';
import type { ChannelRow } from '../bridge/rows-rooms';
import type { TaskAllRow, WorkspaceProjectRow } from '../bridge/rows-board';

const nm = nmBridge;

/** per-marketing-room derived state: latest report per playbook + armed cadences */
function useMarketingStates(rooms: ChannelRow[]): Map<string, Map<string, RoomPlaybookState>> {
  const [states, setStates] = useState<Map<string, Map<string, RoomPlaybookState>>>(new Map());
  const ids = rooms.map((r) => r.id).join(',');
  const reload = useCallback(() => {
    void (async () => {
      const next = new Map<string, Map<string, RoomPlaybookState>>();
      const scheds = await nm?.schedules(null).then((r) => r.schedules.filter((s) => s.status === 'active')).catch(() => []);
      for (const room of rooms) {
        const per = new Map<string, RoomPlaybookState>();
        const arts = await nm?.channelArtifacts(room.id).then((r) => r.artifacts).catch(() => []);
        for (const a of arts ?? []) {
          if (!a.inline_content) continue;
          const meta = reportFrom(a.name, a.inline_content);
          const pb = playbookOfReport(a.name, meta?.title ?? null);
          if (!pb || per.get(pb)?.lastAt) continue;
          per.set(pb, { lastAt: a.created_at, lastScore: meta?.score ?? null, armed: null });
        }
        for (const s of scheds ?? []) {
          if ((s as { channel_id?: string }).channel_id !== room.id) continue;
          const pb = playbookFromAsk((s as { prompt?: string }).prompt ?? null) ?? playbookFromAsk(s.title);
          if (!pb) continue;
          const cur = per.get(pb) ?? { lastAt: null, lastScore: null, armed: null };
          per.set(pb, { ...cur, armed: s.cadence });
        }
        next.set(room.id, per);
      }
      setStates(next);
    })();
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); const iv = setInterval(reload, 15_000); return () => clearInterval(iv); }, [reload]);
  return states;
}

export function MarketingOS({ projects, chans, scope, setScope, alerts, refreshAlerts, dismissAlert, onOpenCalendar, onOpenRoutines, threads, tasks, messages, liveIds, onOpenSession, onOpenTask, onAsk }: {
  projects: WorkspaceProjectRow[];
  chans: ChannelRow[];
  scope: ScopeProps['scope'];
  setScope: ScopeProps['setScope'];
  alerts: Alert[];
  refreshAlerts: () => void;
  dismissAlert: (key: string) => void;
  onOpenCalendar: () => void;
  onOpenRoutines: () => void;
  threads: HistoryThread[];
  tasks: TaskAllRow[];
  messages: RoomMessage[];
  liveIds: Set<string>;
  onOpenSession: (row: HistoryRow<TaskAllRow>) => void;
  onOpenTask: (taskId: string) => void;
  /** open the New-chat stage on this room with the ask pre-drafted — pills never run commands */
  onAsk: (channelId: string, text: string) => void;
}) {
  const { projectId, q } = scope;
  const mkRooms = useMemo(() => chans.filter((c) => c.kind === 'marketing'), [chans]);
  const states = useMarketingStates(mkRooms);

  // marketing lives in marketing rooms, one per project — the project pick IS the room pick
  // (no room pill here, and a stale scope.channelId must never invisibly narrow the desk)
  const roomsInScope = mkRooms.filter((c) => !projectId || c.project_id === projectId);
  const scopedRoom = roomsInScope.length === 1 ? roomsInScope[0]! : null;

  const connsByRoom = useRoomConnectors(useMemo(() => mkRooms.map((r) => r.id), [mkRooms]));
  const [pickFor, setPickFor] = useState<string | null>(null);
  const projCards = useMemo(() => projects
    .filter((p) => p.status === 'active' && (!projectId || p.id === projectId))
    .map((p) => ({ p, rooms: mkRooms.filter((c) => c.project_id === p.id) }))
    .filter((x) => x.rooms.length > 0), [projects, mkRooms, projectId]);

  const mkIds = useMemo(() => new Set(roomsInScope.map((r) => r.id)), [roomsInScope]);
  const rows = useMemo(() => historyRows({ threads, tasks, channelId: null, channelSlug: '', query: q, messages })
    .filter((r) => r.channelId && mkIds.has(r.channelId))
    .slice(0, 30), [threads, tasks, messages, q, mkIds]);
  const projSlugOf = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, p.slug || p.name]));
    return (chId: string | null) => (chId && byId.get(chans.find((c) => c.id === chId)?.project_id ?? '')) || '';
  }, [projects, chans]);

  return (
    <div className="mkosview">
      <ScopeBar q={q} onQ={(v) => setScope({ q: v })} placeholder="Search marketing…" projects={projects} chans={mkRooms}
        projectId={projectId} onProject={(id) => setScope({ projectId: id, channelId: null })} />
      <AlertsBar alerts={alerts} refresh={refreshAlerts} dismiss={dismissAlert} onOpenCalendar={onOpenCalendar} onOpenRoutines={onOpenRoutines} />

      {/* the desk — one card per project, three honest states (scene 01) */}
      {projCards.length > 0 && (
        <>
          <div className="pgk">Projects</div>
          <div className="mkcards">
            {projCards.map(({ p, rooms }) => {
              const room = rooms[0]!;
              const per = states.get(room.id);
              const ready = setupProgress(MARKETING_SETUP_FLOW, room.marketing ?? null).complete;
              const audit = per?.get('audit');
              const armed = per ? [...per.values()].filter((s) => s.armed).length : 0;
              const setupTask = !ready ? tasks.find((t) => (t as { kind?: string }).kind === 'setup' && t.channel_id === room.id && t.state !== 'closed') : null;
              return (
                <button key={p.id} className={`mkcard${ready && audit?.lastScore != null ? '' : ' quiet'}`}
                  onClick={() => {
                    if (!ready && setupTask) return onOpenTask(setupTask.id);
                    if (ready && audit?.lastScore == null) return onAsk(room.id, playbookAsk(PLAYBOOKS.find((x) => x.id === 'audit')!));
                    setScope({ projectId: p.id, channelId: null });
                  }}>
                  <span className="mkchd2"><ProjLogo logo={p.logo_url} name={p.name || p.slug} size={22} /><b>{p.name || p.slug}</b></span>
                  {!ready ? (
                    <>
                      <span className="mkscore quiet"><b>marketing not set up</b></span>
                      <span className="mkfacts">setup · {setupProgressLabel(MARKETING_SETUP_FLOW, setupProgress(MARKETING_SETUP_FLOW, room.marketing ?? null))}</span>
                      <span className="mkcta">Finish setup ›</span>
                    </>
                  ) : audit?.lastScore != null ? (
                    <>
                      <span className="mkscore"><Dial score={audit.lastScore} /><b>{audit.lastScore}</b></span>
                      <span className="mkfacts">{armed} cadence{armed === 1 ? '' : 's'} armed{audit.lastAt ? ` · audited ${whenShort(audit.lastAt)}` : ''}</span>
                    </>
                  ) : (
                    <>
                      <span className="mkscore quiet"><b>no baseline yet</b></span>
                      <span className="mkfacts">docs ✓ · {armed} cadence{armed === 1 ? '' : 's'} armed</span>
                      <span className="mkcta">Run the baseline audit ›</span>
                    </>
                  )}
                  <ConnStrip conns={connsByRoom.get(room.id) ?? []} marketing={room.marketing} />
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* scoped: the room's REAL ConnectionsList — connect/reconnect where the growth work
          happens (founder: connectors were invisible on the home) */}
      {scopedRoom && (
        <>
          <div className="pgk">Connections</div>
          <div className="conncard"><ConnectionsList channelId={scopedRoom.id} marketing={scopedRoom.marketing} /></div>
        </>
      )}

      {/* the catalog — rows carry the scoped room's real state; a row drafts the ask (scene 02) */}
      <div className="pgk">Playbooks</div>
      <div className="pblist">
        {(['foundations', 'content', 'campaigns'] as const).map((g) => (
          <div key={g}>
            <div className="pbgroup">{g}</div>
            {PLAYBOOKS.filter((p) => p.group === g).map((pb) => {
              // the row asks for its missing argument (founder: "pick a project" was
              // direction, not usability) — one ready room runs straight, several open
              // the picker, a not-set-up room clicks through to its setup task
              const runRows: RunForRow[] = projCards.map(({ p, rooms }) => {
                const room = rooms[0]!;
                const ready = setupProgress(MARKETING_SETUP_FLOW, room.marketing ?? null).complete;
                const st = tasks.find((t) => (t as { kind?: string }).kind === 'setup' && t.channel_id === room.id && t.state !== 'closed');
                return { projectId: p.id, name: p.name || p.slug, logo: p.logo_url ?? null, roomId: room.id, ready, setupTaskId: st?.id ?? null, state: states.get(room.id)?.get(pb.id) };
              });
              const readyRows = runRows.filter((r) => r.ready);
              return (
                <button key={pb.id} className="pbrow"
                  onClick={() => {
                    if (scopedRoom) return onAsk(scopedRoom.id, playbookAsk(pb));
                    if (readyRows.length === 1) return onAsk(readyRows[0]!.roomId, playbookAsk(pb));
                    setPickFor((cur) => (cur === pb.id ? null : pb.id));
                  }}>
                  <span className="pbtxt"><b>{pb.title}</b><span>{pb.tagline}</span></span>
                  <span className="pbmeta">{scopedRoom
                    ? stateMeta(pb, states.get(scopedRoom.id)?.get(pb.id))
                    : <span className="pbrun">Run for… ›</span>}</span>
                  {pickFor === pb.id && !scopedRoom && (
                    <RunForPop pb={pb} rows={runRows} onOpenTask={onOpenTask} onClose={() => setPickFor(null)}
                      onPick={(roomId) => onAsk(roomId, playbookAsk(pb))} />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* the threads — the one flat list, pre-narrowed to marketing rooms */}
      <div className="pgk">Marketing threads</div>
      <SessionList rows={rows} liveIds={liveIds} showRoom={!scopedRoom} selectedKey={null}
        roomTag={(r) => (scopedRoom ? `#${r.channelSlug}` : `${projSlugOf(r.channelId)} · #${r.channelSlug}`)}
        onOpen={onOpenSession} onSeeAll={() => { /* the rail + ⌘Y are the everything lenses */ }}
        empty={<div className="mkosempty">No marketing threads yet — run a playbook or draft some posts.</div>} />
    </div>
  );
}
