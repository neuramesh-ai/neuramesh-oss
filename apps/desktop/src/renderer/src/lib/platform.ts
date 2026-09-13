// which client am I? the BRIDGE is ground truth, never a user-agent sniff (a UA check
// false-positives inside any electron-hosted browser pane — the guests.tsx lesson).
// `nm.electron` carries the electron version on desktop, 'preview' in the screenshot
// harness, 'web' in the browser client.
import { nm } from '../bridge/nm';

export type NmPlatform = 'electron' | 'web' | 'preview' | 'unknown';

export const NM_PLATFORM: NmPlatform = !nm
  ? 'unknown'
  : nm.electron === 'preview'
    ? 'preview'
    : nm.electron === 'web'
      ? 'web'
      : 'electron';

/** the browser client (W2). copy that says "this Mac" or "this machine" must not render here. */
export const IS_WEB = NM_PLATFORM === 'web';
