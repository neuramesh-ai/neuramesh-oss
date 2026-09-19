// Generates the design-canvas artboards for the Release drafts round (2026-09-17): NeuraMesh watches a
// project's repository, opens one session per release that ships a feature, and the marketer drafts the
// announcement for every connected account. The human approves it in the thread. The public door is
// neuramesh.app/announce: paste a public repository, read the drafts, sign in to save and publish.
// Every value is lifted from tokens.css (.topbar, .msg, .qcard.mksetup, .mkconnrow, .unitcard, .mkpostcard,
// .mkpv, .mkpcfoot, .chip, .routinechip, .cbox, .schedcard) and apps/web/src/styles.css (the site's paper
// and graphite, .btn, .eyebrow, .legalhead). The shell CSS is the marketing-os-desk round's recipe.
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
      { k: 'routine', t: 'v0.134.0: the browser terminal', st: 'ny', on: on === 'release' },
      { k: 'active', t: 'AI harness reply radar', st: 'ip' },
      { k: 'routine', t: 'v0.133.0: open source', when: '2d' },
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

/* A · the setup flow, step 5 of 5 */
const wizardSheet = () => `${thhead('Set up your marketing HQ', '<span class="chip c-setup">setup</span><span class="roomchip">#marketing · ai-demos</span>')}
<div class="thscroll"><div class="transcript">
  ${msg('plume', '09:14', `<div class="md"><p>Welcome to the marketing HQ. Point me at the product and the crew takes it from there. It is the same loop as your build channels, aimed at growth.</p></div>
  <div class="qcard mksetup">
    <div class="qhead"><span class="qcount">5/5</span>Announce your releases? <span class="mkqopt">(optional)</span></div>
    <div class="mkq">
      <div class="mkqlabel">Repository</div>
      <div class="mkrow"><span class="repochip">${svg('gh', 13, 1.8)}alonge-dev/ai-demos <span class="br">· main</span></span><span class="btn ghost sm">Change</span></div>
      <div class="mkqlabel">Drafts go to every connected account</div>
      <div class="mkrow"><span class="mkconnico">𝕏</span><span class="mkconnname">X<span class="sub">@aidemos</span></span><span class="mkconnok">✓ connected</span></div>
      <div class="mkrow"><span class="mkconnico">in</span><span class="mkconnname">LinkedIn<span class="sub">AI Demos</span></span><span class="mkconnok">✓ connected</span></div>
      <div class="mkrow"><span class="mkconnico">◫</span><span class="mkconnname">Instagram<span class="sub">image required</span></span><span class="btn sm">Connect</span></div>
      <div class="mkqlabel">When</div>
      <div class="togrow"><span><span class="lbl">Draft the latest release now</span><span class="sub">v0.4.2 · published Sep 12 · free on every plan</span></span><span class="cb on">✓</span></div>
      <div class="togrow"><span><span class="lbl">Watch the repository daily</span><span class="sub">09:00 · one session per release that ships a feature · a Team routine</span></span><span class="sw on"></span></div>
    </div>
    <div class="mkqfoot"><span class="btn primary sm">Put the crew to work →</span><span class="btn ghost sm">‹ Back</span></div>
  </div>`)}
</div></div>
${composer('Reply to plume…', ['#marketing'])}`;

/* B · the release thread */
const post = ({ net, glyph, letter, handle, text, img = null, brief = null, cc = null, status = 'draft', tall = false }) => `<div class="mkpostcard">
  <div class="mkpchd"><span class="mkpcnet"><span class="mkpcg">${glyph}</span>${net}</span><span class="mkpcid">#1142·${letter}</span><span class="chip mk-${status}">${status}</span></div>
  <div class="mkpv">
    <div class="mkpvhead"><span class="mkpvav${net === 'Instagram' || net === 'TikTok' ? ' grad' : ''}">n</span><b>neuramesh</b><span class="mkpvhandle">· ${handle}</span></div>
    <div class="mkpvtext">${text}</div>
    ${img ? `<div class="mkpcimg${tall ? ' tall' : ''}"><div class="rc"><span class="rcm"></span><span class="rcv">v0.134.0</span><span class="rct">${img}</span></div></div>` : ''}
  </div>
  ${brief ? `<div class="mkpcbrief">${svg('image', 13, 1.8)}<span><span class="mkpcbriefk">image brief</span> · ${brief}</span></div>` : ''}
  <div class="mkpcfoot">${cc ? `<span class="mkpccc">${cc}</span>` : ''}<span class="mkpcactions"><span class="mkico">${svg('reply', 13)}</span>${img ? `<span class="mkico">${svg('image', 13)}</span>` : ''}<span class="btn sm">Review · schedule ↗</span></span></div>
</div>`;
const DIGEST = `<div class="md"><p><b>Release drafts · neuramesh-ai/neuramesh-oss</b> · new since v0.133.0 · checked 09:00</p><ul>
<li><b>v0.134.0</b> · published Sep 16 · <i>The browser terminal: a shell on your cloud machine from any browser. The machine never listens. nm-relay is the rendezvous both sides dial out to.</i></li>
<li>5 merged: <a>#385</a> nm-relay · <a>#387</a> the terminal pane · <a>#390</a> relay health checks · <a>#391</a> fix: pty bytes · <a>#392</a> chore: deps</li></ul></div>`;
const UNIT = `<div class="unitcard"><div class="ucrow"><span class="ucid">#1142</span><span class="ucti">Release announcement · v0.134.0</span><span class="chip c-done">done</span><span class="hico sm c-done">${dial(.86, 16)}</span></div><div class="ucfacts">plume · content · 4 posts · brief · finished 09:07</div></div>`;
const RELCARD = `<div class="relcard">
  <div class="relhd"><span class="relk">${svg('tag', 13, 1.8)}Release announcement</span><span class="reltag">v0.134.0</span><span class="reldate">Sep 16</span><span class="chip c-done">feature</span></div>
  <div class="relbody">
    <div class="reltitle">The browser terminal: a shell on your cloud machine from any browser</div>
    <div class="relwhy">The release notes lead with it. Three of the five merged pull requests build it (<a class="taskref">#385</a> <a class="taskref">#387</a> <a class="taskref">#390</a>). #391 is a fix and #392 is a chore, so neither is announced.</div>
    <div class="relrows">
      <div class="relrow"><span class="k">Audience</span><span class="v">Engineers who run agents on a cloud machine and sign in to vendors from it.</span></div>
      <div class="relrow"><span class="k">Assets</span><span class="v">A release card, drawn on the brand palette (Instagram, TikTok). A screenshot of the terminal pane: <span class="gap">not made, the profile has no site to capture.</span></span></div>
      <div class="relrow"><span class="k">Not known</span><span class="v"><span class="gap">The date #390 merged. The notes name it, the log does not.</span></span></div>
    </div>
  </div>
  <div class="relfoot"><span class="btn sm">Open brief ↗</span><span class="btn ghost sm">Save to Files</span><span class="sp"></span><span class="mono">release-report-2026-09-17.md</span></div>
</div>`;
const DRAFTS = `<div class="mkdrafts"><div class="mkdraftsgrid">
  ${post({ net: 'X', glyph: '𝕏', letter: 'a', handle: 'draft', cc: '228/280', text: 'v0.134.0 is out. You can now open a shell on your cloud machine from any browser. The machine never listens. It dials out to a relay, and your browser does the same. Vendor logins like <code>gh auth login</code> finish on a machine you own.' })}
  ${post({ net: 'LinkedIn', glyph: 'in', letter: 'b', handle: 'draft', text: 'NeuraMesh v0.134.0 adds a browser terminal.\n\nOpen a shell on your cloud machine from any browser. The machine never listens. It dials out to a relay, and your browser does the same. Vendor logins finish on a machine you own.\n\nRelease notes: github.com/neuramesh-ai/neuramesh-oss/releases' })}
  ${post({ net: 'Instagram', glyph: '◫', letter: 'c', handle: 'draft', img: 'The browser terminal', brief: 'the release card: the version, the feature name, the oak mark, on graphite. No other text.', text: 'A shell on your cloud machine, from any browser. v0.134.0 is out.' })}
  ${post({ net: 'TikTok', glyph: '♪', letter: 'd', handle: 'draft · to your inbox', img: 'The browser terminal', text: 'Open a terminal on your cloud machine from your phone. v0.134.0.' })}
</div></div>`;
const threadSheet = () => `${thhead('v0.134.0: the browser terminal', `<span class="routinechip">${svg('clock', 10)}routine</span><span class="roomchip">#marketing · neuramesh</span><span class="chip st-ny">needs you</span>`)}
<div class="thscroll"><div class="transcript">
  ${msg('george', '09:00', DIGEST, { human: true, extra: `<span class="routinechip">${svg('clock', 10)}Release drafts</span>` })}
  ${msg('rex', '09:01', `<div class="md"><p>A feature shipped in v0.134.0, the browser terminal. I started the release announcement playbook for plume.</p></div>${UNIT}`)}
  ${msg('plume', '09:07', `<div class="md"><p>Done. The brief and four drafts are below, one per connected account. TikTok lands in your inbox as a private draft.</p></div>${RELCARD}`)}
  ${DRAFTS}
</div></div>
${composer('Reply to plume…', ['#marketing', '↩ Request changes · #1142·c'])}`;

/* D · Automations › Routines, the release routine's ledger open */
const rtcard = (r) => `<div class="rtcard${r.open ? ' open' : ''}">
  <div class="rt1"><span class="rtglyph">${svg(r.glyph ?? 'clock', 14)}</span><span class="rtt">${r.t}</span><span class="chip ${r.paused ? 'c-todo' : 'c-done'}">${r.paused ? 'paused' : 'active'}</span></div>
  <div class="rtcad">${r.cad} · <span class="${r.due ? 'due' : ''}">next ${r.next}</span></div>
  <div class="rtprompt">${r.prompt}</div>
  <div class="rtroom">${r.room}</div>
  <div class="rtfoot"><span class="rtledger${r.open ? ' on' : ''}">${r.runs} runs ${r.open ? '▴' : '▾'}</span><span class="rtacts"><span class="mkico">${svg('pause', 13)}</span><span class="mkico">${svg('pencil', 13)}</span><span class="mkico">${svg('trash', 13)}</span></span></div>
  ${r.open ? `<div class="rtruns">${r.ledger.map((l) => `<div class="rtrun${l.quiet ? ' quiet' : ''}"><span class="rw">${l.when}</span><span class="rt">${l.t}</span>${l.chip ?? ''}<span class="rf">${l.f}</span>${l.go ? `<span class="go">${l.go}</span>` : ''}</div>`).join('')}</div>` : ''}
</div>`;
const routinesSheet = () => `<div class="topbar">Routines<span class="desc">what is armed, and when it fires next</span></div>
<div class="rtview"><div class="rtinner">
  <div class="scopebar"><div class="wfsearch">${svg('search', 14)}<span>Search routines…</span></div><span class="cchip">All projects<span class="car">▾</span></span><span class="cchip">All rooms<span class="car">▾</span></span></div>
  <div class="rtgrid">
    ${rtcard({ open: true, glyph: 'tag', t: 'Release drafts · neuramesh-oss', cad: 'Daily · 09:00', next: 'in 14h', prompt: 'Check neuramesh-ai/neuramesh-oss for releases since the last run. When a feature shipped, run the release announcement playbook for every connected account.', room: 'neuramesh · #marketing', runs: 3, ledger: [
      { when: 'Today · 09:00', t: 'v0.134.0: the browser terminal', chip: '<span class="chip st-ny">needs you</span>', f: '4 drafts' },
      { when: 'Yesterday · 09:00', t: 'nothing new since v0.133.0', quiet: true, f: 'checked' },
      { when: 'Sep 15 · 09:00', t: 'v0.133.0: open source', chip: '<span class="chip st-settled">settled</span>', f: '3 published · 1 draft' },
      { when: 'Sep 12 · 09:00', t: 'v0.132.1: fixes only, nothing to announce', quiet: true, f: 'settled', go: 'Draft anyway ›' },
    ] })}
    ${rtcard({ t: 'AI harness reply radar', cad: 'Weekdays · 09:00', next: 'in 14h', prompt: 'Run the reply radar playbook on neuramesh.app.', room: 'neuramesh · #marketing', runs: 12 })}
    ${rtcard({ t: 'X post schedule', cad: 'Daily · 17:00', next: 'in 6h', due: false, prompt: 'Draft one X post in the builder-to-builder voice from this week’s library docs.', room: 'neuramesh · #marketing', runs: 41 })}
    ${rtcard({ t: 'GEO re-measure', cad: 'Once · Oct 15 · 09:00', next: 'in 28d', prompt: 'Run the AI search (GEO) playbook on neuramesh.app and compare with the Sep 15 report.', room: 'neuramesh · #marketing', runs: 0 })}
    ${rtcard({ glyph: 'tag', t: 'Release drafts · flowe-ai', cad: 'Daily · 09:00', next: 'in 14h', prompt: 'Check flowe-app/flowe for releases since the last run. When a feature shipped, run the release announcement playbook for every connected account.', room: 'flowe-ai · #marketing', runs: 1 })}
  </div>
</div></div>`;

/* ── D · neuramesh.app/announce, the site's paper and graphite, four states ── */
const SITE_THEMES = {
  light: { ink: '#0c0b0a', paper: '#f5f4f2', surface: '#ffffff', surface2: '#ebe9e6', line: '#dedbd6', line2: '#b9b4ae', muted: '#6b665f', body: '#57534e', accent: '#834a2b', accentInk: '#fff7ee', green: '#21734e', warn: '#a06a1f', grid: 'rgba(0,0,0,.07)' },
  dark: { ink: '#e8e6e3', paper: '#0d0d0d', surface: '#161616', surface2: '#1a1a1a', line: '#262626', line2: '#3a3a3a', muted: '#8a8a8a', body: '#a6a6a6', accent: '#c58a63', accentInk: '#241207', green: '#77ac8d', warn: '#c9a15e', grid: 'rgba(255,255,255,.06)' },
};
const siteTokens = (t) => Object.entries({ '--ink': t.ink, '--paper': t.paper, '--surface': t.surface, '--surface2': t.surface2, '--line': t.line, '--line2': t.line2, '--muted': t.muted, '--body': t.body, '--accent': t.accent, '--accent-ink': t.accentInk, '--green': t.green, '--warn': t.warn, '--grid': t.grid }).map(([k, v]) => `${k}:${v};`).join('');
const SITE = `
  .site { --fbody: 'Geist', -apple-system, BlinkMacSystemFont, sans-serif; --fmono: 'Geist Mono', ui-monospace, Menlo, monospace; --fbrand: 'Bricolage Grotesque', var(--fbody);
    position: relative; box-sizing: border-box; width: ${W}px; height: ${H}px; overflow: hidden; background: var(--paper); color: var(--ink); font: 14px/1.5 var(--fbody); -webkit-font-smoothing: antialiased;
    background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px); background-size: 48px 48px; }
  .site *, .site *::before, .site *::after { box-sizing: border-box; }
  .site svg { display: block; }
  .snav { height: 72px; display: flex; align-items: center; gap: 32px; padding: 0 40px; background: color-mix(in srgb, var(--paper) 88%, transparent); }
  .lockup { display: inline-flex; align-items: center; gap: 9px; font: 600 17px var(--fbrand); letter-spacing: -.015em; color: var(--ink); }
  .porch { width: 22px; height: 22px; border-radius: 4px; background: #834a2b; position: relative; }
  .porch::after { content: ''; position: absolute; left: 6px; top: 6px; width: 10px; height: 10px; border-radius: 2px; background: #fff7ee; }
  .snavr { margin-left: auto; display: inline-flex; align-items: center; gap: 22px; font-size: 14px; color: var(--body); }
  .sbtn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 32px; padding: 0 14px; border-radius: 3px; font: 500 13px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; border: 1px solid var(--line2); background: transparent; color: var(--ink); position: relative; isolation: isolate; overflow: hidden; white-space: nowrap; }
  .sbtn::before { content: ""; position: absolute; inset: 0; z-index: -1; background: repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 7px); opacity: .08; }
  .sbtn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); } .sbtn.primary::before { opacity: .14; }
  .sbtn.big { height: 38px; padding: 0 18px; font-size: 14px; }
  .swrap { max-width: 900px; margin: 0 auto; padding: 26px 40px 0; }
  .seyebrow { font: 500 12px var(--fmono); letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
  .site h1 { font: 500 40px/1.08 var(--fbody); letter-spacing: -.035em; margin: 8px 0 8px; color: var(--ink); }
  .slead { font-size: 15.5px; color: var(--muted); line-height: 1.6; max-width: 60ch; }
  .srepo { display: flex; gap: 10px; margin-top: 16px; }
  .sinput { flex: 1; display: flex; align-items: center; gap: 10px; height: 38px; padding: 0 12px; border: 1px solid var(--line2); border-radius: 3px; background: var(--surface); font: 500 14px var(--fmono); color: var(--ink); }
  .sinput .dim { color: var(--muted); }
  .sinput.focus { border-color: var(--ink); }
  /* the detect row: one line under the input, the repository's kind and its latest release */
  .sdetect { display: flex; align-items: center; gap: 9px; margin-top: 9px; font: 500 12px var(--fmono); color: var(--body); }
  .sdetect i { width: 7px; height: 7px; border-radius: 50%; background: var(--green); flex: none; }
  .sdetect.warn i { background: var(--warn); }
  .sdetect b { color: var(--ink); font-weight: 500; }
  .sdetect .go { color: var(--accent); margin-left: 2px; }
  /* the form: two fields on one row, one note under them */
  .sform { margin-top: 18px; border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 16px 18px 14px; }
  .sfields { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .sfield label { display: block; font: 500 11px var(--fmono); letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
  .sfield .sinput { height: 36px; font-family: var(--fbody); font-weight: 400; }
  .sfield .hint { display: block; margin-top: 5px; font: 500 11px var(--fmono); color: var(--muted); }
  .sfoot { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
  .snote { font: 500 12px var(--fmono); color: var(--muted); line-height: 1.5; }
  /* the grant card: what the app reads, read only, the pick is theirs */
  .sgrant { margin-top: 18px; border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 18px 20px 16px; max-width: 620px; }
  .sgrant h2 { margin: 0; font: 500 20px/1.25 var(--fbody); letter-spacing: -.025em; color: var(--ink); }
  .sgrant p { margin: 6px 0 0; font-size: 13.5px; color: var(--body); line-height: 1.5; }
  .srows { margin-top: 12px; border-top: 1px solid var(--line); }
  .srow2 { display: flex; gap: 12px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
  .srow2 .k { flex: none; width: 96px; color: var(--muted); }
  .srow2 .v { color: var(--ink); }
  .srow2 .v small { color: var(--muted); font-size: 12px; margin-left: 6px; }
  .safter { margin-top: 14px; display: flex; align-items: center; gap: 12px; }
  .safter .lbl { font: 500 11px var(--fmono); letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
  /* the wait: the status rows of the first-run card, and the email beside them */
  .swait { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 18px; align-items: start; }
  .sstat { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 16px 18px 14px; }
  .sstat h2 { margin: 0 0 4px; font: 500 20px/1.25 var(--fbody); letter-spacing: -.025em; color: var(--ink); }
  .sstat p { margin: 0 0 8px; font-size: 13.5px; color: var(--body); line-height: 1.5; }
  .ssrow { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); font-size: 13.5px; color: var(--ink); }
  .ssrow .st { margin-left: auto; font: 500 10.5px var(--fmono); letter-spacing: .04em; text-transform: uppercase; color: var(--green); display: inline-flex; align-items: center; gap: 6px; }
  .ssrow .st.wait { color: var(--muted); } .ssrow .st.wait i { width: 7px; height: 7px; border-radius: 50%; background: var(--warn); }
  .ssrow .st.next { color: var(--muted); }
  .ssrow small { color: var(--muted); font: 500 11px var(--fmono); margin-left: 8px; }
  .sstat .snote { display: block; margin-top: 10px; }
  .semail { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; overflow: hidden; }
  .semailhd { padding: 12px 18px; border-bottom: 1px solid var(--line); background: var(--surface2); }
  .semailhd div { display: flex; gap: 10px; font: 500 12px var(--fmono); color: var(--muted); line-height: 1.7; }
  .semailhd div b { color: var(--ink); font-weight: 500; font-family: var(--fbody); font-size: 13.5px; }
  .semailhd div span:first-child { width: 58px; flex: none; }
  .semailbody { padding: 18px 20px 20px; font-size: 14px; line-height: 1.6; color: var(--ink); }
  .semailbody p { margin: 0 0 12px; } .semailbody p.small { font-size: 12.5px; color: var(--muted); margin-bottom: 0; }
  .semailbody .sbtn { margin: 4px 0 14px; }
  /* the result */
  .sres { margin-top: 18px; border: 1px solid var(--line); background: var(--surface); border-radius: 8px; overflow: hidden; }
  .sreshd { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--line); font: 500 12.5px var(--fmono); color: var(--body); }
  .sreshd b { color: var(--ink); font-weight: 500; }
  .stag { font: 500 11px var(--fmono); color: var(--ink); border: 1px solid var(--line2); border-radius: 3px; padding: 1.5px 7px; }
  .sfeat { margin-left: auto; font: 500 10px var(--fmono); letter-spacing: .04em; text-transform: uppercase; color: var(--green); border: 1px solid color-mix(in srgb, var(--green) 45%, transparent); border-radius: 3px; padding: 2px 7px; }
  .sresbody { padding: 16px 18px 6px; }
  .srest { font: 500 20px/1.25 var(--fbody); letter-spacing: -.025em; color: var(--ink); }
  .sresw { font-size: 13.5px; color: var(--body); margin-top: 6px; line-height: 1.5; }
  .sposts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 10px 18px 14px; }
  .spost { border: 1px solid var(--line); border-radius: 6px; background: var(--paper); display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
  .sposthd { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); font: 500 10.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--muted); }
  .sposthd .g { color: var(--ink); font-size: 12px; }
  .sposthd .cc { margin-left: auto; color: var(--muted); }
  .spostt { padding: 11px 12px; font-size: 13px; line-height: 1.5; color: var(--ink); white-space: pre-wrap; flex: 1; }
  .spostt code { font: 500 12px var(--fmono); }
  .spimg { margin: 0 12px 12px; height: 132px; border-radius: 4px; background: #161616; position: relative; overflow: hidden; border: 1px solid var(--line); }
  .spimg .rc { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; padding: 12px 14px; background: radial-gradient(120% 90% at 100% 0%, rgba(131,74,43,.35), transparent 60%); }
  .spimg .rcv { font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: #a6a6a6; }
  .spimg .rct { font: 500 18px/1.1 var(--fbody); letter-spacing: -.03em; color: #eaeaea; margin-top: 3px; }
  .spimg .rcm { position: absolute; top: 12px; left: 14px; width: 14px; height: 14px; border-radius: 3px; background: #834a2b; }
  .spcap { padding: 0 12px 10px; font: 500 10.5px var(--fmono); color: var(--muted); }
  .sctas { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-top: 1px solid var(--line); }
  .sctas .link { margin-left: auto; font: 500 12px var(--fmono); color: var(--muted); display: inline-flex; align-items: center; gap: 6px; }
  .sdoors { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 16px; }
  .sdoor { padding: 12px 14px; border: 1px solid var(--line); border-radius: 6px; background: color-mix(in srgb, var(--surface) 70%, transparent); }
  .sdoor .n { font: 500 11px var(--fmono); letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
  .sdoor b { display: block; font-size: 14.5px; font-weight: 500; color: var(--ink); margin: 6px 0 3px; }
  .sdoor p { margin: 0; font-size: 12.5px; color: var(--body); line-height: 1.5; }
  .sdoor code { font: 500 12px var(--fmono); color: var(--ink); background: var(--surface2); border-radius: 3px; padding: 1px 5px; }
`;
const sitePost = (net, glyph, cc, text, img = null) => `<div class="spost"><div class="sposthd"><span class="g">${glyph}</span>${net}${cc ? `<span class="cc">${cc}</span>` : ''}</div><div class="spostt">${text}</div>${img ? `<div class="spimg"><div class="rc"><span class="rcm"></span><span class="rcv">v0.134.0</span><span class="rct">${img}</span></div></div><div class="spcap">the release card, on neuramesh.app’s palette</div>` : ''}</div>`;
const siteHead = () => `<div class="snav"><span class="lockup"><span class="porch"></span>neuramesh</span><span class="snavr"><span>Downloads</span><span>Source</span><span>Pro</span><span class="sbtn">Sign in</span></span></div>`;
const siteIntro = (lead) => `<div class="seyebrow">Announce</div><h1>Your release, announced.</h1><p class="slead">${lead}</p>`;
const LEAD = 'Paste a GitHub repository. NeuraMesh reads the latest release and your site, then drafts the posts for X, LinkedIn and Instagram, with a release card. We email you the link when they are ready. Sign in to save and schedule.';
const repoInput = (value, focus = false) => `<span class="sinput${focus ? ' focus' : ''}">${svg('gh', 15, 1.8)}<span class="dim">github.com/</span>${value}</span>`;
const doors = () => `<div class="sdoors">
  <div class="sdoor"><div class="n">In the app</div><b>Watch the repository</b><p>The marketing room checks it daily and opens one session per release that ships a feature.</p></div>
  <div class="sdoor"><div class="n">From your terminal</div><b><code>npx neuramesh announce</code></b><p>Reads the remote and the latest tag, then posts the notes to the same endpoint.</p></div>
  <div class="sdoor"><div class="n">From your CI</div><b><code>neuramesh-ai/announce@v1</code></b><p>On <code>release: published</code>, the action sends the notes and comments the link on the release.</p></div>
</div>`;

/* D1 · a public repository detected, the form */
const siteForm = (theme) => `<div class="site" data-bt="${theme}" style="${siteTokens(SITE_THEMES[theme])}">${siteHead()}<div class="swrap">
  ${siteIntro(LEAD)}
  <div class="srepo">${repoInput('neuramesh-ai/neuramesh-oss', true)}</div>
  <div class="sdetect"><i></i><b>Public</b>· latest release <b>v0.134.0</b> · published Sep 16 · 5 pull requests merged since v0.133.0</div>
  <div class="sform">
    <div class="sfields">
      <div class="sfield"><label>Your website</label><span class="sinput">neuramesh.app</span><span class="hint">from the repository’s homepage · we read it for the palette, the fonts and the voice</span></div>
      <div class="sfield"><label>Your email</label><span class="sinput"><span class="dim">you@company.com</span></span><span class="hint">we send the link when the drafts are ready · one draft set per release, per email</span></div>
    </div>
    <div class="sfoot"><span class="sbtn primary big">Draft the announcement</span><span class="snote">About two minutes. You can close the page, the email brings you back.</span></div>
  </div>
  ${doors()}
</div></div>`;

/* D2 · a private repository, the grant */
const sitePrivate = (theme) => `<div class="site" data-bt="${theme}" style="${siteTokens(SITE_THEMES[theme])}">${siteHead()}<div class="swrap">
  ${siteIntro(LEAD)}
  <div class="srepo">${repoInput('gads-inc/flowe')}</div>
  <div class="sdetect warn"><i></i><b>Private, or not found.</b> Grant NeuraMesh read access to continue.</div>
  <div class="sgrant">
    <h2>Grant read access on GitHub</h2>
    <p>GitHub opens its own page. You pick the repositories. NeuraMesh reads them and never writes.</p>
    <div class="srows">
      <div class="srow2"><span class="k">Reads</span><span class="v">Releases, pull requests, README and CHANGELOG<small>metadata and contents, read only</small></span></div>
      <div class="srow2"><span class="k">Never</span><span class="v">Code checkouts, pushes, issues, or anything you did not pick</span></div>
      <div class="srow2"><span class="k">Tokens</span><span class="v">Minted per read, one hour, never stored<small>revoke on GitHub at any time</small></span></div>
    </div>
    <div class="sfoot"><span class="sbtn primary big">${svg('gh', 15, 1.8)}Grant access on GitHub ↗</span><span class="sbtn big">Cancel</span></div>
  </div>
  <div class="safter"><span class="lbl">After the grant</span><div class="sdetect" style="margin-top:0"><i></i><b>Private</b>· access granted · latest release <b>v2.3.0</b> · published Sep 14 · the form appears below</div></div>
  ${doors()}
</div></div>`;

/* D3 · the wait, and the email that ends it */
const siteWait = (theme) => `<div class="site" data-bt="${theme}" style="${siteTokens(SITE_THEMES[theme])}">${siteHead()}<div class="swrap">
  ${siteIntro(LEAD)}
  <div class="srepo">${repoInput('neuramesh-ai/neuramesh-oss')}</div>
  <div class="sdetect"><i></i><b>Public</b>· <b>v0.134.0</b> · published Sep 16 · neuramesh.app · george@gads.inc</div>
  <div class="swait">
    <div class="sstat">
      <h2>Please wait…</h2>
      <p>The drafts take about two minutes. You can close this page.</p>
      <div class="ssrow">The release<small>v0.134.0 · 5 pull requests</small><span class="st">Ready</span></div>
      <div class="ssrow">Your site<small>6 colors · 2 fonts · the voice</small><span class="st">Ready</span></div>
      <div class="ssrow">The drafts<small>X · LinkedIn · Instagram</small><span class="st wait"><i></i>Please wait…</span></div>
      <div class="ssrow">The release card<span class="st next">After the drafts</span></div>
      <span class="snote">We email <b>george@gads.inc</b> the link when the drafts are ready.</span>
    </div>
    <div class="semail">
      <div class="semailhd"><div><span>From</span><span>NeuraMesh &lt;hello@notifications.neuramesh.app&gt;</span></div><div><span>To</span><span>george@gads.inc</span></div><div><span>Subject</span><b>Your release drafts are ready: neuramesh-oss v0.134.0</b></div></div>
      <div class="semailbody">
        <p>Three drafts for v0.134.0 are ready. The browser terminal is announced for X, LinkedIn and Instagram, with a release card drawn on neuramesh.app’s palette.</p>
        <span class="sbtn primary">Open the drafts</span>
        <p>Sign in to save them, schedule them, and let your marketing room watch the next release.</p>
        <p class="small">You asked for this at neuramesh.app/announce. If you did not, ignore this email and nothing happens.</p>
      </div>
    </div>
  </div>
</div></div>`;

/* D4 · ready */
const siteReady = (theme) => `<div class="site" data-bt="${theme}" style="${siteTokens(SITE_THEMES[theme])}">${siteHead()}<div class="swrap">
  ${siteIntro(LEAD)}
  <div class="srepo">${repoInput('neuramesh-ai/neuramesh-oss')}</div>
  <div class="sres">
    <div class="sreshd">${svg('gh', 14, 1.8)}<b>neuramesh-ai/neuramesh-oss</b><span class="stag">v0.134.0</span><span>published Sep 16</span><span>voice and palette from neuramesh.app</span><span class="sfeat">feature</span></div>
    <div class="sresbody">
      <div class="srest">The browser terminal: a shell on your cloud machine from any browser</div>
      <div class="sresw">The release notes lead with it, and three of the five merged pull requests build it. Your brand docs replace the site read after you sign in.</div>
    </div>
    <div class="sposts">
      ${sitePost('X', '𝕏', '228 / 280', 'v0.134.0 is out. You can now open a shell on your cloud machine from any browser. The machine never listens. It dials out to a relay, and your browser does the same. Vendor logins like <code>gh auth login</code> finish on a machine you own.')}
      ${sitePost('LinkedIn', 'in', null, 'NeuraMesh v0.134.0 adds a browser terminal.\n\nOpen a shell on your cloud machine from any browser. The machine never listens. It dials out to a relay, and your browser does the same. Vendor logins finish on a machine you own.')}
      ${sitePost('Instagram', '◫', null, 'A shell on your cloud machine, from any browser. v0.134.0 is out.', 'The browser terminal')}
    </div>
    <div class="sctas"><span class="sbtn primary">Sign in to save and schedule</span><span class="sbtn">Copy link</span><span class="link">${svg('link', 12)}neuramesh.app/announce/7f3a2c</span></div>
  </div>
  ${doors()}
</div></div>`;
const siteBoard = (theme, state) => state === 'form' ? siteForm(theme) : state === 'private' ? sitePrivate(theme) : state === 'wait' ? siteWait(theme) : siteReady(theme);

/* ── F · the architecture, one figure with two lanes ── */
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
  .diag .ar { stroke: #848484; fill: none; stroke-width: 1.4; }
  .diag .ar.d { stroke-dasharray: 5 4; }
`;
const box = (x, y, w, h, t, s, cls = '') => `<rect class="bx ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/><text class="t" x="${x + 12}" y="${y + 24}">${t}</text>${s ? `<text class="s" x="${x + 12}" y="${y + 43}">${s}</text>` : ''}`;
const ar = (d, label, lx, ly, cls = '') => `<path class="ar ${cls}" d="${d}" marker-end="url(#ah)"/>${label ? `<text class="l" x="${lx}" y="${ly}">${label}</text>` : ''}`;
const archBoard = () => `<div class="diag"><div class="dtitle">Release drafts · how it runs · the app lane on your machine, the public door on our server</div>
<svg viewBox="0 0 1376 930" role="img" aria-label="Two lanes. In the app, the daemon tick scans the repository with the machine's gh login, opens one session per release, rex judges, a playbook unit drafts, the human approves, the publish cron posts. On the public door, the site detects whether the repository is public or private, a private one is granted through the GitHub App, the person leaves a website and an email, a cron job reads the release and the site, one Starter turn drafts, a release card is drawn, an email carries the link, and sign in imports the drafts into a workspace.">
  <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#848484"/></marker></defs>
  <rect class="lane" x="0" y="0" width="1376" height="470" rx="8"/>
  <text class="k" x="14" y="22">In the app · your machine, your gh login · the cloud holds the truth</text>
  ${box(20, 60, 190, 60, 'GitHub', 'releases · merged PRs')}
  ${ar('M210 90 H285', 'reads since the cursor', 213, 80)}
  ${box(290, 60, 250, 60, 'The daemon tick · release scan', 'code only · gh · payload.release')}
  ${ar('M415 120 V165', '', 0, 0)}
  ${box(290, 170, 250, 50, 'Quiet window', 'no thread · the cursor advances', 'q')}
  ${ar('M540 90 H615', 'the digest · ‹release› marker', 545, 80)}
  ${box(620, 60, 220, 60, 'The release session', 'one thread per release · routine-born')}
  ${ar('M840 90 H915', 'wakes', 858, 80)}
  ${box(920, 60, 180, 60, 'rex · judgment', 'a feature? which one?')}
  ${ar('M1100 90 H1170', 'run_playbook', 1103, 80)}
  ${box(1175, 60, 185, 60, 'Unit, born approved', 'release playbook · plume')}
  ${ar('M1267 120 V175', 'worker lane · brand docs · the skill', 1000, 152)}
  ${box(1175, 180, 185, 60, 'Brief + posts.json', 'content_items on the unit')}
  ${ar('M1175 210 H845', 'the thread shows the cards', 870, 200)}
  ${box(620, 180, 220, 60, 'Post cards in the session', 'per connected account · draft')}
  ${ar('M730 240 V295', '', 0, 0)}
  ${box(620, 300, 220, 60, 'Human · content.approve', 'approve · schedule · request changes', 'h')}
  ${ar('M840 330 H915', 'scheduled', 850, 320)}
  ${box(920, 300, 180, 60, 'Publish cron', 'sealed connectors · holds without an image')}
  ${ar('M1100 330 H1170', 'posts', 1113, 320)}
  ${box(1175, 300, 185, 60, 'X · LinkedIn · IG · TikTok', 'receipts on the cards')}
  ${ar('M290 90 C 250 90 250 330 240 330 H 215', 'no gh login on any machine: the row stays due, the attention bar says so', 20, 405, 'd')}
  ${box(20, 300, 190, 60, 'Attention bar', 'schedule.mark_result', 'q')}

  <rect class="lane" x="0" y="500" width="1376" height="420" rx="8"/>
  <text class="k" x="14" y="522">The public door · our server, the GitHub App for private repositories, the Starter brain · no token stored, ever</text>
  ${box(20, 550, 200, 60, 'neuramesh.app/announce', 'paste owner/repo')}
  ${ar('M220 580 H285', 'detect', 232, 570)}
  ${box(290, 550, 190, 60, 'Public or private?', 'GET /repos · 200 or 404')}
  ${ar('M385 610 V655', '404', 392, 640)}
  ${box(290, 660, 190, 60, 'Human · grant on GitHub', 'the App · read only · their pick', 'h')}
  ${ar('M480 690 C 520 690 520 590 555 585', 'installation token, minted per read', 488, 720, 'd')}
  ${ar('M480 580 H555', '200', 505, 570)}
  ${box(560, 550, 200, 60, 'Website + email', 'the form · caps per email and address')}
  ${ar('M760 580 H835', 'queued row', 768, 570)}
  ${box(840, 550, 210, 60, 'Cron · announce-due', 'every minute · the job')}
  ${ar('M945 610 V655', '', 0, 0)}
  ${box(840, 660, 210, 96, 'Reads · drafts · draws', 'GitHub (public or the App) · the site’s palette, fonts, voice · one Starter turn · the release card')}
  ${ar('M1050 700 H1125', 'ready', 1068, 690)}
  ${box(1130, 660, 230, 60, 'Email · Resend', '“Your release drafts are ready” + the link')}
  ${ar('M1245 660 V615', '', 0, 0)}
  ${box(1130, 550, 230, 60, '/announce/:id', 'the page · the image at /announce/:id/image')}
  ${ar('M1130 570 H1090 C 1060 570 1060 480 900 470 V 245', 'sign in · claim: the same session, the website into the profile', 690, 495, 'd')}
  ${box(20, 660, 200, 50, 'npx neuramesh announce', 'the notes travel inline · v1.5', 'q')}
  ${box(20, 740, 200, 50, 'GitHub Action', 'release: published · v1.5', 'q')}
  ${ar('M220 685 C 250 685 250 830 560 830 C 640 830 640 615 650 612', '', 0, 0, 'd')}
  ${ar('M220 765 C 250 765 250 830 260 830', 'both post to the queue with the notes inline', 262, 855, 'd')}
  <text class="l" x="20" y="905">solid = data moves · oak box = a human’s act · dashed = phase 1.5 or a branch · one endpoint, three doors · installation tokens are minted per read and never stored</text>
</svg></div>`;

/* ── G · the options, reviewed ── */
const OPTS = `
  .opts { box-sizing: border-box; width: ${W}px; height: ${H}px; background: #141414; color: #cbcbcb; font: 14px/1.45 'Geist', sans-serif; padding: 26px 32px; overflow: hidden; }
  .opts * { box-sizing: border-box; }
  .otitle { font: 500 10.5px 'Geist Mono', monospace; letter-spacing: -.02em; text-transform: uppercase; color: #848484; margin-bottom: 12px; }
  .ogrid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 22px; }
  .otab { border: 1px solid #2c2c2c; border-radius: 8px; background: #1a1a1a; overflow: hidden; }
  .otab h3 { margin: 0; padding: 9px 14px; font: 500 12px 'Geist Mono', monospace; letter-spacing: -.02em; text-transform: uppercase; color: #cbcbcb; border-bottom: 1px solid #2c2c2c; display: flex; gap: 10px; }
  .otab h3 span { color: #848484; font-weight: 400; text-transform: none; letter-spacing: 0; font-family: 'Geist', sans-serif; font-size: 12px; }
  .orow { display: grid; grid-template-columns: 26px 210px 1fr 78px; gap: 10px; align-items: start; padding: 8px 14px; border-bottom: 1px solid #262626; font-size: 12.5px; }
  .orow:last-child { border-bottom: 0; }
  .orow .m { width: 14px; height: 14px; border-radius: 3px; border: 1px solid #3a3a3a; margin-top: 3px; display: grid; place-items: center; font-size: 10px; color: #77ac8d; }
  .orow.on .m { border-color: #834a2b; background: #2a1d14; color: #d19a72; }
  .orow.on { background: #1e1e1e; }
  .orow b { font-weight: 500; color: #e0e0e0; }
  .orow.on b { color: #f0e6da; }
  .orow p { margin: 0; color: #a6a6a6; }
  .orow i { font: 500 10px 'Geist Mono', monospace; letter-spacing: -.02em; text-transform: uppercase; color: #848484; font-style: normal; text-align: right; }
  .orow.on i { color: #d19a72; }
  .odev { margin-top: 16px; border: 1px solid #2c2c2c; border-radius: 8px; padding: 10px 14px; background: #171717; display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; }
  .odev div { font-size: 12px; color: #a6a6a6; line-height: 1.45; }
  .odev div b { display: block; font: 500 10.5px 'Geist Mono', monospace; letter-spacing: -.02em; text-transform: uppercase; color: #cbcbcb; margin-bottom: 3px; }
`;
const orow = (on, t, p, tag) => `<div class="orow${on ? ' on' : ''}"><span class="m">${on ? '✓' : ''}</span><b>${t}</b><p>${p}</p><i>${tag}</i></div>`;
const optionsBoard = () => `<div class="opts"><div class="otitle">The options, reviewed · the lit rows are the recommendation</div>
<div class="ogrid">
  <div class="otab"><h3>The signal <span>how we learn that something shipped</span></h3>
    ${orow(true, 'Your machine polls with gh', 'The daemon’s minute tick and the machine’s own gh login. Private repositories work. The platform holds no token. A cloud machine signs in through the browser terminal.', 'v1 · app')}
    ${orow(true, 'Our server reads public repositories', 'GitHub’s REST API with our own app token, public data only. This is the public door.', 'v1 · site')}
    ${orow(false, 'A GitHub Action sends the notes', 'The CI posts the release text to one endpoint. Private repositories work because the text travels and no token does.', 'v1.5')}
    ${orow(false, 'npx neuramesh announce', 'Reads the local remote and the latest tag, then posts to the same endpoint.', 'v1.5')}
    ${orow(true, 'The GitHub App for private repositories', 'Detected after the paste. The person grants read access on GitHub’s own page and picks the repositories. Tokens are minted per read and never stored. Its webhooks are the v1.5 hook for instant fires.', 'v1 · site')}
  </div>
  <div class="otab"><h3>The object <span>where a release’s drafts live</span></h3>
    ${orow(false, 'A channel per release', 'A channel is a folder of sessions and an ACL boundary, with agents registered to it and a setup task. One per release fills the rail and answers no question.', 'no')}
    ${orow(true, 'A session per release', 'The routine’s own thread in the project’s marketing room. Drafts are thread-native cards. A quiet day opens nothing.', 'v1')}
    ${orow(true, 'A unit anchored to that session', 'The playbook unit holds the work record, the brief and the acceptance. It never earns a nav row. The thread shows its cards.', 'v1')}
  </div>
  <div class="otab"><h3>The engine <span>who drafts, and how</span></h3>
    ${orow(false, 'rex drafts in the thread', 'One turn on the chat registry with draft_posts. Fast, but no file tools, no image lane with the designer, no acceptance record. The public door uses this shape on the Starter brain, as a queued job.', 'site only')}
    ${orow(true, 'A playbook unit, born approved', 'The release playbook in the registry. plume on the worker lane with the brand docs staged and the skill loaded. posts.json and the brief attach to the unit. The routine is hands-off, and the human’s gate is the card.', 'v1')}
    ${orow(false, 'A content task the human plans first', 'A plan review on a canned template is a second consent for the same click. The marketing-os round retired it.', 'no')}
  </div>
  <div class="otab"><h3>The doors <span>where it is switched on</span></h3>
    ${orow(true, 'Setup step 5 of 5', 'The marketing wizard ends with the repository, the accounts, and two switches: draft the latest release now, watch daily.', 'v1')}
    ${orow(true, 'The Marketing OS catalog row', 'Release announcement, with the armed cadence as its fact. Run for… drafts the latest release once.', 'v1')}
    ${orow(true, 'Automations › Routines', 'The routine card like every other, with its ledger: one row per checked window, quiet days included.', 'v1')}
    ${orow(true, 'neuramesh.app/announce', 'Paste a repository, leave a website and an email, get the link by email, sign in to save and schedule. The website is the brand read, the email is the spam gate.', 'v1')}
    ${orow(false, 'The terminal and the CI', 'Two more doors onto the same endpoint.', 'v1.5')}
  </div>
</div>
<div class="odev">
  <div><b>No channel per release</b>A session per release in the marketing room. The rail stays a list of work.</div>
  <div><b>The App reads, the machine polls</b>In the app the tick polls with gh. On the site the GitHub App reads a private repository. Its webhooks are v1.5.</div>
  <div><b>Detection is code</b>The scan, the cursor and the dedupe are code. The feature call is the agent’s, in the thread, with its reasons.</div>
  <div><b>One image, always</b>Every draft set carries a release card on the site’s palette. A screen capture of the feature is phase 2.</div>
  <div><b>Email is the gate</b>The public door asks for an email and a website. The email carries the link and bounds the spend. The daily watch is a Team routine.</div>
</div></div>`;

/* ── the boards, the notes, the canvas ── */
const shellPage = (theme, inner, opts) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${opts.title}</title>${FONTS}<style>${SHELL}${THREAD}</style></head><body>${frame(theme, inner, opts.rail ?? {})}</body></html>`;
const sitePage = (theme, state, title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${FONTS}<style>body{margin:0}${SITE}</style></head><body>${siteBoard(theme, state)}</body></html>`;
const plainPage = (css, body, title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${FONTS}<style>body{margin:0}${css}</style></head><body>${body}</body></html>`;

const BOARDS = [
  { file: 'Setup.dc.html', title: 'A · setup, step 5 of 5 · graphite', x: 0, y: 0, html: () => shellPage('graphite', wizardSheet(), { title: 'A · setup, step 5 of 5 · graphite', rail: { on: 'setup' } }) },
  { file: 'Thread.dc.html', title: 'B · the release session · graphite', x: 1580, y: 0, html: () => shellPage('graphite', threadSheet(), { title: 'B · the release session · graphite', rail: { on: 'release' } }) },
  { file: 'ThreadCream.dc.html', title: 'B · the release session · cream oak', x: 3160, y: 0, html: () => shellPage('cream', threadSheet(), { title: 'B · the release session · cream oak', rail: { on: 'release' } }) },
  { file: 'Routines.dc.html', title: 'C · Automations › Routines · the ledger', x: 0, y: 1260, html: () => shellPage('graphite', routinesSheet(), { title: 'C · Automations › Routines · the ledger', rail: { dest: 'routines' } }) },
  { file: 'AnnounceForm.dc.html', title: 'D1 · announce · a public repository · the form', x: 1580, y: 1260, html: () => sitePage('light', 'form', 'D1 · announce · a public repository · the form') },
  { file: 'AnnouncePrivate.dc.html', title: 'D2 · announce · a private repository · the grant', x: 3160, y: 1260, html: () => sitePage('light', 'private', 'D2 · announce · a private repository · the grant') },
  { file: 'AnnounceWait.dc.html', title: 'D3 · announce · the wait and the email', x: 0, y: 2520, html: () => sitePage('light', 'wait', 'D3 · announce · the wait and the email') },
  { file: 'Announce.dc.html', title: 'D4 · announce · ready · paper', x: 1580, y: 2520, html: () => sitePage('light', 'ready', 'D4 · announce · ready · paper') },
  { file: 'AnnounceDark.dc.html', title: 'D4 · announce · ready · graphite', x: 3160, y: 2520, html: () => sitePage('dark', 'ready', 'D4 · announce · ready · graphite') },
  { file: 'Architecture.dc.html', title: 'E · how it runs · two lanes', x: 0, y: 3780, html: () => plainPage(DIAG, archBoard(), 'E · how it runs · two lanes') },
  { file: 'Options.dc.html', title: 'F · the options, reviewed', x: 1580, y: 3780, html: () => plainPage(OPTS, optionsBoard(), 'F · the options, reviewed') },
];

const NOTES = [
  { id: 'note-top', x: 0, y: -300, w: 4600, text: `RELEASE DRAFTS · the repository is a marketing source (design round 1, 2026-09-17, revised the same evening with George's two notes on the public door)
NeuraMesh watches a project's repository from the machine that already holds the gh login. Once a day the daemon's tick scans for releases and merged pull requests since the last check. A quiet window opens nothing. A window with candidates opens ONE session in the project's marketing room, titled by the release, with the digest as its first message. rex judges whether a feature shipped and which one, then starts the release announcement playbook: a unit born approved, worked by plume on the worker lane with the brand docs staged. The unit lands a release brief and one draft per connected account, and the session shows them as the same post cards the product already has. The human approves, schedules, or asks for changes on the card. Publishing stays human and rides the sealed connectors. The public door, neuramesh.app/announce, detects whether the repository is public or private (a private one is granted through the NeuraMesh GitHub App, read only, their pick of repositories), asks for a website and an email, runs the same drafting as a queued job on our server with the Starter brain, draws a release card on the site's palette, emails the link when the drafts are ready, and imports them into a workspace on sign in. No channel per release, no token stored on the platform.` },
  { id: 'note-a', x: 0, y: 1020, w: 1440, text: `A · SETUP, STEP 5 OF 5. The marketing wizard gains one optional step after Connect. The repository comes from the project (Change opens the attach flow). The accounts are the connected ones, read from the same rows the room's Connections list reads. Two switches: draft the latest release now (a one-shot, free on every plan, the demo you own), and watch the repository daily (a routine, so Team). Put the crew to work runs marketing.setup as today. It plants the one-shot beside the brand bootstrap, and the daily routine when the switch is on.` },
  { id: 'note-b', x: 1580, y: 1020, w: 1440, text: `B · THE RELEASE SESSION. A routine-born thread in #marketing, titled once by the agent from the feature. The first message is the fire's digest as the owner's message: the release, its notes, the merged pull requests. rex says what shipped and why it counts, and the unit card sits under it. plume's completion note carries the release brief card (the feature, the reasons, the audience, the assets, and what is not known) and the drafts row: X, LinkedIn, Instagram with the release card, TikTok as an inbox draft. The cards are the product's SocialPostCard from one derivation. The header wears needs you until the cards are answered. The composer already knows how to ask for changes on a card.` },
  { id: 'note-bc', x: 3160, y: 1020, w: 1440, text: `B · CREAM OAK. The same session in the signature light. The transcript is ground, the brief card and the post cards are the elevated stratum, the human's digest keeps its hairline bubble.` },
  { id: 'note-c', x: 0, y: 2280, w: 1440, text: `C · ROUTINES. The release routine is a routine like every other: pause, edit, remove, and a ledger. The ledger differs in one way: a quiet window is a row too, so the human can see the routine checked and found nothing. A window with fixes only reads as settled with Draft anyway, which posts the ask into the room and drafts that release once.` },
  { id: 'note-d1', x: 1580, y: 2280, w: 1440, text: `D1 · THE FORM. The paste is detected at once: public, and the latest release named under the input. Then two fields. The website, prefilled from the repository's homepage, is the brand read: the palette and the fonts from its CSS, the voice from its copy, the way the marketing bootstrap reads a site today. The email carries the link when the drafts are ready, and it bounds the spend: one draft set per release per email, caps per address. One button. The note says how long it takes and that the page can be closed.` },
  { id: 'note-d2', x: 3160, y: 2280, w: 1440, text: `D2 · A PRIVATE REPOSITORY. GitHub answers 404 to a stranger for a private repository and for a missing one, so the row says both. The grant card names exactly what the NeuraMesh GitHub App reads (releases, pull requests, README, CHANGELOG), what it never does, and how tokens work (minted per read, one hour, never stored, revocable on GitHub). The button opens GitHub's own install page, where the person picks the repositories. The callback re-runs the detect, and the form appears. The App's webhooks are the v1.5 hook for instant fires.` },
  { id: 'note-d3', x: 0, y: 3540, w: 1440, text: `D3 · THE WAIT AND THE EMAIL. After the button, the job is a queued row a minute cron works. The page shows the first-run card's status rows (docs/33 §8): the release, the site, the drafts, the release card, each READY or PLEASE WAIT, and the line that says the email is coming. The email follows docs/28: it opens on the scene (three drafts, the feature, the networks, the card), one button to the drafts, one line about sign in, and the honest closer for a stranger's address. The page updates itself while it is open, so nobody has to wait for the email.` },
  { id: 'note-d4', x: 1580, y: 3540, w: 1440, text: `D4 · READY. The result: the release, the verdict, the feature title, and three posts. Instagram carries the release card drawn on the site's palette, so every set has at least one image. Sign in to save and schedule imports the drafts into a workspace as the session in board B, and the website goes into the marketing profile so the room's brand docs start from it. The three doors at the foot are one endpoint: the app, the terminal, the CI.` },
  { id: 'note-d4d', x: 3160, y: 3540, w: 1440, text: `D4 · GRAPHITE. The site's dark twin, the same page.` },
  { id: 'note-e', x: 0, y: 4800, w: 1440, text: `E · HOW IT RUNS. Two lanes, one endpoint. In the app, the scan is code on the machine, the judgment is the agent's in the thread, the gate is the human's on the card, and the publish cron is the one server-side act. On the public door, the detect decides public or private, the App grant is the human's act, the form is the spend gate, a minute cron works the job (reads, one Starter turn, the release card), the email carries the link, and sign in hands the result to a workspace. The dashed line from the page back to the session is the point: the public page is the first mile of the same road.` },
  { id: 'note-f', x: 1580, y: 4800, w: 1440, text: `F · THE OPTIONS. Four decisions, the lit rows are the recommendation, and the strip at the foot names what this round changes from the rough draft.` },
];

for (const b of BOARDS) writeFileSync(join(HERE, b.file), b.html());
writeFileSync(join(HERE, 'canvas.json'), JSON.stringify({
  artboards: BOARDS.map((b) => ({ file: b.file, x: b.x, y: b.y, w: W, h: H, title: b.title })),
  annotations: NOTES,
  launch: { fit: 'all' },
}, null, 2) + '\n');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const canvas = `<title>Release Drafts</title>
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
<div class="hud"><h1>Release Drafts<small>design round 1, revised · 2026-09-17</small></h1><button data-fit="all">Fit</button><button data-fit="one">100%</button><span class="sp"></span>${BOARDS.map((b, i) => `<button data-board="${i}">${esc(b.title)}</button>`).join('')}</div>
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
