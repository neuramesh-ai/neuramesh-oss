// The chip menu — the small anchored popover every pill in the shell opens.
// Extracted from App.tsx (track A2).
import { useEffect, useRef, useState } from 'react';

// A composer-row chip that opens the composer-popover pattern upward — the same
// look as the main composer's project/brain chips, for any small pick list.
export function ChipMenu({ icon, label, title, options, value, onPick }: {
  icon: string; label: string; title: string;
  options: { value: string; label: string }[];
  value: string; onPick: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  return (
    <div className="cchips" ref={ref}>
      <button className={`cchip${open ? ' open' : ''}`} title={title} onClick={() => setOpen((v) => !v)}>
        {/* `.lbl` is what `.cchip .lbl` ellipsises. Without it a long label blew past the
            190px max-width and shoved the chevron OUTSIDE the pill's border — the rule existed,
            the markup just never opted in (found on the Compute default, 2026-08-13). */}
        <span className="chipico">{icon}</span> <span className="lbl">{label}</span> <span className="cc">⌄</span>
      </button>
      {open && (
        <div className="chippop">
          {options.map((o) => (
            <button key={o.value} className={`chippopitem${o.value === value ? ' on' : ''}`}
              onClick={() => { onPick(o.value); setOpen(false); }}>
              {o.label}
              {o.value === value && <span className="chippopchk">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
