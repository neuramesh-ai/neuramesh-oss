// Workspace Files (docs/design/workspace-files-2026-08) — the unscoped destination: a folder
// per project, then a typed file table, with the doc/diff overlays it opens.
// Extracted from App.tsx (track A2); bodies unchanged.
import { AgentAvatar } from '../components/AgentAvatar';

import { IconClose, IconFile, IconGrid, IconImage, IconSearch } from '../ui/icons';
import { Md } from '../md/Md';
import { WsFileRow } from './WsFileRow';

import { themedMockupDoc } from '../design/plans';
import { type AgentRow } from '../bridge/rows-crew';
import { type ChannelRow } from '../bridge/rows-rooms';
import { type WorkspaceProjectRow } from '../bridge/rows-board';
import { useCallback, useMemo, useState } from 'react';
import { DiffView, DocOverlay, previewType } from './docpreview';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).


/* ── Workspace Files (docs/design/workspace-files-2026-08) ────────────────────────────────────
 * The Library, re-cut. Three things changed and they are all one idea — a file you cannot see is
 * a file you do not have:
 *
 *  1. Root is EVERY project. The old surface filtered through `rowsInProject(projScopeId)` before
 *     rendering, so it only ever showed the active project. The project axis is now the folder
 *     grid rather than a filter applied before you get to look.
 *  2. Curation is a MARKER, not a gate. `promoted = 1` used to be the where-clause; it is now a ★
 *     on the row and a chip you can filter by. The human still owns the shelf — what they no
 *     longer own is whether a document exists at all.
 *  3. One shape for every file. A room document, a task deliverable and a chat attachment are the
 *     same row here, separated by a `source` chip rather than by three sections with three
 *     different renderings.
 *
 * The ACL is untouched and deliberately visible: a file belongs to a ROOM, an agent registered to
 * that room can read it, and the folder's access row shows exactly who that is. */
export interface WsFile {
  id: string;
  name: string;
  kind: string;
  mime: string | null;
  size: number | null;
  created_at: string;
  channel_id: string;
  channel_slug: string | null;
  promoted: boolean;
  /** room = a document the room keeps · task = a deliverable · chat = shared in a message */
  source: 'room' | 'task' | 'chat';
  task_number: number | null;
  inline_content: string | null;
}

/**
 * The chip filters, in order. `all` is not a bucket — it is the absence of one.
 *
 * Two dimensions share one exclusive row, deliberately. The first two are about WHERE a file came
 * from and are the ones that matter most in a busy project: a room that has run a few tasks fills
 * with plans, diffs and result.md, and the brand documents the team actually keeps get buried
 * under them. The rest are about what a file IS. Default stays `all` — the whole point of this
 * surface is that nothing is hidden — but "the room's own documents" is now one click away.
 */
export const WS_KINDS: Array<[string, string, (f: WsFile) => boolean]> = [
  ['room', 'Documents', (f) => f.source === 'room'],
  ['task', 'From tasks', (f) => f.source === 'task'],
  ['shelf', '★ Shelf', (f) => f.promoted],
  ['docs', 'Docs', (f) => f.kind === 'doc' || /\.(md|markdown|txt)$/i.test(f.name)],
  ['design', 'Design', (f) => f.kind === 'design'],
  ['media', 'Media', (f) => (f.mime ?? '').startsWith('image/') || (f.mime ?? '').startsWith('video/') || f.kind === 'screenshot'],
  ['data', 'Data', (f) => /\.(json|csv|ya?ml|tsv)$/i.test(f.name)],
];

/** The bytes behind a row — the synced inline copy, else the local attachment stream. */
export function wsSrc(f: WsFile): string | null {
  if (f.inline_content?.startsWith('data:')) return f.inline_content;
  return f.source === 'chat' ? `nm-attachment://${f.id}` : f.inline_content;
}

export function WsFileIcon({ f }: { f: WsFile }) {
  if (f.kind === 'design') return <IconGrid s={13} />;
  if ((f.mime ?? '').startsWith('image/') || f.kind === 'screenshot') return <IconImage s={13} />;
  return <IconFile s={13} />;
}

/** A project folder: the project's own mark, its rooms, and the crew that can read inside. */
export function WsFolder({ proj, files, rooms, readers, onOpen }: {
  proj: WorkspaceProjectRow;
  files: number;
  rooms: string[];
  readers: AgentRow[];
  onOpen: () => void;
}) {
  return (
    <div className="wfolder" role="button" tabIndex={0} title={`${proj.name} — ${files} file${files === 1 ? '' : 's'}`}
      onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
      <span className="wftop">
        <span className="wfmark">
          {proj.logo_url ? <img src={proj.logo_url} alt="" /> : proj.name.slice(0, 1).toUpperCase()}
        </span>
        <b className="wfname">{proj.name}</b>
        <span className="wfcount">{files}</span>
      </span>
      <span className="wfrooms">
        {rooms.slice(0, 4).map((s) => <span key={s} className="wfroom">#{s}</span>)}
        {rooms.length > 4 && <span className="wfroom">+{rooms.length - 4}</span>}
      </span>
      <span className="wffoot">
        <span className="wfacl" title={readers.length ? `${readers.map((a) => a.name).join(', ')} can read these files` : 'no agent is registered to these rooms yet'}>
          {readers.slice(0, 3).map((a) => <span key={a.id} className="wfav"><AgentAvatar name={a.name} size={19} radius={6} /></span>)}
          <span className="wfacll">{readers.length ? `${readers.length} can read` : 'no readers'}</span>
        </span>
        <span className="wfwhen">{files ? '' : 'empty'}</span>
      </span>
    </div>
  );
}

export function WorkspaceFiles({ projects, chans, agents, files, uploading, onUpload, onOpenRoom }: {
  projects: WorkspaceProjectRow[];
  chans: ChannelRow[];
  agents: AgentRow[];
  files: WsFile[];
  uploading: string | null;
  onUpload: (projectId: string) => void;
  onOpenRoom?: (channelId: string) => void;
}) {
  const [openProj, setOpenProj] = useState<string | null>(null);
  const [kind, setKind] = useState<string>('all');
  const [q, setQ] = useState('');
  const [openFile, setOpenFile] = useState<string | null>(null);

  // a file's project is its ROOM's project — derived, exactly like a task's (docs/06)
  const projOf = useMemo(() => new Map(chans.map((c) => [c.id, c.project_id ?? null])), [chans]);
  const byProject = useMemo(() => {
    const m = new Map<string, WsFile[]>();
    for (const f of files) {
      const p = projOf.get(f.channel_id);
      if (!p) continue;
      const bucket = m.get(p);
      if (bucket) bucket.push(f);
      else m.set(p, [f]);
    }
    return m;
  }, [files, projOf]);

  const readersFor = useCallback((projectId: string) => {
    const ids = new Set(chans.filter((c) => c.project_id === projectId).map((c) => c.id));
    return agents.filter((a) => !a.retired_at && (a.channel_ids ?? '').split(',').some((c) => ids.has(c.trim())));
  }, [chans, agents]);

  const proj = openProj ? projects.find((p) => p.id === openProj) ?? null : null;

  // Search spans the WORKSPACE from root and narrows to the folder once you are inside one —
  // the same field, so the reflex never changes.
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = proj ? byProject.get(proj.id) ?? [] : files;
    const kindHit = WS_KINDS.find(([k]) => k === kind)?.[2];
    return pool
      .filter((f) => (kindHit ? kindHit(f) : true))
      .filter((f) => !needle || f.name.toLowerCase().includes(needle) || (f.channel_slug ?? '').toLowerCase().includes(needle));
  }, [q, proj, byProject, files, kind]);

  const shown = openFile ? hits.find((f) => f.id === openFile) ?? null : null;
  const shownSrc = shown ? wsSrc(shown) : null;
  const shownType = shown ? previewType(shown.name, shown.kind, shown.inline_content ?? '') : null;

  const search = (
    <div className="wfsearch">
      <IconSearch s={14} />
      <input value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={proj ? `Search in ${proj.name}` : 'Search every file in the workspace'} />
      {q && <button className="wfsearchx" title="Clear" aria-label="Clear search" onClick={() => setQ('')}><IconClose s={12} /></button>}
    </div>
  );

  if (!proj) {
    const active = projects.filter((p) => p.status === 'active');
    return (
      <div className="wfwrap">
        {search}
        {!active.length && <div className="empty">No projects yet — a project is the folder its files live in.</div>}
        <div className="wfgrid">
          {active.map((p) => (
            <WsFolder key={p.id} proj={p}
              files={(byProject.get(p.id) ?? []).length}
              rooms={chans.filter((c) => c.project_id === p.id).map((c) => c.slug)}
              readers={readersFor(p.id)}
              onOpen={() => { setOpenProj(p.id); setKind('all'); setQ(''); }} />
          ))}
        </div>
      </div>
    );
  }

  const all = byProject.get(proj.id) ?? [];
  const count = (pred: (f: WsFile) => boolean) => all.filter(pred).length;
  const rooms = chans.filter((c) => c.project_id === proj.id);
  const readers = readersFor(proj.id);

  return (
    <div className="wfwrap">
      <div className="wfcrumb">
        <button onClick={() => { setOpenProj(null); setQ(''); setOpenFile(null); }}>Workspace Files</button>
        <span aria-hidden>/</span>
        <b>{proj.name}</b>
      </div>
      <div className="wfprojhd">
        <span className="wfmark sm">{proj.logo_url ? <img src={proj.logo_url} alt="" /> : proj.name.slice(0, 1).toUpperCase()}</span>
        <div className="wfprojm">
          <b>{proj.name}</b>
          <span>{all.length} file{all.length === 1 ? '' : 's'} across {rooms.map((c) => `#${c.slug}`).join(', ') || 'no rooms'}
            {readers.length ? ` · readable by ${readers.map((a) => a.name).join(', ')}` : ''}</span>
        </div>
        <button className="wfupload" disabled={!!uploading} onClick={() => onUpload(proj.id)}>
          {uploading ? `Uploading ${uploading}…` : '↑ Upload'}
        </button>
      </div>
      {search}
      <div className="wfchips" role="tablist" aria-label="File kinds">
        <button role="tab" aria-selected={kind === 'all'} onClick={() => setKind('all')}>All <span className="n">{all.length}</span></button>
        {WS_KINDS.map(([k, label, pred]) => {
          const n = count(pred);
          return n ? <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)}>{label} <span className="n">{n}</span></button> : null;
        })}
      </div>
      {!hits.length
        ? <div className="empty">{q ? `Nothing matching “${q}”.` : 'Nothing here yet — upload a file, or let the crew write one.'}</div>
        : (
          <div className="wftable">
            <div className="wfthd">
              <span /><span>Name</span><span>Type</span><span>Size</span><span>Room</span><span>Modified</span><span /><span />
            </div>
            {hits.map((f) => (
              <WsFileRow key={f.id} f={f} open={openFile === f.id} onOpenRoom={onOpenRoom}
                onToggle={() => setOpenFile(openFile === f.id ? null : f.id)} />
            ))}
          </div>
        )}
      <div className="wfdrop" role="button" tabIndex={0} onClick={() => onUpload(proj.id)}
        onKeyDown={(e) => { if (e.key === 'Enter') onUpload(proj.id); }}>
        <b>Add files to {proj.name}</b> — they land in the room you pick, and every agent registered there can read them.
      </div>
      {shown && (shownSrc || shown.inline_content) && (
        <DocOverlay title={shown.name} file={{ name: shown.name, content: shown.inline_content ?? '' }} onClose={() => setOpenFile(null)}>
          {(shown.mime ?? '').startsWith('video/') && shownSrc
            ? <video className="mklibfull" src={shownSrc} controls autoPlay />
            : shownType === 'image'
              ? <img className="mklibfull" src={shownSrc ?? shown.inline_content!} alt={shown.name} />
              : shownType === 'html'
                ? <iframe className="apvframe" sandbox="allow-scripts" srcDoc={themedMockupDoc(shown.inline_content!)} title={shown.name} />
                : shownType === 'diff'
                  ? <DiffView text={shown.inline_content!} />
                  : shownType === 'markdown'
                    ? <div className="plBody"><Md text={shown.inline_content!} /></div>
                    : <pre className="mklibraw">{shown.inline_content}</pre>}
        </DocOverlay>
      )}
    </div>
  );
}
