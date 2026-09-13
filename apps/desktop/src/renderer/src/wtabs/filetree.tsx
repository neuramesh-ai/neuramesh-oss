// The file tree beside the editor — a task's worktree, as a browsable list.
// Split out of wtabs/panes.tsx.
import { DiffView, previewType } from '../views/docpreview';
import { Md } from '../md/Md';
import { highlightCode } from '../lib/highlight';
import { nm as nmBridge } from '../bridge/nm';
import { tabCapabilities, type WTab, type WTabMode } from '../wtabs';
import { useEffect, useMemo, useRef, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export function FsNode({ root, rel, name, dir, depth, openPath, onOpen }: { root: string; rel: string; name: string; dir: boolean; depth: number; openPath: string; onOpen: (rel: string) => void }) {
  const [open, setOpen] = useState(depth === 0);
  const [kids, setKids] = useState<{ name: string; dir: boolean }[] | null>(null);
  useEffect(() => {
    if (dir && open && kids === null) void nm?.fsList(root, rel).then((r) => setKids(r?.entries ?? []));
  }, [dir, open, root, rel, kids]);
  if (!dir) {
    return (
      <button className={`ftfile${openPath === rel ? ' on' : ''}`} style={{ paddingLeft: 10 + depth * 13 }} onClick={() => onOpen(rel)} title={name}>
        <span className="ftdot" />{name}
      </button>
    );
  }
  return (
    <>
      {depth > 0 && (
        <button className="ftdir" style={{ paddingLeft: 10 + (depth - 1) * 13 }} onClick={() => setOpen((o) => !o)}>
          <span className={`ftcaret${open ? ' open' : ''}`}>▸</span>{name}
        </button>
      )}
      {open && kids?.map((k) => (
        <FsNode key={k.name} root={root} rel={rel ? `${rel}/${k.name}` : k.name} name={k.name} dir={k.dir} depth={depth + 1} openPath={openPath} onOpen={onOpen} />
      ))}
    </>
  );
}

/** `nm:fs-read` addresses a file relative to its root; a tab stores it absolute, because the absolute path IS its identity */
export const wtabRel = (root: string | null | undefined, path: string | null | undefined): string =>
  !path ? '' : root && path.startsWith(root) ? path.slice(root.length).replace(/^[/\\]/, '') : path;

export const wtabBase = (p: string): string => p.split(/[\\/]/).pop() || p;

export const wtabDir = (p: string): string => p.split(/[\\/]/).slice(0, -1).join(' / ');

/** what the ＋ flyout and the file pane are pointed at: the active tab's worktree, else the conversation's */
export type WScope = { root: string | null; label: string; taskId: string | null; taskNumber: number | null; hasRepo: boolean };

/** the bytes a tab shows when they came from the THREAD rather than from disk (an artifact, a plan, a brief) */
export type WDoc = { name: string; content: string; taskId?: string | null; taskNumber?: number | null };

// One renderer for a file tab, replacing the artifact overlay and the doc overlay both (docs/36
// §1). The render mode is per-FILE and lives on the record: `edit` is the only capability —
// `source` is a read, and a read-only artifact may always read its own raw bytes.
export function WFileView({ tab, doc, onMode, onDirty }: {
  tab: WTab; doc?: WDoc | null; onMode: (m: WTabMode) => void; onDirty: (dirty: boolean) => void;
}) {
  const caps = tabCapabilities(tab);
  const rel = wtabRel(tab.root, tab.path);
  const [file, setFile] = useState<{ content: string; truncated?: boolean; binary?: boolean } | null>(null);
  const [draft, setDraft] = useState('');
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErr, setSaveErr] = useState('');
  const timer = useRef<number | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const hlRef = useRef<HTMLPreElement>(null);
  const [reread, setReread] = useState(0);
  useEffect(() => {
    if (doc || !tab.path || !tab.root) return;
    let live = true;
    void nm?.fsRead(tab.root, rel).then((r) => { if (live) setFile(r ?? { content: '', binary: false }); });
    return () => { live = false; };
  }, [tab.root, tab.path, doc?.content, reread]);
  // a branch switch rewrites the bytes under every open file — without this the tab keeps showing
  // the branch it was opened on, which is the kind of quiet lie a file view must never tell
  useEffect(() => {
    const onFs = (e: Event) => {
      const root = (e as CustomEvent<{ root?: string }>).detail?.root;
      if (!root || root === tab.root) setReread((n) => n + 1);
    };
    window.addEventListener('nm:fs-changed', onFs);
    return () => window.removeEventListener('nm:fs-changed', onFs);
  }, [tab.root]);
  const content = doc?.content ?? file?.content ?? '';
  useEffect(() => { setDraft(content); setSave('idle'); }, [content]);
  const mode: WTabMode = tab.mode ?? (caps.canEdit ? 'edit' : 'preview');
  const type = previewType(tab.title, doc ? 'doc' : 'file', content);
  const editable = caps.canEdit && !!tab.path && !!tab.root && !file?.binary && !file?.truncated;
  const hl = useMemo(() => (mode === 'edit' && editable ? highlightCode(draft, rel) : ''), [mode, editable, draft, rel]);
  // Reading a file used to be the ONLY view without colour: highlighting hung off edit mode, so a
  // read-only artifact and a source view rendered as flat text. The language comes from the name,
  // which an artifact has even when it has no path on disk.
  const readHl = useMemo(() => highlightCode(content, rel || tab.title), [content, rel, tab.title]);
  const syncHl = () => { const t = taRef.current, h = hlRef.current; if (t && h) { h.scrollTop = t.scrollTop; h.scrollLeft = t.scrollLeft; } };
  useEffect(syncHl, [hl]);
  // ⌘S writes immediately. Autosave (600ms) still runs — this is the explicit act on top of it,
  // for the muscle memory every editor has trained, not a replacement for it.
  const saveNow = async (v: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    setSave('saving');
    const r = await nm?.fsWrite(tab.root!, rel, v);
    if (r?.ok) { setSave('saved'); onDirty(false); }
    else { setSave('error'); setSaveErr(r?.error ?? 'could not save'); }
  };
  const onEdit = (v: string) => {
    setDraft(v); setSave('saving'); onDirty(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const r = await nm?.fsWrite(tab.root!, rel, v);
      if (r?.ok) { setSave('saved'); onDirty(false); }
      else { setSave('error'); setSaveErr(r?.error ?? 'could not save'); }
    }, 600);
  };
  // the segment is relabelled by what the tab MAY do, over the same two reads of the same bytes:
  // Edit·Preview·Diff on a workspace file, Source·Preview on a read-only artifact (docs/36 §3.1)
  const modes: Array<[WTabMode, string]> = caps.canEdit
    ? [['edit', 'Edit'], ['preview', 'Preview'], ['diff', 'Diff']]
    : [['source', 'Source'], ['preview', 'Preview']];
  const imgSrc = content.startsWith('data:') ? content : `data:image/svg+xml;utf8,${encodeURIComponent(content)}`;
  return (
    <>
      <div className="wfhead">
        {(doc || tab.path) && <span className="wfpath">{doc ? `${doc.taskNumber != null ? `#${doc.taskNumber} ` : ''}artifacts /` : `${wtabDir(rel) || wtabBase(tab.root ?? '')} /`}</span>}
        <b className="wfname">{tab.title}</b>
        {tab.readOnly && <span className="wfro" title="an artifact is a record of what an agent produced, never an editing surface">READ-ONLY</span>}
        {save !== 'idle' && <span className={`wfsave${save === 'error' ? ' error' : ''}`}>{save === 'saving' ? 'saving…' : save === 'saved' ? 'saved ✓' : `save failed — ${saveErr}`}</span>}
        <div className="wfseg" role="group" aria-label="Render mode">
          {modes.map(([m, label]) => (
            <button key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => onMode(m)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="wfbody">
        {!content && !file && <div className="wfempty">Reading {tab.title}…</div>}
        {!content && file && <div className="wfempty">{file.binary ? 'Binary file — not shown.' : 'Empty file.'}</div>}
        {!!content && mode === 'edit' && editable && (
          <div className="codeeditwrap">
            <pre className="codehl" aria-hidden ref={hlRef}><code dangerouslySetInnerHTML={{ __html: hl + '\n' }} /></pre>
            <textarea ref={taRef} className="codeedit ghost" value={draft} spellCheck={false} onChange={(e) => onEdit(e.target.value)} onScroll={syncHl}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); e.stopPropagation(); void saveNow(draft); } }} />
          </div>
        )}
        {!!content && mode === 'edit' && !editable && <pre className="wfraw"><code dangerouslySetInnerHTML={{ __html: readHl }} /></pre>}
        {!!content && (mode === 'source' || (mode === 'preview' && type === 'raw')) && <pre className="wfraw"><code dangerouslySetInnerHTML={{ __html: readHl }} /></pre>}
        {!!content && mode === 'diff' && <DiffView text={content} />}
        {!!content && mode === 'preview' && type === 'diff' && <DiffView text={content} />}
        {!!content && mode === 'preview' && type === 'markdown' && <div className="wfmd plBody"><Md text={content} /></div>}
        {!!content && mode === 'preview' && type === 'image' && <div className="wfimg"><img src={imgSrc} alt={tab.title} /></div>}
        {!!content && mode === 'preview' && type === 'html' && (
          <iframe className="wfframe" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads" srcDoc={content} title={tab.title} />
        )}
      </div>
    </>
  );
}
