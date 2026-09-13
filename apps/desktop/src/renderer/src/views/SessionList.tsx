// The session list (docs/35) — one row anatomy, grouped Today/Yesterday/This week/Earlier.
// Split out of views/HomeView.tsx.
import { Fragment, useMemo } from 'react';
import { IconArchive, IconRoutineClock, IconThreads } from '../ui/icons';
import { STATE_LABEL } from '../task/labels';
import { archivableThreadId } from './HistoryRail';
import { sessionGroups, type HistoryRow } from '../room-tabs';
import { timeAgoShort } from '../lib/time';
import { type OrbState } from 'thinking-orbs';
import { type TaskAllRow } from '../bridge/rows-board';
import { type ToolCat } from '@neuramesh/shared';

// which orb a moment wears — the mapping the design round settled (mockup §C's table)
export function orbStateFor(verb: string, cat?: ToolCat | null, role?: string | null): OrbState {
  if (cat === 'search') return 'searching';
  if (cat) return role === 'designer' ? 'shaping' : 'working';
  if (/composing|writing|drafting/i.test(verb)) return 'composing';
  if (/spawn|fan|leg/i.test(verb)) return 'weaving';
  if (/review|judg|verdict/i.test(verb)) return 'solving';
  if (/waiting|listen/i.test(verb)) return 'listening';
  return 'breathing'; // thinking… / idle presence
}

/**
 * Where the dial's arc stops, per FSM state. Deliberately a plain table, not `journeyFor`: a
 * row's own `state` is the dial's input (docs/35 §3.2), so nothing recomputes progress a second
 * way, and the arc is a conic-gradient rather than an SVG per row (§11 — 60fps over 200 rows).
 * The hue is NOT here: `.c-<state>` already carries it and the dial inherits it through
 * currentColor, so there is one state palette in the app, not two.
 */
export const DIAL_AT: Record<string, number> = {
  backlog: 5, todo: 10, designing: 22, design_review: 32, planning: 40, plan_review: 50,
  in_progress: 62, in_review: 78, done: 86, shipping: 90, ship_review: 93, releasing: 96,
  verifying: 98, accepted: 100, closed: 100,
  // blocked says nothing about how far the work got — it is a hold, not a position. Half the
  // ring reads as "mid-journey, stopped", which is exactly what is true.
  blocked: 50,
};

export function SessionRow({ row, live, showRoom, roomTag, selected, onOpen, onArchive }: {
  row: HistoryRow<TaskAllRow>;
  /** an OPEN run on this session's task or thread — the one liveness signal (docs/29 §10) */
  live: boolean;
  /** Home spans every room, so the row names its own; in a room the age takes that line */
  showRoom: boolean;
  /** what the room slot SAYS when shown — a row says what the scope doesn't (docs/33), and a
   * cross-project lens needs `project · #room` where one room's list needs only `#room` */
  roomTag?: (row: HistoryRow<TaskAllRow>) => string;
  selected: boolean;
  onOpen: () => void;
  onArchive?: (threadId: string) => void;
}) {
  const state = row.state;
  // a routine's run is its own species of session (2026-08-22, George): the clock glyph and
  // the chip say so at a glance — same anatomy, different marker, and liveness still wins
  const routine = !state && !!row.scheduleId;
  const label = state ? STATE_LABEL[state] ?? state : routine ? 'routine' : row.rootMessageId ? 'room' : 'chat';
  const archiveId = onArchive ? archivableThreadId(row) : null;
  const inner = (
    <button
      type="button"
      className={`srow${selected ? ' on' : ''}`}
      onClick={onOpen}
      title={row.rootMessageId
        ? `${row.title} — a room message from before every send started a conversation; reply to start one`
        : `${row.title} · ${label} · #${row.channelSlug}`}
    >
      {state
        ? <span className={`sdial c-${state}${live ? ' live' : ''}`} style={{ ['--frac' as string]: `${DIAL_AT[state] ?? 50}%` }} aria-hidden />
        : <span className={`sglyph${routine ? ' routine' : ''}${live ? ' live' : ''}`} aria-hidden>{routine ? <IconRoutineClock s={11} /> : <IconThreads s={11} />}</span>}
      <span className="sbody">
        <span className="st">{row.title}</span>
        {row.snip ? <span className="ssnip">{row.snip}</span> : null}
      </span>
      <span className="smeta">
        <span className={`chip c-${state ?? (routine ? 'routine' : 'chat')}`}>{label}</span>
        <span className="swhen">{showRoom ? (roomTag ? roomTag(row) : `#${row.channelSlug}`) : timeAgoShort(row.when)}</span>
      </span>
    </button>
  );
  if (!archiveId) return inner;
  return (
    <span className="srowwrap">
      {inner}
      {/* the gear-on-the-row idiom the channel and project rows already use, revealed on hover so
          a resting list stays clean. One action, not a menu: archiving is the only row action a
          conversation has today, and a one-item menu is a worse version of a button. */}
      <button
        type="button"
        className="srowarch"
        title="Archive conversation — it moves to Settings › Archived chats"
        aria-label="Archive conversation"
        onClick={(e) => { e.stopPropagation(); onArchive?.(archiveId); }}
      >
        <IconArchive s={13} />
      </button>
    </span>
  );
}

/**
 * The list itself: day buckets (Today · Yesterday · This week · Earlier), newest first, with the
 * ⌘Y overlay as its floor — the overlay stays the everything-lens with the only search field in
 * the product, so the list is deliberately the NEWEST rows and never a filtered view.
 */
export function SessionList({ rows, liveIds, showRoom, roomTag, selectedKey, onOpen, onSeeAll, onArchive, empty }: {
  rows: Array<HistoryRow<TaskAllRow>>;
  liveIds: Set<string>;
  showRoom: boolean;
  roomTag?: (row: HistoryRow<TaskAllRow>) => string;
  selectedKey?: string | null;
  onOpen: (row: HistoryRow<TaskAllRow>) => void;
  onSeeAll: () => void;
  onArchive?: (threadId: string, title: string) => void;
  empty?: React.ReactNode;
}) {
  // the clock is read HERE and injected — sessionGroups never reads it, so every boundary in
  // room-tabs.test.ts is assertable
  const groups = useMemo(() => sessionGroups(rows, Date.now()), [rows]);
  if (!rows.length) return empty ? <div className="slist">{empty}</div> : null;
  return (
    <div className="slist">
      {groups.map((g) => (
        <Fragment key={g.label}>
          <div className="sgroup">{g.label}</div>
          {g.rows.map((r) => (
            <SessionRow
              key={r.key}
              row={r}
              live={(!!r.task && liveIds.has(r.task.id)) || (!!r.threadId && liveIds.has(r.threadId))}
              showRoom={showRoom}
              roomTag={roomTag}
              selected={selectedKey === r.key}
              onOpen={() => onOpen(r)}
              onArchive={onArchive ? (id) => onArchive(id, r.title) : undefined}
            />
          ))}
        </Fragment>
      ))}
      <button type="button" className="sallrow" onClick={onSeeAll}>
        Search every conversation <span className="k">⌘Y</span>
      </button>
    </div>
  );
}
