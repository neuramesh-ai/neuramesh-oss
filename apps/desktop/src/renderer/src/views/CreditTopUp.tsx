// THE CUSTOM TOP-UP. The three packs are the common sizes, not the price list — a person who
// wants $60 of credits should not have to buy $25 three times (George, 2026-08-31).
//
// Two fields, either of which can be the one you type in, because flat pricing makes them exact
// inverses: 1 credit is 1¢, so credits ↔ dollars round-trips without drift. The field you are
// NOT typing in is rewritten as you go; the one you are is left alone, so a half-typed "1" does
// not get reformatted to "1.00" under the cursor.
//
// The amount is still priced by the SERVER — this only decides which number to send. Nothing
// here is authoritative, which is why it can afford to be forgiving about input.
import { useState } from 'react';
import { CREDITS_PER_USD, MAX_PACK_CREDITS, MIN_PACK_CREDITS, creditsForUsd, usdForCredits } from '@neuramesh/shared';

const money = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (n: number): string => n.toLocaleString('en-US');

export function CreditTopUp({ busy, onBuy }: { busy: boolean; onBuy: (credits: number) => void }) {
  const [credits, setCredits] = useState('5000');
  const [usd, setUsd] = useState('50.00');

  const editCredits = (v: string) => {
    setCredits(v);
    const n = Number(v);
    setUsd(v.trim() === '' || !Number.isFinite(n) ? '' : money(usdForCredits(n)));
  };
  const editUsd = (v: string) => {
    setUsd(v);
    const n = Number(v);
    setCredits(v.trim() === '' || !Number.isFinite(n) ? '' : String(creditsForUsd(n)));
  };

  // SETTLE TO WHAT WILL ACTUALLY BE CHARGED. Mid-typing the fields may disagree with the price:
  // "$12.505" rounds to 1,251 credits, which the server then prices at $12.51. Leaving the typed
  // figure on screen would show a total nobody is going to pay. On blur both fields are rewritten
  // from the credits number — the one thing the request carries — so the display and the charge
  // are the same number. Done on BLUR, never on change, so nothing is reformatted under the cursor.
  const settle = () => {
    const v = Number(credits);
    if (!Number.isFinite(v) || credits.trim() === '') return;
    const round = Math.round(v);
    setCredits(String(round));
    setUsd(money(usdForCredits(round)));
  };

  const n = Number(credits);
  // the same three conditions the server checks, so the button is disabled for exactly the
  // reasons a request would be refused — the message just arrives earlier
  const bad = !Number.isFinite(n) || !Number.isInteger(n)
    ? 'Enter a whole number of credits.'
    : n < MIN_PACK_CREDITS ? `The smallest top-up is ${whole(MIN_PACK_CREDITS)} credits ($${money(usdForCredits(MIN_PACK_CREDITS))}).`
    : n > MAX_PACK_CREDITS ? `The largest single top-up is ${whole(MAX_PACK_CREDITS)} credits ($${money(usdForCredits(MAX_PACK_CREDITS))}). Buy twice for more.`
    : null;

  return (
    <div className="credv-custom">
      <div className="credv-cfields">
        <label className="credv-cf">
          <span>Credits</span>
          <input type="text" inputMode="numeric" value={credits} onChange={(e) => editCredits(e.target.value)} onBlur={settle}
            aria-label="Credits to buy" disabled={busy} />
        </label>
        <span className="credv-ceq" aria-hidden>=</span>
        <label className="credv-cf">
          <span>Dollars</span>
          <input type="text" inputMode="decimal" value={usd} onChange={(e) => editUsd(e.target.value)} onBlur={settle}
            aria-label="Amount in US dollars" disabled={busy} />
        </label>
        <button type="button" className="credv-cgo" disabled={busy || bad !== null}
          onClick={() => onBuy(n)}>
          {busy ? 'Opening…' : 'Continue to payment'}
        </button>
      </div>
      {/* the rate said out loud: the packs are this same arithmetic, so nobody has to wonder
          whether buying custom costs more */}
      <div className={bad ? 'credv-cnote bad' : 'credv-cnote'} role={bad ? 'alert' : undefined}>
        {bad ?? `${CREDITS_PER_USD} credits per dollar, the same rate as every pack. Purchased credits never expire.`}
      </div>
    </div>
  );
}
