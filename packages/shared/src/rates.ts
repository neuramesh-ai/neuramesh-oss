// What a credit buys — the rate card, in ONE place, versioned.
//
// Three costs a workspace imposes (docs/design/cloud-first-2026-08/starter-brain-and-credits.md):
// the BRAIN it thinks with, the MACHINE it runs on, and the STORAGE it keeps. v1 prices the
// first and defines the other two, so the meter is not built as if tokens were the only axis.
//
// Units. Internally everything is **micro-dollars** (µUSD, 1e-6 USD) as `bigint`-safe integers:
// three meters share one unit, and integer math has no float drift to reconcile at month end.
// Externally the user sees **credits**, where 1 credit = $0.01 = 10,000 µUSD — a round number
// people can hold in their head, unlike a token count or a six-decimal dollar figure.
//
// Versioned because a rate change must never silently restate history: a grant records the
// version in force when it was made, so an old balance stays explainable after a reprice.

import { planOf } from './entitlements';

export const RATE_VERSION = '2026-08-31.1';

/** µUSD in one user-facing credit. 1 credit = $0.01. */
export const CREDIT_MICROS = 10_000;

export const creditsToMicros = (credits: number): number => Math.round(credits * CREDIT_MICROS);
/** floor, deliberately: never show more credits than the balance can actually pay for */
export const microsToCredits = (micros: number): number => Math.floor(micros / CREDIT_MICROS);

// ── the brain ────────────────────────────────────────────────────────────────────────────
//
// The platform-provided model a workspace runs on before it connects its own. Chosen for
// TOOL-CALLING rather than headline price: the orchestrator's turn is a tool loop, and a model
// that mis-calls a tool re-sends the whole static prompt (~11.7k tokens) on the retry — so the
// cheaper-per-token option is not automatically cheaper per COMPLETED reply.
export const STARTER_MODEL = 'gemini-3.5-flash-lite';

/** Google bills thinking output at the output rate, so minimal thinking is part of the price. */
export const STARTER_THINKING_LEVEL = 'minimal';

/** µUSD per 1M tokens, list price. Input and output are priced separately by every vendor. */
export const MODEL_RATES: Record<string, { inPerMTok: number; outPerMTok: number }> = {
  // $0.30 in / $2.50 out per 1M tokens
  'gemini-3.5-flash-lite': { inPerMTok: 300_000, outPerMTok: 2_500_000 },
};

/** what one model call costs, in µUSD. unknown models price at zero rather than guessing —
 *  a wrong number in a ledger is worse than a visible gap. */
export function priceModelCall(model: string, inTokens: number, outTokens: number): number {
  const rate = MODEL_RATES[model];
  if (!rate) return 0;
  return Math.round((inTokens * rate.inPerMTok + outTokens * rate.outPerMTok) / 1_000_000);
}

// ── the grant ────────────────────────────────────────────────────────────────────────────
//
// FREE GRANTS NOTHING (source release, 2026-09-12): a Free workspace has no cloud machine and
// no metered brain, so nothing to grant for. The server mints no signup grant and the refill
// worklist skips `plan = 'free'`. These two constants survive only as the numbers the desktop's
// pre-release onboarding copy still prints (unit U5 retires that sentence); no server path
// reads them. Pro's allocation is CLOUD_SEAT_MONTHLY_CREDITS below, granted per seat at the
// plan flip and again on the 1st of every month.
export const SIGNUP_GRANT_CREDITS = 500;
export const MONTHLY_GRANT_CREDITS = 500;

/** the Pro plan's monthly allocation, PER SEAT. Chosen over 2,000 because at full
 *  consumption 2,000 credits ≈ $20 of metered value against $22 revenue — a 9% gross margin
 *  before Stripe fees if a seat max-burns. 1,500 holds ~30% at full burn; typical burn is far
 *  lower. A founder pricing lever, deliberately one constant. */
export const CLOUD_SEAT_MONTHLY_CREDITS = 1_500;

/** top-up packs — FLAT pricing, 1 credit = 1¢ at every size (George, 2026-08-31: flat over
 *  bonuses — flatter is more honest, and a bonus tier would break the "1 credit = $0.01"
 *  arithmetic everywhere the unit is explained). Purchasable on ANY plan, free included. */
export const CREDIT_PACKS = [
  { credits: 500, usd: 5 },
  { credits: 1_000, usd: 10 },
  { credits: 2_500, usd: 25 },
] as const;

/** THE MENU IS A CONVENIENCE, NOT THE PRICE LIST (George, 2026-08-31: "we shouldn't limit how
 *  much credits users can buy"). Three tiers capped what a customer could hand us, which is a
 *  strange thing to enforce. Any amount inside these bounds is buyable at the SAME flat rate,
 *  so the packs above are just the common sizes pre-filled — there is one pricing rule, not two.
 *
 *  Flat pricing makes the two directions exact inverses: 1 credit is 1¢, so dollars and credits
 *  convert without rounding drift and either field can be the one the person types in. */
export const CREDITS_PER_USD = 1_000_000 / CREDIT_MICROS;
export const usdForCredits = (credits: number): number => credits / CREDITS_PER_USD;
export const creditsForUsd = (usd: number): number => Math.round(usd * CREDITS_PER_USD);

/** $5 floor: Stripe's fixed 30¢ is 30% of a $1 charge and 6% of this one — below this we are
 *  mostly buying the processor a coffee. It also matches the smallest pack, so the floor is
 *  already the one people see. */
export const MIN_PACK_CREDITS = 500;
/** $10,000 ceiling — a FAT-FINGER RAIL, not a policy cap. It exists so a stray keystroke cannot
 *  open a five-figure checkout; raise it freely, nothing downstream depends on the number. */
export const MAX_PACK_CREDITS = 1_000_000;

/** no rollover: each period starts at the grant, so an idle month cannot bank a stockpile. */
export const CREDITS_ROLL_OVER = false;

/**
 * When the next refill lands, in UTC. The refill is a CALENDAR-MONTH boundary, not an anniversary
 * of the signup: the server's worklist is `period_start < date_trunc('month', today)`, so every
 * workspace refills on the 1st regardless of the day it was created.
 *
 * This lives here, beside the grant it refills, because the client STATES this date to the user —
 * and a promise the server will not keep is worse than no promise. Deriving `period_start + 1
 * month` agrees with the server only when the period happens to start on the 1st, which is
 * exactly the shape a fixture makes look correct.
 *
 * Returns null when the period has ALREADY rolled over — that workspace is on the refill
 * worklist now, and naming a future date for it would be wrong in the other direction.
 *
 * Returns null for a Free workspace too: since the source release nothing refills on Free (the
 * worklist filters `plan = 'cloud'`), so there is no date to name. `plan` is optional only so a
 * caller that does not know the plan keeps the pre-release answer; pass it wherever the plan is
 * at hand.
 */
export function nextRefillOn(periodStart: string, today: Date, plan?: string | null): Date | null {
  if (plan !== undefined && planOf(plan) === 'free') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodStart);
  if (!m) return null;
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(start)) return null;
  const monthTop = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1);
  // already due: the sweep will grant it on its next pass, so there is no date to name
  if (start < monthTop) return null;
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
}

// ── the other two meters ─────────────────────────────────────────────────────────────────
//
// Defined, not yet charged. Machine minutes keep their own daily cap in v1 (fleet-lifecycle)
// because converting them to credits needs a real cost-per-minute we cannot derive honestly
// until the operator's request-hours telemetry lands. Storage accrues gb-hours with no price
// attached for the same reason. Both are here so the shape is right when the rate arrives.
// ── the machine, priced (2026-08-31) ─────────────────────────────────────────────────────
//
// The cost basis this waited for arrived: a workspace pod (500m/2Gi, gVisor) bills on
// Autopilot at ~$26.4/month ≈ 604 µUSD per SCHEDULED minute — measured on the live cluster,
// not estimated. We charge only ACTIVE minutes (a minute in which the machine did work: an
// agent turn, a tool call, a live terminal). 1,000 µUSD/min = 1 credit per 10 active minutes,
// ~40% margin over the scheduled-minute cost it has to carry.
//
// STANDBY IS FREE, deliberately, bounded by the 48h idle stop (fleet-lifecycle): one idle
// episode costs us at most 48h × $0.036/h ≈ $1.73, and gaming it buys nothing — wake-on-message
// plus warm capacity already make a stopped machine a ~15s inconvenience, so there is no value
// in holding one up. Priced with eyes open in docs/design/credits-billing-2026-08/plan.md §3.4.
export const MACHINE_MICROS_PER_ACTIVE_MINUTE = 1_000;

/** what a stretch of active seconds costs. Integer µUSD; sub-minute work rounds rather than
 *  floors so sixty 30-second beats price the same as thirty minutes. */
export const priceActiveSeconds = (seconds: number): number =>
  Math.round((seconds / 60) * MACHINE_MICROS_PER_ACTIVE_MINUTE);

// Storage stays defined-not-charged: the PVC is the quota (10 GB free / 50 GB cloud) and a
// fixed disk cannot be exceeded, so an overage meter would bill a physically impossible state.
// The rate slot stays for the day disks grow on demand.
export const STORAGE_MICROS_PER_GB_HOUR: number | null = null;

// ── the video tiers ───────────────────────────────────────────────────────
//
// A film on the platform's key (docs/design/video-rung-2026-09, issue #539). The person picks a
// TIER by its house name; which vendor model a tier films on, and its price, is the server's
// registry, switched by an env variable. Free workspaces film on the default tier only (they hold
// no credits); Pro workspaces pick. The card names the vendor model beside the tier, because a
// film is a look a person chooses.
export const VIDEO_TIERS = ['starter', 'xpress', 'premium'] as const;
export type VideoTier = (typeof VIDEO_TIERS)[number];
export const VIDEO_TIER_LABELS: Record<VideoTier, string> = { starter: 'NeuraMesh Video Starter', xpress: 'NeuraMesh Video Xpress', premium: 'NeuraMesh Video Premium' };
export const isVideoTier = (s: unknown): s is VideoTier => typeof s === 'string' && (VIDEO_TIERS as readonly string[]).includes(s);

