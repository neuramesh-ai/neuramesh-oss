// Generates the design-canvas artboards for the first-run stack round (2026-09-18): the card a new
// install sees while the three containers start, and the card it sees when they do not. Every value
// is lifted from tokens.css (graphite dark + cream oak, the `.lsg*` card recipe, the `.btn` recipe,
// the wizard's step-ring halo, the Porch mark's geometry from brand.tsx) at the 14px reading step.
// Geist stands in for NeuraMesh Sans in a mockup (the house face is a renamed Geist build).
//
// Version 3 of the canvas is the CONTRACT (George, 2026-09-18): B, the chain · the stopped node in
// --term-red · no foot line · the Porch mark back on the card, with its look · the title
// "NeuraMesh is starting up…". The A (rows) and B7 (stage line) alternates of version 2 retired.
//
// Run: node build.mjs [canvas-out-dir]   (the *.dc.html boards + canvas.json land beside this file;
// the Design-canvas bundle, project/*.dc.html + project/canvas.json in the canvas's own index
// format, lands in canvas-out-dir, default: beside this file too)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS_OUT = process.argv[2] ? resolve(process.argv[2]) : HERE;
const W = 880, H = 540;

const THEMES = {
  graphite: { win: '#0d0d0d', bg: '#141414', panel: '#161616', panel2: '#1a1a1a', panel3: '#262626', border: '#262626', border2: '#3a3a3a', cardBorder: '#2c2c2c', card: '#1e1e1e',
    text: '#cbcbcb', body: '#a6a6a6', muted: '#848484', dim: '#6a6a6a', link: '#d19a72', brand: '#834a2b', brandInk: '#fff7ee', green: '#77ac8d', warn: '#c9a15e', accent: '#cbcbcb', red: '#c98f8f',
    btn: '#232323', btnFg: '#efefef', shadow: 'rgba(0,0,0,0.62)', hoverBorder: '#404040', ring: '#525252', shadowCard: '0 1px 2px rgba(0,0,0,.25)', shadowLift: '0 8px 20px -8px rgba(0,0,0,.55)' },
  cream: { win: '#f0e5d3', bg: '#fbf8f4', panel: '#fbf8f4', panel2: '#f6eee1', panel3: '#efe1cd', border: '#e6dbca', border2: '#d3c2a8', cardBorder: '#eadfce', card: '#ffffff',
    text: '#3a2c22', body: '#5b4c3d', muted: '#8b7861', dim: '#a99680', link: '#9c5730', brand: '#834a2b', brandInk: '#fff7ee', green: '#2f9e6b', warn: '#a06a1f', accent: '#834a2b', red: '#a84340',
    btn: '#f8f2e8', btnFg: '#43301f', shadow: 'rgba(70,42,18,0.16)', hoverBorder: '#c9b596', ring: '#b58a6a', shadowCard: '0 1px 2px rgba(70,42,18,.05)', shadowLift: '0 8px 20px -8px rgba(70,42,18,.20)' },
};
const tokens = (t) => Object.entries({ '--win': t.win, '--bg': t.bg, '--panel': t.panel, '--panel2': t.panel2, '--panel3': t.panel3, '--border': t.border, '--border2': t.border2, '--card-border': t.cardBorder, '--card': t.card,
  '--text': t.text, '--body': t.body, '--muted': t.muted, '--dim': t.dim, '--link': t.link, '--brand': t.brand, '--brand-ink': t.brandInk, '--green': t.green, '--warn': t.warn, '--accent': t.accent, '--term-red': t.red,
  '--btn': t.btn, '--btn-fg': t.btnFg, '--shadow': t.shadow, '--hover-border': t.hoverBorder, '--ring': t.ring, '--shadow-card': t.shadowCard, '--shadow-lift': t.shadowLift,
  '--r-xs': '3px', '--r-sm': '4px', '--r-md': '6px', '--r-lg': '8px', '--r-full': '999px' }).map(([k, v]) => `${k}:${v};`).join('');

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;450;500;600&amp;family=Geist+Mono:wght@500;600&amp;family=Bricolage+Grotesque:wght@600&amp;display=swap">';

/* ── the recipes, token for token from tokens.css (.lsg*, .btn, .obring) ── */
const CSS = `
  body { margin: 0; }
  .frame { --fbody: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; --fmono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace; --fbrand: 'Bricolage Grotesque', var(--fbody);
    --dur: .15s; --ease: cubic-bezier(.22,1,.36,1);
    position: relative; box-sizing: border-box; width: ${W}px; height: ${H}px; background: var(--win); color: var(--text); font: 14px/1.5 var(--fbody); -webkit-font-smoothing: antialiased; overflow: hidden; display: flex; flex-direction: column; }
  .frame *, .frame *::before, .frame *::after { box-sizing: border-box; }
  .ftop { flex: none; display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 14px; }
  .mark { width: 16px; height: 16px; display: inline-grid; place-items: center; color: var(--brand); }
  .wordmark { font: 600 14px var(--fbrand); letter-spacing: -.015em; color: var(--text); }
  .center { flex: 1; display: grid; place-items: center; padding: 24px; }
  .stage { flex: none; display: flex; align-items: center; justify-content: flex-end; gap: 14px; height: 34px; padding: 0 16px; font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); }
  .stage i { width: 3px; height: 3px; border-radius: 50%; background: var(--dim); }
  /* the Porch mark on the card: the launch grammar once, then a glance every 9 s (tokens.css .lsgmark) */
  .cmark { display: inline-flex; width: 40px; height: 40px; margin-bottom: 2px; }
  .cmark .pk-arch { animation: pk-fade .25s ease both; }
  .cmark .pk-peekg { animation: pk-peek .4s var(--ease) .35s both; }
  .cmark .pk-lookg { animation: pk-look 1.15s var(--ease) .85s both, glance 9s var(--ease) 4s infinite; }
  .cmark .pk-smile { stroke-dasharray: 1; animation: pk-draw .4s var(--ease) 2.05s both, pk-fade .01s linear 2.05s both; }
  .cmark svg { animation: pk-bounce .5s var(--ease) 2.5s both; }
  @keyframes pk-fade { from { opacity: 0; } }
  @keyframes pk-peek { from { transform: translateY(13px); } }
  @keyframes pk-look { 0%, 14% { transform: none; } 26%, 44% { transform: translateX(-2.6px); } 56%, 78% { transform: translateX(2.6px); } 92%, 100% { transform: none; } }
  @keyframes pk-draw { from { stroke-dashoffset: 1; } }
  @keyframes pk-bounce { 0%, 100% { transform: none; } 35% { transform: translateY(-4px); } 70% { transform: translateY(1.5px); } }
  @keyframes glance { 0%, 4% { transform: none; } 7%, 9% { transform: translateX(-2.6px); } 12%, 14% { transform: translateX(2.6px); } 17%, 100% { transform: none; } }
  @media (prefers-reduced-motion: reduce) { .cmark * { animation: none !important; stroke-dashoffset: 0; } }
  /* the card: .lsgcard */
  .card { width: 460px; padding: 26px 26px 20px; display: flex; flex-direction: column; gap: 14px; background: var(--card); border: 1px solid var(--card-border); border-radius: var(--r-lg); box-shadow: var(--shadow-card); }
  .kick { font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); }
  .h1 { margin: 2px 0 0; font-family: var(--fbody); font-size: 20px; font-weight: 500; letter-spacing: -.02em; line-height: 1.25; color: var(--text); }
  .p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--body); }
  .foot { display: flex; align-items: center; gap: 8px; margin-top: 2px; padding-top: 12px; border-top: 1px solid var(--border); }
  .mono { font: 500 11px var(--fmono); letter-spacing: -.02em; color: var(--dim); }
  /* today's status rows: .lsgsrow */
  .srow { display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 4px; border-bottom: 1px solid var(--border); }
  .srow:last-child { border-bottom: 0; }
  .srow .nm { flex: 1; font-size: 14px; color: var(--body); }
  .st { font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); display: inline-flex; align-items: center; gap: 6px; }
  .st.ok { color: var(--green); }
  .st.bad { color: var(--term-red); }
  .wait { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 22%, transparent); }
  /* B · the chain: the picker's radio column becomes the stack's status column */
  .chain { display: flex; flex-direction: column; margin: 2px 0 0; }
  .crow { position: relative; display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 12px; height: 40px; padding: 0 4px; }
  .node { position: relative; width: 18px; height: 18px; display: grid; place-items: center; }
  .node svg { position: absolute; inset: 0; }
  .node.ready circle { fill: var(--green); }
  .node.ready path { stroke: var(--card); stroke-width: 2.4; fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .node.queued circle { fill: none; stroke: var(--border2); stroke-width: 1.5; }
  .node.live .halo { fill: none; stroke: color-mix(in srgb, var(--accent) 42%, transparent); stroke-width: 1.5; stroke-dasharray: 1.5 4.4; stroke-linecap: round; transform-origin: center; animation: halo 10s linear infinite; }
  .node.live .dot { fill: var(--accent); }
  .node.stopped circle { fill: var(--term-red); }
  .node.stopped path { stroke: var(--card); stroke-width: 2.2; fill: none; stroke-linecap: round; }
  @keyframes halo { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .node.live .halo { animation: none; } }
  .seg { position: absolute; left: 14px; top: 30px; width: 1px; height: 20px; background: var(--border); }
  .seg.lit { background: var(--green); }
  .cname { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
  .cname .nm { font-size: 14px; font-weight: 500; color: var(--text); }
  .cname .fact { font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cname.dimmed .nm { color: var(--body); }
  /* A · honest rows: kind glyph · name · fact · state icon */
  .arow { display: grid; grid-template-columns: 18px 1fr auto; align-items: center; gap: 12px; height: 38px; padding: 0 4px; border-bottom: 1px solid var(--border); }
  .arow:last-child { border-bottom: 0; }
  .arow .glyph { color: var(--muted); display: grid; place-items: center; }
  .aicon { display: inline-grid; place-items: center; width: 14px; height: 14px; }
  .aicon.ok { color: var(--green); }
  .aicon.queued { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--border2); }
  /* the error card's three parts: cause · the container's own last line · remedy */
  .cause { margin: 0; font-size: 14px; line-height: 1.5; color: var(--text); }
  .well { background: var(--panel2); border-radius: var(--r-md); padding: 9px 12px; font: 500 11px/1.55 var(--fmono); letter-spacing: -.02em; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
  .remedy { margin: 0; font-size: 13px; line-height: 1.5; color: var(--muted); }
  /* buttons: .btn, .btn.primary (the hatch), .btn.quiet */
  .acts { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 34px; padding: 0 14px; border-radius: var(--r-xs); border: 1px solid var(--border2); background: var(--btn); color: var(--btn-fg); font-family: var(--fmono); font-size: 12px; font-weight: 500; letter-spacing: -.02em; text-transform: uppercase; position: relative; white-space: nowrap; cursor: pointer; }
  .btn.primary { background: var(--brand); color: var(--brand-ink); border-color: transparent; }
  .btn.primary::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: repeating-linear-gradient(135deg, rgba(255,255,255,.16) 0 1px, transparent 1px 7px); background-size: 9.9px 9.9px; pointer-events: none; }
  .btn.primary > * { position: relative; }
  .btn.quiet { border-color: transparent; color: var(--muted); }
  .btn.sm { height: 28px; padding: 0 10px; font-size: 10px; }
  .grow { flex: 1; }
  .lbl { position: absolute; left: 12px; bottom: 8px; font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); z-index: 5; }
`;

/* ── glyphs (ui/icons.tsx paths, stroke 2, 24-box) ── */
const svg = (paths, s = 15, sw = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const MARK = svg('<path d="M4 21V11a8 8 0 0 1 16 0v10"/><path d="M8 21v-9a4 4 0 0 1 8 0v9"/>', 16, 2.4);
/* the Porch mark, standard cut, verbatim from brand.tsx (48-unit grid): the arch tile in --brand, the face in --brand-ink */
const PORCH = `<span class="cmark" aria-hidden="true"><svg width="40" height="40" viewBox="0 0 48 48"><path class="pk-arch" d="M6.5 22 C6.5 11 14 4.5 24 4.5 C34 4.5 41.5 11 41.5 22 L41.5 38.5 C41.5 41.8 39.3 43.5 36.5 43.5 L11.5 43.5 C8.7 43.5 6.5 41.8 6.5 38.5 Z" fill="var(--brand)"/><defs><clipPath id="pkclip"><path d="M6.5 22 C6.5 11 14 4.5 24 4.5 C34 4.5 41.5 11 41.5 22 L41.5 38.5 C41.5 41.8 39.3 43.5 36.5 43.5 L11.5 43.5 C8.7 43.5 6.5 41.8 6.5 38.5 Z"/></clipPath></defs><g clip-path="url(#pkclip)"><g class="pk-peekg"><g class="pk-lookg"><circle cx="18.4" cy="21.5" r="2.75" fill="var(--brand-ink)"/><circle cx="29.6" cy="21.5" r="2.75" fill="var(--brand-ink)"/></g></g></g><path class="pk-smile" d="M17.6 28.4 C20.3 32.8 27.7 32.8 30.4 28.4" pathLength="1" fill="none" stroke="var(--brand-ink)" stroke-width="2.9" stroke-linecap="round"/></svg></span>`;
const I = {
  check: (s = 11) => svg('<path d="M20 6 9 17l-5-5"/>', s, 2.6),
  db: svg('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>'),
  server: svg('<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>'),
  sync: svg('<path d="M17 2.5l4 4-4 4"/><path d="M3 11.5v-2a3 3 0 0 1 3-3h15"/><path d="M7 21.5l-4-4 4-4"/><path d="M21 12.5v2a3 3 0 0 1-3 3H3"/>'),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', 12),
};

/* ── the chain node, four states ── */
const node = (state) => {
  const body = state === 'ready' ? '<circle cx="9" cy="9" r="8"/><path d="m5.6 9.3 2.4 2.4 4.6-4.9"/>'
    : state === 'live' ? '<circle class="halo" cx="9" cy="9" r="8"/><circle class="dot" cx="9" cy="9" r="3.2"/>'
    : state === 'stopped' ? '<circle cx="9" cy="9" r="8"/><path d="m6.4 6.4 5.2 5.2M11.6 6.4l-5.2 5.2"/>'
    : '<circle cx="9" cy="9" r="7.75"/>';
  return `<span class="node ${state}" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 18 18">${body}</svg></span>`;
};

const SERVICES = [
  { name: 'Postgres', fact: 'The workspace database', glyph: I.db },
  { name: 'NeuraMesh API', fact: 'The NeuraMesh server', glyph: I.server },
  { name: 'PowerSync', fact: 'The sync engine', glyph: I.sync },
];

/** B · the chain: states in boot order; a segment lights once the node above it is ready */
const chain = (states) => `<div class="chain">${SERVICES.map((s, i) => {
  const st = states[i];
  const seg = i < SERVICES.length - 1 ? `<span class="seg${st === 'ready' ? ' lit' : ''}"></span>` : '';
  const right = st === 'stopped' ? '<span class="st bad">stopped</span>' : '';
  return `<div class="crow">${node(st)}${seg}<span class="cname${st === 'queued' ? ' dimmed' : ''}"><span class="nm">${s.name}</span><span class="fact">${s.fact}</span></span>${right}</div>`;
}).join('')}</div>`;

/** A · honest rows: glyph · name · fact · a state icon at the right */
const rows = (states) => `<div>${SERVICES.map((s, i) => {
  const st = states[i];
  const icon = st === 'ready' ? `<span class="aicon ok">${I.check(13)}</span>` : st === 'live' ? '<span class="aicon"><span class="wait"></span></span>' : st === 'stopped' ? '<span class="st bad">stopped</span>' : '<span class="aicon queued"></span>';
  return `<div class="arow"><span class="glyph">${s.glyph}</span><span class="cname${st === 'queued' ? ' dimmed' : ''}"><span class="nm">${s.name}</span><span class="fact">${s.fact}</span></span>${icon}</div>`;
}).join('')}</div>`;

/** today's rows, in today's order, with today's words */
const today = () => `<div>${[['Postgres', 'ok'], ['PowerSync', 'wait'], ['NeuraMesh API', 'ok']].map(([n, s]) => `<div class="srow"><span class="nm">${n}</span>${s === 'ok' ? `<span class="st ok">${I.check()}ready</span>` : '<span class="st"><span class="wait"></span>please wait…</span>'}</div>`).join('')}</div>`;

const card = ({ kick, title, p, body, acts, foot }) => `<div class="card" role="dialog" aria-labelledby="t"><span class="kick">${kick}</span><h1 class="h1" id="t">${title}</h1>${p ? `<p class="p">${p}</p>` : ''}${body ?? ''}${acts ? `<div class="acts">${acts}</div>` : ''}${foot ? `<div class="foot"><span class="mono">${foot}</span></div>` : ''}</div>`;

const errorCard = ({ cause, detail, remedy }) => card({
  kick: 'Local mode', title: 'NeuraMesh did not start on this Mac',
  body: `<p class="cause">${cause}</p><div class="well">${detail}</div><p class="remedy">${remedy}</p>`,
  acts: `<button type="button" class="btn primary"><span>Try again</span></button><button type="button" class="btn quiet">Quit</button><span class="grow"></span><button type="button" class="btn quiet sm">${I.copy}Copy details</button>`,
});

const frame = (t, inner, { stage = false, label = '' } = {}) => `<div class="frame" style="${tokens(t)}"><div class="ftop"><span class="mark">${MARK}</span><span class="wordmark">neuramesh</span></div><div class="center">${inner}</div>${stage ? '<div class="stage"><span>v0.137.1</span><i></i><span>Docker Desktop</span><i></i><span>~/.neuramesh/local</span></div>' : ''}${label ? `<span class="lbl">${label}</span>` : ''}</div>`;

const STARTING = { kick: 'First run', title: 'NeuraMesh is starting up…', p: 'Your workspace runs in three containers. This usually takes under a minute.' };
const STOPPED_DETAIL = 'Fatal startup error - exiting with code 150. postgres query failed';

const BOARDS = [
  { file: 'Main.dc.html', title: 'B1 · The chain · the API starts · graphite', theme: 'graphite', x: 0, y: 0,
    body: (t) => frame(t, card({ ...STARTING, body: chain(['ready', 'live', 'queued']) }), { label: 'b · the chain · decided' }) },
  { file: 'B2-ChainStopped.dc.html', title: 'B2 · The chain · PowerSync stopped', theme: 'graphite', x: 960, y: 0,
    body: (t) => frame(t, card({ ...STARTING, body: chain(['ready', 'ready', 'stopped']) }), { label: 'b · a node fails, the card says so in seconds' }) },
  { file: 'B3-ErrorStopped.dc.html', title: 'B3 · Did not start · a container stopped', theme: 'graphite', x: 1920, y: 0,
    body: (t) => frame(t, errorCard({ cause: 'PowerSync stopped 3 times.', detail: STOPPED_DETAIL, remedy: 'Try again starts a fresh PowerSync container.' }), { label: 'cause · the container\'s last line · remedy' }) },
  { file: 'B4-ErrorPort.dc.html', title: 'B4 · Did not start · a port is in use', theme: 'graphite', x: 2880, y: 0,
    body: (t) => frame(t, errorCard({ cause: 'Port 58081 is in use by another program.', detail: '127.0.0.1:58081 · held by stack-powersync-1 (Docker)', remedy: 'Stop that program, then try again.' }), { label: 'the port clash, said before anything breaks' }) },
  { file: 'B5-ChainCream.dc.html', title: 'B5 · The chain · cream oak', theme: 'cream', x: 0, y: 720,
    body: (t) => frame(t, card({ ...STARTING, body: chain(['ready', 'live', 'queued']) }), { label: 'b · cream oak' }) },
  { file: 'B6-ErrorCream.dc.html', title: 'B6 · Did not start · cream oak', theme: 'cream', x: 960, y: 720,
    body: (t) => frame(t, errorCard({ cause: 'PowerSync stopped 3 times.', detail: STOPPED_DETAIL, remedy: 'Try again starts a fresh PowerSync container.' }), { label: 'cream oak' }) },
  { file: 'Z0-Today.dc.html', title: 'Z0 · Before · v0.137.1 · for reference', theme: 'graphite', x: 1920, y: 720,
    body: (t) => frame(t, card({ kick: 'First run', title: 'NeuraMesh starts on this Mac', p: 'Your workspace on this Mac runs in three containers. They start now. Please wait…', body: today(), foot: 'Ports open on 127.0.0.1 only', mark: false }), { label: 'before' }) },
  { file: 'Z1-TodayError.dc.html', title: 'Z1 · Before · the 90-second dead end', theme: 'graphite', x: 2880, y: 720,
    body: (t) => frame(t, card({ kick: 'Local mode', title: 'NeuraMesh did not start on this Mac', p: 'The local stack did not start in 90 seconds (powersync not healthy).', acts: '<button type="button" class="btn primary"><span>Try again</span></button><button type="button" class="btn quiet">Quit</button>', mark: false }), { label: 'before' }) },
];

const NOTES = {
  head: { x: 0, y: -300, kind: 'title1', maxW: 3760, text: 'First run: the stack starts, and when it does not · 2026-09-18 · decided' },
  decided: { x: 0, y: 1440, w: 1200, text: `DECIDED (George, 2026-09-18): B, the chain. The stopped node wears --term-red. The foot line is gone. The Porch mark is back on the card, with its look left and right. The title reads "NeuraMesh is starting up…". The A (rows) and B7 (stage line) alternates of version 2 retired. This version is the visual contract the build follows: apps/desktop/src/renderer/src/views/LocalStackGate.tsx, tokens.css .lsg*, evidence in docs/design/first-run-stack-2026-09/evidence.` },
  fail: { x: 1280, y: 1440, w: 1200, text: `THE FAILURE CARD has three parts: the CAUSE in plain words, the container's own last line in a mono well, the REMEDY. COPY DETAILS puts the three on the clipboard. An error with no diagnosis (Colima did not start.) keeps the two-line card.
The bug on George's Mac: a first start failed on a port clash (the dev stack holds 127.0.0.1:58081), Docker Desktop then dropped the container's network, and every later start "succeeded" with no network. Try again could never fix it, because compose keeps a container whose config did not change. The driver now checks both ports first (B4), marks a container with no network for recreation, ends a crash loop in seconds with the container's last line (B2, B3), and recreates the failed container on Try again.` },
};

/* ── one artboard: the Design Component page ── */
const page = (b) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${b.title}</title>
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  ${FONTS}
  <style>${CSS}</style>
</helmet>
${b.body(THEMES[b.theme])}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${W},"height":${H}}}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
`;

/* ── write the artboards, the manifest, and the canvas bundle ── */
for (const b of BOARDS) writeFileSync(join(HERE, b.file), page(b));
writeFileSync(join(HERE, 'canvas.json'), JSON.stringify({ artboards: BOARDS.map((b) => ({ file: b.file, x: b.x, y: b.y, w: W, h: H, title: b.title })), notes: NOTES }, null, 2) + '\n');

const proj = join(CANVAS_OUT, 'project');
mkdirSync(proj, { recursive: true });
for (const b of BOARDS) writeFileSync(join(proj, b.file), page(b));
writeFileSync(join(proj, 'canvas.json'), JSON.stringify({
  v: 3, createdOnFiles: { v: 1, at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }, title: 'First Run Stack', launch: { view: 'canvas' }, pages: [],
  boards: Object.fromEntries(BOARDS.map((b) => [b.file, { x: b.x, y: b.y, w: W, h: H, title: b.title }])),
  order: BOARDS.map((b) => b.file), notes: NOTES, designSystems: [],
}, null, 2) + '\n');
console.log(`wrote ${BOARDS.length} artboards + canvas.json to ${HERE}\nwrote the canvas bundle to ${proj}`);
