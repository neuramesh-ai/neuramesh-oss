// ONE SESSION PER ROUTINE (docs/design/routine-sessions-2026-09/plan.md). A schedule's one session holds
// every run, and a run opens with the message its launcher posts, which carries the schedule
// (messages.schedule_id, 0145). This module splits a session into its runs and derives each run's strip:
// its status, the time it took, what it made, and one line. Pure, so hq, the phone and the desktop split
// and word one session the same way from their own rows.
//
// The names say SessionRun, never Run or Firing: `runs` is an agent's work run (the runs table, RunCard,
// useRuns), and a `Firing` is a schedule's projected fire time (schedule.ts, the Calendar).
import { AUTH_LABEL, parseAuthCard } from './cards';
import { isPostsFile } from './deliverables';
import { decisionHandled, type BallDecision } from './needsyou';
import { replyPreview } from './replies';
import { isRoutineScheduledMarker } from './routine-draft';
import { afterSettle, gateNeedsHuman, type StatusTask } from './threadstatus';
import { WAIT_LIMIT_MS } from './waiting';

export interface SessionRunMessage { id: string; author_kind: string; body?: string | null; created_at: string; schedule_id?: string | null }

export interface SessionRun<M extends SessionRunMessage = SessionRunMessage> {
  /** the message that opens the run */
  opener: M;
  /** the run's messages, oldest first, the opener included */
  messages: M[];
  /** the opener's time, as the row holds it */
  at: string;
  /** the next run's opener time, or null for the newest */
  until: string | null;
}

const ms = (at: string | null | undefined): number => (at ? Date.parse(at) : NaN);

const byAt = <M extends SessionRunMessage>(messages: readonly M[]): M[] => [...messages].sort((a, b) => ms(a.created_at) - ms(b.created_at));

/** the index of the newest routine divider in time-sorted messages, or -1 */
function dividerIndex(sorted: readonly SessionRunMessage[]): number {
  for (let i = sorted.length - 1; i >= 0; i--) if (isRoutineScheduledMarker(sorted[i]!.body)) return i;
  return -1;
}

/**
 * A schedule's session, split into its runs. A run opens at every message that carries a schedule.
 * The session's first message opens one too: a schedule's session always starts with its launcher's
 * message, and a session from before 0145 holds no column on it. `null` when the thread is no
 * schedule's, or holds no message: the thread then renders as it always did.
 *
 * A session rex wrote the routine in (the routine writer) holds the routine's divider. Every message up
 * to it is the setup (`sessionSetup`), and after it only a run's opener opens a run, so the list can be
 * empty: the routine is scheduled and has not run yet.
 */
export function splitSessionRuns<M extends SessionRunMessage>(messages: readonly M[], scheduleId: string | null | undefined): SessionRun<M>[] | null {
  if (!scheduleId || !messages.length) return null;
  const sorted = byAt(messages);
  const cut = dividerIndex(sorted);
  const out: SessionRun<M>[] = [];
  for (const m of cut < 0 ? sorted : sorted.slice(cut + 1)) {
    if (m.schedule_id || (cut < 0 && !out.length)) out.push({ opener: m, messages: [m], at: m.created_at, until: null });
    else if (out.length) out[out.length - 1]!.messages.push(m);
  }
  out.forEach((f, i) => { f.until = out[i + 1]?.at ?? null; });
  return out;
}

/** a routine writer's session, before its runs: the talk that wrote the routine, the divider, and what came after it before the first run */
export interface SessionSetup<M extends SessionRunMessage = SessionRunMessage> { setup: M[]; divider: M; between: M[] }

/** the setup of a session that holds the routine's divider, else null (docs/design/routine-writer-2026-10) */
export function sessionSetup<M extends SessionRunMessage>(messages: readonly M[]): SessionSetup<M> | null {
  const sorted = byAt(messages);
  const cut = dividerIndex(sorted);
  if (cut < 0) return null;
  const rest = sorted.slice(cut + 1);
  const first = rest.findIndex((m) => !!m.schedule_id);
  return { setup: sorted.slice(0, cut), divider: sorted[cut]!, between: first < 0 ? rest : rest.slice(0, first) };
}

/** is `at` inside the run's window: from its opener up to the next run's opener */
export function inSessionRun(f: Pick<SessionRun, 'at' | 'until'>, at: string | null | undefined): boolean {
  const t = ms(at);
  return Number.isFinite(t) && t >= ms(f.at) && (f.until === null || t < ms(f.until));
}

export type SessionRunState = 'progress' | 'needs' | 'failed' | 'done';

/** what a client counts inside a run's window, from its own rows */
export interface SessionRunFacts {
  /** agent runs still open in the run */
  openRuns: number;
  /** units born in the run that wait at a person's gate */
  gates: number;
  /** open cards of the run that nobody handled */
  cards: number;
  /** drafts of the run that wait for a person */
  draftsWaiting: number;
  /** units born in the run, oldest first */
  units: ReadonlyArray<{ number: number; title: string }>;
  /** drafts and files the run made */
  drafts: number;
  files: number;
  /** a reason the client read on the run's own rows, for example a draft that did not publish */
  failure?: string | null;
  /** the newest publish time, when every draft of the run published */
  published?: string | null;
  /** the earliest slot of the run's drafts that did not publish yet */
  slot?: string | null;
  /** the run's first draft, in its own words */
  quote?: string | null;
}

/** a draft as the facts read it: its state, its slot and its words */
export interface SessionRunDraft { body: string; status: string; created_at: string; scheduled_at?: string | null; published_at?: string | null; last_error?: string | null }

/** the rows a client holds for one session. `sessionRunFacts` places each row in its run */
export interface SessionRunSources {
  /** the units the session owns (tasks.origin_thread_id), placed by their birth */
  units?: ReadonlyArray<StatusTask & { number: number; title: string; created_at: string }>;
  /** the card rows (decisions), placed by the message that holds the card */
  cards?: ReadonlyArray<BallDecision & { message_id: string }>;
  /** the session's drafts, placed by their birth */
  drafts?: ReadonlyArray<SessionRunDraft>;
  /** the session's files, placed by their birth */
  files?: ReadonlyArray<{ created_at: string }>;
  /** the agent runs still open in the session, placed by their start */
  openRuns?: ReadonlyArray<{ started_at: string }>;
  /** threads.settled_at: a gate, a card or a draft from before the stamp waits on nobody (threadstatus.ts) */
  settledAt?: string | null;
}

const byTime = <T extends { created_at: string }>(a: T, b: T): number => ms(a.created_at) - ms(b.created_at);

/** what a run holds, counted from the session's rows. The gate and card rules are the thread status's */
export function sessionRunFacts(f: SessionRun, s: SessionRunSources): SessionRunFacts {
  const inRun = <T>(rows: ReadonlyArray<T> | undefined, at: (r: T) => string | null | undefined): T[] => (rows ?? []).filter((r) => inSessionRun(f, at(r)));
  const ids = new Set(f.messages.map((m) => m.id));
  const settled = s.settledAt ?? null;
  const units = inRun(s.units, (u) => u.created_at).sort(byTime);
  const drafts = inRun(s.drafts, (d) => d.created_at).sort(byTime);
  const failed = drafts.find((d) => d.status === 'failed');
  const waiting = drafts.filter((d) => d.status !== 'published');
  // a card is answered in its own run. A routine's opener is posted as its owner, so the next run's
  // opener is a human message too, and a thread-wide "newest human message" would read it as the answer
  const answeredAt = [...f.messages].reverse().find((m) => m.author_kind === 'human' && m !== f.opener)?.created_at ?? null;
  const times = (xs: Array<string | null | undefined>): string[] => xs.filter((x): x is string => Number.isFinite(ms(x))).sort((a, b) => ms(a) - ms(b));
  return {
    openRuns: inRun(s.openRuns, (r) => r.started_at).length,
    gates: units.filter((u) => gateNeedsHuman(u) && afterSettle(u.updated_at, settled)).length,
    cards: (s.cards ?? []).filter((c) => ids.has(c.message_id) && c.status === 'open' && !decisionHandled({ ...c, human_replied_at: answeredAt }) && afterSettle(c.created_at, settled)).length,
    draftsWaiting: drafts.filter((d) => d.status === 'draft' && afterSettle(d.created_at, settled)).length,
    units: units.map((u) => ({ number: u.number, title: u.title })),
    drafts: drafts.length,
    files: inRun(s.files, (x) => x.created_at).length,
    failure: failed ? (failed.last_error?.trim() || 'The post did not publish.') : null,
    published: drafts.length && !waiting.length ? times(drafts.map((d) => d.published_at)).at(-1) ?? null : null,
    slot: times(waiting.map((d) => d.scheduled_at))[0] ?? null,
    quote: drafts[0]?.body ?? null,
  };
}

/** the rows of several sessions, each row naming its session: what a list of one schedule's runs counts */
export interface SessionRunRowsByThread {
  messages: ReadonlyArray<SessionRunMessage & { thread_id: string }>;
  units: ReadonlyArray<NonNullable<SessionRunSources['units']>[number] & { origin_thread_id: string }>;
  cards: ReadonlyArray<NonNullable<SessionRunSources['cards']>[number] & { thread_id: string }>;
  drafts: ReadonlyArray<SessionRunDraft & { thread_id: string }>;
  files: ReadonlyArray<{ created_at: string; name?: string | null; thread_id: string }>;
  openRuns: ReadonlyArray<{ started_at: string; thread_id: string }>;
}

/**
 * A schedule's runs as a list (the Automations panel, the phone's Routines door): each run, named by
 * its opener, with its strip, from the rows of the sessions the runs live in. The strip is the one the
 * session shows. A run whose messages did not come back keeps its place with no strip.
 */
export function sessionRunLines<R extends { id: string; thread_id: string; settled_at?: string | null }>(
  runs: readonly R[], rows: SessionRunRowsByThread, scheduleId: string, nowMs: number,
): Array<{ run: R; strip: SessionRunStrip | null }> {
  const of = <T extends { thread_id: string }>(xs: ReadonlyArray<T>, thread: string): T[] => xs.filter((x) => x.thread_id === thread);
  const split = new Map<string, SessionRun[] | null>();
  return runs.map((run) => {
    if (!split.has(run.thread_id)) split.set(run.thread_id, splitSessionRuns(of(rows.messages, run.thread_id), scheduleId));
    const f = split.get(run.thread_id)?.find((x) => x.opener.id === run.id);
    if (!f) return { run, strip: null };
    const facts = sessionRunFacts(f, {
      units: rows.units.filter((u) => u.origin_thread_id === run.thread_id),
      cards: of(rows.cards, run.thread_id),
      drafts: of(rows.drafts, run.thread_id),
      files: of(rows.files, run.thread_id).filter((a) => !isPostsFile(a.name ?? '')),
      openRuns: of(rows.openRuns, run.thread_id),
      settledAt: run.settled_at ?? null,
    });
    return { run, strip: sessionRunStrip(f, facts, nowMs) };
  });
}

/**
 * Each draft's letter (a, b, c), counted inside its run: a run restarts the count. `runStarts` are
 * the run openers' times. hq, the phone and the daemon letter one session the same way, so "change b"
 * names one card for the person and for the agent.
 */
export function draftLetters(items: ReadonlyArray<{ id: string; created_at: string }>, runStarts: ReadonlyArray<string> = []): Map<string, string> {
  const starts = runStarts.map(ms).filter(Number.isFinite).sort((a, b) => a - b);
  const runOf = (t: number): number => starts.filter((x) => x <= t).length;
  const out = new Map<string, string>();
  let run = -1;
  let n = 0;
  for (const it of [...items].sort(byTime)) {
    const r = runOf(ms(it.created_at));
    if (r !== run) { run = r; n = 0; }
    out.set(it.id, String.fromCharCode(97 + n++));
  }
  return out;
}

export interface SessionRunStrip {
  state: SessionRunState;
  /** In progress · Needs you · Failed · Done */
  word: string;
  /** 2 min so far · 8 min · 12 s, or '' when the run holds no agent line to measure */
  took: string;
  /** what the run made, counted: 2 units · 1 draft · 3 files */
  made: string[];
  /** the first unit, the reason it failed, or the newest agent line */
  line: string;
}

export const SESSION_RUN_WORD: Record<SessionRunState, string> = { progress: 'In progress', needs: 'Needs you', failed: 'Failed', done: 'Done' };

/** how long a span took, said short: 12 s · 6 min · 1 h 5 min */
export function tookLabel(spanMs: number): string {
  const s = Math.max(0, Math.round(spanMs / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** an agent line that says no answer can come: a compute notice, a sleeper notice or a login card.
 *  The daemon's twin is apps/desktop/src/main/computenotice.ts isComputeNotice. */
export function isSessionRunNotice(body: string | null | undefined): boolean {
  if (!body) return false;
  return /^I can't run this/.test(body) || /^I can't reply now\./.test(body)
    || /^Waking (?:your|a teammate's) cloud machine/.test(body) || /```nmauth\b/.test(body);
}

/** a notice said in one line: the login it lacks, or the notice's own reason */
function noticeLine(body: string): string {
  const auth = parseAuthCard(body);
  if (auth) return auth.why ?? `${auth.agent ? `@${auth.agent}` : 'The agent'} has no ${AUTH_LABEL[auth.provider] ?? auth.provider} login here.`;
  const rest = body.replace(/^I can't (?:run this|reply) now\.\s*/, '');
  return (/^[^.]*\./.exec(rest)?.[0] ?? rest).trim();
}

const count = (n: number, one: string, many: string): string[] => (n > 0 ? [`${n} ${n === 1 ? one : many}`] : []);

/**
 * A run's strip, derived and never stored. The order is the thread status's (threadstatus.ts): the
 * person's turn first, then work in flight, then a run that ended with no real answer.
 *   · Needs you: a unit at a person's gate, an open card, or a draft that waits.
 *   · In progress: an agent run is open, or the newest opener waits inside the wait limit (waiting.ts).
 *   · Failed: a reason the client read, agent lines that are all notices, or no agent line past the limit.
 *   · Done: anything else. A draft run's opener is the agent's own work, so it is done by itself.
 *     Its drafts name it closer: Published when every draft published, Scheduled while one waits
 *     for its slot.
 * The time runs from the opener to the newest agent line, or to now while the run is in progress.
 * A run with drafts says when they go out instead: the publish time, or the slot.
 */
export function sessionRunStrip<M extends SessionRunMessage>(f: SessionRun<M>, facts: SessionRunFacts, nowMs: number): SessionRunStrip {
  const agentLines = f.messages.filter((m) => m.author_kind === 'agent' && m !== f.opener);
  const newestAgent = [...f.messages].reverse().find((m) => m.author_kind === 'agent') ?? null;
  const state = stripState(f, facts, agentLines, nowMs);
  const made = [...count(facts.units.length, 'unit', 'units'), ...count(facts.drafts, 'draft', 'drafts'), ...count(facts.files, 'file', 'files')];
  return { state, word: stripWord(state, facts), took: stripTook(f, facts, state, newestAgent, nowMs), made, line: stripLine(facts, state, agentLines, newestAgent) };
}

function stripState(f: SessionRun, facts: SessionRunFacts, agentLines: SessionRunMessage[], nowMs: number): SessionRunState {
  if (facts.gates + facts.cards + facts.draftsWaiting > 0) return 'needs';
  if (facts.openRuns > 0) return 'progress';
  if (facts.failure) return 'failed';
  if (f.opener.author_kind === 'agent' || agentLines.some((m) => !isSessionRunNotice(m.body))) return 'done';
  if (agentLines.length) return 'failed';
  return f.until === null && nowMs - ms(f.at) < WAIT_LIMIT_MS ? 'progress' : 'failed';
}

function stripWord(state: SessionRunState, facts: SessionRunFacts): string {
  if (state === 'done' && facts.published) return 'Published';
  if (state === 'done' && facts.slot) return 'Scheduled';
  return SESSION_RUN_WORD[state];
}

function stripTook(f: SessionRun, facts: SessionRunFacts, state: SessionRunState, newestAgent: SessionRunMessage | null, nowMs: number): string {
  if (state === 'progress') return `${tookLabel(nowMs - ms(f.at))} so far`;
  if (facts.published) return sessionRunLabel(facts.published, nowMs);
  if (facts.slot) return `for ${sessionRunLabel(facts.slot, nowMs)}`;
  return f.opener.author_kind !== 'agent' && newestAgent ? tookLabel(ms(newestAgent.created_at) - ms(f.at)) : '';
}

function stripLine(facts: SessionRunFacts, state: SessionRunState, agentLines: SessionRunMessage[], newestAgent: SessionRunMessage | null): string {
  if (state === 'failed') {
    const lastNotice = [...agentLines].reverse().find((m) => isSessionRunNotice(m.body));
    return facts.failure ?? (lastNotice ? noticeLine(lastNotice.body!) : 'No answer came.');
  }
  if (facts.units.length) return `#${facts.units[0]!.number} ${facts.units[0]!.title}`;
  if (facts.quote) return `“${replyPreview(facts.quote, 118)}”`;
  return newestAgent?.body ? replyPreview(newestAgent.body, 120) : '';
}

/** the newest run is open, and so is one that needs its person. Every other run folds to its strip */
export function sessionRunOpen(state: SessionRunState, newest: boolean): boolean {
  return newest || state === 'needs';
}

/** a time in a sentence, in the reader's time: today at 09:00 · tomorrow at 09:00 · on Oct 2 at 09:00 */
export function sessionRunWhen(at: string, nowMs: number): string {
  const label = sessionRunLabel(at, nowMs);
  const i = label.lastIndexOf(', ');
  const day = label.slice(0, i);
  return /^(Today|Tomorrow|Yesterday)$/.test(day) ? `${day.toLowerCase()} at ${label.slice(i + 2)}` : `on ${day} at ${label.slice(i + 2)}`;
}

/** the date divider's label, in the reader's time: Today, 09:00 · Yesterday, 09:00 · Sep 25, 09:00.
 *  A time still to come reads Tomorrow, 09:00 (the next run, a draft's slot) */
export function sessionRunLabel(at: string, nowMs: number): string {
  const d = new Date(ms(at));
  const now = new Date(nowMs);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dayOf = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayOf(now) - dayOf(d)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (days === -1) return `Tomorrow, ${time}`;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return `${date}, ${time}`;
}
