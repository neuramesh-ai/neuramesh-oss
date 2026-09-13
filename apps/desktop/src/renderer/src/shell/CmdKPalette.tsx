// ⌘K — the launcher palette's rows. Extracted from App.tsx (track A4).
import { useEffect, useRef, useState } from 'react';

// ── ⌘K quick actions (docs/12 slice 3): one keystroke from anywhere to the thing
// that needs you — fan out, accept what's ready, answer a decision, jump to a
// task/channel/view. Items derive from live synced state and reuse the exact
// seams the views call (taskAction / openTask / nav setters), so the palette can
// never do something the UI couldn't.
export interface CmdItem {
  group: string;
  icon: React.ReactNode;
  label: string;
  sub?: string;
  run: () => void;
}

export function CmdKPalette({ items, onClose }: { items: CmdItem[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, []);
  const needle = q.trim().toLowerCase();
  const filtered = needle ? items.filter((c) => `${c.group} ${c.label} ${c.sub ?? ''}`.toLowerCase().includes(needle)) : items;
  const pick = (i: number) => {
    const c = filtered[i];
    if (!c) return;
    onClose();
    c.run();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
  };
  const rows: React.ReactNode[] = [];
  let lastGroup = '';
  filtered.forEach((c, i) => {
    if (c.group !== lastGroup) {
      rows.push(<div key={`g-${c.group}`} className="cmdkgroup">{c.group}</div>);
      lastGroup = c.group;
    }
    rows.push(
      <div key={`i-${i}`} className={`cmdkitem${i === sel ? ' sel' : ''}`} onClick={() => pick(i)} onMouseEnter={() => setSel(i)}>
        <span className="cmdkico">{c.icon}</span>
        <span className="cmdklab"><b>{c.label}</b>{c.sub ? <span>{c.sub}</span> : null}</span>
      </div>,
    );
  });
  return (
    <div className="cmdk" onClick={(e) => e.target === e.currentTarget && onClose()} onKeyDown={onKey}>
      <div className="cmdkpal" role="dialog" aria-label="Quick actions">
        <div className="cmdkin">
          <span className="cmdkglyph">⌘</span>
          <input ref={inputRef} value={q} placeholder="Fan out a task, accept a PR, jump anywhere…" onChange={(e) => { setQ(e.target.value); setSel(0); }} />
          <span className="cmdkesc">esc</span>
        </div>
        <div className="cmdklist">{rows.length ? rows : <div className="cmdkgroup">No matches</div>}</div>
      </div>
    </div>
  );
}
