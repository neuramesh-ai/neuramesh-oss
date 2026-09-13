// Attachments — picking files, the tray that shows them, and the whiteboard pill that
// rides along. Shared by every composer surface (the launcher and the new-chat stage).
// Extracted from App.tsx (track A2).
import { IconClose, IconFile, IconPaperclip, IconWhiteboard } from '../ui/icons';
import { attachmentLimits, attachmentUpgradeReason, formatBytes, whiteboardShareBody } from '@neuramesh/shared';
import { nm as nmBridge } from '../bridge/nm';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// ── Chat attachments (compose side) ───────────────────────────────────────────
// A file being attached to a draft message. Bytes are staged locally the moment it's added
// (real upload progress from the file read); the row is written on send.
export interface AttachItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  isImage: boolean;
  url: string; // object URL for instant preview
  status: 'staging' | 'ready' | 'error';
  progress: number; // 0..1
  width?: number | null;
  height?: number | null;
}

export function readFileWithProgress(file: File, onProgress: (p: number) => void): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsArrayBuffer(file);
  });
}

// Manages a composer's pending attachments: cap enforcement (→ upgrade), staging with progress,
// preview URLs, and a stable per-draft message id so the rows link to the message on send.
export function useAttachments(plan: string, onUpgrade: (reason: string) => void) {
  const [items, setItems] = useState<AttachItem[]>([]);
  const itemsRef = useRef<AttachItem[]>([]);
  itemsRef.current = items;
  const msgIdRef = useRef<string>(crypto.randomUUID());
  const limits = attachmentLimits(plan);

  const patch = useCallback((id: string, p: Partial<AttachItem>) => {
    setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }, []);

  const stage = useCallback(async (item: AttachItem, file: File) => {
    if (!nm) return;
    try {
      const buf = await readFileWithProgress(file, (p) => patch(item.id, { progress: Math.min(0.95, p) }));
      const res = await nm.attachStage(item.id, item.name, item.mime, buf);
      patch(item.id, { status: 'ready', progress: 1, width: res.width, height: res.height });
    } catch {
      patch(item.id, { status: 'error', progress: 1 });
    }
  }, [patch]);

  const addFiles = useCallback((files: File[]) => {
    if (!nm || !files.length) return;
    const room = limits.maxPerMessage - itemsRef.current.length;
    if (room <= 0) { onUpgrade(attachmentUpgradeReason('count')); return; }
    const accepted: File[] = [];
    let overCount = false, overSize = false;
    for (const f of files) {
      if (accepted.length >= room) { overCount = true; break; }
      if (f.size > limits.maxBytes) { overSize = true; continue; }
      accepted.push(f);
    }
    const fresh: AttachItem[] = accepted.map((f) => ({
      id: crypto.randomUUID(),
      name: f.name || 'file',
      mime: f.type || 'application/octet-stream',
      size: f.size,
      isImage: (f.type || '').startsWith('image/'),
      url: URL.createObjectURL(f),
      status: 'staging',
      progress: 0,
    }));
    if (fresh.length) { setItems((cur) => [...cur, ...fresh]); fresh.forEach((it, i) => void stage(it, accepted[i]!)); }
    if (overCount) onUpgrade(attachmentUpgradeReason('count'));
    else if (overSize) onUpgrade(attachmentUpgradeReason('size'));
  }, [limits, onUpgrade, stage]);

  const remove = useCallback((id: string) => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (it) URL.revokeObjectURL(it.url);
    setItems((cur) => cur.filter((x) => x.id !== id));
    void nm?.attachDiscard(id);
  }, []);

  const reset = useCallback(() => {
    itemsRef.current.forEach((it) => URL.revokeObjectURL(it.url));
    setItems([]);
    msgIdRef.current = crypto.randomUUID();
  }, []);

  // ready specs (for send) + the stable draft message id, both read before reset() clears them
  const specs = useCallback(() => itemsRef.current.filter((it) => it.status === 'ready').map((it) => ({ id: it.id, name: it.name, mime: it.mime })), []);

  return { items, addFiles, remove, reset, specs, msgId: () => msgIdRef.current, count: items.length, busy: items.some((it) => it.status === 'staging'), limits };
}

export function AttachTray({ items, onRemove }: { items: AttachItem[]; onRemove: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="atray">
      {items.map((it) =>
        it.isImage ? (
          <div key={it.id} className={`atile${it.status === 'error' ? ' aerr' : ''}`} title={`${it.name} · ${formatBytes(it.size)}`}>
            <img src={it.url} alt={it.name} draggable={false} />
            {it.status === 'staging' && <div className="aprog"><span style={{ width: `${Math.round(it.progress * 100)}%` }} /></div>}
            {it.status === 'error' && <span className="abadge">!</span>}
            <button type="button" className="aremove" title="Remove" onClick={() => onRemove(it.id)}><IconClose s={11} /></button>
          </div>
        ) : (
          <div key={it.id} className={`achip${it.status === 'error' ? ' aerr' : ''}`} title={`${it.name} · ${formatBytes(it.size)}`}>
            <span className="achipic"><IconFile s={16} /></span>
            <span className="achipinfo"><span className="achipname">{it.name}</span><span className="achipsub">{it.status === 'error' ? 'failed' : formatBytes(it.size)}</span></span>
            {it.status === 'staging' && <div className="aprog"><span style={{ width: `${Math.round(it.progress * 100)}%` }} /></div>}
            <button type="button" className="aremove" title="Remove" onClick={() => onRemove(it.id)}><IconClose s={11} /></button>
          </div>
        ),
      )}
    </div>
  );
}

// ── Share-to-chat staging (docs/38, amended in live review 2026-08-05) ───────────────────────
// Share ATTACHES the board to the composer as a pill instead of posting a bare card: the human
// writes their line and ONE message carries note + label + ‹wb:id› marker. Module-scope store
// (not App state) so every composer — Home launcher, room, conversation, task thread — reads
// the same staged board through the shared AttachButton they all already render.
export const wbAttachStore = { v: null as null | { id: string; title: string }, subs: new Set<() => void>() };

export function setWbAttach(v: { id: string; title: string } | null): void {
  wbAttachStore.v = v;
  wbAttachStore.subs.forEach((f) => f());
}

export function useWbAttach(): { id: string; title: string } | null {
  return useSyncExternalStore(
    (cb) => { wbAttachStore.subs.add(cb); return () => wbAttachStore.subs.delete(cb); },
    () => wbAttachStore.v,
  );
}

/** Fold the staged board into an outgoing body (and clear the pill) — a no-op when none is staged. */
export function consumeWbAttach(body: string): string {
  const a = wbAttachStore.v;
  if (!a) return body;
  setWbAttach(null);
  return whiteboardShareBody(a.title, a.id, body);
}

export function WbAttachPill(): React.JSX.Element | null {
  const a = useWbAttach();
  if (!a) return null;
  return (
    <span className="wbattachpill" data-tip="This board rides your next send">
      <IconWhiteboard s={11} />
      <span className="t">{a.title}</span>
      <button type="button" aria-label="Detach the whiteboard" onClick={() => setWbAttach(null)}>✕</button>
    </span>
  );
}

export function AttachButton({ onFiles, count, max, includeWhiteboard = true }: { onFiles: (files: File[]) => void; count: number; max: number; includeWhiteboard?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" multiple style={{ display: 'none' }} onChange={(e) => { if (e.target.files) onFiles(Array.from(e.target.files)); e.currentTarget.value = ''; }} />
      {includeWhiteboard ? <WbAttachPill /> : null}
      <button type="button" className="attachbtn" data-tip="Attach images or files" aria-label="Attach images or files" onClick={() => ref.current?.click()}><IconPaperclip s={16} /></button>
      {count > 0 && <span className="attachcount" data-tip={`${count} of ${max} attachments`}>{count}/{max}</span>}
    </>
  );
}
