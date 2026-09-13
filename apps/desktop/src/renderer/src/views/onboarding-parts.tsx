// Model picking during first run, and the workspace name we suggest.
// Split out of views/Onboarding.tsx.
import { ProviderLogo } from '../brain/providers';
import { modelLabel, providerIdForModel } from '../lib/models';
import { type ProviderId } from '../bridge/rows-infra';
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// A design-system model picker: the trigger shows the provider mark + model; the popup groups
// models by provider with a search field up top (scales as more models/providers land).
export function ModelPicker({ value, groups, onChange }: { value: string; groups: Array<{ providerId: ProviderId; provider: string; models: string[] }>; onChange: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  /**
   * PORTALLED, because a card that can become a stacking context will swallow it.
   *
   * This bit twice. First the entrance animation's fill-mode left an identity transform on every
   * crew card forever; that was fixed, and the menu STILL rendered behind the card below —
   * because `.obcrewcard:hover` applies `translateY(-1px)`, and you are always hovering the card
   * whose menu you just opened. A transform is a transform: either one traps the popover in its
   * card, where a later sibling paints over it, and no z-index inside can escape.
   *
   * So it leaves the tree entirely (docs/33 §9.6, the idiom the nav popovers already follow).
   * That is immune to the next stacking context someone adds — a filter, a contain, a
   * will-change — rather than being one more patch that holds until it does not.
   *
   * The anchor is TRACKED while open, not measured once: the trigger moves when the card lifts
   * on hover, and a card that lifts under a card-relative measurement strands the menu by a pixel
   * at best and a scroll at worst.
   */
  useLayoutEffect(() => {
    if (!open) { setPlace(null); return; }
    let raf = 0;
    const track = () => {
      const anchor = ref.current, pop = popRef.current;
      if (anchor && pop) {
        const r = anchor.getBoundingClientRect(), PAD = 8;
        const w = pop.offsetWidth, h = pop.offsetHeight;
        // right-aligned to the trigger, matching the in-card design, then clamped so a card near
        // an edge cannot push the menu off screen
        const left = Math.max(PAD, Math.min(r.right - w, window.innerWidth - w - PAD));
        const below = r.bottom + 6;
        const top = below + h + PAD <= window.innerHeight ? below : Math.max(PAD, r.top - h - 6);
        setPlace((p) => (p && p.left === left && p.top === top ? p : { left, top }));
      }
      raf = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // the menu is no longer inside `ref`, so an outside-click test that only asks about the
    // trigger would close it the instant you clicked an option
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const needle = q.trim().toLowerCase();
  const filtered = groups
    .map((g) => ({ ...g, models: g.models.filter((m) => !needle || m.toLowerCase().includes(needle) || modelLabel(m).toLowerCase().includes(needle)) }))
    .filter((g) => g.models.length > 0);
  return (
    <div className="obmodel" ref={ref}>
      <button type="button" className="obmodelbtn" onClick={() => setOpen((o) => !o)}>
        <ProviderLogo id={providerIdForModel(value)} s={15} />
        <span className="obmodellbl">{modelLabel(value)}</span>
        <span className="obmodelcar">▾</span>
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          className="obmodelpop"
          style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
        >
          <div className="obmodelsearch">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models…" />
          </div>
          <div className="obmodellist">
            {filtered.length === 0 && <div className="obmodelempty">No models match.</div>}
            {filtered.map((g) => (
              <div key={g.providerId} className="obmodelgrp">
                <div className="obmodelgrphd"><ProviderLogo id={providerIdForModel(g.models[0] ?? '')} s={13} /> {g.provider}</div>
                {g.models.map((m) => (
                  <button key={m} type="button" className={`obmodelopt${m === value ? ' on' : ''}`} onClick={() => { onChange(m); setOpen(false); setQ(''); }}>
                    <span>{modelLabel(m)}</span>
                    {m === value && <span className="obmodelck">✓</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// The suggested-name helper lives in @neuramesh/shared (onboarding-wizard.ts, the mobile-cloud
// round S6) so the phone's Workspace step draws from the same list; re-exported for the callers.
export { WS_ADJ, WS_NOUN, randomWorkspaceName } from '@neuramesh/shared';
