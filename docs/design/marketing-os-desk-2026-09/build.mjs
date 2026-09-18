// Generates the design-canvas artboards for the Marketing OS desk round (2026-09-17, round 3): today's
// page again, the desk, then the playbooks, then the threads underneath as you scroll, with ONE bar under
// the desk that carries the pills at the left and the two section words at the right. The words are
// subheadings: a click scrolls the page to that section and the section's own pills take the left slot,
// the bar sticks while you scroll, and the lit word follows the section under it. Every value is lifted
// from tokens.css (.topbar, .scopebar, .wfsearch, .scopepill .cchip, .mkcard, .gdial, .mkc, .pbrow,
// .pbmeta, .runforpop, .histrow, .histovlfilter, .sgroup, .navgrphd*, .navgrprow, .navhistrow, .navitem,
// .navdest) and docs/33 §7 (the hand-off duration, nm-rise, the exits). Round 1 (the rail's RECENTS ·
// PROJECTS on the threads, B/C/D) is version 1 of the canvas artifact, round 2 (PLAYBOOKS · THREADS as
// two views, the pills stacked under the head) is version 2.
// Run: node build.mjs [canvas-out-dir]   (the *.dc.html boards + canvas.json land beside this file; the
// seeded canvas page lands in canvas-out-dir, default: beside this file too)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS_OUT = process.argv[2] ? resolve(process.argv[2]) : HERE;
mkdirSync(CANVAS_OUT, { recursive: true });

const W = 1440, H = 1000;
const SHEET_W = 1108, SHEET_H = 946;   // the sheet inside the frame: W - 320 (rail) - 12 (margins), H - 44 - 10

const THEMES = {
  graphite: { win: '#0d0d0d', bg: '#141414', panel: '#161616', panel2: '#1a1a1a', panel3: '#262626', border: '#262626', border2: '#3a3a3a', cardBorder: '#2c2c2c', card: '#1e1e1e',
    text: '#cbcbcb', body: '#a6a6a6', muted: '#848484', dim: '#6a6a6a', link: '#d19a72', brand: '#834a2b', brandInk: '#fff7ee', green: '#77ac8d', warn: '#c9a15e', prog: '#8ba0c0', planrev: '#a89ccf', done: '#77ac8d', todo: '#949494', roleMkt: '#c98f8f', blocked: '#9ca0a8', accent: '#cbcbcb',
    overlay: '#222222', shadow: 'rgba(0,0,0,0.62)', hoverBg: 'color-mix(in srgb, #cbcbcb 7%, transparent)', hoverBorder: '#404040', selBg: 'color-mix(in srgb, #cbcbcb 10%, transparent)', ring: '#525252',
    shadowCard: '0 1px 2px rgba(0,0,0,.25)', shadowLift: '0 8px 20px -8px rgba(0,0,0,.55)', shadowPop: '0 20px 55px -14px rgba(0,0,0,.65)', btn: '#232323', btnFg: '#efefef', btnHover: '#2f2f2f', vizScore: '#5b93d8' },
  cream: { win: '#f0e5d3', bg: '#fbf8f4', panel: '#fbf8f4', panel2: '#f6eee1', panel3: '#efe1cd', border: '#e6dbca', border2: '#d3c2a8', cardBorder: '#eadfce', card: '#ffffff',
    text: '#3a2c22', body: '#5b4c3d', muted: '#8b7861', dim: '#a99680', link: '#9c5730', brand: '#834a2b', brandInk: '#fff7ee', green: '#2f9e6b', warn: '#a06a1f', prog: '#4f80c4', planrev: '#7d56b8', done: '#0f9d63', todo: '#7d8590', roleMkt: '#b04f55', blocked: '#7d7f86', accent: '#834a2b',
    overlay: '#ffffff', shadow: 'rgba(70,42,18,0.16)', hoverBg: 'color-mix(in srgb, #3a2c22 5%, transparent)', hoverBorder: 'color-mix(in srgb, #3a2c22 10%, #d3c2a8)', selBg: 'color-mix(in srgb, #834a2b 8%, transparent)', ring: 'color-mix(in srgb, #834a2b 42%, #d3c2a8)',
    shadowCard: '0 1px 2px rgba(70,42,18,.05)', shadowLift: '0 8px 20px -8px rgba(70,42,18,.20)', shadowPop: '0 20px 55px -14px rgba(70,42,18,.30)', btn: '#f8f2e8', btnFg: '#43301f', btnHover: '#efe4d2', vizScore: '#2f6fc2' },
};
const tokens = (t) => Object.entries({ '--win': t.win, '--bg': t.bg, '--panel': t.panel, '--panel2': t.panel2, '--panel3': t.panel3, '--border': t.border, '--border2': t.border2, '--card-border': t.cardBorder, '--card': t.card,
  '--text': t.text, '--body': t.body, '--muted': t.muted, '--dim': t.dim, '--link': t.link, '--brand': t.brand, '--brand-ink': t.brandInk, '--green': t.green, '--warn': t.warn, '--prog': t.prog, '--planrev': t.planrev, '--done': t.done, '--todo': t.todo, '--role-mkt': t.roleMkt, '--blocked': t.blocked, '--accent': t.accent,
  '--overlay': t.overlay, '--shadow': t.shadow, '--hover-bg': t.hoverBg, '--hover-border': t.hoverBorder, '--sel-bg': t.selBg, '--ring': t.ring, '--shadow-card': t.shadowCard, '--shadow-lift': t.shadowLift, '--shadow-pop': t.shadowPop, '--btn': t.btn, '--btn-fg': t.btnFg, '--btn-hover': t.btnHover, '--viz-score': t.vizScore }).map(([k, v]) => `${k}:${v};`).join('');

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;450;500;600&amp;family=Geist+Mono:wght@400;500;600&amp;family=Bricolage+Grotesque:wght@500&amp;display=swap">';

const CSS = `
  body { margin: 0; }
  .frame { --fbody: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; --fmono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace; --fbrand: 'Bricolage Grotesque', var(--fbody);
    position: relative; box-sizing: border-box; width: ${W}px; height: ${H}px; background: var(--win); color: var(--text); font: 14px/1.5 var(--fbody); -webkit-font-smoothing: antialiased; overflow: hidden; display: flex; flex-direction: column; }
  .frame *, .frame *::before, .frame *::after { box-sizing: border-box; }
  .frame svg { display: block; }
  /* ── the frame top: wordmark, the fold pin, the search pill, the ambient utilities ── */
  .ftop { height: 44px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 16px; }
  .ftfold { width: 26px; height: 26px; display: grid; place-items: center; color: var(--dim); }
  .ftbrand { font: 500 15px var(--fbrand); letter-spacing: -.01em; color: var(--text); padding: 4px 6px; }
  .ftsearch { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; height: 30px; width: 280px; padding: 0 14px; border-radius: 3px; background: color-mix(in srgb, var(--text) 5%, transparent); color: var(--dim); font-size: 12.5px; }
  .ftsearch b { margin-left: auto; font: 600 10px var(--fmono); border: 1px solid var(--border2); border-radius: 3px; padding: 1px 5px; color: var(--dim); }
  .ftutils { display: inline-flex; align-items: center; gap: 2px; }
  .ftutil { position: relative; width: 28px; height: 27px; display: grid; place-items: center; color: var(--muted); border-radius: 4px; }
  .ftsync { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 9px; border-radius: 3px; border: 1px solid var(--border2); color: var(--muted); font: 500 10.5px var(--fmono); }
  .ftsync i { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
  .belln { position: absolute; top: -1px; right: -2px; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px; background: var(--link); color: var(--win); font: 600 9px var(--fmono); display: grid; place-items: center; }
  .fbody { flex: 1; min-height: 0; display: flex; }
  /* ── the naked rail, 320px, on the frame ── */
  .nav { width: 320px; flex: none; display: flex; flex-direction: column; padding: 2px 0 0; min-height: 0; }
  .navseg { display: flex; margin: 6px 8px 2px; padding: 3px; background: var(--panel2); border-radius: 3px; }
  .navseg span { flex: 1; text-align: center; font: 500 13px var(--fbody); color: var(--muted); padding: 5px 0; border-radius: 3px; }
  .navseg span.on { background: var(--panel3); color: var(--text); }
  .navnew { display: flex; align-items: center; gap: 4px; padding: 6px 8px 10px; }
  .navnew .row { display: flex; align-items: center; gap: 11px; flex: 1; padding: 7px 9px; border-radius: 6px; color: var(--body); font-size: 14px; font-weight: 500; }
  .navnew .row svg { color: var(--muted); } .navnew .kbd { margin-left: auto; font: 500 10px var(--fmono); color: var(--dim); }
  .navnew .caret { width: 26px; height: 26px; display: grid; place-items: center; color: var(--muted); }
  .navsect { padding: 12px 16px 4px; font: 500 10px var(--fmono); letter-spacing: -.02em; color: var(--muted); text-transform: uppercase; display: flex; align-items: center; gap: 6px; }
  .navsect .chev { color: var(--dim); display: inline-grid; }
  .navdest { padding-top: 2px; }
  .navitem { display: flex; align-items: center; gap: 11px; width: calc(100% - 16px); margin: 0 8px; padding: 6px 9px 6px 14px; border-radius: 6px; color: var(--body); font-size: 14px; font-weight: 500; }
  .navitem > svg { color: var(--muted); flex: none; }
  .navitem .navlabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .navitem.on { background: var(--card); color: var(--text); box-shadow: var(--shadow-card), inset 0 0 0 1px var(--card-border); }
  .navitem.on > svg { color: var(--text); }
  .navitem.navparent { color: var(--muted); }
  .navitembadge { font: 600 10px var(--fmono); color: var(--muted); background: var(--panel3); border-radius: 999px; padding: 1px 7px; }
  .navitem .chev { color: var(--dim); display: inline-grid; }
  .navlist { flex: 1; min-height: 0; overflow: hidden; padding: 0 8px; }
  .navgrphd { display: flex; align-items: center; gap: 7px; padding: 12px 0 4px 4px; min-width: 0; }
  .navprojchev { width: 18px; height: 18px; display: grid; place-items: center; color: var(--dim); }
  .navgrphdlbl { font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--text); }
  .navgrphdlbl.door { color: var(--dim); }
  .navgrphdsep { font: 500 10px var(--fmono); color: var(--dim); opacity: .6; }
  .navgrphdcnt { font: 600 10px var(--fmono); color: var(--dim); opacity: .8; }
  .navscopegrow { flex: 1; }
  .navhistfind { width: 22px; height: 22px; display: grid; place-items: center; color: var(--muted); opacity: .5; }
  .navgrprow { display: flex; align-items: center; gap: 9px; width: 100%; height: 28px; margin: 1px 0; padding: 0 9px 0 10px; border-radius: 6px; color: var(--body); }
  .navgrprow .navhistglyph { color: var(--dim); }
  .navgrpname { flex: 1; min-width: 0; font-size: 13px; font-weight: 400; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .navhisttrail { display: inline-flex; align-items: center; gap: 6px; flex: none; margin-left: auto; }
  .navhistfact { font: 500 10px var(--fmono); color: var(--dim); white-space: nowrap; }
  .navgrpchev { display: inline-grid; color: var(--dim); } .navgrpchev.c { transform: rotate(-90deg); }
  .navhistask { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 26%, transparent); flex: none; }
  .navhistrow { display: flex; align-items: center; gap: 9px; width: 100%; margin: 1px 0; height: 30px; padding: 0 9px 0 32px; border-radius: 6px; color: var(--body); }
  .navhistglyph { flex: none; width: 14px; height: 14px; display: grid; place-items: center; color: var(--dim); }
  .navhistglyph .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .navhisttitle { flex: 1; min-width: 0; font-size: 14px; font-weight: 450; color: var(--body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .navhisttitle b { font: 500 11px var(--fmono); color: var(--dim); margin-right: 5px; }
  .navfoot { display: flex; align-items: center; gap: 8px; padding: 8px; margin-top: auto; }
  .wstile { width: 22px; height: 22px; border-radius: 4px; background: var(--panel3); border: 1px solid var(--border2); display: grid; place-items: center; font: 600 11px var(--fmono); color: var(--body); position: relative; }
  .wstile i { position: absolute; top: -3px; right: -3px; width: 7px; height: 7px; border-radius: 50%; background: var(--warn); border: 1.5px solid var(--win); }
  .wsname { font-size: 13px; font-weight: 600; color: var(--text); flex: 1; }
  .credring { width: 22px; height: 22px; }
  /* ── the sheet ── */
  .sheet { flex: 1; min-width: 0; margin: 2px 8px 8px 4px; background: var(--bg); border-radius: 8px; border: 1px solid color-mix(in srgb, var(--card-border) 70%, transparent); display: flex; flex-direction: column; overflow: hidden; position: relative; }
  .topbar { height: 52px; min-height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 20px; font: 500 17.5px var(--fbody); letter-spacing: -.02em; color: var(--text); flex: none; }
  .topbar .desc { color: var(--dim); font: 500 12px var(--fbody); letter-spacing: 0; border-left: 1px solid var(--border); padding-left: 10px; }
  /* the page scrolls as one document; the boards emulate the scroll with a translate and clip */
  .mkosview { flex: 1; min-height: 0; overflow: hidden; position: relative; padding: 0 18px; }
  .scrollinner { display: flex; flex-direction: column; padding-top: 4px; }
  .scrollinner > * { max-width: 980px; width: 100%; margin-left: auto; margin-right: auto; flex: none; }
  .scopebar { display: flex; align-items: center; gap: 10px; padding: 14px 0 2px; margin-bottom: 8px; }
  .wfsearch { display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 0 16px; background: var(--card); border: 1px solid var(--card-border); border-radius: 8px; color: var(--muted); box-shadow: var(--shadow-card); flex: 1; min-width: 0; font-size: 13.5px; }
  .wfsearch span { color: var(--dim); }
  .cchip { display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 16px; border-radius: 8px; font-size: 13.5px; font-weight: 600; white-space: nowrap; background: var(--card); border: 1px solid var(--card-border); box-shadow: var(--shadow-card); color: var(--body); }
  .cchip.set { color: var(--text); }
  .cchip .car { font-size: 10px; opacity: .7; }
  /* ── the desk: one tile per project, or one line when a project is picked ── */
  .desk { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 4px; }
  .tile { display: flex; flex-direction: column; gap: 5px; padding: 9px 12px 8px; background: var(--card); border: 1px solid var(--card-border); border-radius: 8px; box-shadow: var(--shadow-card); min-width: 0; }
  .tl1 { display: flex; align-items: center; gap: 9px; min-width: 0; height: 24px; }
  .tlogo { width: 22px; height: 22px; border-radius: 6px; background: var(--panel3); display: grid; place-items: center; font: 600 11px var(--fbody); color: var(--body); flex: none; }
  .tname { font-size: 14px; font-weight: 500; color: var(--text); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tscore { display: inline-flex; align-items: center; gap: 7px; font: 500 15px var(--fbody); color: var(--text); }
  .tcta { font: 600 12px var(--fbody); color: var(--link); white-space: nowrap; }
  .tfacts { font: 500 10.5px var(--fmono); color: var(--dim); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tl3 { display: flex; align-items: center; gap: 3px; padding-top: 6px; border-top: 1px solid var(--border); }
  .mark { position: relative; width: 20px; height: 20px; display: grid; place-items: center; color: var(--dim); border-radius: 3px; flex: none; }
  .mark.on { color: var(--body); }
  .mark.on::after, .mark.warn::after { content: ''; position: absolute; right: 1px; bottom: 1px; width: 5px; height: 5px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 1.5px var(--card); }
  .mark.warn::after { background: var(--warn); }
  .mtally { font: 500 10px var(--fmono); color: var(--dim); margin-left: auto; white-space: nowrap; }
  .deskbar { display: flex; align-items: center; gap: 12px; margin-top: 4px; min-height: 46px; padding: 0 12px; background: var(--card); border: 1px solid var(--card-border); border-radius: 8px; box-shadow: var(--shadow-card); }
  .deskbar .tname { flex: none; }
  .deskbar .tfacts { flex: 1; }
  .deskbar .marks { display: inline-flex; align-items: center; gap: 3px; padding-left: 12px; border-left: 1px solid var(--border); }
  .deskbar .mtally { margin-left: 6px; }
  .gdial { position: relative; flex: none; display: inline-block; border-radius: 50%; background: conic-gradient(var(--viz-score) calc(var(--frac, 0) * 1turn), color-mix(in srgb, var(--text) 14%, transparent) 0); }
  .gdial::after { content: ''; position: absolute; inset: 3.5px; border-radius: 50%; background: var(--card); }
  .gdial.s::after { inset: 2.5px; } .gdial.g::after { background: var(--bg); } .gdial.o::after { background: var(--overlay); }
  /* ── THE BAR: the pills at the left, the section words at the right, one line. In flow under the desk,
     stuck to the sheet's top while the page scrolls (a hairline and the resting shadow say so) ── */
  .secbar { display: flex; align-items: center; gap: 12px; padding: 14px 2px 6px; min-height: 56px; }
  .secbar.stuck { position: absolute; top: 0; left: 0; right: 0; z-index: 4; padding: 8px 18px 8px; min-height: 0; background: var(--bg); border-bottom: 1px solid var(--border); box-shadow: var(--shadow-card); }
  .secbar.stuck .secbarin { max-width: 980px; margin: 0 auto; }
  .secbarin { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; }
  .secbarph { height: 56px; }
  .filt { display: flex; align-items: center; gap: 6px; }
  .fchip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--card-border); background: transparent; border-radius: 3px; padding: 3px 10px; font: 600 11px var(--fbody); color: var(--muted); white-space: nowrap; }
  .fchip.on { background: var(--card); color: var(--text); box-shadow: var(--shadow-card); }
  .fchip b { font: 600 9.5px var(--fmono); color: var(--dim); }
  .fdot { width: 6px; height: 6px; border-radius: 3px; background: var(--dim); } .fdot.ny { background: var(--warn); } .fdot.ip { background: var(--prog); }
  .chipx { display: grid; } .chipx > * { grid-area: 1 / 1; }
  .secwords { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; flex: none; }
  .secwords .lbl { display: inline-flex; align-items: center; gap: 5px; font: 500 10.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--text); padding: 4px 2px; }
  .secwords .lbl b { font: 600 10px var(--fmono); color: var(--dim); opacity: .8; }
  .secwords .lbl.door { color: var(--dim); }
  .secwords .lbl.door.hov { color: var(--text); }
  .secwords .lbl.half { color: color-mix(in srgb, var(--text) 50%, var(--dim)); }
  .secwords .sep { font: 500 10px var(--fmono); color: var(--dim); opacity: .6; }
  .cursor { position: absolute; width: 14px; height: 18px; pointer-events: none; }
  /* ── the catalog: today's row plus a glyph, the fact at rest, the verb on hover ── */
  .list { display: flex; flex-direction: column; }
  .pbgroup { font: 500 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); padding: 9px 6px 2px; flex: none; }
  .pbrow { position: relative; display: flex; align-items: center; gap: 11px; width: 100%; padding: 6px 8px; border-radius: 6px; color: var(--text); flex: none; }
  .pbrow.hov { background: var(--hover-bg); }
  .pbrow.off .pbtxt b, .pbrow.off .pg { color: var(--muted); }
  .pbrow .pg { color: var(--muted); display: grid; place-items: center; width: 16px; flex: none; }
  .pbtxt { flex: 1; min-width: 0; }
  .pbtxt b { display: block; font-size: 13.5px; font-weight: 500; color: var(--text); }
  .pbtxt span { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pbmeta { flex: none; display: flex; align-items: center; gap: 7px; }
  .pbscore { display: inline-flex; align-items: center; gap: 5px; font: 500 11px var(--fmono); color: var(--text); }
  .pbwhen { font: 500 10px var(--fmono); color: var(--dim); font-style: normal; }
  .pbproj { font: 500 10px var(--fmono); color: var(--dim); font-style: normal; }
  .pbnever { font: 500 10.5px var(--fmono); color: var(--dim); font-style: italic; }
  .pbarmed { font: 600 9.5px var(--fmono); color: var(--muted); border: 1px solid var(--border2); border-radius: 3px; padding: 2px 7px; }
  .pbrun { font: 600 11.5px var(--fbody); color: var(--btn-fg); background: var(--btn-hover); border: 1px solid var(--border2); border-radius: 3px; padding: 4px 13px; white-space: nowrap; }
  /* ── the threads: the ledger's row ── */
  .sgroup { display: flex; align-items: center; gap: 8px; font: 600 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); padding: 12px 12px 4px; flex: none; }
  .sgroup.first { padding-top: 20px; }
  .sgroup.ny { color: var(--warn); }
  .sgroup .rule { flex: 1; height: 1px; background: var(--border); }
  .hrow { display: flex; align-items: center; gap: 11px; width: 100%; min-width: 0; padding: 8px 11px; border-radius: 6px; color: var(--text); flex: none; }
  .hico { flex: none; width: 30px; height: 30px; border-radius: 4px; display: grid; place-items: center; background: var(--card); border: 1px solid var(--card-border); color: var(--muted); }
  .hico .track { stroke: color-mix(in srgb, var(--dim) 30%, transparent); }
  .hico.c-plan_review { color: var(--planrev); } .hico.c-done { color: var(--done); } .hico.c-todo { color: var(--todo); } .hico.c-setup { color: var(--role-mkt); } .hico.c-in_progress { color: var(--prog); }
  .hbody { flex: 1; min-width: 0; }
  .htitle { font-size: 14px; font-weight: 500; display: flex; gap: 7px; align-items: center; min-width: 0; }
  .htitle > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .htitle b { font: 500 11px var(--fmono); color: var(--dim); margin-right: 5px; }
  .hsnip { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
  .hwhen { flex: none; font-size: 11px; color: var(--dim); display: inline-flex; align-items: center; gap: 8px; }
  .hchan { font: 500 10.5px var(--fmono); letter-spacing: -.02em; }
  .hask { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 26%, transparent); margin-right: 4px; }
  .chip { display: inline-flex; align-items: center; gap: 5px; font: 500 10px var(--fmono); letter-spacing: -.02em; padding: 3px 7px; border-radius: 3px; text-transform: uppercase; white-space: nowrap; flex: none; }
  .st-ny { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
  .st-ip { background: color-mix(in srgb, var(--prog) 16%, transparent); color: var(--prog); }
  .c-done { background: color-mix(in srgb, var(--done) 16%, transparent); color: var(--done); }
  .c-plan_review { background: color-mix(in srgb, var(--planrev) 16%, transparent); color: var(--planrev); }
  .c-in_progress { background: color-mix(in srgb, var(--prog) 16%, transparent); color: var(--prog); }
  .c-todo { background: color-mix(in srgb, var(--todo) 16%, transparent); color: var(--todo); }
  .c-setup { background: color-mix(in srgb, var(--role-mkt) 13%, transparent); color: var(--role-mkt); }
  .c-chat, .c-routine { background: var(--panel3); color: var(--muted); border: 1px solid var(--border2); }
  .sallrow { align-self: center; margin: 12px 0 28px; padding: 5px 12px; border-radius: 3px; color: var(--dim); font-size: 12.5px; flex: none; } .sallrow .k { font: 600 10px var(--fmono); margin-left: 6px; color: var(--dim); }
  /* ── the motion board: three frames of the sheet, then the spec ── */
  .mboard { flex: 1; min-height: 0; padding: 26px 32px 0; display: flex; flex-direction: column; gap: 14px; }
  .mtitle { font: 500 10.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--muted); }
  .mframes { display: flex; gap: 24px; align-items: flex-start; }
  .mini { width: 432px; flex: none; }
  .miniclip { width: 432px; height: 369px; overflow: hidden; border-radius: 6px; border: 1px solid var(--border2); background: var(--bg); }
  .minisheet { width: ${SHEET_W}px; height: ${SHEET_H}px; transform: scale(.39); transform-origin: 0 0; }
  .minisheet .sheet { width: ${SHEET_W}px; height: ${SHEET_H}px; margin: 0; flex: none; border: 0; border-radius: 0; }
  .mcap { margin-top: 10px; font-size: 13px; line-height: 1.45; color: var(--body); }
  .mcap b { display: block; font: 600 10.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--text); margin-bottom: 3px; }
  .mtable { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 13px; }
  .mtable th { text-align: left; font: 600 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); padding: 8px 10px 6px 0; border-bottom: 1px solid var(--border); }
  .mtable td { padding: 7px 14px 7px 0; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); vertical-align: top; color: var(--body); }
  .mtable td:first-child { color: var(--text); font-weight: 500; white-space: nowrap; }
  .mtable code { font: 500 11.5px var(--fmono); color: var(--text); }
`;

const G = {
  compose: '<path d="M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6"/><path d="M18.4 3.6a2 2 0 0 1 2.8 2.8L13 14.6l-3.8.9.9-3.8z"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>', chevr: '<path d="M9 6l6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>',
  threads: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 2"/>',
  circle: '<circle cx="12" cy="12" r="6.5"/>',
  check: '<circle cx="12" cy="12" r="8"/><path d="m8.5 12.3 2.4 2.4 4.6-5"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  folderopen: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M3 19v-8h16.4a1 1 0 0 1 .96 1.28l-1.7 6a1 1 0 0 1-.96.72H5a2 2 0 0 1-2-2z"/>',
  whiteboard: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 14.5 3.2-4.2 2.6 3 3.9-5.3"/>',
  repeat: '<path d="M17 2.5l4 4-4 4"/><path d="M3 11.5v-2a3 3 0 0 1 3-3h15"/><path d="M7 21.5l-4-4 4-4"/><path d="M21 12.5v2a3 3 0 0 1-3 3H3"/>',
  library: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  code: '<path d="M4 17l6-6-6-6"/><path d="M13 19h7"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a13.5 13.5 0 0 1 0 18 13.5 13.5 0 0 1 0-18z"/>',
  term: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 2.5 2.5L7 14"/><path d="M12.5 14H17"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  x: '<path d="M5 4l14 16"/><path d="M19 4l-4.9 5.6"/><path d="M9.9 14.4 5 20"/>',
  linkedin: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M7.6 10.8V16.2"/><circle cx="7.6" cy="7.6" r="1" fill="currentColor" stroke="none"/><path d="M11.4 16.2v-5.4"/><path d="M11.4 13.2a2.6 2.6 0 0 1 5.2 0v3"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r=".9" fill="currentColor" stroke="none"/>',
  tiktok: '<path d="M13.5 4v10.2a3.3 3.3 0 1 1-3.3-3.3"/><path d="M13.5 4c.5 2.5 2.2 4.1 4.8 4.4"/>',
  posthog: '<path d="M4 18.5h16"/><path d="M6 14.5l4-4.5 3 3 5-6.5"/>',
  gauge: '<path d="M12 14.5 16.2 9.3"/><path d="M4.5 16.5a8.5 8.5 0 1 1 15 0"/>',
  crosshair: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  radar: '<circle cx="12" cy="13" r="1.4" fill="currentColor" stroke="none"/><path d="M8.5 16.5a5 5 0 1 1 7 0"/><path d="M5.6 19.4a9 9 0 1 1 12.8 0"/>',
  flask: '<path d="M9 3h6"/><path d="M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3"/><path d="M7 15h10"/>',
  hook: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14"/><path d="M5 13a7 7 0 0 0 14 0"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M14 4c3-1 6-1 6-1s0 3-1 6c-2 4-6 7-8 8l-4-4c1-2 4-6 7-9z"/><circle cx="15" cy="9" r="1.5"/>',
  speaker: '<path d="M3 11v2a2 2 0 0 0 2 2h1l4 4V5L6 9H5a2 2 0 0 0-2 2z"/><path d="M15 9a3 3 0 0 1 0 6"/><path d="M18 6a7 7 0 0 1 0 12"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18h2"/>',
};
const svg = (k, s, sw = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${G[k]}</svg>`;
const kebab = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.4" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="18.6" r="1.7"/></svg>`;
const dial = (frac, s = 18) => { const r = s / 2 - 2; const c = 2 * Math.PI * r; return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true" style="transform:rotate(-90deg)"><circle class="track" cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke-width="2.2"/><circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="${(frac * c).toFixed(1)} ${c.toFixed(1)}"/></svg>`; };
const CURSOR = '<svg class="cursor" viewBox="0 0 14 18" aria-hidden="true"><path d="M1 1l11.5 9.6-4.7.6 2.7 5.4-2.4 1.1-2.7-5.5L1 15.6z" fill="#fff" stroke="#000" stroke-width="1.1" stroke-linejoin="round"/></svg>';

/* ── the fixture: three projects from George's desk, thirteen threads, eleven playbooks ── */
const P = {
  neuramesh: { name: 'Neuramesh', logo: 'N', slug: 'neuramesh', state: 'scored', score: 72, facts: '2 cadences armed · audited 3d ago', conns: { x: 'on', linkedin: 'on', posthog: 'on' }, tally: '3 live' },
  flowe: { name: 'Flowe AI', logo: 'F', slug: 'flowe-ai', state: 'nobase', word: 'no baseline yet', facts: 'docs ✓ · 0 cadences armed', conns: { x: 'on' }, tally: '1 live', cta: 'Run the baseline audit ›' },
  aidemos: { name: 'AI Demos', logo: 'A', slug: 'ai-demos', state: 'setup', word: 'not set up', facts: 'step 1 of 4 · product', conns: {}, tally: 'nothing connected', cta: 'Finish setup ›' },
};
const ORDER = ['neuramesh', 'flowe', 'aidemos'];
const LABEL = { plan_review: 'plan review', done: 'done', todo: 'todo', in_progress: 'in progress' };
const T = [
  { p: 'neuramesh', k: 'routine', t: 'AI harness reply radar', s: 'Six X reply targets found so far. The ranking runs now.', when: '2h', day: 'today', st: 'ip' },
  { p: 'flowe', k: 'task', num: 1093, state: 'plan_review', frac: .5, t: 'Draft Flowe X calendar for Sep 14 to 20', s: 'The plan covers seven posts, two threads, and one poll.', when: '4h', day: 'today', st: 'ny' },
  { p: 'neuramesh', k: 'routine', t: 'X post schedule', s: 'rex cannot reply. This machine has no active OpenAI login.', when: '1d', day: 'yesterday', st: 'ny' },
  { p: 'flowe', k: 'routine', t: 'Routine · Research flowe', s: 'The X search tool did not connect in this run. I have no tweet content to rank.', when: '1d', day: 'yesterday', st: 'settled' },
  { p: 'flowe', k: 'routine', t: 'Routine · AI for mental health, recent research', s: 'The article is ready to post as an X long-form piece.', when: '1d', day: 'yesterday', st: 'settled' },
  { p: 'aidemos', k: 'task', num: 1059, state: 'todo', setup: true, frac: .1, t: 'Set up your marketing HQ', s: 'Step 1 of 4, the product. Two questions are open.', when: '3d', day: 'week', st: 'ny' },
  { p: 'neuramesh', k: 'routine', t: 'AI harness reply targets', s: 'Ready. Five reply cards are in this thread, ranked by impressions.', when: '3d', day: 'week', st: 'settled' },
  { p: 'neuramesh', k: 'task', num: 1071, state: 'done', frac: .86, t: 'Week-one X drafts', s: 'Seven posts approved. Three are scheduled for next week.', when: '4d', day: 'week', st: 'settled' },
  { p: 'neuramesh', k: 'chat', t: 'Competitor scan', s: 'Fathom and Simple Analytics both moved to usage pricing in August.', when: '5d', day: 'week', st: 'settled' },
  { p: 'flowe', k: 'routine', t: 'Routine · Research flowe', s: 'Five posts found. The top reply target is a thread on burnout with 41k views.', when: '6d', day: 'week', st: 'settled' },
  { p: 'neuramesh', k: 'task', num: 1064, state: 'done', frac: .86, t: 'Site audit: neuramesh.app', s: 'Score 72. Six fixes ranked, and the top three are copy.', when: '9d', day: 'earlier', st: 'settled' },
  { p: 'flowe', k: 'chat', t: 'Flowe launch plan', s: 'A T-4 week plan needs the App Store date first.', when: '12d', day: 'earlier', st: 'settled' },
  { p: 'aidemos', k: 'chat', t: 'Give me ideas', s: 'Three campaign ideas for the demo reel.', when: '2w', day: 'earlier', st: 'settled' },
];
const PB = [
  { g: 'Foundations', id: 'audit', t: 'Site & funnel audit', ic: 'gauge', tag: 'Six dimensions, weighted 0 to 100, with a fix-first list.', st: { neuramesh: { score: 72, when: '3d' } } },
  { g: 'Foundations', id: 'geo', t: 'AI search (GEO)', ic: 'globe', tag: 'Who gets cited, page rewrites, then a re-measure.', st: { neuramesh: { armed: 'monthly' } } },
  { g: 'Foundations', id: 'teardown', t: 'Competitor teardown', ic: 'crosshair', tag: 'Ads, pricing, jobs, and reviews, then the exposure map.', st: { neuramesh: { score: 54, when: '9d' } } },
  { g: 'Foundations', id: 'positioning', t: 'Positioning & offer', ic: 'compass', tag: 'The six-clause statement, tested for pasteability.', st: {} },
  { g: 'Content', id: 'engage', t: 'Reply radar', ic: 'radar', tag: 'High-reach conversations worth a reply, ranked, with the replies drafted.', st: { neuramesh: { armed: 'weekly' } } },
  { g: 'Content', id: 'copylab', t: 'Copy lab', ic: 'flask', tag: '15 to 20 variants, panel-scored, then de-slopped. In the thread.', st: {} },
  { g: 'Content', id: 'hooks', t: 'Hook batch', ic: 'hook', tag: 'The 18-tactic matrix: visual, spoken, and text. In the thread.', st: {} },
  { g: 'Content', id: 'email', t: 'Email sequence', ic: 'mail', tag: 'Welcome, nurture, and launch, written in full. Drafts only.', st: {} },
  { g: 'Campaigns', id: 'launch', t: 'Launch plan', ic: 'rocket', tag: 'T-4 weeks to T+1 week, the asset stack as subtasks.', st: {} },
  { g: 'Campaigns', id: 'ads', t: 'Ads creative audit', ic: 'speaker', tag: 'Concept fatigue against its five impostors. Needs the ads connector.', st: {}, off: true },
  { g: 'Campaigns', id: 'appstore', t: 'App store kit', ic: 'phone', tag: 'Which half is broken, and the metadata to the character.', st: {} },
];

/* ── the frame: top, rail, foot ── */
const frametop = () => `<div class="ftop">
  <span class="ftfold">${svg('sidebar', 15)}</span><span class="ftbrand">neuramesh</span>
  <span class="ftsearch">${svg('search', 13)}<span>Search or jump to…</span><b>⌘K</b></span>
  <span class="ftutils"><span class="ftutil">${svg('code', 14)}</span><span class="ftutil">${svg('globe', 14)}</span><span class="ftutil">${svg('term', 14)}</span></span>
  <span class="ftsync"><i></i>Synced</span>
  <span class="ftutil">${svg('bell', 15)}<span class="belln">12</span></span>
  <span class="ftutil">${kebab(15)}</span>
</div>`;
const railGlyph = (k) => k === 'chat' ? svg('threads', 13) : k === 'routine' ? svg('clock', 13) : k === 'wait' ? svg('circle', 13) : k === 'active' ? '<span class="dot" style="color: var(--prog)"></span>' : svg('check', 13);
const railRow = (r) => `<div class="navhistrow"><span class="navhistglyph">${railGlyph(r.k)}</span><span class="navhisttitle">${r.num ? `<b>${r.num}</b>` : ''}${r.t}</span>${r.ask ? '<span class="navhistask"></span>' : `<span class="navhistfact">${r.when}</span>`}</div>`;
const railFolder = (name, rows, { folded = false, ask = false } = {}) => `<div class="navgrp"><div class="navgrprow"><span class="navhistglyph">${svg(folded ? 'folder' : 'folderopen', 14)}</span><span class="navgrpname">${name}</span><span class="navhisttrail">${folded && ask ? '<span class="navhistask"></span>' : ''}${folded ? `<span class="navhistfact">${rows.length}</span>` : ''}<span class="navgrpchev${folded ? ' c' : ''}">${svg('chevron', 12)}</span></span></div>${folded ? '' : rows.map(railRow).join('')}</div>`;
const foot = `<div class="navfoot"><span class="wstile">G<i></i></span><span class="wsname">GADS INC</span><span class="navhistglyph">${svg('chevron', 12)}</span><svg class="credring" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8.5" fill="none" stroke="var(--panel3)" stroke-width="3"/><circle cx="11" cy="11" r="8.5" fill="none" stroke="var(--green)" stroke-width="3" stroke-dasharray="40 53.4" stroke-linecap="round" transform="rotate(-90 11 11)"/></svg></div>`;
const rail = () => `<div class="nav">
  <div class="navseg"><span class="on">Chat</span><span>Code</span></div>
  <div class="navnew"><span class="row">${svg('compose', 15)}New chat<span class="kbd">⌘N</span></span><span class="caret">${svg('chevron', 14)}</span></div>
  <div class="navsect"><span class="chev">${svg('chevron', 10)}</span>Shortcuts</div>
  <div class="navdest">
    <div class="navitem">${svg('whiteboard', 15)}<span class="navlabel">Whiteboards</span></div>
    <div class="navitem navparent">${svg('repeat', 15)}<span class="navlabel">Scheduled</span><span class="navitembadge">14</span><span class="chev">${svg('chevr', 12)}</span></div>
    <div class="navitem">${svg('library', 15)}<span class="navlabel">Files</span></div>
    <div class="navitem on">${svg('trend', 15)}<span class="navlabel">Marketing OS</span></div>
    <div class="navitem">${svg('code', 15)}<span class="navlabel">Code</span></div>
  </div>
  <div class="navlist">
    <div class="navgrphd"><span class="navprojchev">${svg('chevron', 12)}</span><span class="navgrphdlbl door">Recents</span><span class="navgrphdsep">·</span><span class="navgrphdlbl">Projects</span><span class="navgrphdcnt">3</span><span class="navscopegrow"></span><span class="navhistfind">${svg('search', 13)}</span></div>
    ${railFolder('neuramesh', [
      { k: 'routine', t: 'X post schedule', ask: true },
      { k: 'active', t: 'AI harness reply radar', when: '2h' },
      { k: 'routine', t: 'AI harness reply targets', when: '3d' },
      { k: 'done', t: 'Week-one X drafts', when: '4d' },
      { k: 'chat', t: 'Competitor scan', when: '5d' },
    ])}
    ${railFolder('flowe-ai', [
      { k: 'wait', num: 1093, t: 'Draft Flowe X calendar for Sep 14 to 20', ask: true },
      { k: 'routine', t: 'Routine · Research flowe', when: '1d' },
      { k: 'routine', t: 'Routine · AI for mental health, recent research', when: '1d' },
      { k: 'chat', t: 'Flowe launch plan', when: '12d' },
    ])}
    ${railFolder('ai-demos', [{}, {}], { folded: true, ask: true })}
  </div>
  ${foot}
</div>`;

/* ── the sheet's pieces ── */
const topbar = (title, desc) => `<div class="topbar">${title}${desc ? `<span class="desc">${desc}</span>` : ''}</div>`;
const scopebar = (scope) => `<div class="scopebar">
  <div class="wfsearch">${svg('search', 14)}<span>Search marketing…</span></div>
  <span class="cchip${scope ? ' set' : ''}">${scope ? P[scope].name : 'All projects'}<span class="car">▾</span></span>
</div>`;
const MARKS = ['x', 'linkedin', 'instagram', 'tiktok', 'posthog'];
const marks = (conns, tally) => `${MARKS.map((p) => `<span class="mark${conns[p] ? ' ' + conns[p] : ''}">${svg(p, 13, 1.8)}</span>`).join('')}<span class="mtally">${tally}</span>`;
const tile = (p) => `<div class="tile">
  <div class="tl1"><span class="tlogo">${p.logo}</span><span class="tname">${p.name}</span>${p.state === 'scored' ? `<span class="tscore"><span class="gdial" style="width:24px;height:24px;--frac:${p.score / 100}"></span>${p.score}</span>` : `<span class="tcta">${p.cta}</span>`}</div>
  <div class="tfacts">${p.state === 'scored' ? p.facts : `${p.word} · ${p.facts}`}</div>
  <div class="tl3">${marks(p.conns, p.tally)}</div>
</div>`;
const desk = (scope) => scope
  ? `<div class="deskbar"><span class="tlogo">${P[scope].logo}</span><span class="tname">${P[scope].name}</span>${P[scope].state === 'scored' ? `<span class="tscore"><span class="gdial" style="width:24px;height:24px;--frac:${P[scope].score / 100}"></span>${P[scope].score}</span>` : `<span class="tcta">${P[scope].cta}</span>`}<span class="tfacts">${P[scope].state === 'scored' ? P[scope].facts : `${P[scope].word} · ${P[scope].facts}`}</span><span class="marks">${marks(P[scope].conns, P[scope].tally)}</span></div>`
  : `<div class="desk">${ORDER.map((k) => tile(P[k])).join('')}</div>`;

/* the pills as filters: the ⌘Y / Home ledger chips, counts in the mono whisper */
const chips = (items, on) => `<div class="filt">${items.map(([label, n, dot]) => `<span class="fchip${label === on ? ' on' : ''}">${dot ? `<span class="fdot${dot === 'settled' ? '' : ' ' + dot}"></span>` : ''}${label}<b>${n}</b></span>`).join('')}</div>`;
const pbChips = (on) => chips([['All', 11], ['Foundations', 4], ['Content', 4], ['Campaigns', 3]], on);
const thChips = (on, rows) => chips([['All', rows.length], ['Needs you', rows.filter((t) => t.st === 'ny').length, 'ny'], ['In progress', rows.filter((t) => t.st === 'ip').length, 'ip'], ['Settled', rows.filter((t) => t.st === 'settled').length, 'settled']], on);

/* THE BAR. `section` = the section under the bar (lights the word, picks the chips). `mix` between 0 and 1
   draws the hand-off mid-flight: the playbook chips leave, the status chips arrive, the words trade ink. */
const secbar = ({ section, rows, pbChip = 'All', thChip = 'All', mix = null, stuck = false, three = false, hov = null }) => {
  const pb = pbChips(pbChip), th = thChips(thChip, rows);
  const left = mix == null ? (section === 'threads' ? th : pb)
    : `<div class="chipx"><div style="opacity:${(1 - mix).toFixed(2)};transform:translateY(${(-4 * mix).toFixed(1)}px)">${pb}</div><div style="opacity:${mix.toFixed(2)};transform:translateY(${(7 * (1 - mix)).toFixed(1)}px)">${th}</div></div>`;
  const word = (id, label, n) => {
    const lit = mix == null ? section === id : null;
    const cls = lit == null ? ' half' : lit ? '' : ' door';
    const count = lit || (lit == null && id === 'threads');   // George, 2026-09-17: the count rides the lit word only
    return `<span class="lbl${cls}${hov === id ? ' hov' : ''}">${label}${count ? `<b>${n}</b>` : ''}</span>`;
  };
  const words = `<span class="secwords">${three ? `<span class="lbl${section === 'all' ? '' : ' door'}">All</span><span class="sep">·</span>` : ''}${word('playbooks', 'Playbooks', PB.length)}<span class="sep">·</span>${word('threads', 'Threads', rows.length)}</span>`;
  return `<div class="secbar${stuck ? ' stuck' : ''}"><div class="secbarin">${left}${words}</div></div>`;
};

/* the catalog: today's row plus a glyph. At rest the trailing slot is a FACT, on hover it is the verb */
const newest = (pb) => { const e = Object.entries(pb.st)[0]; return e ? { proj: e[0], ...e[1] } : null; };
const pbFact = (pb, scope) => {
  if (pb.off) return '<span class="pbnever">needs the ads connector</span>';
  const s = scope ? (pb.st[scope] ? { proj: scope, ...pb.st[scope] } : null) : newest(pb);
  if (!s) return '<span class="pbnever">never run</span>';
  const proj = scope ? '' : `<i class="pbproj">${P[s.proj].slug}</i>`;
  if (s.armed) return `<span class="pbarmed">armed · ${s.armed}</span>${proj}`;
  return `<span class="pbscore"><span class="gdial s g" style="width:14px;height:14px;--frac:${s.score / 100}"></span>${s.score}<i class="pbwhen">${s.when}</i></span>${proj}`;
};
const pbrow = (pb, { scope = null, hov = false } = {}) => `<div class="pbrow${hov ? ' hov' : ''}${pb.off ? ' off' : ''}"><span class="pg">${svg(pb.ic, 15, 1.8)}</span><span class="pbtxt"><b>${pb.t}</b><span>${pb.tag}</span></span><span class="pbmeta">${hov ? `<span class="pbrun">${scope ? 'Run ›' : 'Run for… ›'}</span>` : pbFact(pb, scope)}</span></div>`;
const catalog = ({ scope = null, chip = 'All', hovId = null } = {}) => {
  const rows = PB.filter((pb) => chip === 'All' || pb.g === chip);
  let last = '';
  return `<div class="list" id="playbooks">${rows.map((pb) => {
    const head = chip === 'All' && pb.g !== last ? `<div class="pbgroup">${pb.g}</div>` : ''; last = pb.g;
    return head + pbrow(pb, { scope, hov: pb.id === hovId });
  }).join('')}</div>`;
};

/* the threads: the ledger's row, NEEDS YOU pinned first under All, then the day groups */
const chipOf = (t) => t.k === 'task' ? (t.setup ? '<span class="chip c-setup">setup</span>' : `<span class="chip c-${t.state}">${LABEL[t.state]}</span>`) : t.k === 'routine' ? '<span class="chip c-routine">routine</span>' : '<span class="chip c-chat">chat</span>';
const statOf = (t) => t.st === 'ny' ? '<span class="chip st-ny">needs you</span>' : t.st === 'ip' ? '<span class="chip st-ip">in progress</span>' : '';
const hico = (t) => t.k === 'task' ? `<span class="hico c-${t.setup ? 'setup' : t.state}">${dial(t.frac)}</span>` : `<span class="hico">${svg(t.k === 'routine' ? 'clock' : 'threads', 13)}</span>`;
const hrow = (t, scope) => `<div class="hrow">${hico(t)}<span class="hbody"><span class="htitle"><span>${t.num ? `<b>#${t.num}</b>` : ''}${t.t}</span>${chipOf(t)}${statOf(t)}</span><span class="hsnip">${t.s}</span></span><span class="hwhen">${t.st === 'ny' ? '<span class="hask"></span>' : ''}${scope ? '' : `<span class="hchan">${P[t.p].slug} · #marketing</span>`}<span>${t.when}</span></span></div>`;
const group = (label, cls = '') => `<div class="sgroup${cls}"><span>${label}</span><span class="rule"></span></div>`;
const seeAll = '<div class="sallrow">Search every conversation <span class="k">⌘Y</span></div>';
const threads = ({ scope = null, chip = 'All' } = {}) => {
  const rows = T.filter((t) => !scope || t.p === scope);
  const ny = rows.filter((t) => t.st === 'ny');
  if (chip === 'Needs you') return `<div class="list" id="threads">${group(`Needs you · ${ny.length}`, ' ny first')}${ny.map((t) => hrow(t, scope)).join('')}${seeAll}</div>`;
  const rest = (d) => rows.filter((t) => t.st !== 'ny' && t.day === d).map((t) => hrow(t, scope)).join('');
  let first = true;
  const day = (label, d) => { const r = rest(d); if (!r) return ''; const g = group(label, first ? ' first' : ''); first = false; return g + r; };
  const nyBlock = ny.length ? group(`Needs you · ${ny.length}`, ' ny first') + ny.map((t) => hrow(t, scope)).join('') : '';
  if (nyBlock) first = false;
  return `<div class="list" id="threads">${nyBlock}${day('Today', 'today')}${day('Yesterday', 'yesterday')}${day('This week', 'week')}${day('Earlier', 'earlier')}${seeAll}</div>`;
};

/* ── the page as one document, the scroll emulated with a translate, the bar stuck past its own top ── */
const BAR_TOP = 181;   // scopebar (4 + 66) + desk (4 + 93) + the bar's own top padding (14)
const sheetInner = ({ scope = null, scrollY = 0, section = 'playbooks', pbChip = 'All', thChip = 'All', hovId = null, mix = null, three = false, hov = null, cursor = null }) => {
  const rows = T.filter((t) => !scope || t.p === scope);
  const stuck = scrollY >= BAR_TOP;
  const bar = secbar({ section, rows, pbChip, thChip, mix, three, hov });
  return `${topbar('Marketing OS', 'every project’s marketing, one desk')}<div class="mkosview">
    <div class="scrollinner" style="transform:translateY(-${scrollY}px)">${scopebar(scope)}${desk(scope)}${stuck ? '<div class="secbarph"></div>' : bar}${catalog({ scope, chip: pbChip, hovId })}${threads({ scope, chip: thChip })}</div>
    ${stuck ? secbar({ section, rows, pbChip, thChip, mix, stuck: true, three, hov }) : ''}
    ${cursor ? `<span style="position:absolute;left:${cursor[0]}px;top:${cursor[1]}px">${CURSOR}</span>` : ''}
  </div>`;
};
const frame = (theme, inner) => `<div class="frame" style="${tokens(THEMES[theme])}">${frametop()}<div class="fbody">${rail()}<div class="sheet">${inner}</div></div></div>`;

/* the motion board: three frames of the hand-off, then the spec */
const SCROLL_TO_THREADS = 815;   // the threads' first group head lands under the stuck bar (measured on the board)
const miniFrame = (state, cap) => `<div class="mini"><div class="miniclip"><div class="minisheet"><div class="sheet">${sheetInner(state)}</div></div></div><div class="mcap">${cap}</div></div>`;
const motionBoard = () => `<div class="frame" style="${tokens(THEMES.graphite)}"><div class="mboard">
  <div class="mtitle">The hand-off · THREADS pressed at the top of the page</div>
  <div class="mframes">
    ${miniFrame({ scrollY: 0, section: 'playbooks', hov: 'threads', cursor: [1018, 184] }, '<b>t = 0 · Threads pressed</b>The bar sits in flow under the desk, the playbook chips at its left. The dim word takes the text ink on hover, the way the rail’s door does.')}
    ${miniFrame({ scrollY: 400, section: 'threads', mix: .5 }, '<b>t ≈ 200 ms · in flight</b>The page moves on the signature ease. The bar has reached the top and stuck, with its hairline and the resting shadow. The old chips leave, the new ones rise into the slot, the words trade ink.')}
    ${miniFrame({ scrollY: SCROLL_TO_THREADS, section: 'threads' }, '<b>t = 420 ms · landed</b>NEEDS YOU sits under the bar. THREADS is lit, the status chips are in place, PLAYBOOKS is the door back up. A manual scroll ends in this same state.')}
  </div>
  <table class="mtable">
    <tr><th>What moves</th><th>How</th><th>Time</th><th>Rule</th></tr>
    <tr><td>The page</td><td>Scrolls so the section’s first group head lands under the bar (<code>scroll-margin-top</code> = the bar’s height)</td><td><code>420 ms · --ease</code></td><td>docs/33 §7, a column hand-off is one gesture and slower than an entrance</td></tr>
    <tr><td>The old chips</td><td>Fade and lift 4px, then leave the slot</td><td><code>130 ms · --dur-exit</code></td><td>exits leave faster than entrances arrive</td></tr>
    <tr><td>The new chips</td><td><code>nm-rise</code>, fade and a 7px rise, one chip after another, timed to land with the scroll</td><td><code>220 ms · 32 ms stagger</code></td><td>the house entrance idiom</td></tr>
    <tr><td>The lit word</td><td>Colour only, the text ink moves from one word to the other</td><td><code>150 ms · --dur</code></td><td>no underline, no pill, the kicker stays a kicker</td></tr>
    <tr><td>The bar’s edge</td><td>The hairline and <code>--shadow-card</code> fade in when the bar reaches the top, and out when it returns to the flow</td><td><code>120 ms · --dur-fast</code></td><td>elevation over outline</td></tr>
    <tr><td>Scroll-spy</td><td>An <code>IntersectionObserver</code> with the bar’s height as <code>rootMargin</code> lights the word and swaps the chips on a manual scroll too</td><td>live</td><td>one state, whichever way you got there</td></tr>
    <tr><td>Reduced motion</td><td>An instant jump and a plain swap</td><td><code>0</code></td><td>the §7 guard on every entrance</td></tr>
  </table>
</div></div>`;

const BOARDS = [
  { file: 'Main.dc.html', title: 'A · at rest · graphite', theme: 'graphite', body: (t) => frame(t, sheetInner({ hovId: 'teardown' })), x: 0, y: 0 },
  { file: 'Scrolled.dc.html', title: 'A · scrolled into threads · the bar stuck', theme: 'graphite', body: (t) => frame(t, sheetInner({ scrollY: SCROLL_TO_THREADS, section: 'threads' })), x: 1580, y: 0 },
  { file: 'Motion.dc.html', title: 'A · the hand-off · three frames and the spec', theme: 'graphite', body: () => motionBoard(), x: 3160, y: 0 },
  { file: 'CreamOak.dc.html', title: 'A · at rest · cream oak', theme: 'cream', body: (t) => frame(t, sheetInner({ hovId: 'teardown' })), x: 0, y: 1260 },
  { file: 'Scoped.dc.html', title: 'A · Neuramesh picked · Foundations chip on', theme: 'graphite', body: (t) => frame(t, sheetInner({ scope: 'neuramesh', pbChip: 'Foundations', hovId: 'geo' })), x: 1580, y: 1260 },
];

const page = (b) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${b.title}</title>${FONTS}<style>${CSS}</style></head>
<body>${b.body(b.theme)}</body></html>`;

const NOTES = [
  { id: 'note-a', x: 0, y: -290, w: 4600, text: `A · ONE PAGE, ONE BAR (round 3, after George's second note)
The page is today's page again: the desk, then the playbooks, then the threads underneath as you scroll. ONE bar under the desk carries the pills at the LEFT and the two section words at the RIGHT, PLAYBOOKS 11 · THREADS, one line, nothing stacked, the count on the lit word only. The words are subheadings, not tabs: a click scrolls the page to that section on the signature ease and the section's own pills take the left slot. The bar sticks to the top of the sheet while you scroll, and the lit word follows the section under it, so a click and a manual scroll end in the same state. The pills are filters inside their section: the playbook groups on one, the thread statuses (the Home ledger's chips, one derivation with the bell) on the other. The project pill at the top keeps scoping the whole screen. "All" is the page itself: nothing narrows unless a pill is on. The desk strip, the catalog rows (glyph, fact at rest, verb on hover, today's Run-for picker) and the ledger rows are unchanged from round 2.` },
  { id: 'note-rest', x: 0, y: 1020, w: 1440, text: `A · AT REST. The bar sits in flow under the desk, ground on ground, no edge. PLAYBOOKS is lit because that section is under it. The whole catalog fits, and NEEDS YOU peeks at the bottom: the threads are one scroll away, exactly as today, now with a door to them.` },
  { id: 'note-scrolled', x: 1580, y: 1020, w: 1440, text: `A · SCROLLED INTO THREADS. The bar is stuck under the topbar with a hairline and the resting shadow. THREADS is lit, the status chips sit at the left, NEEDS YOU lands right under the bar, then the day groups. The desk and the catalog are above, and PLAYBOOKS is the door back up.` },
  { id: 'note-motion', x: 3160, y: 1020, w: 1440, text: `A · THE HAND-OFF (think experience). One gesture, 420 ms on the signature ease, the docs/33 §7 hand-off duration. The old chips leave in 130 ms, the new ones rise in with nm-rise, staggered, timed to land as the scroll lands. The lit word is colour only, 150 ms. The stuck edge fades in over 120 ms. Scroll-spy keeps the bar honest on a manual scroll. Reduced motion jumps.` },
  { id: 'note-cream', x: 0, y: 2280, w: 1440, text: `A · CREAM OAK. The same page in the signature light. The bar in flow is ground, the stuck bar is ground with a hairline. The chips and the tiles are the elevated stratum, nothing here is a warm well.` },
  { id: 'note-scoped', x: 1580, y: 2280, w: 1440, text: `A · SCOPED. Neuramesh picked: the desk is one line, the rows carry that project's state and the verb is Run ›, the Foundations chip narrows the catalog to four rows, and the threads below are Neuramesh's, with no project tag. The marks on the desk line are doors (the composer foot's rule), so the scoped Connections section retires.` },
  { id: 'note-decided', x: 3160, y: 1260, w: 1440, text: `DECIDED (George, 2026-09-17): the two-word version, and the count rides the lit word only. The three-word ALL alternate (version 3 of this canvas) retired. This version is the visual contract the build follows.` },
];

/* ── write the artboards, the manifest, and the seeded canvas ── */
for (const b of BOARDS) writeFileSync(join(HERE, b.file), page(b));
writeFileSync(join(HERE, 'canvas.json'), JSON.stringify({
  artboards: BOARDS.map((b) => ({ file: b.file, x: b.x, y: b.y, w: W, h: H, title: b.title })),
  annotations: NOTES,
  launch: { fit: 'all' },
}, null, 2) + '\n');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const canvas = `<title>Marketing OS Desk</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@500;600&display=swap">
<style>
  :root { --bg: #e8e6e2; --ink: #1c1a17; --muted: #6f6a63; --card: #f6f5f2; --line: #d3cfc8; --btn: #ffffff; --accent: #834a2b; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0f0f0f; --ink: #d4d4d4; --muted: #8a8a8a; --card: #1b1b1b; --line: #303030; --btn: #232323; } }
  :root[data-theme="dark"] { --bg: #0f0f0f; --ink: #d4d4d4; --muted: #8a8a8a; --card: #1b1b1b; --line: #303030; --btn: #232323; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; -webkit-font-smoothing: antialiased; }
  .stage { position: absolute; inset: 0; overflow: hidden; cursor: grab; touch-action: none; }
  .stage.drag { cursor: grabbing; }
  .world { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
  .board { position: absolute; }
  .board iframe { display: block; width: ${W}px; height: ${H}px; border: 0; pointer-events: none; background: #141414; border-radius: 6px; box-shadow: 0 10px 34px -12px rgba(0,0,0,.55); }
  .bt { position: absolute; left: 0; top: -34px; font: 500 15px 'Geist Mono', ui-monospace, Menlo, monospace; letter-spacing: -.02em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
  .note { position: absolute; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 22px 26px; font-size: 21px; line-height: 1.5; white-space: pre-wrap; color: var(--ink); }
  .hud { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 12px); left: 16px; right: 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; z-index: 10; pointer-events: none; }
  .hud > * { pointer-events: auto; }
  .hud h1 { margin: 0 8px 0 0; font: 500 14px 'Geist', sans-serif; letter-spacing: -.01em; }
  .hud h1 small { color: var(--muted); font-weight: 400; margin-left: 8px; }
  .hud button { font: 500 11px 'Geist Mono', ui-monospace, Menlo, monospace; letter-spacing: -.02em; text-transform: uppercase; color: var(--ink); background: var(--btn); border: 1px solid var(--line); border-radius: 3px; padding: 5px 9px; cursor: pointer; }
  .hud button:hover, .hud button:focus-visible { border-color: var(--accent); outline: none; }
  .hud .sp { flex: 1; }
  .hint { position: fixed; bottom: calc(env(safe-area-inset-bottom, 0px) + 12px); left: 16px; font-size: 12px; color: var(--muted); pointer-events: none; }
</style>
<div class="hud"><h1>Marketing OS Desk<small>design round 3 · 2026-09-17 · decided</small></h1><button data-fit="all">Fit</button><button data-fit="one">100%</button><span class="sp"></span>${BOARDS.map((b, i) => `<button data-board="${i}">${esc(b.title.split(' · ').slice(1).join(' · '))}</button>`).join('')}</div>
<div class="stage" id="stage"><div class="world" id="world">
${NOTES.map((n) => `<div class="note" style="left:${n.x}px;top:${n.y}px;width:${n.w}px">${esc(n.text)}</div>`).join('\n')}
${BOARDS.map((b) => `<div class="board" style="left:${b.x}px;top:${b.y}px"><span class="bt">${esc(b.title)}</span><iframe title="${esc(b.title)}" loading="eager" srcdoc="${esc(page(b))}"></iframe></div>`).join('\n')}
</div></div>
<div class="hint">Drag to pan · scroll to pan · ⌘ or ctrl + scroll to zoom · press 0 to fit · 1 to 5 jump to a board</div>
<script>
(function () {
  var W = ${W}, H = ${H};
  var boards = ${JSON.stringify(BOARDS.map((b) => ({ x: b.x, y: b.y })))};
  var notes = ${JSON.stringify(NOTES.map((n) => ({ x: n.x, y: n.y, w: n.w })))};
  var stage = document.getElementById('stage'), world = document.getElementById('world');
  var s = 1, tx = 0, ty = 0;
  function apply() { world.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')'; }
  function fit(r) {
    var vw = stage.clientWidth, vh = stage.clientHeight, pad = 70;
    s = Math.min((vw - pad * 2) / r.w, (vh - pad * 2) / r.h);
    tx = (vw - r.w * s) / 2 - r.x * s; ty = (vh - r.h * s) / 2 - r.y * s + 26; apply();
  }
  function all() {
    var minX = 0, minY = 0, maxX = 0, maxY = 0;
    boards.forEach(function (b) { maxX = Math.max(maxX, b.x + W); maxY = Math.max(maxY, b.y + H); });
    notes.forEach(function (n) { minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x + n.w); });
    document.querySelectorAll('.note').forEach(function (el) { maxY = Math.max(maxY, el.offsetTop + el.offsetHeight); });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  function board(i) { var b = boards[i]; if (!b) return; fit({ x: b.x, y: b.y - 40, w: W, h: H + 40 }); }
  document.querySelectorAll('[data-board]').forEach(function (el) { el.addEventListener('click', function () { board(+el.dataset.board); }); });
  document.querySelector('[data-fit="all"]').addEventListener('click', function () { fit(all()); });
  document.querySelector('[data-fit="one"]').addEventListener('click', function () { s = 1; tx = 40; ty = 340; apply(); });
  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      var k = Math.exp(-e.deltaY * 0.01), ns = Math.min(3, Math.max(0.04, s * k));
      var r = stage.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      tx = mx - (mx - tx) * (ns / s); ty = my - (my - ty) * (ns / s); s = ns;
    } else { tx -= e.deltaX; ty -= e.deltaY; }
    apply();
  }, { passive: false });
  var drag = null;
  stage.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, tx: tx, ty: ty }; stage.classList.add('drag'); stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', function (e) { if (!drag) return; tx = drag.tx + (e.clientX - drag.x); ty = drag.ty + (e.clientY - drag.y); apply(); });
  stage.addEventListener('pointerup', function () { drag = null; stage.classList.remove('drag'); });
  stage.addEventListener('pointercancel', function () { drag = null; stage.classList.remove('drag'); });
  document.addEventListener('keydown', function (e) { if (e.key === '0') fit(all()); if (e.key >= '1' && e.key <= '9') board(+e.key - 1); });
  window.addEventListener('resize', function () { fit(all()); });
  fit(all());
})();
</script>`;
writeFileSync(join(CANVAS_OUT, 'canvas.html'), canvas);
console.log(`wrote ${BOARDS.length} artboards + canvas.json to ${HERE}\nwrote canvas.html to ${CANVAS_OUT}`);
