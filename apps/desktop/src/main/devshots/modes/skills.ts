// `--shot` modes: skills, skillpacks, skillimport, skillconsider, slashpicker, slashempty — extracted from index.ts (track B-devshots).

import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShotCtx } from '../driver';

/** walk the app to a room's Skills tab — shared by the skills-family modes. */
async function driveToSkills({ js, sleep, waitFor }: ShotCtx, slug: string): Promise<void> {
  await waitFor('.chan', 100);
  for (let i = 0; i < 16; i++) {
    await js(`document.querySelector('.tour-skip')?.click()`);
    await js(`[...document.querySelectorAll('.chan')].find(c => ((c.querySelector('.lbl')?.textContent ?? '').replace(/[●\s]/g, '')) === '${slug}')?.click()`);
    await sleep(400);
    if (await js(`/#\s*${slug}/.test(document.querySelector('.topbar')?.textContent ?? '')`)) break;
  }
  for (let i = 0; i < 12; i++) {
    await js(`document.querySelector('.tour-skip')?.click()`);
    await js(`document.querySelector('[data-tour="skills"]')?.click()`);
    await sleep(400);
    if (await js(`!!document.querySelector('[data-tour="skills"].on')`)) break;
  }
}

    // NM_SHOT_ONLY=skills: a focused, chain-free capture of the Skills view
    // (the full chain leaves a thread panel open that races this late step)
export async function skills({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await js(`[...document.querySelectorAll('.chan')].find(c => c.textContent.includes('dev'))?.click()`);
  await sleep(600);
  await js(`[...document.querySelectorAll('.viewtog button')].find(b => b.textContent.trim().startsWith('Skills'))?.click()`);
  await waitFor('.skillcard');
  await sleep(500);
  await js(`(document.querySelector('.skillcard.draft .skillhead') ?? document.querySelector('.skillcard .skillhead'))?.click()`);
  await sleep(500);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    const img = await win.webContents.capturePage();
    writeFileSync(join(dir, `skills-${theme}.png`), img.toPNG());
    console.log(`shot_saved=${join(dir, `skills-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}

export async function skillpacks({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await driveToSkills({ js, sleep, waitFor } as ShotCtx, 'dev'); // #dev carries the bundled packs
  if (!(await waitFor('.packsec', 80))) console.log('skillpacks_shot WARN no .packsec (reconciler may be slow)');
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  await sleep(800);
  // 1) packs are COLLAPSED by default — capture that clean overview
  console.log(`skillpacks_shot packs=${await js(`document.querySelectorAll('.packsec').length`)} collapsed=${await js(`document.querySelectorAll('.packbody').length`)}`);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `skillpacks-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `skillpacks-${theme}.png`)}`);
  }
  // 2) expand a pack + toggle a skill OFF → greyed; capture expanded.
  // NM_SHOT_PACK targets a specific pack section by name (evidence for a
  // newly-added bundled pack); default stays the first pack.
  const targetPack = process.env['NM_SHOT_PACK'] ?? '';
  await js(targetPack
    ? `([...document.querySelectorAll('.packsec')].find(p => p.textContent.includes('${targetPack}'))?.querySelector('.packhead.clickable'))?.click()`
    : `document.querySelector('.packhead.clickable')?.click()`);
  await sleep(500);
  await js(`document.querySelector('.packbody .skillcard .nmsw[aria-checked="true"]')?.click()`);
  await sleep(500);
  console.log(`skillpacks_shot expanded_off=${await js(`document.querySelectorAll('.skillcard.off').length`)}`);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `skillpacks-expanded-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `skillpacks-expanded-${theme}.png`)}`);
  }
  // 3) click a skill → the detail overlay panel; capture it
  await js(`document.querySelector('.packbody .skillcard .skillhead')?.click()`);
  if (!(await waitFor('.skillpanel', 40))) console.log('skillpacks_shot WARN no .skillpanel');
  await sleep(400);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `skillpanel-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `skillpanel-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=skillimport: the Curator import flow — the live progress tracker
    // (mid-import stepper, error+retry, finished imported pack) + the add-pack modal.
    // Seeded into #general (which has no Curator) so the three states stay put.
export async function skillimport({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  // open #general + Skills FIRST so the pack watch is live when the seed lands
  await driveToSkills({ js, sleep, waitFor } as ShotCtx, 'general');
  // seed retries until the debug handler is registered + returns ok (one-shot
  // calls during the startup window are otherwise lost)
  let seeded = false;
  for (let i = 0; i < 16 && !seeded; i++) {
    seeded = await js(`(async () => { try { const r = await window.nm?.debugSeedImport?.(); return !!(r && r.ok); } catch { return false; } })()`);
    if (!seeded) await sleep(500);
  }
  if (!(await waitFor('.packprog', 80))) console.log(`skillimport_shot WARN no .packprog (seeded=${seeded})`);
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  await sleep(700);
  console.log(`skillimport_shot packs=${await js(`document.querySelectorAll('.packsec').length`)} prog=${await js(`document.querySelectorAll('.packprog').length`)} err=${await js(`document.querySelectorAll('.packprog.err').length`)}`);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `skillimport-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `skillimport-${theme}.png`)}`);
  }
  // the add-pack modal — open it and fill a sample repo URL (native setter so
  // React's controlled input registers the change)
  await js(`[...document.querySelectorAll('.skillbar .btn')].find(b => /Add skill pack/.test(b.textContent))?.click()`);
  await waitFor('.modal .fld input', 60);
  await js(`(() => { const i = document.querySelector('.modal .fld input'); if (i) { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, 'https://github.com/anthropics/skills'); i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  await sleep(300);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `skillimport-modal-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `skillimport-modal-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=skillconsider: the Activity log showing an agent considering
    // team skills before executing (the inject + load_skill rows, slice 5). Global
    // feed — no task-board dependency (#1004 only exists under the smoke).
export async function skillconsider({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.navitem', 100);
  for (let i = 0; i < 16; i++) {
    if (await js(`(async () => { try { const r = await window.nm?.debugSeedLogs?.(); return !!(r && r.ok); } catch { return false; } })()`)) break;
    await sleep(500);
  }
  await js(`[...document.querySelectorAll('.navitem')].find(n => n.textContent.includes('Activity'))?.click()`);
  if (!(await waitFor('.logrow', 60))) console.log('skillconsider_shot WARN no .logrow');
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  await sleep(500);
  console.log(`skillconsider_shot rows=${await js(`document.querySelectorAll('.logrow').length`)} skillrows=${await js(`[...document.querySelectorAll('.logrow')].filter(r => /skill/i.test(r.textContent)).length`)}`);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `skillconsider-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `skillconsider-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=slashpicker: typing `/` in the channel composer opens the skill
    // picker; selecting one attaches a clearable chip that steers the orchestrator.
    // #dev carries the bundled-pack skills (reconciler-seeded), so the picker fills.
export async function slashpicker({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.chan', 100);
  for (let i = 0; i < 16; i++) {
    await js(`[...document.querySelectorAll('.chan')].find(c => c.textContent.trim() === '# dev')?.click()`);
    await sleep(400);
    if (await js(`/#\\s*dev/.test(document.querySelector('.topbar')?.textContent ?? '')`)) break;
  }
  await js(`document.querySelector('.viewtog button:nth-child(1)')?.click()`); // Chat view
  await waitFor('.composer');
  await sleep(2800); // let #dev skills sync in (the picker reads synced state)
  const setInput = (v: string) => js(`(() => { const i = document.querySelector('.composer .cbox input'); if (i) { i.focus(); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  await setInput('/re'); // open the picker, filtered
  if (!(await waitFor('.slashpop', 60))) console.log('slashpicker_shot WARN no .slashpop');
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  await sleep(400);
  console.log(`slashpicker_shot items=${await js(`document.querySelectorAll('.slashitem').length`)}`);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `slashpicker-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `slashpicker-${theme}.png`)}`);
  }
  // pick the first skill → a chip attaches; type a message to show the steer
  await js(`document.querySelector('.slashitem')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
  await sleep(300);
  await setInput('use this when you build the metrics dashboard');
  await sleep(300);
  console.log(`slashpicker_shot chip=${await js(`document.querySelectorAll('.skillattach .skillchip').length`)}`);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `slashchip-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `slashchip-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}

    // NM_SHOT_ONLY=slashempty: typing `/` in a channel with NO skills still opens
    // the picker, showing an empty state that points to the Skills tab.
export async function slashempty({ win, dir, js, sleep, waitFor }: ShotCtx): Promise<void> {
  await waitFor('.chan', 100);
  for (let i = 0; i < 16; i++) {
    await js(`[...document.querySelectorAll('.chan')].find(c => c.textContent.trim() === '# general')?.click()`);
    await sleep(400);
    if (await js(`/#\\s*general/.test(document.querySelector('.topbar')?.textContent ?? '')`)) break;
  }
  await js(`document.querySelector('.viewtog button:nth-child(1)')?.click()`); // Chat
  await waitFor('.composer');
  await sleep(1500);
  await js(`(() => { const i = document.querySelector('.composer .cbox input'); if (i) { i.focus(); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, '/'); i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  if (!(await waitFor('.slashempty', 60))) console.log('slashempty_shot WARN no .slashempty');
  await js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`);
  await sleep(400);
  console.log(`slashempty_shot empty=${await js(`document.querySelectorAll('.slashempty').length`)} link=${await js(`document.querySelectorAll('.slashlink').length`)}`);
  for (const theme of ['dark', 'light'] as const) {
    await js(`document.documentElement.dataset.theme = '${theme}'`);
    await sleep(350);
    writeFileSync(join(dir, `slashempty-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`shot_saved=${join(dir, `slashempty-${theme}.png`)}`);
  }
  app.exit(0);
  return;
}
