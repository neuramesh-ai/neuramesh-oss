// A RICH EMAIL BODY (docs/design/inbox-sales-2026-11/plan.md I13). The body stays one text: a small Markdown set
// (paragraphs, **bold**, [links](https://...), and lists with "- " or "1. ") with asset blocks in place. An asset
// block is a paragraph of its own:
//
//   ![alt text](file:<artifact id>)   an image, a GIF or a video from the room's Files
//   ![alt text](video:https://...)    a video link (YouTube, Loom, Vimeo or any page): it sends as a poster with a link
//
// A block holds a reference, never bytes: the API reads a file's bytes from Files at Send, so the room's ACL applies.
// These rules are pure, so the card, the agent tools and the MIME build read one body the same way.

/** at most 10 assets and 20 MB in one email, below Gmail's 25 MB, and 5 MB for one image */
export const EMAIL_ASSET_CAP = 10;
export const EMAIL_BYTES_CAP = 20 * 1024 * 1024;
export const EMAIL_IMAGE_MAX = 5 * 1024 * 1024;
/** a GIF plays in every mail app only when it is small: under 2 MB and at most 600 px wide */
export const EMAIL_GIF_MAX = 2 * 1024 * 1024;
export const EMAIL_GIF_WIDTH = 600;

export type EmailAsset = { alt: string } & ({ file: string } | { video: string });
export type EmailBlock = { kind: 'text'; text: string } | { kind: 'asset'; asset: EmailAsset };

const ASSET = /^!\[([^\]\n]*)\]\((?:file:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})|video:(https:\/\/[^\s()]+))\)$/i;

/** an https link a person can open, or null */
export function safeLink(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' && u.hostname.includes('.') ? u.toString() : null;
  } catch { return null; }
}

/** the asset block's text: alt text never breaks the marker */
export function assetMarker(a: EmailAsset): string {
  const alt = a.alt.replace(/[[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
  return 'file' in a ? `![${alt}](file:${a.file})` : `![${alt}](video:${a.video})`;
}

/** the body as blocks: text paragraphs (a list stays one block) and asset blocks */
export function emailBlocks(body: string): EmailBlock[] {
  const out: EmailBlock[] = [];
  for (const para of body.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const t = para.trim();
    if (!t) continue;
    const m = ASSET.exec(t);
    if (m) out.push({ kind: 'asset', asset: m[2] ? { alt: m[1]!.trim(), file: m[2].toLowerCase() } : { alt: m[1]!.trim(), video: m[3]! } });
    else out.push({ kind: 'text', text: para.replace(/^\n+|\n+$/g, '') });
  }
  return out;
}

export const emailBodyOf = (blocks: readonly EmailBlock[]): string =>
  blocks.map((b) => (b.kind === 'text' ? b.text : assetMarker(b.asset))).join('\n\n');

export const emailAssets = (body: string): EmailAsset[] =>
  emailBlocks(body).flatMap((b) => (b.kind === 'asset' ? [b.asset] : []));

/** the block at `i` one place up (-1) or down (+1) */
export function moveBlock(blocks: readonly EmailBlock[], i: number, dir: -1 | 1): EmailBlock[] {
  const j = i + dir;
  if (i < 0 || j < 0 || i >= blocks.length || j >= blocks.length) return [...blocks];
  const out = [...blocks];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** a new asset after the block at `after`, or before the last text block (the sign-off) when no place is named */
export function insertAsset(blocks: readonly EmailBlock[], asset: EmailAsset, after?: number): EmailBlock[] {
  const out = [...blocks];
  let at = after === undefined ? -1 : Math.min(Math.max(after, -1), out.length - 1);
  if (after === undefined) {
    const lastText = out.map((b) => b.kind).lastIndexOf('text');
    at = lastText > 0 ? lastText - 1 : out.length - 1;
  }
  out.splice(at + 1, 0, { kind: 'asset', asset });
  return out;
}

/** why a body cannot be a draft: too many assets, or an image with no alt text. null when it can */
export function bodyRefusal(body: string): string | null {
  const assets = emailAssets(body);
  if (assets.length > EMAIL_ASSET_CAP) return `An email holds at most ${EMAIL_ASSET_CAP} images, GIFs and videos.`;
  if (assets.some((a) => !a.alt.trim())) return 'Each image, GIF and video needs alt text: the words a person reads when the picture does not show.';
  return null;
}

/** the video page's host, as the card says it: "loom.com/share/field-sync-demo" */
export function videoShown(url: string): string {
  try { const u = new URL(url); return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`; } catch { return url; }
}

/** the oEmbed endpoint of a known video host, or null (any other page sends as a link with no poster) */
export function oembedUrl(video: string): string | null {
  let host = '';
  try { host = new URL(video).hostname.replace(/^www\./, ''); } catch { return null; }
  const q = encodeURIComponent(video);
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') return `https://www.youtube.com/oembed?format=json&url=${q}`;
  if (host === 'vimeo.com' || host === 'player.vimeo.com') return `https://vimeo.com/api/oembed.json?url=${q}`;
  if (host === 'loom.com') return `https://www.loom.com/v1/oembed?url=${q}`;
  return null;
}

// ── the two parts of the message ─────────────────────────────────────────────────────────────
const LINK = /\[([^\]\n]+)\]\((https:\/\/[^\s()]+|mailto:[^\s()]+)\)/g;
const BOLD = /\*\*([^*\n]+)\*\*/g;

/** the plain part: the same words with no marks, a link as "words (address)", and each asset in words */
export function emailPlainText(body: string, videoLabel = 'Watch the video'): string {
  return emailBlocks(body).map((b) => {
    if (b.kind === 'asset') return 'file' in b.asset ? `[Image: ${b.asset.alt}]` : `${b.asset.alt || videoLabel}: ${b.asset.video}`;
    return b.text.replace(LINK, '$1 ($2)').replace(BOLD, '$1');
  }).join('\n\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** one line of text as HTML: escaped first, then bold and links (only https and mailto) */
function inline(s: string): string {
  return esc(s)
    .replace(/\[([^\]\n]+)\]\((https:\/\/[^\s()]+|mailto:[^\s()]+)\)/g, (_, t: string, u: string) => `<a href="${u}">${t}</a>`)
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
}

/** a text block as HTML: a list when every line starts with "- " or "1. ", else a paragraph with line breaks */
function textHtml(text: string): string {
  const lines = text.split('\n');
  if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
  if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
  return `<p style="margin:0 0 14px">${lines.map(inline).join('<br>')}</p>`;
}

/** how an asset sends: an inline image (a cid part), a poster image with a link, or a link alone */
export type AssetPart = { cid: string } | { video: string; posterCid: string | null; label: string };

/** the HTML part: plain markup that every mail app reads, each asset where the body places it */
export function emailHtml(body: string, parts: ReadonlyArray<AssetPart | null>): string {
  let n = 0;
  const html = emailBlocks(body).map((b) => {
    if (b.kind === 'text') return textHtml(b.text);
    const p = parts[n++];
    const alt = esc(b.asset.alt);
    if (!p) return '';
    if ('cid' in p) return `<p style="margin:0 0 14px"><img src="cid:${p.cid}" alt="${alt}" style="max-width:100%;height:auto;border:0"></p>`;
    const link = esc(p.video);
    const poster = p.posterCid ? `<a href="${link}"><img src="cid:${p.posterCid}" alt="${alt}" style="max-width:100%;height:auto;border:0"></a><br>` : '';
    return `<p style="margin:0 0 14px">${poster}<a href="${link}">&#9654; ${esc(p.label)}</a></p>`;
  }).join('\n');
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f1f1f">\n${html}\n</body></html>`;
}

/** a body with nothing but plain paragraphs sends as plain text alone, as it did before rich bodies */
export const bodyIsRich = (body: string): boolean =>
  emailAssets(body).length > 0 || new RegExp(LINK.source).test(body) || new RegExp(BOLD.source).test(body) || /^\s*([-*]|\d+[.)])\s+/m.test(body);

/** the width of a GIF from its header (bytes 6 and 7), or null for bytes that are not a GIF */
export function gifWidth(bytes: Uint8Array): number | null {
  if (bytes.length < 10 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'GIF8') return null;
  return bytes[6]! | (bytes[7]! << 8);
}

/** what one email's assets weigh, as the card's foot says it: "3 assets · 3.0 MB of 20 MB" */
export function assetsLine(count: number, bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return `${count} ${count === 1 ? 'asset' : 'assets'} · ${mb} MB of ${EMAIL_BYTES_CAP / (1024 * 1024)} MB`;
}
