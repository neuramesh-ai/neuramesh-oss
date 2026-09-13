// `--shot` modes: lessons — extracted from index.ts (track B-devshots).

import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShotCtx } from '../driver';
    // NM_SHOT_ONLY=lessons: the Memory view with the "Lessons from reviews" section —
    // seeded via nm:debug-seed-lessons (summary block + facts + two lessons carrying
    // task provenance). Both doctrine themes.
export async function lessons({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.chan', 100);
  let seeded: { ok?: boolean; slug?: string } = {};
  for (let i = 0; i < 12; i++) {
    seeded = (await js(`(async () => { try { return (await window.nm?.debugSeedLessons?.()) ?? {}; } catch { return {}; } })()`)) as { ok?: boolean; slug?: string };
    if (seeded.ok) break;
    await sleep(600);
  }
  if (!seeded.ok) console.log('lessons_shot WARN seed failed');
  const slug = seeded.slug ?? 'general';
  // Late session-restore can remount the shell (view/channel snap back to defaults,
  // saved dock tabs reopen) — so navigation is RE-ASSERTED right before every capture
  // instead of trusted once. The channel row is "# <slug> ⚙": match on the .lbl span.
  const driveToMemory = async (): Promise<boolean> => {
    for (let i = 0; i < 16; i++) {
      // a fresh shot profile fires the first-run tour — its backdrop dims every
      // capture and the card covers the top lesson rows; dismiss it first
      await js(`document.querySelector('.tour-skip')?.click()`);
      await js(`[...document.querySelectorAll('.chan')].find((c) => c.querySelector('.lbl')?.textContent?.replace('●', '').trim() === '${slug}')?.click()`);
      await js(`document.querySelector('.navitem[aria-label="Memory"]')?.click()`);
      await sleep(450);
      if (await js(`!!document.querySelector('.factdot.lesson') && !document.querySelector('.tour-skip') && /#\\s*${slug}/.test(document.querySelector('.topbar')?.textContent ?? '')`)) return true;
    }
    return false;
  };
  if (!(await driveToMemory())) console.log('lessons_shot WARN no lesson rows');
  // kill motion + hide the restored terminal dock for a clean capture (idempotent —
  // re-applied before each capture in case a reload wiped <head>)
  const ensureShotStyle = () => js(`(() => { if (document.getElementById('nm-shot-style')) return; const s = document.createElement('style'); s.id = 'nm-shot-style'; s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important} .dockpanel{display:none!important}'; document.head.appendChild(s); })()`);
  await ensureShotStyle();
  console.log(`lessons_shot lessons=${await js(`document.querySelectorAll('.factdot.lesson').length`)} rows=${await js(`document.querySelectorAll('.factrow').length`)}`);
  // The shell can flap back to the boot splash while sync watches re-emit — so a
  // capture only counts when the DOM verifies right BEFORE and AFTER it (same view,
  // style intact = no reload mid-capture). Retry until that invariant holds.
  for (const theme of ['dark', 'cream-oak'] as const) {
    let saved = false;
    for (let i = 0; i < 10 && !saved; i++) {
      if (!(await driveToMemory())) continue;
      await ensureShotStyle();
      await js(`document.documentElement.dataset.theme = '${theme}'`);
      await sleep(250);
      const before = Number(await js(`document.querySelectorAll('.factdot.lesson').length`));
      const png = (await win.webContents.capturePage()).toPNG();
      const after = Number(await js(`document.querySelectorAll('.factdot.lesson').length && document.getElementById('nm-shot-style') && document.documentElement.dataset.theme === '${theme}' ? 1 : 0`));
      if (before >= 2 && after === 1) {
        writeFileSync(join(dir, `lessons-${theme}.png`), png);
        saved = true;
        console.log(`shot_saved=${join(dir, `lessons-${theme}.png`)}`);
      } else {
        console.log(`lessons_shot retry theme=${theme} before=${before} after=${after}`);
      }
    }
    if (!saved) console.log(`lessons_shot WARN could not capture a stable ${theme} frame`);
  }
  // Curation slice: the same rows carry retire/correct affordances. Every
  // interactive state is re-opened per attempt (a shell remount wipes React
  // state) and captured in both doctrine themes.
  const validLessonRows = `[...document.querySelectorAll('.factrow')].filter((r) => r.querySelector('.factdot.lesson') && !r.classList.contains('dead'))`;
  // 1) the inline correct-this-lesson editor, prefilled with the lesson text
  const openCorrect = async (): Promise<boolean> => {
    for (let i = 0; i < 12; i++) {
      if (await js(`!!document.querySelector('.lessonedit textarea')`)) return true;
      if (await driveToMemory()) {
        await ensureShotStyle();
        await js(`${validLessonRows}[0]?.querySelectorAll('.factact')[0]?.click()`);
      }
      await sleep(300);
    }
    return false;
  };
  for (const theme of ['dark', 'cream-oak'] as const) {
    let saved = false;
    for (let i = 0; i < 8 && !saved; i++) {
      if (!(await openCorrect())) continue;
      await js(`document.documentElement.dataset.theme = '${theme}'`);
      await sleep(250);
      const png = (await win.webContents.capturePage()).toPNG();
      if (await js(`!!document.querySelector('.lessonedit textarea') && document.documentElement.dataset.theme === '${theme}'`)) {
        writeFileSync(join(dir, `lessons-correct-${theme}.png`), png);
        saved = true;
        console.log(`shot_saved=${join(dir, `lessons-correct-${theme}.png`)}`);
      }
    }
    if (!saved) console.log(`lessons_shot WARN no correct-editor ${theme} frame`);
  }
  await js(`[...document.querySelectorAll('.lessoneditacts .btn')].find((b) => b.textContent === 'Cancel')?.click()`);
  await sleep(200);
  // 2) the two-step retire: arm the confirm state (both themes), then click
  //    through — the row must flip to dead via the REAL command → API → PG →
  //    refetch loop, which is the end-to-end proof of the slice
  const armRetire = async (): Promise<boolean> => {
    for (let i = 0; i < 12; i++) {
      if (await js(`!!document.querySelector('.factact.danger')`)) return true;
      if (await driveToMemory()) {
        await ensureShotStyle();
        await js(`(() => { const rows = ${validLessonRows}; rows[rows.length - 1]?.querySelectorAll('.factact')[1]?.click(); })()`);
      }
      await sleep(300);
    }
    return false;
  };
  for (const theme of ['dark', 'cream-oak'] as const) {
    let saved = false;
    for (let i = 0; i < 8 && !saved; i++) {
      if (!(await armRetire())) continue;
      await js(`document.documentElement.dataset.theme = '${theme}'`);
      await sleep(250);
      const png = (await win.webContents.capturePage()).toPNG();
      if (await js(`!!document.querySelector('.factact.danger') && document.documentElement.dataset.theme === '${theme}'`)) {
        writeFileSync(join(dir, `lessons-retire-confirm-${theme}.png`), png);
        saved = true;
        console.log(`shot_saved=${join(dir, `lessons-retire-confirm-${theme}.png`)}`);
      }
    }
    if (!saved) console.log(`lessons_shot WARN no retire-confirm ${theme} frame`);
  }
  // a prior run's retired lessons persist in the stack DB — count dead rows
  // before the click and require the count to GROW, not merely exist
  const deadCount = `document.querySelectorAll('.factrow.dead .factdot.lesson').length`;
  const validBefore = Number(await js(`${validLessonRows}.length`));
  const deadBefore = Number(await js(deadCount));
  if (await armRetire()) await js(`document.querySelector('.factact.danger')?.click()`);
  let retired = false;
  for (let i = 0; i < 20 && !retired; i++) {
    await sleep(400);
    retired = Number(await js(deadCount)) > deadBefore;
  }
  console.log(`lessons_shot retired_ok=${retired} valid_before=${validBefore} valid_after=${await js(`${validLessonRows}.length`)} dead_before=${deadBefore} dead_after=${await js(deadCount)}`);
  for (const theme of ['dark', 'cream-oak'] as const) {
    let saved = false;
    for (let i = 0; i < 10 && !saved; i++) {
      if (!(await driveToMemory())) continue;
      await ensureShotStyle();
      await js(`document.documentElement.dataset.theme = '${theme}'`);
      await sleep(250);
      const png = (await win.webContents.capturePage()).toPNG();
      if (await js(`${deadCount} > ${deadBefore} && !!document.getElementById('nm-shot-style') && document.documentElement.dataset.theme === '${theme}'`)) {
        writeFileSync(join(dir, `lessons-retired-${theme}.png`), png);
        saved = true;
        console.log(`shot_saved=${join(dir, `lessons-retired-${theme}.png`)}`);
      }
    }
    if (!saved) console.log(`lessons_shot WARN no retired ${theme} frame`);
  }
  app.exit(0);
  return;
}
