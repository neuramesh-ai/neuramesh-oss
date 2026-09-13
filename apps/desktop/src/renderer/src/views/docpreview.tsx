// Document preview — how a workspace file is shown once opened: a unified-diff renderer,
// the overlay frame, and the sniffing that decides which of the two you get.
// Split out of views/WorkspaceFiles.tsx.
import { DIFF_BADGE, baseName, parseDiffFiles, type DiffFile } from '../review/diff';
import { IconDownload } from '../ui/icons';
import { createPortal } from 'react-dom';
import { nm as nmBridge } from '../bridge/nm';
import { useEffect, useMemo, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Render one file's hunks with a line-number gutter; file-meta lines are hidden (the file is named in
// the header), and each hunk seeds the counter from its `@@ +newStart` so the numbers track the file.
export function DiffLines({ lines }: { lines: string[] }) {
  const rows: Array<{ no: number | null; cls: string; text: string }> = [];
  let n = 0;
  for (const line of lines) {
    if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity |rename |Binary )/.test(line)) continue;
    const hm = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
    if (hm) { n = parseInt(hm[1]!, 10); rows.push({ no: null, cls: 'hunk', text: line }); continue; }
    const cls = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : '';
    rows.push({ no: n, cls, text: line }); n++;
  }
  return (
    <pre className="diffcode">
      {rows.map((r, j) => (
        <div key={j} className={`dline ${r.cls}`}>
          <span className="dlno">{r.no ?? ''}</span>
          <span className="dltext">{r.text || ' '}</span>
        </div>
      ))}
    </pre>
  );
}

// Master-detail diff: a file list on the left (name + add/del stats, click to select), the selected
// file's diff on the right with a line-number gutter — instead of one undifferentiated blob.
export function DiffView({ text }: { text: string }) {
  const files = useMemo(() => parseDiffFiles(text), [text]);
  const [sel, setSel] = useState(0);
  useEffect(() => { setSel((s) => (s < files.length ? s : 0)); }, [files.length]);
  if (!files.length) return <pre className="diffview"><div className="dline">{text || '(empty diff)'}</div></pre>;
  const i = Math.min(sel, files.length - 1);
  const f = files[i]!;
  const stat = (file: DiffFile) => <span className="diffstat"><span className="add">+{file.adds}</span> <span className="del">−{file.dels}</span></span>;
  return (
    <div className="diff2">
      <div className="diffnav">
        <div className="diffnavhd">Files · {files.length}</div>
        {files.map((file, k) => (
          <button key={k} className={`diffnavitem${k === i ? ' on' : ''}`} onClick={() => setSel(k)} title={file.path}>
            <span className={`diffbadge ${file.change}`}>{DIFF_BADGE(file.change)}</span>
            <span className="diffnavpath">{baseName(file.path)}</span>
            {stat(file)}
          </button>
        ))}
      </div>
      <div className="diffpane">
        <div className="diffpanehd"><span className={`diffbadge ${f.change}`}>{DIFF_BADGE(f.change)}</span><span className="diffpanepath" title={f.path}>{f.path}</span>{stat(f)}</div>
        <DiffLines lines={f.lines} />
      </div>
    </div>
  );
}

// One doc reader for the whole marketing surface (round 5): a veiled, centered overlay —
// the library opens into it and a chat doc-card expands into it. Content wears .plBody so
// the plan's beautiful-md typography applies verbatim.
export function DocOverlay({ title, onClose, children, file }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** the bytes behind what is on screen — gives the overlay its download control (2026-08-18).
   *  An artifact opened from a thread was readable and un-saveable; this is the same one-click
   *  save the Files destination grew, on the surface you are actually reading it in. */
  file?: { name: string; content: string } | null;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  // Portalled for the same reason as PostPreviewModal: this opens from a doc card INSIDE the
  // conversation sheet, and a `position: fixed` veil only reaches the viewport while nothing up
  // the chain establishes a containing block.
  return createPortal(
    <div className="mkdocovl" role="dialog" aria-label={title} onClick={onClose}>
      <div className="mkdocpanel" onClick={(e) => e.stopPropagation()}>
        <div className="mkdocpanelhead">
          <b>{title}</b>
          {file && (
            <button className="mkdocdl" title={`Download ${file.name}`} aria-label={`Download ${file.name}`}
              onClick={() => { const d = file.content.startsWith('data:');
                void nm?.saveFileAs({ name: file.name, content: d ? file.content.slice(file.content.indexOf(',') + 1) : file.content, base64: d }); }}>
              <IconDownload s={14} />
            </button>
          )}
          <button className="mkppx" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="mkdocpanelbody">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export type PreviewType = 'html' | 'image' | 'markdown' | 'diff' | 'raw';

export function previewType(name: string, kind: string, content: string): PreviewType {
  if (kind === 'screenshot' || /\.(png|jpe?g|gif|webp|svg)$/i.test(name) || content.startsWith('data:image')) return 'image';
  if (/\.html?$/i.test(name) || /^\s*<!doctype html|^\s*<html[\s>]/i.test(content)) return 'html';
  if (kind === 'diff' || /\.(diff|patch)$/i.test(name) || content.startsWith('diff --git')) return 'diff';
  if (/\.(md|markdown)$/i.test(name) || (kind === 'doc' && !/\.[a-z]+$/i.test(name))) return 'markdown';
  return 'raw';
}
