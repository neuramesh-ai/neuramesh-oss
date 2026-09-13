import type { NMEvent } from '@neuramesh/shared';
import { describe, expect, it } from 'vitest';
import { eventToCapture, trackDomainEvent } from '../src/analytics';
import { implementationPlanName, nextPlanVersion } from '../src/handler';

// minimal valid domain event; override per-case. The payload deliberately carries
// "content" so we can assert it never leaves the mapping.
const ev = (over: Partial<NMEvent> = {}): NMEvent =>
  ({
    id: '01KVVQWPFC3YTT2A8CKG0TR3ZC',
    workspace: 'ws-1',
    type: 'task.accepted',
    source: 'human:abc',
    target: 'task:1012',
    payload: { feedback: 'looks great' },
    in_reply_to: null,
    ...over,
  }) as NMEvent;

describe('activation telemetry mapping (event-level only)', () => {
  it('maps a task event to a funnel-readable capture with safe scalars only', () => {
    expect(eventToCapture(ev())).toEqual({
      distinctId: 'ws-1',
      event: 'task.accepted',
      properties: { nm_source: 'human', nm_target: 'task', nm_task_number: 1012, $process_person_profile: false },
    });
  });

  it('NEVER forwards event payload / content (the privacy guarantee)', () => {
    const cap = eventToCapture(ev({ payload: { feedback: 'SECRET-FEEDBACK', title: 'my-private-repo-plan' } }));
    const serialized = JSON.stringify(cap);
    expect(serialized).not.toContain('SECRET-FEEDBACK');
    expect(serialized).not.toContain('private-repo');
    expect(cap?.properties).not.toHaveProperty('payload');
  });

  it('parses an agent source and a non-task target', () => {
    const cap = eventToCapture(ev({ type: 'agent.registered', source: 'agent:xyz', target: 'workspace:ws-1' }));
    expect(cap?.properties.nm_source).toBe('agent');
    expect(cap?.properties.nm_target).toBe('workspace');
    expect(cap?.properties.nm_task_number).toBeUndefined();
  });

  it('drops high-volume, body-bearing message.posted (not part of the funnel)', () => {
    expect(eventToCapture(ev({ type: 'message.posted' }))).toBeNull();
  });

  it('trackDomainEvent is a no-op and never throws without POSTHOG_KEY', () => {
    // POSTHOG_KEY is unset in the test env → disabled → no client, no network
    expect(() => trackDomainEvent(ev())).not.toThrow();
    expect(trackDomainEvent(ev())).toBeUndefined();
  });
});

// ── plan versioning (#1034) ────────────────────────────────────────────────────
// The version used to be the task's running artifactCount, on the premise that only
// plans exist during the plan phase. A design gate breaks it: propose_design bumps the
// same counter, so a design-gated task's FIRST plan was born "v3" while the daemon
// announced "v1" and linked a file that never existed.
describe('nextPlanVersion', () => {
  it('counts plans only — design mockups do not inflate it', () => {
    expect(nextPlanVersion([])).toBe(1);
    expect(nextPlanVersion([
      'design-mockup-v1-hero-a.html',
      'design-mockup-v1-hero-b.html',
      'design-mockup-v2-hero-warm.html',
    ])).toBe(1);
    expect(nextPlanVersion(['design-mockup-v1-x.html', 'implementation-plan-v1.md'])).toBe(2);
  });

  it('derives from the highest existing name, so it never collides with the old mis-numbered files', () => {
    // a task that already carries v3/v5 from the buggy formula: count+1 would return 3
    // and overwrite an existing artifact; max+1 keeps every name distinct
    expect(nextPlanVersion(['implementation-plan-v3.md', 'implementation-plan-v5.md'])).toBe(6);
  });

  it('ignores unrelated artifacts and malformed names', () => {
    expect(nextPlanVersion(['ship-plan-v9.md', 'rollout-plan.md', 'REPORT.md', 'implementation-plan.md'])).toBe(1);
  });

  it('names the artifact', () => {
    expect(implementationPlanName(nextPlanVersion([]))).toBe('implementation-plan-v1.md');
  });
});
