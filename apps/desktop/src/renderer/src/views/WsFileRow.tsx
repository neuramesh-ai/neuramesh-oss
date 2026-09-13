// One row of the Workspace Files table — and the two things you can now do to a file (2026-08-18).
//
// Split out of WorkspaceFiles.tsx, which the size ratchet stopped at 250 lines. That is the right
// seam regardless: the table is a LIST, and a row that owns a save dialog, a two-tap delete and a
// gate refusal is a component with its own behaviour rather than markup in a map.
import { IconCheck, IconChevron, IconDownload, IconLock, IconTrash } from '../ui/icons';
import { WsFileIcon, type WsFile } from './WorkspaceFiles';
import { fileTag, formatBytes, gateArtifactReason, isGateArtifact } from '@neuramesh/shared';
import { nm as nmBridge } from '../bridge/nm';
import { useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

/** `data:` content is bytes (a screenshot, an uploaded PNG) — it must go as base64 or it corrupts. */
function payload(f: WsFile): { name: string; content: string; base64: boolean } {
  const raw = f.inline_content ?? '';
  const data = raw.startsWith('data:');
  return { name: f.name, content: data ? raw.slice(raw.indexOf(',') + 1) : raw, base64: data };
}

export function WsFileRow({ f, open, onToggle, onOpenRoom }: {
  f: WsFile;
  open: boolean;
  onToggle: () => void;
  onOpenRoom?: (channelId: string) => void;
}) {
  const [saved, setSaved] = useState(false);
  const [ask, setAsk] = useState(false);
  const [err, setErr] = useState('');
  // The bytes are already here — `inline_content` rides the synced row — so saving never refetches
  // and works offline. The app could always take a file IN and never hand one back.
  const download = async () => {
    const r = await nm?.saveFileAs(payload(f));
    if (r?.saved) { setSaved(true); setTimeout(() => setSaved(false), 1800); }
  };
  // The REFUSAL is the server's (`isGateArtifact`); this hides the control from the same predicate
  // so the button is never a promise the server breaks. NO manual reload after a delete —
  // `libraryAll` is a live PowerSync watch, so the row leaves on its own.
  const del = async () => {
    setErr('');
    try { await nm?.artifactDelete(f.id); setAsk(false); }
    catch (e) { setErr(e instanceof Error ? e.message : 'could not delete that'); }
  };
  const locked = isGateArtifact({ kind: f.kind, name: f.name });
  return (
    <div className={`wftr${open ? ' on' : ''}`} role="button" tabIndex={0} title={f.name}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
      <span className="wfic"><WsFileIcon f={f} /></span>
      <span className="wfnm">
        {f.name}
        {f.promoted && <span className="wfstar" title="curated onto the shelf by a human">★</span>}
        {f.source === 'task' && f.task_number ? <span className="wfsrc">#{f.task_number}</span> : null}
        {f.source === 'chat' ? <span className="wfsrc">in chat</span> : null}
        {/* a refused delete used to fail SILENTLY — the server's message says which gate, so it
            is worth the row's width rather than a console line */}
        {err && <span className="wfkillerr">{err}</span>}
      </span>
      <span className="wftype">{fileTag(f.name, f.kind)}</span>
      <span className="wfmeta">{f.size ? formatBytes(f.size) : ''}</span>
      <span className="wfroom2">
        {f.channel_slug
          ? <button onClick={(e) => { e.stopPropagation(); onOpenRoom?.(f.channel_id); }}>#{f.channel_slug}</button>
          : null}
      </span>
      <span className="wfmeta">{new Date(f.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
      <span className="wfacts">
        <button className="wfact" title={saved ? 'Saved' : `Download ${f.name}`} aria-label={`Download ${f.name}`}
          onClick={(e) => { e.stopPropagation(); void download(); }}>
          {saved ? <IconCheck s={13} /> : <IconDownload s={13} />}
        </button>
        {/* the control does not EXIST for a file a gate stands on — the reason rides the tooltip,
            so it reads as a rule rather than a button someone forgot */}
        {locked
          ? <span className="wfact locked" title={gateArtifactReason({ kind: f.kind, name: f.name })} aria-label="This file stays with its task"><IconLock s={12} /></span>
          : ask
            ? <button className="wfact danger" title="Delete — sure?" aria-label={`Delete ${f.name} — confirm`}
                onClick={(e) => { e.stopPropagation(); void del(); }}><IconCheck s={13} /></button>
            : <button className="wfact" title={`Delete ${f.name}`} aria-label={`Delete ${f.name}`}
                onClick={(e) => { e.stopPropagation(); setErr(''); setAsk(true); setTimeout(() => setAsk(false), 2600); }}><IconTrash s={13} /></button>}
      </span>
      <span className="wfchev" aria-hidden><IconChevron s={13} /></span>
    </div>
  );
}
