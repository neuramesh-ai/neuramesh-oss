// Builds the design contract from one source: the canvas artboards (Claude Design, one .dc.html
// per screen, both themes side by side), canvas.json, and the self-contained mockup.html the
// docs/33 §11 gate reads. Run: node docs/design/mobile-cloud-2026-09/build/build.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS, FONTS } from './ui.mjs';
import { SCREENS, ONBOARDING } from './screens.mjs';
import { THEMES } from './tokens.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const canvasDir = join(root, 'canvas');
mkdirSync(canvasDir, { recursive: true });

const artboard = (s) => `<div class="ab">${Object.values(THEMES).map((t) => `<div class="col ${t.cls}"><div class="collbl">${t.label} · ${s.title}</div><div class="phone">${s.html()}</div></div>`).join('')}</div>`;

// ── the canvas: one artboard per screen ──
for (const s of [...SCREENS, ...ONBOARDING]) {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="${FONTS}">
  <style>
    body { margin: 0; }
    a { color: #9c5730; } a:hover { color: #834a2b; }
${CSS}
  </style>
</helmet>
${artboard(s)}
</x-dc>
</body>
</html>
`;
  writeFileSync(join(canvasDir, `${s.id}.dc.html`), html);
}

// ── canvas.json: the flow reads left→right, top→bottom; three screens a row; a note above each row ──
const W = 900; const H = 944; const PX = 980; const PY = 1100;
const ORDER = ['SignIn', 'Arrival', 'Main', 'NewChat', 'Thread', 'History', 'Code', 'CodeThread', 'NewCode', 'Routines', 'RoutineThread', 'Calendar', 'Compute', 'Notifications', 'Vocabulary'];
const ROW_NOTES = [
  'ROW 1 · Sign in → your cloud machine → Home. The head is the frame at phone scale: workspace ▾ · the cloud-machine pill (state colour) · the credit ring · search · you. Home = needs-you + the sessions list. New chat is the FAB.',
  'ROW 2 · Composing, reading, finding. The composer keeps the desktop’s three knobs (room · brain · machine). A phone-born session prefers the cloud (threadOrigin ‘web’ unless the ladder needs to tell phones apart). History is the everything-lens.',
  'ROW 3 · Code on the cloud machine over the relay. The list needs a synced Code-session record (today sessions are desktop-local) — the gate-2 decision. A Code thread is conversation first, evidence a segment away.',
  'ROW 4 · Routines · Calendar nest under one head. A routine’s run is a session (the clock glyph) — tracking one is opening its thread.',
  'ROW 5 · Compute is reached from the head’s pill. Push gains three kinds (question · Code approval · routine finished); every tap deep-links. The vocabulary sheet is what the reviewer gates on.',
];
const OB_ORDER = ['Account', 'Workspace', 'Machine', 'Brain', 'Team', 'Launch', 'FirstReply', 'Setup', 'Invited', 'Joined'];
const OB_NOTES = [
  'ONBOARDING · ROW 1 · Sign-up on the phone: the same Clerk page the desktop hands off to, in Safari, returning here. Then the browser wizard’s order — Workspace first (Continue mints the id the machine is provisioned against), the Machine beat never blocks.',
  'ONBOARDING · ROW 2 · Keys is never a gate (the starter door: 500 credits), the crew is named and brained on the house brain, Launch registers the crew on the CLOUD machine.',
  'ONBOARDING · ROW 3 · The first reply lands on your cloud machine; setup follows it as a pinned card (no “mobile app” item — you are holding it).',
  'ONBOARDING · ROW 4 · An invited newcomer joins before any wizard; on Team the join provisions their own machine and the join moment names it.',
];
const artboards = [
  ...ORDER.map((id, i) => {
    const s = SCREENS.find((x) => x.id === id);
    return { file: `${id}.dc.html`, title: s.title, x: (i % 3) * PX, y: Math.floor(i / 3) * PY, w: W, h: H, page: 'app' };
  }),
  ...OB_ORDER.map((id, i) => {
    const s = ONBOARDING.find((x) => x.id === id);
    return { file: `${id}.dc.html`, title: s.title, x: (i % 3) * PX, y: Math.floor(i / 3) * PY, w: W, h: H, page: 'onboarding' };
  }),
];
const annotations = [
  ...ROW_NOTES.map((text, r) => ({ id: `row-${r + 1}`, x: 0, y: r * PY - 118, w: 1500, text, page: 'app' })),
  ...OB_NOTES.map((text, r) => ({ id: `ob-row-${r + 1}`, x: 0, y: r * PY - 118, w: 1500, text, page: 'onboarding' })),
];
writeFileSync(join(canvasDir, 'canvas.json'), JSON.stringify({
  pages: [{ id: 'app', name: 'The app' }, { id: 'onboarding', name: 'Onboarding' }],
  artboards, annotations, launch: { view: 'canvas', page: 'onboarding' },
}, null, 2) + '\n');

// ── mockup.html: the same screens, one page, both themes — the repo's design-gate artifact ──
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NeuraMesh mobile · cloud round · design contract</title>
<link rel="stylesheet" href="${FONTS}">
<style>
${CSS}
html, body { margin: 0; background: #1a1a1a; color: #cbcbcb; font: 14px/1.5 'Geist', -apple-system, sans-serif; }
.doc { max-width: 1900px; margin: 0 auto; padding: 40px 30px 80px; }
.doc h1 { font: 600 30px/1.15 'Source Serif 4', Georgia, serif; letter-spacing: -.01em; margin: 0 0 8px; }
.doc .lead { color: #a6a6a6; max-width: 900px; margin: 0 0 6px; }
.doc .meta { font: 500 11px 'JetBrains Mono', monospace; letter-spacing: .06em; color: #6a6a6a; text-transform: uppercase; margin-bottom: 30px; }
.scr { margin: 0 0 46px; }
.scr h2 { font: 600 20px/1.2 'Source Serif 4', Georgia, serif; margin: 0 0 6px; letter-spacing: -.01em; }
.scr .note { color: #a6a6a6; max-width: 900px; margin: 0 0 14px; font-size: 13.5px; }
.scr .ab { display: inline-flex; border-radius: 22px; overflow: hidden; box-shadow: 0 20px 55px -14px rgba(0,0,0,.65); }
</style>
</head>
<body>
<div class="doc">
  <h1>The mobile app, on the cloud plane</h1>
  <p class="lead">The design contract for the mobile-cloud round (docs/33 §11 gate). Every screen renders from one source in both review themes; tokens are lifted verbatim from tokens.css and client-core THEMES. Decisions and the plan: <code>plan.md</code> beside this file. The same artboards are published as a Claude Design canvas for review.</p>
  <div class="meta">docs/design/mobile-cloud-2026-09 · generated by build/build.mjs · sample data</div>
  ${ORDER.map((id) => SCREENS.find((x) => x.id === id)).map((s) => `<section class="scr" id="${s.id}"><h2>${s.title}</h2><p class="note">${s.note}</p>${artboard(s)}</section>`).join('\n')}
  <h1 style="margin-top:40px">Onboarding on the phone</h1>
  <p class="lead">Sign up on the phone and a cloud machine comes with your workspace: the browser wizard’s order, one screen per step, then the first reply on that machine, then setup as a pinned card. Added 2026-09-05 (George).</p>
  ${OB_ORDER.map((id) => ONBOARDING.find((x) => x.id === id)).map((s) => `<section class="scr" id="${s.id}"><h2>${s.title}</h2><p class="note">${s.note}</p>${artboard(s)}</section>`).join('\n')}
</div>
</body>
</html>
`;
writeFileSync(join(root, 'mockup.html'), page);
console.log(`built ${SCREENS.length + ONBOARDING.length} artboards → ${canvasDir}, canvas.json, mockup.html`);
