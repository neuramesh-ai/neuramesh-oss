// THE CAP, SAID WHERE THE PERSON IS (cloud-cap round, 2026-08-29).
//
// The failure this fixes was SILENT. A free workspace spends its day's machine minutes, the sweep
// stops the runner, and the next message wakes nothing, because `bumpMachineWake` refuses by
// simply not updating the row. The person sees their message sitting there with no reply and no
// explanation. The only surface that knew was a settings page nobody had a reason to open.
//
// TWO VARIANTS, because the person is in two different situations (George, 2026-08-29):
//
//   'stage'  — the New chat stage REPLACES its composer and its suggestion pills with this card.
//              A composer that cannot deliver is a trap: it invites you to type, accepts the text,
//              and produces nothing. The stage exists to start work, so when no work can start,
//              the state IS the surface rather than a warning stacked on top of a dead control.
//              Nothing has been sent here, so this variant does not promise to answer anything.
//
//   'thread' — an existing conversation keeps its composer, and this docks above it (docs/25's one
//              contextual gate). Sending here is still worth doing: the message queues, and
//              `chatsweep.ts` sweeps human messages the host slept through back through the wake
//              decision, so "it gets answered when a machine is awake" is a promise the system
//              actually keeps. That line only belongs where a message can exist.
//
// It renders ONLY for `capped`. Asleep needs no card, because a message wakes it. Waking needs no
// card, because it is already coming. Unreachable is ours to fix, not a decision to put in front
// of somebody mid-conversation. The compute pill names those three.
import { capResetLabel, msUntilCapReset, planLabel } from '@neuramesh/shared';
import { nm } from '../bridge/nm';
import { useCompute } from './useCompute';

/** "6h 12m". The reset is a UTC-midnight boundary, so this is a duration and never a wall clock.
 *  A clock time would be wrong for everyone outside UTC, and this number is read as "how long
 *  until I can work again". */
export function untilReset(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}

export function CapGate({ variant = 'thread', onUpgrade, onSeeUsage }: {
  variant?: 'stage' | 'thread';
  onUpgrade: (reason: string) => void;
  onSeeUsage: () => void;
}) {
  const compute = useCompute(true);
  if (!compute || compute.status !== 'capped') return null;

  const cap = compute.capMinutes ?? 0;
  const resets = untilReset(msUntilCapReset(Date.now()));
  // the same moment in the reader's own clock, so the countdown and the time agree without any
  // timezone arithmetic. The UTC boundary stays the meter's business, not the reader's.
  const resetAt = capResetLabel(Date.now());
  // the sentence the upgrade modal opens with, composed HERE so the modal never has to
  // reconstruct the situation it was opened from
  const reason = `Today's ${cap} free machine minutes are spent, so your agents could not start. Free hours reset at ${resetAt}, in ${resets}. Upgrade and the machine wakes now.`;

  return (
    <div className={`capgate ${variant}`} role="group" aria-label="Free machine hours used up">
      <div className="capgaterule" />
      <div className="capgatein">
        <div className="capgatetop">
          <span className="capgateeye">Cloud machine · paused</span>
          <span className="capgatetime">resets in {resets}</span>
        </div>
        <div className="capgateh">Today&rsquo;s free machine hours are used up</div>
        <p className="capgatep">
          Your agents run on a cloud machine. The free plan includes <b>{cap} minutes a day</b>.
          Today&rsquo;s minutes are spent, so the machine did not start. It resets at <b>{resetAt}</b>.
        </p>
        <div className="capmeter">
          <div className="captrack"><div className="capfill spent" /></div>
          <div className="caplabel">
            <span className="capspent">{compute.minutes} of {cap} min used today</span>
            <span>resets at {resetAt}</span>
          </div>
        </div>
        {variant === 'thread' && (
          <div className="capqueued">
            <span className="captick" aria-hidden>✓</span>
            Your message is queued. It gets answered as soon as a machine is awake.
          </div>
        )}
        <div className="capacts">
          <button className="btn primary block" onClick={() => onUpgrade(reason)}>
            Get {planLabel('cloud')} for unlimited machine hours
            <span className="fobtnsub">$22 / seat / mo. Cancel anytime.</span>
          </button>
          <button className="btn ghost" onClick={onSeeUsage}>See usage</button>
        </div>
      </div>
    </div>
  );
}

/** the Compute view's own row action. "Wake now" lives there rather than on this card, because a
 *  capped machine cannot be woken and a button that refuses is worse than one that is not offered.
 *  Kept here so the wake's refusal path sits beside the card that explains it. */
export async function wakeNow(onCapped: (reason: string) => void): Promise<boolean> {
  const r = await nm?.machineWake?.();
  if (r?.ok) return true;
  // the server refuses a capped wake OUT LOUD, so the button routes to the upgrade instead of
  // failing quietly. That is the same refusal the message path makes silently.
  if (r?.capped) onCapped(`Today's free machine hours are used up, so the machine cannot start yet. Free hours reset at ${capResetLabel(Date.now())}. Upgrade and it wakes now.`);
  return false;
}
