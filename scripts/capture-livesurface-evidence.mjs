// Evidence for docs/29 §10 — the task thread keeps ONE live surface.
//
// The selectors here are the REAL ones and that is the whole point: the first pass of this
// capture probed `.aghost`, a class that does not exist, so it reported the ghost gone while
// the screenshot plainly showed it. A selector that matches nothing is not a passing test —
// every assertion below is paired with a positive control that must be non-zero, so a typo'd
// selector fails loudly instead of reading as success.
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';

const R = process.env.NM_REPO_ROOT ?? new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = `${R}/docs/evidence/livesurface`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bg = (sel) => `(() => { const e = document.querySelector('${sel}'); return e ? getComputedStyle(e).backgroundColor : null; })()`;

const AUDIT = `(() => {
  const q = (s) => document.querySelector(s);
  const n = (s) => document.querySelectorAll(s).length;
  return {
    // the claim: no ghost in the task panel …
    ghosts: n('.ghostmsg'),
    // the row the report actually named: "@x is working · view activity" above the composer
    typistChips: n('.typingbar .typist'),
    typistText: q('.typingbar .typist')?.textContent?.trim() ?? null,
    // … and the positive control that proves the selector CAN match: the thread rendered at all
    msgs: n('.tmsgs .msg'),
    runCard: n('[data-run]'),
    beatsRest: !!q('.beatswrap.tick .beats.min'),
    beatsLabel: q('.beatcnt')?.textContent ?? null,
    // the RESTING pill is painted by .beatshead — .beats.min sets 'background: none' on purpose,
    // so probing .beats here would read rgba(0,0,0,0) and prove nothing about what the eye sees
    restBg: q('.beats.min .beatshead') ? getComputedStyle(q('.beats.min .beatshead')).backgroundColor : null,
    liveDots: n('.navhistdot.live'),
    totalDots: n('.navhistdot'),
    pulseAnim: q('.navhistdot.live') ? getComputedStyle(q('.navhistdot.live')).animationName : null,
  };
})()`;

// The ghost must SURVIVE in a chat thread — that is the split this change preserves, so it
// gets its own shot rather than being asserted in prose.
const CHAT_AUDIT = `(() => ({ ghosts: document.querySelectorAll('.ghostmsg').length, msgs: document.querySelectorAll('.msg').length }))()`;

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1440, height: 940, show: false });
  let bad = 0;
  const load = async (qs) => { await win.loadURL(`file://${R}/apps/desktop/out/preview/index.html?${qs}`); await sleep(3800); };
    try {
    for (const theme of ['cream-oak', 'dark']) {
      await load(`theme=${theme}&plan=cloud&channel=dev&openTask=1046`);
      const a = await win.webContents.executeJavaScript(AUDIT);
      console.log(`task-panel/${theme}`, JSON.stringify(a));
      // fail loudly rather than capture a lie
      if (a.msgs === 0) { console.error('CONTROL FAILED: thread did not render — selectors unproven'); bad++; }
      if (a.ghosts !== 0) { console.error('ASSERT FAILED: ghost still in the task panel'); bad++; }
    // the run card is the positive control here: it proves an agent IS live in this thread, so
    // zero chips means "stood down", not "nothing was working"
    if (a.runCard === 0) { console.error('CONTROL FAILED: no run card — chip stand-down unproven'); bad++; }
    if (a.typistChips !== 0) { console.error(`ASSERT FAILED: typist chip still above the composer: ${a.typistText}`); bad++; }
      if (!a.beatsRest || a.beatsLabel === null) { console.error('ASSERT FAILED: beats not resting as a dial'); bad++; }
    if (!/^rgb\(255, 255, 255\)$|^rgb\(30, 30, 30\)$/.test(a.restBg ?? '')) { console.error(`ASSERT FAILED: resting pill is ${a.restBg}, not the --card surface`); bad++; }
      if (a.liveDots !== 1) { console.error(`ASSERT FAILED: expected 1 live dot, got ${a.liveDots}`); bad++; }
      if (a.pulseAnim !== 'navdot-pulse') { console.error(`ASSERT FAILED: pulse animation is ${a.pulseAnim}`); bad++; }
      writeFileSync(`${OUT}/task-panel-${theme}.png`, (await win.webContents.capturePage()).toPNG());

      // hover the resting dial → the full docs/17 tracker. React synthesizes onMouseEnter from
      // a BUBBLING mouseover, so dispatching 'mouseenter' here would silently capture a cold frame.
      await win.webContents.executeJavaScript(`(() => { const w = document.querySelector('.beatswrap'); w?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return true; })()`);
      await sleep(400);
      const h = await win.webContents.executeJavaScript(`(() => {
        const pop = document.querySelector('.beatpop');
        const wrap = document.querySelector('.beatswrap');
        const cs = pop ? getComputedStyle(pop) : null;
        return {
          steps: document.querySelectorAll('.beatlist .beat').length,
          isPopover: cs?.position ?? null,
          // resolved to pixels by getComputedStyle, so 'bottom center' arrives as "170px 212px".
          // Compare against the box: x ≈ half the width, y ≈ the full height.
          origin: cs?.transformOrigin ?? null,
          originIsBottomCentre: (() => {
            if (!pop || !cs) return null;
            const [ox, oy] = cs.transformOrigin.split(' ').map(parseFloat);
            const r = pop.getBoundingClientRect();
            return Math.abs(ox - r.width / 2) < 1.5 && Math.abs(oy - r.height) < 1.5;
          })(),
          anim: cs?.animationName ?? null,
          // the "not full width" claim, measured: the panel against the composer it sits over
          popW: pop ? Math.round(pop.getBoundingClientRect().width) : null,
          wrapW: wrap ? Math.round(wrap.getBoundingClientRect().width) : null,
          // the fold the report asked to remove
          earlierPhases: document.querySelectorAll('.phasefold, .beathist').length,
          panelBg: cs?.backgroundColor ?? null,
          titles: [...document.querySelectorAll('.beatlist .beattitle')].map((e) => e.textContent).slice(0, 6),
        };
      })()`);
      console.log(`beats-hover/${theme}`, JSON.stringify(h));
      if (h.steps === 0) { console.error('ASSERT FAILED: hover revealed no beat steps'); bad++; }
      if (h.isPopover !== 'absolute') { console.error(`ASSERT FAILED: reveal is not a popover (position: ${h.isPopover})`); bad++; }
      if (h.anim !== 'beatpop-in') { console.error(`ASSERT FAILED: reveal animation is ${h.anim}`); bad++; }
      if (h.originIsBottomCentre !== true) { console.error(`ASSERT FAILED: transform-origin ${h.origin} is not bottom-centre of the panel box`); bad++; }
      // wrapW is the positive control: a real, non-zero row to compare against
      if (!h.wrapW) { console.error('CONTROL FAILED: no .beatswrap width to compare'); bad++; }
      else if (h.popW >= h.wrapW * 0.6) { console.error(`ASSERT FAILED: panel is ${h.popW}px of ${h.wrapW}px — still reads as full width`); bad++; }
      if (h.earlierPhases !== 0) { console.error(`ASSERT FAILED: ${h.earlierPhases} history fold(s) still in the reveal`); bad++; }
      writeFileSync(`${OUT}/beats-hover-${theme}.png`, (await win.webContents.capturePage()).toPNG());
    }
    // the ghost's surviving home: a chat thread, where no run card exists
    await load('theme=cream-oak&plan=cloud&channel=general&openThread=th-flowe-runs');
    const c = await win.webContents.executeJavaScript(CHAT_AUDIT);
    console.log('chat-thread/cream-oak', JSON.stringify(c));
    if (c.msgs === 0) { console.error('CONTROL FAILED: chat thread did not render'); bad++; }
    writeFileSync(`${OUT}/chat-ghost-cream.png`, (await win.webContents.capturePage()).toPNG());
    console.log(bad === 0 ? 'ALL ASSERTIONS PASSED' : `${bad} ASSERTION(S) FAILED`);
  } catch (e) {
    console.error('FAILED:', e?.message ?? e);
  } finally {
    app.quit();
  }
});
