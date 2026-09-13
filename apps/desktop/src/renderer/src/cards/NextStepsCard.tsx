// The next-steps card (docs/design/marketing-os-2026-08 §13) — a finished playbook run's
// report distilled to armable rows. Self-contained like SchedRecsCard: the block carries its
// channel + anchor, armed state resolves LIVE (tasks by open title, routines by schedule
// title, research by the answers map), and EVERY verb fires from the human's client:
//   task    → subtaskAdd under the anchoring task, or createTask anchored to the conversation
//             (round 4a, George: custody stays in the thread — never a floating board row)
//   routine → scheduleCreate, literally the nmsched + Arm contract
//   research→ posts the opener INTO this thread via onAsk (the nmplays Run › idiom)
import { useEffect, useState } from 'react';
import { Orb } from '../ui/Orb';
import { nm as nmBridge } from '../bridge/nm';
import { WD_SHORT } from './parse';
import { NEXT_STEPS_PAGE } from '@neuramesh/shared';
import type { NmNext, NextStepItem } from '@neuramesh/shared';

const nm = nmBridge;

type ArmState = 'idle' | 'arming' | 'armed' | 'failed';

export function NextStepsCard({ data, answers, onAsk, onOpenTask }: {
  data: NmNext;
  answers?: Map<string, string>;
  onAsk?: (text: string) => void;
  onOpenTask?: (id: string) => void;
}) {
  const [state, setState] = useState<Record<number, ArmState>>({});
  const [made, setMade] = useState<Record<number, { id: string; number: number }>>({});
  const [askedLocal, setAskedLocal] = useState<Record<number, boolean>>({});
  // ⏱ "not now" (plan §13 scene 02): how a task row was deferred — 'backlog', or the short
  // when-label of a once schedule ("Mon 09:00"); drives the receipt wording
  const [later, setLater] = useState<Record<number, string>>({});
  const [openLater, setOpenLater] = useState<number | null>(null);
  // tasks with a running run wear the ORB on their receipt, not static text (2026-08-22,
  // George) — the same runs rows the nav's orb reads
  const [liveTasks, setLiveTasks] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!nm?.watchRuns) return;
    return nm.watchRuns(data.channel, (runs) =>
      setLiveTasks(new Set(runs.filter((r) => r.state === 'running' && r.task_id).map((r) => r.task_id!))));
  }, [data.channel]);
  // live armed truth (the SchedRecsCard rule): reloads and other machines can't double-arm.
  // Tasks ride the synced watch; routines poll the schedules read, exactly as SchedRecsCard.
  useEffect(() => {
    // derive hits from the rows FIRST, keep every updater pure — a side effect inside a
    // setState updater runs (or not) at React's whim, so "collect inside, check after" drops data
    const un = nm?.watchTasksAll((rows) => {
      const hits = data.items.flatMap((it, i) => {
        if (it.kind !== 'task') return [];
        const hit = rows.find((t) => t.title === it.title && t.channel_id === data.channel && !['closed', 'accepted'].includes(t.state));
        return hit ? [{ i, hit }] : [];
      });
      if (!hits.length) return;
      setState((prev) => { const next = { ...prev }; for (const { i } of hits) if (next[i] !== 'arming') next[i] = 'armed'; return next; });
      setMade((m) => { const n = { ...m }; for (const { i, hit } of hits) n[i] ??= { id: hit.id, number: hit.number }; return n; });
      // a reload still reads "· backlog", never "running here"
      setLater((l) => { const n = { ...l }; for (const { i, hit } of hits) if (hit.state === 'backlog') n[i] ??= 'backlog'; return n; });
    });
    const load = () => void nm?.schedules(data.channel).then((r) => {
      const hits = data.items.flatMap((it, i) => (r.schedules.some((s) => s.title === it.title) ? [{ i, it }] : []));
      if (!hits.length) return;
      setState((prev) => { const next = { ...prev }; for (const { i } of hits) if (next[i] !== 'arming') next[i] = 'armed'; return next; });
      // a deferred creation, seen from any machine
      setLater((l) => { const n = { ...l }; for (const { i, it } of hits) if (it.kind === 'task') n[i] ??= 'scheduled'; return n; });
    }).catch(() => {});
    load();
    const iv = setInterval(load, 5000);
    return () => { un?.(); clearInterval(iv); };
  }, [data.channel, data.items]);

  const descOf = (it: NextStepItem) =>
    `${it.description ?? it.why ?? ''}${it.src ? `\n\nFrom ${data.report} · ${it.src}` : `\n\nFrom ${data.report}`}`.trim();
  const armTask = async (i: number, it: NextStepItem) => {
    if (!nm) return;
    setState((s) => ({ ...s, [i]: 'arming' }));
    try {
      const r = data.anchor.taskId
        ? await nm.subtaskAdd(data.anchor.taskId, it.title, descOf(it))
        : await nm.createTask(data.channel, it.title, { description: descOf(it), kind: it.taskKind ?? 'research', ...(data.anchor.threadId ? { originThread: data.anchor.threadId } : {}) });
      const t = (r as { task?: { id: string; number: number } })?.task;
      if (t) setMade((m) => ({ ...m, [i]: t }));
      setState((s) => ({ ...s, [i]: 'armed' }));
    } catch { setState((s) => ({ ...s, [i]: 'failed' })); }
  };
  // ⏱ park: the board's own parked-ideas shelf (docs/15) — a channel row, editable pre-work
  const parkBacklog = async (i: number, it: NextStepItem) => {
    if (!nm) return;
    setOpenLater(null);
    setState((s) => ({ ...s, [i]: 'arming' }));
    try {
      const r = await nm.createTask(data.channel, it.title, { backlog: true, description: descOf(it) });
      const t = (r as { task?: { id: string; number: number } })?.task;
      if (t) setMade((m) => ({ ...m, [i]: t }));
      setLater((l) => ({ ...l, [i]: 'backlog' }));
      setState((s) => ({ ...s, [i]: 'armed' }));
    } catch { setState((s) => ({ ...s, [i]: 'failed' })); }
  };
  // ⏱ defer: a `once` schedule (the remeasureArgs idiom) whose prompt asks for the creation
  const schedTask = async (i: number, it: NextStepItem, at: Date, label: string) => {
    if (!nm) return;
    setOpenLater(null);
    setState((s) => ({ ...s, [i]: 'arming' }));
    try {
      const res = await nm.scheduleCreate({
        channelId: data.channel, title: it.title, cadence: 'once', runAt: at.toISOString(),
        prompt: `Create and staff this deferred task: "${it.title}"\n\n${descOf(it)}\n\n(Deferred from the next-steps card.)`,
      });
      setLater((l) => ({ ...l, [i]: label }));
      setState((s) => ({ ...s, [i]: res?.ok ? 'armed' : 'failed' }));
    } catch { setState((s) => ({ ...s, [i]: 'failed' })); }
  };
  const nextMonday = () => { const d = new Date(); d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); d.setHours(9, 0, 0, 0); return d; };
  const inTwoWeeks = () => { const d = new Date(); d.setDate(d.getDate() + 14); d.setHours(9, 0, 0, 0); return d; };
  const shortDay = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const armRoutine = async (i: number, it: NextStepItem) => {
    if (!nm) return;
    setState((s) => ({ ...s, [i]: 'arming' }));
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const res = await nm.scheduleCreate({ channelId: data.channel, title: it.title, prompt: it.prompt ?? it.title, cadence: it.cadence ?? 'weekdays', atTime: it.atTime ?? '09:00', tz, weekday: it.weekday });
      setState((s) => ({ ...s, [i]: res?.ok ? 'armed' : 'failed' }));
    } catch { setState((s) => ({ ...s, [i]: 'failed' })); }
  };

  const when = (it: NextStepItem) => (it.cadence === 'weekly' ? `${WD_SHORT[it.weekday ?? 1]} ${it.atTime}` : `${it.cadence} ${it.atTime}`);
  const askKey = (it: NextStepItem) => it.opener ?? it.title;
  // pagination (2026-08-22, George: 40 recommendations, only 5 reachable) — a page of 5,
  // state maps stay keyed by the GLOBAL index so armed truth survives paging
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(data.items.length / NEXT_STEPS_PAGE));
  const pageItems = data.items.map((it, i) => ({ it, i })).slice(page * NEXT_STEPS_PAGE, (page + 1) * NEXT_STEPS_PAGE);
  // click a row → the full description slides open (the one-liner truncates)
  const [openRow, setOpenRow] = useState<number | null>(null);
  return (
    <div className="nextcard">
      <div className="nexthead">Next steps — arm what you like</div>
      <div className="nextsrc">from <code>{data.report}</code>{data.items.length > NEXT_STEPS_PAGE || data.total > data.picked ? ` · ${data.total > data.picked ? `${data.picked} of ${data.total}` : data.items.length} recommendations` : ''}</div>
      {pageItems.map(({ it, i }) => {
        const st = state[i] ?? 'idle';
        const asked = it.kind === 'research' && (askedLocal[i] || answers?.has(askKey(it)));
        const full = [it.description, it.why && it.why !== it.description ? it.why : null, it.kind === 'routine' ? it.prompt : null, it.kind === 'research' ? it.opener : null]
          .filter((s, idx, arr): s is string => !!s && arr.indexOf(s) === idx).join('\n\n');
        return (
          <div key={i} className="nrow">
            <span className={`nkind ${it.kind}`}>{it.kind}</span>
            <span className={`nmeta${full ? ' opens' : ''}${openRow === i ? ' open' : ''}`} role={full ? 'button' : undefined} tabIndex={full ? 0 : undefined}
              onClick={() => full && setOpenRow((v) => (v === i ? null : i))}
              onKeyDown={(e) => { if (full && e.key === 'Enter') setOpenRow((v) => (v === i ? null : i)); }}>
              <b>{it.title}</b>
              <span>{it.src ? <span className="nsrc">{it.src} · </span> : null}{it.kind === 'routine' ? `${when(it)} · ` : ''}{it.why ?? it.prompt ?? it.opener ?? ''}</span>
              {openRow === i && full && <span className="nfull">{full}{it.src ? <i className="nfullsrc">{data.report} · {it.src}</i> : null}</span>}
            </span>
            {it.kind === 'task' && (st === 'armed'
              ? made[i] && liveTasks.has(made[i]!.id)
              ? <span className="nok nlive"><Orb state="composing" label="working" /><button className="nlink" onClick={() => made[i] && onOpenTask?.(made[i]!.id)}>#{made[i]!.number}</button> · working</span>
              : <span className="nok">✓ {later[i] === 'backlog'
                  ? <>{made[i] ? <button className="nlink" onClick={() => made[i] && onOpenTask?.(made[i]!.id)}>#{made[i]!.number}</button> : 'parked'} · backlog</>
                  : later[i]
                    ? <>{later[i] === 'scheduled' ? 'scheduled' : `creates ${later[i]}`}</>
                    : <>{made[i] ? <button className="nlink" onClick={() => made[i] && onOpenTask?.(made[i]!.id)}>#{made[i]!.number}</button> : 'created'}{data.anchor.taskId ? ' · subtask' : ' · running here'}</>}</span>
              : <>
                  <span className="laterpop">
                    <button className="nbtn nlater" title="Not now — park in backlog or schedule the creation" aria-label="Not now" disabled={st === 'arming'}
                      onClick={() => setOpenLater((v) => (v === i ? null : i))}>⏱</button>
                    {openLater === i && (
                      <>
                        <button className="runforveil" aria-label="Close" onClick={() => setOpenLater(null)} />
                        <div className="laterpanel">
                          <div className="lh">Not now</div>
                          <button onClick={() => void parkBacklog(i, it)}>Park in backlog</button>
                          <button onClick={() => { const d = nextMonday(); void schedTask(i, it, d, 'Mon 09:00'); }}>Create Monday 09:00</button>
                          <button onClick={() => { const d = inTwoWeeks(); void schedTask(i, it, d, shortDay(d)); }}>Create in 2 weeks</button>
                        </div>
                      </>
                    )}
                  </span>
                  <button className="nbtn" disabled={st === 'arming'} onClick={() => void armTask(i, it)}>{st === 'arming' ? 'Creating…' : st === 'failed' ? 'Retry' : 'Create task ›'}</button>
                </>)}
            {it.kind === 'routine' && (st === 'armed'
              ? <span className="nok">✓ armed</span>
              : <button className="nbtn" disabled={st === 'arming'} onClick={() => void armRoutine(i, it)}>{st === 'arming' ? 'Arming…' : st === 'failed' ? 'Retry' : '+ Arm'}</button>)}
            {it.kind === 'research' && (asked
              ? <span className="nok">✓ asked</span>
              : <button className="nbtn" disabled={!onAsk} onClick={() => { setAskedLocal((a) => ({ ...a, [i]: true })); onAsk?.(askKey(it)); }}>Start ›</button>)}
          </div>
        );
      })}
      {pages > 1 && (
        <div className="npager">
          <button className="nbtn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</button>
          <span>{page * NEXT_STEPS_PAGE + 1}–{Math.min((page + 1) * NEXT_STEPS_PAGE, data.items.length)} of {data.items.length}</span>
          <button className="nbtn" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>›</button>
        </div>
      )}
    </div>
  );
}
