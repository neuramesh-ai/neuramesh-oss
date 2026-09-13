// Schedules (docs/automations) — the recurrence form and the list of what fires next.
// Extracted from App.tsx (track A2).
import { IconClose } from '../ui/icons';
import { Modal } from '../ui/Modal';
import { anchorPoint } from '../ui/anchor';
import { cleanErr } from '../lib/text';
import { nm as nmBridge } from '../bridge/nm';
import { type ScheduleRow } from '../bridge/rows-content';
import { useCallback, useEffect, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// The room's armed cadences + the arm affordance (plan §4.6): a slim strip above the
// composer in a set-up marketing room. "+ Schedule" opens the when-picker; Arm posts
// schedule.create — on Free the server's 402 routes to the upgrade flow automatically
// (api() emits nm:plan-limit), which IS the deep-funnel paywall moment.
export const CADENCES: Array<[string, string]> = [['once', 'Once'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly']];

// moved to @neuramesh/shared (the mobile-cloud round, S4) — the phone's routine card says the same words
import { nextRunLabel, SCHED_WEEKDAYS } from '@neuramesh/shared';
export { nextRunLabel, SCHED_WEEKDAYS };

// The room's armed schedules as rows (round 19): the row body opens the editor (round 20);
// pause/resume + two-step remove stay inline. limit renders the top slice; the full list
// lives in the Upcoming overlay.
export function UpcomingList({ channelId, limit }: { channelId: string; limit?: number }) {
  const [scheds, setScheds] = useState<ScheduleRow[]>([]);
  const [killSched, setKillSched] = useState<string | null>(null);
  const [edit, setEdit] = useState<ScheduleRow | null>(null);
  const reload = useCallback(() => { void nm?.schedules(channelId).then((r) => setScheds(r.schedules.filter((s) => s.status === 'active' || s.status === 'paused'))).catch(() => {}); }, [channelId]);
  useEffect(() => {
    reload();
    const iv = setInterval(reload, 5000);
    return () => clearInterval(iv);
  }, [reload]);
  const shown = limit ? scheds.slice(0, limit) : scheds;
  if (!scheds.length) return <p className="mkrailhint">Nothing armed yet — + Schedule sets a drafting cadence.</p>;
  return (
    <>
      {shown.map((s) => (
        <div key={s.id} className="mkrailrow mkrailsched mkschedclick" title={`${s.title} — click to edit`} role="button" tabIndex={0}
          onClick={() => setEdit(s)} onKeyDown={(e) => { if (e.key === 'Enter') setEdit(s); }}>
          <span aria-hidden>⏱</span>
          <b>{s.title}</b>
          <span className="when">{s.status === 'paused' ? 'paused' : nextRunLabel(s.next_run_at)}</span>
          <span className="mkschedacts" onClick={(e) => e.stopPropagation()}>
            <button className="mkico" title={s.status === 'paused' ? 'Resume' : 'Pause'} aria-label={s.status === 'paused' ? 'Resume schedule' : 'Pause schedule'}
              onClick={() => { void nm?.scheduleStatus(s.id, s.status === 'paused' ? 'active' : 'paused').then(reload); }}>{s.status === 'paused' ? '▶' : '⏸'}</button>
            {killSched === s.id
              ? <button className="mkico mkicodanger" title="Click again to remove" onClick={() => { void nm?.scheduleDelete(s.id).then(reload); setKillSched(null); }}>sure?</button>
              : <button className="mkico" title="Remove schedule" aria-label="Remove schedule" onClick={() => { setKillSched(s.id); setTimeout(() => setKillSched((k) => (k === s.id ? null : k)), 2600); }}><IconClose s={11} /></button>}
          </span>
        </div>
      ))}
      {!limit && <p className="mkrailhint">Drafts arrive ~30 min before each slot — you approve, it publishes at the slot.</p>}
      {edit && <ScheduleFormModal channelId={channelId} sched={edit} onClose={() => setEdit(null)} onChanged={reload} />}
    </>
  );
}


export function ScheduleFormModal({ channelId, sched, onClose, onChanged }: { channelId: string; sched: ScheduleRow | null; onClose: () => void; onChanged: () => void }) {
  const editing = !!sched;
  const [title, setTitle] = useState(sched?.title ?? '');
  const [prompt, setPrompt] = useState(sched?.prompt ?? '');
  const [cadence, setCadence] = useState(sched?.cadence ?? 'weekdays');
  const [atTime, setAtTime] = useState(sched?.at_time || '09:00');
  const [weekday, setWeekday] = useState<number>(sched?.weekday ?? 1);
  const [runDate, setRunDate] = useState(() => (sched?.next_run_at ? new Date(sched.next_run_at) : new Date(Date.now() + 3600e3)).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [killAsk, setKillAsk] = useState(false);
  const [err, setErr] = useState('');
  const dirty = !editing || title.trim() !== sched.title || prompt.trim() !== (sched.prompt ?? '') || cadence !== sched.cadence || atTime !== sched.at_time || (cadence === 'weekly' && weekday !== (sched.weekday ?? 1));
  const save = async () => {
    if (!title.trim() || !prompt.trim()) { setErr('give it a title and what to draft'); return; }
    setBusy(true); setErr('');
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const runAt = cadence === 'once' ? new Date(`${runDate}T${atTime}:00`).toISOString() : undefined;
      if (cadence === 'once' && new Date(runAt!).getTime() <= Date.now()) { setErr('pick a time in the future'); setBusy(false); return; }
      const args = { title: title.trim(), prompt: prompt.trim(), cadence, atTime, tz, weekday: cadence === 'weekly' ? weekday : undefined, runAt };
      if (editing) await nm?.scheduleUpdate({ scheduleId: sched.id, ...args });
      else await nm?.scheduleCreate({ channelId, ...args });
      onChanged(); onClose();
    } catch (e) {
      // a Free-plan 402 on arming already routed to the upgrade modal via nm:plan-limit
      if (!editing) { onClose(); return; }
      setBusy(false); setErr(cleanErr(e, 'that didn\'t stick — try again'));
    }
  };
  const toggle = async () => { if (!sched) return; setBusy(true); try { await nm?.scheduleStatus(sched.id, sched.status === 'paused' ? 'active' : 'paused'); onChanged(); onClose(); } catch { setBusy(false); } };
  const del = async () => { if (!sched) return; setBusy(true); try { await nm?.scheduleDelete(sched.id); onChanged(); onClose(); } catch { setBusy(false); } };
  const subtitle = editing
    ? `${sched.status === 'paused' ? 'Paused' : `Next ${nextRunLabel(sched.next_run_at)}`} · drafts arrive ~30 min before the slot`
    : 'Drafts only — the crew drafts on this cadence, you approve before anything posts.';
  return (
    // a FORM opened from a row, so it takes the popover treatment the round settled: no veil, and
    // it grows out of the row you clicked (2026-08-19; see ui/anchor.ts)
    <Modal anchored origin={anchorPoint()} title={editing ? 'Edit schedule' : 'Arm a drafting schedule'} subtitle={subtitle} onClose={onClose} footer={
      <>
        {editing && <button className="btn ghost sm" disabled={busy} onClick={() => void toggle()}>{sched.status === 'paused' ? 'Resume' : 'Pause'}</button>}
        {editing && (killAsk
          ? <button className="btn sm mkdanger" disabled={busy} onClick={() => void del()}>Remove — sure?</button>
          : <button className="btn ghost sm" onClick={() => { setKillAsk(true); setTimeout(() => setKillAsk(false), 2600); }}>Remove</button>)}
        <span style={{ flex: 1 }} />
        <button className="btn primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? (editing ? 'Saving…' : 'Arming…') : (editing ? 'Save changes' : 'Arm schedule')}</button>
      </>
    }>
      <div className="fld"><label>Title</label>
        <input autoFocus={!editing} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Daily post drafts" maxLength={200} /></div>
      <div className="fld"><label>What the crew drafts each run</label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} maxLength={4000} placeholder="Draft one X post from the brand voice and narrative pillars." /></div>
      <div className="fld"><label>Cadence</label>
        <div className="mkfocus">
          {CADENCES.map(([k, l]) => <button key={k} type="button" className={cadence === k ? 'on' : ''} onClick={() => setCadence(k)}>{l}</button>)}
        </div>
      </div>
      {cadence === 'weekly' && (
        <div className="fld"><label>Day</label>
          <div className="mkfocus">{SCHED_WEEKDAYS.map((d, i) => <button key={d} type="button" className={weekday === i ? 'on' : ''} onClick={() => setWeekday(i)}>{d}</button>)}</div>
        </div>
      )}
      <div className="fld"><label>{cadence === 'once' ? 'When' : 'Time of day'}</label>
        <div className="schededitwhen">
          {cadence === 'once' && <input type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} />}
          <input value={atTime} onChange={(e) => setAtTime(e.target.value)} placeholder="09:00" aria-label="Time of day" style={{ width: 90 }} />
          <span className="fldhint" style={{ margin: 0 }}>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
        </div>
      </div>
      {err && <div className="acterr" style={{ marginTop: 8 }}>{err}</div>}
    </Modal>
  );
}
