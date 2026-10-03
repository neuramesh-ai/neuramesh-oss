// the browser lane at the hub (models-and-replies round, board C3): a web panel's view of the
// machine's own Chromium. screencast frames are the heaviest thing the relay carries, so the lane
// has its own small budget, apart from the 32 session slots: two channels for each client socket (a
// reconnect overlaps its predecessor for a moment) and four for each machine. four viewers, each
// with at most BROWSER_FRAME_WINDOW frames in flight under the data cap, keep a machine's outbound
// queue far below the 8 MB that closes its socket (apps/desktop relay/bounded-frame-sender.ts).
export const MAX_BROWSER_CHANNELS_PER_CLIENT = 2, MAX_BROWSER_CHANNELS_PER_MACHINE = 4;

/** may a client open one more `browser` channel on this machine?
 *  'lane'  = the machine's hello never named the lane. an older daemon reads an unknown lane as a
 *            terminal: it would spawn a shell for every panel and count each one as activity
 *  'limit' = a cap · 'ok' = admitted */
export function admitBrowser(machineLanes: ReadonlySet<string>, clientBrowsers: number, machineBrowsers: number): 'ok' | 'lane' | 'limit' {
  if (!machineLanes.has('browser')) return 'lane';
  if (clientBrowsers >= MAX_BROWSER_CHANNELS_PER_CLIENT || machineBrowsers >= MAX_BROWSER_CHANNELS_PER_MACHINE) return 'limit';
  return 'ok';
}
