// SCHEDULED's head (2026-09-20, George): one destination, two lenses. The name, and the room
// tab strip under it — Routines · Calendar, each tab carrying the count it names — in place of
// the nav fold this pair used to live in (docs/33 §8). `view` stays the switch, so every door
// that already sets `automations` or `calendar` lands on its tab. Drawn here rather than in
// App.tsx, which sits on its line ratchet; the counts are App's workspace-wide polls.
import type { MainView } from '../wtabs/guests';

export function ScheduledHead({ view, routines, calendar, setView }: {
  view: string;
  /** armed routines in scope (App polls it, RoutinesView reports it live) */
  routines: number;
  /** drafted + scheduled posts in scope (App polls it, WorkspaceCalendar reports it live) */
  calendar: number;
  setView: (v: MainView) => void;
}) {
  const tabs = [['automations', 'Routines', routines], ['calendar', 'Calendar', calendar]] as const;
  return (
    <>
      <div className="topbar">Scheduled</div>
      <div className="roomtabbar desttabs" role="tablist" aria-label="Scheduled surfaces">
        {tabs.map(([v, label, n]) => (
          <button key={v} role="tab" aria-selected={view === v} className={`roomtab${view === v ? ' on' : ''}`} aria-label={label} onClick={() => setView(v)}>
            {label}
            {n ? <span className="roomtabn">{n > 99 ? '99+' : n}</span> : null}
          </button>
        ))}
      </div>
    </>
  );
}
