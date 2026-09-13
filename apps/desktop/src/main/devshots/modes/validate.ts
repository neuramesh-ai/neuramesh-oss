// `--shot` modes: validate — extracted from index.ts (track B-devshots).

import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShotCtx } from '../driver';
    // NM_SHOT_ONLY=validate: the deliverable validation panel (rendered image,
    // interactive HTML + Open-in-browser) and the read-only APPROVED plan. Seeds
    // a finished in_review task carrying real artifacts.
export async function validate({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.navitem', 100);
  await js(`[...document.querySelectorAll('.navitem')].find(n => n.textContent.includes('Tasks'))?.click()`);
  // retry the seed until the debug handler is registered + returns ok (one-shot
  // calls during the startup window are otherwise lost), then wait for its card
  await sleep(1200);
  for (let i = 0; i < 16; i++) {
    if (await js(`(async () => { try { const r = await window.nm?.debugSeedReview?.(); return !!(r && r.ok); } catch { return false; } })()`)) break;
    await sleep(500);
  }
  await sleep(4000); // let the seeded task drive to done + sync
  if (!(await waitFor('.tcard', 40))) console.log('validate_shot WARN no .tcard after seed');
  // open the full view of the seeded (now done) task — retry in case the board
  // hasn't painted the done column yet
  for (let i = 0; i < 12; i++) {
    await js(`[...document.querySelectorAll('.tcard')].find(c => /Gamified 404/.test(c.textContent))?.click()`);
    await sleep(300);
    if (await js(`!!document.querySelector('.taskfull')`)) break;
  }
  await waitFor('.taskfull');
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  // proof for the founder fix: the done full-view action card carries BOTH
  // Accept and Request changes (the reopen affordance) — scroll it into view
  await js(`document.querySelector('.tfaccept')?.scrollIntoView({ block: 'center' })`);
  await sleep(300);
  console.log(`validate_shot reqchg_btn=${await js(`[...document.querySelectorAll('.tfaccept .btn')].some(b => /Request changes/.test(b.textContent))`)}`);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `reopen-fulltask-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `reopen-fulltask-${theme}.png`)}`);
  }
  await js(`document.querySelector('.taskfull')?.scrollTo({ top: 0 })`);
  if (!(await waitFor('.artchip', 30))) console.log('validate_shot WARN no artchip');
  await sleep(400);
  // 1) the task view with the validation-artifacts row (chips, not raw dumps)
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `validate-task-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `validate-task-${theme}.png`)}`);
  }
  await js(`document.documentElement.dataset.theme = 'dark'`);
  // 2) click the HTML deliverable chip → rendered + interactive preview + Open-in-browser
  await js(`[...document.querySelectorAll('.taskfull .artchip')].find(b => /demo\\.html/.test(b.textContent))?.click()`);
  if (!(await waitFor('.apvframe', 40))) console.log('validate_shot WARN no apvframe');
  await sleep(800);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `validate-html-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `validate-html-${theme}.png`)}`);
  }
  await js(`document.documentElement.dataset.theme = 'dark'`);
  // 3) select the image artifact → rendered image (not raw base64)
  await js(`[...document.querySelectorAll('.apvitem')].find(b => /snake-preview/.test(b.textContent))?.click()`);
  await sleep(450);
  writeFileSync(join(dir, 'validate-image-dark.png'), (await win.webContents.capturePage()).toPNG());
  console.log(`shot_saved=${join(dir, 'validate-image-dark.png')}`);
  // 4) close the preview, open the (now read-only, approved) plan
  await js(`[...document.querySelectorAll('.apvbar .btn')].find(b => /Close/.test(b.textContent))?.click()`);
  await sleep(300);
  await js(`[...document.querySelectorAll('.taskfull .artchip')].find(b => /implementation-plan/.test(b.textContent))?.click()`);
  if (!(await waitFor('.planreview', 40))) console.log('validate_shot WARN no planreview');
  await sleep(400);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `validate-plan-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `validate-plan-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}
