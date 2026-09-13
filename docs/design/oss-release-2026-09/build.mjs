// Generates the design-canvas artboards for the source-release round (2026-09-12): Local mode's first
// run and stack states, the rail with LOCAL and CLOUD bands, the Upgrade to Pro sheet, Settings ›
// Connections, and the hosted paywalled shell. Every value is lifted from tokens.css (the two doctrine
// themes, the rail recipes of the nav-recents round, the .hcomposer recipe of the home-threads round,
// the .upmodal recipe) at the 14px reading step of 2026-09-12 (nav 320, rows 14/450 in 30px).
// Geist stands in for NeuraMesh Sans in a mockup (the house face is a renamed Geist build).
// Run: node build.mjs   ·   View: open index.html (lays the artboards out from canvas.json)
import { writeFileSync } from 'node:fs';

const THEMES = {
  graphite: { win: '#0d0d0d', bg: '#141414', panel: '#161616', panel2: '#1a1a1a', panel3: '#262626', border: '#262626', border2: '#3a3a3a', cardBorder: '#2c2c2c', card: '#1e1e1e',
    text: '#cbcbcb', body: '#a6a6a6', muted: '#848484', dim: '#6a6a6a', link: '#d19a72', brand: '#834a2b', brandInk: '#fff7ee', green: '#77ac8d', warn: '#c9a15e', prog: '#8ba0c0', accent: '#cbcbcb', done: '#77ac8d', planrev: '#a89ccf',
    overlay: '#222222', shadow: 'rgba(0,0,0,0.62)', hoverBg: 'color-mix(in srgb, #cbcbcb 7%, transparent)', selBg: 'color-mix(in srgb, #cbcbcb 10%, transparent)', ring: '#525252',
    shadowCard: '0 1px 2px rgba(0,0,0,.25)', shadowSheet: '0 1px 2px rgba(0,0,0,.35), 0 12px 32px -12px rgba(0,0,0,.6)', shadowPop: '0 20px 55px -14px rgba(0,0,0,.65)', boxbg: '#1a1a1a', veil: 'color-mix(in srgb, #0d0d0d 62%, transparent)' },
  cream: { win: '#f0e5d3', bg: '#fbf8f4', panel: '#fbf8f4', panel2: '#f6eee1', panel3: '#efe1cd', border: '#e6dbca', border2: '#d3c2a8', cardBorder: '#eadfce', card: '#ffffff',
    text: '#3a2c22', body: '#5b4c3d', muted: '#8b7861', dim: '#a99680', link: '#9c5730', brand: '#834a2b', brandInk: '#fff7ee', green: '#2f9e6b', warn: '#a06a1f', prog: '#4f80c4', accent: '#834a2b', done: '#0f9d63', planrev: '#7d56b8',
    overlay: '#ffffff', shadow: 'rgba(70,42,18,0.16)', hoverBg: 'color-mix(in srgb, #3a2c22 5%, transparent)', selBg: 'color-mix(in srgb, #834a2b 8%, transparent)', ring: 'color-mix(in srgb, #834a2b 42%, #d3c2a8)',
    shadowCard: '0 1px 2px rgba(70,42,18,.05)', shadowSheet: '0 1px 2px rgba(70,42,18,.06), 0 12px 32px -12px rgba(70,42,18,.18)', shadowPop: '0 20px 55px -14px rgba(70,42,18,.30)', boxbg: '#ffffff', veil: 'color-mix(in srgb, #f0e5d3 62%, transparent)' },
};
const tokens = (t) => Object.entries({ '--win': t.win, '--bg': t.bg, '--panel': t.panel, '--panel2': t.panel2, '--panel3': t.panel3, '--border': t.border, '--border2': t.border2, '--card-border': t.cardBorder, '--card': t.card,
  '--text': t.text, '--body': t.body, '--muted': t.muted, '--dim': t.dim, '--link': t.link, '--brand': t.brand, '--brand-ink': t.brandInk, '--green': t.green, '--warn': t.warn, '--prog': t.prog, '--accent': t.accent, '--done': t.done, '--planrev': t.planrev,
  '--overlay': t.overlay, '--shadow': t.shadow, '--hover-bg': t.hoverBg, '--sel-bg': t.selBg, '--ring': t.ring, '--shadow-card': t.shadowCard, '--shadow-sheet': t.shadowSheet, '--shadow-pop': t.shadowPop, '--boxbg': t.boxbg, '--veil': t.veil,
  '--r-xs': '3px', '--r-sm': '4px', '--r-md': '6px', '--r-lg': '8px' }).map(([k, v]) => `${k}:${v};`).join('');

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;450;500;600&amp;family=Geist+Mono:wght@500;600&amp;family=Bricolage+Grotesque:wght@600&amp;display=swap">';

const CSS = `
  body { margin: 0; }
  a { color: var(--link); text-decoration: none; }
  .frame { --fbody: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; --fmono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace; --fbrand: 'Bricolage Grotesque', var(--fbody);
    position: relative; box-sizing: border-box; background: var(--win); color: var(--text); font: 14px/1.5 var(--fbody); -webkit-font-smoothing: antialiased; overflow: hidden; display: flex; flex-direction: column; }
  .frame *, .frame *::before, .frame *::after { box-sizing: border-box; }
  .frame.row { flex-direction: row; }
  .lbl { position: absolute; left: 12px; bottom: 8px; font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); z-index: 5; }
  /* ── the frame top: mark · wordmark · fold pin · search pill · the ambient utilities · the sync mark ── */
  .ftop { flex: none; display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px 0 14px; }
  .mark { width: 16px; height: 16px; display: inline-grid; place-items: center; color: var(--brand); }
  .wordmark { font: 600 14px var(--fbrand); letter-spacing: -.015em; color: var(--text); }
  .ftico { width: 24px; height: 24px; display: grid; place-items: center; color: var(--muted); border-radius: var(--r-xs); }
  .ftgrow { flex: 1; }
  .searchpill { display: inline-flex; align-items: center; gap: 8px; height: 26px; padding: 0 10px; border-radius: var(--r-xs); border: 1px solid var(--border2); color: var(--dim); font-size: 12.5px; min-width: 260px; }
  .searchpill .kbd { margin-left: auto; font: 500 10px var(--fmono); color: var(--dim); }
  .livepill { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: var(--r-xs); color: var(--muted); font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; }
  .livepill .ld { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
  .procs { font: 500 10px var(--fmono); color: var(--dim); }
  .body2 { flex: 1; min-height: 0; display: flex; }
  /* ── the rail (nav-recents recipes at the 14px step) ── */
  .nav { width: 320px; flex: none; display: flex; flex-direction: column; padding: 4px 0 0; height: 100%; }
  .sheet { flex: 1; min-width: 0; margin: 2px 8px 8px 4px; background: var(--bg); border-radius: var(--r-lg); box-shadow: var(--shadow-sheet); position: relative; overflow: hidden; }
  .navseg { display: flex; margin: 6px 8px 2px; padding: 3px; background: var(--panel2); border-radius: var(--r-xs); }
  .navseg span { flex: 1; text-align: center; font: 500 13px var(--fbody); color: var(--muted); padding: 5px 0; border-radius: var(--r-xs); }
  .navseg span.on { background: var(--panel3); color: var(--text); }
  .navnew { display: flex; align-items: center; gap: 4px; padding: 6px 8px 12px; }
  .navnew .row { display: flex; align-items: center; gap: 11px; flex: 1; height: 32px; padding: 0 9px; border-radius: var(--r-md); color: var(--body); font-size: 14px; font-weight: 500; }
  .navnew .row svg { color: var(--muted); } .navnew .kbd { margin-left: auto; font: 500 10px var(--fmono); color: var(--dim); }
  .navnew .caret { width: 26px; height: 26px; display: grid; place-items: center; color: var(--muted); }
  .navsect { padding: 12px 16px 4px; font: 500 10px var(--fmono); letter-spacing: -.02em; color: var(--muted); text-transform: uppercase; display: flex; align-items: center; gap: 6px; }
  .navsect .chev { color: var(--dim); display: inline-grid; }
  .navitem { display: flex; align-items: center; gap: 11px; margin: 0 8px; width: calc(100% - 16px); height: 32px; padding: 0 9px; border-radius: var(--r-md); color: var(--body); font-size: 14px; font-weight: 500; }
  .navitem svg { color: var(--muted); flex: none; }
  .navitem .navlabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .navitem.sub { padding-left: 44px; height: 28px; font-size: 13px; }
  .navitembadge { font: 600 10px var(--fmono); color: var(--muted); background: var(--panel3); border-radius: 999px; padding: 1px 7px; }
  .navitem .chev { color: var(--dim); }
  .navlist { flex: 1; min-height: 0; overflow: hidden; }
  .navgrphd { display: flex; align-items: center; gap: 7px; padding: 12px 8px 4px 12px; min-width: 0; }
  .navprojchev { width: 18px; height: 18px; display: grid; place-items: center; color: var(--dim); }
  .navgrphdlbl { font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); }
  .navgrphdlbl.on { color: var(--text); }
  .navgrphdsep { font: 500 10px var(--fmono); color: var(--dim); opacity: .6; }
  .navgrphdcnt { font: 600 10px var(--fmono); color: var(--dim); opacity: .8; }
  .navscopegrow { flex: 1; }
  .navhistfind { width: 22px; height: 22px; display: grid; place-items: center; color: var(--muted); opacity: .5; border-radius: var(--r-sm); }
  /* the connection bands: the .navsect voice, a kicker over the rows it holds, only when two connections exist */
  .navband { display: flex; align-items: center; gap: 6px; padding: 10px 12px 2px 12px; font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--muted); }
  .navband .chev { width: 14px; height: 14px; display: inline-grid; place-items: center; color: var(--dim); } .navband .chev.c { transform: rotate(-90deg); }
  .navband .cnt { font-weight: 600; color: var(--dim); opacity: .8; }
  .navband .grow { flex: 1; }
  .navband .pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--prog); box-shadow: 0 0 0 3px color-mix(in srgb, var(--prog) 22%, transparent); }
  .navgrp { margin-top: 2px; }
  .navgrprow { display: flex; align-items: center; gap: 9px; width: calc(100% - 16px); margin: 1px 8px; height: 28px; padding: 0 9px 0 10px; border-radius: var(--r-md); color: var(--body); }
  .navgrprow .navhistglyph { color: var(--dim); }
  .navgrpname { flex: 1; min-width: 0; font-size: 13px; font-weight: 400; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .navhisttrail { display: inline-flex; align-items: center; gap: 6px; flex: none; }
  .navhistfact { font: 500 10px var(--fmono); color: var(--dim); }
  .navgrpchev { display: inline-grid; color: var(--dim); } .navgrpchev.c { transform: rotate(-90deg); }
  .navhistask { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 26%, transparent); }
  .navhistrow { display: flex; align-items: center; gap: 9px; width: calc(100% - 16px); margin: 1px 8px; height: 30px; padding: 0 9px 0 10px; border-radius: var(--r-md); color: var(--body); }
  .navhistrow.in { padding-left: 32px; }
  .navhistrow.on { background: var(--card); box-shadow: var(--shadow-card); }
  .navhistglyph { flex: none; width: 14px; height: 14px; display: grid; place-items: center; color: var(--dim); }
  .navhistglyph .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .navhisttitle { flex: 1; min-width: 0; font-size: 14px; font-weight: 450; color: var(--body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .navhistrow.on .navhisttitle { color: var(--text); font-weight: 500; }
  .navhisttitle b { font: 500 11px var(--fmono); color: var(--dim); margin-right: 5px; }
  .navhiststat { font: 500 9.5px var(--fmono); letter-spacing: -.01em; white-space: nowrap; padding: 2px 5px; border-radius: var(--r-xs); border: 1px solid transparent; flex: none; }
  .st-settled { background: var(--panel3); color: var(--muted); border-color: var(--border2); }
  .st-ip { background: color-mix(in srgb, var(--prog) 16%, transparent); color: var(--prog); }
  .st-ny { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
  .navgrpmore { display: block; margin: 1px 8px 4px; padding: 0 9px 0 32px; height: 26px; font: 500 12.5px var(--fbody); color: var(--dim); line-height: 26px; }
  .navgrpmore.flat { padding-left: 19px; }
  /* the foot: tile · name · the connection glyph · caret · (credit ring only on a cloud connection) · avatar */
  .navfoot { display: flex; align-items: center; gap: 8px; margin: 4px 8px 6px; padding: 5px 6px; margin-top: auto; border-radius: var(--r-md); border: 1px solid transparent; position: relative; }
  .navfoot.open { background: var(--card); border-color: var(--card-border); box-shadow: var(--shadow-card); }
  .wstile { width: 24px; height: 24px; border-radius: var(--r-sm); background: var(--panel3); border: 1px solid var(--border2); display: grid; place-items: center; font: 600 11px var(--fmono); color: var(--body); position: relative; flex: none; }
  .wstile i { position: absolute; top: -3px; right: -3px; width: 7px; height: 7px; border-radius: 50%; background: var(--warn); border: 1.5px solid var(--win); }
  .wsname { font-size: 12.5px; font-weight: 600; color: var(--body); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wsconn { display: inline-grid; place-items: center; color: var(--dim); }
  .credring { width: 22px; height: 22px; flex: none; }
  .avatar { width: 22px; height: 22px; border-radius: var(--r-xs); background: var(--panel3); border: 1px solid var(--border2); display: grid; place-items: center; font: 600 10px var(--fmono); color: var(--body); flex: none; }
  /* the foot's menu: the popover recipe, anchored above the foot */
  .wsmenu { position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); background: var(--card); border: 1px solid var(--card-border); border-radius: var(--r-md); box-shadow: var(--shadow-pop); padding: 6px; }
  .wsmenu .k { padding: 8px 8px 3px; font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); display: flex; align-items: center; gap: 6px; }
  .wsmenu .k .pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--prog); }
  .wsrow { display: flex; align-items: center; gap: 9px; height: 30px; padding: 0 8px; border-radius: var(--r-sm); color: var(--body); font-size: 13.5px; }
  .wsrow.on { background: var(--sel-bg); color: var(--text); }
  .wsrow .wstile { width: 18px; height: 18px; font-size: 9px; }
  .wsrow .sub { margin-left: auto; font: 500 10px var(--fmono); color: var(--dim); }
  .wsrow svg { color: var(--muted); }
  .wsmenu hr { border: 0; border-top: 1px solid var(--border); margin: 6px 4px; }
  /* ── the elevated stratum ── */
  .card { background: var(--card); border: 1px solid var(--card-border); border-radius: var(--r-lg); box-shadow: var(--shadow-card); }
  .eyebrow { font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); }
  .h1 { margin: 0; font-size: 20px; font-weight: 500; letter-spacing: -.02em; line-height: 1.25; color: var(--text); }
  .h2 { margin: 0; font-size: 16px; font-weight: 500; letter-spacing: -.02em; line-height: 1.3; color: var(--text); }
  .p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--body); }
  .p.dim { color: var(--muted); }
  .mono { font: 500 11px var(--fmono); letter-spacing: -.02em; color: var(--dim); }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 34px; padding: 0 14px; border-radius: var(--r-xs); border: 1px solid var(--border2); background: transparent; color: var(--body); font: 500 11px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; white-space: nowrap; position: relative; overflow: hidden; }
  .btn.sec { background: var(--card); }
  .btn.primary { background: var(--brand); border-color: var(--brand); color: var(--brand-ink); }
  .btn.primary::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--brand-ink) 7%, transparent) 6px 7px); }
  .btn.sm { height: 28px; padding: 0 10px; font-size: 10px; }
  .btn.quiet { border-color: transparent; color: var(--muted); }
  .actions { display: flex; align-items: center; gap: 8px; }
  .actions .grow { flex: 1; }
  .kbdhint { font: 500 10px var(--fmono); color: var(--dim); }
  /* first-run card, centred on the frame */
  .center { flex: 1; display: grid; place-items: center; padding: 24px; }
  .setup { width: 460px; padding: 26px 26px 20px; display: flex; flex-direction: column; gap: 14px; }
  .setup .h1 { margin-top: 2px; }
  .engrow { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-md); }
  .engrow .nm { font-size: 14px; font-weight: 500; color: var(--text); min-width: 118px; }
  .engrow .fact { font-size: 12.5px; color: var(--muted); flex: 1; }
  .engrow .go { font: 500 11px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--link); }
  .engrow.on { border-color: var(--border2); background: var(--sel-bg); }
  .radio { flex: none; width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--border2); }
  .radio.on { border-color: var(--accent); background: radial-gradient(circle, var(--accent) 42%, transparent 48%); }
  .engtag { font: 500 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--muted); }
  .facts { display: grid; grid-template-columns: 110px 1fr; row-gap: 0; }
  .facts .k { font-size: 13.5px; color: var(--muted); padding: 7px 0; border-top: 1px solid var(--border); }
  .facts .v { font-size: 13.5px; color: var(--body); padding: 7px 0; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 8px; }
  .facts .v .ok { font: 500 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--green); }
  .prow { display: grid; grid-template-columns: 1fr auto; row-gap: 6px; column-gap: 12px; align-items: center; padding: 8px 0; }
  .prow .nm { font-size: 14px; color: var(--body); display: flex; align-items: center; gap: 8px; }
  .prow .nm svg { color: var(--green); }
  .prow .sz { font: 500 11px var(--fmono); color: var(--dim); }
  .prow .bar { grid-column: 1 / -1; height: 4px; border-radius: 999px; background: var(--panel3); overflow: hidden; }
  .prow .bar i { display: block; height: 100%; background: var(--body); border-radius: 999px; }
  .srow { display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 4px; border-bottom: 1px solid var(--border); }
  .srow:last-child { border-bottom: 0; }
  .srow .nm { font-size: 14px; color: var(--body); flex: 1; }
  .srow .st { font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); display: inline-flex; align-items: center; gap: 6px; }
  .srow .st.ok { color: var(--green); }
  .srow .st .wait { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 22%, transparent); }
  .setupfoot { display: flex; align-items: center; gap: 8px; margin-top: 2px; padding-top: 12px; border-top: 1px solid var(--border); }
  /* ── Home stage (home-threads recipe, trimmed) ── */
  .stage { width: 760px; margin: 0 auto; padding-top: 54px; display: flex; flex-direction: column; }
  .stagehead { font-size: 29px; font-weight: 500; letter-spacing: -.03em; line-height: 1.25; text-align: center; margin: 0 0 22px; color: var(--text); text-wrap: balance; }
  .stagehead .q { color: var(--muted); }
  .hcomposer { position: relative; background: var(--boxbg); border: 1px solid var(--border); border-radius: var(--r-md); padding: 13px 14px 11px; box-shadow: var(--shadow-card); }
  .chint { display: flex; align-items: center; gap: 8px; margin: -13px -14px 10px; padding: 8px 14px; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); background: color-mix(in srgb, var(--panel2) 30%, transparent); border-radius: inherit; border-bottom-left-radius: 0; border-bottom-right-radius: 0; color: var(--muted); font-size: 12px; }
  .chintat { font-weight: 600; color: var(--text); }
  .pav { width: 16px; height: 16px; border-radius: var(--r-xs); background: var(--panel3); flex: none; }
  .ta { min-height: 40px; font-size: 14px; line-height: 1.5; color: var(--dim); }
  .hrow { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
  .cchip { display: inline-flex; align-items: center; gap: 5px; padding: 3.5px 8px; border-radius: var(--r-xs); border: 1px solid transparent; color: var(--dim); font-size: 12px; font-weight: 600; white-space: nowrap; }
  .cchip .car { font-size: 8px; } .cchip svg { opacity: .85; }
  .brainavs { display: inline-flex; margin-left: 2px; } .brainavs .pav { width: 14px; height: 14px; margin-left: -5px; border: 1.5px solid var(--card); } .brainavs .pav:first-child { margin-left: 0; }
  .hsend { flex: none; width: 32px; height: 32px; display: grid; place-items: center; border-radius: var(--r-xs); background: var(--panel3); color: var(--dim); margin-left: auto; }
  .sgroup { display: flex; align-items: center; gap: 8px; font: 600 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); padding: 22px 12px 5px; }
  .sgroup .rule { flex: 1; height: 1px; background: var(--border); }
  .histrow { display: flex; align-items: center; gap: 11px; padding: 9px 11px; border-radius: var(--r-md); color: var(--text); }
  .histico { flex: none; width: 30px; height: 30px; border-radius: var(--r-sm); display: grid; place-items: center; background: var(--card); border: 1px solid var(--card-border); color: var(--muted); }
  .histbody { flex: 1; min-width: 0; }
  .histtitle { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .histsnip { font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
  .histwhen { flex: none; font-size: 11px; color: var(--dim); display: inline-flex; align-items: center; gap: 8px; }
  .chip { display: inline-flex; align-items: center; font: 500 10px var(--fmono); letter-spacing: -.02em; padding: 3px 7px; border-radius: var(--r-xs); text-transform: uppercase; white-space: nowrap; }
  /* ── the veil and the upgrade sheet (.upmodal recipe) ── */
  .veil { position: absolute; inset: 0; background: var(--veil); backdrop-filter: blur(14px); display: grid; place-items: center; }
  .upmodal { width: 620px; background: var(--overlay); border: 1px solid var(--card-border); border-radius: var(--r-lg); box-shadow: var(--shadow-pop); padding: 24px 26px 18px; position: relative; display: flex; flex-direction: column; gap: 12px; }
  .upx { position: absolute; top: 10px; right: 10px; width: 26px; height: 26px; display: grid; place-items: center; color: var(--muted); }
  .upgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 6px; }
  .upcard { background: var(--card); border: 1px solid var(--card-border); border-radius: var(--r-lg); padding: 16px 16px 14px; display: flex; flex-direction: column; gap: 10px; }
  .upcard.rec { border-color: var(--border2); }
  .uphead { display: flex; align-items: center; gap: 10px; }
  .upico { width: 30px; height: 30px; border-radius: var(--r-sm); background: var(--panel2); display: grid; place-items: center; color: var(--body); flex: none; }
  .upname { font-size: 15px; font-weight: 500; color: var(--text); display: flex; align-items: center; gap: 8px; }
  .uptag { font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); }
  .uprec { font: 500 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--brand); background: color-mix(in srgb, var(--brand) 12%, transparent); padding: 2px 6px; border-radius: var(--r-xs); }
  .upprice { font-size: 22px; font-weight: 500; letter-spacing: -.02em; color: var(--text); }
  .upprice small { font-size: 12px; font-weight: 400; color: var(--muted); letter-spacing: 0; margin-left: 4px; }
  .uplist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .uplist li { display: flex; gap: 8px; font-size: 13px; color: var(--body); line-height: 1.4; }
  .uplist li::before { content: ''; flex: none; width: 5px; height: 5px; margin-top: 7px; border-radius: 50%; background: var(--dim); }
  .upfoot { display: flex; align-items: center; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border); }
  .orbph { width: 44px; height: 44px; border-radius: 50%; border: 2px dotted var(--muted); margin: 6px auto 4px; }
  /* ── settings ── */
  .topbar { display: flex; align-items: baseline; gap: 12px; padding: 22px 28px 12px; }
  .topbar h1 { margin: 0; font-size: 22px; font-weight: 500; letter-spacing: -.02em; color: var(--text); }
  .setcol { width: 680px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; padding-bottom: 24px; }
  .setcard { padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; }
  .sethead { display: flex; align-items: center; gap: 10px; padding-bottom: 10px; }
  .sethead .ico { width: 28px; height: 28px; border-radius: var(--r-sm); background: var(--panel2); display: grid; place-items: center; color: var(--body); }
  .sethead .nm { font-size: 15px; font-weight: 500; color: var(--text); }
  .sethead .st { font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--muted); display: inline-flex; align-items: center; gap: 6px; margin-left: 6px; }
  .sethead .st .d { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
  .sethead .grow { flex: 1; }
  .krow { display: flex; align-items: center; gap: 12px; min-height: 34px; padding: 0 2px; border-top: 1px solid var(--border); font-size: 13.5px; }
  .krow .k { width: 96px; color: var(--muted); flex: none; }
  .krow .v { color: var(--body); flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; }
  .krow .v code { font: 500 12px var(--fmono); color: var(--body); }
  .krow .v .tag { font: 500 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--green); }
  .krow .v .lnk { font: 500 11px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--link); }
  .krow .sub { font-size: 12px; color: var(--muted); }
  .tog { width: 30px; height: 18px; border-radius: 999px; background: var(--panel3); border: 1px solid var(--border2); position: relative; flex: none; }
  .tog i { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--card); box-shadow: var(--shadow-card); }
  .tog.on { background: var(--accent); border-color: var(--accent); } .tog.on i { left: 14px; }
  .field { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  .input { flex: 1; height: 34px; padding: 0 10px; border-radius: var(--r-xs); border: 1px solid var(--border2); background: var(--card); color: var(--dim); font-size: 13.5px; display: flex; align-items: center; }
  /* ── the hosted shell ── */
  .thhead { display: flex; align-items: center; gap: 10px; padding: 14px 28px 10px; }
  .crumb { font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); }
  .thtitle { font-size: 15px; font-weight: 500; color: var(--text); }
  .thcol { width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; padding-top: 10px; }
  .msg { display: flex; gap: 12px; }
  .msg .pav { width: 26px; height: 26px; border-radius: var(--r-sm); margin-top: 2px; }
  .msg .who { font-size: 12.5px; color: var(--muted); margin-bottom: 2px; } .msg .who b { color: var(--text); font-weight: 500; }
  .msg .txt { font-size: 14px; line-height: 1.55; color: var(--body); }
  .msg.me { justify-content: flex-end; }
  .msg.me .bub { max-width: 70%; background: var(--card); border: 1px solid var(--card-border); border-radius: var(--r-lg); padding: 9px 13px; font-size: 14px; line-height: 1.55; color: var(--text); }
  .gate { margin-top: auto; padding: 18px 20px 14px; display: flex; flex-direction: column; gap: 10px; }
  .gate .h2 { font-size: 17px; }
  .gatefoot { margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--border); }
`;

// ── glyphs (24 grid, currentColor) ──
const G = {
  compose: '<path d="M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6"/><path d="M18.4 3.6a2 2 0 0 1 2.8 2.8L13 14.6l-3.8.9.9-3.8z"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>', chevr: '<path d="M9 6l6 6-6 6"/>', chevu: '<path d="M6 15l6-6 6 6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>',
  threads: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 2"/>',
  circle: '<circle cx="12" cy="12" r="6.5"/>',
  check: '<circle cx="12" cy="12" r="8"/><path d="m8.5 12.3 2.4 2.4 4.6-5"/>',
  tick: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  folderopen: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M3 19v-8h16.4a1 1 0 0 1 .96 1.28l-1.7 6a1 1 0 0 1-.96.72H5a2 2 0 0 1-2-2z"/>',
  whiteboard: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 14.5 3.2-4.2 2.6 3 3.9-5.3"/>',
  repeat: '<path d="M17 2.5l4 4-4 4"/><path d="M3 11.5v-2a3 3 0 0 1 3-3h15"/><path d="M7 21.5l-4-4 4-4"/><path d="M21 12.5v2a3 3 0 0 1-3 3H3"/>',
  library: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  code: '<path d="M4 17l6-6-6-6"/><path d="M13 19h7"/>',
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9h13v-9"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>',
  server: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.3 6.4"/><path d="M3 12a9 9 0 0 1 15.3-6.4"/><path d="M18 3v3.6h-3.6"/><path d="M6 21v-3.6h3.6"/>',
  pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3H7l3-3z"/>',
  editor: '<path d="M4 6h16M4 12h10M4 18h7"/>', browser: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>', terminal: '<path d="m5 8 5 4-5 4"/><path d="M12 17h7"/>',
  ext: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
  send: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>', clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  brain: '<path d="M12 4.5a3 3 0 0 0-3 3.1c-1.8.4-3.1 1.9-3.1 3.8a3.9 3.9 0 0 0 1.5 3.1 3.4 3.4 0 0 0 3.3 4.4c.4 0 .9-.1 1.3-.2.4.1.9.2 1.3.2a3.4 3.4 0 0 0 3.3-4.4 3.9 3.9 0 0 0 1.5-3.1c0-1.9-1.3-3.4-3.1-3.8a3 3 0 0 0-3-3.1z"/><path d="M12 4.5v15"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.9 12.1 8.6-8.6"/><path d="m15 7 3 3"/>',
  hash: '<path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18"/>',
  arch: '<path d="M4 21V11a8 8 0 0 1 16 0v10"/><path d="M8 21v-9a4 4 0 0 1 8 0v9"/>',
};
const svg = (k, s, sw = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${G[k]}</svg>`;

// ── the frame top ──
const ftop = ({ conn = 'local' } = {}) => `<div class="ftop"><span class="mark">${svg('arch', 16, 2.4)}</span><span class="wordmark">neuramesh</span><span class="ftico">${svg('pin', 13)}</span><span class="ftgrow"></span><span class="searchpill">${svg('search', 12)} Search <span class="kbd">⌘K</span></span><span class="ftgrow"></span><span class="ftico">${svg('editor', 14)}</span><span class="ftico">${svg('browser', 14)}</span><span class="ftico">${svg('terminal', 14)}</span><span class="procs">2 processes</span><span class="livepill">${svg('sync', 13)} ${conn === 'local' ? 'local' : 'synced · 14ms'}</span></div>`;

// ── the rail ──
const top = (mode = 'chat') => `
  <div class="navseg"><span class="${mode === 'chat' ? 'on' : ''}">Chat</span><span class="${mode === 'code' ? 'on' : ''}">Code</span></div>
  <div class="navnew"><span class="row">${svg('compose', 15)}New chat<span class="kbd">⌘N</span></span><span class="caret">${svg('chevron', 14)}</span></div>
  <div class="navsect"><span class="chev">${svg('chevron', 10)}</span>Shortcuts</div>
  <div class="navitem">${svg('home', 15)}<span class="navlabel">Home</span></div>
  <div class="navitem">${svg('whiteboard', 15)}<span class="navlabel">Whiteboards</span></div>
  <div class="navitem">${svg('repeat', 15)}<span class="navlabel">Scheduled</span><span class="chev">${svg('chevron', 12)}</span></div>
  <div class="navitem">${svg('library', 15)}<span class="navlabel">Files</span></div>
  <div class="navitem">${svg('code', 15)}<span class="navlabel">Code</span></div>`;

// the foot: a local connection draws the laptop and NO credit ring (a meter that cannot read renders nothing); a cloud one draws the cloud and the ring
const foot = ({ conn = 'local', name = 'GADS INC', open = false, menu = '' } = {}) => `<div class="navfoot${open ? ' open' : ''}">${menu}<span class="wstile">${name[0]}<i></i></span><span class="wsname">${name}</span><span class="wsconn">${svg(conn === 'local' ? 'laptop' : 'cloud', 13)}</span><span class="navhistglyph">${svg(open ? 'chevu' : 'chevron', 12)}</span>${conn === 'cloud' ? `<svg class="credring" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8.5" fill="none" stroke="var(--panel3)" stroke-width="3"/><circle cx="11" cy="11" r="8.5" fill="none" stroke="var(--green)" stroke-width="3" stroke-dasharray="40 53.4" stroke-linecap="round" transform="rotate(-90 11 11)"/></svg>` : ''}<span class="avatar">D</span></div>`;

const glyph = (k) => k === 'chat' ? svg('threads', 13) : k === 'routine' ? svg('clock', 13) : k === 'wait' ? svg('circle', 13) : k === 'active' ? '<span class="dot" style="color: var(--prog)"></span>' : svg('check', 13);
const stat = (s) => s === 'ny' ? '<span class="navhiststat st-ny">needs you</span>' : s === 'ip' ? '<span class="navhiststat st-ip">in progress</span>' : '<span class="navhiststat st-settled">settled</span>';
const row = (r, opts = {}) => `<div class="navhistrow${opts.in ? ' in' : ''}${r.on ? ' on' : ''}"><span class="navhistglyph">${glyph(r.k)}</span><span class="navhisttitle">${r.num ? `<b>${r.num}</b>` : ''}${r.t}</span>${r.s === 'ny' ? '<span class="navhistask"></span>' : stat(r.s)}</div>`;

// fixtures: the local workspace (GADS INC) and, after upgrade, a cloud workspace (Flowe)
const LOCAL = [
  { k: 'active', t: 'Ship the pricing page', s: 'ip', on: true },
  { k: 'chat', t: 'Give me ideas', s: 'settled' },
  { k: 'wait', num: 1062, t: 'Local mode: first-run states', s: 'ny' },
  { k: 'routine', t: 'Routine · morning research sweep', s: 'settled' },
  { k: 'done', t: 'AI harness reply sweep', s: 'settled' },
  { k: 'chat', t: 'Agent Interoperability Map', s: 'settled' },
  { k: 'done', t: 'Week-one X drafts', s: 'settled' },
  { k: 'chat', t: 'Token audit for the docs site', s: 'settled' },
];
const CLOUD = [
  { k: 'active', t: 'X content schedule', s: 'ip' },
  { k: 'wait', num: 214, t: 'Set up your marketing HQ', s: 'ny' },
  { k: 'chat', t: 'Flowe competitor social media scan', s: 'settled' },
  { k: 'done', t: 'Reply radar, @joinflowe on X', s: 'settled' },
];
const folder = (f) => `<div class="navgrp"><div class="navgrprow"><span class="navhistglyph">${svg(f.folded ? 'folder' : 'folderopen', 14)}</span><span class="navgrpname">${f.name}</span><span class="navhisttrail">${f.folded ? `<span class="navhistfact">${f.count}</span>` : ''}${f.ask ? '<span class="navhistask"></span>' : ''}<span class="navgrpchev${f.folded ? ' c' : ''}">${svg('chevron', 12)}</span></span></div>${f.folded ? '' : `<div class="navgrprows">${f.rows.map((r) => row(r, { in: true })).join('')}${f.more ? `<div class="navgrpmore">Show ${f.more} more</div>` : ''}</div>`}</div>`;
const head = (view, count) => `<div class="navgrphd"><span class="navprojchev">${svg('chevron', 12)}</span><span class="navgrphdlbl${view === 'recents' ? ' on' : ''}">Recents</span><span class="navgrphdsep">·</span><span class="navgrphdlbl${view === 'projects' ? ' on' : ''}">Projects</span><span class="navgrphdcnt">${count}</span><span class="navscopegrow"></span><span class="navhistfind">${svg('search', 13)}</span></div>`;
// a band: the connection's kicker over the rows it holds. Drawn only when two connections exist.
const band = (name, count, opts = {}) => `<div class="navband"><span class="chev${opts.folded ? ' c' : ''}">${svg('chevron', 11)}</span>${name}<span class="cnt">${count}</span><span class="grow"></span>${opts.live ? '<span class="pulse"></span>' : ''}${opts.ask ? '<span class="navhistask"></span>' : ''}</div>`;

const LOCAL_FOLDERS = [
  { name: 'Neuramesh', rows: [LOCAL[0], LOCAL[2], LOCAL[3]], more: 14 },
  { name: 'Default', rows: [LOCAL[1], LOCAL[5]] },
  { name: 'AI Demos', folded: true, count: 9 },
];
const CLOUD_FOLDERS = [
  { name: 'Flowe AI', rows: [CLOUD[0], CLOUD[1], CLOUD[2]], more: 158, ask: false },
];

function railBody({ bands, view = 'projects' }) {
  const total = 23 + 9 + 2 + (bands ? 162 : 0);
  if (!bands) return `${top()}${head(view, 34)}<div class="navlist">${view === 'projects' ? LOCAL_FOLDERS.map(folder).join('') : LOCAL.map((r) => row(r)).join('') + '<div class="navgrpmore flat">Show 26 more</div>'}</div>`;
  if (view === 'projects') return `${top()}${head(view, total)}<div class="navlist">${band('Local', 34)}${LOCAL_FOLDERS.map(folder).join('')}${band('Cloud', 162, { live: true })}${CLOUD_FOLDERS.map(folder).join('')}</div>`;
  return `${top()}${head(view, total)}<div class="navlist">${band('Local', 34)}${LOCAL.slice(0, 6).map((r) => row(r)).join('')}<div class="navgrpmore flat">Show 28 more</div>${band('Cloud', 162, { folded: true, ask: true })}</div>`;
}

const wsMenu = `<div class="wsmenu"><div class="k">Local</div><div class="wsrow on"><span class="wstile">G</span>GADS INC<span class="sub">this Mac</span></div><div class="k"><span class="pulse"></span>Cloud</div><div class="wsrow"><span class="wstile">F</span>Flowe<span class="sub">neuramesh.app</span></div><hr><div class="wsrow">${svg('key', 13)}Account · dana@vertex.dev</div><div class="wsrow">${svg('server', 13)}Connections</div><div class="wsrow">${svg('compose', 13)}New workspace</div></div>`;

// ── artboard shells ──
function doc(theme, inner, { w, h, label = '' }) {
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
    .frame { ${tokens(THEMES[theme])} }
    ${CSS}
  </style>
</helmet>
<div class="frame${inner.row ? ' row' : ''}" style="width: ${w}px; height: ${h}px;">
  ${inner.html}
  ${label ? `<div class="lbl">${label}</div>` : ''}
</div>
</x-dc>
</body>
</html>
`;
}
const rail = (theme, body, opts = {}) => doc(theme, { row: true, html: `<div class="nav">${body}${foot(opts.foot ?? {})}</div><div class="sheet"></div>` }, { w: 340, h: 780 });

// ── A · first run: the stack states, a card on the frame (the wizard's veil is for a surface you must answer) ──
const setupCard = (eyebrow, title, p, body, actions, foot) => `${ftop()}<div class="center"><div class="card setup"><span class="eyebrow">${eyebrow}</span><h1 class="h1">${title}</h1><p class="p">${p}</p>${body}${actions ? `<div class="actions">${actions}</div>` : ''}${foot ? `<div class="setupfoot">${foot}</div>` : ''}</div></div>`;
const pick = (name, fact, tag, on) => `<div class="engrow${on ? ' on' : ''}"><span class="radio${on ? ' on' : ''}"></span><span class="nm">${name}</span><span class="fact">${fact}</span>${tag ? `<span class="engtag">${tag}</span>` : ''}</div>`;
const engineRows = `<div style="display:flex;flex-direction:column;gap:6px">${pick('Colima', 'Free for every company. No password.', 'recommended', true)}${pick('OrbStack', 'Free for personal use. Opens its installer.')}${pick('Docker Desktop', 'Free under 250 people. Asks for your password.')}</div>`;
const A1 = setupCard('Local mode', 'Choose a container runtime', 'NeuraMesh runs a small stack in containers on this Mac. Pick one. The app installs it for you.', engineRows, `<span class="btn primary">Install Colima</span><span class="btn">Scan again</span>`, `<span class="mono">Your data stays on this Mac</span>`);
const A2 = setupCard('Local mode', 'Colima starts', 'Colima is installed. The app starts it. Please wait…', `<div><div class="srow"><span class="nm">Virtual machine</span><span class="st"><span class="wait"></span>please wait…</span></div></div>`, '', `<span class="mono">Usually under 30 seconds</span>`);
const prow = (nm, sz, pct, done) => `<div class="prow"><span class="nm">${done ? svg('tick', 13, 2.4) : ''}${nm}</span><span class="sz">${sz}</span><span class="bar"><i style="width:${pct}%"></i></span></div>`;
const A3 = setupCard('First run', 'Download in progress', 'This happens once. About 900 MB. Please wait…', `<div>${prow('Postgres', '412 MB', 100, true)}${prow('PowerSync', '286 MB', 58)}${prow('NeuraMesh API', '198 MB', 0)}</div>`, `<span class="actions grow"></span><span class="btn quiet sm">Quit</span>`, '');
const srow = (nm, st) => `<div class="srow"><span class="nm">${nm}</span><span class="st${st === 'ready' ? ' ok' : ''}">${st === 'ready' ? svg('tick', 11, 2.6) : '<span class="wait"></span>'}${st}</span></div>`;
const A4 = setupCard('First run', 'The local stack starts', 'Please wait…', `<div>${srow('Postgres', 'ready')}${srow('PowerSync', 'ready')}${srow('NeuraMesh API', 'please wait…')}</div>`, '', `<span class="mono">Ports open on 127.0.0.1 only</span>`);
const A1b = setupCard('Local mode', 'Colima installs', 'Please wait…', `<div>${prow('Colima', '42 MB', 100, true)}${prow('Docker CLI', '38 MB', 65)}<div class="srow" style="margin-top:6px;border-top:1px solid var(--border)"><span class="nm">Virtual machine</span><span class="st"><span class="wait"></span>please wait…</span></div></div>`, '', `<span class="mono">No password needed · 2 CPUs · 4 GB</span>`);
const A6 = setupCard('Update', 'Update in progress', 'The local stack updates to 0.133.0. Please wait…', `<div>${prow('NeuraMesh API 0.133.0', '201 MB', 40)}</div>`, '', `<span class="mono">Your threads open when the update ends</span>`);

// A5 · ready: the whole shell in Free (one connection, today's rail, the sync mark reads LOCAL, no credit ring)
const homeSheet = `<div class="sheet"><div class="stage"><h2 class="stagehead">Good evening, Dana. <span class="q">What do we build?</span></h2><div class="hcomposer"><div class="chint"><span class="pav"></span><span class="chintat">rex</span> · Ask anything, or describe the work.</div><div class="ta">Message #general…</div><div class="hrow"><span class="cchip">${svg('hash', 11)} general <span class="car">▾</span></span><span class="cchip">${svg('laptop', 12)} This Mac <span class="car">▾</span></span><span class="cchip">${svg('brain', 12)}<span class="brainavs"><span class="pav"></span><span class="pav"></span></span> Brain <span class="car">▾</span></span><span class="cchip">${svg('clip', 12)}</span><span class="hsend">${svg('send', 14)}</span></div></div>
<div class="sgroup">Recent<span class="rule"></span></div>
<div class="histrow"><span class="histico">${svg('threads', 13)}</span><span class="histbody"><div class="histtitle">Ship the pricing page</div><div class="histsnip">rex · The Free card leads with the download. Pro says what the cloud adds.</div></span><span class="histwhen"><span class="chip st-ip">in progress</span>2m</span></div>
<div class="histrow"><span class="histico">${svg('circle', 13)}</span><span class="histbody"><div class="histtitle">Local mode: first-run states</div><div class="histsnip">iris · Round 1 has six states. The download shows no clock.</div></span><span class="histwhen"><span class="chip st-ny">needs you</span>1h</span></div>
<div class="histrow"><span class="histico">${svg('threads', 13)}</span><span class="histbody"><div class="histtitle">Give me ideas</div><div class="histsnip">rex · Three directions for the week, ranked by what ships first.</div></span><span class="histwhen"><span class="chip st-settled">settled</span>Yesterday</span></div>
</div></div>`;
const A5 = (theme) => doc(theme, { html: `${ftop()}<div class="body2"><div class="nav">${railBody({ bands: false })}${foot()}</div>${homeSheet}</div>` }, { w: 1180, h: 760 });

// ── C · Upgrade to Pro ──
const upSheet = `<div class="upmodal"><span class="upx">${svg('x', 13)}</span><span class="eyebrow">Free is your Mac</span><h1 class="h1">Pro is the cloud</h1><p class="p">Free runs the whole product on this Mac. Pro adds the cloud around it. Nothing is taken away.</p>
<div class="upgrid"><div class="upcard"><div class="uphead"><span class="upico">${svg('laptop', 16)}</span><div><div class="upname">Free</div><div class="uptag">Your plan</div></div></div><div class="upprice">$0<small>forever</small></div><ul class="uplist"><li>Every room, agent, and task on this Mac</li><li>Your subscriptions and keys</li><li>No limits on projects, agents, or tasks</li><li>Nothing leaves this Mac</li></ul></div>
<div class="upcard rec"><div class="uphead"><span class="upico">${svg('cloud', 16)}</span><div><div class="upname">Pro <span class="uprec">Recommended</span></div><div class="uptag">The hosted cloud</div></div></div><div class="upprice">$22<small>per seat, per month</small></div><ul class="uplist"><li>A cloud machine for every member</li><li>Invites and seats</li><li>Sync across devices, browser, and phone</li><li>Routines while your laptop is closed</li><li>Connectors that publish</li></ul></div></div>
<div class="upfoot"><span class="btn primary">Get Pro</span><span class="btn">Not now</span><span class="actions grow"></span><span class="mono">Opens neuramesh.app · your local workspaces stay on this Mac</span></div></div>`;
const upWait = `<div class="upmodal" style="width:460px"><span class="upx">${svg('x', 13)}</span><div class="orbph"></div><h1 class="h1" style="text-align:center">Finish in your browser</h1><p class="p" style="text-align:center">Sign up and pay on neuramesh.app. This window waits up to 15 minutes.</p><div class="upfoot" style="justify-content:center"><span class="btn">Open the page again</span><span class="btn quiet">Cancel</span></div></div>`;
const C = (theme, inner) => doc(theme, { html: `${ftop()}<div class="body2"><div class="nav">${railBody({ bands: false })}${foot()}</div>${homeSheet}</div><div class="veil">${inner}</div>` }, { w: 1180, h: 760 });

// ── D · Settings › Connections ──
const krow = (k, v, extra = '') => `<div class="krow"><span class="k">${k}</span><span class="v">${v}</span>${extra}</div>`;
const settings = `<div class="topbar"><h1>Connections</h1></div><div class="setcol">
<div class="card setcard"><div class="sethead"><span class="ico">${svg('laptop', 15)}</span><span class="nm">This Mac</span><span class="st"><span class="d"></span>runs</span><span class="grow"></span><span class="btn sm">Migrate to Cloud</span><span class="btn sm">Restart</span></div>
${krow('Engine', 'Colima 0.8.1')}${krow('Stack', '0.132.0 <span class="tag">up to date</span>')}${krow('Data', '<code>~/.neuramesh/local</code> <span class="lnk">Show in Finder</span>')}${krow('Ports', '<code>127.0.0.1:8788</code> <code>127.0.0.1:58081</code>')}
<div class="krow"><span class="k">After quit</span><span class="v">Keep the stack running<span class="sub">Routines run only while the stack runs.</span></span><span class="tog"><i></i></span></div></div>
<div class="card setcard"><div class="sethead"><span class="ico">${svg('cloud', 15)}</span><span class="nm">neuramesh.app</span><span class="st"><span class="d"></span>connected</span><span class="grow"></span><span class="btn sm">Sign out</span></div>
${krow('Account', 'dana@vertex.dev')}${krow('Plan', 'Pro · 3 seats <span class="lnk">Manage billing</span>')}${krow('Workspaces', 'Flowe')}</div>
<div class="card setcard"><div class="sethead"><span class="ico">${svg('server', 15)}</span><span class="nm">Manual setup</span></div><p class="p dim">Run the stack yourself, from a terminal or on a server you own. Paste its address.</p><div class="field"><span class="input">https://</span><span class="btn sec">Connect</span></div></div>
</div>`;
const D = (theme) => doc(theme, { html: `${ftop({ conn: 'cloud' })}<div class="body2"><div class="nav">${railBody({ bands: true })}${foot({ conn: 'local' })}</div><div class="sheet">${settings}</div></div>` }, { w: 1180, h: 760 });

// ── E · the hosted paywalled shell: the composer is gone, the gate card docks in its place ──
const hosted = `<div class="thhead"><span class="crumb">‹ #general · conversations</span><span class="thtitle">X content schedule</span></div><div class="thcol" style="height: calc(100% - 52px)">
<div class="msg"><span class="pav"></span><div><div class="who"><b>rex</b> · 2d</div><div class="txt">The week-one drafts are in the thread. Two of them need your word before they go out.</div></div></div>
<div class="msg me"><div class="bub">Approve the first two. Hold the third until the pricing page ships.</div></div>
<div class="msg"><span class="pav"></span><div><div class="who"><b>rex</b> · 2d</div><div class="txt">Done. The first two are scheduled. The third waits in drafts.</div></div></div>
<div class="card gate"><span class="eyebrow">Pro</span><h2 class="h2">This workspace needs Pro</h2><p class="p">Your threads and files stay readable. Pro turns writes back on.</p><div class="actions"><span class="btn primary">Get Pro</span><span class="btn">Export workspace</span></div><div class="gatefoot"><span class="mono">Files on your cloud machine are not in the export</span></div></div>
</div>`;
const E = (theme) => doc(theme, { html: `${ftop({ conn: 'cloud' })}<div class="body2"><div class="nav">${top()}${head('recents', 162)}<div class="navlist">${CLOUD.map((r, i) => row({ ...r, on: i === 0 })).join('')}<div class="navgrpmore flat">Show 158 more</div></div>${foot({ conn: 'cloud', name: 'Flowe' })}</div><div class="sheet">${hosted}</div></div>` }, { w: 1180, h: 760 });


// ── F · the pricing section on the site (apps/web tokens: --paper/--surface/--ink, styles.css:8-32, 618-632) ──
const WEB = {
  light: { ink: '#0c0b0a', paper: '#f5f4f2', surface: '#ffffff', surface2: '#ebe9e6', line: '#dedbd6', line2: '#b9b4ae', muted: '#6b665f', faint: '#8a847d', body: '#57534e', accent: '#834a2b', accentInk: '#fff7ee' },
  dark: { ink: '#e8e6e3', paper: '#0d0d0d', surface: '#161616', surface2: '#1a1a1a', line: '#262626', line2: '#3a3a3a', muted: '#8a8a8a', faint: '#6e6e6e', body: '#a6a6a6', accent: '#c58a63', accentInk: '#241207' },
};
const webTokens = (t) => `--ink:${t.ink};--paper:${t.paper};--surface:${t.surface};--surface2:${t.surface2};--line:${t.line};--line2:${t.line2};--muted:${t.muted};--faint:${t.faint};--body:${t.body};--accent:${t.accent};--accent-ink:${t.accentInk};`;
const WEBCSS = `
  .site { --fbody: 'Geist', -apple-system, BlinkMacSystemFont, sans-serif; --fmono: 'Geist Mono', ui-monospace, Menlo, monospace; --fbrand: 'Bricolage Grotesque', var(--fbody);
    position: relative; box-sizing: border-box; background: var(--paper); color: var(--ink); font: 15px/1.5 var(--fbody); -webkit-font-smoothing: antialiased; overflow: hidden; }
  .site *, .site *::before, .site *::after { box-sizing: border-box; }
  .snav { display: flex; align-items: center; gap: 22px; padding: 18px 40px; }
  .snav .wm { font: 600 16px var(--fbrand); letter-spacing: -.015em; color: var(--ink); }
  .snav a { color: var(--muted); font-size: 14px; } .snav .grow { flex: 1; }
  .sbtn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 38px; padding: 0 16px; border-radius: 3px; border: 1px solid var(--line2); color: var(--ink); font: 500 12px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; white-space: nowrap; background: var(--surface); }
  .sbtn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .sbtn.big { height: 50px; padding: 0 22px; font-size: 13px; }
  .wrap { max-width: 1360px; margin: 0 auto; padding: 0 40px; }
  .l-pricehead { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px; margin: 36px 0 40px; }
  .l-k { margin: 0; font: 500 11px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--muted); } .l-k b { color: var(--accent); font-weight: 500; margin-right: 6px; }
  .l-h2 { margin: 0; font-size: 40px; font-weight: 500; letter-spacing: -.03em; line-height: 1.1; color: var(--ink); max-width: 680px; } .l-h2 span { color: var(--muted); }
  .l-p { margin: 0; color: var(--body); font-size: 16px; max-width: 520px; }
  .l-plans { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 960px; margin: 0 auto; }
  .l-plan { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 32px; display: flex; flex-direction: column; gap: 20px; }
  .l-plan.feat { border-color: var(--ink); }
  .l-pn { display: flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 500; color: var(--ink); }
  .l-chip { font: 500 11px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; padding: 4px 7px; border-radius: 3px; border: 1px solid var(--line2); color: var(--muted); }
  .l-chip.acc { border-color: var(--accent); color: var(--accent); }
  .l-price { font-size: 44px; font-weight: 500; letter-spacing: -.03em; line-height: 1; color: var(--ink); display: flex; align-items: baseline; gap: 8px; }
  .l-price small { font-size: 14px; color: var(--muted); letter-spacing: 0; font-weight: 400; }
  .l-plan .l-p { font-size: 15px; }
  .l-pl { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; font-size: 14.5px; color: var(--body); flex: 1; }
  .l-pl li { display: flex; gap: 10px; align-items: flex-start; }
  .l-pl li::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); margin-top: 8px; flex: none; }
  .l-plan .sbtn { width: 100%; height: 44px; }
  .l-note { text-align: center; margin: 28px auto 0; font-size: 13.5px; color: var(--muted); display: flex; justify-content: center; gap: 18px; flex-wrap: wrap; }
  .l-note a { color: var(--accent); }
`;
const pricing = `<div class="snav"><span class="wm">neuramesh</span><span class="grow"></span><a>Product</a><a>Experts</a><a>Pricing</a><a>Sign in</a><span class="sbtn primary">Download for Mac</span></div>
<div class="wrap"><div class="l-pricehead"><p class="l-k"><b>09</b>Pricing</p><h2 class="l-h2">Free is your Mac. <span>Pro is the cloud.</span></h2><p class="l-p">Bring your own Claude, OpenAI, or Gemini subscriptions. neuramesh never marks up tokens.</p></div>
<div class="l-plans">
<div class="l-plan"><div class="l-pn">Free <span class="l-chip">Desktop</span></div><div class="l-price">$0</div><p class="l-p">The whole product on your Mac.</p><ul class="l-pl"><li>Every room, agent, and task on your machine</li><li>Your subscriptions and keys</li><li>No limits on projects, agents, or tasks</li><li>The app sets up a small local stack for you</li></ul><span class="sbtn">Download for Mac</span></div>
<div class="l-plan feat"><div class="l-pn">Pro <span class="l-chip acc">Cloud</span></div><div class="l-price">$22 <small>per seat, per month</small></div><p class="l-p">The hosted cloud around it.</p><ul class="l-pl"><li>Everything in Free</li><li>A cloud machine for every member</li><li>Invites, seats, and sync across devices</li><li>The browser app, the phone, and connectors that publish</li></ul><span class="sbtn primary">Get Pro</span></div>
</div>
<div class="l-note"><span>Source available under the Elastic License 2.0</span><a>Read the source ↗</a><span>macOS · Windows soon</span></div></div>`;
const F = (theme) => `<!doctype html>
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
    .site { ${webTokens(WEB[theme])} }
    ${WEBCSS}
  </style>
</helmet>
<div class="site" style="width: 1180px; height: 760px;">${pricing}</div>
</x-dc>
</body>
</html>
`;

// ── G · the wizard's Keys step in Local mode: the starter-brain door is ABSENT (no credits exist here), a provider is required ──
const provRow = (name, mode, state) => `<div class="engrow" style="padding: 12px 14px"><span class="pav" style="width:22px;height:22px;border-radius:50%"></span><span class="nm" style="min-width:90px">${name}</span><span class="navhiststat st-settled" style="text-transform:lowercase">${mode}</span><span class="fact"></span>${state === 'ok' ? `<span class="mono" style="color:var(--green);display:inline-flex;align-items:center;gap:6px">${svg('tick', 11, 2.6)} signed in</span>` : `<span class="go">Connect</span>`}</div>`;
const keysStep = `<div class="sheet"><div style="width: 620px; margin: 0 auto; padding-top: 56px; display: flex; flex-direction: column; gap: 14px;">
<div style="display:flex;align-items:center;gap:10px"><svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="10.5" fill="none" stroke="var(--panel3)" stroke-width="3"/><circle cx="13" cy="13" r="10.5" fill="none" stroke="var(--brand)" stroke-width="3" stroke-dasharray="26.4 66" stroke-linecap="round" transform="rotate(-90 13 13)"/></svg><span class="eyebrow">Step 2 of 5 · Keys</span></div>
<h1 class="h1" style="font-size:26px">Connect a brain</h1>
<p class="p">Your agents run on models you already pay for. Sign in to one provider to continue. Nothing here leaves this Mac.</p>
<div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">${provRow('Claude', 'subscription', 'ok')}${provRow('OpenAI', 'subscription', 'no')}${provRow('Gemini', 'API key', 'no')}</div>
<div class="actions" style="margin-top:14px"><span class="btn">Back</span><span class="actions grow"></span><span class="btn primary">Continue</span></div>
</div></div>`;
const Gb = (theme) => doc(theme, { html: `${ftop()}<div class="body2"><div class="nav" style="opacity:.35"><div class="navseg"><span class="on">Chat</span><span>Code</span></div></div>${keysStep}</div>` }, { w: 1180, h: 760 });

// ── H · Migrate a local workspace into a Pro workspace (the export lane feeds the import lane) ──
const moveSheet = `<div class="upmodal" style="width:560px"><span class="upx">${svg('x', 13)}</span><span class="eyebrow">Pro</span><h1 class="h1">Migrate GADS INC to Cloud</h1><p class="p">Your threads, tasks, files, and agents move into a Pro workspace. Your keys stay on this Mac.</p>
<div class="krow" style="border-top:0;padding-top:4px"><span class="k">Migrate into</span><span class="v"><span class="cchip" style="border-color:var(--border2);color:var(--text)">${svg('cloud', 12)} Flowe <span class="car">▾</span></span></span></div>
<div class="facts"><span class="k">Projects</span><span class="v">3</span><span class="k">Threads</span><span class="v">34 · 12 tasks</span><span class="k">Files</span><span class="v">1.2 GB <span class="ok">of 10 GB</span></span><span class="k">Agents</span><span class="v">rex, iris, patch <span class="mono">merge by name</span></span><span class="k">Stays here</span><span class="v">Keys and sign-ins · files on disk · the local copy, as a backup</span></div>
<div class="upfoot"><span class="btn primary">Migrate to Cloud</span><span class="btn">Not now</span><span class="actions grow"></span><span class="mono">Runs in the background · you can keep working</span></div></div>`;
const movedSheet = `<div class="upmodal" style="width:460px"><span class="upx">${svg('x', 13)}</span><span class="eyebrow">Pro</span><h1 class="h1">Moved</h1><p class="p">3 projects, 34 threads, and 1.2 GB are in Flowe. The local copy stays on this Mac as a backup.</p><div class="upfoot"><span class="btn primary">Open in Flowe</span><span class="btn">Done</span></div></div>`;
const H = (theme, inner) => doc(theme, { html: `${ftop({ conn: 'cloud' })}<div class="body2"><div class="nav">${railBody({ bands: true })}${foot({ conn: 'local' })}</div><div class="sheet">${settings}</div></div><div class="veil">${inner}</div>` }, { w: 1180, h: 760 });

// ── write ──
const out = {};
const state = (theme, html) => doc(theme, { html }, { w: 760, h: 520 });
out['A1-NoEngine.dc.html'] = state('graphite', A1);
out['A1b-Installing.dc.html'] = state('graphite', A1b);
out['A2-EngineStopped.dc.html'] = state('graphite', A2);
out['A3-Download.dc.html'] = state('graphite', A3);
out['A4-Starting.dc.html'] = state('graphite', A4);
out['A6-Update.dc.html'] = state('graphite', A6);
out['A1-NoEngine-cream.dc.html'] = state('cream', A1);
out['A5-Ready.dc.html'] = A5('graphite');
out['A5-Ready-cream.dc.html'] = A5('cream');
out['B0-RailFree.dc.html'] = rail('graphite', railBody({ bands: false }));
out['B1-RailBandsProjects.dc.html'] = rail('graphite', railBody({ bands: true, view: 'projects' }));
out['B2-RailBandsRecents.dc.html'] = rail('graphite', railBody({ bands: true, view: 'recents' }));
out['B1-RailBandsProjects-cream.dc.html'] = rail('cream', railBody({ bands: true, view: 'projects' }));
out['B4-FootMenu.dc.html'] = rail('graphite', railBody({ bands: true, view: 'projects' }), { foot: { open: true, menu: wsMenu } });
out['C1-UpgradeToPro.dc.html'] = C('graphite', upSheet);
out['C1-UpgradeToPro-cream.dc.html'] = C('cream', upSheet);
out['C2-UpgradeWaiting.dc.html'] = C('graphite', upWait);
out['D-Connections.dc.html'] = D('graphite');
out['D-Connections-cream.dc.html'] = D('cream');
out['E-HostedShell.dc.html'] = E('graphite');
out['E-HostedShell-cream.dc.html'] = E('cream');
out['F-Pricing.dc.html'] = F('light');
out['F-Pricing-dark.dc.html'] = F('dark');
out['G-KeysLocal.dc.html'] = Gb('graphite');
out['G-KeysLocal-cream.dc.html'] = Gb('cream');
out['H1-MoveToCloud.dc.html'] = H('graphite', moveSheet);
out['H1-MoveToCloud-cream.dc.html'] = H('cream', moveSheet);
out['H2-Moved.dc.html'] = H('graphite', movedSheet);
for (const [f, html] of Object.entries(out)) writeFileSync(f, html);

const A = (file, x, y, w, h, title) => ({ file, x, y, w, h, title });
const canvas = {
  artboards: [
    A('A1-NoEngine.dc.html', 0, 0, 760, 520, 'A1 · Choose a container runtime (the app installs it)'),
    A('A1b-Installing.dc.html', 800, 0, 760, 520, 'A1b · The runtime installs, no password'),
    A('A2-EngineStopped.dc.html', 1600, 0, 760, 520, 'A2 · Installed, stopped: the app starts it'),
    A('A3-Download.dc.html', 2400, 0, 760, 520, 'A3 · First run: the stack downloads, no clock'),
    A('A4-Starting.dc.html', 3200, 0, 760, 520, 'A4 · The stack starts'),
    A('A6-Update.dc.html', 4000, 0, 760, 520, 'A6 · An app update moves the stack'),
    A('A1-NoEngine-cream.dc.html', 4800, 0, 760, 520, 'A1 · cream oak'),
    A('A5-Ready.dc.html', 0, 660, 1180, 760, 'A5 · Ready: Free, one connection, the sync mark reads LOCAL'),
    A('A5-Ready-cream.dc.html', 1220, 660, 1180, 760, 'A5 · cream oak'),
    A('B0-RailFree.dc.html', 0, 1560, 340, 780, 'B0 · Free: today’s rail, no bands'),
    A('B1-RailBandsProjects.dc.html', 380, 1560, 340, 780, 'B1 · Pro: LOCAL and CLOUD bands, Projects'),
    A('B2-RailBandsRecents.dc.html', 760, 1560, 340, 780, 'B2 · The bands in Recents, Cloud folded'),
    A('B1-RailBandsProjects-cream.dc.html', 1140, 1560, 340, 780, 'B1 · cream oak'),
    A('B4-FootMenu.dc.html', 1520, 1560, 340, 780, 'B4 · The foot’s menu: workspaces by connection'),
    A('C1-UpgradeToPro.dc.html', 0, 2480, 1180, 760, 'C1 · Upgrade to Pro'),
    A('C1-UpgradeToPro-cream.dc.html', 1220, 2480, 1180, 760, 'C1 · cream oak'),
    A('C2-UpgradeWaiting.dc.html', 2440, 2480, 1180, 760, 'C2 · Finish in your browser'),
    A('D-Connections.dc.html', 0, 3380, 1180, 760, 'D · Settings › Connections'),
    A('D-Connections-cream.dc.html', 1220, 3380, 1180, 760, 'D · cream oak'),
    A('E-HostedShell.dc.html', 0, 4280, 1180, 760, 'E · A hosted free workspace: the gate replaces the composer'),
    A('E-HostedShell-cream.dc.html', 1220, 4280, 1180, 760, 'E · cream oak'),
    A('F-Pricing.dc.html', 0, 5180, 1180, 760, 'F · The pricing section on the site (Paper)'),
    A('F-Pricing-dark.dc.html', 1220, 5180, 1180, 760, 'F · dark'),
    A('G-KeysLocal.dc.html', 0, 6080, 1180, 760, 'G · Onboarding › Keys in Local mode: no starter-brain door'),
    A('G-KeysLocal-cream.dc.html', 1220, 6080, 1180, 760, 'G · cream oak'),
    A('H1-MoveToCloud.dc.html', 0, 6980, 1180, 760, 'H1 · Migrate a local workspace into a Pro workspace'),
    A('H1-MoveToCloud-cream.dc.html', 1220, 6980, 1180, 760, 'H1 · cream oak'),
    A('H2-Moved.dc.html', 2440, 6980, 1180, 760, 'H2 · Migrated'),
  ],
  annotations: [
    { id: 'note-a', x: 0, y: -190, w: 1500, text: 'A · FIRST RUN (Local mode)\nThe app does the setup. It looks for a running container engine and uses it. When none is found (A1) it asks ONE question, which runtime, with Colima preselected because it is free for every company and installs with no password. Install <pick> is the one button. The app downloads the runtime (A1b), starts it (A2, also the state when a runtime is installed but stopped), pulls the stack (A3, sizes and bars, never a clock), and starts it (A4). Nobody types a command. Manual setup lives in Settings › Connections and in docs/local-mode.md for people who want the terminal. Busy states say Please wait…' },
    { id: 'note-a5', x: 0, y: 1440, w: 1400, text: 'A5 · READY. Free is today’s shell exactly. What changes: the frame top’s sync mark reads LOCAL (a fact about the connection sits with the sync fact), the machine chip says This Mac, the foot wears a laptop glyph beside the workspace name and draws no credit ring (a meter that cannot read renders nothing). No banner, no badge, no nag.' },
    { id: 'note-b', x: 0, y: 2360, w: 1500, text: 'B · THE RAIL WITH TWO CONNECTIONS (after upgrade)\nFree changes nothing (B0). With a Cloud connection the list grows two bands, LOCAL and CLOUD, in the section-kicker voice with a count and a fold. The RECENTS · PROJECTS switch stays ONE control above both bands and applies to each. Rows are unchanged. A folded band keeps its count, its ask dot and its live pulse, so a fold never silences an ask. Opening a row on the other connection swaps the foreground in place (no relaunch, under 100ms). The foot names the foreground workspace with its connection glyph and its menu (B4) lists workspaces under the same two kickers.' },
    { id: 'note-c', x: 0, y: 3260, w: 1500, text: 'C · UPGRADE TO PRO. The UpgradeModal recipe with new words: Free is your Mac, Pro is the cloud. Two cards, Free says what stays, Pro says what the cloud adds. Get Pro opens neuramesh.app in the browser (the desktop OAuth handoff, 15 minute window) and the sheet waits (C2). No trial, no card in the app, no per-reply price anywhere.' },
    { id: 'note-d', x: 0, y: 4160, w: 1500, text: 'D · SETTINGS › CONNECTIONS. One card per connection. This Mac: the engine, the stack version, where the data lives (Show in Finder), the loopback ports, and the one toggle (keep the stack after quit, off by default). neuramesh.app: account, plan, workspaces, sign out. Migrate to Cloud is the door to H. Manual setup is the custom profile for people who run the stack themselves, from a terminal or on a server they own. The UI never says compose.' },
    { id: 'note-f', x: 0, y: 5960, w: 1500, text: 'F · THE SITE. The pricing section keeps its markup (.l-plans, .l-plan, .l-chip, .l-price) and changes its words: Free is your Mac, Pro is the cloud. The Free card says the app sets up the local stack, so nobody meets the runtime as a surprise after the download. The primary CTA is Download for Mac, the secondary Get Pro. One footer line says source available under the Elastic License 2.0, never open source.' },
    { id: 'note-g', x: 0, y: 6860, w: 1500, text: 'G · THE WIZARD IN LOCAL MODE. The Keys step loses the starter-brain door (Start with 500 credits) because Local has no credits. A provider is required, so the step says so in one sentence and Continue lights when one is signed in. The Machine step already reads This Mac becomes home base. The setup tracker renders no cloud rows (absent, never unknown) and the credit ring does not render.' },
    { id: 'note-h', x: 0, y: 7760, w: 1500, text: 'H · MOVE A LOCAL WORKSPACE TO CLOUD. On Pro, a local workspace moves INTO a Pro workspace (its projects, rooms, threads, tasks, inline files, memory, and agents merged by name). A new cloud workspace would need its own subscription, so the move targets one you already pay for. The sheet says what moves, what stays (keys, files on disk, the local copy as a backup), and the storage it takes against the plan. The move runs in the background in batches through the export lane, so a big workspace never blocks the app. On Free the same door opens the Upgrade sheet.' },
    { id: 'note-e', x: 0, y: 5060, w: 1500, text: 'E · A HOSTED WORKSPACE ON THE FREE PLAN. Everything stays readable. The composer is gone and the gate card docks where it stood (an absent control beats a disabled one): Get Pro, Export workspace, and the one honest line about the cloud machine’s files. This is the shell an existing hosted sign-up sees on their next action, and what a browser tab of the browser app shows.' },
  ],
  launch: { view: 'canvas' },
};
writeFileSync('canvas.json', JSON.stringify(canvas, null, 2) + '\n');
console.log('wrote', Object.keys(out).length, 'artboards + canvas.json');
