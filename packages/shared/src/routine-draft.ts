// THE ROUTINE WRITER (docs/design/routine-writer-2026-10/plan.md; George, 2026-10-01: "humans are bad at
// writing exactly what they want"). rex turns a request into a routine with the person: it asks for what it
// does not know, then posts a draft card the person schedules with one click. This module is the card's one
// definition, so the daemon that writes it, the clients that draw it and the server agree:
//   · the ```nmroutine block propose_routine writes, and its parser: a draft, or the offer of a new session
//   · the prompt a click arms: the draft's parts under their headings, the same text the card shows
//   · the versions of one session (v1, v2) and what each card can still do
//   · the lines a click posts: the divider the server writes on Schedule it, and a Try once run
// Pure, no I/O.
import { fencedBlock, stripFenced } from './linear';
import { isReplyGap, type ReplyGap } from './replyqueue';
import { cadenceLine } from './schedule';

export const ROUTINE_CADENCES = ['daily', 'weekdays', 'weekly', 'once'] as const;
export type RoutineCadence = (typeof ROUTINE_CADENCES)[number];

/** the parts of a routine's prompt, in the order the card and the armed prompt show them. `replies` and `never` are optional */
export const ROUTINE_PARTS = [
  { key: 'goal', label: 'Goal' },
  { key: 'eachRun', label: 'Each run' },
  { key: 'rules', label: 'Rules' },
  { key: 'output', label: 'Output' },
  { key: 'replies', label: 'Replies' },
  { key: 'ifNone', label: 'If nothing matches' },
  { key: 'never', label: 'Never' },
] as const;
export type RoutinePart = (typeof ROUTINE_PARTS)[number]['key'];

export interface RoutineDraft {
  title: string;
  cadence: RoutineCadence;
  /** HH:MM in the routine's time zone */
  atTime: string;
  /** 0 to 6 (Sun to Sat), weekly only */
  weekday?: number | null;
  /** the exact time of a one-time routine (ISO) */
  runAt?: string | null;
  /** IANA. Absent: the time zone of the person who schedules it, read by their client */
  tz?: string | null;
  /** the agent that runs it. Absent: the room's orchestrator */
  agent?: string | null;
  goal: string;
  eachRun: string;
  rules: string;
  output: string;
  ifNone: string;
  never?: string | null;
  /** how a run's reply drafts go out, in words (models-and-replies round): the card shows it, the run reads it */
  replies?: string | null;
  /** the gap a run's replies are queued at, in minutes. Absent: drafts only. The server reads it to queue a run's card */
  replyGap?: ReplyGap | null;
}

export type RoutineBlock = { kind: 'draft'; draft: RoutineDraft } | { kind: 'offer'; request: string };

/** the caps a draft is clamped to. The armed prompt is cut at schedule.create's 4000 characters */
export const ROUTINE_TITLE_MAX = 80;
export const ROUTINE_PART_MAX = 600;
export const ROUTINE_PROMPT_MAX = 4000;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** a draft from loose input (the tool's arguments, a parsed block): null unless every required part is there */
export function routineDraftFrom(raw: unknown): RoutineDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const cadence = (ROUTINE_CADENCES as readonly unknown[]).includes(r['cadence']) ? (r['cadence'] as RoutineCadence) : null;
  const parts = {
    title: text(r['title'], ROUTINE_TITLE_MAX),
    goal: text(r['goal'], ROUTINE_PART_MAX),
    eachRun: text(r['eachRun'], ROUTINE_PART_MAX),
    rules: text(r['rules'], ROUTINE_PART_MAX),
    output: text(r['output'], ROUTINE_PART_MAX),
    ifNone: text(r['ifNone'], ROUTINE_PART_MAX),
  };
  if (!cadence || Object.values(parts).some((v) => !v)) return null;
  const at = r['atTime'];
  const atTime = typeof at === 'string' && HHMM.test(at) ? at : '09:00';
  const runAtRaw = r['runAt'];
  const runAt = cadence === 'once' && typeof runAtRaw === 'string' && Number.isFinite(Date.parse(runAtRaw)) ? new Date(runAtRaw).toISOString() : null;
  if (cadence === 'once' && !runAt) return null;
  const wd = r['weekday'];
  const weekday = cadence === 'weekly' ? (typeof wd === 'number' && Number.isInteger(wd) && wd >= 0 && wd <= 6 ? wd : 1) : null;
  const tz = text(r['tz'], 64);
  const agent = text(r['agent'], 40).replace(/^@/, '');
  const never = text(r['never'], ROUTINE_PART_MAX);
  const replyGap = isReplyGap(r['replyGap']) ? r['replyGap'] : null;
  // a gap with no words gets the card's own sentence, so the card always says what the server will do
  const replies = text(r['replies'], ROUTINE_PART_MAX) || (replyGap ? routineRepliesText(replyGap) : '');
  return {
    ...parts, cadence, atTime,
    ...(weekday !== null ? { weekday } : {}), ...(runAt ? { runAt } : {}), ...(tz ? { tz } : {}), ...(agent ? { agent } : {}), ...(never ? { never } : {}),
    ...(replies ? { replies } : {}), ...(replyGap ? { replyGap } : {}),
  };
}

/** the Replies part in words: a queue at a gap, or drafts only */
export function routineRepliesText(gap: ReplyGap | null): string {
  return gap
    ? `Queue each reply ${gap} minutes apart, from the end of the run. Remind me to post each one in X.`
    : 'Draft them only. I post them myself.';
}

/** does this routine deliver reply drafts? Then its card must say how they go out, and its run must post the reply card */
export function routineDraftsReplies(d: Pick<RoutineDraft, 'goal' | 'eachRun' | 'output'> & { replies?: string | null }): boolean {
  return !!d.replies || /\b(repl(?:y|ies)|respon(?:se|ses|d))\b/i.test(`${d.goal} ${d.eachRun} ${d.output}`);
}

/** the ```nmroutine block in a message: a draft, or the offer of a new session for one. null when absent or unreadable */
export function parseRoutineBlock(body: string | null | undefined): RoutineBlock | null {
  const b = fencedBlock(body ?? '', 'nmroutine');
  if (!b) return null;
  let raw: unknown;
  try { raw = JSON.parse(b.inner); } catch { return null; }
  const offer = raw && typeof raw === 'object' ? (raw as { offer?: unknown }).offer : undefined;
  if (typeof offer === 'string') {
    const request = offer.trim().slice(0, 1000);
    return request ? { kind: 'offer', request } : null;
  }
  const draft = routineDraftFrom(raw);
  return draft ? { kind: 'draft', draft } : null;
}

/** the block itself, as propose_routine and offer_routine_session post it */
export function routineBlock(b: RoutineBlock): string {
  return '```nmroutine\n' + JSON.stringify(b.kind === 'offer' ? { offer: b.request } : b.draft) + '\n```';
}

/** the message's words with every routine block removed: what a bubble prints above the card */
export function stripRoutineBlocks(body: string): string {
  return stripFenced(body, 'nmroutine').trim();
}

/**
 * The card is the routine tools' alone, because their checks run there: a guess asked first, a time zone the
 * person named, a true note. So the server keeps a routine block in an agent's message only when a tool posted
 * it (`routineCard` on /v1/messages), and drops one an agent wrote into a reply: the third live run copied v1's
 * block from its transcript and wrote v2 by hand, past every check.
 */
export function routineCardGuard(body: string, fromTool: boolean): string {
  return fromTool || !body.includes('```nmroutine') ? body : stripRoutineBlocks(body);
}

/** a routine card as an agent's transcript shows it: readable, and naming the tool that posts it, never a block to copy */
export function routineCardText(body: string): string {
  const b = parseRoutineBlock(body);
  if (!b) return body;
  const card = b.kind === 'offer'
    ? `[the offer card of a new session, posted with offer_routine_session: “${b.request}”]`
    : `[a routine draft card, posted with propose_routine: “${b.draft.title}” · ${routineWhen(b.draft)} · ${ROUTINE_PARTS.filter((p) => b.draft[p.key]).map((p) => `${p.label}: ${b.draft[p.key]}`).join(' · ')}]`;
  return [stripRoutineBlocks(body), card].filter(Boolean).join('\n');
}

/** the prompt a routine arms: each part under its heading, in the card's order. What the card shows is what runs */
export function routinePrompt(d: RoutineDraft): string {
  return ROUTINE_PARTS.filter((p) => d[p.key]).map((p) => `${p.label}: ${d[p.key]}`).join('\n\n').slice(0, ROUTINE_PROMPT_MAX);
}

/** the card's when line: Weekdays · 09:00 · America/Vancouver. `tz` is the reader's zone, for a draft that names none */
export function routineWhen(d: Pick<RoutineDraft, 'cadence' | 'atTime' | 'weekday' | 'runAt' | 'tz'>, tz?: string | null): string {
  const zone = d.tz || tz || null;
  const once = d.cadence === 'once' && d.runAt
    ? `Once · ${new Date(d.runAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(zone ? { timeZone: zone } : {}) })}`
    : null;
  const base = once ?? cadenceLine({ cadence: d.cadence, at_time: d.atTime, weekday: d.weekday ?? null });
  return zone ? `${base} · ${zone}` : base;
}

/** one draft card of a session, numbered in the order rex wrote them */
export interface RoutineDraftEntry { id: string; at: string; version: number; draft: RoutineDraft; author: string | null }

/** every draft card in a session, oldest first, as v1, v2, … Only an agent's card counts */
export function routineDraftsOf(messages: ReadonlyArray<{ id: string; body?: string | null; created_at: string; author_kind?: string; author_id?: string | null }>): RoutineDraftEntry[] {
  const out: RoutineDraftEntry[] = [];
  for (const m of [...messages].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    if (m.author_kind && m.author_kind !== 'agent') continue;
    const b = parseRoutineBlock(m.body);
    if (b?.kind === 'draft') out.push({ id: m.id, at: m.created_at, version: out.length + 1, draft: b.draft, author: m.author_id ?? null });
  }
  return out;
}

/** the live routine as a card compares itself to it */
export interface RoutineLive { prompt: string; cadence: string; atTime: string; weekday: number | null }

/** does this draft say what the live routine runs */
export function draftIsLive(d: RoutineDraft, live: RoutineLive): boolean {
  return routinePrompt(d) === live.prompt.trim() && d.cadence === live.cadence && d.atTime === live.atTime
    && (d.cadence !== 'weekly' || (d.weekday ?? 1) === (live.weekday ?? 1));
}

/**
 * What each draft card of a session can still do. Derived, never stored:
 *   · open: the newest draft before the person schedules one. It offers Schedule it
 *   · replaced: an older draft. It folds to one line
 *   · scheduled: the draft the routine runs: the live routine's own text, else the newest one at the divider
 *   · update: a newer draft rex wrote for the live routine. It offers Update routine
 */
export type RoutineCardState = 'open' | 'replaced' | 'scheduled' | 'update';

export function routineCardStates(drafts: readonly RoutineDraftEntry[], s: { linked: boolean; dividerAt?: string | null; live?: RoutineLive | null }): Map<string, RoutineCardState> {
  const out = new Map<string, RoutineCardState>();
  drafts.forEach((d) => out.set(d.id, 'replaced'));
  const newest = drafts[drafts.length - 1];
  if (!newest) return out;
  if (!s.linked) { out.set(newest.id, 'open'); return out; }
  const cut = s.dividerAt ? Date.parse(s.dividerAt) : -Infinity;
  const live = s.live ?? null;
  const running = (live ? [...drafts].reverse().find((d) => draftIsLive(d.draft, live)) : undefined)
    ?? [...drafts].reverse().find((d) => Date.parse(d.at) <= cut);
  if (running) out.set(running.id, 'scheduled');
  if (newest !== running && Date.parse(newest.at) > cut) out.set(newest.id, 'update');
  return out;
}

/** the parts that differ from the version before: the card tags them Changed */
export function changedParts(prev: RoutineDraft | null | undefined, next: RoutineDraft): RoutinePart[] {
  if (!prev) return [];
  return ROUTINE_PARTS.map((p) => p.key).filter((k) => (prev[k] ?? '') !== (next[k] ?? ''));
}

/** does the when line differ from the version before */
export function whenChanged(prev: RoutineDraft | null | undefined, next: RoutineDraft): boolean {
  if (!prev) return false;
  return routineWhen(prev) !== routineWhen(next);
}

/**
 * The divider the server writes when a person schedules the routine in the session rex wrote it in
 * (schedule.create with `thread`). A record, never a message anyone answers: the daemon does not wake on
 * it, the transcript builders drop it, and every message before it is the setup, never a run (session-runs.ts).
 */
export const ROUTINE_SCHEDULED_MARKER = '‹routine:scheduled›';
export function isRoutineScheduledMarker(body: string | null | undefined): boolean {
  return (body ?? '').trim() === ROUTINE_SCHEDULED_MARKER;
}

/**
 * A draft card waits on its person, so it mints a decision row the way an auth card does (control-api app.ts): the
 * session reads Needs you, and the bell counts it, until the person's next word in the session: Schedule it (its
 * divider), a change, a trial, or an answer. null for a message with no draft card.
 */
export function routineDecisionQuestion(body: string, linked: boolean): string | null {
  const b = parseRoutineBlock(body);
  return b?.kind === 'draft' ? `${linked ? 'Update' : 'Schedule'} the routine “${b.draft.title}”?` : null;
}

/** Try once: the draft's own prompt, posted as the person, under the head a run's opener wears (`Routine · …`) */
export const TRY_ONCE_HEAD = 'Try once · ';
export function tryOnceBody(d: RoutineDraft): string {
  return `${TRY_ONCE_HEAD}${d.title}\n\n${routinePrompt(d)}`;
}
export function isTryOnce(body: string | null | undefined): boolean {
  return (body ?? '').startsWith(TRY_ONCE_HEAD);
}

/** Request changes on a draft card: the prefix that tells rex which version the person means */
export function routineChangesPrefix(version: number): string {
  return `↩ Re routine v${version}: `;
}

/** the words the New routine doors put in the New session composer (George, 2026-10-01). The person writes the rest and sends */
export const ROUTINE_ASK = 'Make a routine: ';
export function routineAsk(request = ''): string {
  return `${ROUTINE_ASK}${request.trim()}`;
}
