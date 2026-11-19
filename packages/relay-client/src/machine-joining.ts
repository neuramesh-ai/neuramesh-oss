// A MACHINE THAT HAS JUST STARTED IS NOT ON THE RELAY YET (the hq sweep, 2026-10-29). ensureMachine
// resolves on the first heartbeat newer than its wake, and the machine dials the relay a few seconds
// later, after its box starts. An attach in between heard 4404, and on a parked runner the terminal
// pane said "not on the relay yet" and ended. So ensureMachine marks a machine it started, and for
// JOIN_WINDOW_MS after that the first attach to it waits through 4404 for the machine to join
// (relay-client.ts). A 4404 on a machine nobody just started still ends the attach at once.
export const JOIN_WINDOW_MS = 5 * 60_000;

const joining = new Map<string, number>();

/** `machineId` was just started (woken, or restarted on a volume): its relay socket follows shortly */
export function markMachineJoining(machineId: string, windowMs = JOIN_WINDOW_MS): void {
  joining.set(machineId, Date.now() + windowMs);
}

/** until when (epoch ms) an attach to `machineId` waits through 4404; 0 = it does not */
export function joiningUntil(machineId: string): number {
  const until = joining.get(machineId) ?? 0;
  if (until > Date.now()) return until;
  joining.delete(machineId);
  return 0;
}

/** test seam: nobody is joining */
export function resetJoining(): void {
  joining.clear();
}
