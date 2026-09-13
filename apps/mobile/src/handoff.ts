// The browser-handoff constants, alone in a file with no React Native under them.
//
// They lived in auth.ts, which reaches expo-secure-store and the API client, so anything that
// wanted to REASON about a handoff had to import the whole sign-in machine. The pure reconnect
// message needs one of these two words and nothing else.

/** how long we poll for the sign-in to land before we give up so the UI can offer a fresh attempt
 *  (mirrors the desktop's handoff timeout). The server nonce outlives this, so a retry once you
 *  are signed in the browser completes fast. */
export const HANDOFF_SECONDS = 90;

/** Thrown when the handoff window elapses without completing. The UI treats this as a SOFT reset
 *  (offer another try) rather than a hard error, so it never shows a scary message. */
export const HANDOFF_TIMEOUT = 'nm/handoff-timeout';
