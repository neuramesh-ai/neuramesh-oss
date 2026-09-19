// THE UTILIZATION DASHBOARD (docs/design/credits-billing-2026-08, station 1).
//
// One credit pool, three metered draws. The arc is the month's balance; the meters are where it
// went (brain tokens, machine ACTIVE minutes, storage — never uptime, never a query count); the
// ledger is why. Scope is the WORKSPACE, because credits are the workspace's — this is a
// destination, never a room-scoped surface.
//
// It reads /v1/usage (the balance + today) and /v1/credits/history (31 days + the grant ledger).
// Both are operator reads over HTTP, deliberately outside PowerSync — the same doctrine the ring
// already follows.
import { useEffect, useState } from 'react';
import { CreditTopUp } from './CreditTopUp';
import { nm } from '../bridge/nm';
import type { WorkspaceUsage, CreditHistory } from '../bridge/nm';
import { CREDIT_PACKS, planLabel, VIDEO_TIER_LABELS } from '@neuramesh/shared';

const fmt = (n: number): string => n.toLocaleString('en-US');
const tierName = (tier: string): string => tier === 'own' ? 'your key' : (VIDEO_TIER_LABELS as Record<string, string>)[tier] ?? tier;
const hoursFrom = (seconds: number): string => (seconds / 3600).toFixed(seconds >= 36000 ? 0 : 1);

export function CreditsView() {
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const [history, setHistory] = useState<CreditHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<number | null>(null);
  const [buyErr, setBuyErr] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    let dead = false;
    void Promise.all([nm?.usage?.() ?? null, nm?.creditsHistory?.() ?? null]).then(([u, h]) => {
      if (dead) return;
      setUsage(u); setHistory(h); setLoading(false);
    });
    return () => { dead = true; };
  }, []);

  if (loading) return <div className="credv-empty">Loading credits…</div>;
  // credits are only served where the platform meters them — a self-hosted or dev stack answers
  // null, and this page says so rather than drawing an empty dashboard.
  if (!usage) return <div className="credv-empty">Credits are not tracked on this workspace.</div>;

  const c = usage.credits;
  const total = c.grantRemaining + c.purchasedRemaining;
  // the arc: fraction of the MONTHLY GRANT still available (purchases push it past full, which is
  // honest — you have more than the plan gives). Clamp the visual at one turn.
  const frac = c.monthlyGrant > 0 ? Math.min(1, total / c.monthlyGrant) : 0;
  const R = 74, CIRC = 2 * Math.PI * R;
  const isCloud = usage.machine.plan === 'cloud';

  // THE TWO METERS COME FROM THE LEDGER'S OWN PER-METER COLUMNS, not from the balance.
  //
  // Brain used to read `granted - grantRemaining`, which is every credit the grant spent —
  // brain AND machine — while wearing the Brain label; Machine re-derived its own number from
  // active seconds. So the two overlapped and neither matched the ledger: a real day of 1.35
  // brain + 2.50 machine credits drew "Brain 4" beside "Machine 3", summing to 7 for 3.85
  // credits of spend. Fixture data hid it, because invented numbers look independent.
  //
  // /v1/credits/history already reports model_micros and machine_micros per day, so the split
  // is read rather than inferred. Matched on the UTC date the server keys days by — NOT the
  // last element, which is only the most recent day that had any usage at all.
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = history?.days.find((d) => d.day === todayKey) ?? null;
  const brainCr = today?.brainCredits ?? 0;
  const machineCr = today?.machineCredits ?? 0;
  const videoCr = today?.videoCredits ?? usage.video?.creditsToday ?? 0; // the video rung: films today
  const machineHrs = hoursFrom(usage.machine.activeSecondsToday);

  const buy = async (credits: number): Promise<void> => {
    setBuying(credits);
    setBuyErr(null);
    // A SWALLOWED FAILURE LOOKS EXACTLY LIKE A CANCELLED PURCHASE. `.catch(() => {})` meant an
    // unconfigured or refused checkout just settled the button and said nothing, so the one
    // person who needed to know — the one trying to pay — learned nothing. Say so instead.
    try {
      const r = await nm?.creditsCheckout?.(credits);
      if (r && r.ok === false) setBuyErr('Could not open checkout. Please try again.');
    } catch {
      setBuyErr('Could not reach billing. Check your connection and try again.');
    }
    // the grant lands via webhook; a focus re-read picks it up. Leave the button settled.
    setBuying(null);
  };

  return (
    <div className="credv">
      <div className="credv-head">
        <h1>Credits</h1>
        <span>{planLabel(isCloud ? 'cloud' : 'free')} · {c.periodStart ? `resets ${refillLabel(c.periodStart)}` : ''}</span>
      </div>

      <div className="credv-top">
        <div className="credv-bal">
          <div className="credv-arc">
            <svg width="168" height="168" viewBox="0 0 168 168" aria-label={`${fmt(total)} credits remaining`}>
              <circle cx="84" cy="84" r={R} fill="none" stroke="var(--panel3)" strokeWidth="11"/>
              <circle cx="84" cy="84" r={R} fill="none" stroke={c.outOfCredits ? 'var(--warn)' : 'var(--brand)'}
                strokeWidth="11" strokeLinecap="round" strokeDasharray={CIRC}
                strokeDashoffset={CIRC * (1 - frac)} transform="rotate(-90 84 84)"/>
            </svg>
            <div className="credv-arcn"><b>{fmt(total)}</b><small>credits left</small></div>
          </div>
          <div className="credv-split">
            <div><span>Monthly grant</span><b>{fmt(c.grantRemaining)} of {fmt(c.monthlyGrant)}</b></div>
            <div><span className="credv-keeps">Purchased · never expires</span><b className="credv-keeps">{fmt(c.purchasedRemaining)}</b></div>
          </div>
          <div className="credv-note">Grant spends first, so what you bought keeps.</div>
        </div>

        <div className="credv-meters">
          <Meter name="Brain" sub="starter model tokens" credits={brainCr}
            detail={`${fmt(usage.brain.callsToday)} calls today`} tone="var(--viz-berths)" of={c.granted} />
          <Meter name="Machine" sub="active minutes only" credits={machineCr}
            detail={`${machineHrs}h worked today`} tone="var(--viz-clones)" of={c.granted} />
          {(videoCr > 0 || (history?.films?.length ?? 0) > 0) && (
            <Meter name="Video" sub="films on the platform" credits={videoCr}
              detail={`${fmt(usage.video?.clipsToday ?? today?.videoClips ?? 0)} film${(usage.video?.clipsToday ?? today?.videoClips ?? 0) === 1 ? '' : 's'} today`} tone="var(--viz-donors)" of={c.granted} />
          )}
          <div className="credv-meter">
            <div className="credv-mn">Storage<small>over the {usage.storage.gb} GB included</small></div>
            <div className="credv-mt"><div className="credv-mf" style={{ width: '0%' }} /></div>
            <div className="credv-mv"><span className="credv-free">{usage.storage.gb} GB included</span></div>
          </div>

          {history && history.days.length > 0 && <Burn days={history.days} />}
        </div>
      </div>

      <div className="credv-packs">
        <div className="credv-packh">Buy credits<small>works on any plan — no upgrade needed. Purchased credits never expire.</small></div>
        <div className="credv-packrow">
          {CREDIT_PACKS.map((pk) => (
            <button key={pk.credits} type="button" className="credv-pack" disabled={buying !== null}
              onClick={() => void buy(pk.credits)}>
              <b>{fmt(pk.credits)}</b><small>credits</small>
              <span className="credv-pr">{buying === pk.credits ? 'Opening…' : `$${pk.usd}`}</span>
            </button>
          ))}
          {/* the fourth card is a MODE, not an amount: it opens the fields rather than starting a
              checkout, so the row stays one row of choices */}
          <button type="button" className={custom ? 'credv-pack on' : 'credv-pack'} disabled={buying !== null}
            aria-expanded={custom} onClick={() => setCustom((v) => !v)}>
            <b>Other</b><small>your amount</small>
            <span className="credv-pr">Choose</span>
          </button>
        </div>
        {custom && <CreditTopUp busy={buying !== null} onBuy={(n) => void buy(n)} />}
        {buyErr && <div className="credv-buyerr" role="alert">{buyErr}</div>}
      </div>

      {/* every film is its own row: a film is the largest thing a credit buys, so it is never folded into a daily total */}
      {history && (history.films?.length ?? 0) > 0 && (
        <div className="credv-ledger">
          <div className="credv-lh">Recent films</div>
          <table>
            <tbody>
              {history.films!.map((f) => (
                <tr key={f.id}>
                  <td>{f.day} <span className="credv-k">· {tierName(f.tier)} · {f.model} · {f.seconds} s{f.status === 'failed' ? ' · failed, refunded' : f.status === 'done' ? '' : ' · filming'}</span></td>
                  <td className={f.status === 'failed' ? 'credv-cr' : 'credv-sp'}>{f.status === 'failed' ? `+${fmt(f.credits)}` : `−${fmt(f.credits)}`} cr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history && history.grants.length > 0 && (
        <div className="credv-ledger">
          <div className="credv-lh">Recent grants</div>
          <table>
            <tbody>
              {history.grants.map((g, i) => (
                <tr key={i}>
                  <td>{g.day} <span className="credv-k">· {g.note ?? g.kind}</span></td>
                  <td className="credv-cr">+{fmt(g.credits)} cr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Meter({ name, sub, credits, detail, tone, of }: {
  name: string; sub: string; credits: number; detail: string; tone: string; of: number;
}) {
  const pct = of > 0 ? Math.min(100, (credits / of) * 100) : 0;
  return (
    <div className="credv-meter">
      <div className="credv-mn">{name}<small>{sub}</small></div>
      <div className="credv-mt"><div className="credv-mf" style={{ width: `${pct}%`, background: tone }} /></div>
      <div className="credv-mv">{credits} cr · {detail}</div>
    </div>
  );
}

/** the daily burn, stacked by meter. A record of what HAPPENED — bars are per-day credits, not a
 *  running total, so a quiet day reads as a short bar rather than a flat line. */
function Burn({ days }: { days: CreditHistory['days'] }) {
  const max = Math.max(1, ...days.map((d) => d.brainCredits + d.machineCredits));
  return (
    <div className="credv-burn">
      <div className="credv-burnh"><span>Daily burn · last {days.length} days</span></div>
      <div className="credv-bars" role="img" aria-label="daily credit burn by meter">
        {days.map((d, i) => (
          <div className="credv-bar" key={i} data-tip={`${d.day}: ${d.brainCredits + d.machineCredits} cr`}>
            <i data-nz={d.machineCredits > 0 ? 1 : 0} style={{ height: `${(d.machineCredits / max) * 52}px`, background: 'var(--viz-clones)' }} />
            <i data-nz={d.brainCredits > 0 ? 1 : 0} style={{ height: `${(d.brainCredits / max) * 52}px`, background: 'var(--viz-berths)' }} />
          </div>
        ))}
      </div>
      <div className="credv-legend">
        <span><s style={{ background: 'var(--viz-berths)' }} />Brain</span>
        <span><s style={{ background: 'var(--viz-clones)' }} />Machine</span>
      </div>
    </div>
  );
}

/** the refill date, in the reader's own words. period_start is a UTC date; the refill is the 1st
 *  of next month. */
function refillLabel(periodStart: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodStart);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
