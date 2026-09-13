// The thinking orb — the one animation that means 'an agent is working' (docs/26).
// Extracted from App.tsx so the views that show live work can use it without importing
// the shell back into a leaf.
import { useEffect, useState } from 'react';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';

// ── Thinking orbs (design round 2026-08-06, mockups/agent-stream-status) ─────────────────────
// The state IS the animation: thinking-orbs' dotted thought-orbs replace the generic spinner
// wherever an agent is alive. Strictly monochrome, plain 2D canvas, pauses offscreen. The
// library themes itself off data-theme="dark|light" — our values are theme NAMES (cream-oak,
// soft-dark), so we resolve dark-ness ourselves with the app's own idiom and pin it.
export function useOrbTheme(): 'dark' | 'light' {
  const read = () => ((document.documentElement.getAttribute('data-theme') ?? 'dark').includes('dark') ? 'dark' : 'light') as 'dark' | 'light';
  const [mode, setMode] = useState<'dark' | 'light'>(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setMode(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return mode;
}

export function Orb({ state, size = 20, label }: { state: OrbState; size?: 20 | 64; label?: string }) {
  return <ThinkingOrb state={state} size={size} theme={useOrbTheme()} aria-label={label} className="orb" />;
}
