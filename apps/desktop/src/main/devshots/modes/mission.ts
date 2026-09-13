// `--shot` modes: mission, retro, taskref — extracted from index.ts (track B-devshots).

import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShotCtx } from '../driver';
    // NM_SHOT_ONLY=mission: Mission Control evidence (docs/12 §7 1e) — the Home
    // queue with a live probe task, the thread panel docking in place, and an
    // Accept-from-Home that drives the REAL task.accept against the live stack.
    // The card must leave only when the synced state flips — that's the assertion.
export async function mission({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  const probe = process.env['NM_SHOT_PROBE'] ?? '';
  // the app lands on Threads now — wait for the nav (not .mcwrap), dismiss the
  // tour, then navigate to Home so the evidence shows the dashboard
  await waitFor('.navitem', 100);
  await js(`[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Skip tour')?.click()`);
  await sleep(300);
  await js(`[...document.querySelectorAll('.navitem')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Mission Control'))?.click()`);
  await waitFor('.mcwrap', 60);
  const probeSel = `[...document.querySelectorAll('.mcqtitle')].some((e) => (e.textContent || '').includes(${JSON.stringify(probe)}))`;
  if (probe) for (let i = 0; i < 160; i++) { if (await js(probeSel)) break; await sleep(300); }
  console.log(`mission_probe_visible=${probe ? await js(probeSel) : 'n/a'}`);
  for (const theme of ['dark', 'cream-oak'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `mission-home-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `mission-home-${theme}.png`)}`);
  }
  // view-switch budget (<100ms): Home → Board → Home, double-rAF paint time
  const navMs = await js(`(async () => {
    const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const go = async (label) => {
      const btn = [...document.querySelectorAll('.navitem')].find((b) => (b.getAttribute('aria-label') || '').startsWith(label));
      if (!btn) return -1;
      const t0 = performance.now(); btn.click(); await paint(); return Math.round((performance.now() - t0) * 10) / 10;
    };
    const toBoard = await go('Board'); const toHome = await go('Mission Control');
    return JSON.stringify({ toBoard, toHome });
  })()`);
  console.log(`mission_nav_ms=${navMs}`);
  // throughput range picker: flip to Last 3 months (weekly buckets), capture, flip back
  await js(`document.querySelector('.mcq-range .nmselbtn')?.click()`);
  await sleep(250);
  await js(`[...document.querySelectorAll('.nmselopt')].find((b) => (b.textContent || '').includes('Last 3 months'))?.click()`);
  await sleep(350);
  console.log(`mission_range_quarter=${await js(`(document.querySelector('.mcthru')?.textContent || '').includes('last 3 months')`)}`);
  writeFileSync(join(dir, 'mission-throughput-quarter-dark.png'), (await win.webContents.capturePage()).toPNG());
  console.log(`shot_saved=${join(dir, 'mission-throughput-quarter-dark.png')}`);
  await js(`document.querySelector('.mcq-range .nmselbtn')?.click()`);
  await sleep(250);
  await js(`[...document.querySelectorAll('.nmselopt')].find((b) => (b.textContent || '').includes('This week'))?.click()`);
  await sleep(300);
  // NM_SHOT_DECISION=<question>: decision-card evidence (docs/12 slice 2c) — the
  // synced nmq card renders in the queue, ⌘K lists it, and answering in place
  // flips the row server-side; the card leaves ONLY on the synced status change.
  const decision = process.env['NM_SHOT_DECISION'] ?? '';
  if (decision) {
    const decSel = `[...document.querySelectorAll('.mcdec .mcqtitle')].some((e) => (e.textContent || '').includes(${JSON.stringify(decision)}))`;
    for (let i = 0; i < 120; i++) { if (await js(decSel)) break; await sleep(300); }
    console.log(`mission_decision_visible=${await js(decSel)}`);
    // the home-theme loop above ends on cream-oak — reset so the -dark capture is honest
    await js(`document.documentElement.dataset.theme = 'dark'`);
    await sleep(300);
    // ⌘K palette over the dashboard — the decision + accept rows must be listed
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))`);
    await sleep(350);
    console.log(`mission_cmdk_open=${await js(`!!document.querySelector('.cmdk')`)} cmdk_items=${await js(`document.querySelectorAll('.cmdkitem').length`)} cmdk_has_decision=${await js(`[...document.querySelectorAll('.cmdkitem b')].some((e) => (e.textContent || '').includes(${JSON.stringify(decision.slice(0, 24))}))`)}`);
    writeFileSync(join(dir, 'mission-cmdk-dark.png'), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, 'mission-cmdk-dark.png')}`);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))`);
    await sleep(250);
    // both-theme decision-card close-ups
    for (const theme of ['dark', 'cream-oak'] as const) {
      await js(`document.documentElement.dataset.theme = '${theme}'`);
      await sleep(350);
      writeFileSync(join(dir, `mission-decision-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(`shot_saved=${join(dir, `mission-decision-${theme}.png`)}`);
    }
    await js(`document.documentElement.dataset.theme = 'dark'`);
    // answer in place: first option — no optimistic removal, so card-gone IS the
    // server flip (decision.answer accepted + row synced back as answered)
    const decCard = `[...document.querySelectorAll('.mcqcard.mcdec')].find((c) => (c.querySelector('.mcqtitle')?.textContent || '').includes(${JSON.stringify(decision)}))`;
    console.log(`mission_decision_answer_clicked=${await js(`(() => { const b = ${decCard}?.querySelector('.mcdopt'); if (!b) return false; b.click(); return true; })()`)}`);
    let decGone = false;
    for (let i = 0; i < 75; i++) { decGone = !(await js(decSel)); if (decGone) break; await sleep(400); }
    console.log(`mission_decision_card_gone=${decGone}`);
    await sleep(350);
    writeFileSync(join(dir, 'mission-decision-answered-dark.png'), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, 'mission-decision-answered-dark.png')}`);
  }
  if (probe) {
    const card = `[...document.querySelectorAll('.mcqcard')].find((c) => (c.querySelector('.mcqtitle')?.textContent || '').includes(${JSON.stringify(probe)}))`;
    // Review docks the thread panel over the dashboard
    await js(`${card}?.querySelector('.mcqacts .btn:not(.primary)')?.click()`);
    await sleep(900);
    console.log(`mission_thread_open=${await js(`!!document.querySelector('.threadpanel')`)}`);
    writeFileSync(join(dir, 'mission-thread-open-dark.png'), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, 'mission-thread-open-dark.png')}`);
    await js(`document.querySelector('.threadpanel button[title="close thread"]')?.click()`);
    await sleep(400);
    // Accept from Home — no optimistic removal, so the card disappearing IS
    // proof the server accepted and the state synced back
    await js(`${card}?.querySelector('.mcqacts .btn.primary')?.click()`);
    let gone = false;
    for (let i = 0; i < 75; i++) { gone = !(await js(probeSel)); if (gone) break; await sleep(400); }
    console.log(`mission_accept_card_gone=${gone}`);
    await sleep(350);
    writeFileSync(join(dir, 'mission-after-accept-dark.png'), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, 'mission-after-accept-dark.png')}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=retro: Agent Retro evidence (docs/13) — the derived record over
    // real seeded history: both themes, then the range flipped to Last 3 months
    // (weekly buckets → dense sparks prove the re-bucketing). Counts logged so the
    // run asserts agents/lessons/level-ups actually rendered from the live endpoint.
export async function retro({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.navitem', 100);
  await js(`[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Skip tour')?.click()`);
  await sleep(250);
  await js(`[...document.querySelectorAll('.navitem')].find((b) => b.getAttribute('aria-label') === 'Retro')?.click()`);
  await waitFor('.rtcard', 120);
  // pin the range to This week — the picker pref persists per profile, so a
  // prior run would otherwise leak its range into this evidence set
  await js(`document.querySelector('.mcq-range .nmselbtn')?.click()`);
  await sleep(250);
  await js(`[...document.querySelectorAll('.nmselopt')].find((b) => (b.textContent || '').includes('This week'))?.click()`);
  await sleep(600);
  console.log(
    `retro_agents=${await js(`document.querySelectorAll('.rtcard').length`)} retro_lessons=${await js(`document.querySelectorAll('.rtlesson').length`)} retro_levelups=${await js(`document.querySelectorAll('.rtup').length`)}`,
  );
  for (const theme of ['dark', 'cream-oak'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `retro-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `retro-${theme}.png`)}`);
  }
  await js(`document.documentElement.dataset.theme = 'dark'`);
  await js(`document.querySelector('.mcq-range .nmselbtn')?.click()`);
  await sleep(250);
  await js(`[...document.querySelectorAll('.nmselopt')].find((b) => (b.textContent || '').includes('Last 3 months'))?.click()`);
  await sleep(600);
  console.log(`retro_quarter_weekly_buckets=${await js(`document.querySelector('.rtspark')?.children.length === 13`)}`);
  writeFileSync(join(dir, 'retro-quarter-dark.png'), (await win.webContents.capturePage()).toPNG());
  console.log(`shot_saved=${join(dir, 'retro-quarter-dark.png')}`);
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=taskref: inline task references in chat — the link renders in
    // place of the old digest cards, and hover raises the vitals popover
export async function taskref({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.navitem', 100);
  await js(`[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Skip tour')?.click()`);
  await sleep(250);
  await js(`[...document.querySelectorAll('.chan')].find((c) => (c.textContent || '').includes('dev'))?.click()`);
  const found = await waitFor('.taskref', 80);
  console.log(`taskref_links=${await js(`document.querySelectorAll('.taskref').length`)} debut_cards=${await js(`document.querySelectorAll('.digestchip').length`)} found=${found}`);
  writeFileSync(join(dir, 'taskref-links-dark.png'), (await win.webContents.capturePage()).toPNG());
  console.log(`shot_saved=${join(dir, 'taskref-links-dark.png')}`);
  // hover popover — a bubbling mousemove reaches React's root-delegated
  // handler (raw injected moves update CSS :hover but skip the synthetic
  // system); render timing makes this best-effort in the harness
  await js(`(() => { const el = [...document.querySelectorAll('.taskref')].pop(); if (!el) return; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); })()`);
  await sleep(500);
  console.log(`taskref_popover=${await js(`!!document.querySelector('.taskrefpop')`)}`);
  writeFileSync(join(dir, 'taskref-hover-dark.png'), (await win.webContents.capturePage()).toPNG());
  console.log(`shot_saved=${join(dir, 'taskref-hover-dark.png')}`);
  // load-bearing assertion: a real-input CLICK on the reference opens the thread
  const at = (await js(`(() => { const el = [...document.querySelectorAll('.taskref')].pop(); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`)) as { x: number; y: number } | null;
  if (at) {
    win.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  }
  await sleep(700);
  console.log(`taskref_click_opens_thread=${await js(`!!document.querySelector('.threadpanel')`)}`);
  writeFileSync(join(dir, 'taskref-click-thread-dark.png'), (await win.webContents.capturePage()).toPNG());
  console.log(`shot_saved=${join(dir, 'taskref-click-thread-dark.png')}`);
  app.exit(0);
  return;
}
