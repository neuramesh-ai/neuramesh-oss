// Evidence for docs/35 — the sessions shell: a room is a folder of sessions, Home is the same
// list unscoped, and an open session is a SURFACE rather than a sheet over a feed.
//
// Every absence assertion below is paired with a NON-ZERO positive control, because a selector
// that matches nothing reports success otherwise (the trap etched after four false passes in one
// session). "no .sessionsurf on the room home" only means something because rows > 0 proves the
// list mounted; "feed: 0" only means something because briefs + rows are non-zero on the same
// frame. Run it right after a preview build, never against a stale bundle:
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs \
//     && pnpm exec electron scripts/capture-sessions-shell-evidence.mjs
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';

const R = process.env.NM_REPO_ROOT ?? new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = `${R}/docs/evidence/sessions-shell`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the ROOM home: brief cards over a day-grouped session list, no feed, no sheet
const ROOM_AUDIT = `(() => {
  const n = (s) => document.querySelectorAll(s).length;
  const q = (s) => document.querySelector(s);
  const txt = (s) => q(s)?.textContent?.trim() ?? null;
  const rows = [...document.querySelectorAll('.srow')];
  const dial = q('.srow .sdial');
  return {
    // the pinned briefs (docs/35 §4.1)
    briefs: n('.brief'),
    briefLabel: txt('.brief .k'),
    briefBody: txt('.brief .briefbody'),
    briefEarlier: txt('.briefexp'),
    // the session list (§3.3) — group heads, and the three row kinds
    groups: [...document.querySelectorAll('.sgroup')].map((e) => e.textContent.trim()),
    rows: rows.length,
    taskRows: n('.srow .sdial'),
    chatRows: n('.srow .sglyph'),
    // a legacy row is the one whose chip reads 'room' (§10)
    legacyRows: rows.filter((r) => r.querySelector('.chip')?.textContent?.trim() === 'room').length,
    liveDials: n('.srow .sdial.live'),
    dialFrac: dial ? getComputedStyle(dial).getPropertyValue('--frac').trim() : null,
    // getComputedStyle resolves the keyword, so this is the painted hue and not the token name
    dialColor: dial ? getComputedStyle(dial).color : null,
    seeAll: txt('.sallrow'),
    // the retired plane, and the retired lens (§6) — controls above make these meaningful
    feedMsgs: n('.msgs .msg'),
    replyFooters: n('.replyfoot'),
    threadsChips: n('[data-tip^="Threads mode"]'),
    sheets: n('.taskovl'),
    // the composer's two knobs (§4.2)
    roomChip: txt('.cbox .row .cchip.pinned'),
    // docs/34 §14: the toggle is DECOMMISSIONED — count is the assertion, roomChip the control
    tasksToggles: n('.taskschip'),
    // docs/34 §7 — a composer names its consequence, and this one now carries the Tasks toggle
    consequence: q('.cbox .chint')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
  };
})()`;

// an open CHAT session: the main surface, with a back crumb — and no sheet wrapper anywhere
const SESSION_AUDIT = `(() => {
  const n = (s) => document.querySelectorAll(s).length;
  const q = (s) => document.querySelector(s);
  const surf = q('.sessionsurf');
  return {
    sheets: n('.taskovl'),          // the claim
    veils: n('.taskveil'),          // …and its veil
    surfaces: n('.sessionsurf'),    // the control: something DID open
    panel: n('.threadpanel'),
    crumb: q('.scrumb')?.textContent?.trim() ?? null,
    msgs: n('.tmsgs .msg'),         // …and it rendered the conversation
    anim: surf ? getComputedStyle(surf).animationName : null,
    // the room home must be GONE from view, not merely covered by a translucent sheet
    surfBg: surf ? getComputedStyle(surf).backgroundColor : null,
  };
})()`;

// HOME: needs-you on top, then the unified list with room tags, plus New chat in the rail
const HOME_AUDIT = `(() => {
  const n = (s) => document.querySelectorAll(s).length;
  const q = (s) => document.querySelector(s);
  const rows = [...document.querySelectorAll('.srow')];
  return {
    // docs/35 §9a: Home keeps its v0.68 FACE — queue cards + In flight, no session list here
    greeting: q('.hgreet')?.textContent?.trim() ?? null,
    queueCards: n('.hbot .mcqcard'),
    acceptBtns: n('.hbot .mcqcard .btn.accept'),
    decisionOpts: n('.hbot .mcdopt'),
    inFlightSections: [...document.querySelectorAll('.hsect')].filter((e) => /In flight/.test(e.textContent)).length,
    flightRows: n('.frow'),
    // the session list is a ROOM surface — its absence on Home is asserted with flightRows as control
    sessionRows: rows.length,
    dayGroups: n('.sgroup'),
    newChat: q('.navnewchat')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
    tasksToggles: n('.taskschip'),
    railRows: n('.navhistrow'),
  };
})()`;

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1440, height: 940, show: false });
  const audit = {};
  let bad = 0;
  const fail = (m) => { console.error(`ASSERT FAILED: ${m}`); bad++; };
  const control = (m) => { console.error(`CONTROL FAILED: ${m}`); bad++; };
  const load = async (qs) => { await win.loadURL(`file://${R}/apps/desktop/out/preview/index.html?${qs}`); await sleep(3600); };
  const shot = async (name) => writeFileSync(`${OUT}/${name}.png`, (await win.webContents.capturePage()).toPNG());

  try {
    for (const theme of ['cream-oak', 'dark']) {
      // ── the room home ──
      await load(`theme=${theme}&plan=cloud&channel=dev`);
      const a = await win.webContents.executeJavaScript(ROOM_AUDIT);
      audit[`room-${theme}`] = a;
      console.log(`room/${theme}`, JSON.stringify(a));
      if (a.rows === 0) control('the session list rendered no rows — every selector below is unproven');
      if (a.briefs < 1) fail('no brief card pinned above the list');
      if (a.briefLabel !== 'Room brief') fail(`brief label reads ${a.briefLabel}`);
      if (!a.briefEarlier) fail('the brief stack has no expander — older briefs are unreachable');
      if (a.groups.length < 2) fail(`expected ≥2 day groups, got ${JSON.stringify(a.groups)}`);
      if (a.taskRows < 1) fail('no task row (no state dial in the list)');
      if (a.chatRows < 1) fail('no chat row');
      if (a.legacyRows < 1) fail('no legacy room-message row — docs/35 §10 is unpaid');
      if (!/%$/.test(a.dialFrac ?? '')) fail(`the dial carries no arc (--frac: ${a.dialFrac})`);
      if (!/^rgb/.test(a.dialColor ?? '')) fail(`the dial has no state hue (color: ${a.dialColor})`);
      if (a.feedMsgs !== 0) fail(`${a.feedMsgs} feed message row(s) still render`);
      if (a.replyFooters !== 0) fail('the feed reply footer still renders');
      if (a.threadsChips !== 0) fail(`the docs/20 threads chip is still in the composer (${a.threadsChips})`);
      if (a.sheets !== 0) fail(`${a.sheets} .taskovl sheet(s) on the room home`);
      if (!a.roomChip) fail('the composer has no pinned room chip');
      if (a.tasksToggles !== 0) fail(`${a.tasksToggles} Tasks toggle(s) survive decommissioning`);
      if (!a.roomChip) fail('no room chip — composer controls unproven, toggle absence means nothing');
      if (!a.consequence) fail('the composer does not name its consequence');
      await shot(`room-home-${theme}`);

      // ── an open chat session ──
      await load(`theme=${theme}&plan=cloud&channel=dev&clicktext=the drawer still traps focus on iPad`);
      const s = await win.webContents.executeJavaScript(SESSION_AUDIT);
      audit[`session-${theme}`] = s;
      console.log(`session/${theme}`, JSON.stringify(s));
      if (s.surfaces !== 1) control(`expected 1 session surface, got ${s.surfaces} — absence claims unproven`);
      if (s.msgs === 0) control('the session rendered no messages');
      if (s.sheets !== 0) fail(`${s.sheets} .taskovl still wraps the session`);
      if (s.veils !== 0) fail(`${s.veils} .taskveil still dims a plane behind the session`);
      if (!s.crumb?.startsWith('‹ #dev')) fail(`the back crumb reads ${s.crumb}`);
      if (s.anim === 'nm-sheetin') fail('the session still flies in as a sheet');
      await shot(`session-chat-${theme}`);

      // ── the task session: same surface, same crumb anatomy ──
      await load(`theme=${theme}&plan=cloud&channel=dev&openTask=1046`);
      const tk = await win.webContents.executeJavaScript(SESSION_AUDIT);
      audit[`task-${theme}`] = tk;
      console.log(`task/${theme}`, JSON.stringify(tk));
      if (tk.surfaces !== 1) control(`expected 1 task surface, got ${tk.surfaces}`);
      if (tk.msgs === 0) control('the task panel rendered no messages');
      if (tk.sheets !== 0) fail(`${tk.sheets} .taskovl still wraps the task panel`);
      if (!tk.crumb?.startsWith('‹ #dev')) fail(`the task crumb reads ${tk.crumb}`);
      await shot(`session-task-${theme}`);

      // ── Home ──
      await load(`theme=${theme}&plan=cloud`);
      const h = await win.webContents.executeJavaScript(HOME_AUDIT);
      audit[`home-${theme}`] = h;
      console.log(`home/${theme}`, JSON.stringify(h));
      if (h.flightRows === 0) control('zero in-flight rows — the harness seeds some, so the face is unproven');
      if (h.railRows === 0) control('the Recents rail is empty — nav unproven');
      if (h.queueCards === 0) fail('no queue cards on Home — the v0.68 face did not come back');
      if (h.acceptBtns === 0) fail('the queue cards lost their Accept button');
      if (h.decisionOpts === 0) fail('the decision card lost its options');
      if (h.inFlightSections === 0) fail('no In flight section — Home lost its v0.68 face');
      if (h.sessionRows !== 0) fail(`${h.sessionRows} session row(s) on Home — the session list belongs to the room (§9a)`);
      if (h.dayGroups !== 0) fail(`${h.dayGroups} day-group head(s) on Home`);
      if (h.tasksToggles !== 0) fail(`${h.tasksToggles} Tasks toggle(s) survive on Home`);
      if (!/New chat/.test(h.newChat ?? '')) fail(`the rail's New chat button reads ${h.newChat}`);
      if (!/⌘N/.test(h.newChat ?? '')) fail('New chat does not name its shortcut');
      await shot(`home-${theme}`);
    }
    // ── the keyboard contract: ⌘N is new, ⌘Y and ⌘K must survive it ──
    const key = (k) => win.webContents.executeJavaScript(
      `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', metaKey: true, bubbles: true })); return true; })()`,
    );
    const esc = () => win.webContents.executeJavaScript(
      `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`,
    );
    await load('theme=cream-oak&plan=cloud&channel=dev');
    await key('y'); await sleep(400);
    const k1 = await win.webContents.executeJavaScript(`(() => ({ overlay: document.querySelectorAll('.histovl').length, rows: document.querySelectorAll('.histrow').length }))()`);
    await esc(); await sleep(300);
    await key('k'); await sleep(400);
    const k2 = await win.webContents.executeJavaScript(`(() => document.querySelectorAll('.cmdk, .cmdkwrap, [aria-label="Quick actions"]').length)()`);
    await esc(); await sleep(300);
    await key('n'); await sleep(600);
    const k3 = await win.webContents.executeJavaScript(`(() => ({
      onHome: !!document.querySelector('.hwrap'),
      focused: document.activeElement?.tagName?.toLowerCase() ?? null,
      inComposer: !!document.activeElement?.closest?.('.hcomposer'),
    }))()`);
    audit.keys = { cmdY: k1, cmdKOverlays: k2, cmdN: k3 };
    console.log('keys', JSON.stringify(audit.keys));
    if (k1.overlay !== 1) fail(`⌘Y did not open the history overlay (${k1.overlay})`);
    if (k1.rows === 0) control('the ⌘Y overlay opened empty — its rows are unproven');
    if (k2 === 0) fail('⌘K no longer opens the palette');
    if (!k3.onHome) fail('⌘N did not land on Home');
    if (!k3.inComposer) fail(`⌘N did not focus Home's composer (active: ${k3.focused})`);
    await shot('cmd-n-home');

    writeFileSync(`${OUT}/audit.json`, JSON.stringify(audit, null, 2));
    console.log(bad === 0 ? 'ALL ASSERTIONS PASSED' : `${bad} ASSERTION(S) FAILED`);
  } catch (e) {
    console.error('FAILED:', e?.stack ?? e);
    bad++;
  } finally {
    app.exit(bad === 0 ? 0 : 1);
  }
});
