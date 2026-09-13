// The on/off switch — extracted from App.tsx (track A3).

// Agent Skills (W11): channel + global reusable procedures. Humans author here;
// agents load them during execution via load_skill. Searchable + previewable.
// a clean on/off switch — reused for whole packs and individual skills
export function Switch({ on, onToggle, sm, title }: { on: boolean; onToggle: () => void; sm?: boolean; title?: string }) {
  return (
    <button
      type="button"
      className={`nmsw${sm ? ' sm' : ''}`}
      role="switch"
      aria-checked={on}
      title={title ?? (on ? 'on — discoverable by agents' : 'off — hidden from agents')}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    />
  );
}
