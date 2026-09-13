// Paging the session list (the mobile fix round, 2026-09-06). The arithmetic that decides whether
// a footer offers another page is pure, so it is proven here rather than by scrolling a phone.
import { describe, expect, it } from 'vitest';
import { hasMoreSessions, SESSION_MAX_PAGES, SESSION_PAGE } from '../src/session-page';

describe('hasMoreSessions', () => {
  it('a list that came back full has more behind it', () => {
    // the hook asks for one row MORE than the page needs: a full answer is the proof
    expect(hasMoreSessions({ threads: 26, tasks: 4, asked: 26 })).toBe(true);
    expect(hasMoreSessions({ threads: 4, tasks: 26, asked: 26 })).toBe(true);
  });
  it('a short list is the end of the list', () => {
    expect(hasMoreSessions({ threads: 25, tasks: 3, asked: 26 })).toBe(false);
    expect(hasMoreSessions({ threads: 0, tasks: 0, asked: 26 })).toBe(false);
  });
  it('a page is small enough to be cheap and big enough to fill a screen', () => {
    expect(SESSION_PAGE).toBeGreaterThanOrEqual(20);
    expect(SESSION_PAGE).toBeLessThanOrEqual(50);
  });
  it('the pages stop, so a long scroll cannot walk back to an unbounded read', () => {
    expect(SESSION_PAGE * SESSION_MAX_PAGES).toBeLessThanOrEqual(200);
  });
});
