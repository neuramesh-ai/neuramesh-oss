// Generates the design-canvas artboards for the Video rung round (2026-09-19): NeuraMesh films a video
// post's hook on the platform's fal.ai key, metered on cloud credits, with the model switched by an env
// variable on the backend. The shell, the tokens and the card CSS are the release-drafts round's recipe
// (docs/design/release-drafts-2026-09/build.mjs), so a board here is the app as it looks today.
// Every value is lifted from tokens.css (.topbar, .msg, .mkpostcard, .mkpv, .mkpcfoot, .mkscript, .chip).
// Run: node build.mjs [canvas-out-dir]   (the *.dc.html boards + canvas.json land beside this file; the
// seeded canvas page lands in canvas-out-dir, default: beside this file too)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS_OUT = process.argv[2] ? resolve(process.argv[2]) : HERE;
mkdirSync(CANVAS_OUT, { recursive: true });

const W = 1440, H = 1000;

const THEMES = {
  graphite: { win: '#0d0d0d', bg: '#141414', panel: '#161616', panel2: '#1a1a1a', panel3: '#262626', border: '#262626', border2: '#3a3a3a', cardBorder: '#2c2c2c', card: '#1e1e1e',
    text: '#cbcbcb', body: '#a6a6a6', muted: '#848484', dim: '#6a6a6a', link: '#d19a72', brand: '#834a2b', brandInk: '#fff7ee', green: '#77ac8d', warn: '#c9a15e', prog: '#8ba0c0', planrev: '#a89ccf', done: '#77ac8d', todo: '#949494', roleMkt: '#c98f8f', roleOrch: '#9793d2', blocked: '#9ca0a8', accent: '#cbcbcb', violet: '#a89ccf', warm: '#a6a6a6',
    overlay: '#222222', shadow: 'rgba(0,0,0,0.62)', hoverBg: 'color-mix(in srgb, #cbcbcb 7%, transparent)', hoverBorder: '#404040', selBg: 'color-mix(in srgb, #cbcbcb 10%, transparent)', ring: '#525252',
    shadowCard: '0 1px 2px rgba(0,0,0,.25)', shadowLift: '0 8px 20px -8px rgba(0,0,0,.55)', shadowPop: '0 20px 55px -14px rgba(0,0,0,.65)', btn: '#232323', btnFg: '#efefef', btnHover: '#2f2f2f', vizScore: '#5b93d8' },
  cream: { win: '#f0e5d3', bg: '#fbf8f4', panel: '#fbf8f4', panel2: '#f6eee1', panel3: '#efe1cd', border: '#e6dbca', border2: '#d3c2a8', cardBorder: '#eadfce', card: '#ffffff',
    text: '#3a2c22', body: '#5b4c3d', muted: '#8b7861', dim: '#a99680', link: '#9c5730', brand: '#834a2b', brandInk: '#fff7ee', green: '#2f9e6b', warn: '#a06a1f', prog: '#4f80c4', planrev: '#7d56b8', done: '#0f9d63', todo: '#7d8590', roleMkt: '#b04f55', roleOrch: '#635fc0', blocked: '#7d7f86', accent: '#834a2b', violet: '#7d6cc4', warm: '#5b4c3d',
    overlay: '#ffffff', shadow: 'rgba(70,42,18,0.16)', hoverBg: 'color-mix(in srgb, #3a2c22 5%, transparent)', hoverBorder: 'color-mix(in srgb, #3a2c22 10%, #d3c2a8)', selBg: 'color-mix(in srgb, #834a2b 8%, transparent)', ring: 'color-mix(in srgb, #834a2b 42%, #d3c2a8)',
    shadowCard: '0 1px 2px rgba(70,42,18,.05)', shadowLift: '0 8px 20px -8px rgba(70,42,18,.20)', shadowPop: '0 20px 55px -14px rgba(70,42,18,.30)', btn: '#f8f2e8', btnFg: '#43301f', btnHover: '#efe4d2', vizScore: '#2f6fc2' },
};
const tokens = (t) => Object.entries({ '--win': t.win, '--bg': t.bg, '--panel': t.panel, '--panel2': t.panel2, '--panel3': t.panel3, '--border': t.border, '--border2': t.border2, '--card-border': t.cardBorder, '--card': t.card,
  '--text': t.text, '--body': t.body, '--muted': t.muted, '--dim': t.dim, '--link': t.link, '--brand': t.brand, '--brand-ink': t.brandInk, '--green': t.green, '--warn': t.warn, '--prog': t.prog, '--planrev': t.planrev, '--done': t.done, '--todo': t.todo, '--role-mkt': t.roleMkt, '--role-orch': t.roleOrch, '--blocked': t.blocked, '--accent': t.accent, '--violet': t.violet, '--warm': t.warm,
  '--overlay': t.overlay, '--shadow': t.shadow, '--hover-bg': t.hoverBg, '--hover-border': t.hoverBorder, '--sel-bg': t.selBg, '--ring': t.ring, '--shadow-card': t.shadowCard, '--shadow-lift': t.shadowLift, '--shadow-pop': t.shadowPop, '--btn': t.btn, '--btn-fg': t.btnFg, '--btn-hover': t.btnHover, '--viz-score': t.vizScore }).map(([k, v]) => `${k}:${v};`).join('');

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;450;500;600&amp;family=Geist+Mono:wght@400;500;600&amp;family=Bricolage+Grotesque:wght@500;600&amp;display=swap">';

/* ── the shell: frame top, the naked rail, the sheet (the desk round's recipe, unchanged) ── */
const SHELL = `
  body { margin: 0; }
  .frame { --fbody: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; --fmono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace; --fbrand: 'Bricolage Grotesque', var(--fbody);
    position: relative; box-sizing: border-box; width: ${W}px; height: ${H}px; background: var(--win); color: var(--text); font: 14px/1.5 var(--fbody); -webkit-font-smoothing: antialiased; overflow: hidden; display: flex; flex-direction: column; }
  .frame *, .frame *::before, .frame *::after { box-sizing: border-box; }
  .frame svg { display: block; }
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
  .navitem.child { padding-left: 40px; font-size: 13px; }
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
  .navhistrow.on { background: var(--card); box-shadow: var(--shadow-card), inset 0 0 0 1px var(--card-border); }
  .navhistrow.on .navhisttitle { color: var(--text); }
  .navhistglyph { flex: none; width: 14px; height: 14px; display: grid; place-items: center; color: var(--dim); }
  .navhistglyph .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .navhisttitle { flex: 1; min-width: 0; font-size: 14px; font-weight: 450; color: var(--body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .navhisttitle b { font: 500 11px var(--fmono); color: var(--dim); margin-right: 5px; }
  .navhiststat { font: 500 10px var(--fmono); letter-spacing: -.02em; white-space: nowrap; }
  .navhiststat.ny { color: var(--warn); } .navhiststat.ip { color: var(--prog); }
  .navfoot { display: flex; align-items: center; gap: 8px; padding: 8px; margin-top: auto; }
  .wstile { width: 22px; height: 22px; border-radius: 4px; background: var(--panel3); border: 1px solid var(--border2); display: grid; place-items: center; font: 600 11px var(--fmono); color: var(--body); position: relative; }
  .wstile i { position: absolute; top: -3px; right: -3px; width: 7px; height: 7px; border-radius: 50%; background: var(--warn); border: 1.5px solid var(--win); }
  .wsname { font-size: 13px; font-weight: 600; color: var(--text); flex: 1; }
  .credring { width: 22px; height: 22px; }
  .sheet { flex: 1; min-width: 0; margin: 2px 8px 8px 4px; background: var(--bg); border-radius: 8px; border: 1px solid color-mix(in srgb, var(--card-border) 70%, transparent); display: flex; flex-direction: column; overflow: hidden; position: relative; }
  .topbar { height: 52px; min-height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 20px; font: 500 17.5px var(--fbody); letter-spacing: -.02em; color: var(--text); flex: none; }
  .topbar .desc { color: var(--dim); font: 500 12px var(--fbody); letter-spacing: 0; border-left: 1px solid var(--border); padding-left: 10px; }
  .topbar .tright { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; color: var(--muted); }
  .topbar .tright .ftutil { width: 30px; }
  .chip { display: inline-flex; align-items: center; gap: 5px; font: 500 10px var(--fmono); letter-spacing: -.02em; padding: 3px 7px; border-radius: 3px; text-transform: uppercase; white-space: nowrap; flex: none; }
  .st-ny { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
  .st-ip { background: color-mix(in srgb, var(--prog) 16%, transparent); color: var(--prog); }
  .st-settled { background: var(--panel3); color: var(--muted); border: 1px solid var(--border2); }
  .c-done { background: color-mix(in srgb, var(--done) 16%, transparent); color: var(--done); }
  .c-in_progress { background: color-mix(in srgb, var(--prog) 16%, transparent); color: var(--prog); }
  .c-todo { background: color-mix(in srgb, var(--todo) 16%, transparent); color: var(--todo); }
  .c-setup { background: color-mix(in srgb, var(--role-mkt) 13%, transparent); color: var(--role-mkt); }
  .c-routine, .c-chat { background: var(--panel3); color: var(--muted); border: 1px solid var(--border2); }
  .mk-draft { background: color-mix(in srgb, var(--muted) 14%, transparent); color: var(--muted); }
  .mk-scheduled { background: color-mix(in srgb, var(--prog) 16%, transparent); color: var(--prog); }
  .mk-published { background: color-mix(in srgb, var(--done) 16%, transparent); color: var(--done); }
  .routinechip { flex: none; display: inline-flex; align-items: center; gap: 4px; font: 600 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--muted); border: 1px solid var(--border2); border-radius: 3px; padding: 2.5px 8px; }
  .roomchip { display: inline-flex; align-items: center; gap: 5px; font: 500 11px var(--fmono); letter-spacing: -.02em; color: var(--muted); border: 1px solid var(--border); border-radius: 3px; padding: 3px 8px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 12px; border-radius: 3px; font: 500 11px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; border: 1px solid var(--border2); background: var(--btn); color: var(--btn-fg); white-space: nowrap; position: relative; isolation: isolate; overflow: hidden; }
  .btn::before { content: ""; position: absolute; inset: 0; z-index: -1; background: repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 7px); opacity: .07; }
  .btn.primary { background: var(--brand); color: var(--brand-ink); border-color: var(--brand); } .btn.primary::before { opacity: .14; }
  .btn.ghost { background: transparent; color: var(--body); border-color: var(--border); }
  .btn.sm { height: 25px; padding: 0 10px; font-size: 10.5px; }
  .hico { flex: none; width: 30px; height: 30px; border-radius: 4px; display: grid; place-items: center; background: var(--card); border: 1px solid var(--card-border); color: var(--muted); }
  .hico .track { stroke: color-mix(in srgb, var(--dim) 30%, transparent); }
  .hico.c-done { color: var(--done); background: var(--card); } .hico.c-setup { color: var(--role-mkt); background: var(--card); } .hico.c-in_progress { color: var(--prog); background: var(--card); }
  .hico.sm { width: 18px; height: 18px; border: 0; background: none; }
`;

/* ── the conversation surfaces: the head, the transcript, the wizard card, the unit row, the brief, the drafts ── */
const THREAD = `
  .thhead { height: 52px; min-height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 20px; flex: none; }
  .thhead .tt { font: 500 17.5px var(--fbody); letter-spacing: -.02em; color: var(--text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .thhead .tright { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; color: var(--muted); }
  .thhead .tright .ftutil { width: 30px; }
  .thscroll { flex: 1; min-height: 0; overflow: hidden; padding: 4px 20px 0; }
  .transcript { display: flex; flex-direction: column; gap: 2px; max-width: 1000px; margin: 0 auto; }
  .msg { display: flex; gap: 11px; padding: 7px 10px; border-radius: 6px; position: relative; }
  .msg .av { width: 26px; height: 26px; min-width: 26px; border-radius: 4px; display: grid; place-items: center; font-weight: 600; font-size: 11px; color: var(--body); background: var(--panel3); box-shadow: inset 0 0 0 1px var(--border2); }
  .msg .av.mkt { color: var(--role-mkt); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--role-mkt) 45%, var(--border2)); }
  .msg .av.orch { color: var(--role-orch); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--role-orch) 45%, var(--border2)); }
  .msg .body { min-width: 0; flex: 1; }
  .msg .head { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
  .msg .head b { font-size: 12.5px; color: var(--text); }
  .msg .time { font-size: 10.5px; color: var(--dim); }
  .rolechip { font: 500 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--muted); border: 1px solid var(--border); border-radius: 3px; padding: 1px 6px; }
  .rolechip.mkt { color: var(--role-mkt); border-color: color-mix(in srgb, var(--role-mkt) 40%, var(--border)); }
  .rolechip.orch { color: var(--role-orch); border-color: color-mix(in srgb, var(--role-orch) 40%, var(--border)); }
  .md { font-size: 14px; line-height: 1.55; color: var(--body); }
  .md p { margin: 0 0 6px; } .md p:last-child { margin-bottom: 0; }
  .md b { color: var(--text); font-weight: 600; }
  .md i { color: var(--body); }
  .md code { font: 500 12.5px var(--fmono); color: var(--text); background: color-mix(in srgb, var(--text) 6%, transparent); border-radius: 3px; padding: 1px 5px; }
  .md a { color: var(--link); text-decoration: none; border-bottom: 1px dotted color-mix(in srgb, var(--link) 55%, transparent); }
  .md ul { margin: 2px 0 6px; padding-left: 18px; } .md li { margin: 1px 0; }
  .msg.human .body { flex: 0 1 auto; max-width: min(640px, 82%); border: 1px solid var(--border); background: var(--panel); border-radius: 8px; padding: 7px 12px 8px; }
  .msg.mine { flex-direction: row-reverse; } .msg.mine .head { justify-content: flex-end; }
  .liveact { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); margin-top: 4px; }
  /* the wizard: one question at a time, the qcard skeleton */
  .qcard { border: 1px solid var(--card-border); background: var(--card); border-radius: 8px; padding: 11px 13px 12px; margin: 8px 0 2px; max-width: 520px; box-shadow: var(--shadow-card); }
  .qcard.mksetup { max-width: 560px; margin-top: 7px; }
  .qhead { font-size: 13px; font-weight: 600; line-height: 1.45; color: var(--text); margin-bottom: 8px; }
  .qcount { font: 600 10px var(--fmono); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); border-radius: 3px; padding: 1px 6px; margin-right: 8px; vertical-align: 1px; }
  .mkqopt { font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--dim); font-size: 10.5px; }
  .mkq { margin-top: 9px; }
  .mkqlabel { font: 500 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); margin: 10px 0 5px; }
  .mkrow { display: flex; align-items: center; gap: 9px; border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent); padding: 8px 2px; }
  .mkrow:last-child { border-bottom: 0; }
  .mkconnico { width: 22px; height: 22px; border-radius: 6px; background: var(--panel2); display: grid; place-items: center; font-size: 11px; font-weight: 600; color: var(--body); flex: none; }
  .mkconnname { font-size: 12px; font-weight: 600; color: var(--text); }
  .mkconnname .sub { font-weight: 500; color: var(--dim); font-size: 11px; margin-left: 6px; }
  .mkconnok { margin-left: auto; font-size: 10.5px; font-weight: 600; color: var(--done); }
  .mkrow .btn { margin-left: auto; }
  .repochip { display: inline-flex; align-items: center; gap: 7px; font: 500 12px var(--fmono); color: var(--text); border: 1px solid var(--border2); background: var(--panel2); border-radius: 6px; padding: 5px 10px; }
  .repochip .br { color: var(--dim); }
  .togrow { display: flex; align-items: center; gap: 10px; padding: 8px 2px; border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent); }
  .togrow:last-child { border-bottom: 0; }
  .togrow .lbl { font-size: 12.5px; font-weight: 500; color: var(--text); }
  .togrow .sub { display: block; font-size: 11px; color: var(--muted); margin-top: 1px; }
  .sw { margin-left: auto; width: 30px; height: 18px; border-radius: 999px; background: var(--panel3); border: 1px solid var(--border2); position: relative; flex: none; }
  .sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--dim); }
  .sw.on { background: color-mix(in srgb, var(--green) 30%, var(--panel3)); border-color: color-mix(in srgb, var(--green) 50%, var(--border2)); } .sw.on::after { left: 14px; background: var(--green); }
  .cb { margin-left: auto; width: 15px; height: 15px; border-radius: 3px; border: 1px solid var(--border2); display: grid; place-items: center; color: var(--green); font-size: 11px; flex: none; }
  .cb.on { border-color: var(--green); }
  .teamtag { font: 600 9px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--link); border: 1px solid color-mix(in srgb, var(--link) 45%, transparent); border-radius: 3px; padding: 1px 5px; margin-left: 6px; }
  .mkqfoot { display: flex; align-items: center; gap: 8px; margin-top: 13px; }
  /* the unit card: a TEXT row, id · title · state chip · the dial · the facts line */
  .unitcard { display: flex; flex-direction: column; gap: 4px; max-width: 560px; padding: 7px 0 2px; }
  .ucrow { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .ucid { font: 500 11px var(--fmono); color: var(--dim); }
  .ucti { font-size: 14px; font-weight: 500; color: var(--text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ucfacts { font: 500 10.5px var(--fmono); color: var(--dim); }
  /* the release brief card, the ArticleCard idiom: the object the human scans */
  .relcard { max-width: 740px; border: 1px solid var(--card-border); background: var(--card); border-radius: 8px; box-shadow: var(--shadow-card); margin: 8px 0 4px; overflow: hidden; }
  .relhd { display: flex; align-items: center; gap: 9px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
  .relk { display: inline-flex; align-items: center; gap: 6px; font: 600 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--muted); }
  .reltag { font: 500 11px var(--fmono); color: var(--text); border: 1px solid var(--border2); border-radius: 3px; padding: 1.5px 7px; }
  .reldate { font: 500 10.5px var(--fmono); color: var(--dim); }
  .relhd .chip { margin-left: auto; }
  .relbody { padding: 10px 12px 4px; }
  .reltitle { font: 500 15.5px/1.35 var(--fbody); letter-spacing: -.015em; color: var(--text); }
  .relwhy { font-size: 12.5px; line-height: 1.5; color: var(--body); margin-top: 5px; }
  .relrows { margin-top: 8px; border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
  .relrow { display: flex; gap: 10px; padding: 5px 0; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); font-size: 12px; line-height: 1.45; }
  .relrow:last-child { border-bottom: 0; }
  .relrow .k { flex: none; width: 82px; color: var(--muted); }
  .relrow .v { color: var(--body); min-width: 0; }
  .relrow .v a { color: var(--link); font: 500 11.5px var(--fmono); }
  .relrow .v .gap { color: var(--muted); font-style: italic; }
  .relfoot { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--border); }
  .relfoot .sp { flex: 1; }
  .relfoot .mono { font: 500 10.5px var(--fmono); color: var(--dim); }
  /* the drafts: one horizontal row of post cards, thread-native */
  .mkdrafts { margin: 6px 0 2px; padding-left: 47px; }
  .mkdraftsgrid { display: flex; gap: 10px; overflow: hidden; padding-bottom: 6px; }
  .mkdraftsgrid > .mkpostcard { flex: 0 0 280px; }
  .mkpostcard { border: 1px solid var(--card-border); background: var(--card); border-radius: 8px; overflow: hidden; }
  .mkpchd { display: flex; align-items: center; gap: 8px; padding: 7px 11px; border-bottom: 1px solid var(--border); }
  .mkpcnet { display: inline-flex; align-items: center; gap: 6px; font: 600 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--muted); }
  .mkpcg { font-size: 12px; color: var(--text); }
  .mkpcid { font: 600 10px var(--fmono); color: var(--dim); border: 1px solid var(--border2); border-radius: 3px; padding: 1.5px 6px; }
  .mkpchd .chip { margin-left: auto; }
  .mkpv { padding: 11px 12px; }
  .mkpvhead { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; color: var(--text); }
  .mkpvav { width: 30px; height: 30px; border-radius: 50%; background: var(--panel3); border: 1px solid var(--border2); display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px; flex: none; }
  .mkpvav.grad { background: linear-gradient(135deg, color-mix(in srgb, var(--violet) 45%, var(--panel3)), color-mix(in srgb, var(--warm) 45%, var(--panel3))); }
  .mkpvhandle { color: var(--dim); font-size: 12px; }
  .mkpvtext { font-size: 12.5px; line-height: 1.5; color: var(--text); white-space: pre-wrap; }
  .mkpvtext code { font: 500 11.5px var(--fmono); }
  .mkpcimg { display: block; width: 100%; height: 118px; margin-top: 10px; border: 1px solid var(--border); border-radius: 6px; background: #161616; position: relative; overflow: hidden; }
  .mkpcimg .rc { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; padding: 12px 14px; color: #cbcbcb; background: radial-gradient(120% 90% at 100% 0%, rgba(131,74,43,.35), transparent 60%); }
  .mkpcimg .rcv { font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: #a6a6a6; }
  .mkpcimg .rct { font: 500 19px/1.1 var(--fbody); letter-spacing: -.03em; color: #eaeaea; margin-top: 3px; }
  .mkpcimg .rcm { position: absolute; top: 12px; left: 14px; width: 14px; height: 14px; border-radius: 3px; background: #834a2b; }
  .mkpcimg.tall { height: 118px; }
  .mkpcbrief { display: flex; align-items: flex-start; gap: 6px; padding: 7px 11px; border-top: 1px dashed var(--border2); font-size: 11px; line-height: 1.45; color: var(--muted); background: color-mix(in srgb, var(--text) 3%, transparent); }
  .mkpcbriefk { color: var(--text); opacity: .72; }
  .mkpcfoot { display: flex; align-items: center; gap: 10px; padding: 7px 11px; border-top: 1px solid var(--border); }
  .mkpccc { font: 600 10px var(--fmono); color: var(--dim); }
  .mkpcactions { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  .mkico { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 3px; border: 1px solid transparent; border-radius: 4px; color: var(--dim); }
  /* the composer */
  .composer { padding: 8px 20px 12px; flex: none; }
  .cbox { max-width: 1000px; margin: 0 auto; border: 1px solid var(--border); background: var(--card); border-radius: 6px; padding: 9px 12px; box-shadow: var(--shadow-card); }
  .cbox .ph { font-size: 14px; color: var(--dim); }
  .cfoot { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
  .cfoot .pill { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 3px; border: 1px solid var(--border); font: 500 11px var(--fmono); color: var(--muted); }
  .cfoot .send { margin-left: auto; width: 28px; height: 28px; border-radius: 50%; background: var(--brand); color: var(--brand-ink); display: grid; place-items: center; font-size: 14px; }
  /* Routines: the destination's cards */
  .rtview { flex: 1; min-height: 0; overflow: hidden; padding: 0 18px; }
  .rtinner { max-width: 1120px; margin: 0 auto; display: flex; flex-direction: column; }
  .scopebar { display: flex; align-items: center; gap: 10px; padding: 14px 0 2px; margin-bottom: 10px; }
  .wfsearch { display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 0 16px; background: var(--card); border: 1px solid var(--card-border); border-radius: 8px; color: var(--muted); box-shadow: var(--shadow-card); flex: 1; min-width: 0; font-size: 13.5px; }
  .wfsearch span { color: var(--dim); }
  .cchip { display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 16px; border-radius: 8px; font-size: 13.5px; font-weight: 600; white-space: nowrap; background: var(--card); border: 1px solid var(--card-border); box-shadow: var(--shadow-card); color: var(--body); }
  .cchip .car { font-size: 10px; opacity: .7; }
  .rtgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
  .rtcard { background: var(--card); border: 1px solid var(--card-border); border-radius: 8px; box-shadow: var(--shadow-card); padding: 12px 14px 10px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .rtcard.open { grid-row: span 2; }
  .rt1 { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .rtglyph { width: 26px; height: 26px; border-radius: 6px; background: var(--panel2); border: 1px solid var(--border); display: grid; place-items: center; color: var(--muted); flex: none; }
  .rtt { font-size: 14px; font-weight: 500; color: var(--text); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rtcad { font: 500 11px var(--fmono); color: var(--muted); }
  .rtcad .due { color: var(--warn); font-weight: 600; }
  .rtprompt { font-size: 12.5px; color: var(--muted); line-height: 1.45; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .rtroom { font: 500 10px var(--fmono); color: var(--dim); }
  .rtfoot { display: flex; align-items: center; gap: 6px; padding-top: 8px; border-top: 1px solid var(--border); margin-top: 2px; }
  .rtledger { display: inline-flex; align-items: center; gap: 5px; font: 500 11px var(--fmono); color: var(--dim); }
  .rtledger.on { color: var(--muted); }
  .rtacts { margin-left: auto; display: inline-flex; gap: 2px; }
  .rtacts .mkico { width: 24px; height: 24px; }
  .rtruns { display: flex; flex-direction: column; margin-top: 2px; border-top: 1px solid var(--border); padding-top: 6px; }
  .rtrun { display: flex; align-items: center; gap: 9px; padding: 7px 4px; border-radius: 6px; min-width: 0; }
  .rtrun.quiet { opacity: .7; }
  .rtrun .rw { flex: none; width: 92px; font: 500 10.5px var(--fmono); color: var(--dim); }
  .rtrun .rt { flex: 1; min-width: 0; font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rtrun.quiet .rt { color: var(--muted); font-style: italic; }
  .rtrun .rf { font: 500 10.5px var(--fmono); color: var(--dim); white-space: nowrap; }
  .rtrun .go { font: 600 11px var(--fbody); color: var(--link); white-space: nowrap; }
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
  workbench: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="12" y="8" width="6" height="8" rx="1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><path d="m21 16-5-5-8 8"/>',
  reply: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  gh: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  x: '<path d="M5 4l14 16"/><path d="M19 4l-4.9 5.6"/><path d="M9.9 14.4 5 20"/>',
  linkedin: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M7.6 10.8V16.2"/><circle cx="7.6" cy="7.6" r="1" fill="currentColor" stroke="none"/><path d="M11.4 16.2v-5.4"/><path d="M11.4 13.2a2.6 2.6 0 0 1 5.2 0v3"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r=".9" fill="currentColor" stroke="none"/>',
  tiktok: '<path d="M13.5 4v10.2a3.3 3.3 0 1 1-3.3-3.3"/><path d="M13.5 4c.5 2.5 2.2 4.1 4.8 4.4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  apple: '<path d="M16.5 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.9-1.4-.1-2.8.9-3.5.9-.7 0-1.9-.8-3.1-.8-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.5.8 1.2 1.7 2.5 3 2.4 1.2 0 1.6-.8 3.1-.8s1.8.8 3.1.8c1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.7-1-2.7-3.9zM14.2 5.6c.6-.8 1.1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3z"/>',
};
const svg = (k, s, sw = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${G[k]}</svg>`;
const kebab = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.4" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="18.6" r="1.7"/></svg>`;
const dial = (frac, s = 18) => { const r = s / 2 - 2; const c = 2 * Math.PI * r; return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true" style="transform:rotate(-90deg)"><circle class="track" cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke-width="2.2"/><circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="${(frac * c).toFixed(1)} ${c.toFixed(1)}"/></svg>`; };

/* ── the frame: top, rail, foot ── */
const frametop = () => `<div class="ftop">
  <span class="ftfold">${svg('sidebar', 15)}</span><span class="ftbrand">neuramesh</span>
  <span class="ftsearch">${svg('search', 13)}<span>Search or jump to…</span><b>⌘K</b></span>
  <span class="ftutils"><span class="ftutil">${svg('code', 14)}</span><span class="ftutil">${svg('globe', 14)}</span><span class="ftutil">${svg('term', 14)}</span></span>
  <span class="ftsync"><i></i>Synced</span>
  <span class="ftutil">${svg('bell', 15)}<span class="belln">3</span></span>
  <span class="ftutil">${kebab(15)}</span>
</div>`;
const railGlyph = (k) => k === 'chat' ? svg('threads', 13) : k === 'routine' ? svg('clock', 13) : k === 'wait' ? svg('circle', 13) : k === 'active' ? '<span class="dot" style="color: var(--prog)"></span>' : svg('check', 13);
const railRow = (r) => `<div class="navhistrow${r.on ? ' on' : ''}"><span class="navhistglyph">${railGlyph(r.k)}</span><span class="navhisttitle">${r.num ? `<b>${r.num}</b>` : ''}${r.t}</span>${r.st ? `<span class="navhiststat ${r.st}">${r.st === 'ny' ? 'needs you' : 'in progress'}</span>` : `<span class="navhistfact">${r.when}</span>`}</div>`;
const railFolder = (name, rows, { folded = false, ask = false } = {}) => `<div class="navgrp"><div class="navgrprow"><span class="navhistglyph">${svg(folded ? 'folder' : 'folderopen', 14)}</span><span class="navgrpname">${name}</span><span class="navhisttrail">${folded && ask ? '<span class="navhistask"></span>' : ''}${folded ? `<span class="navhistfact">${rows.length}</span>` : ''}<span class="navgrpchev${folded ? ' c' : ''}">${svg('chevron', 12)}</span></span></div>${folded ? '' : rows.map(railRow).join('')}</div>`;
const foot = `<div class="navfoot"><span class="wstile">G<i></i></span><span class="wsname">GADS INC</span><span class="navhistglyph">${svg('chevron', 12)}</span><svg class="credring" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8.5" fill="none" stroke="var(--panel3)" stroke-width="3"/><circle cx="11" cy="11" r="8.5" fill="none" stroke="var(--green)" stroke-width="3" stroke-dasharray="40 53.4" stroke-linecap="round" transform="rotate(-90 11 11)"/></svg></div>`;
const rail = ({ dest = null, on = null } = {}) => `<div class="nav">
  <div class="navseg"><span class="on">Chat</span><span>Code</span></div>
  <div class="navnew"><span class="row">${svg('compose', 15)}New chat<span class="kbd">⌘N</span></span><span class="caret">${svg('chevron', 14)}</span></div>
  <div class="navsect"><span class="chev">${svg('chevron', 10)}</span>Shortcuts</div>
  <div class="navdest">
    <div class="navitem">${svg('whiteboard', 15)}<span class="navlabel">Whiteboards</span></div>
    <div class="navitem navparent">${svg('repeat', 15)}<span class="navlabel">Scheduled</span><span class="navitembadge">5</span><span class="chev">${svg(dest === 'routines' ? 'chevron' : 'chevr', 12)}</span></div>
    ${dest === 'routines' ? `<div class="navitem child on">${svg('clock', 13)}<span class="navlabel">Routines</span></div><div class="navitem child">${svg('calendar', 13)}<span class="navlabel">Calendar</span></div>` : ''}
    <div class="navitem">${svg('library', 15)}<span class="navlabel">Files</span></div>
    <div class="navitem">${svg('trend', 15)}<span class="navlabel">Marketing OS</span></div>
    <div class="navitem">${svg('code', 15)}<span class="navlabel">Code</span></div>
  </div>
  <div class="navlist">
    <div class="navgrphd"><span class="navprojchev">${svg('chevron', 12)}</span><span class="navgrphdlbl door">Recents</span><span class="navgrphdsep">·</span><span class="navgrphdlbl">Projects</span><span class="navgrphdcnt">3</span><span class="navscopegrow"></span><span class="navhistfind">${svg('search', 13)}</span></div>
    ${railFolder('neuramesh', [
      { k: 'routine', t: 'Release drafts · v0.137.0', st: 'ny', on: on === 'release' },
      { k: 'active', t: 'AI harness reply radar', st: 'ip' },
      { k: 'routine', t: 'Release drafts · v0.136.0', when: '1d' },
      { k: 'done', t: 'Week-one X drafts', when: '4d' },
      { k: 'chat', t: 'Competitor scan', when: '5d' },
    ])}
    ${railFolder('flowe-ai', [
      { k: 'wait', num: 1093, t: 'Draft Flowe X calendar for Sep 14 to 20', st: 'ny' },
      { k: 'routine', t: 'Routine · Research flowe', when: '1d' },
      { k: 'chat', t: 'Flowe launch plan', when: '12d' },
    ])}
    ${railFolder('ai-demos', [
      { k: 'wait', num: 1059, t: 'Set up your marketing HQ', st: 'ny', on: on === 'setup' },
      { k: 'chat', t: 'Give me ideas', when: '2w' },
    ])}
  </div>
  ${foot}
</div>`;
const frame = (theme, inner, opts = {}) => `<div class="frame" style="${tokens(THEMES[theme])}">${frametop()}<div class="fbody">${rail(opts)}<div class="sheet">${inner}</div></div></div>`;

/* ── the sheet's pieces ── */
const thhead = (title, chips, right = true) => `<div class="thhead"><span class="tt">${title}</span>${chips}${right ? `<span class="tright"><span class="ftutil">${svg('workbench', 15)}</span><span class="ftutil">${kebab(15)}</span></span>` : ''}</div>`;
const av = (who) => who === 'rex' ? '<span class="av orch">R</span>' : who === 'plume' ? '<span class="av mkt">P</span>' : '<span class="av">G</span>';
const head = (who, time, extra = '') => who === 'rex' ? `<div class="head"><b>rex</b><span class="rolechip orch">orchestrator</span>${extra}<span class="time">${time}</span></div>`
  : who === 'plume' ? `<div class="head"><b>plume</b><span class="rolechip mkt">marketer</span>${extra}<span class="time">${time}</span></div>`
  : `<div class="head"><b>George</b>${extra}<span class="time">${time}</span></div>`;
const msg = (who, time, body, { human = false, extra = '' } = {}) => `<div class="msg${human ? ' human mine' : ''}">${human ? '' : av(who)}<div class="body">${head(who, time, extra)}${body}</div></div>`;
const composer = (ph, pills) => `<div class="composer"><div class="cbox"><div class="ph">${ph}</div><div class="cfoot">${pills.map((p) => `<span class="pill">${p}</span>`).join('')}<span class="send">↑</span></div></div></div>`;


/* ── this round's card pieces: the caption, the folded script, the film, the facts line, the states ── */
const CARD = `
  .mkscript { cursor: pointer; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); }
  .mkscript .mkpvtext { color: var(--muted); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .mkscriptmore { display: block; margin-top: 4px; font: 500 11px var(--fmono); color: var(--link); letter-spacing: .02em; }
  .mkpcfilm { margin: 10px 0 2px; width: 100%; aspect-ratio: 9 / 16; max-height: 300px; border-radius: 6px; background: linear-gradient(160deg, #1b2532, #0c1017 60%, #1a1410); position: relative; overflow: hidden; display: grid; place-items: center; }
  .mkpcfilm .play { width: 34px; height: 34px; border-radius: 50%; background: rgba(255,255,255,.14); display: grid; place-items: center; color: #fff; }
  .mkpcfilm .bar { position: absolute; left: 10px; right: 10px; bottom: 10px; height: 3px; border-radius: 3px; background: rgba(255,255,255,.22); }
  .mkpcfilm .bar i { display: block; width: 18%; height: 100%; border-radius: 3px; background: #fff; }
  .mkpcfilm .tc { position: absolute; left: 12px; bottom: 20px; font: 500 11px var(--fmono); color: #fff; opacity: .85; }
  .mkpcfilm .shape { position: absolute; width: 120px; height: 200px; border-radius: 14px; border: 1.5px solid rgba(255,255,255,.35); top: 40px; }
  .mkpcfilmwait { margin: 10px 0 2px; border: 1px dashed var(--border2); border-radius: 6px; padding: 14px 12px; display: grid; gap: 8px; color: var(--muted); font-size: 12.5px; }
  .mkpcfilmwait b { color: var(--text); font-weight: 500; }
  .mkpcfilmwait .prog { height: 3px; border-radius: 3px; background: var(--panel3); overflow: hidden; }
  .mkpcfilmwait .prog i { display: block; height: 100%; width: 38%; background: var(--link); border-radius: 3px; }
  .mkpcbrief.video svg { color: var(--muted); }
  .mkpcsetup { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; padding: 10px 12px; border-top: 1px dashed var(--border); font-size: 12.5px; color: var(--body); }
  .mkpcsetup b { font-weight: 500; color: var(--text); }
  .mkpcsetup.err { background: color-mix(in srgb, var(--warn) 7%, transparent); }
  .mkpcsetup .btn { margin-left: 0; }
  .mkpcfacts { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; font: 500 10.5px var(--fmono); letter-spacing: -.01em; color: var(--muted); }
  .mkpcfactsrow { padding: 6px 11px 0; }
  .mkpcfoot { flex-wrap: wrap; gap: 6px 10px; }
  .mkpcdo { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .mkpcfacts i { width: 3px; height: 3px; border-radius: 50%; background: var(--dim); }
  .mkpcfacts .cr { color: var(--link); }
  .mkpcimg.filmposter { aspect-ratio: 9 / 16; }
  .btn.sm.off { opacity: .55; }
  .twocol { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 14px 18px; }
  .twocol .mkpostcard { margin: 0; }
  .twocol.three { grid-template-columns: 1fr 1fr 1fr; }
  .twocol.three .mkpcfilm { max-height: 210px; }
  .sectlbl { font: 500 10.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--muted); padding: 14px 18px 0; }
`;

const CAPTION = 'A small but real UX fix: the session list on NeuraMesh mobile now loads in pages while you scroll, instead of one large load. My phone stopped heating up during long scroll sessions. #neuramesh';
const SCRIPT = '[0:00-0:04] Direction: Handheld, phone in hand, slight grimace. Spoken: "My phone used to get so hot scrolling my session list."<br>[0:04-0:12] Screen record: the session list on the phone, a long scroll, no stutter. Spoken: "Now it loads in pages while I scroll."<br>[0:12-0:20] Direction: back to camera. Spoken: "Small fix. My phone thanks them."';
const BRIEF = 'Vertical 9:16. Direct-to-camera cold open. Cut to one continuous screen recording of the session list. Return to camera for the close. Bottom third clear for a caption.';

const facts = (parts) => `<span class="mkpcfacts">${parts.map((p, i) => `${i ? '<i></i>' : ''}${p}`).join('')}</span>`;
const videoCard = ({ letter = 'd', state, theme = 'graphite' }) => {
  const filmRow = state === 'wait'
    ? `<div class="mkpcfilmwait"><b>Filming on NeuraMesh Video Starter (Seedance 2.0)</b><span>About two minutes. The film lands on this card, and you can leave the page.</span><div class="prog"><i></i></div></div>`
    : state === 'done' || state === 'google'
      ? `<div class="mkpcfilm"><span class="shape"></span><span class="play">${svg('play', 16)}</span><span class="tc">0:01</span><span class="bar"><i></i></span></div>`
      : '';
  const briefRow = `<div class="mkpcbrief video">${svg('play', 13, 1.8)}<span><span class="mkpcbriefk">${state === 'done' || state === 'google' ? 'shot direction' : 'needs video'}</span> · ${BRIEF}</span></div>`;
  // the rows say WHY; every button lives in the foot (George: "align the buttons at the bottom")
  const why = state === 'nocredits'
    ? `<div class="mkpcsetup err"><b>Out of credits.</b> A film costs about 194 credits. Add credits, or add a Google AI key under Image generation and the film runs on your key.</div>`
    : state === 'nolane' ? `<div class="mkpcsetup err"><b>Video didn’t generate.</b> Video is not set up here. Add a Google AI key under Image generation to film on your own key.</div>` : '';
  const factsRow = state === 'before' ? `<div class="mkpcfactsrow">${facts(['NeuraMesh Video Starter', 'Seedance 2.0', '8 s', '<span class="cr">about 194 credits</span>', '2 min'])}</div>`
    : state === 'done' ? `<div class="mkpcfactsrow">${facts(['NeuraMesh Video Starter', 'Seedance 2.0', '8 s', '<span class="cr">194 credits</span>', '09:14'])}</div>`
    : state === 'google' ? `<div class="mkpcfactsrow">${facts(['Gemini Omni Flash', '8 s', 'your key', 'no credits', '09:14'])}</div>` : '';
  const doBtns = state === 'before' ? `<span class="btn sm">Generate video</span>`
    : state === 'wait' ? `<span class="btn sm off">Filming…</span>`
    : state === 'done' || state === 'google' ? `<span class="btn sm">Film again</span>`
    : state === 'nocredits' ? `<span class="btn sm">Try again</span><span class="btn sm">Add credits →</span><span class="btn sm">Add a Google key →</span>`
    : `<span class="btn sm">Try again</span><span class="btn sm">Add a Google key →</span>`;
  return `<div class="mkpostcard">
  <div class="mkpchd"><span class="mkpcnet"><span class="mkpcg">𝕏</span>X</span><span class="mkpcid">draft ${letter} · v2</span><span class="chip mk-draft">draft</span></div>
  <div class="mkpv">
    <div class="mkpvhead"><span class="mkpvav">M</span><b>marketing</b><span class="mkpvhandle">· draft</span></div>
    <div class="mkpvtext">${CAPTION}</div>
    <div class="mkscript"><div class="mkpvtext">${SCRIPT}</div><span class="mkscriptmore">the script ›</span></div>
    ${filmRow}
  </div>
  ${briefRow}
  ${why}
  ${factsRow}
  <div class="mkpcfoot"><span class="mkpcdo">${doBtns}</span><span class="mkpccc">216/280</span><span class="mkpcactions"><span class="mkico">${svg('reply', 13)}</span><span class="btn sm">Review · schedule ↗</span></span></div>
</div>`;
};
G.play = '<path d="M7 4.5v15l12-7.5z"/>';

const sessionHead = () => thhead('Release drafts · v0.137.0', `<span class="routinechip">${svg('clock', 10)}routine</span><span class="roomchip">#marketing · neuramesh</span><span class="chip st-ny">needs you</span>`);
const askMsg = (state) => state === 'wait'
  ? msg('george', '09:12', `<div class="md"><p>Film the hook for draft d.</p></div>`, { human: true }) + msg('plume', '09:12', `<div class="md"><p>Filming the hook on Seedance 2.0. It takes about two minutes and costs about 194 credits. The film lands on the card.</p></div>`)
  : state === 'done'
    ? msg('george', '09:12', `<div class="md"><p>Film the hook for draft d.</p></div>`, { human: true }) + msg('plume', '09:14', `<div class="md"><p>Filmed the hook on Seedance 2.0. An eight-second cut is on the card, 194 credits. Nothing publishes until you approve.</p></div>`)
    : msg('plume', '09:07', `<div class="md"><p>Done, a to f revised in place. The script now lives in its own field and the shot direction is the brief. Captions kept.</p></div>`);
const cardSheet = (state, theme) => `${sessionHead()}
<div class="thscroll"><div class="transcript">
  ${askMsg(state)}
  <div class="mkdrafts"><div class="mkdraftsgrid">${videoCard({ state, theme })}</div></div>
</div></div>
${composer('Reply to plume…', ['#marketing', 'Brain · Claude Core'])}`;

/* C · the states side by side: out of credits, and the fallback on the person's own Google key */
const statesSheet = () => `${sessionHead()}
<div class="thscroll"><div class="transcript">
  <div class="sectlbl">When the lane cannot film · the same card, three answers: out of credits · the own-key fallback · no credits and no key</div>
  <div class="twocol three">${videoCard({ state: 'nocredits', letter: 'e' })}${videoCard({ state: 'google', letter: 'e' })}${videoCard({ state: 'nolane', letter: 'f' })}</div>
</div></div>
${composer('Reply to plume…', ['#marketing', 'Brain · Claude Core'])}`;

/* D · where the spend shows: Settings › Connections › Image generation, and the credits history */
const SETTINGS = `
  .stg { padding: 18px 28px; display: grid; gap: 18px; max-width: 760px; }
  .stgcard { border: 1px solid var(--card-border); border-radius: 8px; background: var(--card); box-shadow: var(--shadow-card); }
  .stgcard h3 { margin: 0; padding: 12px 16px; font: 500 13px var(--fbody); color: var(--text); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
  .stgcard h3 small { font: 500 10.5px var(--fmono); text-transform: uppercase; letter-spacing: -.02em; color: var(--muted); margin-left: auto; }
  .stgrow { display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 12px; padding: 11px 16px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--body); }
  .stgrow:last-child { border-bottom: 0; }
  .stgrow .k { color: var(--text); font-weight: 500; }
  .stgrow .sub { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; }
  .stgrow .st { font: 500 10.5px var(--fmono); text-transform: uppercase; letter-spacing: -.02em; color: var(--green); }
  .stgrow .st.off { color: var(--muted); }
  .stgrow .g { color: var(--muted); display: grid; place-items: center; }
  .stgrow .btn.sm { justify-self: end; }
  .stgtiers { display: grid; gap: 6px; padding: 4px 16px 14px 50px; }
  .stgtier { display: grid; gap: 1px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel2); color: var(--muted); }
  .stgtier b { font-weight: 500; color: var(--text); font-size: 12.5px; }
  .stgtier span { font: 500 10.5px var(--fmono); letter-spacing: -.01em; }
  .stgtier.on { border-color: var(--link); background: color-mix(in srgb, var(--link) 8%, var(--panel2)); }
  .crhist { display: grid; }
  .crrow { display: grid; grid-template-columns: 84px 1fr auto; gap: 14px; padding: 9px 16px; border-bottom: 1px solid var(--border); font-size: 12.5px; color: var(--body); align-items: baseline; }
  .crrow:last-child { border-bottom: 0; }
  .crrow .d { font: 500 10.5px var(--fmono); color: var(--muted); }
  .crrow .n { font: 500 11px var(--fmono); color: var(--text); }
  .crrow .n.plus { color: var(--green); }
  .crrow .w { color: var(--text); }
  .crrow .w small { color: var(--muted); margin-left: 6px; }
  .crbal { display: flex; align-items: baseline; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
  .crbal b { font: 500 26px var(--fbrand); color: var(--text); letter-spacing: -.02em; }
  .crbal span { color: var(--muted); font-size: 12.5px; }
`;
const settingsSheet = () => `<div class="topbar">Connections<span class="desc">what this workspace can reach</span></div>
<div class="stg">
  <div class="stgcard"><h3>Image generation<small>BYOK</small></h3>
    <div class="stgrow"><span class="g">${svg('image', 15)}</span><span><span class="k">OpenAI image key</span><span class="sub">gpt-image-2, the pictures on your cards</span></span><span class="st">connected</span></div>
    <div class="stgrow"><span class="g">${svg('image', 15)}</span><span><span class="k">Google AI key</span><span class="sub">Nano Banana pictures. Films on Gemini Omni Flash when the credits are out.</span></span><span class="st off">not set</span></div>
    <div class="stgrow"><span class="g">${svg('play', 15)}</span><span><span class="k">Video</span><span class="sub">NeuraMesh films video posts on the tier you pick. Your Google key is the fallback when the credits are out.</span></span><span class="st">on credits</span></div>
    <div class="stgtiers" role="radiogroup" aria-label="Video tier">
      <div class="stgtier on"><b>NeuraMesh Video Starter</b><span>Seedance 2.0 · 8 s · 194 credits a film</span></div>
      <div class="stgtier"><b>NeuraMesh Video Xpress</b><span>MiniMax H3 · 8 s · 48 credits a film</span></div>
      <div class="stgtier"><b>NeuraMesh Video Premium</b><span>Seedance 2.0 Standard · 8 s · 243 credits a film</span></div>
    </div>
  </div>
  <div class="stgcard"><h3>Credits<small>this month</small></h3>
    <div class="crbal"><b>306</b><span>credits left of 500 · refills on the 1st</span><span class="btn sm" style="margin-left:auto">Add credits →</span></div>
    <div class="crhist">
      <div class="crrow"><span class="d">today 09:14</span><span class="w">Video · NeuraMesh Video Starter<small>Seedance 2.0 · draft d · 8 s</small></span><span class="n">−194</span></div>
      <div class="crrow"><span class="d">today 08:40</span><span class="w">Starter brain<small>2 replies · 31k tokens</small></span><span class="n">−1</span></div>
      <div class="crrow"><span class="d">yesterday</span><span class="w">Video · NeuraMesh Video Starter<small>Seedance 2.0 · draft a · failed, refunded</small></span><span class="n plus">+194</span></div>
      <div class="crrow"><span class="d">yesterday</span><span class="w">Video · NeuraMesh Video Starter<small>Seedance 2.0 · draft a · 8 s</small></span><span class="n">−194</span></div>
      <div class="crrow"><span class="d">Sep 1</span><span class="w">Monthly grant<small>Team · 1 seat</small></span><span class="n plus">+500</span></div>
    </div>
  </div>
</div>`;

/* E · how it runs */
const DIAG = `
  .diag { box-sizing: border-box; width: ${W}px; height: ${H}px; background: #141414; color: #cbcbcb; font: 14px/1.4 'Geist', sans-serif; padding: 26px 32px; position: relative; overflow: hidden; }
  .diag * { box-sizing: border-box; }
  .dtitle { font: 500 10.5px 'Geist Mono', monospace; letter-spacing: -.02em; text-transform: uppercase; color: #848484; margin-bottom: 8px; }
  .diag svg { display: block; width: 1376px; height: auto; }
  .diag text { font-family: 'Geist', sans-serif; fill: #cbcbcb; }
  .diag .k { font-family: 'Geist Mono', monospace; font-size: 10.5px; letter-spacing: -.02em; text-transform: uppercase; fill: #848484; }
  .diag .t { font-size: 13.5px; font-weight: 500; fill: #e0e0e0; }
  .diag .s { font-size: 11.5px; fill: #a6a6a6; }
  .diag .l { font-family: 'Geist Mono', monospace; font-size: 10.5px; fill: #848484; }
  .diag .lane { fill: none; stroke: #2c2c2c; stroke-dasharray: 4 5; }
  .diag .bx { fill: #1e1e1e; stroke: #3a3a3a; }
  .diag .bx.h { fill: #2a1d14; stroke: #834a2b; }
  .diag .bx.q { fill: #171717; stroke: #2c2c2c; }
  .diag .bx.env { fill: #14201a; stroke: #2f6b4b; }
  .diag .ar { stroke: #848484; fill: none; stroke-width: 1.4; }
  .diag .ar.d { stroke-dasharray: 5 4; }
`;
const box = (x, y, w, h, t, s, cls = '') => `<rect class="bx ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/><text class="t" x="${x + 12}" y="${y + 24}">${t}</text>${s ? `<text class="s" x="${x + 12}" y="${y + 43}">${s}</text>` : ''}`;
const ar = (d, label, lx, ly, cls = '') => `<path class="ar ${cls}" d="${d}" marker-end="url(#ah)"/>${label ? `<text class="l" x="${lx}" y="${ly}">${label}</text>` : ''}`;
const archBoard = () => `<div class="diag"><div class="dtitle">The video rung · how it runs · the card on your machine, the film on our server, the key never leaves it</div>
<svg viewBox="0 0 1376 930" role="img" aria-label="The card's Generate video posts a marker; the daemon asks the control-api's film door; the door checks the balance first, prices the clip, debits, submits to fal's queue and answers 202 with a films row; the minute cron polls the queue, downloads the clip, hosts it through the media lane and stamps the draft; a failure refunds the credits and lands on the card. The model comes from one env variable on the server.">
  <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#848484"/></marker></defs>
  <rect class="lane" x="0" y="0" width="1376" height="250" rx="8"/>
  <text class="k" x="14" y="22">On your machine · the app and the daemon · no key, no polling</text>
  ${box(20, 50, 230, 60, 'The video card', 'Generate video · facts line names the model and the credits')}
  ${ar('M250 80 H325', '‹gen-video›', 256, 70)}
  ${box(330, 50, 250, 60, 'The daemon wake', 'model-free · reads the script and the brief')}
  ${ar('M455 110 V160', 'the film prompt', 462, 140)}
  ${box(330, 165, 250, 60, 'The rung', 'starter first · own Google key when 402 · the card says which', 'h')}
  ${ar('M580 195 H700', 'POST /v1/starter/film', 590, 185)}
  ${box(705, 165, 250, 60, 'The card, pending', 'video_pending on the row · survives a reload', 'q')}
  ${box(1000, 50, 356, 60, 'Own Google key (unchanged)', 'Gemini Omni Flash → Veo 3.1 · films on the machine · no credits', 'q')}
  ${ar('M580 80 H995', 'when the door answers 402 or 503', 640, 70, 'd')}

  <rect class="lane" x="0" y="280" width="1376" height="640" rx="8"/>
  <text class="k" x="14" y="302">On our server · the control-api · FAL_KEY and the model list live here</text>
  ${box(20, 330, 250, 60, 'POST /v1/starter/film', 'member gate · the Starter brain’s twin', 'h')}
  ${ar('M270 360 H345', '', 0, 0)}
  ${box(350, 330, 220, 60, 'Balance guard FIRST', 'remaining ≤ 0 → 402 NO_CREDITS')}
  ${ar('M570 360 H645', '', 0, 0)}
  ${box(650, 330, 230, 60, 'Price the clip', 'per-second table · micros · 194 credits')}
  ${ar('M880 360 H955', '', 0, 0)}
  ${box(960, 330, 200, 60, 'Debit', 'ledger.spend · kind video')}
  ${ar('M1060 390 V440', '', 0, 0)}
  ${box(960, 445, 396, 60, 'Submit to fal · queue.fal.run/{endpoint}', 'Authorization: Key FAL_KEY · 9:16 · 8 s · audio on → request_id')}
  ${ar('M960 475 H890', '', 0, 0)}
  ${box(650, 445, 235, 60, 'films row · 202', 'workspace · item · model · request · micros · queued')}
  ${box(20, 445, 250, 60, 'STARTER_VIDEO_MODELS', 'seedance-2.0-fast, kling-3.0, minimax-h3 · the rest are fallbacks', 'env')}
  ${ar('M270 475 H345', 'first = active', 276, 465)}
  ${box(350, 445, 220, 60, 'The registry', 'key → fal endpoint, inputs, price, label')}
  ${ar('M570 475 H645', '', 0, 0)}

  ${box(20, 560, 250, 60, 'Minute cron · /internal/films-due', 'the announce cron’s shape', 'h')}
  ${ar('M270 590 H345', 'open rows', 282, 580)}
  ${box(350, 560, 220, 60, 'GET …/status', 'IN_QUEUE · IN_PROGRESS · COMPLETED')}
  ${ar('M570 590 H645', 'COMPLETED', 585, 580)}
  ${box(650, 560, 235, 60, 'Download the mp4', '8 MB cap · sniffed video/mp4')}
  ${ar('M885 590 H955', '', 0, 0)}
  ${box(960, 560, 396, 60, 'attachContentMedia · video_id on the draft', 'the picture’s lane · members-only read · video_pending cleared', 'h')}
  ${ar('M1158 620 V670', '', 0, 0)}
  ${box(960, 675, 396, 60, 'The card shows the film', 'Film again · the facts line: model, seconds, credits', 'q')}
  ${ar('M460 620 V670', 'error · timeout · refused', 468, 650, 'd')}
  ${box(350, 675, 220, 60, 'Refund', 'credit_grants kind refund · +194', 'q')}
  ${ar('M570 705 H645', '', 0, 0, 'd')}
  ${box(650, 675, 235, 60, 'video_error on the draft', 'Try again on the card', 'q')}
  ${box(20, 790, 640, 60, 'Also: GET /v1/starter/video', 'the active model, its label, seconds and credits · the card’s facts line and the Settings line read it', 'q')}
  ${box(700, 790, 656, 60, 'Credits history', 'films are rows in machine_usage.video_micros and the grant ledger, one per clip, refunds beside them', 'q')}
</svg></div>`;

/* F · the options */
const OPTS = `
  .opts { box-sizing: border-box; width: ${W}px; height: ${H}px; background: #141414; color: #cbcbcb; font: 14px/1.45 'Geist', sans-serif; padding: 26px 32px; overflow: hidden; }
  .opts * { box-sizing: border-box; }
  .otitle { font: 500 10.5px 'Geist Mono', monospace; letter-spacing: -.02em; text-transform: uppercase; color: #848484; margin-bottom: 12px; }
  .ogrid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 22px; }
  .otab { border: 1px solid #2c2c2c; border-radius: 8px; background: #1a1a1a; overflow: hidden; }
  .otab h3 { margin: 0; padding: 9px 14px; font: 500 12px 'Geist Mono', monospace; letter-spacing: -.02em; text-transform: uppercase; color: #cbcbcb; border-bottom: 1px solid #2c2c2c; display: flex; gap: 10px; }
  .otab h3 span { color: #848484; font-weight: 400; text-transform: none; letter-spacing: 0; font-family: 'Geist', sans-serif; font-size: 12px; }
  .orow { display: grid; grid-template-columns: 26px 200px 1fr 84px; gap: 10px; align-items: start; padding: 8px 14px; border-bottom: 1px solid #262626; font-size: 12.5px; }
  .orow:last-child { border-bottom: 0; }
  .orow .m { width: 14px; height: 14px; border-radius: 3px; border: 1px solid #3a3a3a; margin-top: 3px; display: grid; place-items: center; font-size: 10px; color: #77ac8d; }
  .orow.on .m { border-color: #834a2b; background: #2a1d14; color: #d19a72; }
  .orow.on { background: #1e1e1e; }
  .orow b { font-weight: 500; color: #e0e0e0; }
  .orow.on b { color: #f0e6da; }
  .orow p { margin: 0; color: #a6a6a6; }
  .orow i { font: 500 10px 'Geist Mono', monospace; letter-spacing: -.02em; text-transform: uppercase; color: #848484; font-style: normal; text-align: right; }
  .orow.on i { color: #d19a72; }
  .odev { margin-top: 16px; border: 1px solid #2c2c2c; border-radius: 8px; padding: 10px 14px; background: #171717; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .odev div { font-size: 12px; color: #a6a6a6; line-height: 1.45; }
  .odev div b { display: block; font: 500 10.5px 'Geist Mono', monospace; letter-spacing: -.02em; text-transform: uppercase; color: #cbcbcb; margin-bottom: 3px; }
  .otable { margin-top: 16px; border: 1px solid #2c2c2c; border-radius: 8px; overflow: hidden; font-size: 12px; }
  .otable .r { display: grid; grid-template-columns: 170px 1fr 120px 130px 110px; gap: 10px; padding: 7px 14px; border-bottom: 1px solid #262626; color: #a6a6a6; }
  .otable .r:last-child { border-bottom: 0; }
  .otable .r.h { font: 500 10.5px 'Geist Mono', monospace; text-transform: uppercase; letter-spacing: -.02em; color: #848484; background: #171717; }
  .otable .r b { color: #e0e0e0; font-weight: 500; }
  .otable .r.on { background: #1e1e1e; }
`;
const orow = (on, t, p, tag) => `<div class="orow${on ? ' on' : ''}"><span class="m">${on ? '✓' : ''}</span><b>${t}</b><p>${p}</p><i>${tag}</i></div>`;
const optionsBoard = () => `<div class="opts"><div class="otitle">The options, reviewed · the lit rows are the recommendation · the table is the registry as researched on 2026-09-19</div>
<div class="ogrid">
  <div class="otab"><h3>Who picks the model <span>George: "switch models with an env variable"</span></h3>
    ${orow(true, 'One env variable on the server', 'STARTER_VIDEO_MODELS names the active model first and the fallbacks after it. No picker in the app. The card and Settings READ the active model from GET /v1/starter/video and say it out loud with its price.', 'recommended')}
    ${orow(false, 'A per-workspace picker', 'A select under Image generation. More surface, a synced preference, and a person choosing between models they cannot compare. Later, when a second lane exists.', 'later')}
    ${orow(false, 'The agent picks', 'plume chooses by angle. Unpredictable spend. No.', 'no')}
  </div>
  <div class="otab"><h3>Who pays first <span>a Google key beside credits</span></h3>
    ${orow(true, 'The Starter lane first, the own key when the door says 402 or 503', 'One press, one outcome, and the card names which lane filmed. A workspace with a key and no credits still films. The facts line shows the credits BEFORE the press.', 'recommended')}
    ${orow(false, 'The own key first', 'Free for the person, but Omni is weaker for creators than Seedance, and George wants the platform models used. A person who wants their key can set no credits.', 'no')}
    ${orow(false, 'Ask on every press', 'A question card per film. Ceremony for a 2-minute action.', 'no')}
  </div>
  <div class="otab"><h3>When the clip is charged <span>a film takes minutes</span></h3>
    ${orow(true, 'Debit at submit, refund on failure', 'The balance guard runs before the submit, the price is known (a fixed duration), and a refused or failed film puts the credits back with a ledger row beside the charge. Two concurrent presses cannot overspend.', 'recommended')}
    ${orow(false, 'Charge on completion', 'Two presses in flight can both pass the guard. The Starter brain charges after the call only because a reply is seconds, not minutes.', 'no')}
  </div>
  <div class="otab"><h3>How the server waits <span>Vercel holds no stream</span></h3>
    ${orow(true, 'A films row and the minute cron', 'The announce lane’s shape: submit, 202, a row the cron works. fal’s status endpoint is idempotent, so a missed minute costs a minute. The card shows video_pending from the row.', 'recommended')}
    ${orow(false, 'fal’s webhook', 'Faster by up to a minute, but a public endpoint that must verify the sender, and retries to dedupe. Add later as the fast path with the cron as the backstop.', 'v1.5')}
    ${orow(false, 'The desktop polls fal', 'The key would have to reach the machine. Never.', 'no')}
  </div>
</div>
<div class="otable">
  <div class="r h"><span>registry key</span><span>fal endpoint · inputs</span><span>720p, audio</span><span>8 s clip</span><span>credits</span></div>
  <div class="r on"><b>seedance-2.0-fast</b><span>bytedance/seedance-2.0/fast/text-to-video · resolution 720p · duration "8" · aspect_ratio 9:16 · generate_audio</span><span>$0.2419 /s</span><span>$1.94</span><b>194</b></div>
  <div class="r"><b>seedance-2.0</b><span>bytedance/seedance-2.0/text-to-video · same inputs, the standard tier</span><span>$0.3034 /s</span><span>$2.43</span><span>243</span></div>
  <div class="r"><b>kling-3.0</b><span>fal-ai/kling-video/v3/standard/text-to-video · duration "8" · aspect_ratio 9:16 · generate_audio true</span><span>$0.126 /s</span><span>$1.01</span><span>101</span></div>
  <div class="r"><b>kling-3.0-pro</b><span>fal-ai/kling-video/v3/pro/text-to-video · same inputs</span><span>$0.168 /s</span><span>$1.34</span><span>134</span></div>
  <div class="r"><b>minimax-h3</b><span>minimax/h3/text-to-video · duration 8 · resolution 768P · aspect_ratio 9:16</span><span>$0.06 /s</span><span>$0.48</span><span>48</span></div>
  <div class="r"><b>minimax-h3-max</b><span>minimax/h3-max/text-to-video · same inputs · launch price until Sep 30</span><span>$0.04 /s</span><span>$0.32</span><span>32</span></div>
</div>
<div class="odev">
  <div><b>Decided · at cost</b>The Starter brain meters at list price and so does a film, rounded up to whole credits so the card, the charge, the refund and the history say one number. 194 for a Seedance 2.0 hook.</div>
  <div><b>Decided · three tiers, Seedance fast first</b>NeuraMesh Video Starter (Seedance 2.0), Xpress (MiniMax H3), Premium (Seedance 2.0 Standard). NM_VIDEO_TIERS maps each tier to a registry key; Pro workspaces pick, Free films on Starter or its own key.</div>
  <div><b>Decided · the models are named</b>The tier is the house word, the vendor model stands beside it on the card, in Settings and in the credits history: "NeuraMesh Video Starter · Seedance 2.0 · 8 s · 194 credits".</div>
</div></div>`;

const shellPage = (theme, inner, opts) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${opts.title}</title>${FONTS}<style>${SHELL}${THREAD}${CARD}${SETTINGS}</style></head><body>${frame(theme, inner, opts.rail ?? {})}</body></html>`;
const plainPage = (css, body, title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${FONTS}<style>body{margin:0}${css}</style></head><body>${body}</body></html>`;

const BOARDS = [
  { file: 'Before.dc.html', title: 'A · the card before the press · graphite', x: 0, y: 0, html: () => shellPage('graphite', cardSheet('before'), { title: 'A · the card before the press · graphite', rail: { on: 'release' } }) },
  { file: 'Filming.dc.html', title: 'B · filming · graphite', x: 1580, y: 0, html: () => shellPage('graphite', cardSheet('wait'), { title: 'B · filming · graphite', rail: { on: 'release' } }) },
  { file: 'FilmingCream.dc.html', title: 'B · filming · cream oak', x: 3160, y: 0, html: () => shellPage('cream', cardSheet('wait'), { title: 'B · filming · cream oak', rail: { on: 'release' } }) },
  { file: 'Filmed.dc.html', title: 'C · the film landed · graphite', x: 0, y: 1260, html: () => shellPage('graphite', cardSheet('done'), { title: 'C · the film landed · graphite', rail: { on: 'release' } }) },
  { file: 'States.dc.html', title: 'D · out of credits, the own-key fallback, no lane · graphite', x: 1580, y: 1260, html: () => shellPage('graphite', statesSheet(), { title: 'D · out of credits, the own-key fallback, no lane · graphite', rail: { on: 'release' } }) },
  { file: 'Settings.dc.html', title: 'E · Settings › Connections · the Video line and the credits history · cream oak', x: 3160, y: 1260, html: () => shellPage('cream', settingsSheet(), { title: 'E · Settings › Connections · the Video line and the credits history · cream oak', rail: {} }) },
  { file: 'Architecture.dc.html', title: 'F · how it runs · your machine, our server', x: 0, y: 2520, html: () => plainPage(DIAG, archBoard(), 'F · how it runs · your machine, our server') },
  { file: 'Options.dc.html', title: 'G · the options and the registry', x: 1580, y: 2520, html: () => plainPage(OPTS, optionsBoard(), 'G · the options and the registry') },
];

const NOTES = [
  { id: 'note-top', x: 0, y: -300, w: 4600, text: `THE VIDEO RUNG · Seedance 2.0, Kling 3.0 and MiniMax H3 through one fal.ai key on the backend, metered on cloud credits (design round 1, 2026-09-19, issue #539)
George: "we'll use a fal.ai key on the backend and limit usage based on cloud credits", and "configure multiple models support so we can easily switch video generation models with an env variable". The Starter brain is the shape: the platform key never leaves the control-api, the balance is checked before the call, the ledger is debited with a row beside it. What changes for the person: the same Generate video button, with the model and the credits said BEFORE the press, a pending state that survives a reload, the film with its facts after, and two honest answers when the credits are gone. No picker. Nothing publishes a clip yet.` },
  { id: 'note-a', x: 0, y: 1020, w: 1440, text: `A · BEFORE THE PRESS. The video card from #535: caption, folded script, the shot direction. New: the facts line beside Generate video names the active model, the clip length, the credits it costs and how long it takes, read from GET /v1/starter/video. A spend is never a surprise. When the workspace has no credits and a Google key, the line reads "Gemini Omni Flash · your key".` },
  { id: 'note-b', x: 1580, y: 1020, w: 1440, text: `B · FILMING. The press posts the marker; the daemon asks the door; the door answers 202 with the films row and stamps video_pending on the draft, so the state survives a reload and shows on every machine. The card holds a quiet progress row with the model, the length and the credits. plume's line in the thread says the same. The button is off, not gone.` },
  { id: 'note-bc', x: 3160, y: 1020, w: 1440, text: `B · CREAM OAK. The same card in the signature light. The pending row is a dashed hairline box in the card's stratum, the progress bar wears the link ink, the facts line stays mono and muted.` },
  { id: 'note-c', x: 0, y: 2280, w: 1440, text: `C · THE FILM LANDED. The minute cron found the request COMPLETED, downloaded the clip, hosted it through the picture's lane, cleared video_pending. The card plays it where the picture stands; the row reads "shot direction"; the facts line records what filmed it, for how long, at what price, when. Film again spends again, and says so.` },
  { id: 'note-d', x: 1580, y: 2280, w: 1440, text: `D · THE THREE ANSWERS WHEN THE LANE CANNOT FILM. Out of credits: the row names the price and the two ways forward (Add credits, or a Google key). With a Google key set, the rung falls to it on its own and the film carries "your key · no credits used". With neither, the card says video is not set up here and points at Image generation. The local stack has no Starter lane by rule (CLAUDE.md #5) and reads the third state.` },
  { id: 'note-e', x: 3160, y: 2280, w: 1440, text: `E · WHERE THE SPEND SHOWS. Settings › Connections › Image generation gains one Video line: the active model, its price, the fallback. It is a statement, not a control, because the model is the server's env variable. The credits card lists every film as its own row with the draft, the length and the session, and a refund beside a failed one. A film is the single largest thing a credit buys, so it is never folded into a daily total.` },
  { id: 'note-f', x: 0, y: 3540, w: 1440, text: `F · HOW IT RUNS. Two lanes, one door. The machine never holds the key and never polls fal: it asks once and reads the row. The server's door is the Starter brain's twin (member gate, balance FIRST, price, debit, submit, 202). The minute cron works the films rows: status, download, host, stamp; a failure refunds and lands on the card. STARTER_VIDEO_MODELS is the only switch: the first key is the active model, the rest are the fallbacks when fal answers that an endpoint is unavailable.` },
  { id: 'note-g', x: 1580, y: 3540, w: 1440, text: `G · THE OPTIONS AND THE REGISTRY. Four decisions with the recommendation lit. The table is the registry as fal publishes it on 2026-09-19: the endpoint, the inputs the lane sends, the per-second price at 720p with audio, an eight-second clip in dollars and in credits (1 credit = $0.01). Three questions are left for George at the foot: at cost or with a margin, the first model on day one, and the vendor names on the card.` },
];

for (const b of BOARDS) writeFileSync(join(HERE, b.file), b.html());
writeFileSync(join(HERE, 'canvas.json'), JSON.stringify({
  artboards: BOARDS.map((b) => ({ file: b.file, x: b.x, y: b.y, w: W, h: H, title: b.title })),
  annotations: NOTES,
  launch: { fit: 'all' },
}, null, 2) + '\n');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const canvas = `<title>Video Rung</title>
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
<div class="hud"><h1>Video Rung<small>round 1, revised with George’s three decisions and the built shape · 2026-09-19 · issue #539</small></h1><button data-fit="all">Fit</button><button data-fit="one">100%</button><span class="sp"></span>${BOARDS.map((b, i) => `<button data-board="${i}">${esc(b.title)}</button>`).join('')}</div>
<div class="stage" id="stage"><div class="world" id="world">
${NOTES.map((n) => `<div class="note" style="left:${n.x}px;top:${n.y}px;width:${n.w}px">${esc(n.text)}</div>`).join('\n')}
${BOARDS.map((b) => `<div class="board" style="left:${b.x}px;top:${b.y}px"><span class="bt">${esc(b.title)}</span><iframe title="${esc(b.title)}" loading="eager" srcdoc="${esc(b.html())}"></iframe></div>`).join('\n')}
</div></div>
<div class="hint">Drag to pan · scroll to pan · ⌘ or ctrl + scroll to zoom · press 0 to fit · 1 to 9 jump to a board</div>
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
