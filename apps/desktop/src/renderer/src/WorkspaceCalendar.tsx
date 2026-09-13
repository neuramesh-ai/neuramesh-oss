// The Calendar surface — the time view of everything scheduled: automation firings (projected
// through the shared nextScheduleRun, never re-derived) and drafted/scheduled posts, in two
// lanes. Split out of App.tsx unchanged; it takes props and closes over nothing there.
import { nm } from './bridge/nm';
import type { ScopeProps } from './shell/useScopeMemory';
import { useCalendarGrid, type CalRun } from './calendar/useCalendarGrid';
import { type WorkspaceProjectRow } from './bridge/rows-board';
import { type ContentItemWide, type ScheduleRow } from './bridge/rows-content';
import { type ChannelRow } from './bridge/rows-rooms';
import { PostPreviewModal } from './marketing/PostPreviewModal';
import { ScheduleFormModal } from './schedule/schedule';
import { MK_PLATFORMS, MK_PLATFORM_ICON } from './thread/DeliveryStrip';
import { ScopeBar } from './ui/ScopeBar';
import { IconRepeat } from './ui/icons';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';


export function WorkspaceCalendar({ projects, chans, onCount, scope, setScope }: {
  projects: WorkspaceProjectRow[];
  chans: ChannelRow[];
  onCount: (n: number) => void;
  /** this destination's remembered narrowing (shell/useScopeMemory.ts) — the shell owns the
   *  remembering so every destination answers the same way when you navigate away and back */
  scope: ScopeProps['scope'];
  setScope: ScopeProps['setScope'];
}) {
  const { projectId, channelId, q } = scope;
  const setProjectId = (v: string | null) => setScope({ projectId: v });
  const setChannelId = (v: string | null) => setScope({ channelId: v });
  const setQ = (v: string) => setScope({ q: v });
  const [items, setItems] = useState<ContentItemWide[]>([]);
  const [scheds, setScheds] = useState<ScheduleRow[]>([]);
  const [weekOff, setWeekOff] = useState(0);
  const [monthOff, setMonthOff] = useState(0);
  const [lens, setLens] = useState<'week' | 'month'>('week');
  const [open, setOpen] = useState<ContentItemWide | null>(null);
  const [editSched, setEditSched] = useState<ScheduleRow | null>(null);
  const reload = useCallback(() => {
    void nm?.contentAll().then((r) => setItems(r.items)).catch(() => {});
    // paused schedules are filtered out, not dimmed: this surface says what WILL happen, and a
    // paused routine will not. The Routines tab is where a paused one is still visible and resumable.
    void nm?.schedules(null).then((r) => setScheds(r.schedules.filter((x) => x.status === 'active'))).catch(() => {});
  }, []);
  // same 5s poll as every other content reader — the replica lags a mutation otherwise
  useEffect(() => { reload(); const iv = setInterval(reload, 5000); return () => clearInterval(iv); }, [reload]);

  const chanProject = useMemo(() => new Map(chans.map((c) => [c.id, c.project_id ?? null])), [chans]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items
      .filter((it) => !projectId || it.project_id === projectId)
      .filter((it) => !channelId || it.channel_id === channelId)
      .filter((it) => !needle || it.body.toLowerCase().includes(needle) || (it.channel_slug ?? '').toLowerCase().includes(needle));
  }, [items, projectId, channelId, q]);
  const shownScheds = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scheds
      .filter((x) => !projectId || chanProject.get(x.channel_id ?? '') === projectId)
      .filter((x) => !channelId || x.channel_id === channelId)
      .filter((x) => !needle || x.title.toLowerCase().includes(needle) || (x.prompt ?? '').toLowerCase().includes(needle) || (x.channel_slug ?? '').toLowerCase().includes(needle));
  }, [scheds, projectId, channelId, q, chanProject]);
  // the badge counts what is still coming, not what has already gone out
  const pending = useMemo(() => shown.filter((it) => it.status === 'draft' || it.status === 'scheduled'), [shown]);
  useEffect(() => { onCount(pending.length); }, [pending.length, onCount]);
  const narrowed = !!(projectId || channelId || q.trim());

  // the grid: which days are on screen and what lands on each (calendar/useCalendarGrid.ts)
  const { briefOnly, byDay, dayKey, days, localTz, monday, monthCells, monthStart, runsByDay, slotOf, tally, timeOf, todayKey, unslotted, weekRange } =
    useCalendarGrid({ shown, shownScheds, lens, weekOff, monthOff });
  // an automation's firing. Not clickable through to a post — there is no post yet; it opens the
  // routine's own editor, which is the thing you would actually want to change.
  const runChip = (r: CalRun) => (
    <button key={r.key} className="mkcalitem run" onClick={() => setEditSched(r.sched)}
      title={`${r.sched.title}\n${r.sched.prompt ?? ''}\n— fires ${r.at.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}${r.sched.tz && r.sched.tz !== localTz ? ` (${r.sched.tz})` : ''}${r.sched.channel_slug ? ` · #${r.sched.channel_slug}` : ''}`}>
      <span className="t">{r.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
      <span className="bd">
        {r.sched.title}
        {!channelId && r.sched.channel_slug && <span className="mkcalrm">#{r.sched.channel_slug}</span>}
      </span>
    </button>
  );
  const chip = (it: ContentItemWide) => (
    <button key={it.id} className={`mkcalitem ${it.status}`} onClick={() => setOpen(it)}
      title={`${it.body}\n— ${it.status}${it.scheduled_at ? ` · ${timeOf(it.scheduled_at)}` : ''}${it.channel_slug ? ` · #${it.channel_slug}` : ''}`}>
      <span className="t">{timeOf(slotOf(it))}</span>
      <span className="bd">
        {briefOnly(it) && <span className="mkcalno" aria-label="no image yet" />}
        {it.body.slice(0, 42)}
        {!channelId && it.channel_slug && <span className="mkcalrm">#{it.channel_slug}</span>}
      </span>
    </button>
  );

  return (
    <div className="mkcalview">
      <ScopeBar q={q} onQ={setQ} placeholder="Search automations & posts" projects={projects} chans={chans}
        projectId={projectId} channelId={channelId} onProject={setProjectId} onChannel={setChannelId}
        right={<span className="scoperight"><span className="mkviewchips">
          <button className={lens === 'week' ? 'on' : ''} onClick={() => setLens('week')}>Week</button>
          <button className={lens === 'month' ? 'on' : ''} onClick={() => setLens('month')}>Month</button>
        </span></span>} />
      <div className="mkcalwrap">
        <div className="mkcalhead">
          <div className="mkcalnav">
            <button onClick={() => (lens === 'week' ? setWeekOff((w) => w - 1) : setMonthOff((m) => m - 1))} aria-label={`Previous ${lens}`}>‹</button>
            <button onClick={() => (lens === 'week' ? setWeekOff((w) => w + 1) : setMonthOff((m) => m + 1))} aria-label={`Next ${lens}`}>›</button>
          </div>
          <span className="mkcalrange">{lens === 'week' ? weekRange : monthStart.toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
          {(lens === 'week' ? weekOff : monthOff) !== 0 && (
            <button className="btn ghost sm" onClick={() => { setWeekOff(0); setMonthOff(0); }}>Today</button>
          )}
          <span className="mkcalspacer" />
          {!!tally && <span className="mkcaltally">{tally}</span>}
        </div>

        {!shown.length && !shownScheds.length ? (
          <div className="routinesempty">
            <b>{narrowed ? 'Nothing here matches this filter.' : 'Nothing is scheduled yet.'}</b>
            <span>{narrowed
              ? 'Widen the project or room filter, or clear the search.'
              : 'Two things land on this grid: automations, at every hour they fire, and drafted posts once you approve one and give it a slot. Arm an automation on the Routines tab, or ask an agent for posts in any room.'}</span>
          </div>
        ) : (
          <>
            {/* the rail: drafts with no slot. Not a day, because they are not happening on one. */}
            {!!unslotted.length && (
              <div className="mkunsched">
                <div className="mkunschedk">
                  <b>Needs a slot</b>
                  <span>{unslotted.length} draft{unslotted.length === 1 ? '' : 's'}{unslotted.filter(briefOnly).length ? ` · ${unslotted.filter(briefOnly).length} no image` : ''}</span>
                </div>
                <div className="mkunschedlist">
                  {unslotted.map((it) => (
                    <button key={it.id} className="mkuchip" onClick={() => setOpen(it)} title={`${it.body}\n— give it a slot to put it on the grid`}>
                      <span className="g" aria-hidden>{MK_PLATFORM_ICON[it.platform] ?? '•'}</span>
                      {briefOnly(it) && <span className="mkcalno" aria-label="no image yet" />}
                      <span className="bd">{it.body.slice(0, 38)}</span>
                      {!channelId && it.channel_slug && <span className="mkcalrm">#{it.channel_slug}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {lens === 'week' ? (
              <div className="mkcalgrid" role="grid" aria-label="Content calendar">
                <div className="mkchd" style={{ borderLeft: 'none' }} />
                {days.map((d) => (
                  <div key={d.toISOString()} className={`mkchd${dayKey(d) === todayKey ? ' today' : ''}`}>
                    {d.toLocaleDateString([], { weekday: 'short' })} <span className="dnum">{d.getDate()}</span>
                  </div>
                ))}
                {/* the automations lane, above the publishing lanes and ruled off from them: a
                    routine is not a network, it is the thing that often WRITES what lands below */}
                <Fragment key="runs">
                  <div className="mkplab mkplabrun"><span className="mkplabg" aria-hidden><IconRepeat s={11} /></span>Automations</div>
                  {days.map((d) => (
                    <div key={`run-${dayKey(d)}`} className={`mkcell mkcellrun${dayKey(d) === todayKey ? ' today' : ''}`}>
                      {(runsByDay.get(dayKey(d)) ?? []).map(runChip)}
                    </div>
                  ))}
                </Fragment>
                {MK_PLATFORMS.map(([pk, pl]) => (
                  <Fragment key={pk}>
                    <div className="mkplab"><span className="mkplabg" aria-hidden>{MK_PLATFORM_ICON[pk] ?? '•'}</span>{pl}</div>
                    {days.map((d) => (
                      <div key={dayKey(d)} className={`mkcell${dayKey(d) === todayKey ? ' today' : ''}`}>
                        {(byDay.get(dayKey(d)) ?? []).filter((it) => it.platform === pk).map(chip)}
                      </div>
                    ))}
                  </Fragment>
                ))}
              </div>
            ) : (
              // Month answers the editorial question week cannot: where are the HOLES. One dot per
              // post plus the first headline — the shape of the month, not its contents.
              <div className="mkmgrid" role="grid" aria-label="Content calendar, month">
                {[...Array(7)].map((_, i) => (
                  <div key={i} className="mkchd">{new Date(monday.getTime() + i * 86_400_000).toLocaleDateString([], { weekday: 'short' })}</div>
                ))}
                {monthCells.map((d) => {
                  const here = byDay.get(dayKey(d)) ?? [];
                  const fires = runsByDay.get(dayKey(d)) ?? [];
                  const outside = d.getMonth() !== monthStart.getMonth();
                  return (
                    <div key={d.toISOString()} className={`mkmcell${dayKey(d) === todayKey ? ' today' : ''}${outside ? ' out' : ''}`}>
                      <span className="dn">
                        {d.getDate()}
                        {/* automations are a COUNT here, never dots. A daily routine would put a dot
                            on all 30 days and drown the content signal the month lens exists to read. */}
                        {!!fires.length && (
                          <span className="mkmruns" title={fires.map((r) => `${r.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })} ${r.sched.title}`).join('\n')}>
                            <IconRepeat s={9} />{fires.length}
                          </span>
                        )}
                      </span>
                      {!!here.length && (
                        <>
                          <span className="mkmdots">{here.slice(0, 8).map((it) => <i key={it.id} className={`s-${it.status}`} />)}</span>
                          <button className="mkmmini" onClick={() => setOpen(here[0]!)} title={here.map((it) => it.body.slice(0, 60)).join('\n')}>
                            {here.length > 1 ? `${here.length} posts` : here[0]!.body.slice(0, 28)}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mkcallegend">
              <span><i className="l-run" />automation fires</span>
              <span><i className="l-draft" />draft — no slot yet</span>
              <span><i className="l-scheduled" />scheduled</span>
              <span><i className="l-published" />published</span>
              <span><i className="l-failed" />failed</span>
              <span><span className="mkcalno" />still has no image</span>
            </div>
          </>
        )}
      </div>
      {/* the calendar spans every room, so the WIDE row already carries both — this is the one
          surface where "which account, which project" was least guessable */}
      {open && (
        <PostPreviewModal key={open.id} item={open} channelSlug={open.channel_slug ?? 'workspace'}
          channelId={open.channel_id} projectName={projects.find((p) => p.id === open.project_id)?.name ?? null}
          onClose={() => setOpen(null)} onChanged={reload} />
      )}
      {/* the routine's OWN room — the calendar spans every room, so there is no one scope to edit against */}
      {editSched && (
        <ScheduleFormModal key={editSched.id} channelId={editSched.channel_id ?? ''} sched={editSched}
          onClose={() => setEditSched(null)} onChanged={reload} />
      )}
    </div>
  );
}
