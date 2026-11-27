// ONE APPROVED READ OF A PERSON'S MAIL OR CALENDAR (docs/design/inbox-sales-2026-11/plan.md I12, CLAUDE.md rule 5).
// An agent asks for ONE search, the person allows it once, and the agent of the ask reads it in its session within
// the hour. These are the rules every side reads: the limits, the search's shape, the Gmail query the API runs, and
// the words the card shows. Pure, so the card shows exactly the search that the API runs.
import { z } from 'zod';
import { EMAIL_SHAPE } from './email-drafts';

/** a mail search reaches back at most 90 days and reads at most 20 threads, and a calendar range is at most 30 days */
export const MAIL_READ_DAYS_MAX = 90;
export const MAIL_READ_THREADS_MAX = 20;
export const CALENDAR_READ_DAYS_MAX = 30;
export const MAIL_READ_PEOPLE_MAX = 10;
/** Allow once lives one hour */
export const MAIL_GRANT_MS = 60 * 60_000;

/** words only: a colon, a quote or a bracket would make a Gmail operator that the card does not show */
const WORDS = /^[\p{L}\p{N} .,'&@+_-]*$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const MAIL_READ_SEARCH = z.object({
  mail: z.object({
    people: z.array(z.string().trim().toLowerCase().max(320).regex(EMAIL_SHAPE, 'one email address')).max(MAIL_READ_PEOPLE_MAX).default([]),
    words: z.string().trim().max(200).regex(WORDS, 'words only, with no colon, quote or bracket').default(''),
    days: z.number().int().min(1).max(MAIL_READ_DAYS_MAX),
    max: z.number().int().min(1).max(MAIL_READ_THREADS_MAX),
  }).refine((m) => m.people.length > 0 || m.words.length > 0, 'name the people or the words to search for').optional(),
  calendar: z.object({ from: z.string().regex(DAY), to: z.string().regex(DAY) })
    .refine((c) => calendarDays(c) >= 1 && calendarDays(c) <= CALENDAR_READ_DAYS_MAX, `a calendar range of 1 to ${CALENDAR_READ_DAYS_MAX} days, from before to`).optional(),
}).refine((s) => !!s.mail || !!s.calendar, 'ask for the mail, the calendar, or both');
export type MailReadSearch = z.infer<typeof MAIL_READ_SEARCH>;

/** the days of a calendar range, both ends counted: Monday to Friday is 5 */
export function calendarDays(c: { from: string; to: string }): number {
  const a = Date.parse(`${c.from}T00:00:00Z`), b = Date.parse(`${c.to}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.round((b - a) / 86_400_000) + 1;
}

/** the Gmail query of a mail search: the people in From, To or Cc, the words, and the days back */
export function mailReadQuery(m: NonNullable<MailReadSearch['mail']>): string {
  const people = m.people.flatMap((p) => [`from:${p}`, `to:${p}`, `cc:${p}`]);
  return [people.length ? `(${people.join(' OR ')})` : '', m.words, `newer_than:${m.days}d`].filter(Boolean).join(' ');
}

export type MailGrantStatus = 'asked' | 'allowed' | 'declined' | 'used';

/** one ask as the replica holds it (0203). `search` is JSON text there */
export interface MailGrantRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  thread_id: string;
  agent_id: string;
  search: string | MailReadSearch;
  reason: string;
  status: MailGrantStatus | string;
  allowed_by: string | null;
  allowed_at: string | null;
  expires_at: string | null;
  used_at: string | null;
  read_threads: number | null;
  read_days: number | null;
  created_at: string;
  updated_at: string;
}

/** the search of a row, or null when the row holds no search this client can read */
export function grantSearch(row: Pick<MailGrantRow, 'search'>): MailReadSearch | null {
  try {
    const parsed = MAIL_READ_SEARCH.safeParse(typeof row.search === 'string' ? JSON.parse(row.search) : row.search);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** what the card shows: an allowed grant whose hour ended reads as expired */
export function grantState(row: Pick<MailGrantRow, 'status' | 'expires_at'>, nowMs: number): MailGrantStatus | 'expired' {
  if (row.status === 'allowed' && row.expires_at && Date.parse(row.expires_at) <= nowMs) return 'expired';
  return row.status as MailGrantStatus;
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const DAY_NAME = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const dayName = (d: string) => DAY_NAME.format(new Date(`${d}T00:00:00Z`)).replace(',', '');

/** the search in the person's words, one line for the mail and one for the calendar (frame 14) */
export function mailReadLines(s: MailReadSearch): string[] {
  const out: string[] = [];
  if (s.mail) {
    const what = [s.mail.people.length ? `with ${list(s.mail.people)}` : '', s.mail.words ? `about "${s.mail.words}"` : ''].filter(Boolean).join(' ');
    out.push(`Your mail ${what}, the last ${s.mail.days} ${s.mail.days === 1 ? 'day' : 'days'}, up to ${s.mail.max} ${s.mail.max === 1 ? 'thread' : 'threads'}`);
  }
  if (s.calendar) out.push(s.calendar.from === s.calendar.to ? `Your calendar, ${dayName(s.calendar.from)}` : `Your calendar, ${dayName(s.calendar.from)} to ${dayName(s.calendar.to)}`);
  return out;
}

/** what the read gave the agent, for the card's done line: "6 threads and 5 days of your calendar" */
export function mailReadDone(row: Pick<MailGrantRow, 'read_threads' | 'read_days'>, whose = 'your'): string {
  const parts = [
    row.read_threads != null ? `${row.read_threads} ${row.read_threads === 1 ? 'thread' : 'threads'}` : '',
    row.read_days != null ? `${row.read_days} ${row.read_days === 1 ? 'day' : 'days'} of ${whose} calendar` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' and ') : 'nothing';
}
