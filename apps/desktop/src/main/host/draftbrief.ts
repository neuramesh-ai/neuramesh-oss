// The calendar image round's PURE half (docs/design/calendar-image-gen-2026-08): the prompts
// the one-shot runs on and the parse of what comes back. Import-free on purpose — the tests
// hold this contract without booting a host, and the host module stays wiring.

export type BrandBits = { palette: string[]; fonts: string[]; product?: string };

const brandLine = (b: BrandBits): string => {
  const bits = [
    b.product ? `product: ${b.product}` : '',
    b.palette.length ? `palette: ${b.palette.slice(0, 5).join(', ')}` : '',
    b.fonts.length ? `type: ${b.fonts.slice(0, 2).join(', ')}` : '',
  ].filter(Boolean);
  return bits.length ? `Brand — ${bits.join(' · ')}.` : '';
};

// One line, concrete, drawable. The brief feeds buildImagePrompt, which adds the palette and
// the no-text rule itself — so the brief's job is only the SUBJECT: what the picture is of.
export const BRIEF_SYSTEM =
  'You write one-line image briefs for social posts. Answer with the brief ONLY — no preamble, no quotes, under 220 characters. ' +
  'Name a concrete visual subject, a mood, and a setting that make the post\'s point at a glance. ' +
  'Never ask for words, logos, screenshots, or UI in the image.';

export function briefAsk(body: string, platform: string, brand: BrandBits): string {
  return [`The ${platform} post:`, body.trim(), '', brandLine(brand), 'Write the image brief.'].filter((l) => l !== '').join('\n');
}

// The re-angle: a fresh take on the SAME truth. Strict JSON so the parse below is honest.
export const REWRITE_SYSTEM =
  'You rewrite social posts from a new creative angle without changing what is true about the product. ' +
  'Answer with STRICT JSON only: {"body": string, "brief": string}. ' +
  '"body" is the full replacement post (obey the platform\'s conventions and length; X stays under 270 characters; keep the voice, no hashtags unless the original had them). ' +
  '"brief" is a one-line image brief for the new post — concrete subject, mood, setting; no words, logos, or UI in the image.';

export function rewriteAsk(body: string, platform: string, brand: BrandBits, angle?: string): string {
  return [
    `The current ${platform} post:`,
    body.trim(),
    '',
    brandLine(brand),
    angle?.trim()
      ? `Rewrite it from this angle: ${angle.trim()}`
      : 'Rewrite it from a noticeably different creative angle — same message, new way in.',
  ].filter((l) => l !== '').join('\n');
}

/** Tolerant parse of the rewrite reply: fenced or bare JSON, both strings non-empty — else null. */
export function parseRewrite(raw: string): { body: string; brief: string } | null {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const text = (m?.[1] ?? raw).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(text.slice(start, end + 1)) as { body?: unknown; brief?: unknown };
    const body = typeof j.body === 'string' ? j.body.trim() : '';
    const brief = typeof j.brief === 'string' ? j.brief.trim() : '';
    return body && brief ? { body, brief: brief.slice(0, 400) } : null;
  } catch {
    return null;
  }
}
