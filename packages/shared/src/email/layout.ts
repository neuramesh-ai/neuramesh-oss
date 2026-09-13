// The one email layout + its block helpers. Table-based with inlined styles because that is
// what email clients render, regardless of what generates it, so this is hand-rolled rather
// than pulling in React Email or MJML (control-api's build:vercel externalizes every dep by
// name; a new one means touching the bundle config to wrap what is ~200 lines).
//
// Verified via `pnpm mail:preview` across both themes and 390px/640px widths.
// Copy standard: docs/28-email-voice.md.

export const APP_URL = typeof process !== 'undefined' ? (process.env['NM_APP_URL'] ?? 'https://neuramesh.app') : 'https://neuramesh.app';

/** ONE accent slot per theme. A brand/identity reset changes these two blocks and nothing else. */
const C = {
  paper: '#f4f2ed', surface: '#fbfaf7', surface2: '#f0eee8',
  ink: '#38332d', body: '#585249', muted: '#8a847a', line: '#e7e2da',
  accent: '#38332d', accentInk: '#ffffff', green: '#2f9e6b',
};
const D = {
  paper: '#161513', surface: '#201f1c', surface2: '#272522',
  ink: '#e6e2db', body: '#b7b4ac', muted: '#8f8a82', line: '#2a2825',
  accent: '#e6e2db', accentInk: '#17150f', green: '#77ac8d',
};

const FONT = "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Escape interpolated values. Every template prop is untrusted (a workspace name, an agent
 *  name, a provider's raw error message) and lands inside HTML. */
export const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── block helpers ──────────────────────────────────────────────────────────

export const h1 = (t: string): string =>
  `<h1 class="nm-ink" style="margin:0 0 22px;font-family:${FONT};font-size:28px;line-height:1.2;letter-spacing:-.026em;font-weight:800;color:${C.ink};">${t}</h1>`;

/** Section subheading. Breaks a long email into scannable parts, so a reader who skims still
 *  gets the shape of it. Generous space above, tight below: it belongs to what follows. */
export const h2 = (t: string): string =>
  `<h2 class="nm-ink" style="margin:34px 0 12px;font-family:${FONT};font-size:16.5px;line-height:1.35;letter-spacing:-.012em;font-weight:700;color:${C.ink};">${t}</h2>`;

/** An all-caps label above a block. Quieter than h2, for one-line orientation. */
export const eyebrow = (t: string): string =>
  `<div class="nm-muted" style="margin:30px 0 10px;font-family:${MONO};font-size:11px;font-weight:600;letter-spacing:.11em;text-transform:uppercase;color:${C.muted};">${t}</div>`;

export const p = (t: string, opts: { tight?: boolean } = {}): string =>
  `<p class="nm-body" style="margin:0 0 ${opts.tight ? 12 : 20}px;font-family:${FONT};font-size:15.5px;line-height:1.72;color:${C.body};">${t}</p>`;

export const small = (t: string): string =>
  `<p class="nm-muted" style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:1.65;color:${C.muted};">${t}</p>`;

/** Emphasis inside body copy, classed so dark mode can recolour it. */
export const b = (t: string): string =>
  `<b class="nm-ink" style="color:${C.ink};font-weight:650;">${t}</b>`;

/** Bulletproof button. The VML fallback keeps Outlook's Word engine from dropping the fill. */
export const button = (label: string, href: string): string => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 10px;"><tr><td>
  <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:46px;v-text-anchor:middle;width:250px;" arcsize="24%" stroke="f" fillcolor="${C.accent}"><w:anchorlock/><center style="color:${C.accentInk};font-family:${FONT};font-size:15px;font-weight:700;">${label}</center></v:roundrect><![endif]-->
  <!--[if !mso]><!--><a class="nm-btn" href="${href}" style="display:inline-block;background:${C.accent};color:${C.accentInk};font-family:${FONT};font-size:15px;font-weight:700;letter-spacing:-.005em;text-decoration:none;padding:14px 26px;border-radius:11px;">${label}</a><!--<![endif]-->
</td></tr></table>`;

export const linkline = (t: string, href: string): string =>
  `<p style="margin:6px 0 22px;font-family:${FONT};font-size:13px;line-height:1.5;"><a class="nm-muted" href="${href}" style="color:${C.muted};text-decoration:underline;">${t}</a></p>`;

export const card = (inner: string, pad = '20px 22px'): string => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="nm-card" style="background:${C.surface2};border:1px solid ${C.line};border-radius:12px;margin:8px 0 26px;">
  <tr><td style="padding:${pad};">${inner}</td></tr>
</table>`;

export const kv = (k: string, v: string): string => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
  <td width="108" style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:${C.muted};padding:7px 0;" class="nm-muted">${k}</td>
  <td style="font-family:${FONT};font-size:14.5px;color:${C.ink};font-weight:600;padding:7px 0;" class="nm-ink">${v}</td>
</tr></table>`;

/** A quoted line the reader recognises: a mined lesson, a provider's raw error. */
export const quote = (t: string): string => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="nm-card" style="background:${C.surface2};border:1px solid ${C.line};border-left:3px solid ${C.accent};border-radius:10px;margin:8px 0 26px;">
  <tr><td style="padding:19px 22px;font-family:${MONO};font-size:13.5px;line-height:1.7;color:${C.ink};" class="nm-ink">&ldquo;${t}&rdquo;</td></tr>
</table>`;

/** A mono list of examples/skills: `› item  hint`. */
export const monoList = (rows: Array<[string, string?]>): string => card(
  `<div style="font-family:${MONO};font-size:13px;line-height:2.15;color:${C.body};" class="nm-body">` +
  rows.map(([item, hint]) =>
    `<span class="nm-muted" style="color:${C.muted};">&rsaquo;</span> ${item}` +
    (hint ? ` &nbsp;<span class="nm-muted" style="color:${C.muted};">${hint}</span>` : '')
  ).join('<br>') + `</div>`,
);

/** A three-up stat row with its window named underneath. Callers drop the whole card at zero. */
export const stats = (cells: Array<{ n: number | string; label: string; green?: boolean }>, window: string): string => card(
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
  cells.map((c) =>
    `<td width="${Math.floor(100 / cells.length)}%" style="font-family:${FONT};">` +
    `<div class="${c.green ? 'nm-green' : 'nm-ink'}" style="font-size:26px;font-weight:800;letter-spacing:-.03em;color:${c.green ? C.green : C.ink};">${esc(c.n)}</div>` +
    `<div class="nm-muted" style="font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:${C.muted};margin-top:5px;">${esc(c.label)}</div></td>`
  ).join('') +
  `</tr><tr><td colspan="${cells.length}" style="padding-top:14px;font-family:${FONT};font-size:11.5px;color:${C.muted};" class="nm-muted">${esc(window)}</td></tr></table>`,
  '22px 22px 20px',
);

/** A horizontal rule with its own breathing room. Callers no longer pad around it. */
export const rule = (): string =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0;"><tr><td class="nm-rule" style="border-top:1px solid ${C.line};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table>`;

export const spacer = (h: number): string => `<div style="height:${h}px;"></div>`;

// ── the wrapper ────────────────────────────────────────────────────────────

export interface LayoutInput {
  preheader: string;
  body: string;
  footerWhy: string;
  /** Absolute unsubscribe URL. Present => lifecycle/broadcast; absent => transactional. */
  unsubscribeUrl?: string | null;
}

export function layout({ preheader, body, footerWhy, unsubscribeUrl }: LayoutInput): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  a { text-decoration: none; }
  @media (prefers-color-scheme: dark) {
    .nm-page   { background: ${D.paper} !important; }
    .nm-shell  { background: ${D.surface} !important; border-color: ${D.line} !important; }
    .nm-ink    { color: ${D.ink} !important; }
    .nm-body   { color: ${D.body} !important; }
    .nm-muted  { color: ${D.muted} !important; }
    .nm-card   { background: ${D.surface2} !important; border-color: ${D.line} !important; }
    .nm-rule   { border-color: ${D.line} !important; }
    .nm-btn    { background: ${D.accent} !important; color: ${D.accentInk} !important; }
    .nm-tile   { background: ${D.accent} !important; color: ${D.accentInk} !important; }
    .nm-green  { color: ${D.green} !important; }
  }
  @media only screen and (max-width: 600px) {
    .nm-shell { border-radius: 0 !important; border-left: 0 !important; border-right: 0 !important; }
    .nm-pad   { padding: 30px 24px 26px !important; }
  }
</style>
</head>
<body class="nm-page" style="margin:0;padding:0;background:${C.paper};-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:${C.paper};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="nm-page" style="background:${C.paper};">
<tr><td align="center" style="padding:34px 14px 46px;">

  <!-- Outlook (Word engine) ignores max-width, so it gets a fixed-width wrapper of its own.
       Every other client sizes off max-width. NEVER a fixed px width here: a px width on this
       table feeds the parent's min-content width, which defeats max-width and overflows narrow
       viewports (the whole email renders 560px wide inside a 390px phone). -->
  <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">

    <tr><td style="padding:0 4px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td class="nm-tile" width="22" height="22" align="center" style="background:${C.accent};color:${C.accentInk};border-radius:7px;font-family:${FONT};font-size:12px;font-weight:800;line-height:22px;">N</td>
        <td style="padding-left:9px;font-family:${FONT};font-size:16px;font-weight:800;letter-spacing:-.028em;color:${C.ink};" class="nm-ink">NeuraMesh</td>
      </tr></table>
    </td></tr>

    <tr><td class="nm-shell" style="background:${C.surface};border:1px solid ${C.line};border-radius:16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td class="nm-pad" style="padding:40px 40px 36px;">${body}</td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:24px 8px 0;">
      <p class="nm-muted" style="margin:0 0 9px;font-family:${FONT};font-size:12.2px;line-height:1.65;color:${C.muted};">${footerWhy}</p>
      <p class="nm-muted" style="margin:0;font-family:${FONT};font-size:12.2px;line-height:1.65;color:${C.muted};">
        NeuraMesh${unsubscribeUrl ? ` · <a href="${unsubscribeUrl}" style="color:${C.muted};text-decoration:underline;">Unsubscribe</a>` : ''}
        · <a href="${APP_URL}/privacy" style="color:${C.muted};text-decoration:underline;">Privacy</a>
      </p>
    </td></tr>

  </table>
  <!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
}

/** Plain-text alternative, derived from the HTML so it can never drift out of sync.
 *  Multipart matters for deliverability: HTML-only mail scores worse with spam filters. */
export function toText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => `${String(label).replace(/<[^>]+>/g, '').trim()} <${href}>`)
    .replace(/<(br|\/p|\/h1|\/tr|\/div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&zwnj;/g, ' ')
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&rsaquo;/g, '>').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
