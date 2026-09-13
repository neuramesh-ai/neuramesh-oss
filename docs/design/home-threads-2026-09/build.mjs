// Generates the design-canvas artboards for the Home-threads round (2026-09-11): the composer at
// the top of Home and the thread list under it. Recipes are lifted from tokens.css (.histrow, the
// ⌘Y filter chips, .nyrow, .sgroup, .hcomposer + the foot) and the composer-foot round's build.mjs.
// Run: node build.mjs
import { writeFileSync } from 'node:fs';

const THEMES = {
  graphite: { bg: '#141414', panel: '#161616', panel2: '#1a1a1a', panel3: '#262626', border: '#262626', border2: '#3a3a3a', cardBorder: '#2c2c2c',
    text: '#cbcbcb', body: '#a6a6a6', muted: '#848484', dim: '#6a6a6a', link: '#d19a72', brand: '#834a2b', brandInk: '#fff7ee',
    green: '#77ac8d', warn: '#c9a15e', done: '#77ac8d', prog: '#8ba0c0', planrev: '#a89ccf', blocked: '#9ca0a8', todo: '#949494', mkt: '#c98f8f', review: '#a89ccf', violet: '#a89ccf', violetSoft: '#1c1936',
    overlay: '#222222', shadow: 'rgba(0,0,0,0.62)', card: '#1e1e1e', shadowCard: '0 1px 2px rgba(0,0,0,.25)', shadowLift: '0 8px 20px -8px rgba(0,0,0,.55)', shadowPop: '0 20px 55px -14px rgba(0,0,0,.65)',
    hoverBg: 'color-mix(in srgb, #cbcbcb 7%, transparent)', hoverBorder: '#404040', selBg: 'color-mix(in srgb, #cbcbcb 10%, transparent)', btn: '#232323', btnFg: '#efefef', boxbg: '#1a1a1a', ring: '#525252' },
  cream: { bg: '#fbf8f4', panel: '#fbf8f4', panel2: '#f6eee1', panel3: '#efe1cd', border: '#e6dbca', border2: '#d3c2a8', cardBorder: '#eadfce',
    text: '#3a2c22', body: '#5b4c3d', muted: '#8b7861', dim: '#a99680', link: '#9c5730', brand: '#834a2b', brandInk: '#fff7ee',
    green: '#2f9e6b', warn: '#a06a1f', done: '#0f9d63', prog: '#4f80c4', planrev: '#7d56b8', blocked: '#7d7f86', todo: '#7d8590', mkt: '#b04f55', review: '#6d5ce0', violet: '#7d6cc4', violetSoft: '#ece7fc',
    overlay: '#ffffff', shadow: 'rgba(70,42,18,0.16)', card: '#ffffff', shadowCard: '0 1px 2px rgba(70,42,18,.05)', shadowLift: '0 8px 20px -8px rgba(70,42,18,.20)', shadowPop: '0 20px 55px -14px rgba(70,42,18,.30)',
    hoverBg: 'color-mix(in srgb, #3a2c22 5%, transparent)', hoverBorder: 'color-mix(in srgb, #3a2c22 10%, #d3c2a8)', selBg: 'color-mix(in srgb, #834a2b 8%, transparent)', btn: '#f8f2e8', btnFg: '#43301f', boxbg: '#ffffff', ring: 'color-mix(in srgb, #834a2b 42%, #d3c2a8)' },
};
const tokens = (t) => Object.entries({
  '--bg': t.bg, '--panel': t.panel, '--panel2': t.panel2, '--panel3': t.panel3, '--border': t.border, '--border2': t.border2, '--card-border': t.cardBorder,
  '--text': t.text, '--body': t.body, '--muted': t.muted, '--dim': t.dim, '--link': t.link, '--brand': t.brand, '--brand-ink': t.brandInk,
  '--green': t.green, '--warn': t.warn, '--done': t.done, '--prog': t.prog, '--planrev': t.planrev, '--blocked': t.blocked, '--todo': t.todo, '--role-mkt': t.mkt, '--review': t.review, '--violet': t.violet, '--violet-soft': t.violetSoft,
  '--overlay': t.overlay, '--shadow': t.shadow, '--card': t.card, '--shadow-card': t.shadowCard, '--shadow-lift': t.shadowLift, '--shadow-pop': t.shadowPop,
  '--hover-bg': t.hoverBg, '--hover-border': t.hoverBorder, '--sel-bg': t.selBg, '--btn': t.btn, '--btn-fg': t.btnFg, '--boxbg': t.boxbg, '--ring': t.ring,
}).map(([k, v]) => `${k}:${v};`).join('');

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&amp;family=Geist+Mono:wght@500;600&amp;display=swap">';

const CSS = `
  body { margin: 0; }
  a { color: var(--link); } a:hover { color: var(--text); }
  .sheet { --fbody: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; --fmono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;
    position: relative; box-sizing: border-box; background: var(--bg); color: var(--text); font: 13.5px/1.5 var(--fbody); -webkit-font-smoothing: antialiased; overflow: hidden; }
  .sheet *, .sheet *::before, .sheet *::after { box-sizing: border-box; }
  /* the workspace strip's right end: the bell (still there, still counting) and the crew */
  .strip { position: absolute; top: 14px; right: 22px; display: flex; align-items: center; gap: 8px; }
  .bellbtn { position: relative; display: grid; place-items: center; width: 28px; height: 27px; border-radius: 4px; color: var(--muted); }
  .belln { position: absolute; top: -1px; right: -2px; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px; background: var(--link); color: var(--bg); font: 600 9px var(--fmono); display: grid; place-items: center; box-shadow: 0 0 0 2px var(--panel); }
  .crew { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 9px 0 6px; border: 1px solid var(--border2); border-radius: 3px; color: var(--muted); font: 600 11px var(--fmono); }
  .crew .avs { display: inline-flex; } .crew .avs > * { margin-left: -5px; border: 1.5px solid var(--card); border-radius: 3px; } .crew .avs > *:first-child { margin-left: 0; }
  .col { width: 860px; margin: 0 auto; padding-top: 58px; display: flex; flex-direction: column; }
  .stageeyebrow { font: 500 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); margin-bottom: 9px; text-align: center; }
  .stagehead { font-size: 27px; font-weight: 500; letter-spacing: -.02em; line-height: 1.3; text-align: center; text-wrap: balance; margin: 0 0 24px; color: var(--text); }
  .stageprojbtn { font-size: 29px; font-weight: 500; color: var(--link); padding: 0 2px; line-height: 1.1; border-bottom: 2px dotted color-mix(in srgb, var(--link) 45%, transparent); }
  /* ── the composer, the foot round's recipe verbatim ── */
  .hcomposer { position: relative; background: var(--boxbg); border: 1px solid var(--border); border-radius: 6px; padding: 13px 14px 11px; box-shadow: var(--shadow-card); }
  .chint { display: flex; align-items: center; gap: 8px; margin: -13px -14px 10px; padding: 8px 14px; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); background: color-mix(in srgb, var(--panel2) 30%, transparent); border-radius: inherit; border-bottom-left-radius: 0; border-bottom-right-radius: 0; color: var(--muted); font-size: 11.5px; line-height: 1.5; }
  .chintat { font-weight: 600; color: var(--text); border-bottom: 1px solid color-mix(in srgb, var(--text) 28%, transparent); }
  .pav { display: inline-grid; place-items: center; flex: none; overflow: hidden; background: var(--panel3); }
  .pav svg { display: block; width: 100%; height: 100%; }
  .ta { min-height: 40px; font-size: 13.5px; line-height: 1.5; color: var(--dim); }
  .hrow { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
  .hchip { display: inline-flex; align-items: center; gap: 6px; padding: 3.5px 8px; border-radius: 6px; border: 1px solid transparent; color: var(--dim); font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .hchip .h, .hchip .cv { color: var(--dim); } .hchip .cv { font-size: 9px; }
  .cchip { display: inline-flex; align-items: center; gap: 5px; max-width: 190px; padding: 3.5px 8px; border-radius: 3px; border: 1px solid transparent; color: var(--dim); font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .cchip .lbl { overflow: hidden; text-overflow: ellipsis; min-width: 0; } .cchip .car { font-size: 8px; color: var(--dim); flex: none; }
  .cchip > svg { flex: none; opacity: .8; } .cchip .g { display: inline-grid; place-items: center; } .cchip .g svg { display: block; opacity: .85; }
  .brainavs { display: inline-flex; align-items: center; margin-left: 2px; flex: none; } .brainavs > * { margin-left: -5px; border: 1.5px solid var(--card); border-radius: 3px; } .brainavs > *:first-child { margin-left: 0; }
  .attachbtn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 25px; border-radius: 6px; color: var(--dim); border: 1px solid transparent; }
  .attachbtn svg { display: block; }
  .rowsp { flex: 1; }
  .hsend { flex: none; width: 32px; height: 32px; display: grid; place-items: center; border-radius: 3px; background: var(--panel3); color: var(--dim); }
  .hsend svg { display: block; }
  .cfoot { display: flex; align-items: center; gap: 8px; margin: 10px -14px -11px; padding: 8px 14px; min-height: 43px; border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent); background: color-mix(in srgb, var(--panel2) 30%, transparent); border-radius: inherit; border-top-left-radius: 0; border-top-right-radius: 0; }
  .cfootpills { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .cfootpill { height: 26px; padding: 0 9px; border-radius: 3px; border: 1px solid var(--border2); background: none; color: var(--body); font: 500 11.5px var(--fbody); white-space: nowrap; display: inline-flex; align-items: center; }
  .cfootapps { display: flex; align-items: center; gap: 2px; margin-left: auto; flex: none; }
  .cfootapp { position: relative; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 3px; color: var(--dim); }
  .cfootapp svg { display: block; } .cfootapp.on { color: var(--body); }
  .cfootapp .dot { position: absolute; right: 2px; bottom: 2px; width: 5px; height: 5px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--panel2) 30%, var(--card)); }
  /* ── the filter row: the ⌘Y overlay's chips (.histovlfilter), then the scope on the right ── */
  .filt { display: flex; align-items: center; gap: 6px; margin-top: 22px; padding: 0 2px; }
  .fchip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--card-border); background: transparent; border-radius: 3px; padding: 3px 10px; font: 600 11px var(--fbody); color: var(--muted); white-space: nowrap; }
  .fchip.on { background: var(--card); color: var(--text); box-shadow: var(--shadow-card); }
  .fchip b { font: 600 9.5px var(--fmono); color: var(--dim); }
  .fdot { width: 6px; height: 6px; border-radius: 3px; background: var(--dim); } .fdot.ny { background: var(--warn); } .fdot.ip { background: var(--prog); }
  .fsep { width: 1px; height: 16px; background: var(--border); margin: 0 4px; }
  .fsp { flex: 1; }
  .scopelbl { display: inline-flex; align-items: center; gap: 5px; padding: 3.5px 8px; color: var(--muted); font-size: 11.5px; font-weight: 600; white-space: nowrap; } .scopelbl .car { font-size: 8px; color: var(--dim); }
  .search { display: flex; align-items: center; gap: 8px; width: 220px; padding: 5px 9px; border-radius: 6px; background: var(--panel2); color: var(--dim); font-size: 12.5px; }
  .search .kbd { margin-left: auto; font: 600 9.5px var(--fmono); border: 1px solid var(--border2); border-radius: 3px; padding: 1px 5px; color: var(--dim); }
  /* ── the list: day heads + the ⌘Y overlay's row (.histrow) ── */
  .list { display: flex; flex-direction: column; margin-top: 6px; }
  .sgroup { display: flex; align-items: center; gap: 8px; font: 600 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); padding: 16px 12px 5px; }
  .sgroup.ny { color: var(--warn); }
  .sgroup .rule { flex: 1; height: 1px; background: var(--border); }
  .histwrap { position: relative; display: block; }
  .histrow { display: flex; align-items: center; gap: 11px; width: 100%; min-width: 0; text-align: left; padding: 10px 11px; border-radius: 6px; color: var(--text); }
  .histrow.hover { background: var(--hover-bg); }
  .histico { flex: none; width: 30px; height: 30px; border-radius: 4px; display: grid; place-items: center; background: var(--card); border: 1px solid var(--card-border); color: var(--muted); }
  .histdial { display: block; transform: rotate(-90deg); } .histdial .track { stroke: color-mix(in srgb, var(--dim) 30%, transparent); }
  .histbody { flex: 1; min-width: 0; }
  .histtitle { font-size: 13.5px; font-weight: 500; display: flex; gap: 7px; align-items: center; min-width: 0; }
  .histtitle > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .histsnip { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
  .histwhen { flex: none; font-size: 11px; color: var(--dim); display: inline-flex; align-items: center; gap: 8px; }
  .histchan { font: 500 10.5px var(--fmono); letter-spacing: -.02em; }
  .histask { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 26%, transparent); margin-right: 4px; }
  /* the settle seat stays reserved on every row that can settle, so nothing shifts when it appears */
  .histwrap.stl .histwhen { padding-right: 72px; }
  .histsettle { position: absolute; right: 9px; top: 50%; transform: translateY(-50%); border: 1px solid var(--border2); background: var(--card); color: var(--text); font: 600 9.5px var(--fmono); border-radius: 3px; padding: 2px 6px; white-space: nowrap; }
  .chip { display: inline-flex; align-items: center; gap: 5px; font: 500 10px var(--fmono); letter-spacing: -.02em; padding: 3px 7px; border-radius: 3px; text-transform: uppercase; white-space: nowrap; flex: none; }
  .st-ny { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
  .st-ip { background: color-mix(in srgb, var(--prog) 16%, transparent); color: var(--prog); }
  .st-settled { background: var(--panel3); color: var(--muted); border: 1px solid var(--border2); }
  .c-done { background: color-mix(in srgb, var(--done) 16%, transparent); color: var(--done); }
  .c-plan_review { background: color-mix(in srgb, var(--planrev) 16%, transparent); color: var(--planrev); }
  .c-in_progress { background: color-mix(in srgb, var(--prog) 16%, transparent); color: var(--prog); }
  .c-blocked { background: color-mix(in srgb, var(--blocked) 16%, transparent); color: var(--blocked); }
  .c-todo { background: color-mix(in srgb, var(--todo) 16%, transparent); color: var(--todo); }
  .c-setup { background: color-mix(in srgb, var(--role-mkt) 13%, transparent); color: var(--role-mkt); }
  .c-chat, .c-routine { background: var(--panel3); color: var(--muted); border: 1px solid var(--border2); }
  .sallrow { align-self: center; margin: 16px 0 4px; padding: 5px 12px; border-radius: 3px; color: var(--dim); font-size: 12.5px; } .sallrow .k { font: 600 10px var(--fmono); margin-left: 6px; color: var(--dim); }
  /* ── B: the bell's rows as a resident card ── */
  .nycard { margin-top: 22px; background: var(--overlay); border: 1px solid var(--card-border); border-radius: 8px; box-shadow: var(--shadow-card); padding: 0 7px 7px; }
  .bellhd { display: flex; align-items: baseline; gap: 8px; padding: 12px 7px 8px; }
  .bellhd h4 { margin: 0; font-size: 14.5px; font-weight: 500; color: var(--text); }
  .bellhd .n { font: 600 10px var(--fmono); color: var(--dim); }
  .bellhd .esc { margin-left: auto; font: 500 11px var(--fbody); color: var(--muted); }
  .nyrow { display: flex; align-items: center; gap: 9px; padding: 8px; margin-top: 4px; border: 1px solid var(--card-border); background: var(--card); border-radius: 4px; box-shadow: var(--shadow-card); }
  .nykind { flex: none; font: 500 8px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; color: var(--muted); background: var(--panel2); }
  .nykind.s-done { color: var(--done); background: color-mix(in srgb, var(--done) 13%, transparent); }
  .nykind.setup { color: var(--role-mkt); background: color-mix(in srgb, var(--role-mkt) 13%, transparent); }
  .nykind.s-plan_review { color: var(--review); background: color-mix(in srgb, var(--review) 14%, transparent); }
  .nykind.s-blocked { color: var(--blocked); background: color-mix(in srgb, var(--blocked) 15%, transparent); }
  .nytext { flex: 1; min-width: 0; font-size: 12px; color: var(--body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nytext b { color: var(--text); font-weight: 500; } .nytext .nywho { color: var(--muted); }
  .nymeta { flex: none; font: 500 10px var(--fmono); color: var(--dim); } .nygo { flex: none; color: var(--dim); font-size: 11px; }
  .bellsect { display: flex; align-items: center; gap: 8px; padding: 12px 9px 4px; font: 500 9px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); }
  .bellsect .rule { flex: 1; height: 1px; background: var(--border); }
  .frow { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 4px; color: var(--text); }
  .ftitle { font-size: 12.5px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fbeat { font: 500 10.5px var(--fmono); color: var(--dim); margin-left: auto; white-space: nowrap; }
  .fwhen { font-size: 10.5px; color: var(--dim); flex: none; } .fwhen.flive { color: var(--body); font-style: italic; } .fwhen.fanswered { color: var(--done); }
  .hsect { display: flex; align-items: center; gap: 9px; font-size: 16px; font-weight: 500; letter-spacing: -.02em; color: var(--text); margin: 26px 0 6px; padding: 0 2px; }
  .hsect .n { font: 600 10px var(--fmono); color: var(--muted); background: color-mix(in srgb, var(--text) 7%, transparent); border-radius: 3px; padding: 2px 8px; }
  /* ── C: two columns ── */
  .cols { display: flex; gap: 22px; align-items: flex-start; width: 1080px; margin: 0 auto; padding-top: 58px; }
  .cols .main { width: 700px; flex: none; }
  .cols .side { flex: 1; min-width: 0; position: sticky; top: 24px; margin-top: 88px; }
  .cols .nycard { margin-top: 0; }
`;

// ── glyphs (24 grid, currentColor) ──
const G = {
  x: '<path d="M5 4l14 16"/><path d="M19 4l-4.9 5.6"/><path d="M9.9 14.4 5 20"/>',
  linkedin: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M7.6 10.8V16.2"/><circle cx="7.6" cy="7.6" r="1" fill="currentColor" stroke="none"/><path d="M11.4 16.2v-5.4"/><path d="M11.4 13.2a2.6 2.6 0 0 1 5.2 0v3"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r=".9" fill="currentColor" stroke="none"/>',
  tiktok: '<path d="M13.5 4v10.2a3.3 3.3 0 1 1-3.3-3.3"/><path d="M13.5 4c.5 2.5 2.2 4.1 4.8 4.4"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>',
  brain: '<path d="M12 4.5a3 3 0 0 0-3 3.1c-1.8.4-3.1 1.9-3.1 3.8a3.9 3.9 0 0 0 1.5 3.1 3.4 3.4 0 0 0 3.3 4.4c.4 0 .9-.1 1.3-.2.4.1.9.2 1.3.2a3.4 3.4 0 0 0 3.3-4.4 3.9 3.9 0 0 0 1.5-3.1c0-1.9-1.3-3.4-3.1-3.8a3 3 0 0 0-3-3.1z"/><path d="M12 4.5v15"/>',
  send: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  at: '<circle cx="12" cy="12" r="3.6"/><path d="M15.6 8.4v4.9a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.5 7"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  threads: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 2"/>',
  burger: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};
const svg = (k, s, sw = 1.8) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${G[k]}</svg>`;
// the phase dial: a 16px conic arc in the state's hue (the ⌘Y tile's)
const DIAL_AT = { todo: 10, plan_review: 50, in_progress: 62, in_review: 78, done: 86, blocked: 50, accepted: 100, setup: 40 };
const HUE = { todo: 'var(--todo)', plan_review: 'var(--planrev)', in_progress: 'var(--prog)', in_review: 'var(--review)', done: 'var(--done)', blocked: 'var(--blocked)', accepted: 'var(--done)', setup: 'var(--role-mkt)' };
function dial(state) {
  const frac = (DIAL_AT[state] ?? 50) / 100, r = 7, c = 2 * Math.PI * r;
  return `<svg class="histdial" width="16" height="16" viewBox="0 0 18 18" style="color:${HUE[state] ?? 'var(--muted)'}"><circle class="track" cx="9" cy="9" r="${r}" fill="none" stroke-width="2"/><circle cx="9" cy="9" r="${r}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="${(c * frac).toFixed(2)} ${c.toFixed(2)}"/></svg>`;
}

const FACE = { rex: ['#d19a72', '#3a2c22'], iris: ['#cc8fb9', '#3a2c22'], bosun: ['#7cb0bd', '#1a1a1a'], plume: ['#9793d2', '#1a1a1a'] };
const avatar = (name, size, radius) => `<span class="pav" style="width:${size}px;height:${size}px;border-radius:${radius}px"><svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" fill="${FACE[name][0]}"/><circle cx="9" cy="10.5" r="1.4" fill="${FACE[name][1]}"/><circle cx="15" cy="10.5" r="1.4" fill="${FACE[name][1]}"/><path d="M9 15.5c1.6 1.4 4.4 1.4 6 0" fill="none" stroke="${FACE[name][1]}" stroke-width="1.6" stroke-linecap="round"/></svg></span>`;

const strip = `<div class="strip"><span class="bellbtn">${svg('bell', 15)}<span class="belln">4</span></span><span class="crew"><span class="avs">${avatar('rex', 16, 4)}${avatar('iris', 16, 4)}${avatar('bosun', 16, 4)}</span>9</span><span class="bellbtn">${svg('burger', 15)}</span></div>`;

const PILLS = ['Give me ideas', 'What moved while I was away?', 'Plan the next release'];
const APPS = [{ k: 'x', on: false }, { k: 'linkedin', on: true }, { k: 'instagram', on: true }, { k: 'tiktok', on: false }];
const composer = () => `
    <div class="hcomposer">
      <div class="chint">${avatar('rex', 15, 4)}<span>Mention <span class="chintat">@rex</span> or another teammate whenever you want their help.</span></div>
      <div class="ta">Describe the work, or just ask. The orchestrator decides what becomes a task. @ mention · / skill · ⏎ send</div>
      <div class="hrow">
        <span class="hchip"><span class="h">#</span> marketing <span class="cv">⌄</span></span>
        <span class="cchip"><span class="g">${svg('cloud', 13, 2)}</span><span class="lbl">Cloud</span><span class="car">▾</span></span>
        <span class="cchip">${svg('brain', 11, 2)}<span class="lbl">Brain · NeuraMesh Starter</span><span class="brainavs">${avatar('rex', 14, 5)}${avatar('iris', 14, 5)}${avatar('bosun', 14, 5)}</span><span class="car">▾</span></span>
        <span class="attachbtn">${svg('at', 16, 1.7)}</span><span class="attachbtn">${svg('clip', 16, 2)}</span>
        <span class="rowsp"></span><span class="hsend">${svg('send', 20, 2)}</span>
      </div>
      <div class="cfoot">
        <div class="cfootpills">${PILLS.map((p) => `<span class="cfootpill">${p}</span>`).join('')}</div>
        <div class="cfootapps">${APPS.map((a) => `<span class="cfootapp${a.on ? ' on' : ''}">${svg(a.k, 16)}${a.on ? '<span class="dot"></span>' : ''}</span>`).join('')}<span class="cfootapp">${svg('more', 16)}</span></div>
      </div>
    </div>`;

const greeting = `<div class="stageeyebrow">Friday · Sep 11</div><h1 class="stagehead">Good evening, George. What’s next in <span class="stageprojbtn">ai-demos</span>?</h1>`;

// ── the rows: what the harness fixture and the two screenshots show, one derivation ──
const NEEDS = [
  { kind: 'task', state: 'done', num: 1081, title: 'Reply radar, flowe.ai', why: 'Review passed. Say merge to land PR #1081.', room: 'marketing', when: 'Aug 26' },
  { kind: 'task', state: 'done', num: 1065, title: 'Reply radar, @joinflowe on X', why: 'Review passed. Say merge to land PR #1065.', room: 'marketing', when: 'Aug 25' },
  { kind: 'task', state: 'done', num: 1062, title: 'Site and funnel audit, flowe.ai', why: 'Review passed. Say merge to land PR #1062.', room: 'marketing', when: 'Aug 21' },
  { kind: 'task', state: 'setup', num: 1059, title: 'Set up your marketing HQ', why: 'The setup flow waits for you. 3 of 5 steps done.', room: 'marketing', when: 'Aug 15' },
];
const RECENT = {
  Today: [
    { kind: 'routine', status: 'ip', title: 'Routine · Research on AI for mental health', snip: 'rex · reads the board and the last three briefs · 2 of 5', room: 'marketing', when: '4 mins ago' },
    { kind: 'chat', status: 'settled', title: 'Give me ideas', snip: 'Here are four growth ideas for Flowe. They come from our market research and the board.', room: 'marketing', when: '2 hours ago' },
    { kind: 'task', state: 'plan_review', status: 'ip', num: 1090, title: 'Send verification emails from the new domain', snip: 'you replied · rex revises the plan', room: 'marketing', when: '5 hours ago' },
  ],
  Yesterday: [
    { kind: 'task', state: 'in_progress', status: 'ip', num: 1046, title: 'iOS Safari focus-trap release', snip: 'patch · returns focus to the trigger · 2 of 5', room: 'dev', when: 'yesterday' },
    { kind: 'chat', status: 'settled', title: 'Weekly X schedule drafts', snip: 'Five drafts for next week, one image each. Approve the ones you want on the calendar.', room: 'marketing', when: 'yesterday' },
  ],
  'This week': [
    { kind: 'task', state: 'blocked', status: 'ip', num: 1085, title: 'Lead homepage rewrite', snip: 'you replied · 4 days ago · the brand voice doc blocks it', room: 'marketing', when: '4 days ago' },
    { kind: 'chat', status: 'settled', title: 'Token audit for the docs site', snip: 'Every page passes AA on paper and graphite. Two links go on the redirect list.', room: 'dev', when: '6 days ago' },
  ],
};
const stateLabel = { done: 'done', setup: 'setup', plan_review: 'plan review', in_progress: 'build', blocked: 'blocked' };
function row(r, opts = {}) {
  const tile = r.kind === 'task' ? dial(r.state) : r.kind === 'routine' ? svg('clock', 13, 2) : svg('threads', 13, 2);
  const status = r.needs ? 'ny' : r.status;
  const stChip = status === 'ny' ? '<span class="chip st-ny">needs you</span>' : status === 'ip' ? '<span class="chip st-ip">in progress</span>' : '<span class="chip st-settled">settled</span>';
  const stateChip = r.kind === 'task' ? `<span class="chip c-${r.state}">${stateLabel[r.state] ?? r.state}</span>` : '';
  const title = r.kind === 'task' ? `#${r.num} ${r.title}` : r.title;
  return `<div class="histwrap${r.needs ? ' stl' : ''}"><div class="histrow${opts.hover ? ' hover' : ''}">
    <span class="histico">${tile}</span>
    <span class="histbody"><span class="histtitle"><span>${title}</span>${stateChip}${stChip}</span><span class="histsnip">${r.why ?? r.snip}</span></span>
    ${r.needs ? '<span class="histask"></span>' : ''}<span class="histwhen"><span class="histchan">#${r.room}</span>${r.when}</span>
  </div>${opts.settle ? '<span class="histsettle">settle</span>' : ''}</div>`;
}
const group = (label, cls = '') => `<div class="sgroup${cls ? ' ' + cls : ''}">${label}</div>`;

const filters = (active = 'all', needs = true) => `<div class="filt">
  <span class="fchip${active === 'all' ? ' on' : ''}">All <b>186</b></span>
  ${needs ? `<span class="fchip${active === 'ny' ? ' on' : ''}"><span class="fdot ny"></span>needs you <b>4</b></span>` : ''}
  <span class="fchip${active === 'ip' ? ' on' : ''}"><span class="fdot ip"></span>in progress <b>19</b></span>
  <span class="fchip${active === 'settled' ? ' on' : ''}"><span class="fdot"></span>settled <b>163</b></span>
  <span class="fsp"></span>
  <span class="scopelbl">All projects <span class="car">▾</span></span>
  <span class="search">${svg('search', 13, 2)}Search threads<span class="kbd">⌘Y</span></span>
</div>`;

function listA({ filter = 'all', settleOn = null } = {}) {
  const needs = NEEDS.map((r, i) => row({ ...r, needs: true }, { hover: settleOn === i, settle: settleOn === i }));
  if (filter === 'ny') return `<div class="list">${group('Needs you · 4', 'ny')}${needs.join('')}<div class="sallrow">Search every conversation <span class="k">⌘Y</span></div></div>`;
  // George, 2026-09-11: two groups, not the day buckets. RECENT is the newest rows; ⌘Y stays the history.
  const recent = group('Recent') + Object.values(RECENT).flat().map((r) => row(r)).join('');
  return `<div class="list">${group('Needs you · 4', 'ny')}${needs.join('')}${recent}<div class="sallrow">Search every conversation <span class="k">⌘Y</span></div></div>`;
}

// B: the bell's rows, resident
const nyCard = (esc = true, flight = true) => `<div class="nycard">
  <div class="bellhd"><h4>Needs you</h4><span class="n">4</span>${esc ? '<span class="esc">Answer in the thread.</span>' : ''}</div>
  ${NEEDS.map((r) => `<div class="nyrow"><span class="nykind ${r.state === 'setup' ? 'setup' : 's-' + r.state}">${r.state === 'setup' ? 'setup' : 'ready'}</span><span class="nytext"><b>#${r.num}</b> ${r.title}</span><span class="nymeta">#${r.room} · ${r.when}</span><span class="nygo">›</span></div>`).join('')}
  ${flight ? `<div class="bellsect">In flight <span class="rule"></span> 8</div>
  <div class="frow"><span class="chip c-chat">chat</span><span class="ftitle">Routine · Research on AI for mental health</span><span class="fbeat">#marketing</span><span class="fwhen flive">waits for your reply</span></div>
  <div class="frow"><span class="chip c-plan_review">plan review</span><span class="ftitle">#1090 · Send verification emails from the new domain</span><span class="fbeat">#marketing</span><span class="fwhen fanswered">you replied · 4 days ago</span></div>
  <div class="frow"><span class="chip c-blocked">blocked</span><span class="ftitle">#1085 · Lead homepage rewrite</span><span class="fbeat">#marketing</span><span class="fwhen fanswered">you replied · 4 days ago</span></div>` : ''}
</div>`;

function sheetDoc({ theme, w = 1040, h = 1100, body }) {
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
    .sheet { ${tokens(THEMES[theme])} }
    ${CSS}
  </style>
</helmet>
<div class="sheet" style="width: ${w}px; height: ${h}px;">
  ${strip}
  ${body}
</div>
</x-dc>
</body>
</html>
`;
}

const out = {};
// A, the ledger: composer on top, the ⌘Y filters, asks pinned first, then the days
out['Main.dc.html'] = sheetDoc({ theme: 'graphite', body: `<div class="col">${greeting}${composer()}${filters()}${listA()}</div>` });
out['CreamOak.dc.html'] = sheetDoc({ theme: 'cream', body: `<div class="col">${greeting}${composer()}${filters()}${listA()}</div>` });
out['NeedsYouFilter.dc.html'] = sheetDoc({ theme: 'graphite', h: 760, body: `<div class="col">${greeting}${composer()}${filters('ny')}${listA({ filter: 'ny', settleOn: 0 })}</div>` });
// B, the bell's card, then Recent
out['BellCard.dc.html'] = sheetDoc({ theme: 'graphite', h: 1180, body: `<div class="col">${greeting}${composer()}${nyCard()}
  <div class="hsect">Recent <span class="n">186</span><span class="fsp"></span><span class="scopelbl">All projects <span class="car">▾</span></span><span class="search">${svg('search', 13, 2)}Search threads<span class="kbd">⌘Y</span></span></div>
  <div class="list">${Object.values(RECENT).flat().map((r) => row(r)).join('')}<div class="sallrow">Search every conversation <span class="k">⌘Y</span></div></div></div>` });
// C, two columns: the queue is the card, so the column carries no needs-you chip and the card no In flight
out['TwoColumns.dc.html'] = sheetDoc({ theme: 'graphite', w: 1240, h: 1100, body: `<div class="cols"><div class="main">${greeting}${composer()}${filters('all', false)}<div class="list">${Object.values(RECENT).flat().map((r) => row(r)).join('')}<div class="sallrow">Search every conversation <span class="k">⌘Y</span></div></div></div><div class="side">${nyCard(false, false)}</div></div>` });
// D, quiet: no chips, the asks pinned, the days, ⌘Y for everything else
out['Quiet.dc.html'] = sheetDoc({ theme: 'graphite', body: `<div class="col">${greeting}${composer()}${listA().replace('class="list"', 'class="list" style="margin-top:14px"')}</div>` });

for (const [f, html] of Object.entries(out)) writeFileSync(f, html);

const A = (file, x, y, w, h, title) => ({ file, x, y, w, h, title });
const canvas = {
  artboards: [
    A('Main.dc.html', 0, 0, 1040, 1100, 'A · The ledger · graphite'),
    A('CreamOak.dc.html', 1120, 0, 1040, 1100, 'A · The ledger · cream oak'),
    A('NeedsYouFilter.dc.html', 2240, 0, 1040, 760, 'A · needs you filter + hover settle'),
    A('BellCard.dc.html', 0, 1260, 1040, 1180, 'B · The bell’s card, then Recent'),
    A('TwoColumns.dc.html', 1120, 1260, 1240, 1100, 'C · Two columns'),
    A('Quiet.dc.html', 2440, 1260, 1040, 1100, 'D · Quiet'),
  ],
  annotations: [
    { id: 'note-a', x: 0, y: -180, w: 960, text: 'A · THE LEDGER (leading)\nThe composer moves to the top and widens to the reading column (860px, the thread composer’s width). Under it, the ⌘Y overlay’s own filter chips and one list of the same rows: asks pinned first as a NEEDS YOU group, then RECENT (George, 2026-09-11: no day buckets). One row anatomy, one derivation. The bell keeps its count for every other screen.' },
    { id: 'note-a2', x: 2240, y: -150, w: 960, text: 'The needs you chip narrows the list to the queue. Settle reveals on hover, as it does in ⌘Y. The project menu and the search sit at the row’s right end, the scope bar order.' },
    { id: 'note-b', x: 0, y: 1120, w: 960, text: 'B · THE BELL’S CARD\nThe bell popover becomes a resident card under the composer, Recent below it with search and project only. Tradeoff: two row anatomies on one page, which the sessions shell removed on purpose.' },
    { id: 'note-c', x: 1120, y: 1120, w: 960, text: 'C · TWO COLUMNS\nThe queue as a right column card, the way the Workbench sits beside a thread. Spends the wide window. Stacks under 1000px. Tradeoff: two columns on a landing, and the queue rows drawn a second way.' },
    { id: 'note-d', x: 2440, y: 1120, w: 960, text: 'D · QUIET\nNo chips. Asks pinned, then Recent, and ⌘Y for everything else. Least chrome, no status or project narrowing on Home.' },
  ],
  launch: { view: 'canvas' },
};
writeFileSync('canvas.json', JSON.stringify(canvas, null, 2) + '\n');
console.log('wrote', Object.keys(out).length, 'artboards + canvas.json');
