// The slot picker — a brand-styled date + time control, and the LOCAL day helper the whole
// scheduling surface agrees on. Split out of PostPreviewModal.tsx (2026-08-19), which the size
// ratchet stopped at 250 lines; the picker was always a self-contained control sharing a file
// with the card that happens to mount it.
import { useEffect, useMemo, useRef, useState } from 'react';

/** The slot's own day, in the viewer's zone. The picker's grid, the chip's label and `pickedIso`
 *  all speak LOCAL time; a UTC date mixed into that set is an off-by-one waiting for a timezone. */
export const localYmd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Brand-styled date + time picker (round 14): Chromium's native popups can't be themed,
// so the slot picker is ours — a month grid and a time list on the design tokens, Monday
// weeks like the content calendar. One open popover at a time; Escape/outside closes.
export function WhenPicker({ date, time, onDate, onTime }: { date: string; time: string; onDate: (d: string) => void; onTime: (t: string) => void }) {
  const [open, setOpen] = useState<'date' | 'time' | null>(null);
  const [viewYm, setViewYm] = useState(() => date.slice(0, 7));
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); } };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true); };
  }, [open]);
  const sel = new Date(`${date}T12:00:00`);
  const [vy, vm] = viewYm.split('-').map(Number) as [number, number];
  const first = new Date(vy, vm - 1, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-start
  const daysInMonth = new Date(vy, vm, 0).getDate();
  const cells: Array<Date | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(vy, vm - 1, i + 1)),
  ];
  const ymd = localYmd; // one definition — the grid and the slot must agree by construction
  const todayYmd = ymd(new Date());
  const shiftMonth = (delta: number) => {
    const d = new Date(vy, vm - 1 + delta, 1);
    setViewYm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const times = useMemo(() => Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`), []);
  const timeListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open !== 'time') return;
    const el = timeListRef.current?.querySelector('.on');
    (el as HTMLElement | undefined)?.scrollIntoView({ block: 'center' });
  }, [open]);
  return (
    <div className="nmwhen" ref={wrapRef}>
      <button type="button" className={`nmwhenbtn${open === 'date' ? ' on' : ''}`} onClick={() => { setViewYm(date.slice(0, 7)); setOpen(open === 'date' ? null : 'date'); }}>
        {sel.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
      </button>
      <span className="nmwhenat">at</span>
      <button type="button" className={`nmwhenbtn${open === 'time' ? ' on' : ''}`} onClick={() => setOpen(open === 'time' ? null : 'time')}>{time}</button>
      {open === 'date' && (
        <div className="nmdatepop" role="dialog" aria-label="Pick a date">
          <div className="nmdatehead">
            <b>{first.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b>
            <span className="nmdatenav">
              <button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)}>‹</button>
              <button type="button" aria-label="Next month" onClick={() => shiftMonth(1)}>›</button>
            </span>
          </div>
          <div className="nmdategrid">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => <span key={`${w}${i}`} className="wd">{w}</span>)}
            {cells.map((d, i) => d === null
              ? <span key={`e${i}`} />
              : (
                <button key={ymd(d)} type="button"
                  className={`nmday${ymd(d) === date ? ' sel' : ''}${ymd(d) === todayYmd ? ' today' : ''}`}
                  onClick={() => { onDate(ymd(d)); setOpen(null); }}>
                  {d.getDate()}
                </button>
              ))}
          </div>
        </div>
      )}
      {open === 'time' && (
        <div className="nmdatepop nmtimepop" role="dialog" aria-label="Pick a time" ref={timeListRef}>
          {times.map((t) => (
            <button key={t} type="button" className={`nmtime${t === time ? ' on' : ''}`} onClick={() => { onTime(t); setOpen(null); }}>{t}</button>
          ))}
        </div>
      )}
    </div>
  );
}
