// ONE SESSION PER ROUTINE (docs/design/routine-sessions-2026-09): the fixture world for the run view.
// A routine session in #dev with four runs (one failed, one done, one that needs you, the newest in
// progress), a scheduled-drafts session in #marketing with one draft per run, and the Automations
// lane over the same rows. Kept apart from mock-fixtures.ts (at its size cap) and spliced in there, so
// this file imports nothing from it. Rows only: mock-nm.ts serves them.
//
// These sessions hold several runs, which is what the launcher writes once it continues a session
// (the plan's PR 2). ?openConvo=dependency audit and ?openConvo=Daily X post open them.
const MIN = 60_000;
const H = 60 * MIN;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
/** an hour on the local clock, `days` days back */
const dayAt = (days: number, h: number): string => { const d = new Date(); d.setDate(d.getDate() - days); d.setHours(h, 0, 0, 0); return d.toISOString(); };

export const ROUTINE_THREAD_ID = 'th-routine-audit';
/** mock-fixtures.ts seeds this schedule row (Morning dependency audit); this file only names it */
export const ROUTINE_SCHEDULE_ID = 'sch-dev-1';
export const DRAFTS_THREAD_ID = 'th-routine-xpost';
export const DRAFTS_SCHEDULE_ID = 'sch-mk-xpost';

const OPEN = 'Morning dependency audit\n\nCheck our top 20 dependencies for new CVEs and majors; file anything urgent.';
const R1 = dayAt(3, 9);
const R2 = dayAt(2, 9);
const R3 = dayAt(1, 9);
const R4 = ago(90_000);
// uuid-shaped on purpose: the ‹task:id› parser accepts nothing shorter
const U1139 = 'aaaaaaa6-6666-4666-8666-666666661139';
const U1146 = 'aaaaaaa6-6666-4666-8666-666666661146';
const U1147 = 'aaaaaaa6-6666-4666-8666-666666661147';

const opener = (id: string, at: string) => ({ id, author_kind: 'human', author_id: 'u-george', created_at: at, body: OPEN, schedule_id: ROUTINE_SCHEDULE_ID });
export const routineMsgs: any[] = [
  // the first run: scout had no login, so the one answer is the notice
  opener('ra1', R1),
  { id: 'ra2', author_kind: 'agent', author_id: 'a-scout', created_at: plus(R1, 12_000), body: "I can't run this now. This machine has no Claude login. Sign in to Claude on this machine, or ask a teammate." },
  // the second: one unit, accepted
  opener('rb1', R2),
  { id: 'rb2', author_kind: 'agent', author_id: 'a-rex', created_at: plus(R2, 6 * MIN), body: 'One package needs work. undici 6.21.1 fixes a request smuggling bug, so I made a unit for it.' },
  { id: 'rb2a', author_kind: 'agent', author_id: 'a-rex', created_at: plus(R2, 6 * MIN + 1_000), body: `‹task:${U1139}›` },
  // the third: two units, one at its plan gate, and a word from the person
  opener('rc1', R3),
  { id: 'rc2', author_kind: 'agent', author_id: 'a-rex', created_at: plus(R3, 8 * MIN), body: 'Two packages need work. lodash 4.17.21 has a prototype pollution fix, and React 19 is a major version. I made a unit for each.' },
  // each unit's card is its own message, as the host posts it (docs/41)
  { id: 'rc2a', author_kind: 'agent', author_id: 'a-rex', created_at: plus(R3, 8 * MIN + 1_000), body: `‹task:${U1146}›` },
  { id: 'rc2b', author_kind: 'agent', author_id: 'a-rex', created_at: plus(R3, 8 * MIN + 2_000), body: `‹task:${U1147}›` },
  { id: 'rc3', author_kind: 'human', author_id: 'u-george', created_at: plus(R3, 31 * MIN), body: 'Do lodash first. The React plan can wait for Monday.' },
  { id: 'rc4', author_kind: 'agent', author_id: 'a-rex', created_at: plus(R3, 32 * MIN), body: 'OK. #1146 goes first, and I parked the React plan until Monday.' },
  // today's: rex works on it now
  opener('rd1', R4),
];

const unit = (id: string, number: number, title: string, state: string, at: string, extra: Record<string, unknown> = {}): any => ({
  id, number, title, kind: 'feature', description: '', state, assignee_kind: 'agent', assignee_id: 'a-patch', offered_agent_id: null,
  requirements: null, requirements_confirmed: 1, definition_of_done: null, project_id: 'p-acme', channel_id: 'c-dev', branch: null, repo_id: null,
  submitted_sha: null, pr_url: '', pr_number: null, artifact_count: 0, parent_task_id: null, origin_thread_id: ROUTINE_THREAD_ID,
  work_plan: null, plan_approved_at: null, created_at: at, updated_at: at, claimed_at: null, submitted_at: null, approved_at: null, accepted_at: null, closed_at: null, ...extra,
});
export const routineUnits: any[] = [
  unit(U1139, 1139, 'Bump undici to 6.21.1', 'accepted', plus(R2, 5 * MIN), { updated_at: plus(R2, 50 * MIN) }),
  unit(U1146, 1146, 'Patch lodash prototype pollution', 'in_review', plus(R3, 7 * MIN), { updated_at: plus(R3, 40 * MIN) }),
  unit(U1147, 1147, 'Plan the React 19 upgrade', 'plan_review', plus(R3, 7 * MIN + 30_000), { updated_at: plus(R3, 9 * MIN) }),
];

export const routineThread: any = {
  id: ROUTINE_THREAD_ID, title: 'Morning dependency audit', description: '', created_by: 'human:u-george', task_id: null, mode: 'tasks',
  schedule_id: ROUTINE_SCHEDULE_ID, created_at: R1, updated_at: R4, msg_count: routineMsgs.length,
  // who spoke last skips a run's opener (routine sessions, PR 2): the status reads rex's last word, and the live run
  last_body: OPEN, last_author_kind: 'agent', last_at: plus(R3, 32 * MIN),
};

/** today's run is live: rex's wake, open under the session */
export const routineRun: any = {
  id: 'run-routine-audit', channel_id: 'c-dev', thread_id: ROUTINE_THREAD_ID, task_id: null, agent_id: 'a-rex', parent_run_id: null,
  kind: 'wake', title: 'Morning dependency audit', state: 'running', step: 'checks the packages', done: 12, total: 20,
  machine_id: 'm2', machine_name: 'sam-mbp', summary: null, started_at: plus(R4, 8_000), ended_at: null, updated_at: ago(5_000),
};

// the scheduled drafts: one run a day at 07:00, each opened by plume's draft, and one draft card per
// run for the 10:00 slot. Today's run is an hour ago when the harness runs before 07:00
const D = [dayAt(3, 7), dayAt(2, 7), dayAt(1, 7), Date.parse(dayAt(0, 7)) < Date.now() ? dayAt(0, 7) : ago(H)];
const DRAFTS = [
  'Your agents keep the lessons from yesterday’s review.',
  'Every review gate in one place, for people and agents.',
  'Three reviews passed before 6am.',
  'The fastest review is the one you do not wait for. flowe hands the diff to a reviewer the moment the build is green.',
];
export const draftSchedule = {
  id: DRAFTS_SCHEDULE_ID, channelId: 'c-marketing', title: 'Daily X post', prompt: 'Draft one X post for the morning slot. Lead with one thing the product did this week.',
  cadence: 'daily', at_time: '07:00', tz: 'America/Vancouver', weekday: null, next_run_at: plus(D[3]!, 24 * H), status: 'active', run_count: 4,
};
export const draftMsgs: any[] = D.map((at, i) => ({
  id: `dx${i + 1}`, author_kind: 'agent', author_id: 'a-plume', created_at: at, schedule_id: DRAFTS_SCHEDULE_ID,
  body: `Scheduled draft · Daily X post · for 10:00\n\n${DRAFTS[i]}`,
}));
export const draftItems: any[] = D.map((at, i) => ({
  id: `ci-dx${i + 1}`, channelId: 'c-marketing', thread_id: DRAFTS_THREAD_ID, task_id: null, platform: 'x', body: DRAFTS[i]!,
  status: ['published', 'failed', 'published', 'draft'][i]!, last_error: i === 1 ? 'X refused the post. Reconnect the X account, then publish again.' : null,
  scheduled_at: plus(at, 3 * H), published_at: i === 0 || i === 2 ? plus(at, 3 * H) : null, external_url: null,
  created_at: plus(at, 20_000), schedule_id: DRAFTS_SCHEDULE_ID, media: null,
}));
export const draftThread: any = {
  id: DRAFTS_THREAD_ID, title: 'Daily X post', description: '', created_by: 'agent:a-plume', task_id: null, mode: 'tasks',
  schedule_id: DRAFTS_SCHEDULE_ID, created_at: D[0], updated_at: D[3], msg_count: draftMsgs.length,
  last_body: draftMsgs[3].body, last_author_kind: 'agent', last_at: D[3],
};

/** the one splice mock-fixtures.ts makes: mutation, never reassignment. Runs before allTasks derives from tasksByChannel */
export function spliceRoutines(w: { mockThreads: Record<string, any[]>; convoMsgs: Record<string, any[]>; mockContentItems: any[]; mockSchedules: any[]; tasksByChannel: Record<string, any[]> }): void {
  (w.mockThreads['c-dev'] ??= []).push(routineThread);
  (w.mockThreads['c-marketing'] ??= []).push(draftThread);
  w.convoMsgs[ROUTINE_THREAD_ID] = routineMsgs;
  w.convoMsgs[DRAFTS_THREAD_ID] = draftMsgs;
  w.mockContentItems.push(...draftItems);
  w.mockSchedules.push(draftSchedule);
  (w.tasksByChannel['c-dev'] ??= []).push(...routineUnits);
}

type World = {
  threads: any[]; convoMsgs: Record<string, any[]>; tasks: any[]; decisions: any[]; items: any[]; arts: Record<string, any[]>; runs: any[];
  /** runs listed before a session held its runs: a thread per run (the release doors) */
  legacy: Record<string, Array<{ id: string; title: string; last_body: string; created_at: string; updated_at: string; channel_id: string; channel_slug: string }>>;
};

/** the Automations lane (web/webnm-sessionruns.ts) over the fixture world: the openers, then the rows the strips count */
export function mockRunsFor(scheduleId: string, limit: number, w: World) {
  const threads = w.threads.filter((t) => t.schedule_id === scheduleId && !t.archived_at);
  const openers = threads.flatMap((t) => (w.convoMsgs[t.id] ?? []).filter((m, i) => m.schedule_id === scheduleId || i === 0)
    .map((m) => ({ id: m.id, thread_id: t.id, created_at: m.created_at, channel_id: t.channel_id ?? 'c-dev', channel_slug: t.channel_slug ?? null, title: t.title, settled_at: t.settled_at ?? null })));
  const legacy = (w.legacy[scheduleId] ?? []).filter((r) => !threads.some((t) => t.id === r.id));
  const runs = [...openers, ...legacy.map((r) => ({ id: `${r.id}-open`, thread_id: r.id, created_at: r.created_at, channel_id: r.channel_id, channel_slug: r.channel_slug, title: r.title, settled_at: null }))]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, limit);
  const ids = new Set(runs.map((r) => r.thread_id));
  const messages = [
    ...threads.filter((t) => ids.has(t.id)).flatMap((t) => (w.convoMsgs[t.id] ?? []).map((m) => ({ ...m, thread_id: t.id }))),
    ...legacy.filter((r) => ids.has(r.id)).flatMap((r) => [
      { id: `${r.id}-open`, author_kind: 'human', body: r.title, created_at: r.created_at, schedule_id: scheduleId, thread_id: r.id },
      { id: `${r.id}-reply`, author_kind: 'agent', body: r.last_body, created_at: r.updated_at, schedule_id: null, thread_id: r.id },
    ]),
  ];
  const byMsg = new Map(messages.map((m) => [m.id, m.thread_id]));
  return {
    runs,
    messages,
    units: w.tasks.filter((t) => ids.has(t.origin_thread_id) && !t.parent_task_id),
    cards: w.decisions.filter((d) => byMsg.has(d.message_id)).map((d) => ({ ...d, thread_id: byMsg.get(d.message_id) })),
    drafts: w.items.filter((c) => ids.has(c.thread_id)),
    files: [...ids].flatMap((id) => (w.arts[id] ?? []).map((a) => ({ created_at: a.created_at, name: a.name, thread_id: id }))),
    openRuns: w.runs.filter((r) => ids.has(r.thread_id) && r.state === 'running'),
  };
}
