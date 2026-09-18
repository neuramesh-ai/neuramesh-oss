// Marketing playbooks (docs/design/marketing-os-2026-08) — the flow catalog as DATA.
//
// The setupflows lesson, applied to marketing flows: a playbook is a registry entry, not a
// feature. Each one names the bundled marketing-os skill that runs it, how it runs (a
// hands-off unit — born approved, since the ask itself selected a canned template — or a
// subtask when asked for inside a task's thread, or answered in the thread), what it needs (inputs
// with profile defaults), what it lands (a scored report, or a doc), and the cadence a re-run
// suggests. rex reads this registry through `list_playbooks`/`run_playbook`; the Marketing OS
// destination renders it; the bootstrap's closing `nmplays` block recommends from it. One
// registry, so a pill, a tool and a card can never disagree about what a playbook is.
//
// This module is the PURE half: types + derivations; the catalog DATA lives in
// playbooks-registry.ts (the 250-line cap). The host owns tools and unit
// creation; the renderer owns rendering. Adding a playbook is a data entry here plus its
// skill in the marketing-os pack — nothing else.

import { dotLines } from './linear';
import { PLAYBOOKS } from './playbooks-registry';
export * from './playbooks-registry';

export type PlaybookEngine = 'unit' | 'chat';
export type PlaybookGroup = 'foundations' | 'content' | 'campaigns';

export interface PlaybookInput {
  /** the key run_playbook accepts ("url", "competitor", …) */
  key: string;
  label: string;
  /** profile key whose value fills this input when the caller omits it (channels.marketing) */
  fromProfile?: string;
  /** a required input with no profile fallback makes run_playbook refuse with MISSING_INPUT
   * naming it — rex asks the human instead of inventing a subject */
  required?: boolean;
}

export interface Playbook {
  id: string;
  title: string;
  /** one line for catalog rows and list_playbooks — what it does, not how */
  tagline: string;
  group: PlaybookGroup;
  /** the marketing-os pack skill that carries the method (load_skill name) */
  skill: string;
  /** unit = a unit born APPROVED from the registry template (round 3: the human's ask is the
   * consent; only architect-authored plans go through plan review) — or a parent's subtask
   * when the ask came from inside a task thread;
   * chat = answered in the thread with the skill loaded — no board ceremony */
  engine: PlaybookEngine;
  /** the docs/16 routing label a unit playbook's task carries */
  taskKind?: 'research' | 'content';
  inputs: PlaybookInput[];
  /** the deliverable parses as a scored report (Score: NN/100 + the gaps section) —
   * only these earn the ReportCard and the trend */
  scored: boolean;
  /** the run's real deliverable is the ```nmreply card (draft_replies). The worker handing
   * replies to the tool is a prompt rule, so the finish lane GUARANTEES the card: when the
   * run settles with a report but no card, the host distills one from the report
   * (host/replydistill.ts — caught live 2026-08-26: production delivered the file and the
   * drafted replies never left it) */
  deliversReplies?: boolean;
  /** journey legs the unit's plan declares (docs/41 floors still apply: build always,
   * review non-declinable on repo-backed — these are scratch units, review is declared) */
  legs: string[];
  /** the work-turn fan-out the approach instructs (deep-work legs, one per entry) —
   * distinct from journey legs: these are HOW the build leg researches */
  fanout?: string[];
  /** subtasks the plan proposes at approval (the launch asset stack) */
  subtasks?: string[];
  /** templated approach — {key} slots fill from resolved inputs */
  approach: string;
  /** templated Definition of Done — the acceptance contract the reviewer gates on */
  dod: string;
  /** what must be TRUE before this can be staffed (triage-preflight round). An unmet need
   *  stops the delegation: run_playbook refuses and posts the dependency card instead. */
  needs?: readonly import('./needs').Need[];
  /** the re-run this flow suggests once it has landed */
  remeasure?: { cadence: 'daily' | 'weekdays' | 'weekly'; label: string } | { days: number; label: string };
}

/**
 * A report's playbook identity rides its NAME + TITLE, never a stored tag — `artifacts.tags`
 * exists in Postgres but was never in the client schema or the sync rules, and putting it
 * there is a PowerSync redeploy this round deliberately avoids (zero-migration promise).
 * The shape contract dictates both halves: the file is `<playbookId>-report-YYYY-MM-DD.md`
 * and line 1 is `# <Playbook title> — <subject>`, so identity is derivable everywhere the
 * doc travels (replica, staging dir, a pasted copy).
 */
export function playbookReportName(id: string, dateIso: string): string {
  return `${id}-report-${dateIso.slice(0, 10)}.md`;
}
export function playbookFromReportName(name: string | null | undefined): string | null {
  const m = /^([a-z0-9]+)-report(?:[-.]|$)/.exec(name ?? '');
  const id = m?.[1] ?? null;
  return id && PLAYBOOKS.some((p) => p.id === id) ? id : null;
}
export function playbookFromReportTitle(title: string | null | undefined): string | null {
  const t = (title ?? '').toLowerCase();
  return PLAYBOOKS.find((p) => t.startsWith(p.title.toLowerCase()))?.id ?? null;
}
/** name first (exact by contract), title as the fallback for a renamed file */
export function playbookOfReport(name: string | null | undefined, title: string | null | undefined): string | null {
  return playbookFromReportName(name) ?? playbookFromReportTitle(title);
}


export function playbookById(id: string | null | undefined): Playbook | null {
  return (id && PLAYBOOKS.find((p) => p.id === id)) || null;
}

/** the ids run_playbook accepts — chat-engine playbooks are refused BY SCHEMA, not by prose */
export const UNIT_PLAYBOOK_IDS = PLAYBOOKS.filter((p) => p.engine === 'unit').map((p) => p.id);

export interface ResolvedInputs {
  values: Record<string, string>;
  /** required inputs with no given value and no profile fallback — the tool refuses, naming these */
  missing: string[];
}

/** Fill a playbook's inputs from what the caller gave + the channel's marketing profile. */
export function resolvePlaybookInputs(
  pb: Playbook,
  givenRaw: Record<string, string | undefined> | string | null | undefined,
  profileJson: string | null | undefined,
): ResolvedInputs {
  let profile: Record<string, unknown> = {};
  try { profile = profileJson ? (JSON.parse(profileJson) as Record<string, unknown>) : {}; } catch { /* untouched */ }
  // the CLI tool bus can deliver `inputs` as the raw JSON STRING (found live: codex sent
  // '{"competitor":…}', Object.entries exploded it into characters, and the join adopted
  // them into a unit titled "{, \", c, o, m…"). Normalize BEFORE anything reads keys.
  let given: Record<string, unknown> | null = null;
  if (typeof givenRaw === 'string') {
    try { const p = JSON.parse(givenRaw) as unknown; given = p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, unknown> : null; } catch { given = null; }
  } else given = givenRaw ?? null;
  const values: Record<string, string> = {};
  const missing: string[] = [];
  const givenEntries = Object.entries(given ?? {})
    .map(([k, v]) => [k, typeof v === 'string' ? v : v == null ? '' : String(v)] as [string, string])
    .filter(([, v]) => v.trim());
  for (const input of pb.inputs) {
    const direct = given?.[input.key];
    let fromCaller = typeof direct === 'string' ? direct.trim() : direct != null ? String(direct).trim() : undefined;
    // a single-input playbook adopts EVERY given value, joined — whatever the caller keyed
    // them (found live, twice: rex sent `competitors` for teardown's `competitor`, then split
    // two names across two keys; on a one-slot form every stray value IS the slot's value,
    // and exactness was buying nothing but a refusal loop)
    if (!fromCaller && pb.inputs.length === 1 && givenEntries.length > 0) {
      fromCaller = givenEntries.map(([, v]) => v!.trim()).join(', ');
    }
    const fromProfile = input.fromProfile ? String(profile[input.fromProfile] ?? '').trim() : '';
    const v = fromCaller || fromProfile;
    if (v) values[input.key] = v;
    else if (input.required) missing.push(input.key);
  }
  return { values, missing };
}

/**
 * Slots the RUN fills, not the caller's inputs (triage-preflight round). `coverage` is the
 * preflight's verdict — which networks are connected and how each is read — resolved when the
 * playbook is actually run, so it cannot be declared as an input the human types.
 */
export const RUNTIME_SLOTS = ['coverage'] as const;

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? `{${k}}`);
}

/** the unit's subject — the primary input, hostname-shortened when it is a URL */
export function playbookSubject(pb: Playbook, values: Record<string, string>): string {
  const primary = pb.inputs[0] ? values[pb.inputs[0].key] : undefined;
  if (!primary) return '';
  try { return new URL(primary).hostname.replace(/^www\./, ''); } catch { return primary; }
}

export function playbookUnitTitle(pb: Playbook, values: Record<string, string>): string {
  const subject = playbookSubject(pb, values);
  return subject ? `${pb.title} — ${subject}` : pb.title;
}

/**
 * The one pre-drafted ask — a pill, a catalog row and an nmplays Run › all send THIS
 * sentence, so rex triages one shape. It names the playbook (rex routes on it) and the
 * subject when one is known.
 */
export function playbookAsk(pb: Playbook, values: Record<string, string> = {}): string {
  const subject = pb.inputs[0] ? values[pb.inputs[0].key] : undefined;
  const on = subject ? ` on ${subject}` : '';
  if (pb.engine === 'chat') return `Run the ${pb.title.toLowerCase()} playbook${on}.`;
  return `Run the ${pb.title.toLowerCase()} playbook${on}.`;
}

/**
 * The inverse of `playbookAsk` — which playbook a schedule's prompt is asking for.
 * Armed-state derives from THIS (no schema change): every armed cadence carries the one
 * ask sentence, so `state is derived, never stored` holds for schedules too.
 */
export function playbookFromAsk(prompt: string | null | undefined): string | null {
  // "run the <title> playbook" on one line, found by index: the first ask and the first
  // "playbook" after it, so a prompt of many asks is scanned once (CodeQL, 2026-09-18)
  let want: string | null = null;
  for (const line of dotLines((prompt ?? '').toLowerCase())) {
    const at = line.indexOf('run the ');
    if (at === -1) continue;
    const end = line.indexOf(' playbook', at + 'run the '.length + 1);
    if (end === -1) continue;
    want = line.slice(at + 'run the '.length, end).trim();
    break;
  }
  if (want === null) return null;
  return PLAYBOOKS.find((p) => p.title.toLowerCase() === want)?.id ?? null;
}

export interface PlaybookPlan {
  title: string;
  approach: string;
  legs: string[];
  subtasks: string[];
  definitionOfDone: string;
}

/** The unit's templated plan — run_playbook maps this onto create_task, so the template
 * cannot drift between a tool call and a hand-written unit. */
export function playbookPlan(pb: Playbook, values: Record<string, string>): PlaybookPlan {
  const fanout = pb.fanout?.length
    ? ` Fan-out during the build leg: ${pb.fanout.join(' · ')}.`
    : '';
  return {
    title: playbookUnitTitle(pb, values),
    approach: fill(pb.approach, values) + fanout,
    legs: pb.legs,
    subtasks: pb.subtasks ?? [],
    definitionOfDone: pb.dod,
  };
}

// ── per-room state (derived, never stored) ────────────────────────────────────────────────
// The same join list_playbooks returns to rex and the destination renders: last run + score
// from report-tagged artifacts, armed cadence from schedules whose payload names the playbook.

export interface PlaybookArtifactRow {
  id: string;
  name: string;
  created_at: string;
  /** parsed report title when available — the rename fallback for identity */
  title?: string | null;
  /** the parsed score when the artifact is a valid report (reports.ts) — caller supplies */
  score?: number | null;
}
export interface PlaybookScheduleRow {
  status: string;
  cadence: string;
  payload_playbook?: string | null;
}

export interface PlaybookState {
  id: string;
  lastRunAt: string | null;
  lastScore: number | null;
  prevScore: number | null;
  armed: string | null; // the armed cadence ('weekly'…), null when none
}

export function playbookState(
  pb: Playbook,
  artifacts: readonly PlaybookArtifactRow[],
  schedules: readonly PlaybookScheduleRow[],
): PlaybookState {
  const mine = artifacts
    .filter((a) => playbookOfReport(a.name, a.title ?? null) === pb.id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const scoredRuns = mine.filter((a) => typeof a.score === 'number');
  const armedRow = schedules.find((s) => s.status === 'active' && s.payload_playbook === pb.id);
  return {
    id: pb.id,
    lastRunAt: mine[0]?.created_at ?? null,
    lastScore: (scoredRuns[0]?.score as number | undefined) ?? null,
    prevScore: (scoredRuns[1]?.score as number | undefined) ?? null,
    armed: armedRow?.cadence ?? null,
  };
}

// ── the nmplays block (the nmsched sibling) ───────────────────────────────────────────────
// The bootstrap's close emits it; the renderer turns it into PlaybookRecsCard rows whose
// Run › sends `playbookAsk` into the thread as the human. Same fenced-JSON anatomy as
// nmsched so the parser family stays one shape.

export interface PlaybookRec { id: string; why: string; }
export interface PlaybookRecs { channel: string; plays: PlaybookRec[]; }

export function playbookRecsBlock(channel: string, plays: PlaybookRec[]): string {
  return '```nmplays\n' + JSON.stringify({ channel, plays: plays.slice(0, 3) }) + '\n```';
}

// `[ \t]*\n`, not `\s*\n`: the cards.ts fence rule (polynomial backtracking on blank lines)
const NMPLAYS_RE = /```nmplays[ \t]*\n([\s\S]*?)```/;

export function parsePlaybookRecs(body: string): PlaybookRecs | null {
  const m = NMPLAYS_RE.exec(body);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]!.trim()) as PlaybookRecs;
    if (!parsed || typeof parsed.channel !== 'string' || !Array.isArray(parsed.plays)) return null;
    const plays = parsed.plays
      .filter((p): p is PlaybookRec => !!p && typeof p.id === 'string' && !!playbookById(p.id))
      .slice(0, 3);
    if (plays.length === 0) return null;
    return { channel: parsed.channel, plays };
  } catch { return null; }
}

/** prose with the block lifted out — the message text renders, the card renders beside it */
export function stripPlaybookRecs(body: string): string {
  return body.replace(NMPLAYS_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}
