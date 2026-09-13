// The Projects destination — every project in the workspace as a card, with its rooms, its
// crew, and the manage/archive/delete actions. Split out of App.tsx: it takes props and closes
// over nothing there, so it is a sibling component that merely happened to share a file.
import { type WorkspaceProjectRow } from './bridge/rows-board';
import { type AgentRow, type MemberRow } from './bridge/rows-crew';
import { AgentAvatar, ProjLogo } from './components/AgentAvatar';
import { selfLabel } from './lib/self';
import { timeAgo } from './lib/time';
import { IconArrowR, IconInbox, IconKebab, IconSearch, IconSettings, IconTrash } from './ui/icons';
import { useState } from 'react';

export function ProjectsPage({ projects, activeId, workspaceName, agentsFor, people, selfId, selfEmail, onSwitch, onManage, onDelete, onArchive, onNew }: {
  projects: WorkspaceProjectRow[];
  activeId: string | null;
  /** per-project crew (active only), mapped by channel id in App — the card draws the pile from this */
  agentsFor: (id: string) => AgentRow[];
  /** workspace humans — people are workspace-wide, not channel-registered, so every card shares them */
  people: MemberRow[];
  selfId?: string | null;
  selfEmail?: string | null;
  workspaceName: string;
  onSwitch: (id: string) => void;
  onManage: (p: WorkspaceProjectRow) => void;
  onDelete: (p: WorkspaceProjectRow) => void;
  onArchive: (p: WorkspaceProjectRow, archived: boolean) => void;
  onNew: (origin: { x: number; y: number } | null) => void;
}) {
  const [q, setQ] = useState('');
  const [showArch, setShowArch] = useState(true);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const active = projects.filter((p) => p.status === 'active');
  const archived = projects.filter((p) => p.status === 'archived');
  const needle = q.trim().toLowerCase();
  const hit = (p: WorkspaceProjectRow) => !needle || `${p.slug} ${p.name} ${p.description ?? ''}`.toLowerCase().includes(needle);
  const shown = active.filter(hit);
  const shownArch = archived.filter(hit);
  const roomCount = (p: WorkspaceProjectRow) => (p.channel_slugs ?? '').split(',').filter(Boolean).length;
  // the 4px whisper strip: bucket counts → proportional segments in the board's own state colors
  const pulse = (p: WorkspaceProjectRow): Array<[number, string]> =>
    ([[p.t_pre, 'var(--todo)'], [p.t_build, 'var(--prog)'], [p.t_review, 'var(--review)'], [p.t_land, 'var(--done)']] as Array<[number | null | undefined, string]>)
      .filter((e): e is [number, string] => (e[0] ?? 0) > 0);
  const origin = (e: React.MouseEvent) => { const r = e.currentTarget.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const menu = (p: WorkspaceProjectRow) => (
    <>
      <div className="projmenu-scrim" onClick={(e) => { e.stopPropagation(); setMenuFor(null); }} />
      <div className="pmenu" onClick={(e) => e.stopPropagation()}>
        {p.status === 'archived' ? (
          <>
            <button onClick={() => { setMenuFor(null); onArchive(p, false); }}><IconInbox s={13} />Unarchive</button>
            <hr />
            <button className="danger" onClick={() => { setMenuFor(null); onDelete(p); }}><IconTrash s={13} />Delete project…</button>
          </>
        ) : (
          <>
            <button onClick={() => { setMenuFor(null); onSwitch(p.id); }}><IconArrowR s={13} />Open project</button>
            <button onClick={() => { setMenuFor(null); onManage(p); }}><IconSettings s={13} />Project settings</button>
            {!p.is_default && <button onClick={() => { setMenuFor(null); onArchive(p, true); }}><IconInbox s={13} />Archive project</button>}
          </>
        )}
      </div>
    </>
  );
  return (
    <>
      <div className="topbar">Projects <span className="desc">{workspaceName} · {active.length} active</span>
        <div className="actions ptopacts">
          <button className="btn primary" onClick={(e) => onNew(origin(e))}>＋ New project</button>
        </div>
      </div>
      <div className="pwrap">
        <div className="ptoolbar">
          <div className="psearch">
            <IconSearch s={13} />
            <input value={q} placeholder="Search projects…" onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
          </div>
          <span style={{ flex: 1 }} />
          {archived.length > 0 && (
            <button className={`chiptoggle r8${showArch ? ' on' : ''}`} onClick={() => setShowArch((v) => !v)} aria-pressed={showArch}>Archived · {archived.length}</button>
          )}
        </div>
        {shown.length === 0 && needle ? (
          <div className="pempty">No project matches <b>“{q.trim()}”</b><br />
            <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setQ('')}>Clear search</button>
          </div>
        ) : (
          <div className="pgrid">
            {shown.map((p) => (
              <div
                key={p.id}
                className={`pcard${p.id === activeId ? ' current' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onSwitch(p.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSwitch(p.id); }}
              >
                <div className="pchead">
                  <ProjLogo logo={p.logo_url} name={p.name || p.slug} size={38} />
                  <span className="pcid"><b>{p.slug}</b><small>{p.name}</small></span>
                  <span className="pctags">
                    {p.id === activeId && <span className="ptag cur">current</span>}
                    {!!p.is_default && <span className="ptag">default</span>}
                  </span>
                  <button className={`pckebab${menuFor === p.id ? ' show' : ''}`} title="project menu" aria-label={`${p.slug} menu`} aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); setMenuFor((m) => (m === p.id ? null : p.id)); }}><IconKebab s={15} /></button>
                </div>
                {menuFor === p.id && menu(p)}
                <div className={`pcdesc${p.description ? '' : ' none'}`}>{p.description || 'No description yet'}</div>
                {p.open_tasks > 0 && pulse(p).length > 0
                  ? <div className="pcspec" aria-hidden>{pulse(p).map(([n, c], i) => <i key={i} style={{ flex: n, background: c }} />)}</div>
                  : <div className="pcspec empty" aria-hidden />}
                {/* The roster lives ON the card (design round 2026-08-01): "who is on this project"
                    is what a switcher card is for, so the crew and people render as avatar piles —
                    the same .cluav idiom as the room utilbar — with rooms · open kept as text. */}
                {(() => {
                  const ags = agentsFor(p.id);
                  // roster still syncing → the server aggregate keeps the count honest instead of 0
                  const agCount = ags.length || (p.agents_count ?? 0);
                  return (
                    <div className="pcstacks">
                      {agCount > 0 && (
                        <span className="pcstack" title={ags.length ? ags.map((a) => a.name).join(', ') : `${agCount} agents`}>
                          <span className="cluav">
                            {ags.slice(0, 4).map((a) => (
                              <span key={a.id} className="cluagent"><AgentAvatar name={a.name} size={20} radius={6} /></span>
                            ))}
                          </span>
                          <span className="clun">{agCount}</span>
                        </span>
                      )}
                      {people.length > 0 && (
                        <span className="pcstack" title={people.map((m) => (m.user_id === selfId ? selfLabel(m.display_name, selfEmail) : (m.display_name ?? 'member'))).join(', ')}>
                          <span className="cluav">
                            {people.slice(0, 3).map((m) => {
                              const nm = m.user_id === selfId ? selfLabel(m.display_name, selfEmail) : (m.display_name ?? 'member');
                              return <span key={m.user_id} className="clutile">{(nm[0] ?? 'M').toUpperCase()}</span>;
                            })}
                          </span>
                          <span className="clun">{people.length}</span>
                        </span>
                      )}
                      <span className="pcfacts">{roomCount(p)} channel{roomCount(p) === 1 ? '' : 's'} <em>·</em> {p.open_tasks} open</span>
                    </div>
                  );
                })()}
                <div className="pcfoot"><span className="pcwhen">{p.last_activity ? `active ${timeAgo(p.last_activity)}` : 'no activity yet'}</span></div>
              </div>
            ))}
            <button className="pcnew" onClick={(e) => onNew(origin(e))}>
              <span className="pcnewico" aria-hidden>＋</span>
              <span className="pcnewlbl">New project</span>
            </button>
          </div>
        )}
        {shownArch.length > 0 && showArch && (
          <div className="parch">
            <div className="parchhd">Archived · {shownArch.length}</div>
            {shownArch.map((p) => (
              <div key={p.id} className="parchrow">
                <ProjLogo logo={p.logo_url} name={p.name || p.slug} size={26} />
                <b>{p.slug}</b><span className="meta">{p.name}</span>
                <button className={`pckebab${menuFor === p.id ? ' show' : ''}`} title="project menu" aria-label={`${p.slug} menu`} aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); setMenuFor((m) => (m === p.id ? null : p.id)); }}><IconKebab s={15} /></button>
                {menuFor === p.id && menu(p)}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
