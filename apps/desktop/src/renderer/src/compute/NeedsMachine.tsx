// "THIS SURFACE NEEDS A MACHINE, AND THE BROWSER CANNOT REACH IT YET."
//
// Agents' footprint rendered a `searching` orb and the words "Measuring this machine" FOREVER on
// web, because footprintGet() returns { ready: false } there and nothing ever flips it. That is
// not an empty state — it is an assertion that work is happening, about a machine it is not
// talking to. The exact failure webnm-local.ts exists to prevent, reproduced one layer up on a
// surface nobody revisited.
//
// WHY THERE IS NO "START THE MACHINE" BUTTON, which was the first draft.
//
// The relay carries PTY CHANNELS ONLY — `open`, `data`, `resize`, `close` (protocol.ts). There is
// no RPC lane for a footprint, a branch list or a log tail. So a machine being awake changes
// nothing for these surfaces: there is no question the browser can ask it. Offering to start one
// would be a button that spends a person's metered minutes and then leaves the page exactly as
// empty, which is a worse lie than the spinner.
//
// The honest answer is the one webnm-local.ts already gives the shell: not here, go to the
// desktop. When the relay grows an RPC lane, this is the component that changes.
import { nm } from '../bridge/nm';

/** true in the browser. `machineEnsure` is web-only, so its presence IS the signal — no second
 *  flag to keep in sync with the one that already exists. */
export function useOnWeb(): boolean {
  return !!nm?.machineEnsure;
}

export function NeedsMachine({ what, detail }: { what: string; detail?: string }) {
  return (
    <div className="needsmach">
      <div className="needsmachh">{what} lives on your machine</div>
      <p className="needsmachp">
        {detail ?? 'The browser cannot reach it yet.'} Open this workspace in the desktop app to see it.
      </p>
    </div>
  );
}
