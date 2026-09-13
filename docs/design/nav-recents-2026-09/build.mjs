// Generates the design-canvas artboards for the nav-recents round (2026-09-12): the rail switches
// between RECENTS (one flat list, newest first) and PROJECTS (the folders). Every value is lifted
// from tokens.css (.navseg, .navnew, .navsect, .navitem, .navgrphd, .navgrprow, .navhistrow,
// .navhiststat, .navgrpmore, .navfoot) and views/NavGroups.tsx. Run: node build.mjs
import { writeFileSync } from 'node:fs';

const THEMES = {
  graphite: { win: '#0d0d0d', bg: '#141414', panel: '#161616', panel2: '#1a1a1a', panel3: '#262626', border: '#262626', border2: '#3a3a3a', cardBorder: '#2c2c2c', card: '#1e1e1e',
    text: '#cbcbcb', body: '#a6a6a6', muted: '#848484', dim: '#6a6a6a', link: '#d19a72', brand: '#834a2b', brandInk: '#fff7ee', green: '#77ac8d', warn: '#c9a15e', prog: '#8ba0c0', accent: '#cbcbcb',
    overlay: '#222222', shadow: 'rgba(0,0,0,0.62)', hoverBg: 'color-mix(in srgb, #cbcbcb 7%, transparent)', selBg: 'color-mix(in srgb, #cbcbcb 10%, transparent)', ring: '#525252', shadowCard: '0 1px 2px rgba(0,0,0,.25)' },
  cream: { win: '#f0e5d3', bg: '#fbf8f4', panel: '#fbf8f4', panel2: '#f6eee1', panel3: '#efe1cd', border: '#e6dbca', border2: '#d3c2a8', cardBorder: '#eadfce', card: '#ffffff',
    text: '#3a2c22', body: '#5b4c3d', muted: '#8b7861', dim: '#a99680', link: '#9c5730', brand: '#834a2b', brandInk: '#fff7ee', green: '#2f9e6b', warn: '#a06a1f', prog: '#4f80c4', accent: '#834a2b',
    overlay: '#ffffff', shadow: 'rgba(70,42,18,0.16)', hoverBg: 'color-mix(in srgb, #3a2c22 5%, transparent)', selBg: 'color-mix(in srgb, #834a2b 8%, transparent)', ring: 'color-mix(in srgb, #834a2b 42%, #d3c2a8)', shadowCard: '0 1px 2px rgba(70,42,18,.05)' },
};
const tokens = (t) => Object.entries({ '--win': t.win, '--bg': t.bg, '--panel': t.panel, '--panel2': t.panel2, '--panel3': t.panel3, '--border': t.border, '--border2': t.border2, '--card-border': t.cardBorder, '--card': t.card,
  '--text': t.text, '--body': t.body, '--muted': t.muted, '--dim': t.dim, '--link': t.link, '--brand': t.brand, '--brand-ink': t.brandInk, '--green': t.green, '--warn': t.warn, '--prog': t.prog, '--accent': t.accent,
  '--overlay': t.overlay, '--shadow': t.shadow, '--hover-bg': t.hoverBg, '--sel-bg': t.selBg, '--ring': t.ring, '--shadow-card': t.shadowCard }).map(([k, v]) => `${k}:${v};`).join('');

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;450;500;600&amp;family=Geist+Mono:wght@500;600&amp;display=swap">';

const CSS = `
  body { margin: 0; }
  a { color: var(--link); } a:hover { color: var(--text); }
  .frame { --fbody: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; --fmono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;
    position: relative; box-sizing: border-box; background: var(--win); color: var(--text); font: 13.5px/1.5 var(--fbody); -webkit-font-smoothing: antialiased; overflow: hidden; display: flex; }
  .frame *, .frame *::before, .frame *::after { box-sizing: border-box; }
  /* the naked rail on the frame, 266px, and a sliver of the sheet beside it */
  .nav { width: 266px; flex: none; display: flex; flex-direction: column; padding: 10px 0 0; height: 100%; }
  .sheet { flex: 1; margin: 2px 8px 8px 4px; background: var(--bg); border-radius: 8px; box-shadow: var(--shadow-card); }
  .navseg { display: flex; margin: 6px 8px 2px; padding: 3px; background: var(--panel2); border-radius: 3px; }
  .navseg span { flex: 1; text-align: center; font: 500 12px var(--fbody); color: var(--muted); padding: 5px 0; border-radius: 3px; }
  .navseg span.on { background: var(--panel3); color: var(--text); }
  .navnew { display: flex; align-items: center; gap: 4px; padding: 6px 8px 14px; }
  .navnew .row { display: flex; align-items: center; gap: 11px; flex: 1; padding: 7px 9px; border-radius: 6px; color: var(--body); font-size: 13px; font-weight: 560; }
  .navnew .row svg { color: var(--muted); } .navnew .kbd { margin-left: auto; font: 500 10px var(--fmono); color: var(--dim); }
  .navnew .caret { width: 26px; height: 26px; display: grid; place-items: center; color: var(--muted); }
  .navsect { padding: 13px 16px 5px; font: 500 9.5px var(--fmono); letter-spacing: -.02em; color: var(--muted); text-transform: uppercase; display: flex; align-items: center; gap: 6px; }
  .navsect .chev { color: var(--dim); display: inline-grid; }
  .navitem { display: flex; align-items: center; gap: 11px; width: 100%; margin: 0 8px; width: calc(100% - 16px); padding: 7px 9px; border-radius: 6px; color: var(--body); font-size: 13px; font-weight: 500; }
  .navitem svg { color: var(--muted); flex: none; }
  .navitem .navlabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .navitem.sub { padding-left: 44px; }
  .navitembadge { font: 600 10px var(--fmono); color: var(--muted); background: var(--panel3); border-radius: 999px; padding: 1px 7px; }
  .navitem .chev { color: var(--dim); }
  .navlist { flex: 1; min-height: 0; overflow: hidden; }
  /* the band head: the list's name as a kicker, the fold-all chevron, the ⌘Y magnifier */
  .navgrphd { display: flex; align-items: center; gap: 7px; padding: 12px 8px 4px 12px; min-width: 0; }
  .navprojchev { width: 18px; height: 18px; display: grid; place-items: center; color: var(--dim); }
  .navgrphdlbl { font: 500 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); }
  .navgrphdlbl.on { color: var(--text); }
  .navgrphdlbl.door { color: var(--dim); cursor: pointer; } .navgrphdlbl.door:hover { color: var(--text); }
  .navgrphdsep { font: 500 9.5px var(--fmono); color: var(--dim); opacity: .6; }
  .navgrphdcnt { font: 600 9.5px var(--fmono); color: var(--dim); opacity: .8; }
  .navscopegrow { flex: 1; }
  .navhistfind { width: 22px; height: 22px; display: grid; place-items: center; color: var(--muted); opacity: .5; border-radius: 4px; }
  .navhistfind.on { opacity: 1; color: var(--text); background: var(--sel-bg); }
  .viewtog { display: inline-flex; gap: 1px; padding: 2px; background: var(--panel2); border-radius: 3px; margin-right: 2px; }
  .viewtog span { width: 20px; height: 18px; display: grid; place-items: center; color: var(--dim); border-radius: 2px; }
  .viewtog span.on { color: var(--text); background: var(--panel3); }
  /* rows */
  .navgrp { margin-top: 2px; }
  .navgrprow { display: flex; align-items: center; gap: 9px; width: calc(100% - 16px); margin: 1px 8px; height: 30px; padding: 0 9px 0 10px; border-radius: 6px; color: var(--body); }
  .navgrprow .navhistglyph { color: var(--muted); }
  .navgrpname { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .navhisttrail { display: inline-flex; align-items: center; gap: 6px; flex: none; }
  .navhistfact { font: 500 10px var(--fmono); color: var(--dim); }
  .navgrpchev { display: inline-grid; color: var(--dim); } .navgrpchev.c { transform: rotate(-90deg); }
  .navhistask { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 26%, transparent); }
  .navhistrow { display: flex; align-items: center; gap: 9px; width: calc(100% - 16px); margin: 1px 8px; height: 30px; padding: 0 9px 0 10px; border-radius: 6px; color: var(--body); }
  .navhistrow.in { padding-left: 32px; }
  .navhistrow.on { background: var(--card); box-shadow: var(--shadow-card); }
  .navhistglyph { flex: none; width: 14px; height: 14px; display: grid; place-items: center; color: var(--dim); }
  .navhistglyph .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .navhisttitle { flex: 1; min-width: 0; font-size: 13px; font-weight: 450; color: var(--body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .navhisttitle b { font: 500 11px var(--fmono); color: var(--dim); margin-right: 5px; font-weight: 500; }
  .navhiststat { font: 500 9px var(--fmono); letter-spacing: -.01em; white-space: nowrap; padding: 2px 5px; border-radius: 3px; border: 1px solid transparent; flex: none; }
  .st-settled { background: var(--panel3); color: var(--muted); border-color: var(--border2); }
  .st-ip { background: color-mix(in srgb, var(--prog) 16%, transparent); color: var(--prog); }
  .st-ny { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
  .navhistproj { font: 500 9.5px var(--fmono); letter-spacing: -.02em; color: var(--dim); white-space: nowrap; flex: none; }
  .navgrpmore { display: block; margin: 1px 8px 4px; padding: 0 9px 0 32px; height: 26px; font: 500 12px var(--fbody); color: var(--dim); line-height: 26px; }
  .navgrpmore.flat { padding-left: 19px; }
  /* the scope row (the flat round's shape) */
  .navscoperow { display: flex; align-items: center; gap: 4px; padding: 12px 8px 6px 12px; min-width: 0; }
  .scopelbl { display: inline-flex; align-items: center; gap: 5px; padding: 3.5px 8px; color: var(--muted); font-size: 11.5px; font-weight: 600; white-space: nowrap; border-radius: 3px; }
  .scopelbl .car { font-size: 8px; color: var(--dim); }
  .scopelbl.set { background: var(--sel-bg); color: var(--text); }
  /* the foot */
  .navfoot { display: flex; align-items: center; gap: 8px; padding: 8px; margin-top: auto; }
  .wstile { width: 22px; height: 22px; border-radius: 4px; background: var(--panel3); border: 1px solid var(--border2); display: grid; place-items: center; font: 600 11px var(--fmono); color: var(--body); position: relative; }
  .wstile i { position: absolute; top: -3px; right: -3px; width: 7px; height: 7px; border-radius: 50%; background: var(--warn); border: 1.5px solid var(--win); }
  .wsname { font-size: 13px; font-weight: 600; color: var(--text); flex: 1; }
  .credring { width: 22px; height: 22px; }
  .lbl { position: absolute; left: 12px; bottom: 8px; font: 500 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); }
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
  list: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  tree: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3H7l3-3z"/>',
};
const svg = (k, s, sw = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${G[k]}</svg>`;

const top = (mode = 'chat') => `
  <div class="navseg"><span class="${mode === 'chat' ? 'on' : ''}">Chat</span><span class="${mode === 'code' ? 'on' : ''}">Code</span></div>
  <div class="navnew"><span class="row">${svg('compose', 15)}New chat<span class="kbd">⌘N</span></span><span class="caret">${svg('chevron', 14)}</span></div>
  <div class="navsect"><span class="chev">${svg('chevron', 10)}</span>Shortcuts</div>
  <div class="navitem">${svg('whiteboard', 15)}<span class="navlabel">Whiteboards</span></div>
  <div class="navitem">${svg('repeat', 15)}<span class="navlabel">Scheduled</span><span class="chev">${svg('chevron', 12)}</span></div>
  <div class="navitem sub"><span class="navlabel">Routines</span><span class="navitembadge">2</span></div>
  <div class="navitem sub"><span class="navlabel">Calendar</span><span class="navitembadge">12</span></div>
  <div class="navitem">${svg('library', 15)}<span class="navlabel">Files</span></div>
  <div class="navitem">${svg('trend', 15)}<span class="navlabel">Marketing OS</span></div>
  <div class="navitem">${svg('code', 15)}<span class="navlabel">Code</span></div>`;

const foot = `<div class="navfoot"><span class="wstile">G<i></i></span><span class="wsname">GADS INC</span><span class="navhistglyph">${svg('chevron', 12)}</span><svg class="credring" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8.5" fill="none" stroke="var(--panel3)" stroke-width="3"/><circle cx="11" cy="11" r="8.5" fill="none" stroke="var(--green)" stroke-width="3" stroke-dasharray="40 53.4" stroke-linecap="round" transform="rotate(-90 11 11)"/></svg></div>`;

// glyphs by kind: chat = speech outline · routine = clock · waiting task = hollow circle · active = the dot in its hue · settled task = a check
const glyph = (k) => k === 'chat' ? svg('threads', 13) : k === 'routine' ? svg('clock', 13) : k === 'wait' ? svg('circle', 13) : k === 'active' ? '<span class="dot" style="color: var(--prog)"></span>' : svg('check', 13);
const stat = (s) => s === 'ny' ? '<span class="navhiststat st-ny">needs you</span>' : s === 'ip' ? '<span class="navhiststat st-ip">in progress</span>' : '<span class="navhiststat st-settled">settled</span>';
// the one trailing slot: the status word (an ask keeps its pulse); with `proj` a SETTLED row says its project
// instead, because the flat list no longer says it, while a live word still wins the slot
const trail = (r, opts) => (opts.proj && r.p && r.s === 'settled') ? `<span class="navhistproj">${r.p}</span>` : (r.s === 'ny' && !opts.word ? '<span class="navhistask"></span>' : stat(r.s));
const row = (r, opts = {}) => `<div class="navhistrow${opts.in ? ' in' : ''}${r.on ? ' on' : ''}"><span class="navhistglyph">${glyph(r.k)}</span><span class="navhisttitle">${r.num ? `<b>${r.num}</b>` : ''}${r.t}</span>${trail(r, opts)}</div>`;

// the fixture, from George's rail: four projects, the rows interleaved by recency for the flat view
const FLAT = [
  { k: 'wait', num: 1059, t: 'Set up your marketing HQ', s: 'ny', p: 'ai-demos' },
  { k: 'active', t: 'X content schedule', s: 'ip', p: 'neuramesh' },
  { k: 'chat', t: 'Give me ideas', s: 'settled', p: 'default' },
  { k: 'routine', t: 'Routine · hey rex, can we do some research', s: 'settled', p: 'neuramesh' },
  { k: 'done', t: 'AI harness reply sweep', s: 'settled', p: 'neuramesh' },
  { k: 'chat', t: 'Agent Interoperability Map', s: 'settled', p: 'ai-demos' },
  { k: 'done', t: 'Week-one X drafts', s: 'settled', p: 'neuramesh' },
  { k: 'chat', t: 'Flowe competitor social media scan', s: 'settled', p: 'default' },
  { k: 'done', t: 'X post schedule', s: 'settled', p: 'neuramesh' },
  { k: 'chat', t: 'Competitor Social Media Intel', s: 'settled', p: 'default' },
  { k: 'chat', t: 'Token audit for the docs site', s: 'settled', p: 'flowe-ai' },
  { k: 'done', t: 'Reply radar, @joinflowe on X', s: 'settled', p: 'flowe-ai' },
];
const FOLDERS = [
  { name: 'Neuramesh', rows: [FLAT[4], FLAT[3], FLAT[6], FLAT[1], FLAT[8]], more: 18 },
  { name: 'Flowe AI', folded: true, count: 161 },
  { name: 'Default', rows: [FLAT[2], FLAT[7], FLAT[9]] },
  { name: 'AI Demos', rows: [FLAT[5], FLAT[0]] },
];
const folders = () => FOLDERS.map((f) => `<div class="navgrp"><div class="navgrprow"><span class="navhistglyph">${svg(f.folded ? 'folder' : 'folderopen', 14)}</span><span class="navgrpname">${f.name}</span><span class="navhisttrail">${f.folded ? `<span class="navhistfact">${f.count}</span>` : ''}<span class="navgrpchev${f.folded ? ' c' : ''}">${svg('chevron', 12)}</span></span></div>${f.folded ? '' : `<div class="navgrprows">${f.rows.map((r) => row(r, { in: true })).join('')}${f.more ? `<div class="navgrpmore">Show ${f.more} more</div>` : ''}</div>`}</div>`).join('');
const TOTAL = 23 + 161 + 3 + 2; // the four folders' counts, so the flat list's head and its Show more add up
const flat = (opts = {}) => { const n = opts.n ?? 12; return FLAT.slice(0, n).map((r) => row(r, opts)).join('') + `<div class="navgrpmore flat">Show ${TOTAL - n} more</div>`; };

// heads
// the words keep one order (the lit word is the view); the fold-all chevron belongs to the folders, so in the Projects
// state it joins the right cluster beside the magnifier rather than leading a word that is not the view
const headA = (view, count, find = true) => `<div class="navgrphd"><span class="navgrphdlbl${view === 'recents' ? ' on' : ' door'}">Recents</span><span class="navgrphdsep">·</span><span class="navgrphdlbl${view === 'projects' ? ' on' : ' door'}">Projects</span><span class="navgrphdcnt">${count}</span><span class="navscopegrow"></span>${view === 'projects' ? `<span class="navprojchev">${svg('chevron', 12)}</span>` : ''}${find ? `<span class="navhistfind">${svg('search', 13)}</span>` : ''}</div>`;
const headB = (view, count) => `<div class="navgrphd">${view === 'projects' ? `<span class="navprojchev">${svg('chevron', 12)}</span>` : ''}<span class="navgrphdlbl on">Threads</span><span class="navgrphdcnt">${count}</span><span class="navscopegrow"></span><span class="viewtog"><span class="${view === 'recents' ? 'on' : ''}">${svg('list', 12)}</span><span class="${view === 'projects' ? 'on' : ''}">${svg('tree', 12)}</span></span><span class="navhistfind">${svg('search', 13)}</span></div>`;
const headPlain = (label, count, chev = true) => `<div class="navgrphd">${chev ? `<span class="navprojchev">${svg('chevron', 12)}</span>` : ''}<span class="navgrphdlbl on">${label}</span>${count != null ? `<span class="navgrphdcnt">${count}</span>` : ''}<span class="navscopegrow"></span><span class="navhistfind">${svg('search', 13)}</span></div>`;
const scopeRow = () => `<div class="navscoperow"><span class="scopelbl">All threads <span class="car">▾</span></span><span class="scopelbl">All rooms <span class="car">▾</span></span><span class="navscopegrow"></span><span class="navhistfind">${svg('search', 13)}</span></div>`;

function rail({ theme, body, w = 300, h = 780, label = '' }) {
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
<div class="frame" style="width: ${w}px; height: ${h}px;">
  <div class="nav">${body}${foot}</div>
  <div class="sheet"></div>
  ${label ? `<div class="lbl">${label}</div>` : ''}
</div>
</x-dc>
</body>
</html>
`;
}

const out = {};
// A: the kicker is the switch. Two words in the band head, the active one in --text; the other is the door.
out['Main.dc.html'] = rail({ theme: 'graphite', body: `${top()}${headA('recents', TOTAL)}<div class="navlist">${flat()}</div>` });
out['CreamOak.dc.html'] = rail({ theme: 'cream', body: `${top()}${headA('recents', TOTAL)}<div class="navlist">${flat()}</div>` });
out['ProjectsView.dc.html'] = rail({ theme: 'graphite', body: `${top()}${headA('projects', 4)}<div class="navlist">${folders()}</div>` });
// A2: the flat view with the flat round's scope row, narrowing by project and room, the project tag on settled rows
out['RecentsScoped.dc.html'] = rail({ theme: 'graphite', body: `${top()}${headA('recents', TOTAL, false)}${scopeRow()}<div class="navlist">${flat({ proj: true, word: true })}</div>` });
// B: two glyphs at the head's right
out['GlyphToggle.dc.html'] = rail({ theme: 'graphite', body: `${top()}${headB('recents', TOTAL)}<div class="navlist">${flat()}</div>` });
// C: Claude's shape, both at once: a PROJECTS door row, then RECENTS flat
out['BothAtOnce.dc.html'] = rail({ theme: 'graphite', body: `${top()}${headPlain('Projects', 4, false).replace('<span class="navscopegrow"></span>', `<span class="navhistglyph">${svg('chevr', 11)}</span><span class="navscopegrow"></span>`).replace(`<span class="navhistfind">${svg('search', 13)}</span>`, '')}${headPlain('Recents', TOTAL, false)}<div class="navlist">${flat({ n: 11 })}</div>` });
// D: a second segmented control under Chat | Code
out['Segment.dc.html'] = rail({ theme: 'graphite', body: `${top()}<div class="navseg" style="margin-top: 10px"><span class="on">Recents</span><span>Projects</span></div>${headPlain('Recents', TOTAL, false)}<div class="navlist">${flat({ n: 10 })}</div>` });

for (const [f, html] of Object.entries(out)) writeFileSync(f, html);

const A = (file, x, y, title) => ({ file, x, y, w: 300, h: 780, title });
const canvas = {
  artboards: [
    A('Main.dc.html', 0, 0, 'A · Recents · the kicker is the switch'),
    A('ProjectsView.dc.html', 380, 0, 'A · Projects · the same head'),
    A('CreamOak.dc.html', 760, 0, 'A · Recents · cream oak'),
    A('RecentsScoped.dc.html', 1140, 0, 'A2 · Recents with the scope row'),
    A('GlyphToggle.dc.html', 0, 940, 'B · Two glyphs at the head'),
    A('BothAtOnce.dc.html', 380, 940, 'C · Both at once'),
    A('Segment.dc.html', 760, 940, 'D · A second segment'),
  ],
  annotations: [
    { id: 'note-a', x: 0, y: -170, w: 1100, text: 'A · THE KICKER IS THE SWITCH (leading)\nThe band head reads two words, RECENTS · PROJECTS. The active word wears the text ink and carries the count. The other word is dim and is the door: one click swaps the list, remembered per machine like the theme. Recents is one flat list, newest first, the same one-line row (glyph · title · status word). Projects is the folders exactly as today. No new chrome, the rail keeps its ⌘Y magnifier and, in Projects, its fold-all chevron.' },
    { id: 'note-a2', x: 1140, y: -110, w: 420, text: 'A2 · Recents with the scope row from the flat round: All threads ▾ · All rooms ▾. Settled rows carry the project in the trailing slot, since the list no longer says it. An ask keeps its pulse and a live word keeps its badge.' },
    { id: 'note-b', x: 0, y: 780, w: 340, text: 'B · TWO GLYPHS\nThe kicker stays THREADS. A two-glyph toggle (list · folders) sits before the magnifier. One click, but the state is an icon, and a filled glyph beside the magnifier is one more mark on a head that was quiet.' },
    { id: 'note-c', x: 380, y: 780, w: 340, text: 'C · BOTH AT ONCE\nClaude’s shape: a PROJECTS › door row that unfolds the folders in place, then RECENTS flat under it. No toggle, the disclosure is the preference. Tradeoff: two lists on one rail, and the folders push Recents down when open.' },
    { id: 'note-d', x: 760, y: 780, w: 340, text: 'D · A SECOND SEGMENT\nRecents | Projects under Chat | Code. The clearest state, and two stacked segmented controls on a 266px rail is the most chrome of the four.' },
  ],
  launch: { view: 'canvas' },
};
writeFileSync('canvas.json', JSON.stringify(canvas, null, 2) + '\n');
console.log('wrote', Object.keys(out).length, 'artboards + canvas.json');
