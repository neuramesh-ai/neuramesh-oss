// Routine recommendations (nmsched) rendered as pickable rows.
import { useEffect, useState } from 'react';
import { nm } from '../bridge/nm';
import { WD_SHORT, type NmSched, type NmSchedRec } from './parse';

export function SchedRecsCard({ sched }: { sched: NmSched }) {
  const [state, setState] = useState<Record<number, 'idle' | 'arming' | 'armed' | 'failed'>>({});
  // a rec already armed (this surface, the twin surface, or another machine) shows ✓ —
  // matched by title against the room's live schedules, so two mounts can't double-arm
  useEffect(() => {
    const load = () => void nm?.schedules(sched.channel).then((r) => {
      setState((prev) => {
        const next = { ...prev };
        sched.recs.forEach((rec, i) => {
          if (next[i] !== 'arming' && r.schedules.some((s) => s.title === rec.title)) next[i] = 'armed';
        });
        return next;
      });
    }).catch(() => {});
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [sched.channel]);
  const arm = async (i: number, r: NmSchedRec) => {
    setState((s) => ({ ...s, [i]: 'arming' }));
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const res = await nm?.scheduleCreate({ channelId: sched.channel, title: r.title, prompt: r.prompt, cadence: r.cadence, atTime: r.atTime, tz, weekday: r.weekday });
      setState((s) => ({ ...s, [i]: res?.ok ? 'armed' : 'failed' }));
    } catch { setState((s) => ({ ...s, [i]: 'failed' })); }
  };
  const when = (r: NmSchedRec) => (r.cadence === 'weekly' ? `${WD_SHORT[r.weekday ?? 1]} ${r.atTime}` : `${r.cadence} ${r.atTime}`);
  return (
    <div className="schedrecs">
      <div className="schedrecshead">Recommended cadence — arm what you like</div>
      {sched.recs.map((r, i) => (
        <div key={i} className="schedrecrow">
          <span className="schedrecmeta">
            <b>{r.title}</b>
            <span>{when(r)} · {r.prompt}</span>
          </span>
          {state[i] === 'armed'
            ? <span className="schedrecok">✓ armed</span>
            : <button className="btn sm" disabled={state[i] === 'arming'} onClick={() => void arm(i, r)}>{state[i] === 'arming' ? '…' : state[i] === 'failed' ? 'Retry' : '+ Arm'}</button>}
        </div>
      ))}
    </div>
  );
}
