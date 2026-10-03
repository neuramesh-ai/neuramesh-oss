// ONE SESSION PER ROUTINE, IN THE SESSION (docs/design/routine-sessions-2026-09/plan.md). A schedule's
// session holds every run. This view splits the stream at each run's opener (shared session-runs.ts)
// and gives each run a date divider and a strip: its status, the time it took, what it made, and one
// line. Older runs fold to their strip. The newest run is open, and so is a run that needs you. The
// routine card at the top holds the prompt once, with Run now and Edit, so a routine's own opener
// message does not repeat in every run. A draft run opens with the agent's draft, which stays.
//
// A thread that is no schedule's renders exactly as it did. Split out of ConvoThread.tsx, which
// stands at its size cap. The desktop's copy of hq's view (routine sessions PR 3): the run link lives in
// memory only, and a refused Run now says the server's own words.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  cadenceLine, isPostsFile, isRoutineSchedule, schedulePayload, sessionRunFacts, sessionRunLabel, sessionRunOpen, sessionRunStrip, splitSessionRuns,
  type SessionRun, type SessionRunSources, type SessionRunState, type SessionRunStrip,
} from '@neuramesh/shared';
import { nm as nmBridge } from '../bridge/nm';
import type { MessageRow, ThreadRow } from '../bridge/rows-rooms';
import type { ScheduleRow } from '../bridge/rows-content';
import { ScheduleFormModal } from '../schedule/schedule';
import { flashToast } from '../lib/toast';
import { IconAlert, IconCheck, IconChevron, IconPlay, IconRoutineClock } from '../ui/icons';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// THE RUN LINK. The Automations panel opens a session at one of its runs: it hands the opener's id over in
// memory (`pending`), because the session it opens can mount a beat later, and names it on an `nm:run`
// event for a session that is open already. hq also writes `?run=` to the address. The desktop has no
// address to share, and it loads over file://, where history.replaceState throws, so this copy keeps none.
let pending: string | null = null;
/** open a run where its session shows it: call it, then open the session */
export function openRunLink(runId: string): void {
  pending = runId;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nm:run', { detail: runId }));
}

/** the server's own words from a refused command: Electron's IPC prefix and the api()'s path and status go */
const refusal = (e: unknown): string =>
  (e instanceof Error ? e.message : '').replace(/^Error invoking remote method '[^']*': \w*Error: /, '').replace(/^\/v1\/commands failed \d+: /, '') || 'The run did not start.';

/** a clock that ticks while a view shows "so far" and "Today" */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!everyMs) return undefined;
    const iv = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(iv);
  }, [everyMs]);
  return now;
}

/** a routine's schedule row, from the replica, read again while the session is open */
export function useSchedule(scheduleId: string | null | undefined, tick = 0): ScheduleRow | null {
  const [row, setRow] = useState<ScheduleRow | null>(null);
  useEffect(() => {
    if (!scheduleId || !nm) { setRow(null); return undefined; }
    let dead = false;
    const load = () => { void nm?.schedules(null).then((r) => { if (!dead) setRow(r.schedules.find((x) => x.id === scheduleId) ?? null); }, () => {}); };
    load();
    const iv = setInterval(load, 15_000);
    return () => { dead = true; clearInterval(iv); };
  }, [scheduleId, tick]);
  return row;
}

/** the head's routine chip: the cadence, so when this session runs again is one glance */
export function RoutineChip({ scheduleId }: { scheduleId: string | null | undefined }) {
  const s = useSchedule(scheduleId);
  if (!scheduleId) return null;
  return <span className="routinechip" title="A routine opens each run of this session on its schedule"><IconRoutineClock s={10} /> {s ? cadenceLine(s) : 'Routine'}</span>;
}

/** the in-progress glyph: a dotted ring round a dot, in the rail's in-progress color */
const ProgressGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2" strokeDasharray="1.5 3.2" strokeLinecap="round" />
    <circle cx="12" cy="12" r="3.2" fill="currentColor" />
  </svg>
);

/** a run's state as a word with its glyph. The strip and the Automations panel both wear it */
export function RunWord({ state, word }: { state: SessionRunState; word: string }) {
  const glyph = state === 'failed' ? <IconAlert s={13} /> : state === 'progress' ? <ProgressGlyph /> : state === 'needs' ? <i className="srundot" /> : <IconCheck s={13} />;
  return <span className={`srunword s-${state}`}>{glyph}{word}</span>;
}

/** the facts line after the word: 8 min · 2 units · 1 draft */
export function RunFacts({ strip }: { strip: SessionRunStrip }) {
  const bits = [strip.took, ...strip.made].filter(Boolean);
  return <>{bits.map((b) => <Fragment key={b}><span className="srunsep" aria-hidden>·</span><span>{b}</span></Fragment>)}</>;
}

/** the original drafts as strips: one for a thread, one per run in a schedule's session */
export function draftStrips<C extends { anchor: number }>(cards: C[], runStarts: readonly string[]): Array<{ at: string; strip: C[]; key: string }> {
  const starts = runStarts.map((s) => Date.parse(s));
  const groups = new Map<number, C[]>();
  for (const c of cards) {
    const i = starts.filter((s) => s <= c.anchor).length;
    groups.set(i, [...(groups.get(i) ?? []), c]);
  }
  return [...groups].map(([i, strip]) => ({ at: new Date(Math.min(...strip.map((c) => c.anchor))).toISOString(), strip, key: i ? `drafts-${i}` : 'drafts' }));
}

/** the rows a session hands over, before the view narrows them to what a strip counts */
export interface SessionRunRows {
  units?: SessionRunSources['units'];
  cards?: SessionRunSources['cards'];
  drafts?: SessionRunSources['drafts'];
  files?: ReadonlyArray<{ created_at: string; name: string }>;
  openRuns?: ReadonlyArray<{ started_at: string; thread_id: string | null; state: string }>;
}

const dayOf = (label: string): string => label.replace(/, \d\d:\d\d$/, '');
const lower = (label: string): string => label.replace(/^(Today|Yesterday|Tomorrow)\b/, (w) => w.toLowerCase());

function RoutineCard({ sched, runs, now, roomKind, onRunNow, onEdit }: { sched: ScheduleRow | null; runs: SessionRun<MessageRow>[]; now: number; roomKind?: string | null; onRunNow?: () => void; onEdit?: () => void }) {
  const routine = !sched || isRoutineSchedule(schedulePayload(sched.payload), roomKind);
  // the prompt, once: the schedule's own, else the opener's text under its title line
  const prompt = sched?.prompt || runs[0]!.opener.body.split(/\n\n/).slice(1).join('\n\n');
  const next = sched?.status === 'paused' ? 'paused' : sched?.next_run_at ? `next run ${lower(sessionRunLabel(sched.next_run_at, now))}` : '';
  const count = `${runs.length} run${runs.length === 1 ? '' : 's'} since ${lower(dayOf(sessionRunLabel(runs[0]!.at, now)))}`;
  return (
    <div className="sruncard">
      <span className="sruncardico"><IconRoutineClock s={16} /></span>
      <div className="sruncardtext">
        <span className="sruncardkick">{routine ? 'Routine' : 'Scheduled drafts'}{sched ? ` · ${cadenceLine(sched)}` : ''}</span>
        {prompt && <span className="sruncardprompt">{prompt}</span>}
        <span className="sruncardmeta">{[count, next].filter(Boolean).join(' · ')}</span>
      </div>
      {sched && (
        <div className="sruncardact">
          {sched.status === 'active' && onRunNow && <button className="btn sm" onClick={onRunNow}><IconPlay s={12} /> Run now</button>}
          {onEdit && <button className="btn sm ghost" onClick={onEdit}>Edit</button>}
        </div>
      )}
    </div>
  );
}

/** the run link, followed: the run a link names opens, and the transcript scrolls to its divider */
function useRunLink(threadId: string, runs: SessionRun[] | null, listRef: RefObject<HTMLDivElement | null>, open: (id: string) => void): void {
  const wanted = useRef<string | null>(null);
  const [asked, setAsked] = useState(0);
  const [jump, setJump] = useState<string | null>(null);
  useEffect(() => {
    wanted.current = pending;
    const onRun = (e: Event) => { wanted.current = (e as CustomEvent<string>).detail; setAsked((n) => n + 1); };
    window.addEventListener('nm:run', onRun);
    return () => window.removeEventListener('nm:run', onRun);
  }, [threadId]);
  useEffect(() => {
    const id = wanted.current;
    if (!id || !runs?.some((f) => f.opener.id === id)) return;
    wanted.current = null;
    if (pending === id) pending = null;
    open(id);
    setJump(id);
  }, [runs, asked, open]);
  useLayoutEffect(() => {
    const list = listRef.current;
    const el = jump ? list?.querySelector<HTMLElement>(`[data-run="${CSS.escape(jump)}"]`) : null;
    if (!list || !el) return;
    // the transcript keeps to its bottom until the reader leaves it: a jump leaves it (useStickToBottom)
    list.dispatchEvent(new Event('nm:unpin'));
    el.scrollIntoView({ block: 'start' });
    setJump(null);
  }, [jump, listRef]);
}

/** each item in the run whose window holds it. A routine's own opener stays out: the card holds its prompt */
function itemsByRun<T extends { at: string; msg?: { id: string } }>(runs: SessionRun[], items: T[]): T[][] {
  const openers = new Set(runs.filter((f) => f.opener.author_kind !== 'agent').map((f) => f.opener.id));
  const starts = runs.map((f) => Date.parse(f.at));
  const byRun = runs.map((): T[] => []);
  for (const it of items) {
    if (it.msg && openers.has(it.msg.id)) continue;
    const t = Date.parse(it.at);
    byRun[Math.max(0, starts.filter((s) => s <= t).length - 1)]!.push(it);
  }
  return byRun;
}

/** a run's head: the date divider, then the strip. A run shows its one line while nothing below it says
 *  more: folded, or open with no row to show. Every run but the newest folds */
function RunHead({ id, label, strip, newest, open, bare, onToggle }: { id: string; label: string; strip: SessionRunStrip; newest: boolean; open: boolean; bare: boolean; onToggle: () => void }) {
  return (
    <>
      <div className={`srundiv${newest ? ' newest' : ''}`} data-run={id}><span>{label}</span></div>
      <div className={`srunstrip s-${strip.state}`}>
        <RunWord state={strip.state} word={strip.word} />
        <RunFacts strip={strip} />
        {(!open || bare) && strip.line && <span className="srunline">{strip.line}</span>}
        {!newest && (
          <button className={`sruntoggle${open ? ' open' : ''}`} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} the run of ${label}`} onClick={onToggle}>
            {open ? 'Hide' : 'Show'}<IconChevron s={12} />
          </button>
        )}
      </div>
    </>
  );
}

export function SessionRuns<T extends { at: string; msg?: { id: string } }>({ threadId, thread, channelId, rows, items, sources, roomKind, listRef, render }: {
  /** the open session. Its row can arrive a beat later, so the session's own state keys on this id */
  threadId: string;
  thread: ThreadRow | null;
  /** the session's room: the editor's fallback when the schedule row names none */
  channelId: string;
  rows: MessageRow[];
  /** the transcript's stream, in time order: messages, run cards, draft strips, files */
  items: T[];
  sources: SessionRunRows;
  roomKind?: string | null;
  /** the transcript's scroller: a run link scrolls it to the run */
  listRef: RefObject<HTMLDivElement | null>;
  render: (it: T) => ReactNode;
}) {
  const scheduleId = thread?.schedule_id ?? null;
  const runs = useMemo(() => splitSessionRuns(rows, scheduleId), [rows, scheduleId]);
  const now = useNow(runs ? 30_000 : 0);
  const [tick, setTick] = useState(0);
  const sched = useSchedule(scheduleId, tick);
  const [edit, setEdit] = useState(false);
  const src = useMemo((): SessionRunSources => ({
    units: sources.units, cards: sources.cards, drafts: sources.drafts,
    files: sources.files?.filter((a) => !isPostsFile(a.name)),
    openRuns: sources.openRuns?.filter((r) => r.thread_id === threadId && r.state === 'running'),
    settledAt: thread?.settled_at ?? null,
  }), [sources.units, sources.cards, sources.drafts, sources.files, sources.openRuns, threadId, thread?.settled_at]);
  const strips = useMemo(() => (runs ?? []).map((f) => sessionRunStrip(f, sessionRunFacts(f, src), now)), [runs, src, now]);
  // a fold the person chose, per run; everything else follows sessionRunOpen
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  useEffect(() => { setToggled({}); }, [threadId]);
  const openRun = useCallback((id: string) => setToggled((t) => ({ ...t, [id]: true })), []);
  useRunLink(threadId, runs, listRef, openRun);
  if (!runs?.length) return <>{items.map(render)}</>; // [] = a routine the web scheduled from its writer session, with no run yet
  const byRun = itemsByRun(runs, items);
  const runNow = async () => {
    if (!sched) return;
    try {
      await nm?.scheduleRunNow(sched.id);
      flashToast('The run starts within a minute.');
      setTick((n) => n + 1);
    } catch (e) { flashToast(refusal(e)); }
  };
  return (
    <>
      <RoutineCard sched={sched} runs={runs} now={now} roomKind={roomKind} onRunNow={() => void runNow()} onEdit={() => setEdit(true)} />
      {runs.map((f, i) => {
        const strip = strips[i]!;
        const newest = i === runs.length - 1;
        const open = newest || (toggled[f.opener.id] ?? sessionRunOpen(strip.state, false));
        return (
          <Fragment key={`run-${f.opener.id}`}>
            <RunHead id={f.opener.id} label={sessionRunLabel(f.at, now)} strip={strip} newest={newest} open={open} bare={!byRun[i]!.length} onToggle={() => setToggled((t) => ({ ...t, [f.opener.id]: !open }))} />
            {open && byRun[i]!.map(render)}
          </Fragment>
        );
      })}
      {edit && sched && <ScheduleFormModal channelId={sched.channel_id ?? channelId} sched={sched} onClose={() => setEdit(false)} onChanged={() => setTick((n) => n + 1)} />}
    </>
  );
}
