// WHY THE RECONNECT DID NOT WORK. George, 2026-09-06: "now autoreconnect didn't succeed, so i tried
// reconnecting manually, but it also didn't". The banner's catch swallowed every reason, so a tap
// that could not possibly succeed looked exactly like a tap the app ignored. This is the whole
// feature, so a wrong sentence here is worse than no sentence at all.
import { describe, expect, it } from 'vitest';
import { HANDOFF_TIMEOUT } from '../src/handoff';
import { reconnectTrouble } from '../src/reconnect-trouble';

describe('why the reconnect failed', () => {
  // the failure that actually costs 90 seconds of silence: openBrowserAsync is fired and forgotten,
  // so a refused sheet left the poll loop running against a page nobody could see
  it('names the browser when the sign-in page refused to open', () => {
    expect(reconnectTrouble(new Error(HANDOFF_TIMEOUT), 'Another WebBrowser is already being presented.')).toBe(
      'The sign-in page did not open. Close the other page, then try again.',
    );
  });

  it('names the window when the page opened and nobody finished', () => {
    expect(reconnectTrouble(new Error(HANDOFF_TIMEOUT), null)).toBe('The sign-in did not finish. Tap Reconnect to try again.');
  });

  it('keeps the server its own words', () => {
    expect(reconnectTrouble(new Error('This session cannot refresh. Sign in again.'), null)).toBe('This session cannot refresh. Sign in again.');
  });

  it('never shows an unreadable throw', () => {
    const generic = 'Something went wrong. Check your connection, then try again.';
    expect(reconnectTrouble({ nope: true }, null)).toBe(generic);
    expect(reconnectTrouble(new Error('[object Object]'), null)).toBe(generic);
    expect(reconnectTrouble(new Error(''), null)).toBe(generic);
  });
});
