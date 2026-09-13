// Plan entitlements — the per-plan caps the product enforces, in ONE place so the
// renderer (pre-flight UX), the desktop main process (the local trust boundary that
// actually writes attachment bytes), and the control-api guards never drift. Keyed by
// workspaces.plan ('free' | 'cloud'); see the billing model in docs + 0045_workspace_plan.
//
// Scope note: this centralizes ATTACHMENT limits (the new surface). The pre-existing
// project/machine/teammate caps still live at their call sites — not refactored here.

export type Plan = 'free' | 'cloud';

export interface AttachmentLimits {
  /** Max attachments carried by a single message. */
  maxPerMessage: number;
  /** Max size (bytes) for a single attached file. */
  maxBytes: number;
}

export interface PlanEntitlements {
  attachments: AttachmentLimits;
}

const MB = 1024 * 1024;

export const PLAN_ENTITLEMENTS: Record<Plan, PlanEntitlements> = {
  free: { attachments: { maxPerMessage: 3, maxBytes: 5 * MB } },
  cloud: { attachments: { maxPerMessage: 10, maxBytes: 20 * MB } },
};

/**
 * TWO PLANS, NEVER CONFUSED: **Free** and **Pro** (source release, 2026-09-12; Individual and
 * Team before that, George 2026-09-03). The ids stay 'free' | 'cloud' — server truth, Stripe
 * wiring, every guard — only the words a person sees change, and they change everywhere:
 * pricing, upgrade screens, refusals, email. Every string that names a plan reads it from here.
 */
export const PLAN_LABELS: Record<Plan, string> = { free: 'Free', cloud: 'Pro' };
export const planLabel = (plan: string | null | undefined): string => PLAN_LABELS[planOf(plan)];

/**
 * Seats a Free workspace includes: ONE — the owner (George, 2026-09-03). Free is one person.
 * Wanting a second human is exactly the moment the workspace moves to Pro, where every member
 * gets a cloud machine of their own (docs/design/member-machines-2026-09) — so the invitation
 * itself is the upgrade door.
 *
 * It was 3 (docs/27 §1e) while a free workspace could invite. The constant keeps its name
 * because every guard reads it, and the ENFORCEMENT NOTE stands: the count must include
 * PENDING INVITES, not just current members — see pgstore.workspaceSeatsUsed.
 */
export const FREE_SEAT_CAP = 1;

/** Seats included in a plan; Pro is billed per seat, so it has no ceiling. */
export function seatCap(plan: string | null | undefined): number {
  return planOf(plan) === 'cloud' ? Number.POSITIVE_INFINITY : FREE_SEAT_CAP;
}

export const seatLimitReason = (): string =>
  `${planLabel('free')} workspaces are for one person. Upgrade to ${planLabel('cloud')} to invite teammates. Each teammate gets a cloud machine of their own.`;

/** Normalize an arbitrary plan string to a known Plan; unknown/missing fails closed to 'free'. */
export function planOf(plan: string | null | undefined): Plan {
  return plan === 'cloud' ? 'cloud' : 'free';
}

export function attachmentLimits(plan: string | null | undefined): AttachmentLimits {
  return PLAN_ENTITLEMENTS[planOf(plan)].attachments;
}

/** Human-friendly size for limit copy + file chips, e.g. "5MB" · "512KB" · "1.5MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < MB) return `${Math.round(n / 1024)}KB`;
  const mb = n / MB;
  return `${mb >= 10 || Number.isInteger(mb) ? Math.round(mb) : mb.toFixed(1)}MB`;
}

/** The contextual reason shown in the upgrade modal when a free user trips a cap. */
export function attachmentUpgradeReason(over: 'count' | 'size'): string {
  const f = PLAN_ENTITLEMENTS.free.attachments;
  const c = PLAN_ENTITLEMENTS.cloud.attachments;
  return over === 'count'
    ? `${planLabel('free')} includes ${f.maxPerMessage} attachments per message. Upgrade to ${planLabel('cloud')} for ${c.maxPerMessage}.`
    : `${planLabel('free')} allows files up to ${formatBytes(f.maxBytes)} each. Upgrade to ${planLabel('cloud')} for ${formatBytes(c.maxBytes)} per file.`;
}
