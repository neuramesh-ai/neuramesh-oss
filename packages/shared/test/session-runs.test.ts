// One session per routine (docs/design/routine-sessions-2026-09/plan.md): a schedule's session splits into
// runs at the messages that carry the schedule, and each run's strip is derived, never stored.
import { describe, expect, it } from 'vitest';
import { authCardBlock, draftLetters, githubConnectedMarker, sessionRunFacts, sessionRunLines, sessionRunLabel, sessionRunOpen, sessionRunStrip, inSessionRun, isSessionRunNotice, splitSessionRuns, tookLabel, type SessionRunFacts, type SessionRunMessage } from '../src';

const S = 'sched-1';
const NOW = Date.parse('2026-09-27T16:02:00Z');
const at = (iso: string) => new Date(Date.parse(iso)).toISOString();
const msg = (id: string, author_kind: string, created_at: string, body = '', schedule_id: string | null = null): SessionRunMessage =>
  ({ id, author_kind, body, created_at: at(created_at), schedule_id });
const none: SessionRunFacts = { openRuns: 0, gates: 0, cards: 0, draftsWaiting: 0, units: [], drafts: 0, files: 0 };

describe('splitSessionRuns', () => {
  it('a thread that is no schedule\'s does not split', () => {
    expect(splitSessionRuns([msg('a', 'human', '2026-09-27T09:00:00Z')], null)).toBeNull();
    expect(splitSessionRuns([], S)).toBeNull();
  });

  it('a run opens at each message that carries the schedule, and the first message opens one too', () => {
    const f = splitSessionRuns([
      msg('o1', 'human', '2026-09-25T09:00:00Z', 'Morning dependency audit'), // before 0145: no column
      msg('r1', 'agent', '2026-09-25T09:06:00Z', 'Filed #1139.'),
      msg('o2', 'human', '2026-09-26T09:00:00Z', 'Morning dependency audit', S),
      msg('r2', 'agent', '2026-09-26T09:08:00Z', 'Two packages need work.'),
      msg('h2', 'human', '2026-09-26T09:31:00Z', 'Do lodash first.'),
      msg('o3', 'human', '2026-09-27T16:00:00Z', 'Morning dependency audit', S),
    ], S)!;
    expect(f.map((x) => x.opener.id)).toEqual(['o1', 'o2', 'o3']);
    expect(f[1]!.messages.map((m) => m.id)).toEqual(['o2', 'r2', 'h2']);
    expect(f[0]!.until).toBe(f[1]!.at);
    expect(f[2]!.until).toBeNull();
  });

  it('order is by time, not by the order rows arrive in', () => {
    const f = splitSessionRuns([
      msg('r1', 'agent', '2026-09-26T09:02:00Z'),
      msg('o1', 'human', '2026-09-26T09:00:00Z', 'x', S),
    ], S)!;
    expect(f).toHaveLength(1);
    expect(f[0]!.messages.map((m) => m.id)).toEqual(['o1', 'r1']);
  });

  it('inSessionRun holds a run\'s window: its opener up to the next opener', () => {
    const f = { at: at('2026-09-26T09:00:00Z'), until: at('2026-09-27T09:00:00Z') };
    expect(inSessionRun(f, at('2026-09-26T10:00:00Z'))).toBe(true);
    expect(inSessionRun(f, at('2026-09-27T09:00:00Z'))).toBe(false);
    expect(inSessionRun({ ...f, until: null }, at('2026-09-30T09:00:00Z'))).toBe(true);
  });
});

describe('sessionRunStrip', () => {
  const lastRun = (msgs: SessionRunMessage[]) => splitSessionRuns(msgs, S)!.at(-1)!;
  const opener = msg('o', 'human', '2026-09-27T16:00:00Z', 'Morning dependency audit', S);

  it('a unit at a person\'s gate, an open card or a waiting draft: Needs you', () => {
    const f = lastRun([opener, msg('r', 'agent', '2026-09-27T16:08:00Z', 'Two packages need work.')]);
    const s = sessionRunStrip(f, { ...none, gates: 1, units: [{ number: 1146, title: 'Patch lodash' }, { number: 1147, title: 'Plan React 19' }] }, NOW);
    expect(s).toMatchObject({ state: 'needs', word: 'Needs you', took: '8 min', made: ['2 units'], line: '#1146 Patch lodash' });
    expect(sessionRunStrip(f, { ...none, cards: 1 }, NOW).state).toBe('needs');
    expect(sessionRunStrip(f, { ...none, draftsWaiting: 1 }, NOW).state).toBe('needs');
  });

  it('an open agent run, or a new opener inside the wait limit: In progress, timed so far', () => {
    expect(sessionRunStrip(lastRun([opener]), none, NOW - 60_000)).toMatchObject({ state: 'progress', word: 'In progress', took: '1 min so far' });
    expect(sessionRunStrip(lastRun([opener]), { ...none, openRuns: 1 }, NOW + 10 * 60_000).took).toBe('12 min so far');
  });

  it('an answer: Done, with the newest agent line', () => {
    const s = sessionRunStrip(lastRun([opener, msg('r', 'agent', '2026-09-27T16:03:00Z', 'No new CVEs or major versions.')]), none, NOW + 3600_000);
    expect(s).toMatchObject({ state: 'done', took: '3 min', made: [], line: 'No new CVEs or major versions.' });
  });

  it('only notices came back, or no answer past the wait limit: Failed, with the reason', () => {
    const notice = "I can't run this now. This machine has no Claude login. Sign in to Claude on this machine, or ask a teammate.";
    expect(sessionRunStrip(lastRun([opener, msg('n', 'agent', '2026-09-27T16:00:12Z', notice)]), none, NOW))
      .toMatchObject({ state: 'failed', word: 'Failed', took: '12 s', line: 'This machine has no Claude login.' });
    expect(sessionRunStrip(lastRun([opener]), none, NOW + 5 * 60_000)).toMatchObject({ state: 'failed', line: 'No answer came.' });
    const card = `@scout cannot run.\n\n${authCardBlock({ provider: 'anthropic', agent: 'scout' })}`;
    expect(sessionRunStrip(lastRun([opener, msg('c', 'agent', '2026-09-27T16:00:05Z', card)]), none, NOW).line).toBe('@scout has no Claude login here.');
  });

  it('an older run with no answer failed, however young it is', () => {
    const f = splitSessionRuns([opener, msg('o2', 'human', '2026-09-27T16:01:00Z', 'x', S)], S)![0]!;
    expect(sessionRunStrip(f, none, NOW).state).toBe('failed');
  });

  it('a draft run opens with the agent\'s own draft, so it is done by itself, and a failed publish says why', () => {
    const f = lastRun([msg('d', 'agent', '2026-09-27T07:00:00Z', 'Scheduled draft · Daily X post · for 10:00\n\nThe fastest review...', S)]);
    expect(sessionRunStrip(f, { ...none, drafts: 1 }, NOW)).toMatchObject({ state: 'done', took: '', made: ['1 draft'] });
    expect(sessionRunStrip(f, { ...none, drafts: 1, failure: 'X refused the post.' }, NOW)).toMatchObject({ state: 'failed', line: 'X refused the post.' });
  });
});

describe('the words', () => {
  it('tookLabel says a span short', () => {
    expect([tookLabel(12_000), tookLabel(6 * 60_000), tookLabel(65 * 60_000), tookLabel(120 * 60_000)]).toEqual(['12 s', '6 min', '1 h 5 min', '2 h']);
  });

  it('sessionRunLabel: Today, Yesterday, then the date, and the year once it differs', () => {
    const now = new Date(2026, 8, 27, 16, 2).getTime();
    const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).toISOString();
    expect(sessionRunLabel(local(2026, 8, 27, 9, 0), now)).toBe('Today, 09:00');
    expect(sessionRunLabel(local(2026, 8, 26, 9, 0), now)).toBe('Yesterday, 09:00');
    expect(sessionRunLabel(local(2026, 8, 25, 9, 0), now)).toBe('Sep 25, 09:00');
    expect(sessionRunLabel(local(2025, 11, 31, 23, 5), now)).toBe('Dec 31, 2025, 23:05');
    expect(sessionRunLabel(local(2026, 8, 28, 9, 0), now)).toBe('Tomorrow, 09:00');
  });

  it('the newest run opens, and so does one that needs its person', () => {
    expect([sessionRunOpen('done', true), sessionRunOpen('needs', false), sessionRunOpen('done', false), sessionRunOpen('failed', false)]).toEqual([true, true, false, false]);
  });

  it('isSessionRunNotice knows the daemon\'s notices and nothing else', () => {
    expect(isSessionRunNotice("I can't run this now. No machine available to me can serve Claude.")).toBe(true);
    expect(isSessionRunNotice("I can't reply now. This workspace is out of credits.")).toBe(true);
    expect(isSessionRunNotice('Waking your cloud machine. It holds the Claude login this needs.')).toBe(true);
    expect(isSessionRunNotice('No new CVEs today.')).toBe(false);
  });
});

describe('sessionRunFacts places the session\'s rows in their runs', () => {
  const runs = splitSessionRuns([
    msg('o1', 'human', '2026-09-26T09:00:00Z', 'Morning dependency audit', S),
    msg('r1', 'agent', '2026-09-26T09:08:00Z', 'Two packages need work.'),
    msg('o2', 'human', '2026-09-27T09:00:00Z', 'Morning dependency audit', S),
    msg('r2', 'agent', '2026-09-27T09:06:00Z', 'Filed #1150.'),
  ], S)!;
  const unit = (number: number, state: string, created_at: string, extra: Record<string, unknown> = {}) =>
    ({ number, title: `unit ${number}`, state, created_at: at(created_at), updated_at: at(created_at), ...extra });

  it('a unit counts in the run it was born in, and its gate is the thread status\'s rule', () => {
    const units = [unit(1146, 'plan_review', '2026-09-26T09:07:00Z'), unit(1147, 'in_progress', '2026-09-26T09:07:30Z'), unit(1150, 'done', '2026-09-27T09:05:00Z')];
    const day1 = sessionRunFacts(runs[0]!, { units });
    expect(day1).toMatchObject({ gates: 1, units: [{ number: 1146, title: 'unit 1146' }, { number: 1147, title: 'unit 1147' }] });
    expect(sessionRunFacts(runs[1]!, { units })).toMatchObject({ gates: 1, units: [{ number: 1150, title: 'unit 1150' }] });
    // a plan the person approved rests in plan_review with the stamp: nobody waits on it
    expect(sessionRunFacts(runs[0]!, { units: [unit(1146, 'plan_review', '2026-09-26T09:07:00Z', { plan_approved_at: at('2026-09-26T09:30:00Z') })] }).gates).toBe(0);
  });

  it('a card counts in the run that holds its message, while it is open and nobody answered it', () => {
    const card = { message_id: 'r1', status: 'open', created_at: at('2026-09-26T09:08:00Z'), allow_other: 1 };
    expect(sessionRunFacts(runs[0]!, { cards: [card] }).cards).toBe(1);
    expect(sessionRunFacts(runs[1]!, { cards: [card] }).cards).toBe(0);
    expect(sessionRunFacts(runs[0]!, { cards: [{ ...card, status: 'answered' }] }).cards).toBe(0);
    // an answer in prose inside the run handles a free-text card
    const answered = splitSessionRuns([
      msg('o1', 'human', '2026-09-26T09:00:00Z', 'Morning dependency audit', S),
      msg('r1', 'agent', '2026-09-26T09:08:00Z', 'Which one first?'),
      msg('h1', 'human', '2026-09-26T09:20:00Z', 'lodash'),
    ], S)!;
    expect(sessionRunFacts(answered[0]!, { cards: [card] }).cards).toBe(0);
    // …and the next run's opener, posted as the routine's owner, is no answer: the card still waits
    expect(sessionRunFacts(runs[0]!, { cards: [{ ...card, human_replied_at: at('2026-09-27T09:00:00Z') }] }).cards).toBe(1);
  });

  it('the grant\'s divider is posted as the person, and it answers no card (github-resume.ts)', () => {
    const card = { message_id: 'r1', status: 'open', created_at: at('2026-09-26T09:08:00Z'), allow_other: 1 };
    const granted = splitSessionRuns([
      msg('o1', 'human', '2026-09-26T09:00:00Z', 'Morning dependency audit', S),
      msg('r1', 'agent', '2026-09-26T09:08:00Z', 'Which one first?'),
      msg('g1', 'human', '2026-09-26T11:00:00Z', githubConnectedMarker('acme/site')),
    ], S)![0]!;
    const facts = sessionRunFacts(granted, { cards: [card] });
    expect(facts.cards).toBe(1);
    expect(sessionRunStrip(granted, facts, NOW).state).toBe('needs');
  });

  it('a settle covers the gates, the cards and the drafts from before it', () => {
    const settledAt = at('2026-09-26T12:00:00Z');
    const f = sessionRunFacts(runs[0]!, {
      settledAt,
      units: [unit(1146, 'plan_review', '2026-09-26T09:07:00Z')],
      cards: [{ message_id: 'r1', status: 'open', created_at: at('2026-09-26T09:08:00Z') }],
      drafts: [{ body: 'x', status: 'draft', created_at: at('2026-09-26T09:08:00Z') }],
    });
    expect([f.gates, f.cards, f.draftsWaiting]).toEqual([0, 0, 0]);
  });

  it('agent runs, files and drafts count by their time', () => {
    const f = sessionRunFacts(runs[1]!, {
      openRuns: [{ started_at: at('2026-09-26T09:01:00Z') }, { started_at: at('2026-09-27T09:01:00Z') }],
      files: [{ created_at: at('2026-09-27T09:05:00Z') }, { created_at: at('2026-09-27T09:05:30Z') }],
      drafts: [{ body: 'x', status: 'draft', created_at: at('2026-09-26T09:05:00Z') }],
    });
    expect([f.openRuns, f.files, f.drafts, f.draftsWaiting]).toEqual([1, 2, 0, 0]);
  });

  it('drafts: a failed publish says why, all published names the time, a waiting draft names its slot', () => {
    const d = (status: string, extra: Record<string, unknown> = {}) => ({ body: 'Three reviews passed before 6am.', status, created_at: at('2026-09-27T09:01:00Z'), scheduled_at: at('2026-09-27T10:00:00Z'), ...extra });
    expect(sessionRunFacts(runs[1]!, { drafts: [d('failed', { last_error: 'X refused the post.' })] }).failure).toBe('X refused the post.');
    expect(sessionRunFacts(runs[1]!, { drafts: [d('failed')] }).failure).toBe('The post did not publish.');
    const pub = sessionRunFacts(runs[1]!, { drafts: [d('published', { published_at: at('2026-09-27T10:00:04Z') })] });
    expect(pub).toMatchObject({ published: at('2026-09-27T10:00:04Z'), slot: null, quote: 'Three reviews passed before 6am.' });
    expect(sessionRunFacts(runs[1]!, { drafts: [d('draft')] })).toMatchObject({ published: null, slot: at('2026-09-27T10:00:00Z'), draftsWaiting: 1 });
  });
});

describe('a draft run\'s strip', () => {
  const opener = msg('d', 'agent', '2026-09-27T07:00:00Z', 'Scheduled draft · Daily X post · for 10:00\n\nThree reviews passed before 6am.', S);
  const f = splitSessionRuns([opener], S)![0]!;
  const now = new Date(2026, 8, 27, 16, 2).getTime();
  const slot = new Date(2026, 8, 27, 10, 0).toISOString();

  it('a waiting draft: Needs you, for its slot', () => {
    expect(sessionRunStrip(f, { ...none, drafts: 1, draftsWaiting: 1, slot, quote: 'Three reviews passed before 6am.' }, now))
      .toMatchObject({ state: 'needs', word: 'Needs you', took: 'for Today, 10:00', line: '“Three reviews passed before 6am.”' });
  });

  it('every draft published: Published, at the time it went out', () => {
    expect(sessionRunStrip(f, { ...none, drafts: 1, published: slot, quote: 'Three reviews passed before 6am.' }, now))
      .toMatchObject({ state: 'done', word: 'Published', took: 'Today, 10:00' });
  });

  it('an approved draft waits for its slot: Scheduled', () => {
    expect(sessionRunStrip(f, { ...none, drafts: 1, slot }, now)).toMatchObject({ state: 'done', word: 'Scheduled', took: 'for Today, 10:00' });
  });
});

describe('draftLetters', () => {
  const d = (id: string, created_at: string) => ({ id, created_at: at(created_at) });

  it('counts a, b, c in birth order when the thread holds one run', () => {
    expect([...draftLetters([d('y', '2026-09-27T09:02:00Z'), d('x', '2026-09-27T09:01:00Z')]).entries()]).toEqual([['x', 'a'], ['y', 'b']]);
  });

  it('restarts at each run', () => {
    const letters = draftLetters(
      [d('p1', '2026-09-26T07:00:01Z'), d('p2', '2026-09-26T07:00:02Z'), d('q1', '2026-09-27T07:00:01Z')],
      [at('2026-09-26T07:00:00Z'), at('2026-09-27T07:00:00Z')],
    );
    expect(Object.fromEntries(letters)).toEqual({ p1: 'a', p2: 'b', q1: 'a' });
  });
});

describe('sessionRunLines lists a schedule\'s runs across its sessions', () => {
  const NOW2 = Date.parse('2026-09-28T12:00:00Z');
  // an old per-run session from before 0145 (its opener holds no column), then the one session
  const messages = [
    { ...msg('a1', 'human', '2026-09-26T09:00:00Z', 'Morning dependency audit'), thread_id: 'old' },
    { ...msg('a2', 'agent', '2026-09-26T09:04:00Z', 'No new CVEs today.'), thread_id: 'old' },
    { ...msg('b1', 'human', '2026-09-27T09:00:00Z', 'Morning dependency audit', S), thread_id: 'one' },
    { ...msg('b2', 'agent', '2026-09-27T09:06:00Z', 'Filed #1150.'), thread_id: 'one' },
    { ...msg('c1', 'human', '2026-09-28T09:00:00Z', 'Morning dependency audit', S), thread_id: 'one' },
  ];
  const runs = [
    { id: 'c1', thread_id: 'one', settled_at: null },
    { id: 'b1', thread_id: 'one', settled_at: null },
    { id: 'a1', thread_id: 'old', settled_at: null },
    { id: 'gone', thread_id: 'lost', settled_at: null },
  ];
  const rows = {
    messages,
    units: [{ number: 1150, title: 'Bump tar', state: 'accepted', created_at: at('2026-09-27T09:05:00Z'), updated_at: at('2026-09-27T09:05:00Z'), origin_thread_id: 'one' }],
    cards: [], drafts: [], openRuns: [],
    files: [{ created_at: at('2026-09-26T09:03:00Z'), name: 'audit.md', thread_id: 'old' }, { created_at: at('2026-09-26T09:03:00Z'), name: 'posts.json', thread_id: 'old' }],
  };

  it('each run gets the strip its session shows, and a run with no messages keeps its place', () => {
    const lines = sessionRunLines(runs, rows, S, NOW2);
    expect(lines.map((l) => l.strip?.word ?? null)).toEqual(['Failed', 'Done', 'Done', null]);
    expect(lines[1]!.strip).toMatchObject({ took: '6 min', made: ['1 unit'], line: '#1150 Bump tar' });
    // the posts file is the drafts' wire format, never a file the run made
    expect(lines[2]!.strip).toMatchObject({ made: ['1 file'], line: 'No new CVEs today.' });
  });
});
