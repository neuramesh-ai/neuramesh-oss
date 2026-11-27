// Setup flows (2026-08-09) — a channel kind's guided first-run, declared as DATA.
//
// The failure this retires, from live use: the marketing HQ's setup was a card rendered from
// ABSENCE (`channels.marketing` null ⇒ the room shows the wizard). Walk away mid-setup and
// nothing existed — no thread, no queue entry, no object to come back to; the answers already
// given rode React state and died with the card. So the setup became unreachable exactly for
// the person who abandoned it, who is exactly the person it exists for.
//
// The shape now: creating a channel whose kind has a flow also creates ONE setup task
// (kind='setup', DB-idempotent) whose thread hosts the same wizard. Each answered step writes
// through a command as it lands, so leaving is a pause; the open task holds the needs-you ball
// until the flow completes (which fires the flow's `onComplete` — for marketing, the same
// bootstrap that always ran) or the human cancels it (the opt-out).
//
// This module is the PURE half, beats.ts/stall.ts-style: the registry plus derivations both
// sides read. The server owns creation/idempotence/completion; the client owns rendering.
// Adding the next flow (a #build onboarding, say) is a data entry here, not a feature.

export interface SetupStep {
  id: string;
  /** short label for progress UI ("Product", "Goal"…) */
  label: string;
  /** the key this step writes inside the channel's profile JSON (channels.marketing today);
   * absent = the step's effect lives elsewhere (the connect step writes connector rows) */
  writes?: string;
  optional?: boolean;
}

export interface SetupFlow {
  /** versioned id, stamped on the profile's `setup_progress` marker (NEVER in user-facing
   * copy — it read as debug noise the one time it appeared there, George 2026-08-09) —
   * a CHANGED flow may re-run one day; an unchanged one must never re-offer itself */
  id: string;
  /** the channel kind this flow belongs to */
  kind: string;
  /** the setup task's title, verbatim */
  title: string;
  /** the setup task's description, verbatim: the side panel's Overview shows it beside the wizard */
  description: string;
  steps: SetupStep[];
}

export const MARKETING_SETUP_FLOW: SetupFlow = {
  id: 'marketing.v1',
  kind: 'marketing',
  title: 'Prepare your marketing HQ',
  description: 'Answer the questions in the thread. Each answer saves when you press Next, so you can stop and finish later. Close this task to skip setup.',
  steps: [
    { id: 'product', label: 'Product', writes: 'website' },
    { id: 'goal', label: 'Goal', writes: 'goal', optional: true },
    { id: 'focus', label: 'Focus', writes: 'focus' },
    { id: 'connect', label: 'Connect', optional: true },
    // release drafts (docs/design/release-drafts-2026-09 §4.7): the repository, the accounts, two
    // switches. Writes `{ repoId, slug, now, watch }`; the completing command plants the routines.
    { id: 'releases', label: 'Releases', writes: 'releases', optional: true },
  ],
};

/** Every flow, by channel kind. 'build' has none yet — that is the point of the registry. */
export const SETUP_FLOWS: Record<string, SetupFlow> = {
  marketing: MARKETING_SETUP_FLOW,
};

export function flowForChannelKind(kind: string | null | undefined): SetupFlow | null {
  return (kind && SETUP_FLOWS[kind]) || null;
}

export interface SetupProgress {
  /** steps completed (profile-derived, so every client agrees without storing UI state) */
  done: number;
  total: number;
  /** the id of the first incomplete step — where a resume lands. null once complete */
  next: string | null;
  /** the flow ran to completion (its onComplete fired — for marketing, setup_at is stamped) */
  complete: boolean;
}

/**
 * Where a (possibly abandoned) run of `flow` stands, derived from the channel's profile JSON.
 *
 * A step is done when its `writes` key holds a value, or when the profile's `setup_progress`
 * marker (stamped by the per-step command) has passed it — the marker covers write-less and
 * skipped-optional steps, the writes covers profiles configured before the marker existed.
 * `setup_at` (stamped by the completing command since the first marketing HQ shipped) is the
 * one authoritative "this ran to the end", so pre-flows rooms read as complete, and the
 * release-day backfill knows to leave them alone.
 */
export function setupProgress(flow: SetupFlow, profileJson: string | null | undefined): SetupProgress {
  let profile: Record<string, unknown> = {};
  try { profile = profileJson ? (JSON.parse(profileJson) as Record<string, unknown>) : {}; } catch { /* unreadable = untouched */ }
  const complete = !!profile['setup_at'];
  const marker = profile['setup_progress'] as { flow?: string; step?: string } | undefined;
  const markerIdx = marker && marker.flow === flow.id ? flow.steps.findIndex((s) => s.id === marker.step) : -1;
  let done = 0;
  let next: string | null = null;
  for (let i = 0; i < flow.steps.length; i++) {
    const s = flow.steps[i]!;
    const wrote = s.writes !== undefined && profile[s.writes] != null && (!Array.isArray(profile[s.writes]) || (profile[s.writes] as unknown[]).length > 0);
    const passed = markerIdx >= i;
    if (complete || wrote || passed) done += 1;
    else if (next === null) next = s.id;
  }
  if (complete) return { done: flow.steps.length, total: flow.steps.length, next: null, complete };
  return { done, total: flow.steps.length, next, complete };
}

/** the head of the person's answers when the marketing setup completes. the daemon starts the brand
 *  bootstrap on it and wakes no agent (host/wakerouting.ts reads the same head), so the room's marketer
 *  answers it */
export const SETUP_ANSWERS_HEAD = '**Marketing HQ setup**';
export const isSetupAnswers = (body: string): boolean => body.startsWith(SETUP_ANSWERS_HEAD);
/** the answers as the thread shows them: the head, then one list row for each answer. single line
 *  breaks join into one paragraph in markdown, so each answer is a row */
export function setupAnswersBody(rows: ReadonlyArray<readonly [label: string, value: string]>): string {
  return [SETUP_ANSWERS_HEAD, '', ...rows.map(([label, value]) => `- ${label}: ${value}`)].join('\n');
}

/** The one-line progress note surfaces show beside the task ("step 2 of 5 · Goal"). */
export function setupProgressLabel(flow: SetupFlow, p: SetupProgress): string {
  if (p.complete) return 'complete';
  const at = flow.steps.find((s) => s.id === p.next);
  return `step ${Math.min(p.done + 1, p.total)} of ${p.total}${at ? ` · ${at.label}` : ''}`;
}

// ── AREA FLOWS (docs/design/sales-onboarding-2026-11/plan.md, approved 2026-11-26) ──
// The registry grows from a flow for each channel kind to a flow for each AREA (Sales now, Finance and Marketing
// next). An area flow runs as a chat session in the area's room, answered by the area's agent, with one card for each
// step. The flow stays data: the card kinds are hq's code, and each step's "done" is derived from the step's real
// home (a profile key, a connection, a row), never stored as UI state. The run (`setup_runs`, 0210) keeps only what
// has no other home: the steps the person skipped, the last step card posted, and the end.

/** the card a step shows: one component for each kind in hq, reused by every area */
export type AreaSetupCard = 'ask' | 'chips' | 'connect' | 'sources' | 'review' | 'draft';
export interface AreaSetupStep { id: string; label: string; card: AreaSetupCard }
export interface AreaSetupFlow {
  /** versioned, stamped on the run and on each step card's marker */
  id: string;
  area: 'sales';
  /** the room the session lives in, and the role of the agent that answers it */
  room: string; role: string;
  /** the session's title, and the agent's first line */
  title: string; intro: string;
  /** the run completes when each step is done or skipped and this many of the area's results exist */
  bar: number;
  steps: AreaSetupStep[];
}

export const SALES_SETUP_FLOW: AreaSetupFlow = {
  id: 'sales.v1',
  area: 'sales',
  room: 'sales', role: 'sales',
  title: 'Set up Sales',
  intro: 'I set up Sales with you in six steps. At the end, you have at least 3 leads in your pipeline. You can skip a step and come back to it later.',
  bar: 3,
  steps: [
    { id: 'company', label: 'Your company', card: 'ask' },
    { id: 'customer', label: 'Your customer', card: 'chips' },
    { id: 'gmail', label: 'Gmail', card: 'connect' },
    { id: 'find', label: 'Find leads', card: 'sources' },
    { id: 'review', label: 'Review leads', card: 'review' },
    { id: 'note', label: 'First note', card: 'draft' },
  ],
};

/** every area flow, by id */
export const AREA_SETUP_FLOWS: Record<string, AreaSetupFlow> = { [SALES_SETUP_FLOW.id]: SALES_SETUP_FLOW };
