// MARKETING OS — the marketing floor as a workspace destination (docs/design/marketing-os-2026-08
// round 2; the desk round, docs/design/marketing-os-desk-2026-09, 2026-09-17). ONE page in today's
// order: the desk, the playbooks, the threads underneath as you scroll, and ONE bar under the desk
// with the pills at the left and the two section words at the right. The words are subheadings: a
// click scrolls the page to the section, the bar sticks while the page scrolls, and the lit word
// follows the section under it (mkosdesk.ts holds the rules, MarketingBar.tsx the look). Pills and
// rows DRAFT A MESSAGE, never run a command — the New-chat stage opens on the room with the ask
// pre-written and rex triages it (the plan gate stays the one consent). State is derived, never
// stored: scores from report-shaped docs, armed cadences from schedule prompts, setup from the
// profile — the same joins list_playbooks hands rex, so the two surfaces cannot disagree. The
// project pill at the top scopes the whole screen; the threads never grow project sections.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  MARKETING_SETUP_FLOW, PLAYBOOKS, THREAD_STATUSES, THREAD_STATUS_LABEL, playbookAsk, playbookFromAsk, playbookOfReport, reportFrom, setupProgress,
  type Alert, type PlaybookGroup, type ThreadStatus,
} from '@neuramesh/shared';
import { nm as nmBridge } from '../bridge/nm';
import { ScopeBar } from '../ui/ScopeBar';
import { AlertsBar } from './AlertsBar';
import { ConnectionsList } from '../settings/ConnectionsList';
import { HistRow } from '../shell/HistRow';
import { LEDGER_CAP, ledgerOf } from '../shell/ledger';
import type { RowMarks } from '../shell/rowstatus';
import { MarketingBar, animateScroll } from './MarketingBar';
import { MarketingDesk, type DeskCard } from './MarketingDesk';
import { PLAYBOOK_GLYPH, RunForPop, stateMeta, useRoomConnectors, type RoomPlaybookState, type RunForRow } from './mkosbits';
import { PLAYBOOK_GROUPS, PLAYBOOK_GROUP_LABEL, groupCounts, newestState, scrollTargetFor, sectionAt, type DeskSection } from './mkosdesk';
import { historyRows, sessionGroups, type HistoryRow, type HistoryThread, type RoomMessage } from '../room-tabs';
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

/** the chips' entrance stagger (tokens.css .mkchips.enter reads --i) */
const chipStyle = (i: number) => ({ '--i': i } as CSSProperties);

export function MarketingOS({ projects, chans, scope, setScope, alerts, refreshAlerts, dismissAlert, onOpenCalendar, onOpenRoutines, threads, tasks, messages, marksOf, onOpenSession, onOpenTask, onAsk }: {
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
  /** the ONE status derivation the bell, the rail, ⌘Y and Home read (shell/rowstatus.ts) */
  marksOf: (r: HistoryRow<TaskAllRow>) => RowMarks;
  onOpenSession: (row: HistoryRow<TaskAllRow>) => void;
  onOpenTask: (taskId: string) => void;
  /** open the New-chat stage on this room with the ask pre-drafted — pills never run commands */
  onAsk: (channelId: string, text: string) => void;
}) {
  const { projectId, q } = scope;
  const mkRooms = useMemo(() => chans.filter((c) => c.kind === 'marketing'), [chans]);
  const states = useMarketingStates(mkRooms);
  // marketing lives in marketing rooms, one per project — the project pick IS the room pick
  const roomsInScope = mkRooms.filter((c) => !projectId || c.project_id === projectId);
  const scopedRoom = roomsInScope.length === 1 ? roomsInScope[0]! : null;
  const connsByRoom = useRoomConnectors(useMemo(() => mkRooms.map((r) => r.id), [mkRooms]));
  const [pickFor, setPickFor] = useState<string | null>(null);
  const cards = useMemo<DeskCard[]>(() => projects
    .filter((p) => p.status === 'active' && (!projectId || p.id === projectId))
    .flatMap((p) => { const room = mkRooms.find((c) => c.project_id === p.id); return room ? [{ p, room }] : []; })
    .map(({ p, room }) => ({ p, room, per: states.get(room.id), conns: connsByRoom.get(room.id) ?? [],
      setupTask: tasks.find((t) => (t as { kind?: string }).kind === 'setup' && t.channel_id === room.id && t.state !== 'closed') ?? null })),
  [projects, mkRooms, projectId, states, tasks, connsByRoom]);
  const projSlugOf = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, p.slug || p.name]));
    return (chId: string | null) => (chId && byId.get(chans.find((c) => c.id === chId)?.project_id ?? '')) || '';
  }, [projects, chans]);

  // THE THREADS: the same rows Home, the bell and ⌘Y read, pre-narrowed to the marketing rooms in
  // scope, NEEDS YOU pinned first (the ledger's rule), then the day groups, Show n more past the cap
  const mkIds = useMemo(() => new Set(roomsInScope.map((r) => r.id)), [roomsInScope]);
  const rows = useMemo(() => historyRows({ threads, tasks, channelId: null, channelSlug: '', query: q, messages })
    .filter((r) => r.channelId && mkIds.has(r.channelId)), [threads, tasks, messages, q, mkIds]);
  const [status, setStatus] = useState<ThreadStatus | null>(null);
  const [pages, setPages] = useState(1);
  useEffect(() => { setPages(1); }, [status, projectId]);
  const ledger = useMemo(() => ledgerOf({ rows, marksOf, status, projectId: null, projectOf: () => null, cap: LEDGER_CAP * pages }), [rows, marksOf, status, pages]);
  const marksByKey = useMemo(() => new Map([...ledger.needs, ...ledger.recent].map((m) => [m.r.key, m.marks])), [ledger]);
  const dayGroups = useMemo(() => sessionGroups(ledger.recent.map((m) => m.r), Date.now()), [ledger.recent]);
  const rowOf = (r: HistoryRow<TaskAllRow>) => (
    <HistRow key={r.key} r={r} marks={marksByKey.get(r.key)!} grouped={!scopedRoom} roomTag={`${projSlugOf(r.channelId)} · #${r.channelSlug}`} onOpen={onOpenSession} />
  );

  // THE BAR's word follows the section under it; a click scrolls there on the signature ease and
  // the spy stays quiet until it lands (mid-flight the geometry lies about where you are going)
  const scroller = useRef<HTMLDivElement>(null);
  const threadsEl = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<DeskSection>('playbooks');
  const flying = useRef(false);
  const geometry = useCallback(() => {
    const sc = scroller.current, th = threadsEl.current;
    if (!sc || !th) return null;
    const bar = sc.querySelector<HTMLElement>('.mkbar');
    return { scrollTop: sc.scrollTop, threadsTop: th.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop, barHeight: bar?.offsetHeight ?? 0, maxScroll: sc.scrollHeight - sc.clientHeight };
  }, []);
  const spy = useCallback(() => { if (flying.current) return; const g = geometry(); if (g) setSection(sectionAt(g)); }, [geometry]);
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return undefined;
    let raf = 0;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; spy(); }); };
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => { sc.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [spy]);
  useEffect(() => { spy(); }, [spy, scopedRoom, rows.length]);
  const goSection = (s: DeskSection) => {
    const g = geometry(), sc = scroller.current;
    if (!g || !sc) return;
    setSection(s);
    flying.current = true;
    animateScroll(sc, scrollTargetFor(s, g), () => { flying.current = false; spy(); });
  };

  // THE PILLS are filters inside their section: the playbook groups on one, the thread statuses on the other
  const gc = groupCounts();
  const [group, setGroup] = useState<PlaybookGroup | null>(null);
  const chips = (s: DeskSection): ReactNode => s === 'playbooks' ? (
    <>
      <button type="button" className={group === null ? 'on' : ''} style={chipStyle(0)} aria-pressed={group === null} onClick={() => setGroup(null)}>All <b>{gc.all}</b></button>
      {PLAYBOOK_GROUPS.map((g, i) => (
        <button key={g} type="button" className={group === g ? 'on' : ''} style={chipStyle(i + 1)} aria-pressed={group === g} onClick={() => setGroup(g)}>{PLAYBOOK_GROUP_LABEL[g]} <b>{gc[g]}</b></button>
      ))}
    </>
  ) : (
    <>
      <button type="button" className={status === null ? 'on' : ''} style={chipStyle(0)} aria-pressed={status === null} onClick={() => setStatus(null)}>All <b>{ledger.counts.all}</b></button>
      {THREAD_STATUSES.map((st, i) => (
        <button key={st} type="button" className={status === st ? 'on' : ''} style={chipStyle(i + 1)} aria-pressed={status === st} onClick={() => setStatus(st)}>
          <span className={`fdot st-${st}`} aria-hidden /> {THREAD_STATUS_LABEL[st]} <b>{ledger.counts[st]}</b>
        </button>
      ))}
    </>
  );

  // a catalog row rests on a FACT (the scoped room's state, or the newest across the rooms in scope
  // with its project, because the scope does not say it) and shows the verb on hover or focus
  const runRows = (pbId: string): RunForRow[] => cards.map(({ p, room, setupTask, per }) => ({
    projectId: p.id, name: p.name || p.slug, logo: p.logo_url ?? null, roomId: room.id, setupTaskId: setupTask?.id ?? null, state: per?.get(pbId),
    ready: setupProgress(MARKETING_SETUP_FLOW, room.marketing ?? null).complete,
  }));
  const restOf = (pbId: string): ReactNode => {
    if (scopedRoom) return stateMeta(PLAYBOOKS.find((x) => x.id === pbId)!, states.get(scopedRoom.id)?.get(pbId));
    const best = newestState(roomsInScope.map((r) => ({ roomId: r.id, state: states.get(r.id)?.get(pbId) })));
    return best ? <>{stateMeta(PLAYBOOKS.find((x) => x.id === pbId)!, best.state)}<i className="pbproj">{projSlugOf(best.roomId)}</i></> : <span className="pbnever">never run</span>;
  };
  const empty = rows.length === 0 ? 'No marketing threads yet. Run a playbook or draft some posts.'
    : ledger.needs.length + ledger.recent.length === 0 ? 'No threads with this status.' : null;

  return (
    <div className="mkosview" ref={scroller}>
      <ScopeBar q={q} onQ={(v) => setScope({ q: v })} placeholder="Search marketing…" projects={projects} chans={mkRooms}
        projectId={projectId} onProject={(id) => setScope({ projectId: id, channelId: null })} />
      <AlertsBar alerts={alerts} refresh={refreshAlerts} dismiss={dismissAlert} onOpenCalendar={onOpenCalendar} onOpenRoutines={onOpenRoutines} />
      {cards.length > 0 && <MarketingDesk cards={cards} line={!!scopedRoom} onOpenTask={onOpenTask} onAsk={onAsk} onScope={(id) => setScope({ projectId: id, channelId: null })} />}
      {/* scoped: the room's REAL ConnectionsList — connect/reconnect where the growth work happens */}
      {scopedRoom && (
        <>
          <div className="pgk">Connections</div>
          <div className="conncard"><ConnectionsList channelId={scopedRoom.id} marketing={scopedRoom.marketing} /></div>
        </>
      )}
      <MarketingBar section={section} counts={{ playbooks: gc.all, threads: ledger.counts.all }} chips={chips} onSection={goSection} />
      <div className="pblist" id="mkplaybooks">
        {PLAYBOOK_GROUPS.filter((g) => group === null || g === group).map((g) => (
          <div key={g}>
            {group === null && <div className="pbgroup">{PLAYBOOK_GROUP_LABEL[g]}</div>}
            {PLAYBOOKS.filter((pb) => pb.group === g).map((pb) => {
              const ready = runRows(pb.id).filter((r) => r.ready);
              return (
                <button key={pb.id} type="button" className="pbrow"
                  onClick={() => {
                    if (scopedRoom) return onAsk(scopedRoom.id, playbookAsk(pb));
                    if (ready.length === 1) return onAsk(ready[0]!.roomId, playbookAsk(pb));
                    setPickFor((cur) => (cur === pb.id ? null : pb.id));
                  }}>
                  <span className="pbglyph" aria-hidden>{PLAYBOOK_GLYPH[pb.id]}</span>
                  <span className="pbtxt"><b>{pb.title}</b><span>{pb.tagline}</span></span>
                  <span className="pbmeta"><span className="pbfact">{restOf(pb.id)}</span><span className="pbrun">{scopedRoom ? 'Run ›' : 'Run for… ›'}</span></span>
                  {pickFor === pb.id && !scopedRoom && (
                    <RunForPop pb={pb} rows={runRows(pb.id)} onOpenTask={onOpenTask} onClose={() => setPickFor(null)} onPick={(roomId) => onAsk(roomId, playbookAsk(pb))} />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mkthreads" id="mkthreads" ref={threadsEl}>
        {ledger.needs.length > 0 && <div className="sgroup ny first">Needs you · {ledger.needs.length}</div>}
        {ledger.needs.map((m) => rowOf(m.r))}
        {dayGroups.map((g, gi) => (
          <Fragment key={g.label}>
            <div className={`sgroup${gi === 0 && !ledger.needs.length ? ' first' : ''}`}>{g.label}</div>
            {g.rows.map(rowOf)}
          </Fragment>
        ))}
        {empty && <div className="mkosempty">{empty}</div>}
        {ledger.recentTotal > ledger.recent.length && (
          <button type="button" className="sallrow ledgermore" onClick={() => setPages((n) => n + 1)}>Show {Math.min(LEDGER_CAP, ledger.recentTotal - ledger.recent.length)} more</button>
        )}
      </div>
    </div>
  );
}
