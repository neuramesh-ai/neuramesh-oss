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
  steps: SetupStep[];
}

export const MARKETING_SETUP_FLOW: SetupFlow = {
  id: 'marketing.v1',
  kind: 'marketing',
  title: 'Set up your marketing HQ',
  steps: [
    { id: 'product', label: 'Product', writes: 'website' },
    { id: 'goal', label: 'Goal', writes: 'goal', optional: true },
    { id: 'focus', label: 'Focus', writes: 'focus' },
    { id: 'connect', label: 'Connect', optional: true },
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

/** The one-line progress note surfaces show beside the task ("step 2 of 4 — Focus"). */
export function setupProgressLabel(flow: SetupFlow, p: SetupProgress): string {
  if (p.complete) return 'complete';
  const at = flow.steps.find((s) => s.id === p.next);
  return `step ${Math.min(p.done + 1, p.total)} of ${p.total}${at ? ` — ${at.label}` : ''}`;
}
