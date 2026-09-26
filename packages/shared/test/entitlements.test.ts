import { describe, it, expect } from 'vitest';
import {
  PLAN_ENTITLEMENTS,
  PLAN_LABELS,
  planLabel,
  hostedPlanLabel,
  TRIAL_LABEL,
  planOf,
  attachmentLimits,
  formatBytes,
  attachmentUpgradeReason,
  seatLimitReason,
} from '../src/entitlements';

const MB = 1024 * 1024;

describe('plan entitlements', () => {
  it('free caps: 3 attachments, 5MB each', () => {
    expect(PLAN_ENTITLEMENTS.free.attachments).toEqual({ maxPerMessage: 3, maxBytes: 5 * MB });
  });
  it('cloud caps: 10 attachments, 20MB each', () => {
    expect(PLAN_ENTITLEMENTS.cloud.attachments).toEqual({ maxPerMessage: 10, maxBytes: 20 * MB });
  });

  it('planOf fails closed to free for unknown/missing plans', () => {
    expect(planOf('cloud')).toBe('cloud');
    expect(planOf('free')).toBe('free');
    expect(planOf(null)).toBe('free');
    expect(planOf(undefined)).toBe('free');
    expect(planOf('enterprise')).toBe('free');
  });

  it('attachmentLimits resolves by plan', () => {
    expect(attachmentLimits('cloud').maxPerMessage).toBe(10);
    expect(attachmentLimits('free').maxBytes).toBe(5 * MB);
    expect(attachmentLimits(null).maxBytes).toBe(5 * MB);
  });
});

describe('formatBytes', () => {
  it('formats across units', () => {
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(512 * 1024)).toBe('512KB');
    expect(formatBytes(5 * MB)).toBe('5MB');
    expect(formatBytes(20 * MB)).toBe('20MB');
    expect(formatBytes(1.5 * MB)).toBe('1.5MB');
  });
});

// the words a person reads for the two plans (source release, 2026-09-12): Free and Pro, and every
// string that names a plan reads them from here, so a rename is one line, not a hunt.
describe('plan labels', () => {
  it('free is Free and cloud is Pro', () => {
    expect(PLAN_LABELS).toEqual({ free: 'Free', cloud: 'Pro' });
    expect(planLabel('cloud')).toBe('Pro');
    expect(planLabel('free')).toBe('Free');
    // unknown and missing fail closed to Free, like planOf
    expect(planLabel(null)).toBe('Free');
    expect(planLabel('enterprise')).toBe('Free');
  });
  it('the refusals name the plans through the labels, never by a hard-coded word', () => {
    expect(seatLimitReason()).toMatch(/^The Pro trial is for one person\. Upgrade to Pro/);
    expect(seatLimitReason()).not.toMatch(/Individual|Team/);
    expect(attachmentUpgradeReason('count')).not.toMatch(/Individual|Team/);
  });
  // George, 2026-09-25: a hosted signup is a Pro trial, and Free is the desktop app on a Mac
  it('a hosted workspace on the free id reads Pro trial, and a paid one reads Pro', () => {
    expect(TRIAL_LABEL).toBe('Pro trial');
    expect(hostedPlanLabel('free')).toBe('Pro trial');
    expect(hostedPlanLabel(null)).toBe('Pro trial');
    expect(hostedPlanLabel('cloud')).toBe('Pro');
  });
  it('a limit a Mac and the cloud share names no current plan: Free is right on one, wrong on the other', () => {
    for (const over of ['count', 'size'] as const) {
      const r = attachmentUpgradeReason(over);
      expect(r).not.toMatch(/\bFree\b|Pro trial/);
      expect(r).toMatch(/\bPro\b/);
      expect(r).not.toMatch(/[—;]/);
    }
  });
});

describe('attachmentUpgradeReason', () => {
  it('count reason names both plan caps', () => {
    const r = attachmentUpgradeReason('count');
    expect(r).toContain('3');
    expect(r).toContain('10');
    expect(r).toMatch(/Upgrade to Pro/);
  });
  it('size reason names both plan caps', () => {
    const r = attachmentUpgradeReason('size');
    expect(r).toContain('5MB');
    expect(r).toContain('20MB');
  });
});
