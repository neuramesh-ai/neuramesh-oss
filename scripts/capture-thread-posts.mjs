// Evidence capture for thread-native post drafts (0115) — the real <App/> and the mock bridge in
// an offscreen Electron BrowserWindow, capturePage()d in BOTH themes. Electron rather than
// headless Chrome for the reason capture-evidence-electron.mjs documents: this IS the app's
// renderer. Points at the RUNNING preview dev server, so no build step.
//
//   pnpm --dir apps/desktop exec electron ../../scripts/capture-thread-posts.mjs [port]
//
// EVERY step polls until it returns true and THROWS if it never does, and the run exits non-zero
// on any failure. A capture script whose selector matches nothing must never quietly write a
// screenshot of the home screen and call it evidence — that has shipped here before.
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/evidence/thread-posts');
mkdirSync(OUT, { recursive: true });
const PORT = process.argv.find((a) => /^\d{4,5}$/.test(a)) ?? '5199';
// the seeded conversation: three drafts handed over IN a #dev thread, one of them revised
const CONVO = 'Posts on the memory spine';
const BASE = `http://localhost:${PORT}/?calm=1&plan=cloud&clicktext=${encodeURIComponent(CONVO)}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** the conversation is open AND its cards have loaded (contentByThread is polled, not synced) */
const CARDS_IN = `(() => document.querySelectorAll('.threadpanel.convo .mkpostcard').length >= 3)()`;
const scrollTop = `(() => { const l = document.querySelector('.convomsgs'); if (!l) return false; l.scrollTop = 0; return true; })()`;
const scrollBottom = `(() => { const l = document.querySelector('.convomsgs'); if (!l) return false; l.scrollTop = l.scrollHeight; return true; })()`;

/** arm the composer from a card's request-changes button */
const armReply = (letter) => `(() => {
  const b = [...document.querySelectorAll('.mkpcreply')].find((x) => (x.getAttribute('aria-label') || '').includes('draft ${letter}'));
  if (!b) return false; b.click(); return true; })()`;

/** open the approve/schedule overlay from the first card */
const openPreview = `(() => { const g = document.querySelector('.mkpcgo'); if (!g) return false; g.click(); return true; })()`;

const SHOTS = [
  ['delivery-strip', [scrollTop]],
  ['revision-anchored', [scrollBottom]],
  ['request-changes-armed', [scrollTop, armReply('c')]],
  ['approve-schedule', [scrollTop, openPreview]],
];

// ── the assertions (the reason this file exists, not the pictures) ─────────────────────────────

// Complaint 2: the cards carry the three things a posts.json cannot — approve/schedule, request
// changes, and a per-network preview. Asserted on the CONVERSATION thread, where none of it existed.
const CARDS_ARE_ACTIONABLE = `(() => {
  const cards = [...document.querySelectorAll('.threadpanel.convo .mkpostcard')];
  if (cards.length < 3) return false;
  const live = cards.filter((c) => !c.classList.contains('mkpcold'));
  // every live card offers BOTH verbs; a superseded version offers neither (it is history)
  const actionable = live.every((c) => c.querySelector('.mkpcreply') && c.querySelector('.mkpcgo'));
  const old = cards.filter((c) => c.classList.contains('mkpcold'));
  const historyIsInert = old.length >= 1 && old.every((c) => !c.querySelector('.mkpcreply') && !c.querySelector('.mkpcgo'));
  // platform-native previews, not one generic slab
  const nets = new Set(live.map((c) => (c.querySelector('.mkpcnet') || {}).textContent || ''));
  return actionable && historyIsInert && nets.size >= 2; })()`;

// The letters are the shared vocabulary: a conversation has no task number, so the card must say
// "draft b" rather than "#undefined·b" — the thing that would break if taskNumber were required.
const LETTERS_NOT_TASK_REFS = `(() => {
  const ids = [...document.querySelectorAll('.threadpanel.convo .mkpcid')].map((e) => e.textContent || '');
  return ids.length >= 3 && ids.every((t) => /^draft [a-z]/.test(t)) && !ids.some((t) => /#|undefined|NaN/.test(t)); })()`;

// A revision replaces IN PLACE: b keeps its letter, its old version is marked replaced, and the
// new one is a v2 — never a fourth card appended to the strip.
const REVISION_IS_IN_PLACE = `(() => {
  const ids = [...document.querySelectorAll('.threadpanel.convo .mkpcid')].map((e) => (e.textContent || '').trim());
  const letters = ids.map((t) => t.replace('draft ', '')[0]);
  const bCards = ids.filter((t) => t.startsWith('draft b'));
  return new Set(letters).size === 3 && bCards.length === 2 && bCards.some((t) => /v2$/.test(t)); })()`;

// The armed composer names the card it belongs to, so a long reply cannot lose which draft it is about.
const ARMED_NAMES_THE_CARD = `(() => {
  const box = document.querySelector('.threadpanel.convo .cbox.armed');
  const pill = document.querySelector('.threadpanel.convo .cbox .modechip');
  const ta = document.querySelector('.threadpanel.convo .tcompose textarea');
  return !!box && !!pill && /draft c/.test(pill.textContent || '') && /draft c/.test((ta || {}).placeholder || ''); })()`;

// The overlay is the human's gate: approve+schedule is reachable from a conversation.
const APPROVE_IS_REACHABLE = `(() => {
  const panel = document.querySelector('.mkdocovl .mkdocpanel');
  if (!panel) return false;
  const labels = [...panel.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
  return labels.some((t) => /Approve/i.test(t)); })()`;

// A briefed draft offers the draw, in a CONVERSATION — the reported gap. The daemon branch was
// gated on `t.kind === 'content'` + an assignee, so a thread card could state its art direction
// and never act on it. Only the briefed card offers it; the others must not.
const IMAGE_BUTTON_ON_BRIEFED_CARD = `(() => {
  const cards = [...document.querySelectorAll('.threadpanel.convo .mkpostcard')];
  if (cards.length < 3) return false;
  const gen = (c) => [...c.querySelectorAll('button')].some((b) => /Generate image|Try again|Connect an image model/.test(b.textContent || ''));
  const briefed = cards.filter((c) => c.querySelector('.mkpcbrief'));
  return briefed.length >= 1 && briefed.every(gen) && cards.filter((c) => !c.querySelector('.mkpcbrief')).every((c) => !gen(c)); })()`;

// …and pressing it posts a message the human can READ: the ‹gen-image:…› the daemon acts on is
// stripped at render. The task thread always did this; the conversation leaked the raw marker.
const clickGenerate = `(() => {
  const b = [...document.querySelectorAll('.threadpanel.convo .mkpcsetup button')].find((x) => /Generate image/.test(x.textContent || ''));
  if (!b) return false; b.click(); return true; })()`;
const NO_MARKER_LEAKS = `(() => {
  const txt = [...document.querySelectorAll('.threadpanel.convo .convomsgs .msg .body')].map((e) => e.textContent || '').join(' ');
  return /Generate the image for draft/.test(txt) && !/‹|gen-image:|revised:|cards:/.test(txt); })()`;

const ASSERTS = [
  ['cards carry approve · request-changes · per-network preview (history stays inert)', [scrollTop], CARDS_ARE_ACTIONABLE],
  ['a conversation letters its drafts, with no task number to borrow', [scrollTop], LETTERS_NOT_TASK_REFS],
  ['a revision replaces in place — b keeps its letter, the old version is marked replaced', [scrollTop], REVISION_IS_IN_PLACE],
  ['request-changes arms the composer and names the card', [scrollTop, armReply('c')], ARMED_NAMES_THE_CARD],
  ['approve · schedule is reachable from the conversation', [scrollTop, openPreview], APPROVE_IS_REACHABLE],
  ['a briefed draft offers Generate image in a conversation — and only a briefed one', [scrollTop], IMAGE_BUTTON_ON_BRIEFED_CARD],
  ['pressing it posts readable prose — the machine marker never reaches the transcript', [scrollTop, clickGenerate], NO_MARKER_LEAKS],
];

async function waitFor(win, expr, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await win.webContents.executeJavaScript(expr).catch(() => false)) return;
    await sleep(200);
  }
  throw new Error(`${label} — never became true`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 940, show: false, webPreferences: { backgroundThrottling: false } });
  let failed = 0;

  const boot = async (theme) => {
    await win.loadURL(`${BASE}&theme=${theme}`);
    await waitFor(win, `(() => !!document.querySelector('.shell'))()`, `${theme} boot`);
    await waitFor(win, CARDS_IN, `${theme} — the conversation's draft cards`, 90);
    await sleep(500);
  };

  for (const theme of ['dark', 'cream-oak']) {
    for (const [name, steps] of SHOTS) {
      const label = `${theme}/${name}`;
      try {
        await boot(theme);
        for (const step of steps) { await waitFor(win, step, label); await sleep(300); }
        await sleep(400);
        const file = join(OUT, `${theme}-${name}.png`);
        writeFileSync(file, (await win.webContents.capturePage()).toPNG());
        console.log(`✓ ${file}`);
      } catch (e) { failed++; console.error(`✗ ${label} — ${e.message}`); }
    }
  }

  for (const [what, steps, expr] of ASSERTS) {
    try {
      await boot('dark');
      for (const step of steps) { await waitFor(win, step, what); await sleep(300); }
      await waitFor(win, expr, `assert: ${what}`, 40);
      console.log(`✓ assert: ${what}`);
    } catch (e) { failed++; console.error(`✗ ${e.message}`); }
  }

  console.log(failed ? `\n${failed} step(s) FAILED` : '\nall steps passed');
  app.exit(failed ? 1 : 0);
});
