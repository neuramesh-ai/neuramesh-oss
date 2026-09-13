// The attachment lightbox — an image from a thread, full size.
// Extracted from App.tsx (track A3).
import { IconClose, IconFile } from '../ui/icons';
import { formatBytes } from '@neuramesh/shared';
import { nm as nmBridge } from '../bridge/nm';
import { type AttachmentRow } from '../bridge/rows-board';
import { useEffect, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export const isImageAtt = (a: { mime: string | null; kind: string }) => (a.mime ?? '').startsWith('image/') || a.kind === 'screenshot';

/** the expanded image's Save (article round, George: "open to expanded, download the image"):
 *  inline bytes save directly; local-protocol bytes are fetched — same-machine only, which is
 *  where they live by the chat-attachments local-bytes decision */
async function saveAtt(att: AttachmentRow): Promise<void> {
  let dataUrl = att.inline_content && att.inline_content.startsWith('data:') ? att.inline_content : null;
  if (!dataUrl) {
    const buf = await fetch(`nm-attachment://${att.id}`).then((r) => r.arrayBuffer()).catch(() => null);
    if (!buf) return;
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
    await nm?.saveFileAs({ name: att.name, content: btoa(bin), base64: true });
    return;
  }
  const m = /^data:[^;]+;base64,(.+)$/.exec(dataUrl);
  if (m) await nm?.saveFileAs({ name: att.name, content: m[1]!, base64: true });
}

export function AttachLightbox({ att, onClose }: { att: AttachmentRow; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="alightbox" onClick={onClose} role="dialog" aria-modal="true">
      <button type="button" className="alightboxclose" onClick={onClose} aria-label="Close"><IconClose s={18} /></button>
      <div className="alightboxinner" onClick={(e) => e.stopPropagation()}>
        {isImageAtt(att)
          ? <img className="alightboximg" src={`nm-attachment://${att.id}`} alt={att.name} onError={(e) => { if (att.inline_content) e.currentTarget.src = att.inline_content; }} />
          : <div className="alightboxfile"><IconFile s={56} /><div className="alightboxname">{att.name}</div></div>}
      </div>
      <div className="alightboxbar">
        {att.name}{att.size_bytes ? ` · ${formatBytes(att.size_bytes)}` : ''}
        {isImageAtt(att) && (
          <button type="button" className="alightboxsave" disabled={busy}
            onClick={(e) => { e.stopPropagation(); setBusy(true); void saveAtt(att).finally(() => setBusy(false)); }}>
            ⤓ Save
          </button>
        )}
      </div>
    </div>
  );
}
