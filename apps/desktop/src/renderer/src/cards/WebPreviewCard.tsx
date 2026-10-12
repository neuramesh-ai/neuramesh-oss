import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WebPreview } from '@neuramesh/shared';
import { openPreviewLink } from '../lib/links';
import { Popover } from '../ui/Popover';
import { IconExternal, IconGlobe } from '../ui/icons';

/** A durable link in the reply, not an embedded page or an availability claim. */
export function WebPreviewCard({ preview }: { preview: WebPreview }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const close = () => { setAnchor(null); trigger.current?.focus(); };
  const pick = (where: 'inapp' | 'external') => { close(); openPreviewLink(preview.url, where); };
  const destination = new URL(preview.url);
  return <section className="webpreview" aria-label={`Web preview: ${preview.title}`}>
    <button type="button" className="webpreview-main" onClick={() => pick('inapp')} aria-label={`Open ${preview.title} in NeuraMesh browser`}>
      <span className="webpreview-icon" aria-hidden><IconGlobe s={20} /></span>
      <span className="webpreview-info">
        <strong>{preview.title}</strong>
        <span className="webpreview-url" title={preview.url}>Website · {destination.host}{destination.pathname === '/' ? '' : destination.pathname}</span>
        {preview.description && <span className="webpreview-description">{preview.description}</span>}
      </span>
    </button>
    <button type="button" className="webpreview-open" ref={trigger} aria-haspopup="dialog" aria-expanded={!!anchor} aria-label={`Open ${preview.title} in…`} onClick={() => {
      const box = trigger.current!.getBoundingClientRect();
      setAnchor(anchor ? null : { x: box.right, y: box.bottom });
    }}>Open in <span aria-hidden>⌄</span></button>
    {anchor && createPortal(<Popover label={`Open ${preview.title}`} anchor={anchor} width={250} align="end" onClose={close} className="webpreview-options">
      <button type="button" autoFocus onClick={() => pick('inapp')}><IconGlobe s={16} />NeuraMesh browser</button>
      <button type="button" onClick={() => pick('external')}><IconExternal s={16} />External browser</button>
    </Popover>, document.body)}
  </section>;
}
