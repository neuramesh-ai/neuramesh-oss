// THE BOOT, SAID WHERE THE PERSON ASKED (docs/design/machine-autowake-2026-08, approved round).
//
// This replaces a refusal. Opening a terminal on a sleeping workspace used to print "start it
// yourself" and exit — honest, and still the wrong answer, because we know what was wanted and
// how to get it.
//
// PANE-SCOPED, NOT FULL SCREEN. It covers the surface the request came from and nothing else, so
// the thread stays readable while the machine comes up. Full screen was the first sketch; it
// blocks the whole app for two minutes over a request scoped to one pane, and someone who opens
// a terminal mid-thread loses the thread. (First-run is the exception, where the boot IS the
// first impression — not this surface.)
//
// ONE STATE AT A TIME. An earlier round showed a ledger of five stages, then three. Two survive,
// because two is what a person can tell apart: the machine is coming up, then we are attaching
// to it. "Starting" was the instant desired_replicas→1 write and flashed past; the rest narrated
// the storage driver, which nobody waiting on a terminal wants a tour of.
//
// NO PROGRESS BAR, deliberately. A bar here is a timer wearing a progress bar's clothes, and it
// lies exactly when a boot runs slow — which is when somebody is looking at it. The elapsed
// count and the stated expectation carry it instead.
import { useEffect, useState } from 'react';
import { Orb } from '../ui/Orb';
import { useCompute } from './useCompute';
import type { EnsurePhase } from '@neuramesh/relay-client';

const LABEL: Record<EnsurePhase, string> = {
  starting: 'Starting your cloud machine',
  connecting: 'Connecting',
};

/** m:ss. Tabular figures in the stylesheet stop the width jittering each second. */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function MachineBoot({ phase, since, onLeave, done, onUpgrade }: {
  phase: EnsurePhase;
  /** when the wait started, so the counter survives a re-render */
  since: number;
  onLeave?: () => void;
  /** true once the machine is up — plays the fade rather than unmounting mid-animation */
  done?: boolean;
  onUpgrade?: () => void;
}) {
  const compute = useCompute(true);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [done]);

  return (
    <div className={`mboot${done ? ' done' : ''}`} role="status" aria-live="polite">
      <div className="mbootorb">
        {/* the SAME orb the thread shows while an agent works — one vocabulary, one stage
            earlier, rather than a second spinner to learn */}
        <Orb state="connecting" size={64} label="Starting your cloud machine" />
      </div>
      {/* keyed on the phase so the label crossfades when it genuinely changes */}
      <div className="mbooth" key={done ? 'ready' : phase}>{done ? 'Ready' : LABEL[phase]}</div>
      {!done && (
        <p className="mbootsub">
          Usually about <b>2 minutes</b> · <b>{clock(now - since)}</b> elapsed
        </p>
      )}
      {!done && (
        <div className="mbootq">
          <span className="mbootdot" aria-hidden />
          Your terminal opens the moment it&rsquo;s ready.
        </div>
      )}
      {/* THE UPSELL, AND ONLY BECAUSE IT IS NOW TRUE.
          Waiting is the honest moment to mention the paid plan, but until the cloud plan actually
          shortened the wait this would have been a promise the product did not keep — on the one
          screen whose whole design is not pretending. Cloud machines now idle for 12 hours rather
          than 30 minutes, which is what makes "long running" a description instead of a pitch.
          The screen does NOT quote the number: this is the moment somebody wants their terminal,
          not a spec sheet. The upgrade modal is where the details belong, one click away.
          Hidden for cloud already — offering an upgrade to someone who has one reads as the
          product not knowing who they are. */}
      {!done && onUpgrade && compute?.plan !== 'cloud' && (
        <p className="mbootup">
          Don&rsquo;t like waiting?{' '}
          <button type="button" className="linkbtn" onClick={onUpgrade}>
            Upgrade to long running machines
          </button>
        </p>
      )}
      {/* LEAVING IS NOT CANCELLING. The machine keeps coming and the terminal stays queued — the
          person is only reclaiming their attention, which they should never have to buy. */}
      {!done && onLeave && (
        <button type="button" className="btn ghost mbootback" onClick={onLeave}>Back to chat</button>
      )}
    </div>
  );
}
