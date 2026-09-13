// The email system's load-bearing invariants (docs/27). These are the ones that must be
// impossible to get wrong, not merely discouraged:
//   1. exactly-once — the outbox's unique dedupe_key, not a cron that remembers
//   2. the lifecycle decision — a pure function, so every suppression rule is testable
//   3. unsubscribe tokens — unforgeable
//   4. the rendered email itself — no unbounded claims, no missing preheader
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store';
import { dueFor, type LifecycleRow } from '../src/lifecycle';
import { unsubscribeToken, verifyUnsubscribeToken } from '../src/mail';
import { renderDay3, renderHostedFreeNotice, renderInvite, renderJoined, renderWelcome } from '@neuramesh/shared';

const row = (over: Partial<LifecycleRow> = {}): LifecycleRow => ({
  userId: 'u1', email: 'a@b.dev', workspaceId: 'ws', plan: 'free',
  ageHours: 0, unsubscribed: false, bounced: false, sinceLastHours: null,
  startedTask: false, hasMarketingRoom: false, seatsUsed: 1,
  lesson: null, statAccepted: 0, statReviews: 0, statLessons: 0, shippedThing: null,
  ...over,
});

describe('the outbox is exactly-once by construction', () => {
  it('refuses a second row for the same dedupe key', async () => {
    const store = new MemoryStore();
    const meta = { toEmail: 'a@b.dev', template: 'welcome', kind: 'lifecycle' as const, subject: 'hi', dedupeKey: 'welcome:u1' };
    expect(await store.enqueueEmail(meta)).not.toBeNull();
    // a re-fired cron, a redeploy mid-batch, a second host: all land here, and null is the
    // CORRECT outcome — the caller treats it as "already handled", never as an error
    expect(await store.enqueueEmail(meta)).toBeNull();
  });

  it('lets a different key through', async () => {
    const store = new MemoryStore();
    await store.enqueueEmail({ toEmail: 'a@b.dev', template: 'welcome', kind: 'lifecycle', subject: 'hi', dedupeKey: 'welcome:u1' });
    expect(await store.enqueueEmail({ toEmail: 'a@b.dev', template: 'day1', kind: 'lifecycle', subject: 'hi', dedupeKey: 'nudge_d1:u1' })).not.toBeNull();
  });
});

describe('lifecycle suppression is in the decision, not the copy', () => {
  it('sends nothing before the first day', () => {
    expect(dueFor(row({ ageHours: 5 }))).toBeNull();
  });

  it('day1 only for the un-activated', () => {
    expect(dueFor(row({ ageHours: 30 }))).toBe('day1');
    expect(dueFor(row({ ageHours: 30, startedTask: true }))).toBeNull();
  });

  it('day3 requires a real lesson to quote — no lesson, no email', () => {
    expect(dueFor(row({ ageHours: 80 }))).toBeNull();
    expect(dueFor(row({ ageHours: 80, lesson: { text: 'x', taskNumber: 1, channel: 'dev', reviewer: 'scout', worker: 'patch' } }))).toBe('day3');
  });

  it('marketing is suppressed once they already have a marketing room', () => {
    expect(dueFor(row({ ageHours: 5 * 24 + 1 }))).toBe('marketing');
    expect(dueFor(row({ ageHours: 5 * 24 + 1, hasMarketingRoom: true }))).toBeNull();
  });

  it('day7 is free-plan only — an upgrade mid-flight cancels it', () => {
    expect(dueFor(row({ ageHours: 8 * 24 }))).toBe('day7');
    // a Cloud user never gets the upgrade pitch. They can still get `marketing`, which is not
    // plan-gated — the fall-through is deliberate, not a leak.
    expect(dueFor(row({ ageHours: 8 * 24, plan: 'cloud' }))).not.toBe('day7');
    expect(dueFor(row({ ageHours: 8 * 24, plan: 'cloud', hasMarketingRoom: true }))).toBeNull();
  });

  it('respects opt-out and hard bounces above everything else', () => {
    expect(dueFor(row({ ageHours: 8 * 24, unsubscribed: true }))).toBeNull();
    expect(dueFor(row({ ageHours: 8 * 24, bounced: true }))).toBeNull();
  });

  it('never sends two lifecycle emails inside 48h', () => {
    expect(dueFor(row({ ageHours: 8 * 24, sinceLastHours: 12 }))).toBeNull();
    expect(dueFor(row({ ageHours: 8 * 24, sinceLastHours: 60 }))).toBe('day7');
  });

  it('a long-idle user gets the latest stage, not a replay of day 1', () => {
    // ten days idle with no task started: day7, not day1
    expect(dueFor(row({ ageHours: 10 * 24, startedTask: false }))).toBe('day7');
  });
});

describe('unsubscribe tokens are unforgeable', () => {
  it('round-trips its own token', () => {
    expect(verifyUnsubscribeToken(unsubscribeToken('user-123'))).toBe('user-123');
  });

  it('rejects a tampered user id', () => {
    const t = unsubscribeToken('user-123');
    expect(verifyUnsubscribeToken(t.replace('user-123', 'user-456'))).toBeNull();
  });

  it('rejects garbage and a missing signature', () => {
    expect(verifyUnsubscribeToken('user-123')).toBeNull();
    expect(verifyUnsubscribeToken('user-123.deadbeef')).toBeNull();
    expect(verifyUnsubscribeToken('')).toBeNull();
  });
});

describe('rendered email holds the line on docs/28', () => {
  const rendered = [
    renderInvite({ inviter: 'George', inviterEmail: 'g@nm.app', workspace: 'Flowe', role: 'Member', acceptUrl: 'https://x/join?token=t' }),
    renderWelcome({ downloadUrl: 'https://x/downloads', unsubscribeUrl: 'https://x/u/t' }),
    renderJoined({ joinedEmail: 'ada@flowe.dev', workspace: 'Flowe', role: 'Member', seatLine: '2 of 3', settingsUrl: 'https://x' }),
    renderDay3({ lesson: 'never mock the db', taskNumber: 1042, channel: 'dev', reviewer: 'scout', worker: 'patch', statAccepted: 4, statReviews: 11, statLessons: 6, window: 'your first week', openUrl: 'https://x', unsubscribeUrl: 'https://x/u/t' }),
    renderHostedFreeNotice({ workspaces: ['Flowe', 'Side Quest'], effectiveDate: '2026-09-29', proUrl: 'https://x/pro', termsUrl: 'https://x/terms', exportPath: 'GET /v1/workspaces/ws-1/export' }),
  ];

  it('every email has a subject, a preheader and a text alternative', () => {
    for (const r of rendered) {
      expect(r.subject.length).toBeGreaterThan(8);
      expect(r.preheader.length).toBeGreaterThan(8);
      expect(r.text.length).toBeGreaterThan(80); // multipart: HTML-only scores worse with filters
    }
  });

  it('contains no em dashes anywhere in the rendered body', () => {
    // They read as filler at small sizes and hide weak sentence joins. A full stop, a colon or
    // a comma always beats one. Enforced here so it cannot creep back in a copy edit.
    for (const r of rendered) {
      expect(r.text).not.toMatch(/—/);
      expect(r.html.replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/—/);
    }
  });

  it('carries no banned cadence from docs/28', () => {
    for (const r of rendered) {
      expect(r.text).not.toMatch(/that's the difference between/i);
      expect(r.text).not.toMatch(/here's the thing/i);
      expect(r.text).not.toMatch(/\b(powerful|seamless|robust|effortless|comprehensive)\b/i);
    }
  });

  it('day3 states the BOUND, never "every prompt" or "never comes back"', () => {
    const day3 = rendered[3]!;
    expect(day3.text).toMatch(/up to six/i);              // the real cap, agents.ts:1533
    expect(day3.text).not.toMatch(/every future prompt/i);
    expect(day3.text).not.toMatch(/doesn't come back/i);
  });

  it('day3 drops the stat card entirely at zero rather than printing "0 accepted"', () => {
    const empty = renderDay3({ lesson: 'x', taskNumber: null, channel: 'dev', reviewer: 'scout', worker: 'patch', statAccepted: 0, statReviews: 0, statLessons: 0, window: 'your first week', openUrl: 'https://x', unsubscribeUrl: 'https://x/u/t' });
    expect(empty.text).not.toMatch(/\baccepted\b/i);
  });

  it('joined tells the truth about workspace-wide visibility', () => {
    // the sentence an adversarial review caught inverted; sync-config.yaml:11 is workspace-scoped
    expect(rendered[2]!.text).toMatch(/whole workspace/i);
    expect(rendered[2]!.text).not.toMatch(/only sees the rooms/i);
  });

  it('transactional email carries no unsubscribe link; lifecycle does', () => {
    expect(rendered[0]!.html).not.toMatch(/Unsubscribe/);  // invite
    expect(rendered[1]!.html).toMatch(/Unsubscribe/);      // welcome
  });

  it('escapes interpolated values instead of trusting them', () => {
    const evil = renderInvite({ inviter: '<script>alert(1)</script>', inviterEmail: 'g@nm.app', workspace: 'A&B', role: 'Member', acceptUrl: 'https://x' });
    expect(evil.html).not.toMatch(/<script>/);
    expect(evil.html).toMatch(/A&amp;B/);
  });

  it('never emits a fixed px width on the shell table (the 390px overflow bug)', () => {
    for (const r of rendered) expect(r.html).not.toMatch(/style="width:560px/);
  });
});

// The hosted free notice (unit U1b): the subject the plan names, the date, the export, Get Pro,
// and every sentence ASD-STE100 (no em dash, no semicolon).
describe('the hosted free notice says what changes and offers both doors', () => {
  const one = renderHostedFreeNotice({ workspaces: ['Flowe'], effectiveDate: '2026-09-29', proUrl: 'https://x/pro', termsUrl: 'https://x/terms', exportPath: 'GET /v1/workspaces/ws-1/export' });
  const two = renderHostedFreeNotice({ workspaces: ['Flowe', 'Side Quest'], effectiveDate: '2026-09-29', proUrl: 'https://x/pro', termsUrl: 'https://x/terms', exportPath: 'GET /v1/workspaces/ws-1/export' });

  it('carries the subject, the date, what stays, the export, and Get Pro', () => {
    expect(one.subject).toBe('A change to your free NeuraMesh workspace');
    expect(one.text).toContain('2026-09-29');
    expect(one.text).toMatch(/stays readable/i);
    expect(one.text).toMatch(/export/i);
    expect(one.text).toContain('GET /v1/workspaces/ws-1/export');
    expect(one.text).toContain('Files on a cloud machine are not in the export.');
    expect(one.html).toContain('https://x/pro');
    expect(one.text).toContain('$22 per seat, per month');
    expect(one.text).toContain('https://x/terms');
  });

  it('names every workspace the owner holds, singular and plural', () => {
    expect(one.text).toContain('a NeuraMesh workspace on the free plan: Flowe.');
    expect(two.text).toContain('2 NeuraMesh workspaces on the free plan: Flowe, Side Quest.');
  });

  it('has no semicolon anywhere a person reads (the em dash rule is checked above for every email)', () => {
    expect(one.text).not.toMatch(/;/);
    expect(one.subject + one.preheader).not.toMatch(/[—;]/);
  });
});
