// The select + role picker — extracted from App.tsx (track A3).
import { useEffect, useRef, useState } from 'react';

export const AGENT_ROLES = [
  { value: 'orchestrator', label: 'Orchestrator', desc: 'Runs intake, plans, and assigns work' },
  { value: 'architect', label: 'Architect', desc: 'Drafts implementation plans (mixture-of-agents)' },
  { value: 'developer', label: 'Developer', desc: 'Claims and executes tasks' },
  { value: 'reviewer', label: 'Reviewer', desc: 'Reviews submitted work' },
  { value: 'designer', label: 'Designer', desc: 'Studies the design system, drafts mockups for approval' },
  { value: 'shipper', label: 'Shipper', desc: 'Release-readiness plans; coordinates the merge gate' },
  { value: 'sales', label: 'Sales', desc: 'Channel collaborator' },
] as const;

// Rich single-select: each option is a role name with its purpose as subtext —
// a native <select> can't style two-line options, so this is a custom dropdown.
export function RoleSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const cur = AGENT_ROLES.find((r) => r.value === value) ?? AGENT_ROLES[0];
  return (
    <div className="rsel" ref={ref}>
      <button type="button" className="rselbtn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="rseltxt"><span className="rselname">{cur.label}</span><span className="rseldesc">{cur.desc}</span></span>
        <span className="rselcaret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="rseldrop" role="listbox">
          {AGENT_ROLES.map((r) => (
            <div key={r.value} role="option" aria-selected={r.value === value} className={`rselopt${r.value === value ? ' on' : ''}`}
              onClick={() => { onChange(r.value); setOpen(false); }}>
              <span className="rselcheck">{r.value === value ? '✓' : ''}</span>
              <span className="rseltxt"><span className="rselname">{r.label}</span><span className="rseldesc">{r.desc}</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Themed single-select dropdown — replaces native <select> everywhere. Compact trigger +
// design-system popup; gets a search field when the list is long (or when `searchable`).
// Options may carry a `group` (renders provider/section headers) and a `sub` (two-line option).
export type SelectOption = { value: string; label: string; sub?: string; group?: string };

export function Select({ value, options, onChange, searchable, placeholder, title, width }: {
  value: string;
  options: ReadonlyArray<SelectOption>;
  onChange: (v: string) => void;
  searchable?: boolean;
  placeholder?: string;
  title?: string;
  width?: number | string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  const cur = options.find((o) => o.value === value);
  const useSearch = searchable ?? options.length > 7;
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle) || (o.sub ?? '').toLowerCase().includes(needle))
    : options;
  const groups = [...new Set(options.map((o) => o.group).filter(Boolean) as string[])];
  const renderOpt = (o: SelectOption) => (
    <button key={o.value} type="button" role="option" aria-selected={o.value === value} className={`nmselopt${o.value === value ? ' on' : ''}`} onClick={() => { onChange(o.value); setOpen(false); setQ(''); }}>
      <span className="nmseltxt"><span className="nmsellbl2">{o.label}</span>{o.sub && <span className="nmselsub">{o.sub}</span>}</span>
      {o.value === value && <span className="nmselck">✓</span>}
    </button>
  );
  return (
    <div className="nmsel" ref={ref} style={width ? { width } : undefined}>
      <button type="button" className="nmselbtn" onClick={() => setOpen((o) => !o)} title={title} aria-haspopup="listbox" aria-expanded={open}>
        <span className="nmsellbl">{cur?.label ?? placeholder ?? 'Select…'}</span>
        <span className="nmselcar">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="nmselpop" role="listbox">
          {useSearch && <div className="nmselsearch"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" /></div>}
          <div className="nmsellist">
            {filtered.length === 0 && <div className="nmselempty">No matches.</div>}
            {groups.length > 0
              ? groups.map((g) => <div key={g} className="nmselgrp"><div className="nmselgrphd">{g}</div>{filtered.filter((o) => o.group === g).map(renderOpt)}</div>)
              : filtered.map(renderOpt)}
          </div>
        </div>
      )}
    </div>
  );
}
