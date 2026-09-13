// `--shot` modes: planreview, stop, dod, pr — extracted from index.ts (track B-devshots).

import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShotCtx } from '../driver';
    // NM_SHOT_ONLY=planreview: the Phase-3 inline-comment plan-review UI. Seeds a
    // held plan_review task with a plan artifact, opens its full view, launches
    // the review panel, and leaves a sample comment.
export async function planreview({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.navitem', 100);
  await js(`[...document.querySelectorAll('.navitem')].find(n => n.textContent.includes('Tasks'))?.click()`);
  await waitFor('.tcard', 60);
  await js(`window.nm?.debugSeedPlan?.().catch(() => {})`);
  // let the seeded task sync + the autonomous flow settle it into plan_review
  // (architect drafts → orchestrator holds it because of the [review] marker)
  await sleep(5000);
  await js(`[...document.querySelectorAll('.tcard')].find(c => /Build the auth module/.test(c.textContent))?.click()`);
  await waitFor('.taskfull');
  // freeze entry animations: capturePage can otherwise catch a fixed overlay
  // mid-nm-pop at opacity 0 (CSS animations throttle when the window isn't
  // actively painting), making the overlay invisible in the capture.
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  if (!(await waitFor('.plancard', 30))) console.log('planreview_shot WARN no plancard');
  await sleep(400);
  // first: the plan_review task view itself (plan card, no completion/validation
  // section, clickable plan artifact)
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    const img = await win.webContents.capturePage();
    writeFileSync(join(dir, `plan-task-${theme}.png`), img.toPNG());
    console.log(`shot_saved=${join(dir, `plan-task-${theme}.png`)}`);
  }
  await js(`document.documentElement.dataset.theme = 'dark'`);
  // open the review via the in-message implementation-plan.md link (proves the
  // nm:plan deep-link survives url sanitization), falling back to the button
  // click the plan link in the full view specifically — the side-panel thread is
  // also mounted (and carries its own link), but it's behind the full view here
  // open via the latest-version plan link in the message (nm:plan/<name>)
  const openVia = await js(`(() => { const link = document.querySelector('.taskfull a[href^="nm:plan"]'); if (link) { link.click(); return 'message-link'; } const btn = [...document.querySelectorAll('.tfbar .btn')].find(b => /Review plan/.test(b.textContent)); btn?.click(); return 'button'; })()`);
  console.log(`planreview_open_via=${openVia}`);
  if (!(await waitFor('.plDoc', 40))) console.log('planreview_shot WARN no .plDoc');
  await sleep(300);
  // 1) block-level comment on the TIP "resolved" callout via the hover "+"
  await js(`document.querySelectorAll('.plBlock')[2]?.querySelector('.plAdd')?.click()`);
  await sleep(200);
  await js(`(() => { const t = document.querySelector('.plEditor textarea'); if (t) { const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'Confirm the OAuth client is provisioned before we wire the callback.'); t.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  await sleep(150);
  await js(`[...document.querySelectorAll('.plEditor .btn')].find(b => /Comment|Save/.test(b.textContent))?.click()`);
  await sleep(250);
  // 2) selection-anchored comment on the Approach paragraph — click the floating Comment button
  await js(`(() => { const blk = document.querySelectorAll('.plBlock')[1]; if (!blk) return; const tgt = blk.querySelector('p') || blk.querySelector('li, h2') || blk.querySelector('.plBody'); if (!tgt) return; const r = document.createRange(); r.selectNodeContents(tgt); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector('.plDoc')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); })()`);
  await sleep(250);
  await js(`document.querySelector('.plFloat')?.click()`);
  await sleep(150);
  await js(`(() => { const t = document.querySelector('.plEditor textarea'); if (t) { const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'Pin the session idle timeout here too, not just the 14-day cap.'); t.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  await sleep(150);
  await js(`[...document.querySelectorAll('.plEditor .btn')].find(b => /Comment|Save/.test(b.textContent))?.click()`);
  await sleep(400);
  // guard: the reviewer is a fixed overlay — assert it's actually painted (non-zero
  // rect) before capturing, so a covered/zero-size overlay can't pass as evidence
  const ov = await js(`(() => { const o = document.querySelector('.apvwrap.planreview'); if (!o) return 'none'; const r = o.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); })()`);
  console.log(`planreview_overlay=${ov} pills=${await js(`document.querySelectorAll('.plPill').length`)}`);
  if (ov === 'none' || /^0x/.test(String(ov))) console.log('planreview_shot WARN overlay not visible at capture');
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    const img = await win.webContents.capturePage();
    writeFileSync(join(dir, `plan-review-${theme}.png`), img.toPNG());
    console.log(`shot_saved=${join(dir, `plan-review-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=stop: the Stop affordance on an actively-running (in_progress)
    // task — halts the agent + closes the task — and its confirm, both themes.
export async function stop({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.navitem', 100);
  await js(`[...document.querySelectorAll('.navitem')].find(n => n.textContent.includes('Tasks'))?.click()`);
  await sleep(1000);
  for (let i = 0; i < 16; i++) {
    if (await js(`(async () => { try { const r = await window.nm?.debugSeedDod?.(); return !!(r && r.ok); } catch { return false; } })()`)) break;
    await sleep(500);
  }
  await sleep(2500); // let the in_progress task sync to the board
  if (!(await waitFor('.tcard', 40))) console.log('stop_shot WARN no .tcard after seed');
  for (let i = 0; i < 12; i++) {
    await js(`[...document.querySelectorAll('.tcard')].find(c => /Rate-limit the login/.test(c.textContent))?.click()`);
    await sleep(300);
    if (await js(`!!document.querySelector('.taskfull')`)) break;
  }
  await waitFor('.taskfull');
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  console.log(`stop_shot stopbtn=${await js(`[...document.querySelectorAll('.tfbar .btn')].some(b => /Stop/.test(b.textContent))`)}`);
  // 1) the in_progress task showing the 🛑 Stop button
  for (const theme of ['dark', 'cream-oak'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `stop-button-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `stop-button-${theme}.png`)}`);
  }
  // 2) click Stop → the confirm ("stop #N? the agent halts, audit stays")
  await js(`[...document.querySelectorAll('.tfbar .btn.danger')].find(b => /Stop/.test(b.textContent))?.click()`);
  await sleep(300);
  for (const theme of ['dark', 'cream-oak'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `stop-confirm-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `stop-confirm-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=dod: the editable Definition-of-Done card on an in-flight task —
    // the rendered acceptance contract (with the Edit affordance) and the edit
    // textarea — both themes (Claude-warm dark + cream-oak light).
export async function dod({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.navitem', 100);
  await js(`[...document.querySelectorAll('.navitem')].find(n => n.textContent.includes('Tasks'))?.click()`);
  await sleep(1000);
  for (let i = 0; i < 16; i++) {
    if (await js(`(async () => { try { const r = await window.nm?.debugSeedDod?.(); return !!(r && r.ok); } catch { return false; } })()`)) break;
    await sleep(500);
  }
  await sleep(2500); // let the seeded task sync to the board
  if (!(await waitFor('.tcard', 40))) console.log('dod_shot WARN no .tcard after seed');
  for (let i = 0; i < 12; i++) {
    await js(`[...document.querySelectorAll('.tcard')].find(c => /Rate-limit the login/.test(c.textContent))?.click()`);
    await sleep(300);
    if (await js(`!!document.querySelector('.taskfull')`)) break;
  }
  await waitFor('.taskfull');
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  if (!(await waitFor('.tfdod', 40))) console.log('dod_shot WARN no .tfdod (DoD card)');
  await js(`document.querySelector('.tfdodhead')?.scrollIntoView({ block: 'center' })`);
  await sleep(300);
  console.log(`dod_shot editbtn=${await js(`!!document.querySelector('.dodedit')`)} hasdod=${await js(`!!document.querySelector('.tfdod')`)}`);
  // 1) the rendered DoD contract + Edit affordance
  for (const theme of ['dark', 'cream-oak'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `dod-card-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `dod-card-${theme}.png`)}`);
  }
  // 2) click Edit → the textarea editor
  await js(`document.querySelector('.dodedit')?.click()`);
  if (!(await waitFor('.dodta', 30))) console.log('dod_shot WARN no .dodta (editor)');
  await js(`document.querySelector('.dodbox')?.scrollIntoView({ block: 'center' })`);
  await sleep(300);
  for (const theme of ['dark', 'cream-oak'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `dod-edit-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `dod-edit-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=pr: a repo task's PULL REQUEST link in the meta rail (the change
    // ships as a PR, merged on accept — never a direct commit), both themes.
export async function pr({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.navitem', 100);
  await js(`[...document.querySelectorAll('.navitem')].find(n => n.textContent.includes('Tasks'))?.click()`);
  await sleep(1000);
  for (let i = 0; i < 16; i++) {
    if (await js(`(async () => { try { const r = await window.nm?.debugSeedPr?.(); return !!(r && r.ok); } catch { return false; } })()`)) break;
    await sleep(500);
  }
  await sleep(3000); // let the seeded task drive to done + sync
  if (!(await waitFor('.tcard', 40))) console.log('pr_shot WARN no .tcard after seed');
  for (let i = 0; i < 12; i++) {
    await js(`[...document.querySelectorAll('.tcard')].find(c => /Rate-limit the login/.test(c.textContent))?.click()`);
    await sleep(300);
    if (await js(`!!document.querySelector('.taskfull')`)) break;
  }
  await waitFor('.taskfull');
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  if (!(await waitFor('.railpr', 40))) console.log('pr_shot WARN no .railpr (PR link)');
  console.log(`pr_shot prlink=${await js(`document.querySelector('.railpr')?.textContent?.trim() || 'none'`)}`);
  for (const theme of ['dark', 'cream-oak'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `pr-link-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `pr-link-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}
