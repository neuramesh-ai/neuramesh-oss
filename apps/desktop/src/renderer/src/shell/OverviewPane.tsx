// THE OVERVIEW TAB (the side-panel round, 2026-10-03) — the session's own sections, in its own tab
// of the side panel. It was the Workbench card's Details face: the same sections, the same rule (a
// section renders only when it has rows), the same portal. The session that owns them (TaskThread ·
// ConvoThread · the room home) portals its `RailSections` into the slot, so this pane never holds
// their state. The slot keeps `.mkrail`, so every section recipe still applies.
//
// The empty line under it is CSS-gated on the slot being childless: only the portalling surface
// knows whether it has anything to say. It names what lands here, one row per kind, staggered in
// (`--dur-enter` per row, ~70ms apart, inside the 150ms motion budget of docs/33 §7). Nothing in it
// is a control: the doing happens where it already happens.
import { IconFile, IconPost, IconReview } from '../ui/icons';

const ROWS: Array<{ icon: React.ReactNode; head: string; sub: string }> = [
  { icon: <IconReview s={14} />, head: 'Plans and reviews', sub: 'A plan, a design round or a release plan, with the verdict.' },
  { icon: <IconFile s={14} />, head: 'Files', sub: 'Reports, pages, images and tables that a run writes.' },
  { icon: <IconPost s={14} />, head: 'Drafts', sub: 'Posts and articles, with their previews.' },
];

export function OverviewPane({ slotRef }: { slotRef: (el: HTMLDivElement | null) => void }) {
  return (
    <div className="ovpane" aria-label="Overview">
      <div className="wbslot mkrail" ref={slotRef} />
      <div className="wbslotempty" role="note">
        <p className="wbez">What this session makes opens here.</p>
        <ul className="wbelist">
          {ROWS.map((r, i) => (
            // the delay rides a custom property rather than inline `animationDelay`, so the whole
            // stagger collapses to nothing under prefers-reduced-motion with one CSS rule
            <li key={r.head} style={{ ['--i' as string]: i }}>
              <span className="wbeic" aria-hidden>{r.icon}</span>
              <span className="wbetx"><b>{r.head}</b>{r.sub}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
