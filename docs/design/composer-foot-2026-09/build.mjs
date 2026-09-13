// Generates the design-canvas artboards for the composer-foot round (2026-09-10).
// Every value below is lifted from apps/desktop/src/renderer/src/tokens.css and the composer
// components (NewChatStage, BrainChip, MachineChip, attach.tsx, parts.tsx). Run: node build.mjs
import { writeFileSync, existsSync } from 'node:fs';

// ── themes: the tokens the stage uses, verbatim from tokens.css ──────────────────────────────
const THEMES = {
  graphite: { bg: '#141414', panel: '#161616', panel2: '#1a1a1a', panel3: '#262626', border: '#262626', border2: '#3a3a3a',
    text: '#cbcbcb', body: '#a6a6a6', muted: '#848484', dim: '#6a6a6a', link: '#d19a72', brand: '#834a2b', brandInk: '#fff7ee',
    green: '#77ac8d', warn: '#c9a15e', done: '#77ac8d', overlay: '#222222', shadow: 'rgba(0,0,0,0.62)', card: '#1e1e1e',
    shadowCard: '0 1px 2px rgba(0,0,0,.25)', hoverBg: 'color-mix(in srgb, #cbcbcb 7%, transparent)', hoverBorder: '#404040',
    selBg: 'color-mix(in srgb, #cbcbcb 10%, transparent)', btn: '#232323', btnFg: '#efefef', boxbg: '#1a1a1a' },
  paper: { bg: '#f5f4f2', panel: '#f5f4f2', panel2: '#efedea', panel3: '#e6e3df', border: '#dedbd6', border2: '#b9b4ae',
    text: '#0c0b0a', body: '#57534e', muted: '#6b665f', dim: '#8a857e', link: '#8f4f2a', brand: '#834a2b', brandInk: '#fff7ee',
    green: '#2f9e6b', warn: '#a9762a', done: '#2f9e6b', overlay: '#ffffff', shadow: 'rgba(70,58,44,0.14)', card: '#ffffff',
    shadowCard: '0 1px 2px rgba(70,58,44,.05)', hoverBg: 'color-mix(in srgb, #0c0b0a 6%, transparent)', hoverBorder: 'color-mix(in srgb, #0c0b0a 12%, #b9b4ae)',
    selBg: 'color-mix(in srgb, #0c0b0a 8%, transparent)', btn: '#ffffff', btnFg: '#0c0b0a', boxbg: '#ffffff' },
  cream: { bg: '#fbf8f4', panel: '#fbf8f4', panel2: '#f6eee1', panel3: '#efe1cd', border: '#e6dbca', border2: '#d3c2a8',
    text: '#3a2c22', body: '#5b4c3d', muted: '#8b7861', dim: '#a99680', link: '#9c5730', brand: '#834a2b', brandInk: '#fff7ee',
    green: '#2f9e6b', warn: '#a06a1f', done: '#0f9d63', overlay: '#ffffff', shadow: 'rgba(70,42,18,0.16)', card: '#ffffff',
    shadowCard: '0 1px 2px rgba(70,42,18,.05)', hoverBg: 'color-mix(in srgb, #3a2c22 5%, transparent)', hoverBorder: 'color-mix(in srgb, #3a2c22 10%, #d3c2a8)',
    selBg: 'color-mix(in srgb, #834a2b 8%, transparent)', btn: '#f8f2e8', btnFg: '#43301f', boxbg: '#ffffff' },
};
const tokens = (t) => `--bg:${t.bg};--panel:${t.panel};--panel2:${t.panel2};--panel3:${t.panel3};--border:${t.border};--border2:${t.border2};--text:${t.text};--body:${t.body};--muted:${t.muted};--dim:${t.dim};--link:${t.link};--brand:${t.brand};--brand-ink:${t.brandInk};--green:${t.green};--warn:${t.warn};--done:${t.done};--overlay:${t.overlay};--shadow:${t.shadow};--card:${t.card};--shadow-card:${t.shadowCard};--hover-bg:${t.hoverBg};--hover-border:${t.hoverBorder};--sel-bg:${t.selBg};--btn:${t.btn};--btn-fg:${t.btnFg};--boxbg:${t.boxbg};`;

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&amp;family=Geist+Mono:wght@500;600&amp;display=swap">';

// ── the app's recipes (selectors kept so a reviewer can find them in tokens.css) ─────────────
const CSS = `
  body { margin: 0; }
  a { color: var(--link); } a:hover { color: var(--text); }
  .stage { --fbody: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; --fmono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;
    position: relative; box-sizing: border-box; background: var(--bg); color: var(--text); font: 13.5px/1.5 var(--fbody); -webkit-font-smoothing: antialiased;
    display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 22px 34px; overflow: hidden; }
  .stage *, .stage *::before, .stage *::after { box-sizing: border-box; }
  .stagecol { width: 640px; display: flex; flex-direction: column; position: relative; }
  .stageeyebrow { font: 500 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); margin-bottom: 9px; }
  .stagehead { font-family: var(--fbody); font-size: 27px; font-weight: 500; letter-spacing: -.02em; line-height: 1.3; text-align: center; text-wrap: balance; margin: 0 0 24px; color: var(--text); }
  .stageprojbtn { font-size: 29px; font-weight: 500; color: var(--link); padding: 0 2px; line-height: 1.1; border-bottom: 2px dotted color-mix(in srgb, var(--link) 45%, transparent); }
  /* .hcomposer.cbox: the Home box, dark themes on --panel2, light on --card */
  .hcomposer { position: relative; background: var(--boxbg); border: 1px solid var(--border); border-radius: 6px; padding: 13px 14px 11px; box-shadow: var(--shadow-card); }
  .hcomposer.focus { border-color: var(--border2); }
  .chint { display: flex; align-items: center; gap: 8px; margin: -13px -14px 10px; padding: 8px 14px; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); background: color-mix(in srgb, var(--panel2) 30%, transparent); border-radius: inherit; border-bottom-left-radius: 0; border-bottom-right-radius: 0; color: var(--muted); font-size: 11.5px; line-height: 1.5; }
  .chintat { font-weight: 600; color: var(--text); border-bottom: 1px solid color-mix(in srgb, var(--text) 28%, transparent); }
  .pav { display: inline-grid; place-items: center; flex: none; overflow: hidden; background: var(--panel3); }
  .pav svg, .pav img { display: block; width: 100%; height: 100%; }
  .ta { min-height: 40px; font-size: 13.5px; line-height: 1.5; color: var(--dim); }
  .ta.draft { color: var(--text); }
  .caret { display: inline-block; width: 1.5px; height: 15px; background: var(--text); vertical-align: -3px; margin-left: 1px; }
  .hrow { display: flex; align-items: center; gap: 6px; margin-top: 8px; position: relative; }
  .hchip { display: inline-flex; align-items: center; gap: 6px; padding: 3.5px 8px; border-radius: 6px; border: 1px solid transparent; color: var(--dim); font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .hchip .h { color: var(--dim); font-weight: 600; } .hchip .cv { color: var(--dim); font-size: 9px; }
  .cchip { display: inline-flex; align-items: center; gap: 5px; max-width: 190px; padding: 3.5px 8px; border-radius: 3px; border: 1px solid transparent; color: var(--dim); font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .cchip .lbl { overflow: hidden; text-overflow: ellipsis; min-width: 0; } .cchip .car { font-size: 8px; color: var(--dim); flex: none; }
  .cchip > svg { flex: none; opacity: .8; } .cchip .g { display: inline-grid; place-items: center; } .cchip .g svg { display: block; opacity: .85; }
  .brainavs { display: inline-flex; align-items: center; margin-left: 2px; flex: none; } .brainavs > * { margin-left: -5px; border: 1.5px solid var(--card); border-radius: 3px; } .brainavs > *:first-child { margin-left: 0; }
  .attachbtn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 25px; border-radius: 6px; color: var(--dim); border: 1px solid transparent; }
  .attachbtn svg { display: block; }
  .rowsp { flex: 1; }
  .hsend { flex: none; width: 32px; height: 32px; display: grid; place-items: center; border-radius: 3px; background: var(--panel3); color: var(--dim); border: 1px solid transparent; }
  .hsend.on { background: var(--brand); color: var(--brand-ink); }
  .hsend svg { display: block; }
  /* ── NEW: the foot. The cap's material, mirrored at the bottom of the same card ── */
  .cfoot { display: flex; align-items: center; gap: 8px; margin: 10px -14px -11px; padding: 8px 14px; min-height: 43px; border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent); background: color-mix(in srgb, var(--panel2) 30%, transparent); border-radius: inherit; border-top-left-radius: 0; border-top-right-radius: 0; }
  .cfootpills { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .cfootpill { height: 26px; padding: 0 9px; border-radius: 3px; border: 1px solid var(--border2); background: none; color: var(--body); font: 500 11.5px var(--fbody); white-space: nowrap; display: inline-flex; align-items: center; gap: 7px; }
  .cfootpill.idea { padding-left: 5px; }
  .cfootapps { position: relative; display: flex; align-items: center; gap: 2px; margin-left: auto; flex: none; }
  .cfootapp { position: relative; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 3px; color: var(--dim); }
  .cfootapp svg { display: block; }
  .cfootapp.on { color: var(--body); }
  .cfootapp.hover { background: var(--hover-bg); color: var(--text); }
  .cfootapp.open { background: var(--sel-bg); color: var(--text); }
  .cfootapp .dot { position: absolute; right: 2px; bottom: 2px; width: 5px; height: 5px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 1.5px var(--boxbg); }
  .cfoot .cfootapp .dot { box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--panel2) 30%, var(--boxbg)); }
  .ctray .cfootapp .dot { box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--panel3) 55%, var(--boxbg)); }
  .cfootapp .dot.warn { background: var(--warn); }
  /* the [data-tip] label, drawn open, flipped above like every composer tip */
  .tip { position: absolute; bottom: calc(100% + 7px); left: 50%; transform: translateX(-50%); background: var(--overlay); color: var(--text); border: 1px solid var(--border2); border-radius: 6px; padding: 5px 10px; font: 500 11px/1.45 var(--fbody); letter-spacing: .004em; white-space: nowrap; box-shadow: 0 10px 28px -10px var(--shadow); z-index: 80; }
  /* the composer's own popover recipe (.cprojpop.cmachpop), hung from the cluster's right edge */
  .pop { position: absolute; bottom: calc(100% + 8px); right: 0; width: 292px; background: var(--overlay); border: 1px solid var(--border2); border-radius: 8px; padding: 7px; box-shadow: 0 18px 44px -14px var(--shadow); z-index: 421; text-align: left; }
  .pophead { display: flex; align-items: center; gap: 8px; padding: 7px 9px 4px; font-size: 12.5px; font-weight: 600; color: var(--text); }
  .pophead svg { display: block; color: var(--body); }
  .cprojtag { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: -.02em; color: var(--dim); border: 1px solid var(--border2); border-radius: 3px; padding: 0 4px; flex: none; font-family: var(--fmono); }
  .cprojtag.on { color: var(--done); border-color: color-mix(in srgb, var(--done) 40%, transparent); }
  .pop p { margin: 0; padding: 2px 9px; font-size: 11px; color: var(--body); line-height: 1.5; }
  .popact { display: flex; align-items: center; gap: 6px; padding: 7px 9px 4px; }
  .btn { display: inline-flex; align-items: center; gap: 7px; padding: 5px 12px; border-radius: 3px; border: 1px solid var(--border2); background: var(--btn); color: var(--btn-fg); font-family: var(--fmono); font-size: 11.5px; font-weight: 500; letter-spacing: -.02em; text-transform: uppercase; position: relative; white-space: nowrap; }
  .btn.primary { background: var(--brand); color: var(--brand-ink); border-color: transparent; }
  .btn.primary::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: repeating-linear-gradient(135deg, rgba(255,255,255,.16) 0 1px, transparent 1px 7px); background-size: 9.9px 9.9px; pointer-events: none; }
  .btn.primary > * { position: relative; }
  .btn.ghost { background: transparent; color: var(--muted); border-color: var(--border); }
  .popkick { font: 500 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); padding: 6px 9px 3px; }
  .cprojlist { display: flex; flex-direction: column; gap: 3px; }
  .cprojitem { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 9px; border-radius: 6px; font-size: 12.5px; color: var(--text); text-align: left; }
  .cprojitem.hover { background: var(--hover-bg); }
  .cprojglyph { width: 16px; display: inline-grid; place-items: center; color: var(--body); flex: none; } .cprojglyph svg { display: block; opacity: .85; }
  .cmachsub { font: 500 10px var(--fmono); color: var(--dim); letter-spacing: -.02em; }
  .cmachst { flex: none; margin-left: auto; width: 14px; text-align: center; font-size: 10px; line-height: 1; color: var(--dim); }
  .cmachst.on { color: var(--done); } .cmachst.warn { color: var(--warn); }
  .cmachfoot { padding: 6px 9px 4px; font-size: 10.5px; color: var(--dim); line-height: 1.4; }
  /* ── B: the tray hung under the card ── */
  .hcomposer.trayed { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .ctray { display: flex; align-items: center; gap: 8px; padding: 8px 14px; min-height: 43px; border: 1px solid var(--border); border-top: 0; border-radius: 0 0 6px 6px; background: color-mix(in srgb, var(--panel3) 55%, var(--boxbg)); }
  /* ── C: the live read ── */
  .ideathinking { display: inline-flex; align-items: center; gap: 7px; color: var(--dim); font-size: 11.5px; font-style: italic; padding-left: 2px; }
  .ideadots { display: inline-flex; gap: 3px; } .ideadots i { width: 4px; height: 4px; border-radius: 50%; background: var(--dim); animation: nm-dot 1.05s cubic-bezier(.22,1,.36,1) infinite; }
  .ideadots i:nth-child(2) { animation-delay: .15s; } .ideadots i:nth-child(3) { animation-delay: .3s; }
  @keyframes nm-dot { 0%, 60%, 100% { opacity: .25; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-2px); } }
  @media (prefers-reduced-motion: reduce) { .ideadots i { animation: none; opacity: .6; } }
  /* ── the marks sheet ── */
  .sheet { display: flex; flex-direction: column; gap: 4px; width: 100%; }
  .sheethd, .sheetrow { display: grid; grid-template-columns: 150px 72px 72px 72px 1fr; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; }
  .sheethd { font: 500 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); }
  .sheetrow { background: var(--boxbg); border: 1px solid var(--border); }
  .sheetrow b { font-size: 12.5px; font-weight: 600; color: var(--text); }
  .sheetrow .cmachsub { white-space: nowrap; }
  .cell { display: inline-grid; place-items: center; }
`;

// ── glyphs: simplified geometry in one stroke weight, currentColor (the provider-marks precedent) ──
const G = {
  x: '<path d="M5 4l14 16"/><path d="M19 4l-4.9 5.6"/><path d="M9.9 14.4 5 20"/>',
  linkedin: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M7.6 10.8V16.2"/><circle cx="7.6" cy="7.6" r="1" fill="currentColor" stroke="none"/><path d="M11.4 16.2v-5.4"/><path d="M11.4 13.2a2.6 2.6 0 0 1 5.2 0v3"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r=".9" fill="currentColor" stroke="none"/>',
  tiktok: '<path d="M13.5 4v10.2a3.3 3.3 0 1 1-3.3-3.3"/><path d="M13.5 4c.5 2.5 2.2 4.1 4.8 4.4"/>',
  posthog: '<path d="M4 18.5h16"/><path d="M6 14.5l4-4.5 3 3 5-6.5"/>',
  meta: '<path d="M12 12c-1.6-3.3-3.1-5.5-5-5.5S3.5 9 3.5 12s1.6 5.5 3.5 5.5 3.4-2.2 5-5.5 3.1-5.5 5-5.5 3.5 2.5 3.5 5.5-1.6 5.5-3.5 5.5-3.4-2.2-5-5.5z"/>',
  tiktokads: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M13.2 7.5v6.3a2.3 2.3 0 1 1-2.3-2.3"/><path d="M13.2 7.5c.3 1.6 1.4 2.6 3 2.8"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.6"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>',
  brain: '<path d="M12 4.5a3 3 0 0 0-3 3.1c-1.8.4-3.1 1.9-3.1 3.8a3.9 3.9 0 0 0 1.5 3.1 3.4 3.4 0 0 0 3.3 4.4c.4 0 .9-.1 1.3-.2.4.1.9.2 1.3.2a3.4 3.4 0 0 0 3.3-4.4 3.9 3.9 0 0 0 1.5-3.1c0-1.9-1.3-3.4-3.1-3.8a3 3 0 0 0-3-3.1z"/><path d="M12 4.5v15"/>',
  send: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  at: '<circle cx="12" cy="12" r="3.6"/><path d="M15.6 8.4v4.9a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.5 7"/>',
};
const svg = (k, s, sw = 1.8) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${G[k]}</svg>`;

// agent faces: the DiceBear thumbs tile when a generated file is beside this script, else a quiet placeholder tile
const FACE = { rex: ['#d19a72', '#3a2c22'], iris: ['#cc8fb9', '#3a2c22'], bosun: ['#7cb0bd', '#1a1a1a'] };
function avatar(name, size, radius) {
  const inner = existsSync(`${name}.svg`)
    ? `<img src="${name}.svg" alt="">`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" fill="${FACE[name][0]}"/><circle cx="9" cy="10.5" r="1.4" fill="${FACE[name][1]}"/><circle cx="15" cy="10.5" r="1.4" fill="${FACE[name][1]}"/><path d="M9 15.5c1.6 1.4 4.4 1.4 6 0" fill="none" stroke="${FACE[name][1]}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  return `<span class="pav" style="width:${size}px;height:${size}px;border-radius:${radius}px">${inner}</span>`;
}

const PILLS = ['Give me ideas', 'What moved while I was away?', 'Plan the next release'];
// the four publishing connectors in a FIXED order, then the door to the rest
const APPS = [
  { k: 'x', name: 'X', on: false },
  { k: 'linkedin', name: 'LinkedIn', on: true, handle: '@george-alonge' },
  { k: 'instagram', name: 'Instagram', on: true, handle: '@neuramesh' },
  { k: 'tiktok', name: 'TikTok', on: false },
];
function mark(a, extra = '', tip = '') {
  const cls = `cfootapp${a.on ? ' on' : ''}${extra ? ' ' + extra : ''}`;
  const dot = a.on ? `<span class="dot${a.warn ? ' warn' : ''}"></span>` : '';
  const t = tip ? `<span class="tip">${tip}</span>` : '';
  return `<span class="${cls}">${svg(a.k, 16)}${dot}${t}</span>`;
}
function apps({ hover = null, open = null, tip = null, pop = '' } = {}) {
  const items = APPS.map((a) => mark(a, a.k === hover ? 'hover' : a.k === open ? 'open' : '', a.k === tip?.k ? tip.text : '')).join('');
  const moreCls = hover === 'more' ? 'hover' : open === 'more' ? 'open' : '';
  const more = `<span class="cfootapp${moreCls ? ' ' + moreCls : ''}">${svg('more', 16)}${tip?.k === 'more' ? `<span class="tip">${tip.text}</span>` : ''}</span>`;
  return `<div class="cfootapps">${items}${more}${pop}</div>`;
}
const pills = (list = PILLS) => `<div class="cfootpills">${list.map((p) => `<span class="cfootpill">${p}</span>`).join('')}</div>`;

const PLACEHOLDER = 'Describe the work, or just ask. The orchestrator decides what becomes a task. @ mention · / skill · ⏎ send';

function composer({ draft = null, left = pills(), right = apps(), foot = 'foot', focus = false } = {}) {
  const footHtml = foot === 'tray' ? '' : `<div class="cfoot">${left}${right}</div>`;
  const tray = foot === 'tray' ? `<div class="ctray">${left}${right}</div>` : '';
  return `
    <div class="hcomposer${focus ? ' focus' : ''}${foot === 'tray' ? ' trayed' : ''}">
      <div class="chint">${avatar('rex', 15, 4)}<span>Mention <span class="chintat">@rex</span> or another teammate whenever you want their help.</span></div>
      <div class="ta${draft ? ' draft' : ''}">${draft ? draft + '<span class="caret"></span>' : PLACEHOLDER}</div>
      <div class="hrow">
        <span class="hchip"><span class="h">#</span> marketing <span class="cv">⌄</span></span>
        <span class="cchip"><span class="g">${svg('cloud', 13, 2)}</span><span class="lbl">Cloud</span><span class="car">▾</span></span>
        <span class="cchip">${svg('brain', 11, 2)}<span class="lbl">Brain · NeuraMesh Starter</span><span class="brainavs">${avatar('rex', 14, 5)}${avatar('iris', 14, 5)}${avatar('bosun', 14, 5)}</span><span class="car">▾</span></span>
        <span class="attachbtn">${svg('at', 16, 1.7)}</span>
        <span class="attachbtn">${svg('clip', 16, 2)}</span>
        <span class="rowsp"></span>
        <span class="hsend${draft ? ' on' : ''}">${svg('send', 20, 2)}</span>
      </div>
      ${footHtml}
    </div>${tray}`;
}

function stageDoc({ theme, w = 900, h = 600, body }) {
  const t = THEMES[theme];
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  ${FONTS}
  <style>
    .stage { ${tokens(t)} }
    ${CSS}
  </style>
</helmet>
<div class="stage" style="width: ${w}px; height: ${h}px;">
  ${body}
</div>
</x-dc>
</body>
</html>
`;
}

const greeting = `
    <div class="stageeyebrow">Thursday · Sep 10</div>
    <h1 class="stagehead">Good evening, George. What’s next in <span class="stageprojbtn">ai-demos</span>?</h1>`;
const stageBody = (inner, extraStyle = '') => `<div class="stagecol" style="${extraStyle}">${greeting}${inner}</div>`;

// ── popovers ──
const popConnectX = `<div class="pop">
  <div class="pophead">${svg('x', 16)}X <span class="cprojtag">not connected</span></div>
  <p>Authorize X in the browser. neuramesh seals the token on the server.</p>
  <p>neuramesh publishes a post only after you approve it. Your agents also read X through this connection.</p>
  <div class="popact"><span class="btn primary"><span>Continue in the browser</span></span></div>
</div>`;
const popLinkedIn = `<div class="pop">
  <div class="pophead">${svg('linkedin', 16)}LinkedIn <span class="cprojtag on">connected</span> <span class="cmachsub">@george-alonge</span></div>
  <p>neuramesh publishes to your LinkedIn profile only after you approve a post.</p>
  <div class="popact"><span class="btn ghost"><span>Disconnect</span></span></div>
</div>`;
const LIST = [
  { k: 'x', name: 'X', st: 'off' },
  { k: 'linkedin', name: 'LinkedIn', st: 'on', sub: '@george-alonge' },
  { k: 'instagram', name: 'Instagram', st: 'on', sub: '@neuramesh' },
  { k: 'tiktok', name: 'TikTok', st: 'off' },
  { k: 'posthog', name: 'PostHog', st: 'on' },
  { k: 'meta', name: 'Meta Ads', st: 'off' },
  { k: 'tiktokads', name: 'TikTok Ads', st: 'warn', sub: 'authorize again' },
  { k: 'image', name: 'Image generation', st: 'on', sub: 'openai ····4f2a' },
];
const stIcon = (st) => st === 'on' ? '<span class="cmachst on">●</span>' : st === 'warn' ? '<span class="cmachst warn">●</span>' : '<span class="cmachst">○</span>';
const popAll = `<div class="pop">
  <div class="popkick">Connections</div>
  <div class="cprojlist">${LIST.map((r, i) => `<div class="cprojitem${i === 0 ? ' hover' : ''}"><span class="cprojglyph">${svg(r.k, 13)}</span>${r.name}${r.sub ? ` <span class="cmachsub">${r.sub}</span>` : ''}${stIcon(r.st)}</div>`).join('')}</div>
  <div class="cmachfoot">The whole workspace shares these connections.</div>
</div>`;

// ── the artboards ──
const out = {};
out['Main.dc.html'] = stageDoc({ theme: 'graphite', body: stageBody(composer()) });
out['Paper.dc.html'] = stageDoc({ theme: 'paper', body: stageBody(composer()) });
out['CreamOak.dc.html'] = stageDoc({ theme: 'cream', body: stageBody(composer()) });
out['ConnectX.dc.html'] = stageDoc({ theme: 'graphite', body: stageBody(composer({ right: apps({ open: 'x', pop: popConnectX }) })) });
out['ConnectedLinkedIn.dc.html'] = stageDoc({ theme: 'graphite', body: stageBody(composer({ right: apps({ open: 'linkedin', pop: popLinkedIn }) })) });
out['AllConnections.dc.html'] = stageDoc({ theme: 'graphite', body: stageBody(composer({ right: apps({ open: 'more', pop: popAll }) })) });
out['Hover.dc.html'] = stageDoc({ theme: 'paper', body: stageBody(composer({ right: apps({ hover: 'x', tip: { k: 'x', text: 'Connect X' } }) })) });
out['Typing.dc.html'] = stageDoc({ theme: 'graphite', body: stageBody(composer({ focus: true, draft: 'Draft three LinkedIn posts about the v0.128 release and schedule them for next week.', left: '<div class="cfootpills"></div>' })) });
out['Tray.dc.html'] = stageDoc({ theme: 'graphite', body: stageBody(composer({ foot: 'tray' })) });
const ideaDoor = `<div class="cfootpills"><span class="cfootpill idea">${avatar('rex', 16, 4)}Give me ideas</span></div>`;
const ideaBusy = `<div class="cfootpills"><span class="ideathinking">${avatar('rex', 15, 4)}<span class="ideadots"><i></i><i></i><i></i></span>rex reads the room…</span></div>`;
const ideaDone = pills(['Draft the v0.128 release post for LinkedIn', 'Audit the marketing board for stuck items', 'Plan next week’s posts']);
out['LiveIdeas.dc.html'] = stageDoc({ theme: 'graphite', h: 720, body: `<div class="stagecol" style="gap: 26px; padding-top: 14px;">
  <div><div class="stageeyebrow">1 · at rest: one door, the marks</div>${composer({ left: ideaDoor })}</div>
  <div><div class="stageeyebrow">2 · rex reads the room</div>${composer({ left: ideaBusy })}</div>
  <div><div class="stageeyebrow">3 · room-grounded pills replace the door</div>${composer({ left: ideaDone })}</div>
</div>` });
const SHEET = [
  { k: 'x', name: 'X', tip: 'Connect X · X · @handle' },
  { k: 'linkedin', name: 'LinkedIn', tip: 'Connect LinkedIn · LinkedIn · @handle' },
  { k: 'instagram', name: 'Instagram', tip: 'Connect Instagram · Instagram · @handle' },
  { k: 'tiktok', name: 'TikTok', tip: 'Connect TikTok · TikTok · @handle' },
  { k: 'posthog', name: 'PostHog', tip: 'Connect PostHog · PostHog · connected' },
  { k: 'meta', name: 'Meta Ads', tip: 'Connect Meta Ads · Meta Ads · connected' },
  { k: 'tiktokads', name: 'TikTok Ads', tip: 'Connect TikTok Ads · TikTok Ads · connected' },
  { k: 'image', name: 'Image generation', tip: 'Connect an image model · openai ····4f2a' },
  { k: 'more', name: 'More', tip: '4 more connections' },
];
out['Marks.dc.html'] = stageDoc({ theme: 'graphite', w: 660, h: 560, body: `<div class="sheet">
  <div class="sheethd"><span>Connector</span><span class="cell">not connected</span><span class="cell">connected</span><span class="cell">authorize again</span><span>tooltip · the word lives here</span></div>
  ${SHEET.map((r) => `<div class="sheetrow"><b>${r.name}</b><span class="cell">${mark({ k: r.k, on: false })}</span><span class="cell">${r.k === 'more' ? '' : mark({ k: r.k, on: true })}</span><span class="cell">${r.k === 'more' ? '' : mark({ k: r.k, on: true, warn: true })}</span><span class="cmachsub">${r.tip}</span></div>`).join('')}
  <div class="cmachfoot">16px marks on 24px targets · stroke 1.8 · currentColor · dim, then body ink on connect. The dot is 5px with a 1.5px ring of its ground.</div>
</div>` });

for (const [f, html] of Object.entries(out)) writeFileSync(f, html);

// ── the canvas ──
const A = (file, x, y, w = 900, h = 600, title) => ({ file, x, y, w, h, ...(title ? { title } : {}) });
const canvas = {
  artboards: [
    A('Main.dc.html', 0, 0, 900, 600, 'A · The foot · graphite'),
    A('Paper.dc.html', 980, 0, 900, 600, 'A · The foot · paper'),
    A('CreamOak.dc.html', 1960, 0, 900, 600, 'A · The foot · cream oak'),
    A('ConnectX.dc.html', 0, 760, 900, 600, 'State · not connected → connect'),
    A('ConnectedLinkedIn.dc.html', 980, 760, 900, 600, 'State · connected'),
    A('AllConnections.dc.html', 1960, 760, 900, 600, 'State · ⋯ every connection'),
    A('Hover.dc.html', 0, 1520, 900, 600, 'State · hover tip'),
    A('Typing.dc.html', 980, 1520, 900, 600, 'State · a draft in the box'),
    A('Tray.dc.html', 1960, 1520, 900, 600, 'B · The tray'),
    A('LiveIdeas.dc.html', 0, 2280, 900, 720, 'C · Live ideas'),
    A('Marks.dc.html', 980, 2280, 660, 560, 'The marks'),
  ],
  annotations: [
    { id: 'note-a', x: 0, y: -140, w: 760, text: 'A · THE FOOT (leading)\nA third zone on the composer card: the cap\'s material mirrored at the bottom. Suggestion pills sit left, the connector marks right. One card, one border, one focus ring. Same recipe in graphite, paper and cream oak.' },
    { id: 'note-states', x: 0, y: 620, w: 760, text: 'STATES\nA mark is a door. Not connected: the connect step opens in the composer\'s own popover recipe. Connected: the handle and Disconnect. The ⋯ lists every connector as icon · name · state, the machine-chip row idiom.' },
    { id: 'note-row3', x: 0, y: 1380, w: 760, text: 'HOVER · TYPING · B\nThe tooltip carries the word. With a draft in the box the pills leave, the marks stay and the foot keeps its height.\nB · The tray hangs the strip under the card as its own well. Tradeoff: a second edge, and the focus ring stops at the card.' },
    { id: 'note-c', x: 0, y: 2140, w: 760, text: 'C · LIVE IDEAS (optional, more scope)\nOne door pill. rex reads the room (the launcher\'s ideas call already exists) and room-grounded pills replace it. Tradeoff: a live read takes seconds and needs a brain. The static three stay as the fallback.' },
    { id: 'note-marks', x: 980, y: 2140, w: 760, text: 'THE MARKS\nSimplified geometry in one stroke weight, currentColor, like the provider marks. Not connected = dim. Connected = body ink + green dot. Needs reauth = amber dot. Fixed order, never sorted by state.' },
  ],
  launch: { view: 'canvas' },
};
writeFileSync('canvas.json', JSON.stringify(canvas, null, 2) + '\n');
console.log('wrote', Object.keys(out).length, 'artboards + canvas.json');
