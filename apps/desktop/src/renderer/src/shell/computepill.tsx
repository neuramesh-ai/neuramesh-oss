import type { MachineStatus } from '@neuramesh/shared';

/**
 * THE COMPUTE MARK (cloud-cap round; icon pass 2026-08-29).
 *
 * It began as a dot with a word beside it: "Capped", "Waking". George read the shipped chrome and
 * could not tell what the words meant, which is the correct verdict on them. A bare status word
 * in a corner has no subject: "Capped" does not say what is capped, and sitting next to "Local"
 * it reads as a pair of unrelated labels rather than two facts about two different things.
 *
 * So the mark is now a DRAWN MACHINE, and the sentence moved to hover. An icon carries its
 * subject in its shape, which a word in a 60px pill cannot, and the tooltip has room for the
 * whole explanation instead of one adjective. The state rides colour and one small overlay:
 *
 *   online       the machine, lit
 *   asleep       the machine, dim
 *   waking       the machine, breathing
 *   capped       the machine with a PAUSE bar, in warn
 *   unreachable  the machine with an ALERT dot, in warn
 *   stopped      the machine, struck through
 *
 * The reason text is machineState()'s, verbatim. This component picks no state and writes no
 * copy of its own.
 */
export function ComputePill({ status, reason, onOpen }: {
  status: MachineStatus; reason: string; onOpen: () => void;
}) {
  // The tooltip names the SUBJECT and then hands over to the reason. It deliberately does NOT
  // restate the status first: machineState's reasons already open with it, so "Cloud machine:
  // starting up. Starting up. Agents pick their work back up." stuttered on four of the six
  // states. The icon says "a machine", this says which one, and the reason says the rest.
  const tip = `Cloud machine. ${reason}`;
  return (
    <button type="button" className={`cpill ${status}`} onClick={onOpen} data-tip={tip}
      aria-label={tip}>
      <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        {/* the machine itself: a chassis on a stand, the same shape the Compute surfaces use — with a
            small CLOUD badged at its top-right, so the mark says "cloud machine" on its own instead
            of reading as a machine beside the sync cloud next door (George, 2026-09-05) */}
        <rect x="1.5" y="5.2" width="11" height="7.4" rx="1.6" />
        <path d="M4.6 15.4h5.4" strokeLinecap="round" />
        <path d="M7.3 12.6v2.8" strokeLinecap="round" />
        <path d="M12.9 6.3h3.4a1.7 1.7 0 0 0 .2-3.4 2.4 2.4 0 0 0-4.6.8 1.45 1.45 0 0 0 1 2.6z" strokeLinejoin="round" />
        {/* capped: a pause bar, because the machine is stopped ON PURPOSE and can resume */}
        {status === 'capped' && <path d="M5.7 7.4v3M8.9 7.4v3" strokeLinecap="round" />}
        {/* unreachable: an alert, because this one is a fault rather than a rest */}
        {status === 'unreachable' && <path d="M7.3 7v2.3M7.3 11.1v.05" strokeLinecap="round" />}
        {/* stopped: struck through — there is no machine to have a state */}
        {status === 'stopped' && <path d="M3.4 14.2 14.6 2.6" strokeLinecap="round" />}
      </svg>
    </button>
  );
}
