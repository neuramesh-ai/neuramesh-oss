/**
 * THE CREDIT RING (2026-08-28) — `mockups/starter-brain-and-credits.html` station 3,
 * docs/design/cloud-first-2026-08/starter-brain-and-credits.md §5.7 + §8.
 *
 * The workspace's balance needs ONE ambient home, not a panel you have to remember to open, so
 * it joins the nav's workspace foot as a third element, LEFT OF THE ACCOUNT AVATAR.
 *
 * Why a ring and not a number: a number in the rail asks to be read; a ring asks only to be
 * glanced at, and depletion is a shape before it is a figure. So the resting state carries NO
 * digits — the arc shortens, and warms below a fifth. The three named lines (Brain · Machine ·
 * Storage) survive one click in, where someone who wants the breakdown goes looking, and the
 * popover's last line is the one that matters: connecting your own brain stops the drain, which
 * turns the meter into a reason rather than a threat.
 *
 * NO PER-REPLY PRICING, anywhere on this surface (George, twice). A per-message rate makes a
 * free product feel like a taxi meter and is a number nobody can act on in the moment. The
 * BALANCE is the honest unit.
 *
 * PLACEMENT IS A CLAIM: the foot is the WORKSPACE's bar, and credits are scoped to the
 * workspace — so the ring is the workspace's balance sitting beside the person spending it,
 * never drawn inside them. If credits ever become PER-USER, this ring must move out of the
 * workspace foot and onto the account avatar; leaving it here would say the wrong thing.
 *
 * ABSENCE OVER DECORATION: `usage()` answers null when the deployment doesn't serve credits
 * (the endpoint 501s off a postgres store) or the read failed, and then this renders NOTHING.
 * A broken meter drawing a full ring is worse than no meter. A workspace that was never granted
 * is a different case — it reads zero, which is a real balance, and draws an empty ring.
 */
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { nextRefillOn } from '@neuramesh/shared';
import { nm as nmBridge, type ConnectionKind, type WorkspaceUsage } from '../bridge/nm';

// imported bindings lose control-flow narrowing inside closures, so re-bind (App.tsx's note)
const nm = nmBridge;

/** r=9 in a 22px box: the mockup's ring, and the circumference its dash array is cut from */
const R = 9;
const CIRC = 2 * Math.PI * R;
/** below a fifth remaining the arc turns warm — the one threshold the design names */
const LOW = 0.2;

/**
 * POLLING, decided rather than defaulted. The ring's whole claim is that it depletes VISIBLY,
 * and a meter that only moves when you click it is a dashboard wearing a ring's clothes — so a
 * timer earns its place. It is the gentlest one that keeps the claim true:
 *  · 60s, the floor this round was given, and 20× slower than the room polls beside it;
 *  · gated on `document.hasFocus()` — the App.tsx:405 idiom verbatim — so an app left open in
 *    the background costs the control-api nothing at all;
 *  · plus a read on mount, on a workspace change, and on every OPEN, so the numbers you
 *    deliberately look at are never the stale ones.
 * /v1/usage is two indexed reads behind a membership check; one a minute while you are actually
 * looking at the window is a fair price for a signal that is honest between clicks.
 */
const POLL_MS = 60_000;

/** the refill date comes from `nextRefillOn` in packages/shared — the SAME rule the server's
 *  worklist runs on (a calendar-month boundary, not a signup anniversary). null drops the clause,
 *  which is what an absent period start and an already-due workspace both deserve. */
function refillOn(periodStart: string): string | null {
  const next = nextRefillOn(periodStart, new Date());
  return next?.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) ?? null;
}

/**
 * The breakdown, one click in. The three named lines survive from §5.7 — Brain, Machine and
 * Storage are three real costs and each is acted on differently (connect a brain · let the
 * machine idle · prune a berth) — and they are never blended into one number.
 *
 * EACH LINE NOW CARRIES ITS DENOMINATOR, which is the difference between a reading and a number.
 * "45 min today" tells you nothing you can act on; "45 / 60 min today" tells you the day is nearly
 * spent. The cap was always in /v1/usage — the client TYPE just did not declare it, so the earlier
 * comment here blamed a payload that had been sending it all along.
 *
 * Storage says what the plan INCLUDES, not what is used: nothing meters bytes on the PVC yet, and
 * `metered` says so rather than letting a surface invent a numerator later.
 *
 * A cap you can see is only half of it; the other half is being able to do something about it, so
 * a free plan gets the way out under the numbers.
 */
function CreditLines({ usage, onUpgrade }: { usage: WorkspaceUsage; onUpgrade?: (reason: string) => void }) {
  const { remaining, granted, monthlyGrant, periodStart } = usage.credits;
  const left = Math.max(0, remaining);
  const refill = refillOn(periodStart);
  const { activeSecondsToday } = usage.machine;
  const workedH = activeSecondsToday >= 3600 ? `${(activeSecondsToday / 3600).toFixed(1)}h` : `${Math.round(activeSecondsToday / 60)} min`;
  const free = usage.machine.plan !== 'cloud';
  const capped = usage.credits.outOfCredits;
  return (
    <>
      <div className="credbig">{left} <small>credits left</small></div>
      <div className="credln"><span>Brain</span><span>{Math.max(0, granted - left)} used</span></div>
      <div className="credln">
        <span>Machine</span>
        <span>{workedH} worked today</span>
      </div>
      <div className="credln">
        <span>Storage</span>
        {/* "included", never "used": the allocation is known, the usage is not */}
        <span>{usage.storage.gb} GB included</span>
      </div>
      <div className="credfoot">
        {refill && monthlyGrant > 0 ? `Refills to ${monthlyGrant} on ${refill} · ` : ''}
        connect your own brain and agents stop drawing credits
      </div>
      {free && onUpgrade && (
        <button type="button" className="credup"
          onClick={() => onUpgrade(capped
            ? 'Your credits are spent, so the machine parked. Pro allocates 1,500 credits a seat each month. You can also buy a top-up on any plan.'
            : 'Pro allocates 1,500 credits a seat each month and adds storage. You can also buy credit packs on any plan.')}>
          Get Pro for more credits
        </button>
      )}
    </>
  );
}

export function CreditRing({ workspace, onUpgrade, connection }: {
  /** the workspace the foot is naming — its change is what re-reads the balance */
  workspace: string;
  /** open the shared upgrade surface with a reason. Absent on plans with nothing to upgrade to. */
  onUpgrade?: (reason: string) => void;
  /** the connection the foot stands on. A LOCAL connection has no credits, so the ring renders
   *  NOTHING there (review F13) — enforced here, not by hoping the usage endpoint answers null.
   *  Absent, the ring asks the bridge which connection it is on. */
  connection?: ConnectionKind;
}) {
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  // null = not known yet: no read is made until the connection is, so a local stack that happens to
  // serve /v1/usage cannot draw a ring for one frame
  const [local, setLocal] = useState<boolean | null>(connection ? connection === 'local' : null);
  useEffect(() => {
    if (connection) { setLocal(connection === 'local'); return; }
    void nm?.authStatus().then((s) => setLocal(s.mode === 'local' || s.connection?.kind === 'local')).catch(() => setLocal(false));
  }, [connection]);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    void nm?.usage().then((u) => setUsage(u ?? null)).catch(() => setUsage(null));
  }, []);

  // mount + workspace change, then the focused 60s tick — once the connection is known and not local
  useEffect(() => {
    if (local !== false) return;
    load();
    const t = setInterval(() => { if (document.hasFocus()) load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load, workspace, local]);

  // a deliberate look is always a fresh read
  useEffect(() => { if (open) load(); }, [open, load]);

  // place above the ring with a clamped left edge (§9.6 — the nav is a masked scroller, so this
  // card portals to <body> rather than clipping inside it)
  /**
   * A ONE-SHOT measurement strands this card, and the ways it does are all real: the ring is still
   * settling while the shell fills (measured 399px adrift on a click 2.5s into boot), the window
   * resizes, or the nav — a scroller — scrolls under it. Scroll and resize listeners would catch
   * only two of the three; the ring moving because SIBLING content loaded fires neither event.
   *
   * So the anchor is TRACKED while the card is open, not read once: one rect per frame, only for
   * the seconds a popover is up, and state is written only when the position actually changes so
   * a still ring costs no renders. This is floating-ui's `autoUpdate({animationFrame: true})`
   * shape, hand-rolled because the repo carries no positioning library.
   */
  useLayoutEffect(() => {
    // drop the measurement on close, so the next open paints hidden-then-placed rather than
    // flashing at wherever the ring used to be
    if (!open) { setPlace(null); return; }
    let raf = 0;
    const track = () => {
      const btn = btnRef.current, pop = popRef.current;
      if (btn && pop) {
        const r = btn.getBoundingClientRect(), PAD = 8;
        const left = Math.max(PAD, Math.min(r.left + r.width / 2 - pop.offsetWidth / 2, window.innerWidth - pop.offsetWidth - PAD));
        const above = r.top - pop.offsetHeight - PAD >= 0;
        const top = above ? r.top - pop.offsetHeight - 6 : r.bottom + 6;
        setPlace((p) => (p && p.left === left && p.top === top ? p : { left, top }));
      }
      raf = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open]);

  // the honest absence — a local connection, or no data, draws no ring (see the header note)
  if (local !== false || !usage) return null;

  const { remaining, granted } = usage.credits;
  const left = Math.max(0, remaining);
  // a never-granted workspace reads zero on both — an empty ring, which is the true picture
  const frac = granted > 0 ? Math.max(0, Math.min(1, left / granted)) : 0;
  const low = frac < LOW;
  const label = `${left} of ${granted} credits left`;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`credring${open ? ' open' : ''}`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-expanded={open}
        title={label}
        aria-label={label}
      >
        <svg viewBox="0 0 22 22" aria-hidden>
          <circle className="credtrack" cx="11" cy="11" r={R} />
          <circle
            className={`credarc${low ? ' low' : ''}`}
            cx="11" cy="11" r={R}
            style={{ strokeDasharray: CIRC, strokeDashoffset: CIRC * (1 - frac) }}
          />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          className="credpop"
          style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
        >
          <CreditLines usage={usage} onUpgrade={onUpgrade} />
        </div>,
        document.body,
      )}
    </>
  );
}
