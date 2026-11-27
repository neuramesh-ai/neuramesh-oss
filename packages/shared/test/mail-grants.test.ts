// One approved read (plan I12): the search the card shows is the search the API runs, the limits hold, and a word can
// never carry a Gmail operator the person did not see.
import { describe, expect, it } from 'vitest';
import { MAIL_READ_SEARCH, calendarDays, grantSearch, grantState, mailReadDone, mailReadLines, mailReadQuery } from '../src/mail-grants';

describe('the read search', () => {
  it('runs the people and the days the card shows, and nothing more', () => {
    const s = MAIL_READ_SEARCH.parse({ mail: { people: ['Lena@Pinecrest.com', 'priya@halcyongrid.com'], days: 90, max: 20 } });
    expect(mailReadQuery(s.mail!)).toBe('(from:lena@pinecrest.com OR to:lena@pinecrest.com OR cc:lena@pinecrest.com OR from:priya@halcyongrid.com OR to:priya@halcyongrid.com OR cc:priya@halcyongrid.com) newer_than:90d');
    expect(mailReadLines(s)).toEqual(['Your mail with lena@pinecrest.com and priya@halcyongrid.com, the last 90 days, up to 20 threads']);
  });

  it('refuses a word with an operator, a search with nothing in it, and a range past the limits', () => {
    expect(MAIL_READ_SEARCH.safeParse({ mail: { words: 'in:anywhere', days: 7, max: 5 } }).success).toBe(false);
    expect(MAIL_READ_SEARCH.safeParse({ mail: { words: '"invoice"', days: 7, max: 5 } }).success).toBe(false);
    expect(MAIL_READ_SEARCH.safeParse({ mail: { days: 7, max: 5 } }).success).toBe(false);
    expect(MAIL_READ_SEARCH.safeParse({}).success).toBe(false);
    expect(MAIL_READ_SEARCH.safeParse({ mail: { words: 'launch', days: 91, max: 5 } }).success).toBe(false);
    expect(MAIL_READ_SEARCH.safeParse({ mail: { words: 'launch', days: 7, max: 21 } }).success).toBe(false);
    expect(MAIL_READ_SEARCH.safeParse({ calendar: { from: '2026-12-01', to: '2026-12-31' } }).success).toBe(false);
    expect(MAIL_READ_SEARCH.safeParse({ calendar: { from: '2026-12-04', to: '2026-11-30' } }).success).toBe(false);
  });

  it('says a calendar range in days, both ends counted', () => {
    const s = MAIL_READ_SEARCH.parse({ calendar: { from: '2026-11-30', to: '2026-12-04' } });
    expect(calendarDays(s.calendar!)).toBe(5);
    expect(mailReadLines(s)).toEqual(['Your calendar, Monday Nov 30 to Friday Dec 4']);
    expect(mailReadLines(MAIL_READ_SEARCH.parse({ mail: { words: 'field sync', days: 1, max: 1 } }))).toEqual(['Your mail about "field sync", the last 1 day, up to 1 thread']);
  });

  it('reads a row: its search from JSON text, an hour that ended, and the done line', () => {
    expect(grantSearch({ search: '{"calendar":{"from":"2026-11-30","to":"2026-12-04"}}' })?.calendar?.to).toBe('2026-12-04');
    expect(grantSearch({ search: 'not json' })).toBeNull();
    expect(grantState({ status: 'allowed', expires_at: '2026-11-23T10:00:00Z' }, Date.parse('2026-11-23T10:00:01Z'))).toBe('expired');
    expect(grantState({ status: 'allowed', expires_at: '2026-11-23T10:00:00Z' }, Date.parse('2026-11-23T09:59:00Z'))).toBe('allowed');
    expect(mailReadDone({ read_threads: 6, read_days: 5 })).toBe('6 threads and 5 days of your calendar');
    expect(mailReadDone({ read_threads: 1, read_days: null }, 'the')).toBe('1 thread');
  });
});
