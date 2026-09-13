// On-brand image generation for marketing drafts (marketing-workflow §4.6). Two pure halves:
//
//  1. parseBrandGuidelines — the marketing bootstrap writes `brand-guidelines.md` with a
//     `| Role | Hex |` palette table, a Typography section, Brand Voice, Visual Style and
//     What to Avoid (agents.ts runMarketingBootstrap). That structure is real, it just was
//     never read back out. This reads it.
//  2. buildImagePrompt — turns a marketer's image brief + those tokens into one generation
//     prompt. Pure so the prompt is a tested artifact rather than a string buried in an
//     HTTP call: what we ask a model to draw IS the product surface here.

export type BrandTokens = {
  palette: Array<{ role: string; hex: string }>;
  fonts: string[];
  voice?: string;
  visualStyle?: string;
  avoid?: string;
};

export const EMPTY_BRAND: BrandTokens = { palette: [], fonts: [] };

const HEX_RE = /#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/i;

/** The body of a `## Heading` section, up to the next heading of the same or higher level. */
function section(md: string, ...names: string[]): string {
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{2,4}\s+(.+?)\s*$/.exec(lines[i] ?? '');
    if (!h) continue;
    const title = (h[1] ?? '').toLowerCase();
    if (!names.some((n) => title.includes(n))) continue;
    const out: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,4}\s+/.test(lines[j] ?? '')) break;
      out.push(lines[j] ?? '');
    }
    return out.join('\n').trim();
  }
  return '';
}

/** Collapse a section to one prose line — bullets, table pipes and emphasis stripped. */
function prose(body: string, cap = 320): string | undefined {
  const flat = body
    .split('\n')
    .map((l) => l.replace(/^\s*[-*+]\s+/, '').replace(/^\s*\|/, '').replace(/\|\s*$/, '').trim())
    .filter((l) => l && !/^[-|:\s]+$/.test(l)) // drop table rules
    .join('; ')
    .replace(/[*_`]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return flat ? flat.slice(0, cap) : undefined;
}

/**
 * Read the structured brand tokens back out of a `brand-guidelines.md`. Everything is
 * best-effort: a hand-edited or half-written doc yields whatever it does contain, never a
 * throw, because a missing palette must degrade to "generate without it", not to no image.
 */
/** the bootstrap's four brand docs — the ONE list staging and the Brand-docs rail both read
 *  (tags carry brand-ness going forward; this set keeps every doc generated before tags) */
export const BRAND_DOC_NAMES = ['business-profile.md', 'brand-guidelines.md', 'market-research.md', 'social-strategy.md'];

export function parseBrandGuidelines(md: string): BrandTokens {
  if (!md || typeof md !== 'string') return EMPTY_BRAND;

  // Palette: table rows (`| Background | #0B0B0C | …`) and list rows (`- Background: #0B0B0C`).
  const palette: Array<{ role: string; hex: string }> = [];
  const seen = new Set<string>();
  for (const line of md.split('\n')) {
    if (!HEX_RE.test(line)) continue;
    const cells = line.includes('|')
      ? line.split('|').map((c) => c.trim()).filter(Boolean)
      : (/^\s*[-*+]?\s*([^:]{1,40}):\s*(.+)$/.exec(line) ?? []).slice(1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const hexCell = cells.find((c) => HEX_RE.test(c));
    const roleCell = cells.find((c) => c !== hexCell && !HEX_RE.test(c));
    const hex = hexCell ? (HEX_RE.exec(hexCell)?.[0] ?? '').toLowerCase() : '';
    const role = (roleCell ?? '').replace(/[*_`]/g, '').trim();
    if (!hex || !role || /^role$/i.test(role) || seen.has(hex)) continue;
    seen.add(hex);
    palette.push({ role: role.slice(0, 40), hex });
    if (palette.length >= 8) break;
  }

  // Typography: the named families in that section — backticked, quoted, or a bare stack head.
  const typo = section(md, 'typograph', 'font');
  const fonts: string[] = [];
  for (const m of typo.matchAll(/`([^`\n]{2,40})`|"([^"\n]{2,40})"|'([^'\n]{2,40})'/g)) {
    const name = (m[1] ?? m[2] ?? m[3] ?? '').split(',')[0]?.trim() ?? '';
    if (name && !/^\d/.test(name) && !fonts.includes(name)) fonts.push(name);
    if (fonts.length >= 3) break;
  }

  return {
    palette,
    fonts,
    voice: prose(section(md, 'brand voice', 'voice', 'tone')),
    visualStyle: prose(section(md, 'visual style', 'imagery', 'photography')),
    avoid: prose(section(md, 'what to avoid', 'avoid', "don't")),
  };
}

// Per-network canvas. gpt-image-1 accepts exactly these three sizes; the phrase rides in the
// prompt too so a provider without a size parameter still frames it correctly.
const CANVAS: Record<string, { size: string; shape: string }> = {
  x: { size: '1536x1024', shape: 'wide 3:2 landscape' },
  linkedin: { size: '1536x1024', shape: 'wide 3:2 landscape' },
  email: { size: '1536x1024', shape: 'wide 3:2 landscape' },
  instagram: { size: '1024x1024', shape: 'square 1:1' },
  tiktok: { size: '1024x1536', shape: 'tall 2:3 vertical' },
};

// Generated lettering is usually mangled, and a social image carries its words in the post
// body anyway — so text is off unless the brief actually asks for a headline or wordmark.
const WANTS_TEXT_RE = /\b(headline|wordmark|word mark|type treatment|lettering|text reading|quote card|title card)\b/i;

export type ImageSpec = { prompt: string; size: string };

/**
 * Compose the generation prompt for one drafted post's image brief. The brief is the subject;
 * the brand tokens are the constraints. Returns null when there's no brief to draw.
 */
export function buildImagePrompt(brief: string, tokens: BrandTokens, platform: string, product?: string): ImageSpec | null {
  const subject = (brief ?? '').trim();
  if (!subject) return null;
  const canvas = CANVAS[platform] ?? CANVAS['x']!;
  const t = tokens ?? EMPTY_BRAND;

  const lines = [`Create one ${canvas.shape} social image for a ${platform === 'x' ? 'post on X' : `${platform} post`}.`, '', `Subject: ${subject}`];
  if (t.palette.length) {
    lines.push('', `Brand palette — use these exact colours and no others: ${t.palette.map((p) => `${p.role} ${p.hex}`).join(', ')}.`);
  }
  if (t.visualStyle) lines.push(`Visual style: ${t.visualStyle}`);
  if (t.voice) lines.push(`It should feel: ${t.voice}`);
  if (product) lines.push(`It represents ${product}.`);
  if (t.avoid) lines.push(`Avoid: ${t.avoid}`);

  const wantsText = WANTS_TEXT_RE.test(subject);
  const rules = [
    'a single coherent composition with generous negative space',
    'no borders, frames, device mockups, UI chrome or app screenshots',
    'no logos or watermarks',
    'no stock-photo clichés and no collage of unrelated elements',
  ];
  rules.splice(
    1,
    0,
    wantsText && t.fonts.length
      ? `any lettering set in ${t.fonts[0]} or a close geometric sans, spelled exactly as the subject states`
      : wantsText
        ? 'any lettering spelled exactly as the subject states, in a clean geometric sans'
        : 'no text, letters, words or numbers anywhere in the image',
  );
  lines.push('', `Rules: ${rules.join('; ')}.`);

  return { prompt: lines.join('\n'), size: canvas.size };
}
