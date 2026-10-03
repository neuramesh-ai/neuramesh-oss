// The routine writer (docs/design/routine-writer-2026-10/plan.md): rex posts a draft card, the person
// schedules what the card shows, and the session's talk before the divider is the setup, never a run.
import { describe, expect, it } from 'vitest';
import {
  ROUTINE_ASK, ROUTINE_SCHEDULED_MARKER, changedParts, draftIsLive, isRoutineScheduledMarker, isTryOnce, parseRoutineBlock,
  routineAsk, routineBlock, routineCardGuard, routineCardStates, routineCardText, routineChangesPrefix, routineDraftFrom, routineDraftsOf, routineDraftsReplies, routinePrompt, routineRepliesText, routineWhen,
  sessionRunWhen, sessionSetup, splitSessionRuns, stripRoutineBlocks, tryOnceBody, whenChanged, type RoutineDraft,
} from '../src';

const v1: RoutineDraft = {
  title: 'AI harness posts on X', cadence: 'weekdays', atTime: '09:00', tz: 'America/Vancouver',
  goal: 'Find the top posts about AI agent harnesses, and draft a reply to each one.',
  eachRun: 'Search X for posts from the last 24 hours about agent harnesses.',
  rules: 'A post must have 20,000 impressions or more.',
  output: 'A short report, then one drafted reply to each post. At most 5 posts.',
  ifNone: 'Say that no post passed the bar. Then show the best 3 below the bar.',
  never: 'Never publish a reply.',
};
const v2: RoutineDraft = { ...v1, eachRun: 'Search X and LinkedIn for posts from the last 24 hours about agent harnesses.', rules: 'A post must have 10,000 impressions or more.' };
const msg = (id: string, author_kind: string, created_at: string, body = '', schedule_id: string | null = null) => ({ id, author_kind, created_at, body, schedule_id });

describe('the draft block', () => {
  it('round-trips through the block rex posts', () => {
    const body = `I picked 20,000 as the bar.\n\n${routineBlock({ kind: 'draft', draft: v1 })}`;
    expect(parseRoutineBlock(body)).toEqual({ kind: 'draft', draft: v1 });
    expect(stripRoutineBlocks(body)).toBe('I picked 20,000 as the bar.');
  });

  it('reads the offer of a new session', () => {
    expect(parseRoutineBlock(routineBlock({ kind: 'offer', request: 'every Friday, sum up the week' }))).toEqual({ kind: 'offer', request: 'every Friday, sum up the week' });
  });

  it('refuses a draft with a missing part, a bad cadence, or a once with no time', () => {
    expect(routineDraftFrom({ ...v1, ifNone: '' })).toBeNull();
    expect(routineDraftFrom({ ...v1, cadence: 'hourly' })).toBeNull();
    expect(routineDraftFrom({ ...v1, cadence: 'once' })).toBeNull();
    expect(routineDraftFrom({ ...v1, cadence: 'once', runAt: '2026-10-02T16:00:00Z' })?.runAt).toBe('2026-10-02T16:00:00.000Z');
    expect(parseRoutineBlock('```nmroutine\nnot json\n```')).toBeNull();
    expect(parseRoutineBlock('no block here')).toBeNull();
  });

  it('clamps and defaults what it can', () => {
    const d = routineDraftFrom({ ...v1, title: 'x'.repeat(200), atTime: '9am', cadence: 'weekly', weekday: 9, agent: '@sol' })!;
    expect(d.title).toHaveLength(80);
    expect(d.atTime).toBe('09:00');
    expect(d.weekday).toBe(1);
    expect(d.agent).toBe('sol');
  });
});

describe('the armed prompt', () => {
  it('is each part under its heading, the order the card shows', () => {
    expect(routinePrompt(v1)).toBe([
      `Goal: ${v1.goal}`, `Each run: ${v1.eachRun}`, `Rules: ${v1.rules}`, `Output: ${v1.output}`, `If nothing matches: ${v1.ifNone}`, `Never: ${v1.never}`,
    ].join('\n\n'));
    expect(routinePrompt({ ...v1, never: null })).not.toContain('Never:');
  });

  it('fits schedule.create at every cap', () => {
    const big = routineDraftFrom({ ...v1, goal: 'a'.repeat(900), eachRun: 'b'.repeat(900), rules: 'c'.repeat(900), output: 'd'.repeat(900), ifNone: 'e'.repeat(900), never: 'f'.repeat(900) })!;
    expect(routinePrompt(big).length).toBeLessThanOrEqual(4000);
  });

  it('says when it runs', () => {
    expect(routineWhen(v1)).toBe('Weekdays · 09:00 · America/Vancouver');
    expect(routineWhen({ ...v1, tz: null }, 'Europe/London')).toBe('Weekdays · 09:00 · Europe/London');
    expect(routineWhen({ ...v1, cadence: 'weekly', weekday: 5, tz: null })).toBe('Fris · 09:00');
  });

  it('Try once posts the prompt under a run head', () => {
    expect(tryOnceBody(v1)).toBe(`Try once · ${v1.title}\n\n${routinePrompt(v1)}`);
    expect(isTryOnce(tryOnceBody(v1))).toBe(true);
    expect(isTryOnce(`Routine · ${v1.title}`)).toBe(false);
  });

  it('the doors and the changes prefix', () => {
    expect(ROUTINE_ASK).toBe('Make a routine: ');
    expect(routineAsk(' every Friday ')).toBe('Make a routine: every Friday');
    expect(routineChangesPrefix(2)).toBe('↩ Re routine v2: ');
  });
});

describe('the versions of one session', () => {
  const drafts = routineDraftsOf([
    msg('ask', 'human', '2026-10-01T15:04:00Z', 'Make a routine: every weekday at 9…'),
    msg('d1', 'agent', '2026-10-01T15:09:00Z', routineBlock({ kind: 'draft', draft: v1 })),
    msg('fake', 'human', '2026-10-01T15:10:00Z', routineBlock({ kind: 'draft', draft: v1 })),
    msg('d2', 'agent', '2026-10-01T15:11:00Z', routineBlock({ kind: 'draft', draft: v2 })),
  ]);

  it('numbers an agent\'s cards, oldest first', () => {
    expect(drafts.map((d) => [d.id, d.version])).toEqual([['d1', 1], ['d2', 2]]);
  });

  it('before the person schedules: the newest is open, the rest replaced', () => {
    expect([...routineCardStates(drafts, { linked: false })]).toEqual([['d1', 'replaced'], ['d2', 'open']]);
  });

  it('once scheduled: the draft at the divider is the one that runs', () => {
    expect([...routineCardStates(drafts, { linked: true, dividerAt: '2026-10-01T15:12:00Z' })]).toEqual([['d1', 'replaced'], ['d2', 'scheduled']]);
  });

  it('a newer draft for the live routine offers Update routine, until the routine runs it', () => {
    const v3 = { ...v2, atTime: '08:00' };
    const later = [...drafts, { id: 'd3', at: '2026-10-02T10:00:00Z', version: 3, draft: v3, author: null }];
    const live = { prompt: routinePrompt(v2), cadence: 'weekdays', atTime: '09:00', weekday: null };
    expect(routineCardStates(later, { linked: true, dividerAt: '2026-10-01T15:12:00Z', live }).get('d3')).toBe('update');
    const applied = { ...live, atTime: '08:00' };
    expect(draftIsLive(v3, applied)).toBe(true);
    const states = routineCardStates(later, { linked: true, dividerAt: '2026-10-01T15:12:00Z', live: applied });
    expect([states.get('d2'), states.get('d3')]).toEqual(['replaced', 'scheduled']);
  });

  it('tags what changed from the version before', () => {
    expect(changedParts(null, v1)).toEqual([]);
    expect(changedParts(v1, v2)).toEqual(['eachRun', 'rules']);
    expect(whenChanged(v1, v2)).toBe(false);
    expect(whenChanged(v1, { ...v1, atTime: '08:00' })).toBe(true);
  });
});

describe('the card is the tools\' alone', () => {
  const card = routineBlock({ kind: 'draft', draft: v1 });
  it('keeps a block a tool posted, and drops one an agent wrote into a reply', () => {
    // the third live run: v2 written by hand after its own words, past every check
    const forged = `${card}\n\nI have updated the routine. Click approve on the card.`;
    expect(routineCardGuard(forged, true)).toBe(forged);
    expect(routineCardGuard(forged, false)).toBe('I have updated the routine. Click approve on the card.');
    expect(routineCardGuard(card, false)).toBe('');
    expect(routineCardGuard('No card here.', false)).toBe('No card here.');
  });

  it('shows the transcript a card it can read, never the block to copy', () => {
    const text = routineCardText(`I picked 20,000 as the bar.\n\n${card}`);
    expect(text).not.toContain('```');
    expect(text).toContain('I picked 20,000 as the bar.\n[a routine draft card, posted with propose_routine: “AI harness posts on X” · Weekdays · 09:00 · America/Vancouver · Goal: ');
    expect(text).toContain('If nothing matches: Say that no post passed the bar.');
    expect(routineCardText(routineBlock({ kind: 'offer', request: 'every Friday, sum up the week' }))).toBe('[the offer card of a new session, posted with offer_routine_session: “every Friday, sum up the week”]');
    expect(routineCardText('plain words')).toBe('plain words');
  });
});

describe('the setup', () => {
  const S = 'sched-1';
  const rows = [
    msg('ask', 'human', '2026-10-01T15:04:00Z', 'Make a routine: every weekday at 9…'),
    msg('q', 'agent', '2026-10-01T15:05:00Z', 'Three answers decide what each run gives you.'),
    msg('d1', 'agent', '2026-10-01T15:09:00Z', routineBlock({ kind: 'draft', draft: v1 })),
    msg('div', 'human', '2026-10-01T15:12:00Z', ROUTINE_SCHEDULED_MARKER),
    msg('chat', 'human', '2026-10-01T15:20:00Z', 'Thanks.'),
    msg('o1', 'human', '2026-10-02T16:00:00Z', 'Routine · AI harness posts on X', S),
    msg('r1', 'agent', '2026-10-02T16:06:00Z', 'Five posts passed.'),
  ];

  it('the divider is a marker, nothing else is', () => {
    expect(isRoutineScheduledMarker(` ${ROUTINE_SCHEDULED_MARKER}\n`)).toBe(true);
    expect(isRoutineScheduledMarker(`rex: ${ROUTINE_SCHEDULED_MARKER}`)).toBe(false);
  });

  it('splits the talk that wrote the routine from what came after the divider', () => {
    const s = sessionSetup(rows)!;
    expect(s.setup.map((m) => m.id)).toEqual(['ask', 'q', 'd1']);
    expect(s.divider.id).toBe('div');
    expect(s.between.map((m) => m.id)).toEqual(['chat']);
    expect(sessionSetup(rows.filter((m) => m.id !== 'div'))).toBeNull();
  });

  it('says when the first run posts, in a sentence', () => {
    const now = Date.parse('2026-10-01T15:12:00');
    expect(sessionRunWhen('2026-10-02T09:00:00', now)).toBe('tomorrow at 09:00');
    expect(sessionRunWhen('2026-10-01T18:00:00', now)).toBe('today at 18:00');
    expect(sessionRunWhen('2026-10-05T09:00:00', now)).toBe('on Oct 5 at 09:00');
  });

  it('only a run\'s opener opens a run after the divider, and none may have yet', () => {
    expect(splitSessionRuns(rows, S)!.map((f) => [f.opener.id, f.messages.map((m) => m.id)])).toEqual([['o1', ['o1', 'r1']]]);
    expect(splitSessionRuns(rows.slice(0, 5), S)).toEqual([]);
  });
});

describe('the Replies part (models-and-replies round)', () => {
  it('reads a gap, and writes the card\'s sentence when rex sent no words for it', () => {
    const d = routineDraftFrom({ ...v1, replyGap: 8 })!;
    expect(d.replyGap).toBe(8);
    expect(d.replies).toBe('Queue each reply 8 minutes apart, from the end of the run. Remind me to post each one in X.');
    expect(routinePrompt(d)).toContain('Replies: Queue each reply 8 minutes apart');
    // the part sits after Output and before If nothing matches, as the card shows it
    expect(routinePrompt(d).indexOf('Output:')).toBeLessThan(routinePrompt(d).indexOf('Replies:'));
    expect(routinePrompt(d).indexOf('Replies:')).toBeLessThan(routinePrompt(d).indexOf('If nothing matches:'));
  });

  it('drops a gap that is not one of the four, and keeps drafts-only words', () => {
    expect(routineDraftFrom({ ...v1, replyGap: 7 })!.replyGap).toBeUndefined();
    const d = routineDraftFrom({ ...v1, replies: routineRepliesText(null) })!;
    expect(d.replies).toBe('Draft them only. I post them myself.');
    expect(d.replyGap).toBeUndefined();
    expect(routinePrompt(routineDraftFrom(v1)!)).not.toContain('Replies:');
  });

  it('round-trips the gap through the block and tags it Changed', () => {
    const d = routineDraftFrom({ ...v1, replyGap: 12 })!;
    expect(parseRoutineBlock(routineBlock({ kind: 'draft', draft: d }))).toEqual({ kind: 'draft', draft: d });
    expect(changedParts(routineDraftFrom(v1), d)).toEqual(['replies']);
  });

  it('knows a routine that drafts replies or responses', () => {
    expect(routineDraftsReplies(v1)).toBe(true);
    expect(routineDraftsReplies({ goal: 'Find posts and draft concrete responses', eachRun: 'Search', output: 'A list' })).toBe(true);
    expect(routineDraftsReplies({ goal: 'Sum up the week', eachRun: 'Read the board', output: 'A short report' })).toBe(false);
  });
});
