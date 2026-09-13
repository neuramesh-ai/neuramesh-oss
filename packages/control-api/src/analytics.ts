// Activation-funnel telemetry — EVENT-LEVEL ONLY (office-hours decision 2026-06-23).
//
// We tap the single domain-event sink (pgstore.insertEvent) and forward the event
// *type* plus a few safe scalars to PostHog. We deliberately send NO content: never
// the event payload (it can carry feedback/reason/titles), never a message body,
// never code, and no UUIDs in properties beyond the workspace key used as the
// distinct id. That makes the whole activation funnel measurable
// (workspace.created -> agent.registered -> task.created -> task.submitted ->
// task.accepted) plus IC-drop signals (task.changes_requested / task.blocked)
// without ever shipping user content off the machine.
//
// Gated on POSTHOG_KEY. Absent -> a hard no-op, so OSS/local users, CI, and the
// deterministic `echo` test mode emit nothing. `NM_TELEMETRY=off` is a kill switch
// even when a key is present.
import { PostHog } from 'posthog-node';
import type { NMEvent } from '@neuramesh/shared';

const KEY = process.env['POSTHOG_KEY'];
const HOST = process.env['POSTHOG_HOST'] ?? 'https://us.i.posthog.com';
const ENABLED = !!KEY && process.env['NM_TELEMETRY'] !== 'off' && process.env['NM_AGENT_MODE'] !== 'echo';

let client: PostHog | null = null;
function ph(): PostHog | null {
  if (!ENABLED) return null;
  if (!client) client = new PostHog(KEY!, { host: HOST, flushAt: 1, flushInterval: 10_000 });
  return client;
}

// message.posted is high-volume and body-bearing; it is not part of the activation
// funnel, so we exclude it. Every other domain event is a meaningful, low-cardinality
// lifecycle signal and flows through verbatim (as its own funnel-readable event name).
const SKIP = new Set(['message.posted']);

// 'agent:uuid' -> 'agent', 'human:uuid' -> 'human', 'task:1012' -> 'task'
function kindOf(addr: string | null | undefined): string | undefined {
  if (!addr) return undefined;
  const i = addr.indexOf(':');
  return i > 0 ? addr.slice(0, i) : addr;
}
// task number is a non-sensitive integer (not content) — useful for ordering the funnel
function taskNumber(target: string | null | undefined): number | undefined {
  const m = /^task:(\d+)$/.exec(target ?? '');
  return m ? Number(m[1]) : undefined;
}

export interface Capture {
  distinctId: string;
  event: string;
  properties: Record<string, unknown>;
}

/**
 * Pure mapping from a domain event to a PostHog capture — or null to drop it.
 * No env, no client, no I/O: this is the unit-testable core of the funnel, and
 * it is where the "event-level only, no content" guarantee lives (it copies the
 * type + safe scalars and NOTHING from e.payload).
 */
export function eventToCapture(e: NMEvent): Capture | null {
  if (SKIP.has(e.type)) return null;
  return {
    distinctId: e.workspace, // the workspace = the activation unit (a founder's org)
    event: e.type, // e.g. 'task.accepted' — funnels read straight off these names
    properties: {
      nm_source: kindOf(e.source), // 'human' | 'agent' — who triggered it
      nm_target: kindOf(e.target), // 'task' | 'channel' | 'workspace' | ...
      nm_task_number: taskNumber(e.target),
      $process_person_profile: false, // server events: no person profiles
    },
  };
}

/** Fire-and-forget activation telemetry for one domain event. Never throws. */
export function trackDomainEvent(e: NMEvent): void {
  const c = ph();
  if (!c) return;
  const cap = eventToCapture(e);
  if (!cap) return;
  try {
    c.capture(cap);
  } catch {
    /* analytics must never break the command path */
  }
}

/** Flush queued events on shutdown so the last turn's funnel data isn't lost. */
export async function shutdownAnalytics(): Promise<void> {
  if (!client) return;
  try {
    await client.shutdown();
  } catch {
    /* best-effort */
  }
}
