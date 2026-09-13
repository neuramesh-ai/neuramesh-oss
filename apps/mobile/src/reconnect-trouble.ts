// WHY THE RECONNECT DID NOT WORK, in one sentence a person can act on.
//
// The banner's catch used to swallow everything, so a tap that could not possibly succeed looked
// identical to a tap the app ignored (George, 2026-09-06: "autoreconnect didn't succeed, so i tried
// reconnecting manually, but it also didn't"). Three failures wear three different answers and the
// person can only act on one of them, so the surface has to tell them apart.
//
// Pure, because the message is the whole feature: a reason that is wrong is worse than no reason.
import { HANDOFF_TIMEOUT } from './handoff';

/** the sign-in page refused to open — almost always another sheet already on screen */
const BROWSER = 'The sign-in page did not open. Close the other page, then try again.';
/** the page opened and the 90 seconds ran out */
const TIMEOUT = 'The sign-in did not finish. Tap Reconnect to try again.';
/** the same words the sign-in screen uses for an unreadable throw — one word, one meaning */
const GENERIC = 'Something went wrong. Check your connection, then try again.';

export function reconnectTrouble(e: unknown, browserTrouble: string | null): string {
  const message = e instanceof Error ? e.message : '';
  if (message === HANDOFF_TIMEOUT) return browserTrouble ? BROWSER : TIMEOUT;
  if (message && message !== '[object Object]') return message.slice(0, 140);
  return GENERIC;
}
