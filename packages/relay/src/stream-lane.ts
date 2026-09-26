// THE STREAM LANE AT THE HUB (web stream lane prototype, 2026-09-24): a browser tab's read-only
// subscription to its machine's live agent replies. It is not a session, so it has its own budget:
// a team's open tabs would otherwise eat the 32 session slots and leave no room for a terminal.
// Two per socket (a reconnect overlaps its predecessor for a moment), and a machine-wide ceiling
// sized for every member's tabs.
export const MAX_STREAM_CHANNELS_PER_CLIENT = 2, MAX_STREAM_CHANNELS_PER_MACHINE = 256;

/** may a client open one more `stream` channel on this machine?
 *  'lane'  = the machine's hello never named the lane. An older daemon reads an unknown lane as a
 *            terminal: it would spawn a shell for every tab and count each one as activity
 *  'limit' = a cap · 'ok' = admitted */
export function admitStream(machineLanes: ReadonlySet<string>, clientStreams: number, machineStreams: number): 'ok' | 'lane' | 'limit' {
  if (!machineLanes.has('stream')) return 'lane';
  if (clientStreams >= MAX_STREAM_CHANNELS_PER_CLIENT || machineStreams >= MAX_STREAM_CHANNELS_PER_MACHINE) return 'limit';
  return 'ok';
}
