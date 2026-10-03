// THE ROUTINE WRITER (docs/design/routine-writer-2026-10/plan.md; George, 2026-10-01: "humans are bad at
// writing exactly what they want"). rex writes a routine WITH the person: it asks for what is missing, then
// posts the draft card. The person schedules it with one click from their own client, because
// schedule.create is human-only ("agents propose, humans arm"). These tools only post a card.
//
// The spec rides the SCHEMA, not the prompt: every part is its own required field, so a draft that never
// says what a run does when nothing matches cannot be posted at all (the screenshot's run lowered its own
// bar). So do the values rex picked itself: `defaults` is required and shows above the card, and a guess is
// ASKED before it is drafted: the tool refuses a draft with a guess until a question card was asked in the
// session (the live runs drafted at once and invented the bar twice, prompted not to). The tool finds the
// guess itself too: a number in the rules the person never wrote is a bar rex chose, whatever `defaults`
// says (the fourth run said "none" over an invented 500 impressions), and it shows above the card. A
// request that gives every value still drafts at once. A time zone the person never named is dropped (the first live run set
// UTC): the client arms the person's own zone. Named means in any words a person uses for it, so "Eastern
// Time" picked on rex's own question card keeps America/New_York, and a zone Intl cannot read is dropped
// (Schedule it would fail on it). The note names neither a time zone nor a value the person wrote (the third
// run's note said UTC over a card that ran in Vancouver, and named her answer as its pick).
// The card is the tools' alone: they post it with `routineCard`, and the server drops a block an agent wrote
// into a reply (routineCardGuard), so no draft skips these checks. The contract carries only the judgment:
// when to write one.
//
// Both are CONDITIONAL spreads, like the code door (tools-room.ts): a tool that does not apply to this turn
// does not exist. propose_routine needs a conversation, the session the routine will run in. The offer
// works anywhere rex answers, and is the way out of a task's thread or a session busy with other work.
import { ROUTINE_PART_MAX, ROUTINE_TITLE_MAX, routineBlock, routineDraftFrom, routineDraftsReplies } from '@neuramesh/shared';
import type { OrchTool, ToolCtx } from './orchtools';

const TZ = /time ?zone|\b(?:utc|gmt)\b|\b(?:africa|america|antarctica|asia|atlantic|australia|europe|indian|pacific|etc)\/\w+/i;

/** the words a person may use for a time zone: its IANA name, its city, its English names (Eastern Time, EST). null: not a zone */
export function zoneWords(tz: string): string[] | null {
  const name = (month: number, timeZoneName: Intl.DateTimeFormatOptions['timeZoneName']) => {
    try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName }).formatToParts(new Date(Date.UTC(2026, month, 15))).find((p) => p.type === 'timeZoneName')?.value ?? ''; } catch { return null; }
  };
  if (name(0, 'short') === null) return null;
  const all = [tz, tz.split('/').pop()!.replace(/_/g, ' '), name(0, 'longGeneric'), name(0, 'long'), name(6, 'long'), name(0, 'short'), name(6, 'short')];
  return [...new Set(all.filter((n): n is string => !!n && !/^gmt[+-]/i.test(n)).map((n) => n.toLowerCase()))];
}

/** did the person name this zone in `said` (lowercase), in whole words */
export function zoneNamed(said: string, tz: string): boolean {
  const words = zoneWords(tz);
  return !!words && words.some((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(said));
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const NUM = new RegExp(`(\\d(?:[\\d,]*\\d)?(?:\\.\\d+)?k?\\+?|\\b(?:${WORDS.join('|')})\\b)(\\s+[a-z][\\w-]*)?`, 'gi');
const valueOf = (s: string) => (WORDS.includes(s.toLowerCase()) ? WORDS.indexOf(s.toLowerCase()) : parseFloat(s.replace(/[,+]/g, '')) * (/k\+?$/i.test(s) ? 1000 : 1));

/** the numbers a text carries, each with the word after it ("500 impressions"): 10,000 and 10k are one value. A clock time is the schedule */
export function numbersIn(text: string): Array<{ value: number; phrase: string }> {
  return [...text.replace(/\b\d{1,2}:\d{2}\b/g, ' ').matchAll(NUM)].map((m) => ({ value: valueOf(m[1]!), phrase: `${m[1]}${m[2] ?? ''}`.trim() })).filter((n) => Number.isFinite(n.value));
}

/** the bars in a draft's rules that the person never wrote: each one rex chose */
export function inventedBars(rules: string, said: string): string[] {
  const theirs = new Set(numbersIn(said).map((n) => n.value));
  return numbersIn(rules).filter((n) => !theirs.has(n.value)).map((n) => n.phrase);
}

/** the line above the card: the values rex chose, never a time zone (the when line shows it) or a value in `said` (lowercase) */
export function routineNote(defaults: string, said: string): string {
  if (/^none\.?$/i.test(defaults.trim())) return '';
  const theirs = (c: string) => { const v = c.split(':').pop()!.trim().toLowerCase(); return v.length >= 4 && /[a-z]/.test(v) && said.includes(v); };
  const clauses = defaults.split(/,\s+|;\s*|\n+|\.\s+/).flatMap((c) => (TZ.test(c) ? c.split(/\s+and\s+/) : [c])).map((c) => c.trim().replace(/\.$/, '')).filter(Boolean);
  const kept = clauses.filter((c) => !TZ.test(c) && !theirs(c));
  return kept.length === clauses.length ? defaults.trim() : kept.join(', ');
}

export function routineTools(tc: ToolCtx): OrchTool[] {
  const { z, db, post, ch, actor, thread, convoThreadId, here, log } = tc;
  /** has rex asked a question card in this session: a guess is asked before it is drafted */
  const askedHere = async () => (await db.getAll<{ n: number }>(`select count(*) as n from messages where thread_id = ? and author_kind = 'agent' and body like '%\`\`\`nmq%'`, [convoThreadId]).catch(() => [{ n: 0 }]))[0]?.n ? true : false;
  /** what the people in this session wrote, lowercase */
  const saidHere = async () => (await db.getAll<{ body: string }>(`select body from messages where thread_id = ? and author_kind = 'human'`, [convoThreadId]).catch(() => [] as Array<{ body: string }>))
    .map((m) => m.body.toLowerCase()).join('\n');
  const part = (what: string) => z.string().min(1).max(ROUTINE_PART_MAX).describe(what);
  const anchor = convoThreadId ? { threadId: convoThreadId } : thread ? { taskId: thread.id } : null;
  return [
    ...(convoThreadId && !thread ? [{
      name: 'propose_routine',
      description: 'Post the ROUTINE DRAFT card in THIS session. The human schedules it with one click, tries it once, edits it, or asks for changes. Call it only when every part is known, and for a routine that drafts replies, how they go out. A change is a new call with the WHOLE routine (the next version). Where the routine already runs, the card offers Update routine. Only their click schedules it.',
      schema: {
        title: z.string().min(1).max(ROUTINE_TITLE_MAX).describe('2 to 6 plain words'),
        cadence: z.enum(['daily', 'weekdays', 'weekly', 'once']),
        atTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe('HH:MM, 24-hour'),
        weekday: z.number().int().min(0).max(6).optional().describe('weekly: 0 Sunday … 6 Saturday'),
        runAt: z.string().optional().describe('once: the ISO time'),
        tz: z.string().max(64).optional().describe('IANA, only a zone they named. Absent: their own zone'),
        agent: z.string().max(40).optional().describe('who runs it, if not you'),
        goal: part('what each run gives them'),
        eachRun: part('where a run looks, the time window, the keywords'),
        rules: part('the hard filters, with numbers'),
        output: part('the form and the size of what it delivers'),
        ifNone: part('what a run does when nothing passes: say so, or relax by a stated rule'),
        never: z.string().max(ROUTINE_PART_MAX).optional().describe('what a run never does'),
        replies: z.string().max(ROUTINE_PART_MAX).optional().describe('a routine that drafts replies: how they go out, as they answered'),
        replyGap: z.union([z.literal(5), z.literal(8), z.literal(12), z.literal(20)]).optional().describe('their queue gap in minutes, when they chose a queue'),
        defaults: z.string().min(1).max(300).describe('one line naming each value you chose that they did not give (a bar, a limit, a source). It shows above the card, and a guess must be asked with a question card first. "none" when they gave every value'),
      },
      run: async (input: Record<string, unknown>) => {
        const draft = routineDraftFrom(input);
        if (!draft) return 'error: the draft needs a title, a cadence and every part (goal, eachRun, rules, output, ifNone). A once routine also needs runAt. Ask for what is missing with a question card';
        // a run's replies go out the way the person said: a queue at a gap, or drafts only. Asked, never assumed
        if (routineDraftsReplies(draft) && !draft.replies && !draft.replyGap) {
          log?.({ kind: 'tool', phase: 'result', summary: 'routine draft refused: ask how replies go out' });
          return 'refused: this routine drafts replies. Ask how they go out with one nmq card: a queue a few minutes apart (5, 8, 12 or 20) with a reminder for each, or drafts only. Then call propose_routine with replies, and replyGap for a queue';
        }
        const said = await saidHere();
        if (draft.tz && !zoneNamed(said, draft.tz)) delete draft.tz;
        const given = routineNote(typeof input['defaults'] === 'string' ? input['defaults'] : '', said);
        const told = new Set(numbersIn(given).map((n) => n.value));
        const bars = inventedBars(draft.rules, said).filter((b) => !told.has(numbersIn(b)[0]!.value));
        const note = bars.length ? [given.replace(/\.$/, ''), `I chose ${bars.join(', ')}`].filter(Boolean).join('. ') : given;
        if (note && !(await askedHere())) {
          log?.({ kind: 'tool', phase: 'result', summary: `routine draft refused: ask first (${note})` });
          return `refused: you chose values they did not give (${note}). Ask first: one nmq card with your pick as one of its options. Call propose_routine after they answer`;
        }
        const res = await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: here(), threadId: convoThreadId, body: [note, routineBlock({ kind: 'draft', draft })].filter(Boolean).join('\n\n'), routineCard: true });
        if (!res.ok) return `error ${res.status}: the card did not post`;
        log?.({ kind: 'tool', phase: 'result', summary: `routine draft “${draft.title}” (${draft.cadence} ${draft.atTime})` });
        return 'the draft card is in the thread. Reply in ONE line and stop. Never say it is scheduled: their click on Schedule it schedules it.';
      },
    }] : []),
    ...(anchor ? [{
      name: 'offer_routine_session',
      description: 'A routine request that cannot be written HERE (a task\'s thread, or a session busy with other work or a routine): post the card that opens a new session with it. Then reply in ONE line.',
      schema: { request: z.string().min(1).max(1000).describe('the request, in their words') },
      run: async (input: { request: string }) => {
        const res = await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: here(), ...anchor, body: routineBlock({ kind: 'offer', request: input.request.trim() }), routineCard: true });
        if (!res.ok) return `error ${res.status}: the card did not post`;
        log?.({ kind: 'tool', phase: 'result', summary: 'offered a new session for a routine' });
        return 'the card is in the thread. Reply in ONE line and stop.';
      },
    }] : []),
  ];
}
