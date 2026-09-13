// The boot surfaces — the splash before the workspace exists, and the phase spectrum
// (docs/24) that names where a task is. Extracted from App.tsx (track A4).
import { PorchMark, Wordmark } from '../brand';
import { type JourneyLeg } from '@neuramesh/shared';

// Neutral branded loader shown between sign-in and knowing where to route (main app vs the
// onboarding wizard) — so we never flash the app shell before redirecting. Stacked lockup
// (handoff §Lockups: splash/DMG/about); the mark + wordmark live in ./brand.
export function BootSplash({ stall }: { stall?: { tries: number; reason: string } | null }) {
  // Under ~5 failed polls this still reads as "loading", because most boots that take a moment do
  // succeed. Past that it is a stall, and saying so beats a bar that spins forever: the app is
  // waiting on something the user can actually check.
  const stuck = (stall?.tries ?? 0) >= 5;
  return (
    <div className="bootsplash">
      <div className="bootsplash-in">
        <PorchMark size={64} />
        <Wordmark size={19} mark={false} />
        <div className={`bootsplash-bar${stuck ? ' stalled' : ''}`}><i /></div>
        {stuck ? (
          <>
            <p>Can't reach your workspace.</p>
            <p className="bootsplash-why">
              Still retrying every 1.5s — {stall!.tries} attempts so far. If this is a local dev stack,
              its API may not be running.
            </p>
            <p className="bootsplash-why mono">{stall!.reason.slice(0, 160)}</p>
          </>
        ) : (
          <p>Getting your workspace ready…</p>
        )}
      </div>
    </div>
  );
}

// ── The phase spectrum (docs/24): a task's journey as a 4px whisper on a board card ──
// Derived (journeyFor) — done segments solid, the live one filled by the working agent's
// beats, the road ahead ghosted in its own hue, an unstaffed leg a dashed hollow; names in
// the native title. The PANEL variant is gone (v0.68): at that scale a full-width ribbon of
// colour outshouted the task's own title to say "leg 3 of 5", which PhaseRing now says in
// 30px with the whole journey on hover.
export function Spectrum({ legs }: { legs: JourneyLeg[] }) {
  if (legs.length < 2) return null;
  return (
    <div className="specwrap spec-card">
      <div className="spec">
        {legs.map((l) => (
          <span
            key={l.key}
            className={`seg ${l.status === 'done' ? 'segdone' : l.status === 'live' ? 'seglive' : l.status === 'gap' ? 'seggap' : ''}`}
            style={{ ['--segc' as never]: `var(${l.colorVar})` }}
            title={`${l.label}${l.owner ? ` · ${l.owner}` : ''}`}
          >
            {l.status === 'live' && <span className="segfill" style={{ width: `${Math.round((l.fill ?? 0.5) * 100)}%` }} />}
          </span>
        ))}
      </div>
    </div>
  );
}
