// Evidence capture for the agent-identity + post-preview slice, via Electron itself — the real
// <App/> and the mock bridge in an offscreen BrowserWindow, capturePage()d in BOTH themes.
// Electron rather than headless Chrome for the reason capture-evidence-electron.mjs already
// documents: this IS the app's renderer, so app timers and the preview pane's quirks can't
// wedge it. Points at the RUNNING preview dev server so no build step is needed.
//
//   pnpm --dir apps/desktop exec electron ../../scripts/capture-agent-identity.mjs [port]
//
// EVERY step polls until it returns true and THROWS if it never does — a capture script whose
// selector matches nothing must not quietly write a screenshot of the home screen and call it
// evidence. That failure mode has shipped here before; this is the guard against it.
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/evidence/agent-identity');
mkdirSync(OUT, { recursive: true });
const PORT = process.argv.find((a) => /^\d{4,5}$/.test(a)) ?? '5205';
const BASE = `http://localhost:${PORT}/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** click the recents-rail row for a task number */
const openTask = (n) => `(() => {
  // NO \\b anchors: a row reads "1025Two X posts…", so there is no word boundary after the
  // number — the anchored regex matched nothing and every capture silently failed.
  const el = [...document.querySelectorAll('.navhistrow')].find((e) => (e.textContent || '').startsWith('${n}'));
  if (!el) return false; el.click(); return true; })()`;

/** the selector exists → scroll it into view */
const focusOn = (sel, block = 'center') => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false; el.scrollIntoView({ block: ${JSON.stringify(block)} }); return true; })()`;

/** where an agent's face is on screen — hovering it needs a REAL pointer (below), because
 *  React derives onMouseEnter from delegated mouseover/mouseout and ignores a synthetic
 *  `mouseenter` dispatched straight at the node. */
const faceBox = (who) => `(() => {
  const b = [...document.querySelectorAll('.pavbtn')].find((e) => /${who}/i.test(e.getAttribute('aria-label') || ''));
  if (!b) return null;
  b.scrollIntoView({ block: 'center' });
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`;

const clickFace = (who) => `(() => {
  const b = [...document.querySelectorAll('.pavbtn')].find((e) => /${who}/i.test(e.getAttribute('aria-label') || ''));
  if (!b) return false; b.click(); return true; })()`;

const SHOTS = [
  // A — the show verb: one line of prose + the cards recalled under it (never retyped)
  ['show-verb', [openTask(1025), focusOn('.mkrecall')]],
  // A — the wire file reads as posts on a task the triage did NOT type as content (#1048's shape)
  ['posts-file-preview', [openTask(1032), focusOn('.fposts')]],
  // B — rex is the worst case: an orchestrator auto-joins EVERY room. Identity only, no chips.
  ['hover-card-rex', [openTask(1050), { hover: 'rex' }, focusOn('.agentpop', 'nearest')]],
  ['agent-overlay-rex', [openTask(1050), clickFace('rex'), focusOn('.modal')]],
  // B — hover the face: identity, one line of what it does, presence. No instructions.
  ['hover-card', [openTask(1025), { hover: 'plume' }, focusOn('.agentpop', 'nearest')]],
  // B — click through: the record, both strings labelled by audience
  ['agent-overlay', [openTask(1025), clickFace('plume'), focusOn('.modal')]],
  // The verdict card replacing the docked Approve bar — the orchestrator asks, the click applies
  ['verdict-card', [openTask(1032), focusOn('.verdictcard')]],
  // B — editing both, with their two different caps
  ['agent-overlay-editing', [openTask(1025), clickFace('plume'), `(() => {
    const btns = [...document.querySelectorAll('.modal .agedit')];
    if (btns.length < 2) return false; btns[0].click(); btns[1].click(); return true; })()`,
    focusOn('.modal .agtxt', 'start')]],
];

async function waitFor(win, js, label, ms = 9000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const got = await win.webContents.executeJavaScript(js).catch((e) => `ERR ${e.message}`);
    if (got === true) return;
    if (Date.now() > deadline) throw new Error(`${label}: step never succeeded (last: ${got})`);
    await sleep(250);
  }
}

// The removal can't be photographed — a screenshot of an absent bar looks like a screenshot of
// anything. Assert it instead, on a task in the exact state that used to dock it.
// The hover target must be the TILE, not the message. `.msg` is a flex row with the default
// `align-items: stretch`, so an inline-flex wrapper grew to the message's full height and hovering
// three lines below the face opened the card (founder report). Geometry, so: measure it.
const HIT_AREA_IS_THE_TILE = `(() => {
  const btns = [...document.querySelectorAll('.msg .pavbtn')];
  if (!btns.length) return false;
  return btns.every((b) => {
    const tile = b.querySelector('.pav');
    if (!tile) return false;
    const bh = b.getBoundingClientRect().height, th = tile.getBoundingClientRect().height;
    return th > 0 && Math.abs(bh - th) <= 1;   // the button is the tile, never the column
  }); })()`;

// A tool call renders COLLAPSED, running or not — an in-flight call used to auto-open and dump
// whole prompt payloads into the thread (founder report).
const TOOLS_START_COLLAPSED = `(() => {
  const tools = document.querySelectorAll('.acttool').length;
  const open = document.querySelectorAll('.acttool.open').length;
  return tools > 0 && open === 0; })()`;

// The overlay must not scroll (founder call): assert the body fits, on the WORST case — rex, an
// orchestrator in every room. A screenshot can't prove absence of a scrollbar; measuring can.
const NO_MODAL_SCROLL = `(() => {
  const body = document.querySelector('.modal.full .modalbody');
  if (!body) return false;
  const cols = document.querySelectorAll('.modal.full .agcol').length;
  const chips = document.querySelectorAll('.agentpop .chchip').length;
  // 2px slack for sub-pixel layout; chips must be 0 — the peek carries identity only
  return cols === 2 && chips === 0 && body.scrollHeight <= body.clientHeight + 2; })()`;

// #1043: the headline said "Accept" over a button that fired approve. Assert they agree.
const HEADLINE_MATCHES_ACTION = `(() => {
  const head = document.querySelector('.verdictcard .verdicthead');
  const btn = document.querySelector('.verdictcard .btn.accept');
  if (!head || !btn) return false;
  const action = (btn.textContent || '').replace(/^\\s*✓\\s*/, '').trim();
  return action.length > 0 && (head.textContent || '').startsWith(action); })()`;

const NO_DOCKED_BAR = `(() => {
  const bar = document.querySelectorAll('.tactions').length;
  const review = [...document.querySelectorAll('button')].filter((b) => /Review Artifacts/.test(b.textContent || '')).length;
  const card = document.querySelectorAll('.verdictcard').length;
  return bar === 0 && review === 0 && card === 1; })()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 940, show: false, webPreferences: { backgroundThrottling: false } });
  let failed = 0;
  for (const theme of ['dark', 'cream-oak']) {
    for (const [name, steps] of SHOTS) {
      const label = `${theme}/${name}`;
      try {
        // calm=1 stills the one-heartbeat animations so a capture is deterministic
        await win.loadURL(`${BASE}?theme=${theme}&calm=1&plan=cloud`);
        await waitFor(win, `(() => !!document.querySelector('.shell'))()`, `${label} boot`);
        await sleep(700);
        for (const step of steps) {
          if (typeof step === 'object' && step.hover) {
            // a real pointer move — Electron's own input pipeline, so React's delegated
            // mouseover fires exactly as it does for a human
            const at = await win.webContents.executeJavaScript(faceBox(step.hover));
            if (!at) throw new Error(`no face for ${step.hover}`);
            win.webContents.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
            await sleep(500);
            continue;
          }
          await waitFor(win, step, label);
          await sleep(350);
        }
        await sleep(400);
        const file = join(OUT, `${theme}-${name}.png`);
        writeFileSync(file, (await win.webContents.capturePage()).toPNG());
        console.log(`✓ ${file}`);
      } catch (e) {
        failed++;
        console.error(`✗ ${label} — ${e.message}`);
      }
    }
  }
  // the assertion runs last, on the in_review task that used to dock the bar
  try {
    await win.loadURL(`${BASE}?theme=dark&calm=1&plan=cloud`);
    await waitFor(win, `(() => !!document.querySelector('.shell'))()`, 'assert boot');
    await sleep(700);
    await waitFor(win, openTask(1032), 'assert open #1032');
    await sleep(600);
    await waitFor(win, NO_DOCKED_BAR, 'assert: in_review docks no action bar, and the verdict card is the gate');
    await waitFor(win, HEADLINE_MATCHES_ACTION, 'assert: the verdict headline names the transition its button performs');
    console.log('✓ assert: #1032 — no docked bar · no Review Artifacts · 1 verdict card · headline == button action');
  } catch (e) { failed++; console.error(`✗ ${e.message}`); }
  try {
    await win.loadURL(`${BASE}?theme=dark&calm=1&plan=cloud`);
    await waitFor(win, `(() => !!document.querySelector('.shell'))()`, 'assert boot');
    await sleep(700);
    await waitFor(win, openTask(1050), 'assert open #1050');
    await sleep(500);
    await waitFor(win, HIT_AREA_IS_THE_TILE, 'assert: the agent face is the hover target, not the message column');
    console.log('✓ assert: every .pavbtn is exactly its 26px tile, not the message column');
    // ActivityItems mounts on three surfaces (ghost · run leg · activity panel). Assert on
    // whichever one this fixture actually renders — the rule is the component's, not the mount's.
    const found = await win.webContents.executeJavaScript(`(() => {
      for (const b of document.querySelectorAll('.liveact, .ghostpill, .legpeek, .runleg, .actpin')) { b.click(); }
      return document.querySelectorAll('.acttool').length; })()`).catch(() => 0);
    if (found > 0) {
      await waitFor(win, TOOLS_START_COLLAPSED, 'assert: tool calls render collapsed, running or not');
      console.log(`✓ assert: ${found} tool call(s) render collapsed by default`);
    } else {
      // say so rather than passing silently — an assertion with nothing to assert on is the
      // selector-matched-nothing trap wearing a green tick
      console.log('· skipped: no .acttool rendered by this fixture — collapse rule unasserted here');
    }
    await sleep(500);
    await waitFor(win, clickFace('rex'), 'assert open rex');
    await sleep(700);
    await waitFor(win, NO_MODAL_SCROLL, 'assert: the agent record is two columns and does not scroll');
    console.log('✓ assert: @rex record — 2 columns · body fits without scrolling · peek carries no room chips');
  } catch (e) { failed++; console.error(`✗ ${e.message}`); }
  if (failed) console.error(`\n${failed} check(s) FAILED.`);
  app.exit(failed ? 1 : 0);
});
