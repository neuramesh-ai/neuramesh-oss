// The Pro handoff's pure core: the nonce the desktop hands the /pro page must survive the trip
// through Stripe (the success_url is built server-side and cannot carry it), and the workspace
// the checkout names must be the one the person owns.
import { describe, expect, it } from 'vitest';
import { NONCE_MAX_AGE_MS, pickWorkspace, stashNonce, takeNonce } from './pro-handoff';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: () => null,
    get length() { return m.size; },
  } as Storage;
}

describe('the nonce across the Stripe round trip', () => {
  it('comes back once, then is gone', () => {
    const s = memStorage();
    stashNonce(s, 'abc', 1_000);
    expect(takeNonce(s, 2_000)).toBe('abc');
    expect(takeNonce(s, 2_000)).toBeNull();
  });
  it('is dropped when older than the window the desktop waits', () => {
    const s = memStorage();
    stashNonce(s, 'abc', 0);
    expect(takeNonce(s, NONCE_MAX_AGE_MS + 1)).toBeNull();
  });
  it('is null when nothing was stashed or the record is garbage', () => {
    const s = memStorage();
    expect(takeNonce(s, 0)).toBeNull();
    s.setItem('nm:pro:nonce', '{not json');
    expect(takeNonce(s, 0)).toBeNull();
  });
});

describe('the workspace the checkout names', () => {
  it('prefers the one the person owns, then the first', () => {
    expect(pickWorkspace([{ id: 'a', role: 'member', plan: 'free' }, { id: 'b', role: 'owner', plan: 'free' }])?.id).toBe('b');
    expect(pickWorkspace([{ id: 'a', role: 'member', plan: 'free' }])?.id).toBe('a');
    expect(pickWorkspace([])).toBeNull();
  });
});
