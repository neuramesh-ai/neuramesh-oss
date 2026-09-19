// Generates the design-canvas artboards for the first-run doors round (2026-09-19): the screen a
// fresh install sees BEFORE anything builds. George, on a first run that walked him into the local
// wizard: "i already have an account, i don't want to setup again … the start free option should
// allow users select cloud workspace or local". Every value is lifted from tokens.css (graphite dark
// + cream oak, the `.lsg*` card recipe of the first-run round, the picker rows `.lsgrow`, the `.btn`
// recipe, the Porch mark from brand.tsx). Geist stands in for NeuraMesh Sans in a mockup.
//
// Run: node build.mjs [canvas-out-dir]   (the *.dc.html boards + canvas.json land beside this file;
// the Design-canvas bundle, project/*.dc.html + project/canvas.json, lands in canvas-out-dir)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS_OUT = process.argv[2] ? resolve(process.argv[2]) : HERE;
const W = 880, H = 540;

const THEMES = {
  graphite: { win: '#0d0d0d', bg: '#141414', panel: '#161616', panel2: '#1a1a1a', panel3: '#262626', border: '#262626', border2: '#3a3a3a', cardBorder: '#2c2c2c', card: '#1e1e1e',
    text: '#cbcbcb', body: '#a6a6a6', muted: '#848484', dim: '#6a6a6a', link: '#d19a72', brand: '#834a2b', brandInk: '#fff7ee', green: '#77ac8d', warn: '#c9a15e', accent: '#cbcbcb', red: '#c98f8f',
    btn: '#232323', btnFg: '#efefef', shadow: 'rgba(0,0,0,0.62)', hoverBorder: '#404040', ring: '#525252', selBg: 'color-mix(in srgb, #cbcbcb 10%, transparent)', shadowCard: '0 1px 2px rgba(0,0,0,.25)', shadowLift: '0 8px 20px -8px rgba(0,0,0,.55)' },
  cream: { win: '#f0e5d3', bg: '#fbf8f4', panel: '#fbf8f4', panel2: '#f6eee1', panel3: '#efe1cd', border: '#e6dbca', border2: '#d3c2a8', cardBorder: '#eadfce', card: '#ffffff',
    text: '#3a2c22', body: '#5b4c3d', muted: '#8b7861', dim: '#a99680', link: '#9c5730', brand: '#834a2b', brandInk: '#fff7ee', green: '#2f9e6b', warn: '#a06a1f', accent: '#834a2b', red: '#a84340',
    btn: '#f8f2e8', btnFg: '#43301f', shadow: 'rgba(70,42,18,0.16)', hoverBorder: '#c9b596', ring: '#b58a6a', selBg: 'color-mix(in srgb, #834a2b 8%, transparent)', shadowCard: '0 1px 2px rgba(70,42,18,.05)', shadowLift: '0 8px 20px -8px rgba(70,42,18,.20)' },
};
const tokens = (t) => Object.entries({ '--win': t.win, '--bg': t.bg, '--panel': t.panel, '--panel2': t.panel2, '--panel3': t.panel3, '--border': t.border, '--border2': t.border2, '--card-border': t.cardBorder, '--card': t.card,
  '--text': t.text, '--body': t.body, '--muted': t.muted, '--dim': t.dim, '--link': t.link, '--brand': t.brand, '--brand-ink': t.brandInk, '--green': t.green, '--warn': t.warn, '--accent': t.accent, '--term-red': t.red,
  '--btn': t.btn, '--btn-fg': t.btnFg, '--shadow': t.shadow, '--hover-border': t.hoverBorder, '--ring': t.ring, '--sel-bg': t.selBg, '--shadow-card': t.shadowCard, '--shadow-lift': t.shadowLift,
  '--r-xs': '3px', '--r-sm': '4px', '--r-md': '6px', '--r-lg': '8px', '--r-full': '999px' }).map(([k, v]) => `${k}:${v};`).join('');

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;450;500;600&amp;family=Geist+Mono:wght@500;600&amp;family=Bricolage+Grotesque:wght@600&amp;display=swap">';

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
  /* the Porch mark on the card (tokens.css .lsgmark): the launch grammar once, then a glance every 9 s */
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
  /* the picker rows (A1's radio idiom, tokens.css .lsgrow): hairline, the chosen one wears --sel-bg */
  .rows { display: flex; flex-direction: column; gap: 6px; }
  .row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-md); background: transparent; color: var(--text); text-align: left; font: inherit; }
  .row.on { border-color: var(--border2); background: var(--sel-bg); }
  .radio { flex: none; width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--border2); }
  .radio.on { border-color: var(--accent); background: radial-gradient(circle, var(--accent) 42%, transparent 48%); }
  .row .glyph { flex: none; width: 18px; display: grid; place-items: center; color: var(--muted); }
  .row.on .glyph { color: var(--text); }
  .row .nm { font-size: 14px; font-weight: 500; color: var(--text); min-width: 84px; }
  .row .fact { flex: 1; font-size: 12.5px; color: var(--muted); }
  .tag { font: 500 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--muted); }
  /* the wait: one status row (.lsgsrow) */
  .srow { display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 4px; }
  .srow .nm { flex: 1; font-size: 14px; color: var(--body); }
  .st { font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); display: inline-flex; align-items: center; gap: 6px; }
  .st.ok { color: var(--green); }
  .wait { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 22%, transparent); }
  .cause { margin: 0; font-size: 14px; line-height: 1.5; color: var(--text); }
  .remedy { margin: 0; font-size: 13px; line-height: 1.5; color: var(--muted); }
  /* buttons */
  .acts { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 34px; padding: 0 14px; border-radius: var(--r-xs); border: 1px solid var(--border2); background: var(--btn); color: var(--btn-fg); font-family: var(--fmono); font-size: 12px; font-weight: 500; letter-spacing: -.02em; text-transform: uppercase; position: relative; white-space: nowrap; cursor: pointer; }
  .btn.primary { background: var(--brand); color: var(--brand-ink); border-color: transparent; }
  .btn.primary::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: repeating-linear-gradient(135deg, rgba(255,255,255,.16) 0 1px, transparent 1px 7px); background-size: 9.9px 9.9px; pointer-events: none; }
  .btn.primary > * { position: relative; }
  .btn.quiet { border-color: transparent; color: var(--muted); }
  .grow { flex: 1; }
  .foot { display: flex; align-items: center; gap: 8px; margin-top: 2px; padding-top: 12px; border-top: 1px solid var(--border); }
  .mono { font: 500 11px var(--fmono); letter-spacing: -.02em; color: var(--dim); }
  .lbl { position: absolute; left: 12px; bottom: 8px; font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); z-index: 5; }
  /* the flow map board */
  .map { flex: 1; padding: 22px 26px 30px; display: flex; flex-direction: column; gap: 14px; }
  .maphead { font: 500 10px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); }
  .lanes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; flex: 1; }
  .lane { display: flex; flex-direction: column; gap: 8px; }
  .lanehd { font: 500 13px var(--fbody); color: var(--text); padding-bottom: 6px; border-bottom: 1px solid var(--border); display: flex; align-items: baseline; gap: 8px; }
  .lanehd .tag { color: var(--dim); }
  .box { padding: 8px 10px; border: 1px solid var(--card-border); border-radius: var(--r-md); background: var(--card); font-size: 12.5px; line-height: 1.4; color: var(--body); box-shadow: var(--shadow-card); }
  .box b { display: block; font-weight: 500; color: var(--text); font-size: 13px; }
  .box.new { border-color: color-mix(in srgb, var(--brand) 55%, var(--card-border)); }
  .box .tag { margin-left: 6px; }
  .box .tag.new { color: var(--link); }
  .arrow { text-align: center; color: var(--dim); font-size: 12px; line-height: 1; }
  .entry { padding: 8px 10px; border-radius: var(--r-md); background: var(--panel2); font-size: 12.5px; color: var(--body); }
  .entry b { color: var(--text); font-weight: 500; }
`;

const svg = (paths, s = 15, sw = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const MARK = svg('<path d="M4 21V11a8 8 0 0 1 16 0v10"/><path d="M8 21v-9a4 4 0 0 1 8 0v9"/>', 16, 2.4);
/* the row glyphs, verbatim from ui/icons.tsx: IconMachine (a laptop) and IconCloud */
const I = {
  machine: svg('<rect x="2" y="4" width="20" height="12" rx="2"/><path d="M2 20h20"/><path d="M9 20v-4h6v4"/>', 16),
  cloud: svg('<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A7 7 0 0 0 4.7 8.5 4.5 4.5 0 0 0 6.5 19z"/>', 16),
};
const PORCH = `<span class="cmark" aria-hidden="true"><svg width="40" height="40" viewBox="0 0 48 48"><path class="pk-arch" d="M6.5 22 C6.5 11 14 4.5 24 4.5 C34 4.5 41.5 11 41.5 22 L41.5 38.5 C41.5 41.8 39.3 43.5 36.5 43.5 L11.5 43.5 C8.7 43.5 6.5 41.8 6.5 38.5 Z" fill="var(--brand)"/><defs><clipPath id="pkclip"><path d="M6.5 22 C6.5 11 14 4.5 24 4.5 C34 4.5 41.5 11 41.5 22 L41.5 38.5 C41.5 41.8 39.3 43.5 36.5 43.5 L11.5 43.5 C8.7 43.5 6.5 41.8 6.5 38.5 Z"/></clipPath></defs><g clip-path="url(#pkclip)"><g class="pk-peekg"><g class="pk-lookg"><circle cx="18.4" cy="21.5" r="2.75" fill="var(--brand-ink)"/><circle cx="29.6" cy="21.5" r="2.75" fill="var(--brand-ink)"/></g></g></g><path class="pk-smile" d="M17.6 28.4 C20.3 32.8 27.7 32.8 30.4 28.4" pathLength="1" fill="none" stroke="var(--brand-ink)" stroke-width="2.9" stroke-linecap="round"/></svg></span>`;

const card = ({ kick, title, p, body, acts, foot }) => `<div class="card" role="dialog" aria-labelledby="t">${PORCH}<span class="kick">${kick}</span><h1 class="h1" id="t">${title}</h1>${p ? `<p class="p">${p}</p>` : ''}${body ?? ''}${acts ? `<div class="acts">${acts}</div>` : ''}${foot ? `<div class="foot"><span class="mono">${foot}</span></div>` : ''}</div>`;
const frame = (t, inner, { label = '' } = {}) => `<div class="frame" style="${tokens(t)}"><div class="ftop"><span class="mark">${MARK}</span><span class="wordmark">neuramesh</span></div><div class="center">${inner}</div>${label ? `<span class="lbl">${label}</span>` : ''}</div>`;

/** the door: two picker rows (a glyph, the place, its fact), Continue, and the Sign in door beside it */
const door = ({ on = 'mac' } = {}) => card({
  kick: 'First run', title: 'Where should your workspace live?', p: 'Pick one now. You can upgrade to the cloud at any time.',
  body: `<div class="rows" role="radiogroup" aria-label="Where your workspace lives">
    <button type="button" class="row${on === 'mac' ? ' on' : ''}" role="radio" aria-checked="${on === 'mac'}"><span class="radio${on === 'mac' ? ' on' : ''}" aria-hidden="true"></span><span class="glyph">${I.machine}</span><span class="nm">This Mac</span><span class="fact">No account. Three containers on this Mac. Your keys stay here.</span></button>
    <button type="button" class="row${on === 'cloud' ? ' on' : ''}" role="radio" aria-checked="${on === 'cloud'}"><span class="radio${on === 'cloud' ? ' on' : ''}" aria-hidden="true"></span><span class="glyph">${I.cloud}</span><span class="nm">The cloud</span><span class="fact">500 free credits to start. Sync across desktop, web and mobile.</span></button>
  </div>`,
  acts: `<button type="button" class="btn primary"><span>Continue →</span></button><span class="grow"></span><button type="button" class="btn">Sign in</button>`,
  foot: 'Have an account? Sign in opens neuramesh.app',
});

/** the wait while the browser finishes the sign-in or the sign-up */
const waitCard = ({ title, sub, expired = false }) => card({
  kick: 'First run', title, p: expired ? undefined : sub,
  body: expired
    ? `<p class="cause">The browser did not finish.</p><p class="remedy">Try again opens the page with a fresh code.</p>`
    : `<div><div class="srow"><span class="nm">neuramesh.app</span><span class="st"><span class="wait"></span>please wait…</span></div></div>`,
  acts: expired
    ? `<button type="button" class="btn primary"><span>Try again</span></button><button type="button" class="btn quiet">Cancel</button>`
    : `<button type="button" class="btn">Open the page again</button><button type="button" class="btn quiet">Cancel</button>`,
  foot: expired ? undefined : 'Your session lands back in this window',
});

/** the flow map: three lanes from the door, what exists and what is new */
const FLOW_H = 700;
const flowMap = (t) => `<div class="frame" style="${tokens(t)}height:${FLOW_H}px;"><div class="ftop"><span class="mark">${MARK}</span><span class="wordmark">neuramesh</span></div><div class="map">
  <div class="maphead">The complete first run · a fresh profile: no session, no local .env, no chosen connection</div>
  <div class="entry"><b>Splash</b> → main sees a fresh profile → <b>the door</b> (D1). Nothing downloads and no container starts until a row is chosen. A profile with a stored session keeps today's rule: the cloud is in front, Local stays dormant.</div>
  <div class="lanes">
    <div class="lane"><div class="lanehd">Sign in <span class="tag">has an account</span></div>
      <div class="box new"><b>The wait (D2)</b>the browser opens neuramesh.app/desktop-signin<span class="tag new">new door</span></div><div class="arrow">↓</div>
      <div class="box"><b>/desktop-signin</b>Google · GitHub · email, the sign-in face<span class="tag">exists</span></div><div class="arrow">↓</div>
      <div class="box new"><b>Cloud in front</b>the session saved, the cloud connection added and foregrounded, Local dormant<span class="tag new">new</span></div><div class="arrow">↓</div>
      <div class="box"><b>The shell</b>their workspaces · an invitation first (0113) · a workspace that never finished resumes the wizard<span class="tag">exists</span></div>
    </div>
    <div class="lane"><div class="lanehd">In the cloud <span class="tag">new account</span></div>
      <div class="box new"><b>The wait (D2)</b>the browser opens the sign-up face<span class="tag new">new door</span></div><div class="arrow">↓</div>
      <div class="box"><b>/desktop-signin?mode=signup</b> (Pro: /pro, sign up then pay)<span class="tag">exists</span></div><div class="arrow">↓</div>
      <div class="box"><b>The first workspace</b>made by the server at sign-in, no crew yet (onboarded = false)<span class="tag">exists</span></div><div class="arrow">↓</div>
      <div class="box"><b>The wizard resumes</b>Machine · Keys · Team · Launch adopts the workspace<span class="tag">exists</span></div>
    </div>
    <div class="lane"><div class="lanehd">On this Mac <span class="tag">no account</span></div>
      <div class="box new"><b>The stack starts</b>the chain card, on the row's word<span class="tag new">gated</span></div><div class="arrow">↓</div>
      <div class="box"><b>The local wizard</b>Machine · Keys · Workspace · Team · Launch<span class="tag">exists</span></div><div class="arrow">↓</div>
      <div class="box"><b>The shell on this Mac</b><span class="tag">exists</span></div><div class="arrow">↓</div>
      <div class="box"><b>Move to Cloud, later</b>Settings › Connections (H1, H2)<span class="tag">exists</span></div>
    </div>
  </div>
</div><span class="lbl">the flow · oak edge = new · grey = exists</span></div>`;

const BOARDS = [
  { file: 'Main.dc.html', title: 'D1 · The door · graphite · decided', theme: 'graphite', x: 0, y: 0, body: (t) => frame(t, door(), { label: 'd1 · the door · decided 2026-09-19' }) },
  { file: 'D1b-DoorCloud.dc.html', title: 'D1b · The door · the cloud row chosen', theme: 'graphite', x: 960, y: 0, body: (t) => frame(t, door({ on: 'cloud' }), { label: 'd1b · the cloud row chosen' }) },
  { file: 'D2-Wait.dc.html', title: 'D2 · Finish in your browser', theme: 'graphite', x: 1920, y: 0, body: (t) => frame(t, waitCard({ title: 'Finish in your browser', sub: 'Sign up on neuramesh.app. This window waits.' }), { label: 'd2 · the wait · "Sign in on…" on the sign-in door' }) },
  { file: 'D3-WaitExpired.dc.html', title: 'D3 · The browser did not finish', theme: 'graphite', x: 2880, y: 0, body: (t) => frame(t, waitCard({ title: 'Finish in your browser', expired: true }), { label: 'd3 · after 60 s, a fresh code' }) },
  { file: 'D4-DoorCream.dc.html', title: 'D4 · The door · cream oak', theme: 'cream', x: 0, y: 720, body: (t) => frame(t, door(), { label: 'd4 · cream oak' }) },
  { file: 'D5-WaitCream.dc.html', title: 'D5 · The wait · cream oak', theme: 'cream', x: 960, y: 720, body: (t) => frame(t, waitCard({ title: 'Finish in your browser', sub: 'Sign in on neuramesh.app. This window waits.' }), { label: 'd5 · cream oak' }) },
  { file: 'D6-Flow.dc.html', title: 'D6 · The complete flow · what exists, what is new', theme: 'graphite', x: 1920, y: 720, h: 700, body: (t) => flowMap(t) },
];

const NOTES = {
  head: { x: 0, y: -300, kind: 'title1', maxW: 3760, text: 'First run: the doors · 2026-09-19 · a blocker · decided' },
  decided: { x: 2880, y: 720, w: 880, text: `DECIDED (George, 2026-09-19, round 2): "Where should your workspace live?" · the sub says you can upgrade to the cloud at any time · the rows are This Mac and The cloud, each with its glyph (IconMachine, IconCloud) · the cloud row is FREE with 500 credits to start, and says sync across desktop, web and mobile. Both rows are free, so the tags died.
What the cloud row pulls in on the server: the signup grant (500 credits, once, at the first workspace of a free hosted account) came out on 2026-09-12 and comes back; the hosted write gate (NM_HOSTED_FREE_GATE, scheduled to flip on 2026-09-29) stays off and the desktop's gate card stands down for free hosted workspaces; docs/07 and the site's "Free is your Mac" line follow. The 09-15 notice to hosted-free owners needs a follow-up: George's call.` },
  what: { x: 0, y: 1440, w: 880, text: `WHY THIS HAPPENED. The shipped app makes the Local connection first and the cloud only once a Clerk session is stored. George's old session was not found, so the stack booted and the fresh local workspace opened the wizard. No screen before the shell offers Sign in: the Login page renders only on the Clerk lane, and the only cloud door on a local connection is Get Pro inside the shell.
The door runs BEFORE the stack: nothing downloads, no container starts, until This Mac is chosen. Sign in and The cloud reuse the hosted hand-off (neuramesh.app/desktop-signin, both faces, the phone's lane) and land the cloud connection in front with Local dormant, the rule that already exists for a cloud user.` },
  copy: { x: 960, y: 1440, w: 880, text: `THE WORDS (STE): "Where should your workspace live?" · "Pick one now. You can upgrade to the cloud at any time." · This Mac · "No account. Three containers on this Mac. Your keys stay here." · The cloud · "500 free credits to start. Sync across desktop, web and mobile." · CONTINUE → · SIGN IN · foot "Have an account? Sign in opens neuramesh.app" · the wait: "Finish in your browser" · "Sign up on neuramesh.app. This window waits." (Sign in on the sign-in door) · "The browser did not finish." · "Try again opens the page with a fresh code."
Preselected: This Mac (the sub says the cloud is one upgrade away).` },
};

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
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${W},"height":${b.h ?? H}}}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
`;

for (const b of BOARDS) writeFileSync(join(HERE, b.file), page(b));
writeFileSync(join(HERE, 'canvas.json'), JSON.stringify({ artboards: BOARDS.map((b) => ({ file: b.file, x: b.x, y: b.y, w: W, h: b.h ?? H, title: b.title })), notes: NOTES }, null, 2) + '\n');
const proj = join(CANVAS_OUT, 'project');
mkdirSync(proj, { recursive: true });
for (const b of BOARDS) writeFileSync(join(proj, b.file), page(b));
writeFileSync(join(proj, 'canvas.json'), JSON.stringify({
  v: 3, createdOnFiles: { v: 1, at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }, title: 'First Run Doors', launch: { view: 'canvas' }, pages: [],
  boards: Object.fromEntries(BOARDS.map((b) => [b.file, { x: b.x, y: b.y, w: W, h: b.h ?? H, title: b.title }])),
  order: BOARDS.map((b) => b.file), notes: NOTES, designSystems: [],
}, null, 2) + '\n');
console.log(`wrote ${BOARDS.length} artboards + canvas.json to ${HERE}\nwrote the canvas bundle to ${proj}`);
