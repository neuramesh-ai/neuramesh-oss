// The scope bar — search + project + room, the visible, reversible narrowing every
// workspace-wide destination carries (docs/33). Extracted from App.tsx (track A2).
import { Fragment, useState } from 'react';
import { IconClose, IconSearch } from './icons';

import { type ChannelRow } from '../bridge/rows-rooms';
import { type WorkspaceProjectRow } from '../bridge/rows-board';

/* ── The scope bar ────────────────────────────────────────────────────────────────────────────
 * Every workspace destination (Tasks · Whiteboards · Automations · Files · Skills · Activity)
 * wears this one row: a search field, then the two filters that matter — project, then room.
 *
 * It exists because the destinations used to answer "what am I looking at?" three different ways:
 * the board read the ACTIVE PROJECT, whiteboards took a channel id, automations took a channel id
 * plus an `inScope` predicate, and the Library filtered through `rowsInProject` before rendering.
 * Same question, four mechanisms, and every one of them hid rows the human had not asked to hide.
 * Now the destination is workspace-wide by default and narrowing is a VISIBLE, reversible choice
 * on this bar, never an invisible default. Filtering is the human's act, same ruling as the ★.
 */
export function ScopePill({ label, active, items, onPick, set, onClear, icon }: {
  label: string;
  active: string | null;
  /** `group` renders a section head when it changes between rows (R5b: the channel menu groups
   *  by project — repeated slugs like #general need the project as a HEADING, not a sub-line) */
  items: Array<{ id: string | null; label: string; sub?: string; group?: string }>;
  onPick: (id: string | null) => void;
  /** a SET filter wears the accent-soft selection wash + an × (Home's pills; docs/33 —
   *  warm-as-selection is the idiom). ScopeBar callers omit both and are unchanged. */
  set?: boolean;
  onClear?: () => void;
  /** a leading glyph (R5 — Home's rail pills: # for channels, the grid for projects) */
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const cur = items.find((i) => i.id === active) ?? items[0]!;
  let lastGroup: string | undefined;
  return (
    <div className="cchips scopepill">
      <button className={`cchip${open ? ' open' : ''}${set ? ' setfilter' : ''}`} data-tip={`${label}: ${cur.label}`} onClick={() => setOpen((v) => !v)}>
        {icon ? <span className="spico" aria-hidden>{icon}</span> : null}
        <span className="lbl">{cur.label}</span>
        {set && onClear
          ? <span className="sfx" role="button" aria-label={`Clear ${label.toLowerCase()} filter`} title="Clear"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onClear(); }}>✕</span>
          : <span className="car">▾</span>}
      </button>
      {open && (
        <>
          <div className="projmenu-scrim" onClick={() => setOpen(false)} />
          <div className="cprojpop scopepop">
            <div className="cprojlist">
              {items.map((i) => {
                const head = i.group && i.group !== lastGroup ? <div className="cprojsec">{i.group}</div> : null;
                lastGroup = i.group ?? lastGroup;
                return (
                  <Fragment key={i.id ?? '~all'}>
                    {head}
                    <button className={`cprojitem${i.id === active ? ' on' : ''}`}
                      onClick={() => { setOpen(false); onPick(i.id); }}>
                      <span className="cprojtxt"><b>{i.label}</b>{i.sub ? <span>{i.sub}</span> : null}</span>
                      {i.id === active && <span className="cprojck">✓</span>}
                    </button>
                  </Fragment>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function ScopeBar({ q, onQ, placeholder, projects, chans, projectId, channelId, onProject, onChannel, right }: {
  q: string;
  onQ: (v: string) => void;
  placeholder: string;
  projects: WorkspaceProjectRow[];
  chans: ChannelRow[];
  projectId: string | null;
  /** omit BOTH to drop the room pill — Marketing OS: one marketing room per project, so the
   *  project pick already IS the room pick and a second dropdown only restates it */
  channelId?: string | null;
  onProject: (id: string | null) => void;
  onChannel?: (id: string | null) => void;
  right?: React.ReactNode;
}) {
  // the room list follows the project pick — offering rooms from a project you have filtered out
  // is offering a filter that can only ever return nothing. Unscoped, sort by project so the
  // group heads run once each (interleaved rooms would repeat a heading).
  const projName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? '';
  const rooms = projectId
    ? chans.filter((c) => c.project_id === projectId)
    : [...chans].sort((a, b) => projName(a.project_id).localeCompare(projName(b.project_id)) || a.slug.localeCompare(b.slug));
  return (
    <div className="scopebar">
      <div className="wfsearch scopesearch">
        <IconSearch s={14} />
        <input value={q} onChange={(e) => onQ(e.target.value)} placeholder={placeholder} />
        {q && <button className="wfsearchx" title="Clear" aria-label="Clear search" onClick={() => onQ('')}><IconClose s={12} /></button>}
      </div>
      <ScopePill label="Project" active={projectId} onPick={(id) => { onProject(id); onChannel?.(null); }}
        items={[{ id: null, label: 'All projects' }, ...projects.filter((p) => p.status === 'active').map((p) => ({ id: p.id, label: p.name, sub: p.slug }))]} />
      {/* unscoped, slugs repeat across projects (#general × N) — the project heads the group */}
      {onChannel && <ScopePill label="Room" active={channelId ?? null} onPick={onChannel}
        items={[{ id: null, label: 'All rooms' }, ...rooms.map((c) => ({ id: c.id, label: `#${c.slug}`, group: projectId ? undefined : projects.find((p) => p.id === c.project_id)?.name }))]} />}
      {right}
    </div>
  );
}
