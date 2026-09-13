// Routines — the inventory of what is armed (docs/automations).
// Extracted from App.tsx (track A2).
import { IconChevron, IconPause, IconPlay, IconTrash } from '../ui/icons';
import { shortAgo , replyPreview } from '@neuramesh/shared';
import type { ScheduleRunRow } from '../bridge/rows-content';
import type { ScopeProps } from '../shell/useScopeMemory';
import { SCHED_WEEKDAYS, ScheduleFormModal, nextRunLabel } from '../schedule/schedule';
import { ScopeBar } from '../ui/ScopeBar';
import { nm as nmBridge } from '../bridge/nm';
import { type ChannelRow } from '../bridge/rows-rooms';
import { type ScheduleRow } from '../bridge/rows-content';
import { type WorkspaceProjectRow } from '../bridge/rows-board';
import { useCallback, useEffect, useMemo, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// One centered modal for arming AND editing a drafting schedule (round 21): sched=null
// arms a new one (schedule.create), else edits in place (schedule.update, run_count
// untouched — an edit is not a claim; pause/resume + remove live in the footer). Both
// paths share the same fields, styling and animation — no more far-off inline popover.
// ── Automations (2026-07-30 as the Routines tab; a destination since 2026-08-03) ──────────
// Outside marketing, an armed schedule fires its PROMPT into the room at the slot — the send
// births a thread and triage handles it exactly like a composer send (agents.ts, the minute
// tick), so every execution is a session with full visibility. This surface is the missing
// half: what is armed, when it fires next, pause/resume/edit/remove. Rows reuse the schedule
// machinery UpcomingList proved (poll + set_status + two-step delete + the editor modal).
//
// `channelId: null` is All scope — every room in the ACTIVE PROJECT (`inScope` filters the
// workspace-wide query down, the same axis every other conversation surface rides). It replaced
// the count-gated room tab, which was invisible in exactly the room where you had not armed one
// yet: the discovery case it existed to serve. A row names its room whenever the list spans more
// than one, because the room IS the agent pool that answers the prompt.
export function RoutinesView({ projects, chans, onCount, onNew, onOpenRun, scope, setScope }: {
  projects: WorkspaceProjectRow[];
  chans: ChannelRow[];
  onCount: (n: number) => void;
  onNew: () => void;
  /** open one of a routine's run conversations (0119) — the card lists them, the shell shows them */
  onOpenRun: (threadId: string, channelId: string) => void;
  /** this destination's remembered narrowing (shell/useScopeMemory.ts) — the shell owns the
   *  remembering so every destination answers the same way when you navigate away and back */
  scope: ScopeProps['scope'];
  setScope: ScopeProps['setScope'];
}) {
  const { projectId, channelId, q } = scope;
  const setProjectId = (v: string | null) => setScope({ projectId: v });
  const setChannelId = (v: string | null) => setScope({ channelId: v });
  const setQ = (v: string) => setScope({ q: v });

  // RUN HISTORY (0119, George 2026-08-11). Every fire opens its own conversation, so a routine's
  // history was always THERE — scattered through the room's session list with nothing marking
  // which automation opened which thread. The ledger line was already the card's honest fact
  // ("3 runs so far"), so it becomes the door rather than growing a second button beside Pause
  // and Remove: the card gains a disclosure, not a control. One open at a time — this is a grid
  // of cards, and two expanded cards reflow the neighbours of both.
  const [openRuns, setOpenRuns] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, ScheduleRunRow[]>>({});
  const [runsLoading, setRunsLoading] = useState<string | null>(null);
  const toggleRuns = (id: string) => {
  if (openRuns === id) { setOpenRuns(null); return; }
  setOpenRuns(id);
  // refetch on every open: a routine that fired since you last looked must not show a stale list
  setRunsLoading(id);
  void nm?.scheduleRuns(id).then((r) => { setRuns((prev) => ({ ...prev, [id]: r.runs })); })
  .catch(() => setRuns((prev) => ({ ...prev, [id]: [] })))
  .finally(() => setRunsLoading((cur) => (cur === id ? null : cur)));
  };
  const [scheds, setScheds] = useState<ScheduleRow[]>([]);
  const [killSched, setKillSched] = useState<string | null>(null);
  const [edit, setEdit] = useState<ScheduleRow | null>(null);
  // WORKSPACE-WIDE by default — `nm.schedules(null)` already means "every room" (its SQL reads
  // `(? is null or s.channel_id = ?)`). This view used to take the shell's channel scope AND an
  // `inScope` predicate over the active project: two narrowings stacked, neither visible.
  const reload = useCallback(() => {
    void nm?.schedules(null).then((r) => {
      const live = r.schedules.filter((x) => x.status === 'active' || x.status === 'paused');
      setScheds(live);
      onCount(live.length);
    }).catch(() => {});
  }, [onCount]);
  useEffect(() => {
    reload();
    const iv = setInterval(reload, 5000);
    return () => clearInterval(iv);
  }, [reload]);
  const cadenceLine = (x: ScheduleRow) =>
    x.cadence === 'once' ? `Once · ${x.at_time}`
    : x.cadence === 'weekly' ? `${SCHED_WEEKDAYS[x.weekday ?? 1]}s · ${x.at_time}`
    : `${x.cadence[0]!.toUpperCase()}${x.cadence.slice(1)} · ${x.at_time}`;
  // warm the countdown when the slot is close, so a row that is about to fire reads differently
  // from one twelve hours out. Under two hours; a missing/past next_run_at is not "soon", it is late.
  const dueSoon = (iso: string | null) => {
    if (!iso) return false;
    const ms = new Date(iso).getTime() - Date.now();
    return ms > 0 && ms < 2 * 60 * 60 * 1000;
  };
  const chanProject = useMemo(() => new Map(chans.map((c) => [c.id, c.project_id ?? null])), [chans]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scheds
      .filter((x) => !projectId || chanProject.get(x.channel_id ?? '') === projectId)
      .filter((x) => !channelId || x.channel_id === channelId)
      .filter((x) => !needle || x.title.toLowerCase().includes(needle) || (x.prompt ?? '').toLowerCase().includes(needle) || (x.channel_slug ?? '').toLowerCase().includes(needle));
  }, [scheds, projectId, channelId, q, chanProject]);
  const narrowed = !!(projectId || channelId || q.trim());
  const paused = shown.filter((x) => x.status === 'paused');
  const active = shown.filter((x) => x.status !== 'paused');
  return (
    <div className="routinesview">
      <ScopeBar q={q} onQ={setQ} placeholder="Search automations" projects={projects} chans={chans}
        projectId={projectId} channelId={channelId} onProject={setProjectId} onChannel={setChannelId}
        right={<span className="scoperight"><button className="btn sm" onClick={onNew}>＋ New automation</button></span>} />
      {/* the "each run fires its prompt into a room" line retired (2026-08-16, George): with rows
          every entry already SHOWS its cadence and its #room, so the sentence explained what the
          list demonstrates one line below it — and as a bare child of the view it never lined up
          with the scope bar's own inset. The empty state still says what a routine is for. */}
      {!shown.length && (
        <div className="routinesempty">
          <b>{narrowed ? 'No automation matches this filter.' : 'Nothing runs on a schedule yet.'}</b>
          <span>{narrowed
            ? 'Widen the project or room filter, or clear the search.'
            : 'A daily digest, a weekly retro prep, a dependency sweep — anything you would otherwise remember to ask for.'}</span>
          <button className="btn" onClick={onNew}>＋ New automation</button>
        </div>
      )}
      {/* ROWS, not cards (2026-08-16, mockups/routines-rows.html). A card says "look at this one
          thing"; a schedule inventory is a thing you SCAN, and two cards left a wide screen mostly
          empty while the facts that differ — cadence, next fire, run count — sat at each card's
          own right edge, never lining up with the next one's. The anatomy is the bell popover's,
          at destination scale, so the product has one list idiom rather than two. */}
      <div className="rtlist">
      {[...active, ...paused].map((x) => (
        <div key={x.id} className={`rtrow${x.status === 'paused' ? ' paused' : ''}${openRuns === x.id ? ' open' : ''}`} role="button" tabIndex={0} title={`${x.title} — click to edit`}
          onClick={() => setEdit(x)}
          // …only when the Enter came from the ROW ITSELF. Every button inside bubbles its keydown
          // up here, so a keyboard user pressing Enter on Pause paused the routine AND opened the
          // editor on top of it (0119's fix, kept through the rows rewrite).
          onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setEdit(x); }}>
          {/* the leading glyph is the CADENCE: the one thing every routine differs by, on a fixed
              axis so the column reads down rather than row by row */}
          <span className="rtcad">{cadenceLine(x)}</span>
          <span className="rttext">
            <span className="rttitle">{x.title}</span>
            {/* the room it fires INTO rides with the TITLE — it is identity, not schedule */}
            {!channelId && x.channel_slug && <span className="rtroom">#{x.channel_slug}</span>}
            {/* one line, not two: here the prompt IDENTIFIES the routine — the full text is one
                click away in the editor */}
            {x.prompt && <span className="rtprompt">{x.prompt}</span>}
          </span>
          {/* the ledger and the verbs share ONE fixed slot: the meta steps aside and the buttons
              rise in its place, so the row never reflows under the pointer */}
          <span className="rtmeta">
            {x.status === 'paused'
              ? <span className="rtpausedtag">paused</span>
              : <span className={`rtnext${dueSoon(x.next_run_at) ? ' due' : ''}`}>next {nextRunLabel(x.next_run_at)}</span>}
            <span className="rtruns">{(x.run_count ?? 0) === 0 ? 'not run yet' : `${x.run_count} run${x.run_count === 1 ? '' : 's'}`}</span>
          </span>
          <span className="rtgo" aria-hidden>›</span>
          <span className="rtact" onClick={(e) => e.stopPropagation()}>
            {/* RUN HISTORY (0119) as a verb, not a disclosure on the ledger. On a card the ledger
                line could be the door; in a row it cannot — the meta steps aside on hover to make
                room for these, so a clickable count would be unreachable exactly when you reached
                for it. A routine that has never fired gets no control: a disclosure over nothing
                is a dead control, which was 0119's own rule. */}
            {(x.run_count ?? 0) > 0 && (
              <button className={`rtico${openRuns === x.id ? ' on' : ''}`} aria-expanded={openRuns === x.id}
                data-tip={openRuns === x.id ? 'Hide runs' : 'Runs'}
                aria-label={openRuns === x.id ? `Hide the runs of ${x.title}` : `Show the conversations ${x.title} opened`}
                onClick={() => toggleRuns(x.id)}>
                <span className="rtrunscaret"><IconChevron s={12} /></span>
              </button>
            )}
            {(() => {
              const resume = x.status === 'paused';
              return (
                <button className="rtico" data-tip={resume ? 'Resume' : 'Pause'} aria-label={`${resume ? 'Resume' : 'Pause'} ${x.title}`}
                  onClick={() => { void nm?.scheduleStatus(x.id, resume ? 'active' : 'paused').then(reload); }}>
                  {resume ? <IconPlay s={13} /> : <IconPause s={13} />}
                </button>
              );
            })()}
            {/* the two-step survives the loss of its "sure?" label: armed, the glyph goes danger
                and grows a ring, and BOTH the tooltip and the aria-label say what the second
                click does — a confirm carried by colour alone would be no confirm at all */}
            {killSched === x.id
              ? <button className="rtico armed" data-tip="Click again to remove" aria-label={`Confirm removing ${x.title}`}
                  onClick={() => { void nm?.scheduleDelete(x.id).then(reload); setKillSched(null); }}><IconTrash s={13} /></button>
              : <button className="rtico" data-tip="Remove" aria-label={`Remove ${x.title}`}
                  onClick={() => { setKillSched(x.id); setTimeout(() => setKillSched((k) => (k === x.id ? null : k)), 2600); }}><IconTrash s={13} /></button>}
          </span>
          {/* The reveal (0119), unchanged: `grid-template-rows: 0fr → 1fr` animates to the
              content's OWN height, and the panel is always mounted so the close has a transition
              to run rather than a disappearance. */}
          <span className={`runspanel${openRuns === x.id ? ' open' : ''}`} onClick={(e) => e.stopPropagation()}>
            <span className="runspanelin">
              {runsLoading === x.id && !runs[x.id] && <span className="runsnote">Looking up this automation&rsquo;s runs…</span>}
              {runs[x.id]?.length === 0 && runsLoading !== x.id && (
                // the honest empty: run_count counts every fire since the routine was armed, and
                // the thread link only exists for fires after 0119 — so "it ran, I can't show you
                // where" is a real state, and saying nothing would read as a broken button.
                <span className="runsnote">No run conversations recorded yet — runs from before this update aren&rsquo;t linked.</span>
              )}
              {(runs[x.id] ?? []).map((r, i) => (
                <button key={r.id} className="runsrow" title={new Date(r.created_at).toLocaleString()}
                  style={{ ['--i' as string]: String(Math.min(i, 7)) } as React.CSSProperties}
                  onClick={() => onOpenRun(r.id, r.channel_id)}>
                  <span className="runswhen">{shortAgo(r.created_at)}</span>
                  <span className="runstitle">{(r.last_body && replyPreview(r.last_body, 120)) || r.title || 'Untitled run'}</span>
                  {/* a run nobody answered is the one you want to notice: its prompt is the only
                      message in the thread, so the reply count IS the outcome */}
                  <span className={`runsreplies${r.msg_count <= 1 ? ' quiet' : ''}`}>
                    {r.msg_count <= 1 ? 'no reply' : `${r.msg_count - 1} repl${r.msg_count - 1 === 1 ? 'y' : 'ies'}`}
                  </span>
                </button>
              ))}
            </span>
          </span>
        </div>
      ))}
      </div>
      {/* the row's OWN room, not the scope — at All scope there is no one room to edit against */}
      {edit && <ScheduleFormModal channelId={edit.channel_id ?? channelId ?? ''} sched={edit} onClose={() => setEdit(null)} onChanged={reload} />}
    </div>
  );
}
