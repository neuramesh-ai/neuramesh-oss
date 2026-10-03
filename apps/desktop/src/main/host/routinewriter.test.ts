// THE ROUTINE WRITER (docs/design/routine-writer-2026-10): propose_routine is in rex's registry on a
// conversation only, the offer of a new session also in a task's thread, and neither on a sweep. The draft
// card carries every part of the routine or it is not posted. Run from apps/desktop:
// pnpm exec tsx --test src/main/host/routinewriter.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRoutineBlock } from '@neuramesh/shared';
import { makeOrchTools } from './orchtools';
import { inventedBars, routineNote, zoneNamed, zoneWords } from './tools-routine';

type Posted = { path: string; body: Record<string, unknown> };

async function registry(o: { task?: boolean; sweep?: boolean; said?: string; asked?: boolean }, posted: Posted[] = []) {
  const never = async (): Promise<never> => { throw new Error('the tools are weighed, never run'); };
  const host = makeOrchTools({
    db: { getAll: async (sql: string) => (/author_kind = 'human'/.test(sql) && o.said ? [{ body: o.said }] : /nmq/.test(sql) ? [{ n: o.asked === false ? 0 : 1 }] : []) } as never,
    post: async (path: string, _actor: unknown, body: Record<string, unknown>) => { posted.push({ path, body }); return { ok: true, status: 200, json: async () => ({}) } as Response; },
    agents: new Map(),
    apiGet: never,
    brain: {} as never,
    buildScheduleCard: () => '',
    draftsForAnchor: async () => null,
    ensureChatWorkspace: () => '/tmp/routinewriter',
    executeHire: never,
    generateDraftImage: never,
    libraryDocs: async () => [],
    startDeepWork: async () => null,
    subjectFor: () => null,
    whiteboardClosures: () => ({ list: never, read: never, create: never, update: never }) as never,
    workspaceListing: () => [],
    workspaceRead: () => ({ ok: false as const, error: 'stub' }),
  } as never);
  return host.buildOrchestratorTools({
    ch: { id: 'c-mkt', slug: 'marketing', workspace_id: 'ws' },
    agent: { id: 'a-rex', name: 'rex', role: 'orchestrator', runtime: 'claude-code' } as never,
    actor: { kind: 'agent', id: 'a-rex', role: 'orchestrator' },
    skills: [],
    thread: o.task ? { id: 't-1', number: 1046, title: 'a unit', state: 'in_progress' } : undefined,
    convoThreadId: o.task || o.sweep ? null : 'th-1',
    token: '',
    kind: o.sweep ? 'sweep' : o.task ? 'own' : 'triage',
    ...(o.sweep ? { sweepScope: 'monitor' as const } : {}),
    spawn: async () => ({ ok: false, error: 'stub' }),
  });
}
const names = async (o: { task?: boolean; sweep?: boolean }) => (await registry(o)).map((t) => t.name);
/** a request that gives the bar the draft's rules carry */
const GAVE = 'Make a routine: every weekday at 9, find the AI harness posts with 20,000 impressions or more.';

const DRAFT = {
  title: 'AI harness posts on X', cadence: 'weekdays', atTime: '09:00',
  goal: 'Find the top posts about AI agent harnesses.', eachRun: 'Search X for the last 24 hours.',
  rules: 'A post must have 20,000 impressions or more.', output: 'A short report and one drafted reply each.',
  ifNone: 'Say no post passed, and show the best 3 below the bar.', defaults: 'I picked English only.',
  // this routine drafts replies, so its card says how they go out (the models-and-replies round)
  replies: 'Draft them only. I post them myself.',
};

test('a conversation gets both tools: the session the routine will run in', async () => {
  const n = await names({});
  assert.ok(n.includes('propose_routine'));
  assert.ok(n.includes('offer_routine_session'));
});

test("a task's thread gets the offer only: a routine never runs in a unit's thread", async () => {
  const n = await names({ task: true });
  assert.ok(!n.includes('propose_routine'));
  assert.ok(n.includes('offer_routine_session'));
});

test('a sweep gets neither: a self-check never writes a routine', async () => {
  const n = await names({ sweep: true });
  assert.ok(!n.includes('propose_routine') && !n.includes('offer_routine_session'));
});

test('the draft posts as one card in the session, its note above it', async () => {
  const posted: Posted[] = [];
  const tool = (await registry({ said: GAVE }, posted)).find((t) => t.name === 'propose_routine')!;
  const out = await tool.run(DRAFT);
  assert.match(out, /Reply in ONE line/);
  assert.equal(posted.length, 1);
  assert.equal(posted[0]!.path, '/v1/messages');
  assert.equal(posted[0]!.body['threadId'], 'th-1');
  assert.equal(posted[0]!.body['routineCard'], true); // the server keeps only a tool's card
  const body = String(posted[0]!.body['body']);
  assert.ok(body.startsWith('I picked English only.\n\n```nmroutine\n'));
  const block = parseRoutineBlock(body);
  assert.equal(block?.kind, 'draft');
  assert.equal(block?.kind === 'draft' ? block.draft.ifNone : '', DRAFT.ifNone);
});

test('a time zone the person never named is dropped, and one they named stays', async () => {
  const card = async (said: string) => {
    const posted: Posted[] = [];
    await (await registry({ said }, posted)).find((t) => t.name === 'propose_routine')!.run({ ...DRAFT, tz: 'America/Vancouver' });
    const b = parseRoutineBlock(String(posted[0]!.body['body']));
    return b?.kind === 'draft' ? b.draft.tz ?? null : 'no card';
  };
  assert.equal(await card(GAVE), null);
  assert.equal(await card(`${GAVE} At 9 Vancouver time.`), 'America/Vancouver');
});

test('a zone picked on a card in plain words is named: Eastern Time keeps America/New_York', () => {
  // the third live run asked "What time zone?" with UTC / Eastern / Pacific, and the answer carries no IANA name
  assert.ok(zoneNamed('**what time zone should we use?** → eastern time (09:00 est/edt)', 'America/New_York'));
  assert.ok(zoneNamed('→ pacific time (09:00 pst/pdt)', 'America/Los_Angeles'));
  assert.ok(zoneNamed('9 am utc please', 'UTC'));
  assert.ok(zoneNamed('at 9 new york time', 'America/New_York'));
  // whole words only, and a zone nobody named is not named
  assert.ok(!zoneNamed('the best test posts', 'America/New_York'));
  assert.ok(!zoneNamed('every weekday at 9, find the posts', 'UTC'));
  // a zone Intl cannot read is no zone: Schedule it would fail on it
  assert.equal(zoneWords('Eastern'), null);
  assert.ok(!zoneNamed('eastern', 'Eastern'));
});

test('defaults of "none" put no line above the card', async () => {
  const posted: Posted[] = [];
  await (await registry({ said: GAVE }, posted)).find((t) => t.name === 'propose_routine')!.run({ ...DRAFT, defaults: 'none' });
  assert.ok(String(posted[0]!.body['body']).startsWith('```nmroutine\n'));
});

test('a guess is asked before it is drafted: defaults with no question asked here are refused', async () => {
  const posted: Posted[] = [];
  const tool = (await registry({ asked: false, said: GAVE }, posted)).find((t) => t.name === 'propose_routine')!;
  assert.match(await tool.run(DRAFT), /^refused: you chose values they did not give \(I picked English only\.\)/);
  assert.equal(posted.length, 0);
  // a request that gave every value drafts at once
  assert.match(await tool.run({ ...DRAFT, defaults: 'none' }), /Reply in ONE line/);
  assert.equal(posted.length, 1);
});

test('the note names only what rex chose: never a time zone, never a value the person wrote', () => {
  // the third live run: Maya picked 5,000+ on rex's card, and the card ran in her own zone
  const said = 'make a routine: every weekday at 9, find the posts.\n**what threshold should we use?** → 5,000+ impressions';
  assert.equal(routineNote('threshold: 5,000+ impressions, time zone: UTC', said), '');
  assert.equal(routineNote('I chose a 1,000-like bar and UTC.', said), 'I chose a 1,000-like bar');
  assert.equal(routineNote('window: the last 24 hours; zone America/Vancouver', said), 'window: the last 24 hours');
  // a note with nothing to drop stays word for word, and a bare number is never read as theirs
  assert.equal(routineNote('I picked English only.', said), 'I picked English only.');
  assert.equal(routineNote('limit: 9 posts a run', 'every weekday at 9'), 'limit: 9 posts a run');
  assert.equal(routineNote('None.', said), '');
});

test('a time zone alone is no guess: it drafts at once, with no line above the card', async () => {
  const posted: Posted[] = [];
  const tool = (await registry({ asked: false, said: GAVE }, posted)).find((t) => t.name === 'propose_routine')!;
  assert.match(await tool.run({ ...DRAFT, defaults: 'time zone: UTC' }), /Reply in ONE line/);
  assert.ok(String(posted[0]!.body['body']).startsWith('```nmroutine\n'));
});

test('a bar the person never wrote is a guess, whatever defaults says: asked first, then shown', async () => {
  // the fourth live run: defaults "none" over an invented 500 impressions, drafted at once
  const said = 'Make a routine: every weekday at 9, find the top AI harness posts on X with high impressions, and draft a reply to each one.';
  const rules = 'Target posts must have at least 500 impressions. Draft at most three replies per run.';
  assert.deepEqual(inventedBars(rules, said.toLowerCase()), ['500 impressions', 'three replies']);
  const before: Posted[] = [];
  const out = await (await registry({ asked: false, said }, before)).find((t) => t.name === 'propose_routine')!.run({ ...DRAFT, rules, defaults: 'none' });
  assert.match(out, /^refused: you chose values they did not give \(I chose 500 impressions, three replies\)/);
  assert.equal(before.length, 0);
  // after a question, it drafts, and the line above the card says what rex chose
  const after: Posted[] = [];
  await (await registry({ asked: true, said }, after)).find((t) => t.name === 'propose_routine')!.run({ ...DRAFT, rules, defaults: 'none' });
  assert.ok(String(after[0]!.body['body']).startsWith('I chose 500 impressions, three replies\n\n```nmroutine'));
  // a bar they gave, in any form, is theirs: 10k is 10,000, and a clock time is the schedule
  assert.deepEqual(inventedBars('At least 10k impressions, checked at 09:00.', '→ 10,000+ impressions'), []);
  // a bar defaults already names shows once
  const named: Posted[] = [];
  await (await registry({ asked: true, said }, named)).find((t) => t.name === 'propose_routine')!.run({ ...DRAFT, rules, defaults: 'bar: 500 impressions' });
  assert.ok(String(named[0]!.body['body']).startsWith('bar: 500 impressions. I chose three replies\n\n'));
});

test('a draft that misses a part is refused, and nothing posts', async () => {
  const posted: Posted[] = [];
  const tool = (await registry({}, posted)).find((t) => t.name === 'propose_routine')!;
  const out = await tool.run({ ...DRAFT, ifNone: '' });
  assert.match(out, /^error: the draft needs/);
  assert.equal(posted.length, 0);
});

test('the offer posts its card in the task thread', async () => {
  const posted: Posted[] = [];
  const tool = (await registry({ task: true }, posted)).find((t) => t.name === 'offer_routine_session')!;
  await tool.run({ request: 'every Friday, sum up the week' });
  assert.equal(posted[0]!.body['taskId'], 't-1');
  assert.equal(posted[0]!.body['routineCard'], true);
  assert.deepEqual(parseRoutineBlock(String(posted[0]!.body['body'])), { kind: 'offer', request: 'every Friday, sum up the week' });
});

test('a routine that drafts replies says how they go out, or nothing posts: asked, never assumed', async () => {
  const posted: Posted[] = [];
  const tool = (await registry({ said: GAVE }, posted)).find((t) => t.name === 'propose_routine')!;
  const { replies: _drop, ...noReplies } = DRAFT;
  assert.match(await tool.run({ ...noReplies, defaults: 'none' }), /^refused: this routine drafts replies\. Ask how they go out/);
  assert.equal(posted.length, 0);
  // a queue at a gap the person picked: the card carries the gap and the sentence the server acts on
  assert.match(await tool.run({ ...noReplies, defaults: 'none', replyGap: 8 }), /draft card is in the thread/);
  const card = parseRoutineBlock(String(posted[0]!.body['body']));
  assert.ok(card?.kind === 'draft');
  assert.equal(card.kind === 'draft' && card.draft.replyGap, 8);
  assert.equal(card.kind === 'draft' && card.draft.replies, 'Queue each reply 8 minutes apart, from the end of the run. Remind me to post each one in X.');
});

test('a routine that drafts nothing to post needs no Replies part', async () => {
  const posted: Posted[] = [];
  const tool = (await registry({ said: GAVE }, posted)).find((t) => t.name === 'propose_routine')!;
  const { replies: _drop, ...quiet } = DRAFT;
  await tool.run({ ...quiet, goal: 'Sum up the week on the board.', output: 'A short report.', defaults: 'none' });
  assert.equal(posted.length, 1);
});
