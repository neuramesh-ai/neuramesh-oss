import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { App } from './App';
import { LaunchPeek } from './brand';
import { nm, setBridgeReady } from './bridge/nm';
import { attachDesktopRelay } from './bridge/desktop-relay';
// Self-hosted Geist (display + UI) + Geist Mono (terminal, code, kickers), the Foundry pair
// (italic flourish) + Bricolage Grotesque (the `neuramesh` wordmark) — bundled by
// Vite, served from 'self' (local-first: no font CDN, works offline, strict CSP).
import '@neuramesh/fonts/neuramesh-sans.css';
import '@fontsource-variable/geist-mono/wght.css';
import '@fontsource-variable/bricolage-grotesque/wght.css';
import './tokens.css';

/**
 * THE SHELL, keyed to the foreground connection (main/connections.ts). A workspace switch used to
 * RELAUNCH the app because every handler had captured one backend at boot; the handlers read the
 * foreground connection at call time now, so main flips its pointer and pushes `nm:foreground`,
 * and the shell remounts against the new one here — every watch re-subscribes, every read lands on
 * the right replica, and the ~2s restart is gone. The view-switch budget (<100ms) is what this
 * remount has to meet; main prints the swap's own time as `foreground_swap`.
 */
function Shell() {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => nm?.onForeground?.((c) => {
    console.log(`foreground_remount to=${c.id} ws=${c.workspaceId.slice(0, 8)}`);
    setEpoch((e) => e + 1);
  }), []);
  return <App key={epoch} />;
}

// LaunchPeek overlays every route (boot splash, sign-in, onboarding, the shell) —
// it mounts beside App so the launch moment can't depend on routing state.
// the desktop Code bridge (2026-09-04): the relay lane composes onto the bridge BEFORE the app
// renders, and the engineering hook awaits its readiness rather than reading the bridge's shape early
setBridgeReady(attachDesktopRelay(nm));
createRoot(document.getElementById('root')!).render(<><LaunchPeek /><Shell /></>);
