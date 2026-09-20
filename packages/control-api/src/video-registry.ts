// The video registry (docs/design/video-rung-2026-09 §3, issue #539): every model the platform
// can film on through its fal.ai key, with the endpoint, the input the lane sends, the list price
// per second by resolution, and a label. Prices are fal's list prices on the day they were read
// (2026-09-19) and the ledger charges AT COST (George's call), so a reprice is a one-line edit here
// and RATE_VERSION in shared/rates.ts records which card a grant was made under.
//
// The person never sees a registry key. They pick a TIER (starter · xpress · premium, shared
// VIDEO_TIERS) and the env variable NM_VIDEO_TIERS maps each tier to a key, so switching the model
// behind a tier is a deploy, not a release: `starter=seedance-2.0-fast,xpress=minimax-h3,premium=seedance-2.0`.
import { CREDIT_MICROS, VIDEO_TIERS, VIDEO_TIER_LABELS, filmCredits as creditsFor, filmLengthsWithin, isVideoTier, type VideoTier } from '@neuramesh/shared';

export interface VideoModel {
  key: string;
  /** the vendor model's name as the card prints it */
  label: string;
  vendor: string;
  endpoint: string;
  /** µUSD per second of output at the resolution the lane asks for */
  perSecondMicros: number;
  resolution: string;
  /** the lengths the endpoint accepts, in seconds (fal's `duration` enum, read 2026-09-19) */
  seconds: { min: number; max: number };
  /** the request body fal's queue takes for this endpoint */
  input: (prompt: string, seconds: number) => Record<string, unknown>;
  /** the model's reference lane, when it has one (brand-grounding plan §6): the endpoint that takes
   *  images beside the prompt, and the body with the frame in it. A model without one films the
   *  text lane and the card says the frame was not used. */
  reference?: { endpoint: string; input: (prompt: string, seconds: number, imageUrls: string[]) => Record<string, unknown> };
}

/** what the prompt says about the frame, appended ONLY on a reference lane: a text lane must never
 *  read "@Image1". Rewritten 2026-09-19 (plan §8): the first clause asked for the screenshot's
 *  lettering as "the only lettering in the film", and the model obliged by re-typesetting every
 *  small label as pseudo-words ("Nro-lact", found live). A video model cannot copy small type; it
 *  can keep a layout, its colors and its shapes. So the clause asks for the screen as it is and
 *  forbids invented interfaces and added text, and says nothing that invites typesetting. */
export const REFERENCE_CLAUSE = '@Image1 is a real screenshot of the product. The screen in the film shows exactly that: the same layout, colors and shapes. Invent no other interface, add no labels, add no text.';
const withFrame = (prompt: string): string => `${prompt} ${REFERENCE_CLAUSE}`;

const usd = (dollarsPerSecond: number): number => Math.round(dollarsPerSecond * 1_000_000);
// Seedance's request body. `bitrate_mode: high` is the other half of the lettering fix: fal
// encodes at the same price either way, and the standard rate is what smears small type and
// edges first (the "overcompression" the guides name). The file is larger, the row cap is sized
// for it (starter-video.ts). `duration` is a string enum on every Seedance endpoint.
const seedance = (resolution: string) => (prompt: string, seconds: number): Record<string, unknown> => ({ prompt, resolution, duration: String(seconds), aspect_ratio: '9:16', generate_audio: true, bitrate_mode: 'high' });
const seedanceRef = (resolution: string) => (prompt: string, seconds: number, image_urls: string[]): Record<string, unknown> => ({ ...seedance(resolution)(withFrame(prompt), seconds), image_urls });

export const VIDEO_MODELS: Record<string, VideoModel> = {
  'seedance-2.0-fast': {
    key: 'seedance-2.0-fast', label: 'Seedance 2.0', vendor: 'ByteDance', endpoint: 'bytedance/seedance-2.0/fast/text-to-video', perSecondMicros: usd(0.2419), resolution: '720p', seconds: { min: 4, max: 15 },
    input: seedance('720p'),
    // the same price per second as the text lane (fal, read 2026-09-19); up to nine images, data URIs accepted
    reference: { endpoint: 'bytedance/seedance-2.0/fast/reference-to-video', input: seedanceRef('720p') },
  },
  'seedance-2.0': {
    key: 'seedance-2.0', label: 'Seedance 2.0 Standard', vendor: 'ByteDance', endpoint: 'bytedance/seedance-2.0/text-to-video', perSecondMicros: usd(0.3034), resolution: '720p', seconds: { min: 4, max: 15 },
    input: seedance('720p'),
    reference: { endpoint: 'bytedance/seedance-2.0/reference-to-video', input: seedanceRef('720p') },
  },
  // the long lane (fal, read 2026-09-19): 4 to 30 seconds in one take, $0.473 a second at 720p; a
  // tier names it through the env (`premium=seedance-2.5`) when a workspace should film past 15 s
  'seedance-2.5': {
    key: 'seedance-2.5', label: 'Seedance 2.5', vendor: 'ByteDance', endpoint: 'bytedance/seedance-2.5/text-to-video', perSecondMicros: usd(0.473), resolution: '720p', seconds: { min: 4, max: 30 },
    input: seedance('720p'),
    reference: { endpoint: 'bytedance/seedance-2.5/reference-to-video', input: seedanceRef('720p') },
  },
  'kling-3.0': {
    key: 'kling-3.0', label: 'Kling 3.0', vendor: 'Kuaishou', endpoint: 'fal-ai/kling-video/v3/standard/text-to-video', perSecondMicros: usd(0.126), resolution: '1080p', seconds: { min: 3, max: 15 },
    input: (prompt, seconds) => ({ prompt, duration: String(seconds), aspect_ratio: '9:16', generate_audio: true }),
  },
  'kling-3.0-pro': {
    key: 'kling-3.0-pro', label: 'Kling 3.0 Pro', vendor: 'Kuaishou', endpoint: 'fal-ai/kling-video/v3/pro/text-to-video', perSecondMicros: usd(0.168), resolution: '1080p', seconds: { min: 3, max: 15 },
    input: (prompt, seconds) => ({ prompt, duration: String(seconds), aspect_ratio: '9:16', generate_audio: true }),
  },
  'minimax-h3': {
    key: 'minimax-h3', label: 'MiniMax H3', vendor: 'MiniMax', endpoint: 'minimax/h3/text-to-video', perSecondMicros: usd(0.06), resolution: '768P', seconds: { min: 5, max: 15 },
    input: (prompt, seconds) => ({ prompt, duration: seconds, resolution: '768P', aspect_ratio: '9:16' }),
  },
  'minimax-h3-max': {
    key: 'minimax-h3-max', label: 'MiniMax H3 Max', vendor: 'MiniMax', endpoint: 'minimax/h3-max/text-to-video', perSecondMicros: usd(0.04), resolution: '768P', seconds: { min: 5, max: 15 },
    input: (prompt, seconds) => ({ prompt, duration: seconds, resolution: '768P', aspect_ratio: '9:16' }),
  },
};

export const DEFAULT_TIERS = 'starter=seedance-2.0-fast,xpress=minimax-h3,premium=seedance-2.0';
export const FILM_SECONDS = 8;

/** what one clip costs, at cost, in whole credits (the shared formula, so the card prices a length the way the door does) */
export const filmCredits = (model: VideoModel, seconds: number): number => creditsFor(model.perSecondMicros, seconds);
export const priceFilm = (model: VideoModel, seconds: number): number => filmCredits(model, seconds) * CREDIT_MICROS;
/** the length the lane films: the ask held inside the model's range, whole seconds */
export const clampSeconds = (model: VideoModel, seconds: number | null | undefined): number => Math.min(model.seconds.max, Math.max(model.seconds.min, Math.round(seconds || FILM_SECONDS)));

export interface VideoTierSpec { tier: VideoTier; label: string; model: VideoModel; seconds: number; credits: number; lengths: number[] }

/** the tiers this server serves, from the env variable (a tier naming an unknown key is dropped
 *  and said in the log, never served). Empty when FAL_KEY is unset: the lane is not here.
 *  `seconds` is the default length, `lengths` the ones a card offers inside the model's range. */
export function videoTiers(env: NodeJS.ProcessEnv = process.env): VideoTierSpec[] {
  if (!env['FAL_KEY']) return [];
  const asked = Number(env['NM_VIDEO_SECONDS'] ?? FILM_SECONDS) || FILM_SECONDS;
  const out: VideoTierSpec[] = [];
  for (const pair of (env['NM_VIDEO_TIERS'] ?? DEFAULT_TIERS).split(',')) {
    const [tier, key] = pair.split('=').map((s) => s.trim());
    if (!isVideoTier(tier) || !key) continue;
    const model = VIDEO_MODELS[key];
    if (!model) { console.warn(`video_tier ${tier}: unknown model ${key}, not served`); continue; }
    if (out.some((t) => t.tier === tier)) continue;
    const seconds = clampSeconds(model, asked);
    out.push({ tier, label: VIDEO_TIER_LABELS[tier], model, seconds, credits: filmCredits(model, seconds), lengths: filmLengthsWithin(model.seconds.min, model.seconds.max) });
  }
  // the person's order, not the env's
  return VIDEO_TIERS.flatMap((t) => out.filter((x) => x.tier === t));
}

/** the tier a workspace films on: its pick when the server serves it, else the default (the first served) */
export function tierFor(tiers: VideoTierSpec[], pick: string | null | undefined): VideoTierSpec | null {
  return tiers.find((t) => t.tier === pick) ?? tiers[0] ?? null;
}
