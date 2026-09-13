// Whiteboards (docs/38) — the destination's home. Extracted from App.tsx (track A4).
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ScopeProps } from '../shell/useScopeMemory';
import { IconWhiteboard } from '../ui/icons';
import { ScopeBar } from '../ui/ScopeBar';
import { materializeWhiteboard } from '../wb-materialize';
import { nm as nmBridge } from '../bridge/nm';
import { parseWbRow, type WbRow, wbNeedsMaterialize, wbSnapshotSrc, whiteboardGroups } from '../whiteboards';
import { timeAgoShort } from '../lib/time';
import { type ChannelRow } from '../bridge/rows-rooms';
import { type WorkspaceProjectRow } from '../bridge/rows-board';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

/** The Whiteboards destination (docs/38): a recency grid of snapshot tiles, scoped by the nav's
 *  scope knob exactly like Tasks and Automations. Tiles render the stored SVG still — no live
 *  canvas ever mounts in a list (the 60fps budget) — and a tile that still carries an agent's
 *  unrealized source volunteers this desktop as its materializer. */
export function WhiteboardsHome({ projects, chans, onOpen, onNew, scope, setScope }: {
  projects: WorkspaceProjectRow[]; chans: ChannelRow[];
  onOpen: (b: { id: string; title: string }) => void; onNew: () => void;
  /** this destination's remembered narrowing (shell/useScopeMemory.ts) — the shell owns the
   *  remembering so every destination answers the same way when you navigate away and back */
  scope: ScopeProps['scope'];
  setScope: ScopeProps['setScope'];
}) {
  const { projectId, channelId, q } = scope;
  const setProjectId = (v: string | null) => setScope({ projectId: v });
  const setChannelId = (v: string | null) => setScope({ channelId: v });
  const setQ = (v: string) => setScope({ q: v });
  const [rows, setRows] = useState<WbRow[]>([]);
  // WORKSPACE-WIDE by default. This used to take the shell's active project and channel scope,
  // so a board drawn in another project was simply not here — with nothing on screen saying so.
  // The watch already supported a null scope (sync.ts falls through to an unfiltered query); it
  // was only ever the caller that narrowed it.
  useEffect(() => {
    if (!nm?.watchWhiteboards) return;
    setRows([]);
    return nm.watchWhiteboards({ channelId: null, projectId: null }, (raw) => {
      setRows((raw as unknown[]).map(parseWbRow).filter((r): r is WbRow => !!r));
    });
  }, []);
  useEffect(() => {
    for (const r of rows) if (wbNeedsMaterialize(r)) void materializeWhiteboard(r);
  }, [rows]);
  const chanProject = useMemo(() => new Map(chans.map((c) => [c.id, c.project_id ?? null])), [chans]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => !projectId || chanProject.get(r.channelId) === projectId)
      .filter((r) => !channelId || r.channelId === channelId)
      .filter((r) => !needle || r.title.toLowerCase().includes(needle) || (r.channelSlug ?? '').toLowerCase().includes(needle));
  }, [rows, projectId, channelId, q, chanProject]);
  const groups = useMemo(() => whiteboardGroups(shown, Date.now()), [shown]);
  const filtered = shown.length !== rows.length;
  return (
    <div className="wbhome">
      <ScopeBar q={q} onQ={setQ} placeholder="Search whiteboards" projects={projects} chans={chans}
        projectId={projectId} channelId={channelId} onProject={setProjectId} onChannel={setChannelId}
        right={<span className="scoperight"><button className="wbnew" onClick={onNew}>＋ New whiteboard</button></span>} />
      {shown.length === 0 ? (
        <div className="wbempty">
          <div className="t">{filtered || q ? 'No board matches this filter.' : 'Nothing sketched here yet.'}</div>
          <div className="d">{filtered || q
            ? 'Widen the project or room filter, or clear the search.'
            : 'Draw the first one — or ask an agent for a diagram in any chat and it lands here.'}</div>
          <button className="wbnew" onClick={onNew}>＋ New whiteboard</button>
        </div>
      ) : (
        groups.map((g, gi) => (
          <Fragment key={g.label}>
            <div className="wbdaysec">{g.label}</div>
            <div className="wbgrid">
              {g.rows.map((r) => {
                const src = wbSnapshotSrc(r.snapshotSvg);
                return (
                  <button key={r.id} className="wbtile" onClick={() => onOpen({ id: r.id, title: r.title })} title={r.title}>
                    <span className="wbtilesnap">
                      {src ? <img className="wbsnapimg" src={src} alt="" draggable={false} />
                        : <span className="wbtilewait">{r.source ? 'waiting for a desktop to draw it…' : 'an empty board'}</span>}
                    </span>
                    <span className="wbtilem">
                      <b>{r.title}</b>
                      <span className="rm">#{r.channelSlug}</span>
                      <span className="w">{timeAgoShort(r.updatedAt)}</span>
                    </span>
                  </button>
                );
              })}
              {gi === 0 && (
                <button className="wbtile ghost" onClick={onNew}>
                  <span><span className="plus"><IconWhiteboard s={16} /></span>New whiteboard</span>
                </button>
              )}
            </div>
          </Fragment>
        ))
      )}
    </div>
  );
}
